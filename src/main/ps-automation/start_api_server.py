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


class HealthAccessLogFilter(logging.Filter):
    """隐藏 /health 成功访问日志，避免健康检查刷屏。"""

    def filter(self, record):
        message = record.getMessage()
        return 'GET /health HTTP/1.1" 200' not in message


def configure_access_log_filter():
    logging.getLogger("uvicorn.access").addFilter(HealthAccessLogFilter())


if __name__ == "__main__":
    # 从环境变量获取配置，或使用默认值
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 1595))
    
    # 启动服务
    configure_access_log_filter()
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )
