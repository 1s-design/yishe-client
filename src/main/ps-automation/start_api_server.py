"""
启动 API 服务器的入口文件
支持直接运行和 Docker 容器运行
"""
import os
import sys
import logging
from pathlib import Path

# 添加项目路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# 导入 API 服务
from src.api_server import app
import uvicorn


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


if __name__ == "__main__":
    # 从环境变量获取配置，或使用默认值
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 1595))
    
    # 启动服务
    configure_access_log_filter()
    print(f"PS 自动化端启动中: http://{host}:{port}", flush=True)
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="warning"
    )
