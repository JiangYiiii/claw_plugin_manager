#!/bin/bash
# 运行容器

set -e

CONTAINER_NAME="openclaw-plugin-manager"
CONFIG_DIR="$(cd "$(dirname "$0")/.." && pwd)/config"

# 停止并删除已存在的容器
if podman ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping existing container..."
    podman stop "$CONTAINER_NAME" 2>/dev/null || true
    podman rm "$CONTAINER_NAME" 2>/dev/null || true
fi

echo "Starting OpenClaw Plugin Manager container..."
echo "Config directory: $CONFIG_DIR"
echo ""

podman run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -v "$CONFIG_DIR:/config:ro" \
    -p 8091:8091 \
    --add-host host.containers.internal:host-gateway \
    openclaw-plugin-manager:latest

echo ""
echo "✓ Container started!"
echo ""
echo "Container name: $CONTAINER_NAME"
echo "Web UI: http://localhost:8091"
echo ""
echo "Useful commands:"
echo "  View logs:    podman logs -f $CONTAINER_NAME"
echo "  Stop:         podman stop $CONTAINER_NAME"
echo "  Restart:      podman restart $CONTAINER_NAME"
echo "  Shell:        podman exec -it $CONTAINER_NAME /bin/bash"
