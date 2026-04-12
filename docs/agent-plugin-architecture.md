# Agent 插件化架构设计文档

> 可插拔的 AI 学习平台 Agent 架构

---

## 🎯 愿景

打造一个**可插拔、可扩展**的 AI 学习平台，支持：
- 用户自由组装不同 Agent 插件（需求挖掘/路径规划/内容生成/质量评估/AI 辅导）
- 第三方开发者贡献新插件
- 官方提供原版插件，社区提供专项插件

---

## 🏗️ 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                      用户请求                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Agent 层（可插拔）                        │
│  - 需求挖掘 Agent（basic/deep/quick）                        │
│  - 路径规划 Agent（generic/tech/language）                   │
│  - 内容生成 Agent（basic/interactive/video）                 │
│  - 质量评估 Agent（basic/strict/custom）                     │
│  - AI 辅导 Agent（gentle/strict/zpd）                        │
│  ★ 特点：可插拔、可配置、依赖 LLM                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Skill 层（工具库）                        │
│  - PDF 解析、网页抓取、内容生成、测验生成                     │
│  ★ 特点：确定性、可复用、被 Agent 调用                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 📐 核心接口定义

### AgentPlugin 接口

```typescript
// backend/src/agents/types.ts

export interface AgentPlugin {
  // 元数据
  id: string;
  name: string;
  version: string;
  description: string;
  type: 'requirement-extractor' | 'path-planner' | 'content-generator' | 'quality-evaluator' | 'tutor';
  capabilities: string[];
  
  // 执行方法
  execute(input: any, context: AgentContext): Promise<AgentOutput>;
  
  // 配置（可选）
  config?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    model?: string;
  };
}

export interface AgentContext {
  userId?: string;
  taskId?: string;
  metadata?: Record<string, any>;
  history?: any[];
}

export interface AgentOutput {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    agentId: string;
    agentName: string;
    confidence?: number;
    generatedAt?: string;
  };
}
```

---

## 📦 插件注册表

```typescript
// backend/src/agents/registry.ts

class AgentRegistry {
  private plugins: Map<string, AgentPlugin> = new Map();
  
  // 注册插件
  register(plugin: AgentPlugin) {
    this.plugins.set(plugin.id, plugin);
  }
  
  // 获取插件
  get(id: string): AgentPlugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);
    return plugin;
  }
  
  // 按类型列出插件
  listByType(type: string): AgentPlugin[] {
    return Array.from(this.plugins.values())
      .filter(p => p.type === type);
  }
}

export const agentRegistry = new AgentRegistry();
```

---

## 🔌 插件实现示例

### 原版路径规划插件

```typescript
// backend/src/agents/path-planner/plugins/generic-planner.ts

import { AgentPlugin, AgentContext, AgentOutput } from '../../types';
import { getOpenAIClient } from '../../../gateway/openai-client';

export const genericPlanner: AgentPlugin = {
  id: 'generic-planner',
  name: '通用路径规划',
  version: '1.0.0',
  description: '适用于各类学习目标的通用路径规划',
  type: 'path-planner',
  capabilities: ['goal-analysis', 'path-generation', 'time-estimation'],
  
  config: {
    temperature: 0.5,
    maxTokens: 2048,
    systemPrompt: `你是一位专业的课程设计师，负责创建结构化的学习路径。
请创建一个详细的学习路径，包含：
1. 路径名称
2. 总阶段数
3. 每个阶段的学习主题和任务

请以 JSON 格式输出学习路径。`
  },
  
  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const client = getOpenAIClient();
    
    const messages = [
      { role: 'system', content: this.config!.systemPrompt! },
      { role: 'user', content: `学习主题：${input.goal}` }
    ];
    
    const response = await client.chatCompletion({ 
      messages, 
      temperature: this.config!.temperature,
      max_tokens: this.config!.maxTokens
    });
    
    return {
      success: true,
      data: JSON.parse(response.choices[0]?.message.content || '{}'),
      metadata: {
        agentId: this.id,
        agentName: this.name,
        generatedAt: new Date().toISOString()
      }
    };
  }
};
```

### 技术专项路径规划插件

```typescript
// backend/src/agents/path-planner/plugins/tech-planner.ts

import { AgentPlugin, AgentContext, AgentOutput } from '../../types';

export const techPlanner: AgentPlugin = {
  id: 'tech-planner',
  name: '技术专项路径规划',
  version: '1.0.0',
  description: '针对技术学习的深度路径规划，包含项目实战',
  type: 'path-planner',
  capabilities: ['goal-analysis', 'path-generation', 'project-design', 'code-review'],
  
  config: {
    temperature: 0.4,
    maxTokens: 3000,
    systemPrompt: `你是一位资深技术导师，专注于编程和技术学习路径设计。

请创建一个技术学习路径，包含：
1. 基础概念阶段
2. 核心技能阶段
3. 项目实战阶段
4. 代码审查和最佳实践

每个阶段都要有明确的实践项目和代码练习。`
  },
  
  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    // 技术专项的实现逻辑
    // ...
  }
};
```

