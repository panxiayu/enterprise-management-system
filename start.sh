#!/bin/bash

# 兴利汽车模具 - 考试报餐系统 - 启动脚本
# 支持 Windows (Git Bash) 和 Linux

set -e

echo "=========================================="
echo "兴利汽车模具 - 考试报餐系统"
echo "启动脚本"
echo "=========================================="
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "📁 项目目录: $SCRIPT_DIR"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    echo "请先安装 Node.js 14+"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"
echo "✅ npm 版本: $(npm --version)"
echo ""

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
    echo "✅ 依赖安装完成"
    echo ""
fi

# 检查数据库
if [ ! -f "data/exam.db" ]; then
    echo "🗄️  初始化数据库..."
    mkdir -p data
    echo "✅ 数据库目录已创建"
    echo ""
fi

# 启动服务
echo "🚀 启动服务..."
echo ""
echo "=========================================="
echo "服务已启动！"
echo "=========================================="
echo ""
echo "📍 访问地址:"
echo "   http://localhost:3000/admin/login.html"
echo ""
echo "📝 默认账户:"
echo "   用户名: admin"
echo "   密码: admin123"
echo ""
echo "🛑 按 Ctrl+C 停止服务"
echo ""

npm start
