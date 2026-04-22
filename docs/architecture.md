# MCP Router - 架构设计

## 项目名称
**MCP Router** (Model Context Protocol Router)

## 核心理念

借鉴 Cursor 插件注册机制，创建一个统一的 MCP 管理和路由层，OpenClaw 只需配置一个固定地址，由 MCP Router 负责：
- 动态注册/发现 MCP 服务
- 路由转发请求
- 健康检查和故障转移
- 统一配置管理

## 架构设计

### 1. 整体架构

```
┌─────────────────┐
│   OpenClaw      │
│   Gateway       │
└────────┬────────┘
         │ Single Endpoint
         │ http://localhost:8090 or stdio
         ▼
┌─────────────────────────────────┐
│      MCP Router                 │
│  ┌──────────────────────────┐  │
│  │   Registry Service       │  │  ← 服务注册与发现
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │   Routing Engine         │  │  ← 请求路由与转发
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │   Health Monitor         │  │  ← 健康检查
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │   Config Manager         │  │  ← 配置管理
│  └──────────────────────────┘  │
└────────┬────────┬────────┬─────┘
         │        │        │
         ▼        ▼        ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │ MCP 1  │ │ MCP 2  │ │ MCP 3  │
    │(stdio) │ │(HTTP)  │ │(podman)│
    └────────┘ └────────┘ └────────┘
```

### 2. 核心能力

#### 2.1 服务注册（Registry）

**配置文件注册**（静态注册）：
```yaml
# config/mcps.yaml
mcps:
  - name: chrome-devtools
    type: stdio          # stdio | http | container
    enabled: true
    priority: 100
    command: npx
    args: [chrome-devtools-mcp@latest, --browserUrl=http://127.0.0.1:18800]
    healthCheck:
      type: process
      interval: 30s
    
  - name: tapd
    type: http
    enabled: true
    priority: 90
    baseUrl: https://mcp.fintopia.tech/tapd-mcp
    token: ${TAPD_TOKEN}
    healthCheck:
      type: http
      endpoint: /health
      interval: 60s
    
  - name: llamaindex
    type: container
    enabled: true
    priority: 80
    container:
      engine: podman
      image: openclaw-llamaindex-mcp
      name: openclaw-llamaindex-mcp
    healthCheck:
      type: container
      interval: 30s
```

**动态注册**（运行时注册）：
```http
POST /registry/register
{
  "name": "new-mcp",
  "type": "http",
  "baseUrl": "http://localhost:9000",
  "capabilities": ["tool", "resource", "prompt"]
}
```

#### 2.2 路由引擎（Routing）

**请求识别与转发**：
```javascript
// 伪代码示例
async function routeRequest(request) {
  // 1. 解析 MCP 协议请求
  const { method, params } = parseMCPRequest(request);
  
  // 2. 根据 method 判断目标 MCP
  if (method === 'tools/list') {
    // 聚合所有 MCP 的 tools
    return await aggregateTools();
  }
  
  if (method === 'tools/call') {
    // 根据 tool name 路由到具体 MCP
    const toolName = params.name;
    const targetMCP = findMCPByTool(toolName);
    return await forwardToMCP(targetMCP, request);
  }
  
  // 3. 资源请求路由
  if (method.startsWith('resources/')) {
    const targetMCP = findMCPByResource(params.uri);
    return await forwardToMCP(targetMCP, request);
  }
}
```

**智能路由策略**：
- **工具路由**：根据 tool name 前缀或映射表路由（如 `chrome.*` → chrome-devtools）
- **资源路由**：根据 URI scheme 路由（如 `file://` → filesystem, `tapd://` → tapd）
- **Prompt 路由**：根据 prompt name 路由
- **负载均衡**：同一能力多个实例时轮询或权重分配
- **故障转移**：主实例失败时切换到备份

#### 2.3 协议适配（Protocol Adapter）

