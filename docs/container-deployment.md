# 容器化部署指南

## 概述

OpenClaw Plugin Manager 可以在 Podman 容器中运行，提供更好的隔离性和可移植性。

## 部署方式

### 方式 1：单容器模式（推荐）

最简单的部署方式，Plugin Manager 运行在单个容器中。

#### 1. 构建镜像

```bash
cd /Users/jiangyi/Documents/codedev
./scripts/build-container.sh
```

#### 2. 启动容器

```bash
./scripts/run-container.sh
```

容器会自动：
- 挂载 `config/` 目录到容器的 `/config`
- 暴露端口 8091（Web 界面）
- 配置 `host.containers.internal` 访问宿主机服务

#### 3. 验证

访问 http://localhost:8091 查看 Web 界面。

查看日志：
```bash
podman logs -f openclaw-plugin-manager
```

---

### 方式 2：Pod 模式（未来扩展）

使用 Pod 可以将多个容器组合在一起（如添加数据库、缓存等）。

#### 启动 Pod

```bash
./scripts/run-pod.sh
```

Pod 中包含：
- `openclaw-plugin-manager` 容器
- （未来可添加其他容器）

---

## OpenClaw 集成

### 配置 OpenClaw

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

**说明**：
- `openclaw-wrapper.sh` 通过 `podman exec -i` 与容器通信
- 使用 stdio 协议（与原生运行一致）
- 容器必须先启动

### 重启 OpenClaw

```bash
openclaw gateway restart
```

---

## 配置管理

### 配置文件位置

容器挂载宿主机配置目录：
```
宿主机: /Users/jiangyi/Documents/codedev/config/
容器内: /config/
```

### 修改配置

1. 编辑宿主机配置：
```bash
vi /Users/jiangyi/Documents/codedev/config/config.yaml
```

2. 重启容器：
```bash
podman restart openclaw-plugin-manager
```

配置会立即生效。

---

## 容器内 MCP 配置

### Stdio MCP

容器内启动的 stdio MCP 会作为容器的子进程运行：

```yaml
mcps:
  chrome-devtools:
    type: stdio
    enabled: true
    command: npx
    args: [chrome-devtools-mcp@latest, --browserUrl=http://host.containers.internal:18800]
```

**注意**：
- 使用 `host.containers.internal` 访问宿主机服务
- 容器内已安装 Node.js 和 Python

### HTTP MCP

访问外部 HTTP MCP 服务：

```yaml
mcps:
  tapd:
    type: http
    enabled: true
    baseUrl: https://mcp.fintopia.tech/tapd-mcp
```

无需特殊配置，容器可直接访问外网。

### 访问宿主机服务

容器配置了 `host.containers.internal` 指向宿主机：

```yaml
# 访问宿主机的 Chrome DevTools
--browserUrl=http://host.containers.internal:18800

# 访问宿主机的数据库
postgresql://host.containers.internal:5432/db
```

---

## 日志管理

### 查看实时日志

```bash
podman logs -f openclaw-plugin-manager
```

### 查看历史日志

```bash
podman logs --tail 100 openclaw-plugin-manager
```

### 导出日志

```bash
podman logs openclaw-plugin-manager > /tmp/plugin-manager.log
```

### 日志轮转

容器日志会自动管理，也可以配置轮转策略：

```bash
podman run -d \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    ...
```

---

## 常用操作

### 启动/停止

```bash
# 启动
podman start openclaw-plugin-manager

# 停止
podman stop openclaw-plugin-manager

# 重启
podman restart openclaw-plugin-manager
```

### 进入容器

```bash
podman exec -it openclaw-plugin-manager /bin/bash
```

### 查看状态

```bash
# 容器状态
podman ps -a | grep openclaw-plugin-manager

# 资源使用
podman stats openclaw-plugin-manager

# 详细信息
podman inspect openclaw-plugin-manager
```

### 更新镜像

```bash
# 重新构建
./scripts/build-container.sh

# 停止旧容器
podman stop openclaw-plugin-manager
podman rm openclaw-plugin-manager

# 启动新容器
./scripts/run-container.sh
```

### 清理

```bash
# 删除容器
podman rm -f openclaw-plugin-manager

# 删除镜像
podman rmi openclaw-plugin-manager:latest
```

---

## 自动启动