---

## ⚙️ 配置系统

```typescript
// backend/config/agent-config.ts

export const agentConfig = {
  // 用户可切换的插件
  requirementExtractor: 'basic-extractor',  // basic | deep | quick
  pathPlanner: 'generic-planner',           // generic | tech | language
  contentGenerator: 'basic-generator',      // basic | interactive | video
  qualityEvaluator: 'basic-evaluator',      // basic | strict | custom
  tutor: 'gentle-tutor'                     // gentle | strict | zpd
};
```

---

## 🔄 运行时组装

```typescript
// backend/src/routes/learning-paths.ts

import { agentRegistry } from '../agents/registry';
import { agentConfig } from '../../config/agent-config';

POST /api/learning-paths
  async function createLearningPath(goal: string, context: AgentContext) {
    // 1. 获取配置的插件
    const extractor = agentRegistry.get(agentConfig.requirementExtractor);
    const planner = agentRegistry.get(agentConfig.pathPlanner);
    const evaluator = agentRegistry.get(agentConfig.qualityEvaluator);
    
    // 2. 提取需求
    const requirementResult = await extractor.execute({ goal }, context);
    const requirement = requirementResult.data;
    
    // 3. 生成路径
    let pathResult = await planner.execute(requirement, context);
    let path = pathResult.data;
    
    // 4. 质量评估（评分<80 则重新生成，最多 3 次）
    for (let i = 0; i < 3; i++) {
      const evalResult = await evaluator.execute(path, context);
      if (evalResult.data.score >= 80) break;
      pathResult = await planner.execute(requirement, context);
      path = pathResult.data;
    }
    
    return path;
  }
```

---

## 📁 目录结构

```
backend/src/
├── agents/
│   ├── types.ts                    # 接口定义
│   ├── registry.ts                 # 插件注册表
│   ├── requirement-extractor/
│   │   ├── plugins/
│   │   │   ├── basic.ts
│   │   │   ├── deep.ts
│   │   │   └── quick.ts
│   │   └── index.ts
│   ├── path-planner/
│   │   ├── plugins/
│   │   │   ├── generic.ts
│   │   │   ├── tech.ts
│   │   │   └── language.ts
│   │   └── index.ts
│   ├── content-generator/
│   │   ├── plugins/
│   │   │   ├── basic.ts
│   │   │   ├── interactive.ts
│   │   │   └── video.ts
│   │   └── index.ts
│   ├── quality-evaluator/
│   │   ├── plugins/
│   │   │   ├── basic.ts
│   │   │   └── strict.ts
│   │   └── index.ts
│   └── tutor/
│       ├── plugins/
│       │   ├── gentle.ts
│       │   ├── strict.ts
│       │   └── zpd.ts
│       └── index.ts
│
├── skills/                         # Skill 层（工具库）
│   ├── pdf-parser/
│   ├── web-fetch/
│   ├── content-generation/
│   └── quiz-generation/
│
└── config/
    └── agent-config.ts             # 插件配置
```

---

## 🚀 实现步骤

### Phase 1: 基础架构（4 小时）
1. 定义 `AgentPlugin` 接口和类型
2. 创建插件注册表
3. 创建配置系统

### Phase 2: 原版插件化（4 小时）
1. 把现有 path-agent 改造成 `generic-planner` 插件
2. 把现有 content-agent 改造成 `basic-generator` 插件
3. 创建 `basic-extractor` 和 `basic-evaluator` 插件

### Phase 3: 配置切换（2 小时）
1. 路由层支持读取配置
2. 运行时动态加载插件
3. 测试验证

### Phase 4: 新插件开发（可选）
1. 开发 `tech-planner` 插件
2. 开发 `interactive-generator` 插件
3. 文档和示例

---

## 📝 开发规范

### 插件命名
- 格式：`<类型>-<变体>`
- 示例：`generic-planner`, `tech-planner`, `basic-generator`

### 插件版本
- 遵循 SemVer（主版本。次版本。修订号）
- 破坏性变更需要升级主版本

### 插件文档
每个插件需要包含：
- 功能描述
- 适用场景
- 配置说明
- 使用示例

---

## 🌍 开源生态

### 插件发布
```bash
# 发布到 npm
npm publish @ai-learning/tech-planner

# 用户安装
npm install @ai-learning/tech-planner
```

### 插件市场
- 官方插件：`@ai-learning/*`
- 社区插件：`@<username>/*`

---

## ✅ 验收标准

- [ ] 定义 `AgentPlugin` 接口
- [ ] 创建插件注册表
- [ ] 现有 Agents 改造成插件
- [ ] 配置系统支持切换
- [ ] 至少 2 个同类型插件（如 generic-planner 和 tech-planner）
- [ ] 文档完整

---

## 📚 参考资料

- Arena Lab 配置：`backend/src/services/arena/agent-configs.ts`
- 现有 path-agent：`backend/src/agents/path-agent/index.ts`
- 现有 content-agent：`backend/src/agents/content-agent/index.ts`

---

_最后更新：2026-03-04_
