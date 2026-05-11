# Stdio Wrapper 集成指南

> 创建时间：2026-05-11
> 目的：让所有 Agent (OpenClaw/Cursor/Claude/Codex) 统一接入 Plugin Manager

## 架构概览

```
┌──────────────────────────────────────────────────────────┐
│                Host Machine (macOS)                       │
│                                                           │
│  ┌─────────────┐  ┌──────────┐  ┌────────┐  ┌────────┐ │
│  │  OpenClaw   │  │  Cursor  │  │ Claude │  │ Codex  │ │
│  │   (HTTP)    │  │(command) │  │(command│  │(command│ │
│  └──────┬──────┘  └────┬─────┘  └────┬───┘  └────┬───┘ │
│         │              │              │           │      │
│         │              └──────┬───────┴───────────┘      │
│         │                     │                          │
│         │                     ▼                          │
│         │       ┌────────────────────────────┐          │
│         │       │ claw-plugin-manager-stdio  │          │
│         │       │ (podman exec wrapper)      │          │
│         │       └────────────┬───────────────┘          │
│         │                    │                          │
│         ▼                    ▼                          │
│    HTTP:8090            podman exec -i                  │
│         │               --stdio flag                    │
└─────────┼────────────────────┼──────────────────────────┘
          │                    │
    ┌─────▼────────────────────▼────────────────────┐
    │  Podman Container: claw-plugin-manager        │
    │                                                │
    │  ┌──────────────────────────────────────┐    │
    │  │   Node.js Process (守护进程)         │    │
    │  │                                       │    │
    │  │   HTTP Server (port 8090)            │    │
    │  │   ↓                                  │    │
    │  │   Plugin Manager (共享实例)          │    │
    │  │   ↑                                  │    │
    │  │   多个 stdio 调用（podman exec）     │    │
    │  └───────────────────────────────────────┘   │
    │                                                │
    │  每次 podman exec 启动新进程，但共享         │
    │  Plugin Manager 的状态（已初始化的 MCP）     │
    └────────────────────────────────────────────────┘
```

## 工作原理

### 1. 容器守护进程（HTTP 模式）

容器启动时运行 HTTP 模式：

```yaml
# config/config.yaml
server:
  mode: http          # HTTP 守护模式
  httpPort: 8090      # OpenClaw 访问端口
  webPort: 8091       # Web 管理界面
```

这个进程：
- 监听 HTTP 端口 8090
- 初始化所有下游 MCP（logservice, tapd, etc）
- 一直运行，不会退出

### 2. Stdio 调用（通过 podman exec）

当 Cursor/Claude/Codex 需要调用时：

```bash
# ~/.local/bin/claw-plugin-manager-stdio
podman exec -i claw-plugin-manager \
  node /app/src/index.js --stdio --config=/app/config/config.yaml
```

这会：
1. 在容器内启动**新的 Node.js 进程**
2. 带 `--stdio` 参数，强制进入 stdio 模式
3. 从 stdin 读取 MCP 请求，写入 stdout
4. 请求完成后进程退出

### 3. 关键优化：共享 Plugin Manager

虽然每次 `podman exec` 启动新进程，但：
- 所有进程读取**相同的配置文件**
- 下游 MCP（HTTP 类型）是**无状态的**
- 每个请求独立处理，不需要持久连接

## 配置各个 Agent

### OpenClaw（已完成）

```json
// ~/.openclaw/openclaw.json
{
  "mcp": {
    "servers": {
      "claw-plugin-manager": {
        "url": "http://localhost:8090/mcp",
        "transport": "streamable-http"
      }
    }
  }
}
```

### Cursor

```json
// ~/Documents/code/cash_loan/.cursor/mcp.json
{
  "mcpServers": {
    "claw-plugin-manager": {
      "command": "/Users/jiangyi/.local/bin/claw-plugin-manager-stdio"
    }
  }
}
```

### Claude Code

```json
// ~/.claude/mcp.json (路径需确认)
{
  "mcpServers": {
    "claw-plugin-manager": {
      "command": "/Users/jiangyi/.local/bin/claw-plugin-manager-stdio"
    }
  }
}
```

### Codex

