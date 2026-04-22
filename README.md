# OpenClaw Plugin Manager

统一的 MCP 管理和路由平台，为 OpenClaw 提供单一入口的 MCP 服务聚合。

## 特性

- 🔌 **统一入口**：OpenClaw 只需配置一个 MCP，所有能力通过 Plugin Manager 聚合
- 🚦 **智能路由**：自动根据 tool/resource 路由到对应的 MCP
- 💊 **健康监控**：自动检测 MCP 状态，异常时自动重启
- 🌐 **Web 界面**：实时查看 MCP 状态，管理 MCP（启用/禁用/重启）
- 🔄 **热加载**：动态添加/删除 MCP，无需重启 OpenClaw
- 📊 **多协议支持**：支持 stdio 和 HTTP 两种 MCP 类型

## 快速开始

### 方式 A：容器部署（推荐生产环境）

```bash
cd /Users/jiangyi/Documents/codedev

# 1. 配置
cp config/config.example.yaml config/config.yaml
# 编辑 config.yaml，配置你的 MCP 服务器

# 2. 构建镜像
./scripts/build-container.sh

# 3. 启动容器
./scripts/run-container.sh

# 4. 访问 Web 界面
# 浏览器打开：http://localhost:8091
```

**优势**：
- 更好的隔离性
- 自动重启
- 统一的日志管理
- 资源限制

详见：[容器部署指南](docs/container-deployment.md)

### 方式 B：原生运行（推荐开发环境）

```bash
cd /Users/jiangyi/Documents/codedev

# 1. 安装依赖
npm install

# 2. 配置
cp config/config.example.yaml config/config.yaml
# 编辑 config.yaml

# 3. 运行
npm start

# 4. 访问 Web 界面
# 浏览器打开：http://localhost:8091
```

**优势**：
- 快速启动
- 方便调试
- 无需构建镜像

## OpenClaw 集成

### 配置 OpenClaw

根据运行方式选择对应配置。

**容器运行**：

编辑 `~/.openclaw/workspace/config/mcporter.json`：

```json
{
  "mcpServers": {
    "plugin-manager": {
      "command": "/Users/jiangyi/Documents/codedev/scripts/openclaw-wrapper.sh"
    }
  }
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
  }
}
```

### 重启 OpenClaw Gateway

```bash
openclaw gateway restart
```

现在 OpenClaw 会通过 Plugin Manager 访问所有 MCP 服务。

详细集成文档：[OpenClaw 接入指南](docs/openclaw-integration.md)

## 配置说明

参考 `config/config.example.yaml`：

```yaml
server:
  mode: stdio              # stdio | http
  webPort: 8091           # Web 管理界面端口
  logLevel: info          # error | warn | info | debug

mcps:
  chrome-devtools:
    type: stdio           # stdio | http
    enabled: true
    command: npx
    args: [chrome-devtools-mcp@latest, --browserUrl=http://127.0.0.1:18800]
    healthCheck:
      interval: 30        # 健康检查间隔（秒）
    maxRestarts: 3        # 最大重启次数

  tapd:
    type: http
    enabled: true
    baseUrl: https://mcp.fintopia.tech/tapd-mcp
    headers:
      Authorization: Bearer ${TAPD_TOKEN}
    timeout: 10000
    healthCheck:
      endpoint: /health
      interval: 60
```

## 环境变量

配置文件支持环境变量替换：

```yaml
headers:
  Authorization: Bearer ${TAPD_TOKEN}
```

使用时设置：

```bash
export TAPD_TOKEN=your_token_here
npm start
```

## Web 管理界面

访问 http://localhost:8091 可以：

- 查看所有 MCP 状态（运行/停止/降级/失败）
- 查看资源使用（工具数量、资源数量、重启次数）
- 操作 MCP（重启/启用/禁用）
- 实时刷新（每 5 秒）

## API 接口

### 获取状态

```bash
curl http://localhost:8091/api/status
```

### MCP 列表

```bash
curl http://localhost:8091/api/mcps
```

### 重启 MCP

```bash
curl -X POST http://localhost:8091/api/mcps/chrome-devtools/restart
```

### 健康检查

```bash
curl http://localhost:8091/api/health
```

## 日志

日志目录：`/tmp/openclaw-plugin-manager/`

- `combined.log` - 所有日志
- `error.log` - 错误日志
- 控制台输出 - 带颜色的实时日志

## 故障排查

### MCP 启动失败

查看日志：

```bash
tail -f /tmp/openclaw-plugin-manager/error.log
```

检查配置：

```bash
cat config/config.yaml
```

### OpenClaw 无法连接

确认 Plugin Manager 正在运行：

```bash
ps aux | grep "openclaw-plugin-manager"
```

检查 OpenClaw 配置：

```bash
cat ~/.openclaw/workspace/config/mcporter.json
```

### Web 界面无法访问

检查端口是否被占用：

```bash
lsof -i :8091
```

修改 `config.yaml` 中的 `webPort`。

## 架构

详见 `docs/architecture.md`

## 项目结构

详见 `docs/project-structure.md`

## 开发

```bash
# 安装依赖
npm install

# 开发模式（更详细的日志）
npm run dev

# 只启动 Web 服务器
npm run web
```

## License

MIT
