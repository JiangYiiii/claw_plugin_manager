# OpenClaw 接入指南

本文档说明如何将 OpenClaw Plugin Manager 集成到 OpenClaw 中。

## 集成方式

OpenClaw Plugin Manager 作为**单个 MCP 服务器**接入 OpenClaw，由它负责管理所有后端 MCP。

```
┌─────────────────┐
│   OpenClaw      │
│   Gateway       │
└────────┬────────┘
         │ 单个 MCP 连接
         │
         ▼
┌─────────────────────────┐
│ OpenClaw Plugin Manager │  ← stdio 接口
├─────────────────────────┤
│  • chrome-devtools (stdio)
│  • tapd (HTTP)
│  • llamaindex (stdio)
│  • ... 其他 MCP
└─────────────────────────┘
```

## 步骤 1：安装 Plugin Manager

```bash
cd /Users/jiangyi/Documents/codedev
npm install
```

## 步骤 2：创建配置文件

从示例配置开始：

```bash
cp config/config.example.yaml config/config.yaml
```

根据你的需求编辑 `config/config.yaml`：

```yaml
server:
  mode: stdio              # 必须是 stdio，这样 OpenClaw 才能通过 stdio 协议通信
  webPort: 8091           # Web 管理界面端口（不影响 OpenClaw）
  logLevel: info
  logDir: /tmp/openclaw-plugin-manager

mcps:
  # 配置你的 MCP 服务器
  chrome-devtools:
    type: stdio
    enabled: true
    command: npx
    args: [chrome-devtools-mcp@latest, --browserUrl=http://127.0.0.1:18800]
    healthCheck:
      type: process
      interval: 30
    maxRestarts: 3
    restartDelay: 5

  tapd:
    type: http
    enabled: true
    baseUrl: https://mcp.fintopia.tech/tapd-mcp
    headers:
      Authorization: Bearer ${TAPD_TOKEN}
    timeout: 10000
    healthCheck:
      type: http
      endpoint: /health
      interval: 60
```

## 步骤 3：配置 OpenClaw

### 方式 A：完全替换（推荐）

将所有 MCP 配置迁移到 Plugin Manager，OpenClaw 只配置 Plugin Manager。

**备份原配置**：

```bash
cp ~/.openclaw/workspace/config/mcporter.json \
   ~/.openclaw/workspace/config/mcporter.backup.json
```

**编辑 `~/.openclaw/workspace/config/mcporter.json`**：

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

### 方式 B：混合模式

部分 MCP 由 Plugin Manager 管理，部分保持原样。

```json
{
  "mcpServers": {
    "plugin-manager": {
      "command": "node",
      "args": [
        "/Users/jiangyi/Documents/codedev/src/index.js",
        "--config=/Users/jiangyi/Documents/codedev/config/config.yaml"
      ]
    },
    "filesystem": {
      "command": "npx"
    },
    "sqlite": {
      "command": "npx"
    }
  }
}
```

**注意**：混合模式下，需要确保工具名不冲突。

## 步骤 4：设置环境变量（可选）

如果配置文件中使用了环境变量（如 `${TAPD_TOKEN}`），需要设置：

```bash
# 在 ~/.zshrc 或 ~/.bashrc 中添加
export TAPD_TOKEN="your_token_here"

# 重新加载
source ~/.zshrc
```

## 步骤 5：重启 OpenClaw Gateway

```bash
openclaw gateway restart
```

## 步骤 6：验证集成

### 检查 OpenClaw 日志

```bash
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep -i plugin-manager
```

应该看到类似输出：

```
[gateway] Starting MCP: plugin-manager
[gateway/mcp] plugin-manager connected
[gateway/mcp] plugin-manager reported 156 tools
```

### 检查 Plugin Manager 日志

```bash
tail -f /tmp/openclaw-plugin-manager/combined.log
```

应该看到：

```
OpenClaw Plugin Manager Starting
Starting MCP chrome-devtools: npx chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:18800
MCP chrome-devtools started successfully
MCP chrome-devtools capabilities: 12 tools, 0 resources, 0 prompts
Connecting to HTTP MCP tapd: https://mcp.fintopia.tech/tapd-mcp
HTTP MCP tapd connected successfully
Routing table built: 156 tools, 2 resource schemes, 5 prompts
Starting health monitor
Web server started on http://localhost:8091
Starting MCP stdio server
```

### 访问 Web 界面

打开浏览器访问：http://localhost:8091

你应该看到：
- Dashboard 显示运行中的 MCP 数量
- MCP 列表显示所有配置的 MCP 及其状态
- 可以点击"Restart"重启单个 MCP

### 测试 MCP 功能

在 OpenClaw 中测试一个工具调用，例如：

```bash
# 通过 OpenClaw Web UI 或 API 调用工具
# 应该能正常工作
```

## 常见问题

### Q1: OpenClaw 启动后 Plugin Manager 没有运行

**检查**：

```bash
ps aux | grep openclaw-plugin-manager
```

**原因**：可能是配置路径错误或依赖未安装。

**解决**：

```bash
# 确认路径正确
ls /Users/jiangyi/Documents/codedev/src/index.js

# 确认依赖已安装
cd /Users/jiangyi/Documents/codedev && npm install

# 手动测试启动
node /Users/jiangyi/Documents/codedev/src/index.js \
  --config=/Users/jiangyi/Documents/codedev/config/config.yaml
```

