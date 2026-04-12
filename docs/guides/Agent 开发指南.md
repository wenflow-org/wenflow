# Agent 开发指南

本文档介绍如何在 AI 学习平台中开发自定义 Agent。

## 快速开始

### 1. 创建 Agent 文件

在 `backend/src/agents/standard/` 目录下创建新文件：

```typescript
// MyAgent.ts
import { BaseAgent } from '../../core/agent/BaseAgent';
import { IAgentInput, IAgentOutput, IAgentCapabilities } from '../../core/agent/ILearningAgent';

export class MyAgent extends BaseAgent {
  readonly id = 'my-agent';
  readonly name = 'MyAgent';
  readonly version = '1.0.0';
  readonly description = '我的自定义 Agent';
  readonly subject = '综合';

  readonly capabilities: IAgentCapabilities = {
    tags: ['my-tag'],
    subjects: ['编程', '英语'],
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string' }
      }
    }
  };

  protected async execute(input: IAgentInput): Promise<IAgentOutput> {
    // 实现核心逻辑
    return {
      success: true,
      data: { result: 'Hello World' }
    };
  }
}

export default MyAgent;
```

### 2. 自动加载

Agent 文件创建后，`AgentLoader` 会自动扫描并加载，无需修改核心代码。

### 3. 验证

访问管理平台查看 Agent 是否已注册：
```
http://localhost:5173/admin/agent-lab
```

## ILearningAgent 接口详解

### 必需属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识符（kebab-case） |
| `name` | string | 显示名称 |
| `version` | string | 版本号 |
| `description` | string | 功能描述 |
| `subject` | string | 所属学科 |
| `capabilities` | IAgentCapabilities | 能力定义 |
| `run` | method | 执行方法 |

### 能力定义

```typescript
interface IAgentCapabilities {
  tags: string[];        // 能力标签
  subjects: string[];    // 支持的学科
  inputSchema: object;   // 输入参数 Schema
  outputSchema: object;  // 输出结果 Schema
}
```

## BaseAgent 基类

### 提供的功能

1. **输入验证** - 自动调用 `validate()` 方法
2. **预处理/后处理** - `preprocess()` / `postprocess()`
3. **AI 调用** - `callAI()` 便捷方法
4. **JSON 解析** - `parseJSON()` 带错误处理
5. **配置管理** - `this.config` 访问配置

### 生命周期

```
run(input)
  ├── validate(input)      // 验证输入
  ├── preprocess(input)    // 预处理
  ├── execute(input)       // 核心逻辑（必须实现）
  └── postprocess(output)  // 后处理
```

### 调用 AI

```typescript
protected async execute(input: IAgentInput): Promise<IAgentOutput> {
  const response = await this.callAI([
    { role: 'system', content: this.systemPrompt },
    { role: 'user', content: input.prompt }
  ], {
    temperature: 0.7,
    maxTokens: 2000
  });

  return {
    success: true,
    data: { content: response.content }
  };
}
```

## 使用 MCP Gateway

```typescript
import { mcpGateway } from '../../core/mcp/McpGateway';

const response = await mcpGateway.chatCompletion({
  model: process.env.AI_MODEL || 'deepseek-chat',
  messages: [
    { role: 'system', content: '...' },
    { role: 'user', content: input.prompt }
  ],
  temperature: 0.7,
  max_tokens: 4000
}, 'newapi');  // 指定 MCP 服务器
```

## 最佳实践

### 1. 错误处理

```typescript
protected async execute(input: IAgentInput): Promise<IAgentOutput> {
  try {
    // 业务逻辑
    return { success: true, data: result };
  } catch (error: any) {
    return {
      success: false,
      data: null,
      error: {
        code: 'MY_ERROR_CODE',
        message: error.message
      }
    };
  }
}
```

### 2. 日志记录

```typescript
import { logger } from '../../utils/logger';

logger.info(`[${this.id}] 执行开始`);
logger.error(`[${this.id}] 执行失败:`, error);
```

### 3. 输入验证

```typescript
validate(input: IAgentInput): boolean {
  if (!input.prompt || input.prompt.length < 10) {
    return false;
  }
  return true;
}
```

## 示例 Agent

参考现有标准化 Agent：

- `PathAgent.ts` - 路径生成
- `ContentAgent.ts` - 内容生成
- `TutorAgent.ts` - AI 辅导

## 调试

### 本地测试

```typescript
// test-my-agent.ts
import { MyAgent } from './MyAgent';

async function test() {
  const agent = new MyAgent();
  await agent.initialize();

  const result = await agent.run({
    prompt: '测试输入',
    context: { userId: 'test' }
  });

  console.log(result);
}

test();
```

### 管理平台测试

1. 访问 `/admin/agent-lab`
2. 找到你的 Agent
3. 点击"快速测试"

## 进阶主题

### 自定义配置

```typescript
constructor() {
  super({
    temperature: 0.5,
    maxTokens: 4000,
    timeout: 120000,
    retries: 3
  });
}
```

### 初始化资源

```typescript
async initialize(): Promise<void> {
  // 加载模型、连接数据库等
  await super.initialize();
}

async destroy(): Promise<void> {
  // 释放资源
  await super.destroy();
}
```

