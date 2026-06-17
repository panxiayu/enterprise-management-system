# 使用官方 Node.js Debian 镜像（保证 sqlite3 兼容性）
FROM node:18-slim

# 安装必要的系统工具
RUN apt-get update && apt-get install -y \
    sqlite3 \
    libsqlite3-dev \
    python3 \
    python3-pip \
    make \
    g++ \
    antiword \
    libreoffice \
    ffmpeg \
    poppler-utils \
    smbclient \
    tzdata \
    && pip3 install --break-system-packages msoffcrypto-tool \
    && rm -rf /var/lib/apt/lists/*

# 设置时区为上海
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && echo 'Asia/Shanghai' > /etc/timezone

# 设置工作目录
WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖（生产环境）
RUN npm install --production --unsafe-perm && npm cache clean --force

# 复制源码
COPY . .

# 复制前端静态文件
COPY public ./public

# 创建数据目录
RUN mkdir -p /app/data

# 初始化数据库（在容器启动时执行）
RUN if [ -f "data/init.sql" ]; then sqlite3 data/exam.db < data/init.sql; fi

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if(r.statusCode===200)process.exit(0);else process.exit(1)})"

# 启动命令
CMD ["node", "src/index.js"]
