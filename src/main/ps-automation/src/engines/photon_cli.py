"""Photon Studio CLI 的轻量封装。

只负责“调用 + 解析 JSON + 统一报错”，不含任何业务匹配/导出逻辑。
CLI 全量输出 JSON：exit 0 成功 / 1 操作错误 / 2 传输或入参错误。
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional


class PhotonCliError(RuntimeError):
    """Photon CLI 调用失败（找不到可执行文件、超时、返回 ok=false 等）。"""


class PhotonCliNotFoundError(PhotonCliError):
    """本机未安装 Photon Studio。"""


def _machine() -> str:
    import platform

    return platform.machine().lower()


def _bundled_cli_candidate() -> Optional[Path]:
    """Photon 自带的兜底 CLI（安装目录内 build/cli/<plat>-<arch>/photon）。"""
    base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    plat = {"darwin": "mac", "win32": "win", "linux": "linux"}.get(sys.platform, sys.platform)
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(_machine(), _machine())
    name = "photon.exe" if sys.platform == "win32" else "photon"
    return base / "photon" / "build" / "cli" / f"{plat}-{arch}" / name


def resolve_photon_cli() -> str:
    """按顺序解析 Photon CLI：环境变量 → PATH → ~/.photon/bin → 安装目录兜底。"""
    env_value = (os.environ.get("PHOTON_CLI") or "").strip()
    candidates: list[Path] = []
    if env_value:
        candidates.append(Path(env_value).expanduser())

    which_value = shutil.which("photon")
    if which_value:
        candidates.append(Path(which_value))

    candidates.append(Path.home() / ".photon" / "bin" / ("photon.exe" if sys.platform == "win32" else "photon"))

    bundled = _bundled_cli_candidate()
    if bundled:
        candidates.append(bundled)

    if sys.platform == "win32":
        for env_key in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"):
            root = (os.environ.get(env_key) or "").strip()
            if not root:
                continue
            candidates.append(Path(root) / "Photon" / "resources" / "app" / "build" / "cli" / "win-x64" / "photon.exe")
            candidates.append(Path(root) / "Programs" / "Photon" / "resources" / "app" / "build" / "cli" / "win-x64" / "photon.exe")

    for candidate in candidates:
        try:
            if candidate.is_file():
                return str(candidate)
        except OSError:
            continue

    raise PhotonCliNotFoundError(
        "未找到 Photon CLI，请先安装 Photon Studio（可用环境变量 PHOTON_CLI 指定可执行文件路径）"
    )


class PhotonCli:
    """一次进程内复用的 CLI 客户端；每个文档会话由 document id 显式管理。"""

    def __init__(self, cli_path: Optional[str] = None, default_timeout: float = 1800):
        self.cli_path = cli_path or resolve_photon_cli()
        self.default_timeout = default_timeout

    # ---------- 基础调用 ----------
    def _run(self, args: list[str], timeout: Optional[float] = None) -> dict:
        command = [self.cli_path, *args]
        try:
            proc = subprocess.run(
                command,
                capture_output=True,
                timeout=timeout or self.default_timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise PhotonCliError(f"Photon CLI 超时（{timeout or self.default_timeout}s）: {' '.join(args[:2])}") from exc

        stdout = proc.stdout.decode("utf-8", "replace").strip()
        stderr = proc.stderr.decode("utf-8", "replace").strip()
        payload: Any
        try:
            payload = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError as exc:
            raise PhotonCliError(
                f"Photon CLI 输出不是合法 JSON（exit={proc.returncode}）: {stdout[:500] or stderr[:500]}"
            ) from exc

        if proc.returncode != 0 or not isinstance(payload, dict) or payload.get("ok") is False:
            error = (payload or {}).get("error") if isinstance(payload, dict) else None
            detail = ""
            if isinstance(error, dict):
                detail = f"{error.get('code') or ''} {error.get('message') or ''}".strip()
            detail = detail or stderr or stdout[:500]
            raise PhotonCliError(
                f"Photon 操作失败（exit={proc.returncode}, {args[0]} {args[1] if len(args) > 1 else ''}）: {detail}"
            )
        return payload

    # ---------- 文档会话 ----------
    def version(self) -> str:
        """`--version` 输出纯文本（非 JSON），这里单独处理。"""
        try:
            proc = subprocess.run([self.cli_path, "--version"], capture_output=True, timeout=60)
        except subprocess.TimeoutExpired as exc:
            raise PhotonCliError("Photon CLI 版本查询超时") from exc
        if proc.returncode != 0:
            raise PhotonCliError(proc.stderr.decode("utf-8", "replace").strip() or "Photon CLI 无法执行")
        return proc.stdout.decode("utf-8", "replace").strip()

    def is_available(self) -> bool:
        try:
            self.version()
            return True
        except Exception:
            return False

    def list_sessions(self) -> list:
        return self._run(["session", "list"], timeout=120).get("result") or []

    def open_document(self, psd_path: Path) -> dict:
        return self._run(
            ["session", "open", "--params", json.dumps({"path": str(psd_path)}, ensure_ascii=False)],
            timeout=self.default_timeout,
        ).get("result") or {}

    def close_documents_for_path(self, psd_path: Path) -> int:
        """关掉同一 PSD 的残留会话。

        Photon 对已打开的文件会直接复用原文档（含未保存的替换结果），
        所以每次出图前必须先丢弃旧会话，保证模板是干净的。
        """
        try:
            listing = self.list_sessions()
        except PhotonCliError as exc:
            print(f"    ⚠️ 读取 Photon 会话列表失败: {exc}")
            return 0

        target = Path(psd_path)
        closed = 0
        for session in listing:
            for doc in session.get("documents") or []:
                file_path = str(doc.get("filePath") or "")
                if not file_path:
                    continue
                try:
                    same = Path(file_path).resolve() == target.resolve()
                except OSError:
                    same = file_path == str(target)
                if not same:
                    continue
                try:
                    self.close_document(doc.get("id"), doc.get("revision"), disposition="discard")
                    closed += 1
                except PhotonCliError as exc:
                    print(f"    ⚠️ 清理残留 Photon 会话失败（{doc.get('id')}）: {exc}")
        return closed

    def inspect(self, document_id: str) -> dict:
        return self._run(["inspect", "--document", document_id], timeout=self.default_timeout).get("result") or {}

    def execute(self, operation: str, params: dict, document_id: str, revision: Optional[int] = None) -> dict:
        args = ["execute", operation, "--params", json.dumps(params, ensure_ascii=False), "--document", document_id]
        if revision is not None:
            args += ["--revision", str(revision)]
        return self._run(args, timeout=self.default_timeout)

    def render(
        self,
        document_id: str,
        out_path: Path,
        layer_id: Optional[str] = None,
        rect: Optional[dict] = None,
        max_edge: Optional[int] = None,
        revision: Optional[int] = None,
    ) -> dict:
        params: dict = {"path": str(out_path)}
        if layer_id:
            params["layerId"] = layer_id
        if rect:
            params["rect"] = rect
        if max_edge:
            params["maxEdge"] = int(max_edge)
        args = ["render", "--params", json.dumps(params, ensure_ascii=False), "--document", document_id]
        if revision is not None:
            args += ["--revision", str(revision)]
        return self._run(args, timeout=self.default_timeout)

    def close_document(self, document_id: str, revision: Optional[int], disposition: str = "discard") -> dict:
        args = [
            "session",
            "close",
            "--document",
            document_id,
            "--params",
            json.dumps({"disposition": disposition}),
        ]
        if revision is not None:
            args += ["--revision", str(revision)]
        return self._run(args, timeout=300)