### Q2: 某个 MCP 一直重启失败

**查看详情**：

访问 http://localhost:8091，查看该 MCP 的状态。

**查看日志**：

```bash
tail -f /tmp/openclaw-plugin-manager/error.log | grep "mcp-name"
```

**解决方法**：

1. 检查该 MCP 的配置（command、args）
2. 手动运行该 MCP 命令测试
3. 临时禁用该 MCP：在 Web 界面点击"Disable"或修改 `config.yaml` 设置 `enabled: false`

### Q3: 工具调用失败，提示找不到工具

**原因**：路由表未正确构建或 MCP 未启动。

**检查路由表**：

访问 http://localhost:8091/api/status，查看：

```json
{
  "routing": {
    "tools": 156,    // 工具数量
    "resources": 2,
    "prompts": 5
  }
}
```

**重新构建路由**：

在 Web 界面重启相关 MCP，路由表会自动重建。

### Q4: Web 界面无法访问

**检查端口**：

```bash
lsof -i :8091
```

**更改端口**：

修改 `config/config.yaml`：

```yaml
server:
  webPort: 8092  # 改为其他端口
```

重启 OpenClaw Gateway。

### Q5: 如何添加新的 MCP？

**方法 1：编辑配置文件（推荐）**

1. 编辑 `config/config.yaml`，添加新 MCP：

```yaml
mcps:
  new-mcp:
    type: stdio
    enabled: true
    command: npx
    args: [new-mcp-package@latest]
```

2. 重启 OpenClaw Gateway：

```bash
openclaw gateway restart
```

**方法 2：热加载（未来版本）**

通过 API 动态添加：

```bash
curl -X POST http://localhost:8091/api/mcps \
  -H "Content-Type: application/json" \
  -d '{
    "name": "new-mcp",
    "type": "stdio",
    "enabled": true,
    "command": "npx",
    "args": ["new-mcp-package@latest"]
  }'
```

（目前暂不支持，需要重启）

### Q6: 如何回滚到原来的配置？

```bash
# 恢复备份
cp ~/.openclaw/workspace/config/mcporter.backup.json \
   ~/.openclaw/workspace/config/mcporter.json

# 重启 Gateway
openclaw gateway restart
```

## 高级配置

### 调整健康检查频率

```yaml
mcps:
  chrome-devtools:
    healthCheck:
      interval: 60  # 改为 60 秒（默认 30 秒）
```

### 调整最大重启次数

```yaml
mcps:
  chrome-devtools:
    maxRestarts: 5     # 改为 5 次（默认 3 次）
    restartDelay: 10   # 重启间隔 10 秒（默认 5 秒）
```

### 禁用某个 MCP

```yaml
mcps:
  llamaindex:
    enabled: false  # 禁用
```

### 自定义日志目录

```yaml
server:
  logDir: /Users/jiangyi/.openclaw/plugin-manager/logs
```

### 调整 HTTP 超时

```yaml
mcps:
  tapd:
    timeout: 30000  # 30 秒（默认 10 秒）
```

## 性能优化

### 减少健康检查频率

对于稳定的 HTTP MCP，可以降低检查频率：

```yaml
mcps:
  tapd:
    healthCheck:
      interval: 300  # 5 分钟检查一次
```

### 禁用不需要的 MCP

注释掉或设置 `enabled: false`。

### 调整日志级别

生产环境使用 `warn` 或 `error`：

```yaml
server:
  logLevel: warn
```

## 监控和维护

### 定期检查日志

```bash
# 错误日志
tail -100 /tmp/openclaw-plugin-manager/error.log

# 完整日志
tail -100 /tmp/openclaw-plugin-manager/combined.log
```

### 监控 Web 界面

定期访问 http://localhost:8091 检查：
- MCP 状态是否正常
- 重启次数是否异常增加
- 工具数量是否正确

### 清理旧日志

```bash
# 清理 7 天前的日志
find /tmp/openclaw-plugin-manager -name "*.log" -mtime +7 -delete
```

### 集成到现有健康检查

在 `~/.openclaw/maintenance/health-check.sh` 中添加：

```bash
check_plugin_manager() {
    log "检查 Plugin Manager..."
    
    # 检查进程
    if ! pgrep -f "openclaw-plugin-manager" > /dev/null; then
        alert "Plugin Manager 未运行"
        return 1
    fi
    
    # 检查 Web 接口
    if ! curl -s http://localhost:8091/api/health > /dev/null; then
        alert "Plugin Manager Web 接口异常"
        return 1
    fi
    
    log "✓ Plugin Manager 正常"
}
```

## 总结

OpenClaw Plugin Manager 提供了：

✅ **统一管理**：一个配置文件管理所有 MCP  
✅ **自动恢复**：MCP 崩溃自动重启  
✅ **实时监控**：Web 界面查看状态  
✅ **智能路由**：自动转发请求到正确的 MCP  
✅ **零侵入**：OpenClaw 只需改配置，无需改代码

遇到问题可查看：
- Plugin Manager 日志：`/tmp/openclaw-plugin-manager/`
- OpenClaw 日志：`/tmp/openclaw/`
- Web 界面：http://localhost:8091
