# Web 管理界面设计

## 页面结构

### 1. Dashboard（总览）
- 运行中的 MCP 数量
- 可用工具总数
- 系统健康状态
- 最近告警

### 2. MCP 管理
**列表展示**：
- 名称、类型（stdio/http/container）
- 状态（Running/Stopped/Degraded）
- 资源使用（CPU/内存）
- 健康检查状态
- 工具数量

**操作**：
- 启用/禁用
- 重启
- 查看日志（弹窗）
- 查看详情（工具列表、配置）

**添加 MCP**：
- 表单：名称、类型、命令/URL
- 测试连接
- 保存到配置

### 3. Skill 管理
**列表展示**：
- 名称、来源（global/catalog/项目）
- 状态（已启用/可用）
- 触发词
- 描述

**操作**：
- 启用/禁用
- 查看详情（SKILL.md）
- 从 catalog 安装

### 4. 配置管理
- 在线编辑 config.yaml
- 语法高亮和校验
- 保存并热加载
- 配置历史（可选）

### 5. 日志查看
- 实时日志流（WebSocket）
- 过滤（按 MCP、日志级别）
- 搜索
- 下载日志文件

## API 设计

### MCP 相关
```
GET    /api/mcps              # 列表
GET    /api/mcps/:name        # 详情
POST   /api/mcps              # 添加
PUT    /api/mcps/:name        # 更新
DELETE /api/mcps/:name        # 删除
POST   /api/mcps/:name/restart   # 重启
POST   /api/mcps/:name/enable    # 启用
POST   /api/mcps/:name/disable   # 禁用
GET    /api/mcps/:name/logs      # 日志（SSE）
```

### Skill 相关
```
GET    /api/skills            # 列表
POST   /api/skills/:name/enable   # 启用
POST   /api/skills/:name/disable  # 禁用
GET    /api/skills/catalog         # 可安装列表
POST   /api/skills/install         # 安装
```

### 配置相关
```
GET    /api/config            # 获取配置
PUT    /api/config            # 更新配置
POST   /api/config/reload     # 热加载
```

### 系统相关
```
GET    /api/status            # 整体状态
GET    /api/health            # 健康检查
```
