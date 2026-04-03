#!/bin/bash

echo "🚀 开始打包 Linux 版本..."

# 检查是否在 Linux 环境下
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "✅ 检测到 Linux 环境"
else
    echo "⚠️  当前不是 Linux 环境，但可以尝试打包"
fi

# 清理之前的构建
echo "🧹 清理之前的构建..."
rm -rf out/
rm -rf release/

# 安装依赖
echo "📦 安装依赖..."
npm install

# 构建应用
echo "🔨 构建应用..."
npm run build

# 检查构建是否成功
if [ ! -d "out" ]; then
    echo "❌ 构建失败，out 目录不存在"
    exit 1
fi

echo "✅ 应用构建成功"

# 打包 Linux 版本
echo "📦 开始打包 Linux 版本..."
npm run build:linux

# 检查打包结果
if [ -d "release" ]; then
    echo "✅ Linux 版本打包成功！"
    echo "📁 输出目录: release/"
    echo "📋 生成的文件:"
    ls -la release/
else
    echo "❌ 打包失败"
    exit 1
fi

echo ""
echo "🎉 Linux 版本打包完成！"
echo "📦 支持的格式:"
echo "   - AppImage (推荐，无需安装)"
echo "   - .deb (Ubuntu/Debian)"
echo "   - .rpm (CentOS/RHEL/Fedora)"
echo "   - .snap (Snap 包)"
echo ""
echo "�� 文件位置: release/ 目录" 