# 原子化系统测试示例

## 测试场景 1: 编译简单的原子化蓝图

### 输入：原子化蓝图

```typescript
import { initAtomicSystem } from '@/utils/atomicSystemInit'
import { compileAtomicBlueprint } from '@/utils/atomicBlueprintCompiler'

// 初始化系统
initAtomicSystem()

// 定义原子化蓝图
const blueprint = {
  blueprintId: 'simple-assistant',
  archetype: 'conversational',
  name: '简单助手',
  version: '1.0.0',
  
  // 引用模块
  modules: [
    'identity',
    'behavior_rules',
    'output_spec'
  ],
  
  // 原子值
  values: {
    // identity 模块
    role: '学习助手',
    mission: '帮助用户学习',
    
    // behavior_rules 模块
    max_questions_per_turn: 1,
    tone: 'friendly',
    no_interrogation: '不能太生硬',
    
    // output_spec 模块
    format: 'json',
    wrapper: false
  }
}

// 编译
const result = compileAtomicBlueprint(blueprint)
console.log(result.markdown)
```

### 输出：编译后的 Markdown

```markdown
---
agentId: skill:simple-assistant
archetype: conversational
description: 简单助手
temperature: 0.7
maxTokens: 8000
---

## 身份定义

你是一个学习助手。
你的任务是帮助用户学习。

### 行为规则

RULE-01: 每次最多问 1 个核心问题，避免连续追问。
RULE-02: 提问语气优先使用friendly。
RULE-03: 提问语气不能太生硬。

## 输出规格

OUT-01: 只输出一个合法json对象，不要输出额外说明文本。
OUT-02: JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言。
```

---

## 测试场景 2: 原子重用

### 场景描述

多个蓝图使用相同的原子，修改原子模板后，所有蓝图自动更新。

### 原子定义

```typescript
// atoms/behavior/max-questions-per-turn.ts
{
  atomId: 'max_questions_per_turn',
  compileTemplate: '每次最多问 {{value}} 个核心问题，避免连续追问。'
}
```

### 蓝图 A

```typescript
{
  blueprintId: 'assistant-a',
  modules: ['behavior_rules'],
  values: { max_questions_per_turn: 1 }
}
```

### 蓝图 B

```typescript
{
  blueprintId: 'assistant-b',
  modules: ['behavior_rules'],
  values: { max_questions_per_turn: 3 }
}
```

### 修改原子模板

```typescript
// 修改后
{
  atomId: 'max_questions_per_turn',
  compileTemplate: '每次提问不超过 {{value}} 个，保持对话节奏。' // 措辞改变
}
```

### 结果

**蓝图 A 自动更新**:
```
每次提问不超过 1 个，保持对话节奏。
```

**蓝图 B 自动更新**:
```
每次提问不超过 3 个，保持对话节奏。
```

✅ **无需手动修改任何蓝图文件！**

---

## 测试场景 3: 模块组合

### 场景描述

通过组合不同模块，快速构建不同类型的 Skill。

### conversational Skill

```typescript
{
  blueprintId: 'chat-assistant',
  archetype: 'conversational',
  modules: [
    'identity',
    'context_usage_rules',  // ✅ 对话需要
    'behavior_rules',       // ✅ 对话需要
    'output_spec'
  ],
  values: { ... }
}
```

### generator Skill

```typescript
{
  blueprintId: 'content-generator',
  archetype: 'generator',
  modules: [
    'identity',
    'output_spec',          // ✅ 生成需要
    'constraints'
  ],
  values: { ... }
}
```

### extractor Skill

```typescript
{
  blueprintId: 'data-extractor',
  archetype: 'extractor',
  modules: [
    'identity',
    'output_spec'           // ✅ 提取只需输出
  ],
  values: { ... }
}
```

✅ **不同 Archetype 自动选择合适的模块组合！**

---

## 测试场景 4: 条件编译

### 场景描述

根据原子值的不同，自动包含或排除某些规则。

### 模块定义

```typescript
{
  moduleId: 'context_usage_rules',
  compileLogic: {
    conditionalAtoms: [
      {
        condition: "fabrication_policy === 'forbidden'",
        requiredAtoms: ['fabrication_fallback']
      }
    ]
  }
}
```

### 测试 A: fabrication_policy = 'forbidden'

```typescript
values: {
  fabrication_policy: 'forbidden',
  fabrication_fallback: '不确定就空白'
}
```

**编译结果**:
```
不要为了补全字段而编造用户没有明确提供的信息；不确定就空白。
```

### 测试 B: fabrication_policy = 'allowed'

```typescript
values: {
  fabrication_policy: 'allowed'
  // fabrication_fallback 不需要
}
```

**编译结果**:
```
（不生成禁止编造的规则）
```

✅ **智能条件编译，只生成需要的规则！**

---

## 测试场景 5: 从传统蓝图转换

### 传统蓝图

```yaml
blueprintId: goal-conversation
archetype: conversational
name: 目标对话
identity:
  role: 学习目标澄清助手
  mission: 通过对话澄清学习目标
rules:
  behavior:
    max_questions_per_turn: 1
output:
  format: json
  wrapper: false
```

### 转换为原子化

```typescript
import { convertToAtomicBlueprint } from '@/utils/atomicBlueprintCompiler'

const traditional = loadYamlFile('goal-conversation.yaml')
const atomic = convertToAtomicBlueprint(traditional)

console.log(atomic)
```

### 输出：原子化蓝图

```typescript
{
  blueprintId: 'goal-conversation',
  archetype: 'conversational',
  name: '目标对话',
  version: '1.0.0',
  modules: ['identity', 'behavior_rules', 'output_spec'],
  values: {
    role: '学习目标澄清助手',
    mission: '通过对话澄清学习目标',
    max_questions_per_turn: 1,
    format: 'json',
    wrapper: false
  }
}
```

✅ **自动转换，无缝迁移！**

---

## 性能对比

| 维度 | 传统蓝图 | 原子化蓝图 |
|------|---------|-----------|
| 文件大小 | 177 行 | ~40 行（只有值）|
| 重复代码 | 高（每个蓝图都有模板）| 无（模板在原子中）|
| 修改成本 | 高（需改所有蓝图）| 低（改原子即可）|
| 学习曲线 | 陡（需理解所有规则）| 平缓（只需了解原子）|
| 可测试性 | 低（整体测试）| 高（原子级测试）|
| 一致性 | 手动保证 | 自动保证 |

---

## 总结

原子化系统的核心优势：

1. ✅ **可重用** - 原子和模块在多个蓝图间共享
2. ✅ **可维护** - 修改原子模板，所有使用者自动更新
3. ✅ **一致性** - 措辞自动统一
4. ✅ **简洁** - 蓝图文件只需要值，没有重复的模板
5. ✅ **可测试** - 原子和模块可以独立测试
6. ✅ **灵活** - 通过组合模块快速构建不同类型的 Skill

现在可以开始在 UI 中集成原子化编辑器了！
