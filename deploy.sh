#!/bin/bash

# 兴利汽车模具 - 考试报餐系统 - 完整部署脚本
# 这个脚本可以在 Windows 和 Linux 上运行

set -e

echo "=========================================="
echo "兴利汽车模具 - 考试报餐系统"
echo "完整部署脚本"
echo "=========================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    echo "请先安装 Node.js 14+"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm"
    exit 1
fi

echo "✅ npm 版本: $(npm --version)"

# 进入项目目录
cd "$(dirname "$0")"

echo ""
echo "📦 安装依赖..."
npm install

echo ""
echo "🗄️  初始化数据库..."

# 检查 sqlite3 命令
if command -v sqlite3 &> /dev/null; then
    echo "✅ 找到 sqlite3 命令"
    sqlite3 data/exam.db < data/init-exam.sql
    sqlite3 data/exam.db < data/init-voting-meal.sql
    sqlite3 data/exam.db < data/init-staff-task-settings.sql
    echo "✅ 数据库初始化完成"
else
    echo "⚠️  未找到 sqlite3 命令，数据库将在启动时自动初始化"
fi

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "启动服务:"
echo "  npm start"
echo ""
echo "访问系统:"
echo "  http://localhost:3000/dashboard.html"
echo ""
echo "默认账户:"
echo "  用户名: admin"
echo "  密码: admin123"
echo ""