**统一接口**：
```
OpenClaw → MCP Router (stdio/HTTP)
              ↓
      ┌─────────────────┐
      │ Protocol Adapter│
      └─────────────────┘
           ↙    ↓    ↘
      stdio   HTTP  container
```

**适配器实现**：
- **Stdio Adapter**：启动子进程，stdin/stdout 通信
- **HTTP Adapter**：HTTP 客户端，转发到远程 MCP
- **Container Adapter**：通过 `podman exec` 或 `podman attach` 通信

#### 2.4 健康检查（Health Monitor）

**检查维度**：
- **进程存活**：stdio MCP 的进程是否运行
- **HTTP 可用**：远程 MCP 的 /health 端点
- **容器状态**：Podman 容器是否 running
- **响应时间**：超时则标记为 degraded
- **错误率**：连续失败次数

**自动修复**：
- 进程崩溃 → 自动重启
- 容器停止 → podman restart
- HTTP 超时 → 切换备份实例
- 持续失败 → 禁用并告警

#### 2.5 配置管理（Config Manager）

**配置热加载**：
```bash
# 修改配置后无需重启
curl -X POST http://localhost:8090/admin/reload
```

**配置来源优先级**：
1. 环境变量（`MCP_ROUTER_CONFIG`）
2. 本地配置文件（`config/mcps.yaml`）
3. 远程配置中心（可选，如 Consul/etcd）
4. 命令行参数

**配置模板**：
```yaml
# 支持环境变量替换
mcps:
  - name: tapd
    baseUrl: ${TAPD_BASE_URL}
    token: ${TAPD_TOKEN:-default_token}
```

### 3. 对比 Cursor 插件机制

#### 相似点
| 特性 | Cursor 插件 | MCP Router |
|------|------------|------------|
| 注册机制 | 配置文件 + 动态加载 | 配置文件 + HTTP API |
| 能力发现 | 扫描插件目录 | Registry Service |
| 版本管理 | npm package.json | 配置文件 version 字段 |
| 热加载 | 支持 | 支持 |
| 统一入口 | Cursor 插件系统 | MCP Router |

#### 差异点
| 维度 | Cursor 插件 | MCP Router |
|------|------------|------------|
| 协议 | 插件 API | MCP 协议 |
| 运行时 | 进程内 | 进程外（独立服务）|
| 隔离性 | 较弱 | 强（进程/容器隔离）|
| 扩展性 | 受限于 Cursor | 独立演进 |

### 4. 技术选型

#### 4.1 实现语言
**推荐：Node.js / Go**

**Node.js 优势**：
- OpenClaw 是 Node.js，生态一致
- stdio 通信简单
- 快速开发

**Go 优势**：
- 性能更好
- 并发模型优秀
- 单二进制部署

#### 4.2 通信协议
**OpenClaw ↔ MCP Router**：
- 优先：stdio（零配置，与现有 MCP 一致）
- 备选：HTTP（更灵活，支持远程部署）

**MCP Router ↔ 后端 MCP**：
- stdio：子进程通信
- HTTP：RESTful API
- Container：podman exec

#### 4.3 数据存储
- **配置**：YAML 文件
- **运行时状态**：内存（可选 Redis）
- **日志**：文件 + 结构化日志（JSON）
- **指标**：Prometheus metrics

### 5. 核心功能清单

#### Phase 1: MVP（最小可行产品）
- [x] 项目结构搭建
- [ ] 配置文件解析（YAML）
- [ ] 基础路由引擎（工具路由）
- [ ] Stdio Adapter（子进程管理）
- [ ] HTTP Adapter（HTTP 转发）
- [ ] 基础健康检查（进程/HTTP）
- [ ] 与 OpenClaw 集成（stdio 接口）

#### Phase 2: 增强功能
- [ ] 动态注册 API
- [ ] 配置热加载
- [ ] Container Adapter（Podman 集成）
- [ ] 智能路由（负载均衡、故障转移）
- [ ] Web 管理界面
- [ ] 指标监控（Prometheus）