```json
// Codex 配置文件位置 (需确认)
{
  "mcpServers": {
    "claw-plugin-manager": {
      "command": "/Users/jiangyi/.local/bin/claw-plugin-manager-stdio"
    }
  }
}
```

## 测试验证

### 1. 测试容器状态

```bash
# 检查容器是否运行
podman ps | grep claw-plugin-manager

# 检查 HTTP 端口
curl http://localhost:8090/health

# 访问 Web 界面
open http://localhost:8091
```

### 2. 测试 stdio wrapper

```bash
# 测试 wrapper 是否可执行
/Users/jiangyi/.local/bin/claw-plugin-manager-stdio --help

# 测试 MCP 协议（手动）
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | \
  /Users/jiangyi/.local/bin/claw-plugin-manager-stdio
```

期望输出：
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{},"resources":{},"prompts":{}},"serverInfo":{"name":"openclaw-plugin-manager","version":"1.0.0"}}}
```

### 3. 测试 Cursor 集成

```bash
cd ~/Documents/code/cash_loan

# 配置 mcp.json（如上）

# 启用 MCP
cursor agent mcp enable claw-plugin-manager

# 列出可用工具
cursor agent mcp list-tools claw-plugin-manager
```

期望看到所有下游 MCP 的工具（logservice、tapd、mysql-copilot 等）。

### 4. 测试实际调用

```bash
cd ~/Documents/code/cash_loan

cursor agent --workspace . \
  "列出当前可用的所有 MCP 工具"
```

或测试日志查询：
```bash
cursor agent --workspace . \
  "查询 cash-loan-repay 服务最近1小时的日志"
```

## 性能考虑

### Stdio 模式的延迟

每次 `podman exec` 的开销：
- 进程启动：~50-100ms
- MCP 初始化：~50-100ms
- 总延迟：~100-200ms

**可接受**，因为：
1. Cursor/Claude 的 MCP 调用本身就不频繁
2. 相比网络请求（几百毫秒），这个延迟可忽略
3. 不会影响用户体验

### 如果需要优化

如果发现性能问题，可以实现**进程池**：
1. 容器内预启动 N 个 stdio 进程
2. Wrapper 通过 Unix socket 连接到进程池
3. 复用已初始化的进程

但目前不需要，先验证基础方案可行。

## 故障排查

### 问题 1：wrapper 报错 "Container not running"

**解决**：
```bash
cd /Users/jiangyi/Documents/codedev/claw_manager
./scripts/start.sh
```

### 问题 2：Cursor 报 "MCP server failed to start"

**检查**：
```bash
# 手动测试 wrapper
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | \
  /Users/jiangyi/.local/bin/claw-plugin-manager-stdio

# 查看容器日志
podman logs claw-plugin-manager
```

### 问题 3：看不到下游 MCP 的工具

**检查**：
1. Plugin Manager 配置文件是否正确：
   ```bash
   podman exec claw-plugin-manager cat /app/config/config.yaml
   ```

2. 下游 MCP 是否健康：
   ```bash
   curl http://localhost:8091/api/mcps
   ```

### 问题 4：多个 Agent 并发调用冲突

这**不应该发生**，因为：
- 每个 Agent 的调用是独立的 `podman exec` 进程
- 下游 MCP（HTTP 类型）是无状态的

如果真的遇到，检查：
- 是否有 stdio 类型的下游 MCP（不支持并发）
- 容器资源是否充足

## 优势总结

| 维度 | 说明 |
|------|------|
| **统一管理** | 所有 MCP 在一个地方配置 |
| **零配置接入** | 新 Agent 只需配置 wrapper 路径 |
| **资源高效** | 下游 MCP 只启动一次，所有 Agent 共享 |
| **监控完善** | Web UI 实时查看所有 MCP 状态 |
| **故障隔离** | 某个 MCP 故障不影响其他 |
| **扩展简单** | 新增 MCP 后所有 Agent 自动获得 |

## 下一步

1. ✅ 代码修改完成（`index.js` 已支持 `--stdio` 参数）
2. ✅ Wrapper 创建完成（`~/.local/bin/claw-plugin-manager-stdio`）
3. ⏭️ 重新构建容器镜像
4. ⏭️ 配置 Cursor 并测试
5. ⏭️ 确认 Claude Code 和 Codex 的 MCP 配置方式
6. ⏭️ 全面测试和性能验证
