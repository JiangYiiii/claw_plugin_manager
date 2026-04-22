#!/bin/bash
# 构建容器镜像

set -e

cd "$(dirname "$0")/.."

echo "Building OpenClaw Plugin Manager container..."

podman build -t openclaw-plugin-manager:latest .

echo ""
echo "✓ Build complete!"
echo ""
echo "Image: openclaw-plugin-manager:latest"
echo "Run with: ./scripts/run-container.sh"
