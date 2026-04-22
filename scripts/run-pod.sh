#!/bin/bash
# 使用 Pod 方式运行（可扩展添加更多容器）

set -e

POD_NAME="openclaw-plugin-manager-pod"
CONTAINER_NAME="openclaw-plugin-manager"
CONFIG_DIR="$(cd "$(dirname "$0")/.." && pwd)/config"

# 删除已存在的 Pod
if podman pod exists "$POD_NAME"; then
    echo "Removing existing pod..."
    podman pod stop "$POD_NAME" 2>/dev/null || true
    podman pod rm "$POD_NAME" 2>/dev/null || true
fi

echo "Creating pod: $POD_NAME"

# 创建 Pod（暴露端口 8091）
podman pod create \
    --name "$POD_NAME" \
    -p 8091:8091

echo "Starting Plugin Manager container in pod..."

# 在 Pod 中启动容器
podman run -d \
    --pod "$POD_NAME" \
    --name "$CONTAINER_NAME" \
    -v "$CONFIG_DIR:/config:ro" \
    openclaw-plugin-manager:latest

echo ""
echo "✓ Pod started!"
echo ""
echo "Pod name: $POD_NAME"
echo "Container: $CONTAINER_NAME"
echo "Web UI: http://localhost:8091"
echo ""
echo "Useful commands:"
echo "  View logs:    podman logs -f $CONTAINER_NAME"
echo "  Pod status:   podman pod ps"
echo "  Stop pod:     podman pod stop $POD_NAME"
echo "  Restart pod:  podman pod restart $POD_NAME"
echo "  Remove pod:   podman pod rm -f $POD_NAME"
echo "  Shell:        podman exec -it $CONTAINER_NAME /bin/bash"
