#!/bin/bash
# OpenClaw MCP 迁移脚本
# 将所有 MCP 从 OpenClaw 迁移到 Plugin Manager

set -e

OPENCLAW_CONFIG="$HOME/.openclaw/workspace/config/mcporter.json"
PLUGIN_MANAGER_DIR="/Users/jiangyi/Documents/codedev"
BACKUP_DIR="$HOME/.openclaw/backups/mcporter"

echo "=========================================="
echo "OpenClaw MCP 迁移到 Plugin Manager"
echo "=========================================="
echo ""

# 1. 备份原配置
echo "步骤 1: 备份原配置..."
mkdir -p "$BACKUP_DIR"
cp "$OPENCLAW_CONFIG" "$BACKUP_DIR/mcporter-$(date +%Y%m%d-%H%M%S).json"
echo "✓ 备份完成: $BACKUP_DIR"
echo ""

# 2. 停止 OpenClaw Gateway（避免冲突）
echo "步骤 2: 停止 OpenClaw Gateway..."
openclaw gateway stop 2>/dev/null || echo "⚠️  Gateway 未运行"
sleep 2
echo ""

# 3. 停止当前 Plugin Manager（如果在运行）
echo "步骤 3: 停止现有 Plugin Manager..."
pkill -f "openclaw-plugin-manager" 2>/dev/null || echo "⚠️  Plugin Manager 未运行"
sleep 2
echo ""

# 4. 切换到完整配置
echo "步骤 4: 切换配置文件..."
cd "$PLUGIN_MANAGER_DIR"
cp config/config-full.yaml config/config.yaml
echo "✓ 已启用完整配置（23个 MCP）"
echo ""

# 5. 创建新的 OpenClaw 配置
echo "步骤 5: 创建新的 OpenClaw 配置..."
cat > "$OPENCLAW_CONFIG" <<'EOF'
{
  "mcpServers": {
    "plugin-manager": {
      "command": "node",
      "args": [
        "/Users/jiangyi/Documents/codedev/src/index.js",
        "--config=/Users/jiangyi/Documents/codedev/config/config.yaml"
      ]
    }
  },
  "imports": []
}
EOF
echo "✓ OpenClaw 配置已更新"
echo ""

# 6. 启动 Plugin Manager
echo "步骤 6: 启动 Plugin Manager..."
cd "$PLUGIN_MANAGER_DIR"
WEB_ONLY_MODE=true node src/index.js --config=config/config.yaml > /tmp/plugin-manager-migrate.log 2>&1 &
PLUGIN_PID=$!
echo "✓ Plugin Manager 已启动 (PID: $PLUGIN_PID)"
sleep 5
echo ""

# 7. 验证
echo "步骤 7: 验证迁移..."
if curl -s http://localhost:8091/api/status > /dev/null; then
    echo "✓ Web 界面可访问: http://localhost:8091"

    # 统计 MCP 数量
    RUNNING=$(curl -s http://localhost:8091/api/mcps | grep -o '"status":"running"' | wc -l)
    echo "✓ 运行中的 MCP: $RUNNING 个"
else
    echo "❌ Web 界面无法访问"
    echo "查看日志: tail -f /tmp/plugin-manager-migrate.log"
    exit 1
fi
echo ""

# 8. 启动 OpenClaw
echo "步骤 8: 启动 OpenClaw Gateway..."
openclaw gateway start
sleep 5
echo ""

echo "=========================================="
echo "迁移完成！"
echo "=========================================="
echo ""
echo "Web 管理界面: http://localhost:8091"
echo "OpenClaw 日志: tail -f /tmp/openclaw/openclaw-\$(date +%Y-%m-%d).log"
echo "Plugin Manager 日志: tail -f /tmp/openclaw-plugin-manager/combined.log"
echo ""
echo "如需回滚:"
echo "  cp $BACKUP_DIR/mcporter-*.json $OPENCLAW_CONFIG"
echo "  openclaw gateway restart"
