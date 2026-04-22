#!/bin/bash
# 测试运行脚本

cd "$(dirname "$0")/.."

echo "Starting OpenClaw Plugin Manager (Test Mode)..."
echo "Web UI will be available at: http://localhost:8091"
echo ""
echo "Press Ctrl+C to stop"
echo ""

node src/index.js --config=config/config.yaml
