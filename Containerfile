FROM node:20-slim

# 安装必要的工具
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package.json 并安装依赖
COPY package*.json ./
RUN npm install --production

# 复制源码
COPY src/ ./src/

# 创建日志目录
RUN mkdir -p /var/log/openclaw-plugin-manager

# 暴露端口
EXPOSE 8091

# 设置环境变量
ENV NODE_ENV=production \
    LOG_DIR=/var/log/openclaw-plugin-manager

ENTRYPOINT ["node", "/app/src/index.js"]
CMD ["--config=/config/config.yaml"]