### 方式 1：Podman 自动重启

容器已配置 `--restart unless-stopped`，系统重启后自动启动。

### 方式 2：Systemd 服务

生成 systemd 服务文件：

```bash
# 生成服务文件
podman generate systemd --new --name openclaw-plugin-manager \
    > ~/.config/systemd/user/openclaw-plugin-manager.service

# 启用服务
systemctl --user enable openclaw-plugin-manager.service

# 启动服务
systemctl --user start openclaw-plugin-manager.service

# 查看状态
systemctl --user status openclaw-plugin-manager.service
```

系统启动后自动运行。

---

## 网络配置

### 端口映射

默认映射：
- `8091:8091` - Web 管理界面

添加更多端口（如果需要 HTTP 模式）：

```bash
podman run -d \
    -p 8091:8091 \
    -p 8090:8090 \
    ...
```

### 自定义网络

创建专用网络：

```bash
# 创建网络
podman network create openclaw-net

# 在网络中启动
podman run -d \
    --network openclaw-net \
    ...
```

---

## 性能优化

### 资源限制

限制容器资源使用：

```bash
podman run -d \
    --cpus 2.0 \
    --memory 1g \
    --name openclaw-plugin-manager \
    ...
```

### 存储优化

使用卷（volume）持久化数据：

```bash
# 创建卷
podman volume create plugin-manager-logs

# 挂载卷
podman run -d \
    -v plugin-manager-logs:/var/log/openclaw-plugin-manager \
    ...
```

---

## 故障排查

### 容器无法启动

查看错误日志：
```bash
podman logs openclaw-plugin-manager
```

常见问题：
- 配置文件路径错误
- 端口被占用
- 权限问题

### 无法访问 Web 界面

检查端口：
```bash
podman port openclaw-plugin-manager
```

检查防火墙：
```bash
sudo firewall-cmd --list-ports
```

### 容器内 MCP 启动失败

进入容器调试：
```bash
podman exec -it openclaw-plugin-manager /bin/bash

# 手动测试 MCP 命令
npx chrome-devtools-mcp@latest --browserUrl=http://host.containers.internal:18800
```

### OpenClaw 无法连接

确认容器运行：
```bash
podman ps | grep openclaw-plugin-manager
```

测试 wrapper 脚本：
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | \
    /Users/jiangyi/Documents/codedev/scripts/openclaw-wrapper.sh
```

---

## 安全考虑

### 只读挂载

配置目录以只读方式挂载：
```bash
-v "$CONFIG_DIR:/config:ro"
```

### 非 root 用户

修改 Containerfile，使用非 root 用户：
```dockerfile
RUN useradd -m -u 1000 app
USER app
```

### 网络隔离

限制容器网络访问：
```bash
--network none  # 完全隔离
```

---

## 监控集成

### 健康检查

在容器启动时添加健康检查：

```bash
podman run -d \
    --health-cmd "curl -f http://localhost:8091/api/health || exit 1" \
    --health-interval 30s \
    --health-timeout 10s \
    --health-retries 3 \
    ...
```

### Prometheus 指标

（未来版本可添加 `/metrics` 端点）

---

## 对比：容器 vs 原生运行

| 特性 | 容器运行 | 原生运行 |
|------|---------|---------|
| 隔离性 | ✅ 强 | ⚠️ 弱 |
| 性能 | ✅ 接近原生 | ✅ 最佳 |
| 部署复杂度 | ⚠️ 稍高 | ✅ 简单 |
| 依赖管理 | ✅ 容器内 | ⚠️ 需手动安装 |
| 自动重启 | ✅ 内置 | ⚠️ 需配置 |
| 日志管理 | ✅ 统一 | ⚠️ 分散 |
| 资源限制 | ✅ 易配置 | ⚠️ 需系统级配置 |

**推荐**：
- 开发/测试环境：原生运行（快速迭代）
- 生产环境：容器运行（稳定可靠）

---

## 总结

容器化部署提供：
- ✅ 更好的隔离性
- ✅ 统一的部署方式
- ✅ 自动重启和健康检查
- ✅ 易于迁移和扩展

快速开始：
```bash
cd /Users/jiangyi/Documents/codedev
./scripts/build-container.sh
./scripts/run-container.sh
```

然后访问 http://localhost:8091
