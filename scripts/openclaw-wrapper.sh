#!/bin/bash
# OpenClaw 调用包装脚本
# 通过 stdio 与容器中的 Plugin Manager 通信

set -e

CONTAINER_NAME="openclaw-plugin-manager"

# 检查容器是否运行
if ! podman ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container $CONTAINER_NAME is not running" >&2
    echo "Please start it first: ./scripts/run-container.sh" >&2
    exit 1
fi

# 通过 stdin/stdout 与容器通信
exec podman exec -i "$CONTAINER_NAME" node /app/src/index.js --config=/config/config.yaml
