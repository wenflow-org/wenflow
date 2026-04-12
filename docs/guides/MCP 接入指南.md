# MCP 接入指南

本文档介绍如何配置和使用 MCP (Model Context Protocol) 服务。

## 什么是 MCP

MCP 是 Model Context Protocol 的缩写，用于统一管理：
- AI 服务连接（OpenAI、Anthropic、本地模型等）
- 工具调用（代码执行、搜索、文件读取等）
- Agent 配置（模型选择、参数设置等）

## 配置文件

MCP 配置位于 `backend/config/mcp.json`：

```json
{
  "version": "1.0.0",
  "servers": [
    {
      "id": "openai",
      "name": "OpenAI API",
      "type": "openai",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "models": ["gpt-4", "gpt-3.5-turbo"],
      "defaultModel": "gpt-4",
      "priority": 1,
      "enabled": true
    }
  ],
  "tools": [...],
  "agents": {...}
}
```

## 环境变量

配置文件支持环境变量替换：

```json
{
  "apiKey": "${OPENAI_API_KEY}",
  "endpoint": "${AI_API_URL:-http://localhost:3000/v1}"
}
```

语法：
- `${VAR}` - 使用环境变量，不存在则为空
- `${VAR:-default}` - 使用环境变量，不存在则使用默认值

## 服务器配置

### OpenAI

```json
{
  "id": "openai",
  "name": "OpenAI API",
  "type": "openai",
  "endpoint": "https://api.openai.com/v1",
  "apiKey": "${OPENAI_API_KEY}",
  "models": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
  "defaultModel": "gpt-4",
  "priority": 1,
  "enabled": true,
  "config": {
    "temperature": 0.7,
    "maxTokens": 4000,
    "timeout": 60000
  }
}
```

### 本地模型（NewAPI）

```json
{
  "id": "newapi",
  "name": "NewAPI 本地服务",
  "type": "openai-compatible",
  "endpoint": "http://localhost:3000/v1",
  "apiKey": "${AI_API_KEY}",
  "models": ["deepseek-chat", "deepseek-think"],
  "defaultModel": "deepseek-chat",
  "priority": 2,
  "enabled": true
}
```

### Anthropic Claude

```json
{
  "id": "anthropic",
  "name": "Anthropic Claude",
  "type": "anthropic",
  "endpoint": "https://api.anthropic.com",
  "apiKey": "${ANTHROPIC_API_KEY}",
  "models": ["claude-3-opus", "claude-3-sonnet"],
  "defaultModel": "claude-3-sonnet",
  "priority": 3,
  "enabled": false
}
```

## 工具配置

### 代码解释器

```json
{
  "id": "code-interpreter",
  "name": "代码解释器",
  "description": "执行 Python 代码",
  "type": "code",
  "endpoint": "local",
  "enabled": true
}
```

### 文件读取

```json
{
  "id": "file-reader",
  "name": "文件读取",
  "description": "读取本地文件",
  "type": "filesystem",
  "endpoint": "local",
  "config": {
    "allowedPaths": ["./uploads", "./data"],
    "maxFileSize": 10485760
  },
  "enabled": true
}
```

### 网页搜索

```json
{
  "id": "web-search",
  "name": "网页搜索",
  "description": "搜索互联网内容",
  "type": "search",
  "endpoint": "https://api.search.com/v1",
  "apiKey": "${SEARCH_API_KEY}",
  "enabled": false
}
```

## Agent 配置

为每个 Agent 指定 MCP 服务器和参数：

```json
{
  "agents": {
    "path-agent": {
      "mcpServer": "newapi",
      "model": "deepseek-chat",
      "maxTokens": 4000,
      "temperature": 0.5
    },
    "content-agent": {
      "mcpServer": "newapi",
      "model": "deepseek-chat",
      "maxTokens": 4000,
      "temperature": 0.7
    }
  }
}
```

## 路由策略

```json
{
  "routing": {
    "strategy": "priority",
    "fallback": true,
    "healthCheck": {
      "enabled": true,
      "interval": 30000
    }
  }
}
```

### 策略说明

- **priority** - 按优先级选择服务器（数字越小优先级越高）
- **round-robin** - 轮询选择
- **random** - 随机选择

### Fallback

当 `fallback: true` 时，如果首选服务器失败，会自动尝试下一个可用服务器。

### 健康检查

定期检测服务器可用性，自动标记故障服务器。

## 使用 McpGateway

### 初始化

```typescript
import { McpGateway } from '../core/mcp/McpGateway';

const gateway = new McpGateway();
// 或使用默认实例
import { mcpGateway } from '../core';
```

### 聊天补全

```typescript
const response = await mcpGateway.chatCompletion({
  model: process.env.AI_MODEL || 'deepseek-chat',
  messages: [
    { role: 'system', content: '...' },
    { role: 'user', content: '...' }
  ],
  temperature: 0.7,
  max_tokens: 4000
});

console.log(response.choices[0].message.content);
```

### 指定服务器

```typescript
const response = await mcpGateway.chatCompletion(
  { messages: [...] },
  'newapi'  // 指定服务器 ID
);
```

### 调用工具

```typescript
// 代码执行
const result = await mcpGateway.callTool('code-interpreter', {
  code: 'print("Hello World")',
  language: 'python'
});

// 文件读取
const file = await mcpGateway.callTool('file-reader', {
  path: './data/example.txt'
});
```

### 获取状态

```typescript
const status = mcpGateway.getStatus();
console.log(status);
// {
//   servers: [
//     { id: 'openai', name: 'OpenAI API', enabled: true, healthy: true },
//     { id: 'newapi', name: 'NewAPI', enabled: true, healthy: true }
//   ],
//   tools: [
//     { id: 'code-interpreter', name: '代码解释器', enabled: true }
//   ]
// }
```

## 热更新

修改 `mcp.json` 后无需重启服务，配置会自动加载。

## 故障排查

### 连接失败

1. 检查环境变量是否设置
2. 检查 endpoint 是否正确
3. 查看后端日志

```bash
# 检查环境变量
echo $AI_API_URL
echo $AI_API_KEY
```

### 模型不可用

1. 确认模型在 `models` 列表中
2. 检查 MCP 服务器是否支持该模型

### 工具调用失败

1. 确认工具 `enabled: true`
2. 检查工具配置（如 `allowedPaths`）

## 安全建议

1. **API Key 管理** - 使用环境变量，不要硬编码
2. **文件访问限制** - 配置 `allowedPaths` 限制文件读取范围
3. **代码执行隔离** - 使用沙箱环境执行用户代码
4. **超时设置** - 合理设置超时时间，防止资源耗尽

## 扩展示例

### 添加新的 MCP 服务器

```json
{
  "id": "azure-openai",
  "name": "Azure OpenAI",
  "type": "openai",
  "endpoint": "${AZURE_OPENAI_ENDPOINT}",
  "apiKey": "${AZURE_OPENAI_KEY}",
  "models": ["gpt-4", "gpt-35-turbo"],
  "defaultModel": "gpt-4",
  "priority": 4,
  "enabled": true
}
```

### 添加新的工具

```json
{
  "id": "database-query",
  "name": "数据库查询",
  "description": "查询学习数据库",
  "type": "database",
  "endpoint": "local",
  "config": {
    "allowedTables": ["users", "learning_paths"],
    "readOnly": true
  },
  "enabled": true
}
```