#### Phase 3: 高级特性
- [ ] 插件市场（类似 Cursor）
- [ ] 版本管理和升级
- [ ] A/B 测试（流量分发）
- [ ] 缓存层（减少后端压力）
- [ ] 分布式部署（多节点）

### 6. 使用体验对比

#### 容器化方案
```json
// OpenClaw 配置：每个 MCP 单独配置
{
  "chrome-devtools": {
    "command": "~/.openclaw/containers/wrapper.sh",
    "args": ["openclaw-chrome-devtools-mcp"]
  },
  "llamaindex": {
    "command": "~/.openclaw/containers/wrapper.sh",
    "args": ["openclaw-llamaindex-mcp"]
  },
  "tapd": {
    "baseUrl": "https://mcp.fintopia.tech/tapd-mcp"
  }
}
```

#### MCP Router 方案
```json
// OpenClaw 配置：单一入口
{
  "mcp-router": {
    "command": "mcp-router",
    "args": ["--config", "~/.openclaw/mcp-router/config.yaml"]
  }
}
```

```yaml
# MCP Router 配置：集中管理
mcps:
  - name: chrome-devtools
    type: stdio
    command: npx
    args: [chrome-devtools-mcp@latest]
  
  - name: llamaindex
    type: container
    container: openclaw-llamaindex-mcp
  
  - name: tapd
    type: http
    baseUrl: https://mcp.fintopia.tech/tapd-mcp
```

### 7. 扩展能力

#### 7.1 插件市场（未来）
```yaml
# 类似 npm registry
marketplace:
  registry: https://mcp-registry.openclaw.ai
  
  # 一键安装
  install:
    - name: chrome-devtools
      version: ^1.0.0
      source: registry
    
    - name: custom-mcp
      version: latest
      source: git+https://github.com/user/custom-mcp.git
```

#### 7.2 Skill 集成
```yaml
# MCP Router 也管理 Skills
skills:
  - name: debug-helper
    source: ~/shared-skills/global/debug-helper
    enabled: true
  
  - name: code-review
    source: registry://code-review@2.0.0
    enabled: true
```

#### 7.3 依赖管理
```yaml
# MCP 之间的依赖关系
mcps:
  - name: advanced-tool
    depends:
      - chrome-devtools  # 必须先启动
      - llamaindex
    command: ...
```

### 8. 安全性考虑

- **认证**：OpenClaw ↔ MCP Router 使用 token
- **授权**：每个 MCP 配置允许的 capabilities
- **隔离**：容器运行的 MCP 资源限制
- **审计**：记录所有 tool call 日志
- **加密**：敏感配置（token）加密存储

### 9. 性能指标

**目标**：
- 路由延迟：< 5ms（本地 stdio）
- 转发延迟：< 10ms（HTTP）
- 并发连接：> 100
- 内存占用：< 100MB
- CPU 占用：< 5%（空闲）

### 10. 部署方式

#### 方式 1：本地二进制
```bash
# 编译
npm run build  # or go build

# 启动
./mcp-router --config config.yaml
```

#### 方式 2：容器化（未来）
```bash
podman run -d \
  --name mcp-router \
  -v ~/.openclaw/mcp-router:/config \
  openclaw/mcp-router:latest
```

#### 方式 3：集成到 OpenClaw（未来）
```bash
# OpenClaw 内置 MCP Router
openclaw gateway start --mcp-router-enabled
```

---

## 下一步讨论重点

1. **技术选型确认**：Node.js 还是 Go？
2. **通信协议**：stdio 还是 HTTP？
3. **配置格式**：YAML 还是 JSON？
4. **MVP 范围**：Phase 1 包含哪些功能？
5. **命名**：`mcp-router` 还是其他名字（如 `mcp-hub`, `mcp-gateway`）？
6. **与现有系统集成**：如何平滑迁移？
