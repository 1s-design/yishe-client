"""Photoshop 内存守卫工具。

提供三个能力：
1. purge_photoshop(): 清理 Photoshop 内部缓存（撤销历史/剪贴板/智能对象缓存），
   防止自动化长期运行导致的提交内存持续累积。
2. 内存检测: get_photoshop_commit_gb() / get_system_commit() 读取 PS 进程与系统提交内存。
3. MemoryWatchdog: 后台看门狗线程，PS 提交内存超过阈值时自动重启 Photoshop，
   系统提交内存接近上限时提前预警。
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import os
import threading
import time
from typing import Optional

import psutil

# ------------------------- 配置 -------------------------

# PS 提交内存超过该值（GB）时自动重启 Photoshop
PS_COMMIT_RESTART_GB = 6.0
# 系统提交内存占用率超过该值（%）时发出警告
SYSTEM_COMMIT_WARN_PCT = 90.0
# 系统提交内存占用率超过该值（%）时无视任务忙闲，立即强制重启（兜底防崩溃）
SYSTEM_COMMIT_CRITICAL_PCT = 95.0
# 看门狗检查间隔（秒）
WATCHDOG_INTERVAL_SECONDS = 300
# 任务进行中时，推迟重启的检查间隔（秒）
DEFER_INTERVAL_SECONDS = 60
# 任务进行中最多推迟重启的时间（秒），超过后即使打断任务也要重启
MAX_DEFER_SECONDS = 600
# 两次自动重启之间的最小间隔（秒），防止重启风暴
RESTART_COOLDOWN_SECONDS = 600

# ------------------------- 任务忙闲追踪 -------------------------
# 处理类请求（如 /processPsd）进行中时，看门狗会推迟重启，
# 避免 PS 重启打断正在执行的制作任务。

_active_jobs = 0
_job_lock = threading.Lock()


def job_begin() -> None:
    """标记一个处理任务开始（由处理类端点调用）。"""
    global _active_jobs
    with _job_lock:
        _active_jobs += 1


def job_end() -> None:
    """标记一个处理任务结束。"""
    global _active_jobs
    with _job_lock:
        _active_jobs = max(0, _active_jobs - 1)


def get_active_job_count() -> int:
    """当前进行中的处理任务数量。"""
    with _job_lock:
        return _active_jobs

# ------------------------- 内存检测 -------------------------


class _PERFORMANCE_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("CommitTotal", ctypes.c_size_t),
        ("CommitLimit", ctypes.c_size_t),
        ("CommitPeak", ctypes.c_size_t),
        ("PhysicalTotal", ctypes.c_size_t),
        ("PhysicalAvailable", ctypes.c_size_t),
        ("SystemCache", ctypes.c_size_t),
        ("KernelTotal", ctypes.c_size_t),
        ("KernelPaged", ctypes.c_size_t),
        ("KernelNonpaged", ctypes.c_size_t),
        ("PageSize", ctypes.c_size_t),
        ("HandleCount", ctypes.c_ulong),
        ("ProcessCount", ctypes.c_ulong),
        ("ThreadCount", ctypes.c_ulong),
    ]


def get_system_commit() -> Optional[dict]:
    """返回系统提交内存信息（GB）。失败返回 None。"""
    try:
        info = _PERFORMANCE_INFORMATION()
        info.cb = ctypes.sizeof(info)
        if not ctypes.windll.psapi.GetPerformanceInfo(
            ctypes.byref(info), info.cb
        ):
            return None
        page = info.PageSize
        total = info.CommitTotal * page / (1024 ** 3)
        limit = info.CommitLimit * page / (1024 ** 3)
        return {
            "used_gb": round(total, 2),
            "limit_gb": round(limit, 2),
            "free_gb": round(limit - total, 2),
            "pct": round(total / limit * 100, 1) if limit else 0.0,
        }
    except Exception:
        return None


def get_photoshop_commit_gb() -> Optional[float]:
    """返回 Photoshop 进程的提交内存总量（GB）。未运行返回 None。"""
    total = 0.0
    found = False
    try:
        for proc in psutil.process_iter(attrs=["name"]):
            name = (proc.info.get("name") or "").lower()
            if name.startswith("photoshop"):
                found = True
                try:
                    # Windows 上 memory_info().private 即提交内存（私有字节）
                    total += proc.memory_info().private / (1024 ** 3)
                except (psutil.NoSuchProcess, psutil.AccessDenied,
                        psutil.ZombieProcess):
                    pass
    except Exception:
        return None
    return round(total, 2) if found else None


# ------------------------- 缓存清理 -------------------------


def purge_photoshop(app=None) -> bool:
    """清理 Photoshop 内部缓存（撤销历史、剪贴板、智能对象缓存等）。

    Args:
        app: Photoshop Application COM 对象；为 None 时忽略。

    Returns:
        是否清理成功。
    """
    if app is None:
        return False

    # 优先使用 COM 枚举方式
    try:
        from photoshop.api.enumerations import PurgeTarget

        for name in ("AllCaches", "ALLCACHES", "AllCaches"):
            target = getattr(PurgeTarget, name, None)
            if target is not None:
                app.purge(target)
                return True
    except Exception:
        pass

    # 兜底：ActionManager 方式（跨版本稳定）
    try:
        from photoshop.api import ActionDescriptor, ActionReference
        from photoshop.api.enumerations import DialogModes

        sid = app.stringIDToTypeID
        ref = ActionReference()
        ref.putEnumerated(sid("purge"), sid("purge"), sid("allCaches"))
        desc = ActionDescriptor()
        desc.putReference(sid("null"), ref)
        app.executeAction(sid("purge"), desc, DialogModes.DisplayNoDialogs)
        return True
    except Exception as e:
        print(f"⚠️ purge_photoshop 清理缓存失败: {e}")
        return False


# ------------------------- 看门狗 -------------------------


def clear_photoshop_autorecovery() -> int:
    """清理 Photoshop 自动恢复（会话恢复）缓存目录。

    PS 被强制结束后再次启动时会自动重开崩溃前的所有文档，
    导致提交内存秒回高位。PS 关闭状态下删除 AutoRecovery 目录即可阻止。
    必须在 Photoshop 完全退出后调用。

    Returns:
        清理的目录数量。
    """
    import shutil
    from pathlib import Path

    cleaned = 0
    try:
        appdata = os.environ.get("APPDATA")
        if not appdata:
            return 0
        adobe_root = Path(appdata) / "Adobe"
        if not adobe_root.is_dir():
            return 0
        for child in adobe_root.iterdir():
            if child.is_dir() and "AutoRecovery" in child.name and "Photoshop" in child.name:
                try:
                    shutil.rmtree(child, ignore_errors=True)
                    cleaned += 1
                    print(f"[内存看门狗] 已清理 PS 自动恢复缓存: {child.name}")
                except Exception as e:
                    print(f"[内存看门狗] 清理 {child.name} 失败: {e}")
    except Exception as e:
        print(f"[内存看门狗] 清理自动恢复缓存异常: {e}")
    return cleaned


def _restart_photoshop_with_cleanup(timeout: int = 120) -> bool:
    """带清理的重启流程：关闭 PS → 清自动恢复缓存 → 启动 PS。

    比裸 restart_photoshop 多了 AutoRecovery 清理，
    避免 PS 重启后自动重开文档导致内存立刻回冲。
    """
    from .photoshop_process import (
        close_photoshop_process,
        is_photoshop_running,
        start_photoshop,
    )

    if is_photoshop_running():
        print("[内存看门狗] 正在关闭 Photoshop...")
        close_photoshop_process(force=False)
        for _ in range(15):
            time.sleep(1)
            if not is_photoshop_running():
                break
        # 兜底强杀
        if is_photoshop_running():
            print("[内存看门狗] PS 未正常退出，强制结束")
            close_photoshop_process(force=True)
            time.sleep(3)

    # PS 已完全退出，安全清理会话恢复缓存
    clear_photoshop_autorecovery()

    print("[内存看门狗] 正在启动 Photoshop...")
    return start_photoshop(timeout)


class MemoryWatchdog:
    """Photoshop 内存看门狗线程。

    - 每个检查周期读取 PS 提交内存与系统提交内存；
    - PS 提交内存超过阈值 → 自动重启 Photoshop（带冷却时间）；
    - 系统提交内存超过预警线 → 打印警告。
    """

    def __init__(
        self,
        interval: float = WATCHDOG_INTERVAL_SECONDS,
        ps_threshold_gb: float = PS_COMMIT_RESTART_GB,
        system_warn_pct: float = SYSTEM_COMMIT_WARN_PCT,
        restart_cooldown: float = RESTART_COOLDOWN_SECONDS,
        system_critical_pct: float = SYSTEM_COMMIT_CRITICAL_PCT,
        defer_interval: float = DEFER_INTERVAL_SECONDS,
        max_defer_seconds: float = MAX_DEFER_SECONDS,
    ):
        self.interval = interval
        self.ps_threshold_gb = ps_threshold_gb
        self.system_warn_pct = system_warn_pct
        self.restart_cooldown = restart_cooldown
        self.system_critical_pct = system_critical_pct
        self.defer_interval = defer_interval
        self.max_defer_seconds = max_defer_seconds
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._last_restart_time = 0.0
        self._defer_since = 0.0
        self._lock = threading.Lock()

    # ---- 状态快照（供 /memoryStatus 接口读取） ----
    def snapshot(self) -> dict:
        return {
            "enabled": self._thread is not None and self._thread.is_alive(),
            "interval_seconds": self.interval,
            "ps_commit_restart_threshold_gb": self.ps_threshold_gb,
            "photoshop_commit_gb": get_photoshop_commit_gb(),
            "system_commit": get_system_commit(),
            "active_jobs": get_active_job_count(),
            "restart_deferred_seconds": round(
                time.time() - self._defer_since, 1
            ) if self._defer_since else 0.0,
            "last_restart_at": self._last_restart_time,
            "seconds_since_last_restart": round(
                time.time() - self._last_restart_time, 1
            ) if self._last_restart_time else None,
        }

    # ---- 主循环 ----
    def _run(self) -> None:
        print(
            f"[内存看门狗] 已启动：每 {self.interval:.0f}s 检查一次，"
            f"PS 提交内存 > {self.ps_threshold_gb}GB 自动重启"
            f"（任务进行中推迟，系统提交 >={self.system_critical_pct:.0f}% 强制）"
        )
        while not self._stop_event.is_set():
            try:
                self._check_once()
            except Exception as e:
                print(f"[内存看门狗] 检查异常（忽略并继续）: {e}")
            # 推迟重启期间用短间隔轮询，尽快抓住空闲窗口
            self._stop_event.wait(
                self.defer_interval if self._defer_since else self.interval
            )

    def _check_once(self) -> None:
        ps_gb = get_photoshop_commit_gb()
        sys_commit = get_system_commit()

        if ps_gb is not None:
            print(f"[内存看门狗] Photoshop 提交内存: {ps_gb} GB")
        if sys_commit:
            print(
                f"[内存看门狗] 系统提交内存: {sys_commit['used_gb']}/"
                f"{sys_commit['limit_gb']} GB ({sys_commit['pct']}%)"
            )

        # 系统级预警
        if sys_commit and sys_commit["pct"] >= self.system_warn_pct:
            print(
                f"[内存看门狗] ⚠️ 系统提交内存已达 {sys_commit['pct']}%，"
                f"新进程可能无法启动，建议清理内存或重启 Photoshop"
            )

        # PS 阈值重启
        if ps_gb is None or ps_gb <= self.ps_threshold_gb:
            self._defer_since = 0.0
            return

        with self._lock:
            elapsed = time.time() - self._last_restart_time
            if elapsed < self.restart_cooldown:
                print(
                    f"[内存看门狗] PS 提交内存 {ps_gb}GB 超阈值，"
                    f"但距上次重启仅 {elapsed:.0f}s（冷却期），跳过"
                )
                return

        jobs = get_active_job_count()
        critical = bool(
            sys_commit and sys_commit["pct"] >= self.system_critical_pct
        )

        if jobs > 0 and not critical:
            # 任务进行中：推迟重启，等空闲窗口（或推迟超时）
            if not self._defer_since:
                self._defer_since = time.time()
            deferred = time.time() - self._defer_since
            if deferred < self.max_defer_seconds:
                print(
                    f"[内存看门狗] PS 提交内存 {ps_gb}GB 超阈值，"
                    f"但有 {jobs} 个任务进行中，推迟重启"
                    f"（已等 {deferred:.0f}s/{self.max_defer_seconds:.0f}s，"
                    f"系统提交{'已到' if critical else '未到'}临界线）"
                )
                return
            print(
                f"[内存看门狗] 任务已连续 {deferred:.0f}s 未空闲，"
                f"为防内存耗尽强制重启"
            )
        else:
            self._defer_since = 0.0

        with self._lock:
            self._last_restart_time = time.time()

        reason = (
            f"系统提交内存临界({sys_commit['pct']}%)" if critical
            else f"PS 提交内存 {ps_gb}GB 超阈值"
        )
        print(f"[内存看门狗] 🔄 {reason}，自动重启 Photoshop...")
        try:
            ok = _restart_photoshop_with_cleanup(timeout=120)
            status = "成功" if ok else "失败"
            print(f"[内存看门狗] 自动重启 Photoshop {status}")
        except Exception as e:
            print(f"[内存看门狗] 自动重启 Photoshop 异常: {e}")

    # ---- 启停 ----
    def start(self) -> bool:
        if self._thread is not None and self._thread.is_alive():
            return False
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run, name="ps-memory-watchdog", daemon=True
        )
        self._thread.start()
        return True

    def stop(self) -> None:
        self._stop_event.set()


# 模块级单例，api_server 启动时调用 start_memory_watchdog()
_watchdog: Optional[MemoryWatchdog] = None


def start_memory_watchdog(**kwargs) -> MemoryWatchdog:
    """启动（或复用已存在的）内存看门狗。"""
    global _watchdog
    if _watchdog is None:
        _watchdog = MemoryWatchdog(**kwargs)
    _watchdog.start()
    return _watchdog


def get_memory_watchdog() -> Optional[MemoryWatchdog]:
    return _watchdog
