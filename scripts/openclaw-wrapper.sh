#!/bin/bash
# Plugin Manager stdio wrapper
# 让 OpenClaw / Cursor / Claude Code / Codex 通过 stdio 接入容器内的 Plugin Manager

set -e

CONTAINER_NAME="${CLAW_PLUGIN_MANAGER_CONTAINER:-claw-plugin-manager}"

if ! podman ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container $CONTAINER_NAME is not running" >&2
    echo "Start it from claw_manager:" >&2
    echo "  cd ~/Documents/codedev/claw_manager && podman-compose up -d ${CONTAINER_NAME}" >&2
    exit 1
fi

exec podman exec -i "$CONTAINER_NAME" \
    node /app/src/index.js --stdio --config=/app/config/config.yaml
