#!/bin/bash
# 打包浏览器自动化 Agent 为独立可执行文件
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== 安装 Python 依赖 ==="
if [ -d ".venv" ]; then
    source .venv/bin/activate
else
    python3 -m venv .venv
    source .venv/bin/activate
fi
pip install -r requirements.txt pyinstaller -q

echo "=== 使用 PyInstaller 打包 ==="
pyinstaller browser_agent.spec --clean --noconfirm

echo "=== 打包完成 ==="
ls -la dist/
