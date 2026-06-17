#!/bin/bash
# 自动部署脚本 - 在Linux上执行

cd /home/openclaw/apps/server

# 拉取最新代码
git pull origin master

# 安装依赖
npm install

# 初始化数据库
mkdir -p data
if [ ! -f data/exam.db ]; then
    echo "初始化数据库..."
    # 数据库会在服务启动时自动初始化
fi

# 重启服务
pm2 restart exam-system || pm2 start src/index.js --name exam-system

echo "部署完成！"
