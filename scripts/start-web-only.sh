#!/bin/bash
# 只启动 Web 服务器（用于测试）

cd "$(dirname "$0")/.."

echo "Starting OpenClaw Plugin Manager (Web Only Mode)..."
echo "Web UI: http://localhost:8091"
echo ""

# 设置环境变量，让程序以 HTTP 模式运行
export WEB_ONLY_MODE=true

node src/index.js --config=config/config.yaml
