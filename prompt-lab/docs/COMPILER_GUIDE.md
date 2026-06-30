# 编译器使用指南

## 概述

Skill 编译器负责将 YAML 蓝图编译成可执行的 Markdown 提示词。

```
YAML 蓝图  →  编译器  →  Markdown 提示词
```

---

## 命令行使用

### 基础编译

```bash
cd wenflow/frontend
npx tsx scripts/test-compiler.ts
```

**输入**: `prompt-lab/blueprints/goal-conversation.yaml`

**输出**: `prompt-lab/prompts/goal-conversation.md`

---

## 编译选项

### 完整编译（默认）

```typescript
import { compileBlueprint } from '@/utils/blueprintCompiler'

const compiled = compileBlueprint(blueprint, {
  includeComments: false,  // 不包含注释
  ruleNumbering: true      // 自动生成编号
})
```

### 无编号模式

```typescript
const compiled = compileBlueprint(blueprint, {
  ruleNumbering: false  // 不生成 RULE-XX 编号
})
```

---

## 编译规则

### 1. 自动编号

编译器自动为规则生成 `RULE-XX` 编号：

**输入（YAML）**:
```yaml
rules:
  context_usage:
    evaluation_mode: "fresh_turn"
    priority: "state优先"
  behavior:
    max_questions_per_turn: 1
```

**输出（Markdown）**:
```markdown
RULE-01: 这是 fresh turn evaluation。state优先...
RULE-02: 每次最多问 1 个核心问题...
```

编号**全局递增**，跨越不同规则块。

---

### 2. 身份定义展开

**输入（YAML）**:
```yaml
identity:
  role: "学习目标澄清助手"
  mission: "通过对话澄清学习目标"
  scope:
    not_business_consultant: true
    not_full_path_generator: true
```

**输出（Markdown）**:
```markdown
## 身份定义

你是一个学习目标澄清助手。

你的任务是通过对话澄清学习目标。你不是业务顾问，也不是正式的学习路径生成器。
```

---

### 3. 规则块编译

#### 上下文使用规则

**输入**:
```yaml
rules:
  context_usage:
    evaluation_mode: "fresh_turn"
    priority: "state优先，依据state判断阶段和缺口"
    conflict_resolution: "userInput_always_wins"
    fabrication_policy: "forbidden"
    fabrication_fallback: "不确定就空白或继续追问"
```

**输出**:
```markdown
### 上下文使用规则

RULE-01: 这是 fresh turn evaluation。state优先，依据state判断阶段和缺口，不要把 conversationContext 当作需要续写的多轮聊天。
RULE-02: 若 state 与 current turn payload 里的 userInput 冲突，必须以 userInput 为准，并在输出中修正状态。
RULE-03: 不要为了补全字段而编造用户没有明确提供的信息；不确定就空白或继续追问。
```

#### 行为规则

**输入**:
```yaml
rules:
  behavior:
    max_questions_per_turn: 1
    understanding_stage:
      reply_structure: "理解总结 + 说明 + 问题"
      tone: "natural_transition"
      no_interrogation: "不能像问卷或审问"
```

**输出**:
```markdown
### 行为规则

RULE-09: 每次最多问 1 个核心问题，避免连续追问。
RULE-10: 在 understanding 阶段，reply 默认先用 理解总结 + 说明 + 问题。
RULE-11: 提问语气不能像问卷或审问，优先使用自然过渡。
```

---

### 4. 输出规格编译

**输入**:
```yaml
output:
  format: "json"
  wrapper: false
  top_level_fields:
    - reply
    - state
    - understanding
```

**输出**:
```markdown
## 输出规格

OUT-01: 只输出一个合法JSON对象，不要输出额外说明文本。
OUT-02: JSON 顶层字段固定为：reply、state、understanding
OUT-03: JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言。
```

---

### 5. 边界约束编译

**输入**:
```yaml
constraints:
  - subject: "默认面向提问者本人"
  - fabrication: "不编造未提供的信息"
  - scope: "不解决业务问题"
```

**输出**:
```markdown
## 边界约束

CON-01: 默认面向提问者本人
CON-02: 不编造未提供的信息
CON-03: 不解决业务问题
```

---

## Archetype 模板

不同的 archetype 使用不同的编译模板：

### conversational（对话型）

**特点**:
- 生成状态机章节
- 包含阶段转换规则
- 强调多轮对话策略

**编译时添加**:
```markdown
## 状态机

### 阶段定义
...

### 阶段转换
...
```

### generator（生成型）

**特点**:
- 强调输入数据说明
- 详细的生成步骤
- 明确的输出格式

### extractor（提取型）

**特点**:
- 提取目标定义
- 匹配规则说明
- 结构化输出要求

---

## 完整编译示例

### 输入文件: `blueprints/goal-conversation.yaml`

```yaml
blueprintId: goal-conversation
archetype: conversational
name: 目标对话
version: 3.0.0

identity:
  role: "学习目标澄清助手"
  mission: "通过对话澄清目标"

rules:
  behavior:
    max_questions_per_turn: 1
    tone: "natural"

output:
  format: "json"
  top_level_fields: ["reply", "state"]

constraints:
  - "不编造信息"
```

### 运行编译

```bash
npx tsx scripts/test-compiler.ts
```

### 输出文件: `prompts/goal-conversation.md`

```markdown
---
agentId: skill:goal-conversation
archetype: conversational
description: 学习目标澄清助手
temperature: 0.7
maxTokens: 8000
---

## 身份定义

你是一个学习目标澄清助手。

你的任务是通过对话澄清目标。

## 执行规则

### 行为规则

RULE-01: 每次最多问 1 个核心问题，避免连续追问。
RULE-02: 提问语气保持 natural。

## 输出规格

OUT-01: 只输出一个合法JSON对象，不要输出额外说明文本。
OUT-02: JSON 顶层字段固定为：reply、state

## 边界约束

CON-01: 不编造信息
```

---

## 前端集成

### 在 Prompt Lab 中使用

```typescript
import { loadAndCompile } from '@/utils/blueprintCompiler'

// 加载 YAML 文件
const yamlContent = await fetch('/prompt-lab/blueprints/goal-conversation.yaml')
  .then(r => r.text())

// 编译
const compiledPrompt = loadAndCompile(yamlContent, {
  ruleNumbering: true
})

// 显示预览
console.log(compiledPrompt)
```

---

## 调试技巧

### 1. 查看编译日志

```typescript
const compiled = compileBlueprint(blueprint, {
  includeComments: true  // 包含注释，便于调试
})
```

### 2. 验证 YAML 格式

```bash
# 安装 YAML lint
npm install -g yaml-lint

# 验证文件
yamllint blueprints/goal-conversation.yaml
```

### 3. 对比编译结果

```bash
# 编译前后对比
diff prompts/goal-conversation.md.old prompts/goal-conversation.md
```

---

## 常见问题

### Q1: 编译后编号不连续？

A: 检查 YAML 中是否有空的规则块，编译器会跳过空规则。

### Q2: 输出的提示词太长？

A: 检查 YAML 中是否有冗余配置，精简蓝图内容。

### Q3: 某些字段没有被编译？

A: 确认字段名是否符合规范，参考 `BLUEPRINT_SPEC_V3.md`。

---

## 下一步

- 查看 [蓝图规范](./BLUEPRINT_SPEC_V3.md) 了解 YAML 格式
- 查看 [架构说明](./ARCHITECTURE.md) 了解整体设计
- 创建自己的蓝图并编译测试
