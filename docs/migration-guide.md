# OpenClaw MCP 迁移指南

## 当前状态

### OpenClaw 现有 MCP（23 个）

#### HTTP 远程服务（8 个）
1. tapd
2. logservice
3. qep
4. alert-oncall
5. ai-rag-api
6. feishu-mcp
7. sonarcube
8. infra-feishu-mcp

#### Stdio 进程服务（15 个）
9. chrome-devtools
10. llamaindex
11. server-sequential-thinking
12. desktop-commander
13. context7-mcp
14. docfork
15. exa
16. github
17. filesystem
18. postgres
19. sqlite
20. fetch
21. sequential-thinking
22. playwright
23. puppeteer

## 迁移方式

### 自动迁移（推荐）

一键迁移所有 MCP：

```bash
cd /Users/jiangyi/Documents/codedev
./scripts/migrate-from-openclaw.sh
```

脚本会自动：
1. ✅ 备份原配置
2. ✅ 停止 OpenClaw Gateway
3. ✅ 停止现有 Plugin Manager
4. ✅ 启用完整配置（23个 MCP）
5. ✅ 更新 OpenClaw 配置
6. ✅ 启动 Plugin Manager
7. ✅ 验证迁移结果
8. ✅ 重启 OpenClaw Gateway

### 手动迁移

#### 步骤 1：备份原配置

```bash
cp ~/.openclaw/workspace/config/mcporter.json \
   ~/.openclaw/workspace/config/mcporter.backup-$(date +%Y%m%d).json
```

#### 步骤 2：切换 Plugin Manager 配置

```bash
cd /Users/jiangyi/Documents/codedev
cp config/config-full.yaml config/config.yaml
```

#### 步骤 3：更新 OpenClaw 配置

编辑 `~/.openclaw/workspace/config/mcporter.json`：

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

#### 步骤 4：重启服务

```bash
# 停止现有 Plugin Manager（如果在运行）
pkill -f "openclaw-plugin-manager"

# 重启 OpenClaw
openclaw gateway restart
```

## 验证迁移

### 1. 检查 Web 界面

访问 http://localhost:8091

应该看到：
- Dashboard 显示 23 个 MCP
- MCP 列表显示所有服务的状态

### 2. 检查日志

```bash
# Plugin Manager 日志
tail -f /tmp/openclaw-plugin-manager/combined.log

# OpenClaw 日志
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
```

### 3. 测试工具调用

在 OpenClaw 中测试几个工具：
- 测试 tapd 工具
- 测试 chrome-devtools 工具
- 测试 filesystem 工具

## 配置说明

### 完整配置文件

位置：`/Users/jiangyi/Documents/codedev/config/config-full.yaml`

包含：
- 8 个 HTTP MCP（远程服务）
- 15 个 Stdio MCP（本地进程）

### 按需启用/禁用

编辑 `config/config.yaml`，设置 `enabled: false` 禁用某个 MCP：

```yaml
mcps:
  puppeteer:
    enabled: false  # 禁用
```

重启生效：

```bash
openclaw gateway restart
```

或在 Web 界面点击 "Disable" 按钮（需要后续手动同步配置文件）。

## 迁移前后对比

### 迁移前

```
OpenClaw Gateway
  ├── tapd (进程 1)
  ├── logservice (进程 2)
  ├── chrome-devtools (进程 3)
  ├── llamaindex (进程 4)
  ├── ... (19 个其他 MCP)
  └── 总计 23 个独立进程
```

**问题**：
- MCP 进程重复启动
- 单个 MCP 崩溃影响 Gateway
- 无统一管理界面
- 配置分散

### 迁移后

```
OpenClaw Gateway
  └── Plugin Manager (单个连接)
        ├── tapd (HTTP)
        ├── logservice (HTTP)
        ├── chrome-devtools (管理的子进程)
        ├── llamaindex (管理的子进程)
        └── ... (19 个其他 MCP)
```

**优势**：
- ✅ 统一管理（Web 界面）
- ✅ 自动健康检查和重启
- ✅ 智能路由
- ✅ 进程隔离（MCP 崩溃不影响 Gateway）
- ✅ 集中配置

## 性能影响

### 资源使用

**迁移前**：
- OpenClaw Gateway: ~100MB
- 23 个 MCP 进程: ~500-1000MB

**迁移后**：
- OpenClaw Gateway: ~100MB
- Plugin Manager: ~50MB
- 管理的 MCP 进程: ~500-1000MB

**总计差异**：增加 ~50MB（Plugin Manager 本身）

### 延迟影响

- **HTTP MCP**：无影响（直接转发）
- **Stdio MCP**：< 5ms（进程间通信）

## 故障排查

### Plugin Manager 无法启动

**查看日志**：

```bash
tail -f /tmp/openclaw-plugin-manager/error.log
```

**常见原因**：
- 配置文件错误
- 端口 8091 被占用
- Node.js 未安装

### OpenClaw 无法连接

**检查 Plugin Manager**：

```bash
ps aux | grep "openclaw-plugin-manager"
curl http://localhost:8091/api/status
```

**检查 OpenClaw 配置**：

```bash
cat ~/.openclaw/workspace/config/mcporter.json
```

### 某些 MCP 启动失败

**查看 Web 界面**：http://localhost:8091

找到失败的 MCP，查看错误信息。

**临时禁用**：

在 Web 界面点击 "Disable" 或编辑 `config/config.yaml`：

```yaml
mcps:
  problematic-mcp:
    enabled: false
```

## 回滚方案

如果迁移后出现问题，快速回滚：

```bash
# 1. 恢复原配置
cp ~/.openclaw/workspace/config/mcporter.backup-*.json \
   ~/.openclaw/workspace/config/mcporter.json

# 2. 停止 Plugin Manager
pkill -f "openclaw-plugin-manager"

# 3. 重启 OpenClaw
openclaw gateway restart
```

## 渐进式迁移（可选）

如果不想一次性迁移所有 MCP，可以分批迁移：

### 阶段 1：迁移 HTTP MCP（8 个）

只迁移远程服务，本地 stdio MCP 保持不变。

修改 `config/config.yaml`，只启用 HTTP MCP，其他设置 `enabled: false`。

### 阶段 2：迁移核心 Stdio MCP

迁移常用的：chrome-devtools、llamaindex、filesystem。

### 阶段 3：迁移剩余 MCP

全部迁移。

## 监控和维护

### 定期检查

```bash
# 查看 MCP 状态
curl http://localhost:8091/api/status

# 查看健康检查
curl http://localhost:8091/api/health
```

### 日志清理

```bash
# 清理旧日志
find /tmp/openclaw-plugin-manager -name "*.log" -mtime +7 -delete
```

### 性能监控

在 Web 界面查看：
- MCP 重启次数
- 工具数量变化
- 状态异常

## 总结

迁移后你将获得：

✅ **统一管理**：一个 Web 界面管理所有 MCP  
✅ **自动恢复**：MCP 崩溃自动重启  
✅ **进程隔离**：单个 MCP 失败不影响其他  
✅ **智能路由**：自动转发请求  
✅ **集中配置**：一个 YAML 文件管理所有  

OpenClaw 配置从 23 个 MCP 简化为 1 个 Plugin Manager。
