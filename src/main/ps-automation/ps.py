"""
PSD 智能对象替换 API 服务启动入口
项目根目录启动脚本
"""

import os
import sys
import logging
import uvicorn
from pathlib import Path
import psutil

# 设置标准输出和错误输出为 UTF-8 编码，避免 Windows GBK 编码问题
if sys.platform == 'win32':
    # 重新配置标准输出和错误输出为 UTF-8
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    # 设置环境变量
    os.environ['PYTHONIOENCODING'] = 'utf-8'

# 添加项目路径
# PyInstaller 打包后的路径处理
if getattr(sys, 'frozen', False):
    # 打包后的可执行文件
    project_root = Path(sys.executable).parent
    persistent_root = Path(sys.executable).parent
    # 如果是单文件模式，需要特殊处理
    if hasattr(sys, '_MEIPASS'):
        # PyInstaller 临时目录
        project_root = Path(sys._MEIPASS)
else:
    # 开发模式
    project_root = Path(__file__).parent
    persistent_root = project_root

sys.path.insert(0, str(project_root))

# 记录 PID 的文件路径，放在 exe 同级目录（或源码目录）
PID_FILE = persistent_root / "yishe-ps.pid"


class NoisyAccessLogFilter(logging.Filter):
    """隐藏高频状态探测成功访问日志，避免控制台刷屏。"""

    quiet_paths = ("/health", "/photoshopStatus")

    def filter(self, record):
        try:
            args = record.args if isinstance(record.args, tuple) else ()
            if len(args) >= 5:
                path = str(args[2] or "").split("?", 1)[0]
                status_code = str(args[4] or "")
                if path in self.quiet_paths and status_code.startswith("2"):
                    return False

            message = record.getMessage()
        except Exception:
            return True

        if not ('" 2' in message and " HTTP/" in message):
            return True

        return not any(f" {path}" in message for path in self.quiet_paths)


def configure_access_log_filter():
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, NoisyAccessLogFilter) for item in logger.filters):
        logger.addFilter(NoisyAccessLogFilter())


def write_pid():
    """写入当前进程 PID，方便后续 stop 命令使用"""
    try:
        PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    except Exception:
        # 不因 PID 文件失败而影响服务启动
        pass


def read_pid():
    """读取 pid 文件"""
    if PID_FILE.exists():
        try:
            return int(PID_FILE.read_text().strip())
        except Exception:
            return None
    return None


def clear_pid():
    """删除 pid 文件"""
    try:
        if PID_FILE.exists():
            PID_FILE.unlink()
    except Exception:
        pass


def stop_running_instance():
    """尝试停止已运行的服务"""
    pid = read_pid()
    if not pid:
        print("未找到运行中的服务（缺少 pid 文件）")
        return

    try:
        p = psutil.Process(pid)
    except psutil.NoSuchProcess:
        print(f"进程 {pid} 不存在，清理 pid 文件")
        clear_pid()
        return

    # 仅针对同一可执行文件/脚本的进程做校验，避免误杀
    try:
        exe_path = Path(p.exe()) if p.exe() else None
        current_exe = Path(sys.executable)
        if exe_path and current_exe and exe_path.name != current_exe.name:
            print(f"发现 pid {pid} 不是当前服务，已跳过")
            return
    except Exception:
        # 如果取 exe 失败，不阻塞后续终止逻辑
        pass

    print(f"正在停止服务 (pid={pid}) ...")
    p.terminate()
    try:
        p.wait(timeout=10)
        print("服务已停止")
    except psutil.TimeoutExpired:
        print("正常停止超时，尝试强制结束")
        p.kill()
        print("服务已强制结束")
    finally:
        clear_pid()


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="启动 PSD 智能对象替换 API 服务",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python start_api_server.py                    # 默认端口 1595
  python start_api_server.py --port 8080        # 自定义端口
  python start_api_server.py --reload            # 开发模式（自动重载）
  python start_api_server.py --host 127.0.0.1   # 仅本地访问
        """
    )
    parser.add_argument(
        "--host",
        type=str,
        default="localhost",
        help="服务主机地址（默认: localhost，只监听本地回环接口，更安全）"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=1595,
        help="服务端口（默认: 1595）"
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="启用自动重载（开发模式，代码修改后自动重启）"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="工作进程数（默认: 1，注意：Photoshop 不支持多进程，建议保持为 1）"
    )
    parser.add_argument(
        "--stop",
        action="store_true",
        help="停止已启动的服务（通过 pid 文件定位进程）"
    )
    
    args = parser.parse_args()
    # 如果是 stop 命令，直接尝试停止并退出
    if args.stop:
        stop_running_instance()
        return
    
    # 警告：多个工作进程可能导致 Photoshop 连接问题
    if args.workers > 1:
        print("警告: 多个工作进程可能导致 Photoshop 连接问题")
        print("   建议使用 workers=1（单进程模式）")
        print()
        # 强制使用单进程
        args.workers = 1
    
    # 启动服务
    try:
        print(f"PS 自动化端启动中: http://{args.host}:{args.port}", flush=True)
        
        configure_access_log_filter()
        write_pid()
        
        # 使用 uvicorn.run 启动服务（会阻塞直到服务停止）
        if getattr(sys, 'frozen', False):
            # 打包后的环境：需要先导入 app 对象
            try:
                from src.api_server import app
            except ImportError as e:
                # 如果相对导入失败，尝试绝对导入
                import importlib.util
                base_path = Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else project_root
                api_server_path = base_path / "src" / "api_server.py"
                
                if api_server_path.exists():
                    spec = importlib.util.spec_from_file_location("api_server", api_server_path)
                    api_server = importlib.util.module_from_spec(spec)
                    sys.modules["api_server"] = api_server
                    spec.loader.exec_module(api_server)
                    app = api_server.app
                else:
                    raise ImportError(f"Cannot find api_server.py: {api_server_path}") from e
            
            # 打包后的 exe 不支持 reload 模式，强制禁用
            args.reload = False
            if args.workers > 1:
                args.workers = 1
            
            # 打包后：直接使用 app 对象
            uvicorn.run(
                app,
                host=args.host,
                port=args.port,
                reload=False,  # 打包后不支持 reload
                workers=args.workers,
                log_level="warning",
                access_log=True
            )
        else:
            # 开发模式：使用字符串路径（支持 reload，这是原来的方式）
            uvicorn.run(
                "src.api_server:app",  # 字符串路径，支持 reload
                host=args.host,
                port=args.port,
                reload=args.reload,
                workers=args.workers if not args.reload else 1,
                log_level="warning",
                access_log=True
            )
    except KeyboardInterrupt:
        print("\n\n收到停止信号，正在关闭服务...")
        print("服务已停止")
        # 等待一下让用户看到消息
        import time
        time.sleep(1)
    except Exception as e:
        print(f"\n\n启动服务失败: {e}")
        import traceback
        traceback.print_exc()
        print("\n按任意键退出...")
        try:
            input()
        except:
            import time
            time.sleep(5)  # 等待5秒让用户看到错误信息
        sys.exit(1)
    finally:
        clear_pid()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        # 用户按 Ctrl+C，正常退出
        print("\n\n服务已停止")
        sys.exit(0)
    except Exception as e:
        print(f"\n\n严重错误: {e}")
        import traceback
        traceback.print_exc()
        print("\n按任意键退出...")
        try:
            input()
        except:
            import time
            time.sleep(5)  # 等待5秒让用户看到错误信息
        sys.exit(1)
