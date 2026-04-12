# Skill 开发指南

本文档介绍如何在 AI 学习平台中开发自定义 Skill（技能）。

## Skill 与 Agent 的区别

| 特性 | Skill | Agent |
|------|-------|-------|
| 粒度 | 原子能力 | 完整功能 |
| 复用 | 可被多个 Agent 调用 | 独立运行 |
| 组合 | 可组合成 Pipeline | 调用 Skills |
| 状态 | 无状态 | 可维护状态 |

## 快速开始

### 1. 创建 Skill 文件

在 `backend/src/skills/standard/` 目录下创建：

```typescript
// MySkill.ts
import {
  ISkill,
  ISkillInput,
  ISkillOutput,
  ISkillCapabilities,
} from '../../core/skill/ISkill';

export interface IMySkillInput {
  text: string;
  options?: any;
}

export interface IMySkillOutput {
  processed: string;
  metadata: any;
}

export class MySkill implements ISkill {
  readonly id = 'my-skill';
  readonly name = 'MySkill';
  readonly version = '1.0.0';
  readonly description = '我的自定义技能';
  readonly category = 'processing';

  readonly capabilities: ISkillCapabilities = {
    tags: ['text-processing'],
    inputTypes: ['text'],
    outputType: 'text',
    requiresAI: false,
  };

  readonly config = {
    timeout: 30000,
    retryCount: 2,
    cacheEnabled: true,
  };

  async execute(
    input: ISkillInput<IMySkillInput>
  ): Promise<ISkillOutput<IMySkillOutput>> {
    const startTime = Date.now();

    try {
      const { data, context } = input;

      // 业务逻辑
      const result = await this.process(data);

      return {
        success: true,
        data: result,
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        error: {
          code: 'PROCESS_ERROR',
          message: error.message,
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  private async process(data: IMySkillInput): Promise<IMySkillOutput> {
    return {
      processed: data.text.toUpperCase(),
      metadata: { length: data.text.length },
    };
  }

  validate(input: ISkillInput<IMySkillInput>): boolean {
    return !!input.data?.text;
  }

  async warmup(): Promise<void> {
    console.log('[MySkill] 预热完成');
  }
}

export default MySkill;
```

### 2. 注册 Skill

```typescript
// 在应用启动时注册
import { skillManager } from '../../core/skill/SkillManager';
import { MySkill } from './MySkill';

skillManager.register(new MySkill());
```

### 3. 使用 Skill

```typescript
import { skillManager } from '../../core/skill/SkillManager';

const result = await skillManager.execute('my-skill', {
  data: { text: 'Hello World' },
  context: { userId: 'user-123' },
});

if (result.success) {
  console.log(result.data.processed);
}
```

## ISkill 接口详解

### 必需属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识符 |
| `name` | string | 显示名称 |
| `version` | string | 版本号 |
| `description` | string | 功能描述 |
| `category` | string | 分类 |
| `capabilities` | ISkillCapabilities | 能力定义 |
| `execute` | method | 执行方法 |

### 能力定义

```typescript
interface ISkillCapabilities {
  tags: string[];         // 能力标签
  inputTypes: string[];   // 支持的输入类型
  outputType: string;     // 输出类型
  requiresAI: boolean;    // 是否需要 AI
}
```

## SkillManager 使用

### 注册

```typescript
// 单个注册
skillManager.register(new MySkill());

// 批量注册
skillManager.registerMany([
  new ExerciseGeneratorSkill(),
  new CodeExplainSkill(),
]);
```

### 查询

```typescript
// 获取单个
const skill = skillManager.get('exercise-generator');

// 列出所有
const allSkills = skillManager.list();

// 按标签查找
const exercises = skillManager.findByTag('exercise');

// 按分类查找
const contentSkills = skillManager.findByCategory('content');
```

### 执行

```typescript
// 简单执行
const result = await skillManager.execute('my-skill', {
  data: { text: 'Hello' },
  context: { userId: 'user-1' },
});

// 带选项
const result = await skillManager.execute('my-skill', {
  data: { text: 'Hello' },
  context: { userId: 'user-1' },
  options: { verbose: true },
});
```

### Pipeline（技能链）

```typescript
// 串行执行多个技能
const result = await skillManager.executePipeline(
  ['extract-keywords', 'generate-summary', 'translate'],
  {
    data: { text: '长文本...' },
    context: { userId: 'user-1' },
  }
);
```

## 最佳实践

### 1. 输入验证

```typescript
validate(input: ISkillInput<IMySkillInput>): boolean {
  if (!input.data) return false;
  if (!input.data.text || typeof input.data.text !== 'string') {
    return false;
  }
  if (input.data.text.length > 10000) {
    return false; // 限制输入大小
  }
  return true;
}
```

### 2. 错误处理

```typescript
async execute(input: ISkillInput): Promise<ISkillOutput> {
  try {
    const result = await this.process(input.data);
    return { success: true, data: result };
  } catch (error: any) {
    return {
      success: false,
      data: null,
      error: {
        code: 'SKILL_ERROR',
        message: error.message,
        details: error.stack,
      },
    };
  }
}
```

### 3. 缓存策略

```typescript
readonly config = {
  cacheEnabled: true,  // 启用缓存
  timeout: 30000,
};

// SkillManager 会自动缓存结果
// 相同输入直接返回缓存
```

### 4. 超时处理

```typescript
readonly config = {
  timeout: 60000,  // 60 秒超时
};

// SkillManager 会自动处理超时
```

## 示例 Skills

参考现有标准化 Skill：

- `ExerciseGeneratorSkill.ts` - 练习题生成
- `ErrorPatternSkill.ts` - 错误模式分析
- `CodeExplainerSkill.ts` - 代码解释

## 从旧版迁移

### 旧版代码

```typescript
// 旧版
export async function generateExercises(params: any) {
  // 直接调用 AI
  const response = await aiService.chat(...);
  return response;
}
```

### 新版代码

```typescript
// 新版
export class ExerciseGeneratorSkill implements ISkill {
  readonly id = 'exercise-generator';
  // ... 实现 ISkill 接口

  async execute(input: ISkillInput): Promise<ISkillOutput> {
    // 通过 MCP Gateway 调用 AI
    const response = await mcpGateway.chatCompletion(...);
    return { success: true, data: response };
  }
}
```

## 调试

### 本地测试

```typescript
// test-my-skill.ts
import { MySkill } from './MySkill';

async function test() {
  const skill = new MySkill();
  await skill.warmup();

  const result = await skill.execute({
    data: { text: 'Test' },
    context: { userId: 'test' },
  });

  console.log(result);
}

test();
```

### 查看统计

```typescript
console.log(skillManager.getStats());
// {
//   totalSkills: 5,
//   categories: { content: 3, analysis: 2 },
//   cacheSize: 10
// }
```
