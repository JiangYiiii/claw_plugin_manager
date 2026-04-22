# 项目结构

```
openclaw-plugin-manager/
├── src/
│   ├── core/
│   │   ├── plugin-manager.js        # 核心管理器
│   │   ├── mcp-adapter.js           # MCP 适配器基类
│   │   ├── stdio-adapter.js         # Stdio MCP 适配器
│   │   ├── http-adapter.js          # HTTP MCP 适配器
│   │   ├── router.js                # 路由引擎
│   │   └── health-monitor.js        # 健康检查
│   ├── skill/
│   │   ├── skill-manager.js         # Skill 管理器
│   │   └── skill-scanner.js         # Skill 扫描器
│   ├── config/
│   │   ├── config-loader.js         # 配置加载
│   │   └── validator.js             # 配置验证
│   ├── web/
│   │   ├── server.js                # Web 服务器
│   │   ├── api/
│   │   │   ├── mcps.js              # MCP API
│   │   │   ├── skills.js            # Skill API
│   │   │   └── config.js            # 配置 API
│   │   └── public/                  # 前端静态文件
│   ├── mcp-server.js                # MCP stdio 接口（给 OpenClaw）
│   └── index.js                     # 入口
├── web-ui/                          # 前端源码
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── App.jsx
│   └── package.json
├── config/
│   ├── config.yaml                  # 主配置
│   └── config.example.yaml
├── scripts/
│   └── install.sh                   # 安装脚本
├── docs/
│   ├── architecture.md
│   ├── project-structure.md
│   └── api.md
├── package.json
└── README.md
```
