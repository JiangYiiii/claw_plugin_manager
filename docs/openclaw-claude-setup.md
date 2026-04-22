# OpenClaw 配置 Claude 模型指南

## 当前状态

OpenClaw 目前只配置了本地 `traffic` 模型服务，没有配置 Anthropic Claude。

**当前配置的模型：**
- traffic/qwen3.6-plus（主模型）
- traffic/deepseek-v3.2
- traffic/gpt-5.4
- traffic/bge-small-en-v1.5

## 配置 Claude 的步骤

### 方法 1：通过 OpenClaw Web UI 配置（推荐）

1. 访问 OpenClaw Dashboard：http://localhost:18789
2. 进入 Settings → Models
3. 添加 Anthropic provider：
   - Provider: `anthropic`
   - API Key: 你的 Anthropic API key
   - Models: 选择 Claude 模型（sonnet-4.5, opus-4.7 等）

### 方法 2：手动编辑配置文件

编辑 `~/.openclaw/openclaw.json`，在 `models.providers` 中添加：

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "traffic": {
        "baseUrl": "http://localhost:8081/v1",
        "apiKey": "sk-5R35GrcwQIIGRbRiiM8Z6sIm3zYGv9xoxXcf1FyNhzsNYztm",
        "api": "openai-completions",
        "models": [...]
      },
      "anthropic": {
        "apiKey": "sk-ant-api03-YOUR_KEY_HERE",
        "models": [
          {
            "id": "claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": {
              "input": 3,
              "output": 15,
              "cacheRead": 0.3,
              "cacheWrite": 3.75
            },
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "claude-opus-4.7",
            "name": "Claude Opus 4.7",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": {
              "input": 15,
              "output": 75,
              "cacheRead": 1.5,
              "cacheWrite": 18.75
            },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4.5",
        "fallbacks": ["traffic/qwen3.6-plus"]
      }
    }
  }
}
```

然后重启 OpenClaw：

```bash
openclaw gateway restart
```

### 方法 3：使用环境变量

设置环境变量：

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-YOUR_KEY_HERE"
```

然后在配置文件中引用：

```json
{
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "models": [...]
      }
    }
  }
}
```

## 获取 Anthropic API Key

1. 访问 https://console.anthropic.com/
2. 登录或注册账号
3. 进入 API Keys 页面
4. 创建新的 API key
5. 复制 key（格式：`sk-ant-api03-...`）

## 验证配置

配置完成后，测试是否能调用 Claude：

```bash
# 通过 OpenClaw API 测试
curl -X POST http://localhost:18789/api/chat \
  -H "Authorization: Bearer YOUR_OPENCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

或者直接在 OpenClaw 对话中测试：

```
/model anthropic/claude-sonnet-4.5
你好，测试 Claude 模型
```

## Claude Code CLI 说明

**注意**：`claude` CLI（Claude Code）和 OpenClaw 使用的 Anthropic API 是两回事：

- **Claude Code CLI**（`/Users/jiangyi/.local/bin/claude`）：
  - 是一个独立的 CLI 工具
  - 不能直接被 OpenClaw 调用
  - 有自己的会话管理

- **Anthropic API**：
  - OpenClaw 通过 API 调用 Claude 模型
  - 需要 API key
  - 按 token 计费

所以安装 Claude CLI 不能解决 OpenClaw 调用 Claude 的问题，需要配置 Anthropic API。

## 推荐配置

如果你有 Anthropic API key，推荐配置：

**主模型**：`anthropic/claude-sonnet-4.5`
- 快速、智能、性价比高
- 适合日常对话和代码任务

**推理模型**：`anthropic/claude-opus-4.7`
- 最强推理能力
- 适合复杂任务

**备用模型**：`traffic/qwen3.6-plus`
- 本地模型，免费
- API 不可用时自动切换

## 当前 OpenClaw 无法调用 Claude 的原因

1. ✅ Claude Code CLI 已安装（但这不是 API）
2. ❌ OpenClaw 配置中没有 `anthropic` provider
3. ❌ 没有配置 Anthropic API key
4. ❌ 当前主模型是 `traffic/qwen3.6-plus`（本地模型）

## 解决方案

1. **如果有 Anthropic API key**：按照上述方法配置
2. **如果没有 API key**：继续使用 `traffic` 本地模型
3. **如果想尝试**：去 Anthropic 官网申请 API key（新用户有免费额度）

## 其他选择

如果不想使用 Anthropic 付费 API，可以配置其他 provider：

- **OpenRouter**：聚合多个模型（包括 Claude）
- **AWS Bedrock**：通过 AWS 调用 Claude
- **继续使用 traffic**：本地模型，免费

## 检查当前配置

```bash
# 查看当前配置的模型
grep -A 50 '"models"' ~/.openclaw/openclaw.json | head -60

# 查看当前主模型
grep -A 5 '"primary"' ~/.openclaw/openclaw.json
```

当前输出应该是：

```json
"primary": "traffic/qwen3.6-plus"
```

配置 Claude 后会变成：

```json
"primary": "anthropic/claude-sonnet-4.5"
```
