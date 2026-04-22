# 快速开始

## 运行方式选择

### 方式 A：容器运行（推荐）

更好的隔离性和稳定性。

```bash
cd /Users/jiangyi/Documents/codedev

# 1. 构建镜像
./scripts/build-container.sh

# 2. 启动容器
./scripts/run-container.sh
```

访问 http://localhost:8091 查看 Web 界面。

查看日志：
```bash
podman logs -f openclaw-plugin-manager
```

### 方式 B：原生运行

快速测试，无需构建镜像。

```bash
cd /Users/jiangyi/Documents/codedev
./scripts/test-run.sh
```

按 `Ctrl+C` 停止。

---

## 2. 集成到 OpenClaw

### 步骤 1：备份原配置

```bash
cp ~/.openclaw/workspace/config/mcporter.json \
   ~/.openclaw/workspace/config/mcporter.backup.json
```

### 步骤 2：配置 OpenClaw

根据你选择的运行方式配置。

**容器运行**：

编辑 `~/.openclaw/workspace/config/mcporter.json`：

```json
{
  "mcpServers": {
    "plugin-manager": {
      "command": "/Users/jiangyi/Documents/codedev/scripts/openclaw-wrapper.sh"
    }
  },
  "imports": []
}
```

**原生运行**：

```json
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
```

### 步骤 3：迁移 MCP 配置

将原来 `mcporter.backup.json` 中的 MCP 配置迁移到 `/Users/jiangyi/Documents/codedev/config/config.yaml`。

**示例**：

原 OpenClaw 配置：
```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": ["chrome-devtools-mcp@latest", "--browserUrl=http://127.0.0.1:18800"]
  }
}
```

迁移到 Plugin Manager 配置：
```yaml
mcps:
  chrome-devtools:
    type: stdio
    enabled: true
    command: npx
    args: [chrome-devtools-mcp@latest, --browserUrl=http://127.0.0.1:18800]
    healthCheck:
      type: process
      interval: 30
    maxRestarts: 3
```

### 步骤 4：重启 OpenClaw

```bash
openclaw gateway restart
```

### 步骤 5：验证

访问 http://localhost:8091，应该看到所有 MCP 的状态。

在 OpenClaw 中测试工具调用是否正常。

---

## 3. 回滚

如果出现问题，恢复原配置：

```bash
cp ~/.openclaw/workspace/config/mcporter.backup.json \
   ~/.openclaw/workspace/config/mcporter.json

openclaw gateway restart
```

---

## 常用命令

### 查看日志

```bash
# Plugin Manager 日志
tail -f /tmp/openclaw-plugin-manager/combined.log

# OpenClaw 日志
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
```

### 检查进程

```bash
ps aux | grep openclaw-plugin-manager
```

### 访问 Web 界面

http://localhost:8091

### API 测试

```bash
# 状态
curl http://localhost:8091/api/status

# MCP 列表
curl http://localhost:8091/api/mcps

# 健康检查
curl http://localhost:8091/api/health
```

---

## 下一步

详细文档：
- 完整说明：[README.md](README.md)
- OpenClaw 集成：[docs/openclaw-integration.md](docs/openclaw-integration.md)
- 架构设计：[docs/architecture.md](docs/architecture.md)
