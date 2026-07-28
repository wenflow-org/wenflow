# Goal Conversation Schema 逆向工程分析

## 📋 分析目标

以 `goal-conversation.yaml` 为实验对象，逆向分析其信息结构，区分：
- **固定模板**（编译器自动生成）
- **可配置字段**（用户填写）
- **可推导字段**（根据其他信息自动生成）

---

## 🔍 顶层元数据分析

| 字段 | 当前值 | 类型 | 分类 | 是否必需 | 说明 |
|------|--------|------|------|---------|------|
| `blueprintId` | goal-conversation | string | 可配置 | ✅ | Skill 唯一标识 |
| `skillId` | skill:goal-conversation | string | 可推导 | ✅ | 可从 blueprintId 推导：`skill:{blueprintId}` |
| `archetype` | conversational | enum | 可配置 | ✅ | 决定整体结构：conversational/generator/extractor/distiller |
| `name` | 目标对话 | string | 可配置 | ✅ | 显示名称 |
| `description` | 学习目标澄清... | string | 可配置 | ✅ | 一句话描述 |
| `version` | 3.0.0 | string | 可配置 | ❌ | 版本号，默认 1.0.0 |
| `temperature` | 0.7 | number | 可配置 | ❌ | LLM 参数，默认 0.7 |
| `maxTokens` | 8000 | number | 可配置 | ❌ | LLM 参数，默认 8000 |

**结论**：
- `skillId` 是冗余字段，可以自动推导
- `temperature` 和 `maxTokens` 可以提供默认值

---

## 🎭 Identity（身份定义）分析

### 核心字段

| 字段 | 当前值 | 类型 | 分类 | 是否必需 | 编译为 |
|------|--------|------|------|---------|--------|
| `role` | 学习目标澄清与方向收敛助手 | string | 可配置 | ✅ | `你是一个{role}。` |
| `mission` | 通过自然对话澄清学习目标... | string | 可配置 | ✅ | `你的任务是{mission}。` |
| `scope.*` | 各种 not_xxx | object | 可配置 | ❌ | `你{否定描述}。` |
| `execution_model` | fresh_turn_evaluation | string | 可配置 | ❌ | 影响后续规则生成 |
| `note` | 系统每次只给你... | string | 可配置 | ❌ | 直接输出 |

### Scope 子字段

| 字段 | 当前值 | 编译为 |
|------|--------|--------|
| `not_business_consultant` | true | 不是业务顾问 |
| `not_full_path_generator` | true | 不是正式的学习路径生成器 |
| `not_solve_business_problems` | true | 不直接替用户解决业务问题 |
| `not_expand_full_content` | true | 不展开完整学习路径正文 |

**问题**：
- Scope 的 key 命名不统一（有的是 not_xxx，有的是 xxx）
- 这些否定描述的措辞是固定的还是可配置的？

**建议**：
```yaml
scope:
  what_you_are_not:
    - "业务顾问"
    - "正式的学习路径生成器"
  what_you_dont_do:
    - "直接替用户解决业务问题"
    - "展开完整学习路径正文"
```

---

## 📥 Input（输入说明）分析

### 结构

```yaml
input:
  payload_structure:
    userInput:
      description: "..."
      type: string
    state:
      description: "..."
      priority: "highest"
      type: object
    conversationContext:
      description: "..."
      usage: "..."
      type: object
```

**问题**：
- 这个结构是 conversational archetype 特有的吗？
- generator/extractor 的 input 结构是什么？
- 这部分应该是**固定模板**还是**可配置**？

**初步结论**：
- 对于 conversational archetype，input 结构应该是**固定模板**
- 只有 description 和 usage 字段是可配置的
- 编译器应该自动生成这部分

**建议简化**：
```yaml
input_variables:
  - name: userInput
    description: "当前这一轮用户刚刚新增的真实输入"
  - name: state
    description: "当前已累积的主记忆对象"
    priority: highest
  - name: conversationContext
    description: "过往对话的摘要化上下文证据"
    usage_note: "仅用于核对用户原话和补足细节"
```

---

## 📋 Rules（规则定义）分析

### 1. context_usage（上下文使用规则）

| 字段 | 当前值 | 类型 | 分类 | 编译模板 |
|------|--------|------|------|---------|
| `evaluation_mode` | fresh_turn | enum | 可配置 | `这是 {mode} evaluation。` |
| `priority` | state优先... | string | 可配置 | `{priority}，依据state判断阶段。` |
| `context_role` | conversationContext只用来... | string | 可配置 | 直接输出 |
| `conflict_resolution` | state与userInput冲突时... | string | 可配置 | `RULE-XX: {conflict_resolution}` |
| `fabrication_policy` | forbidden | enum | 可配置 | `RULE-XX: 不要编造...` |
| `fabrication_fallback` | 不确定就空白或继续追问 | string | 可配置 | 作为 fabrication_policy 的补充 |
| `update_strategy` | 基于当前输入... | string | 可配置 | `RULE-XX: {update_strategy}` |
| `no_mimicry` | 不要机械延续... | string | 可配置 | `RULE-XX: {no_mimicry}` |

**发现**：
- 这个块的字段非常具体，措辞都是精心设计的
- 不适合原子化（措辞很难模板化）
- 应该保持为**可配置的自由文本**

### 2. subject_focus（主体规则）

| 字段 | 当前值 | 类型 | 分类 |
|------|--------|------|------|
| `default_subject` | questioner_self | enum | 可配置 |
| `third_party_mention` | 即使用户提到孩子... | string | 可配置 |
| `no_third_party_plan` | 不要把方案主体... | string | 可配置 |
| `executability` | 问题与建议必须... | string | 可配置 |

**发现**：
- 这些字段之间有逻辑关联
- 可以考虑合并为一个描述块

### 3. behavior（行为规则）- **最复杂**

#### 3.1 顶层字段

| 字段 | 当前值 | 类型 | 分类 | 是否原子化？ |
|------|--------|------|------|------------|
| `max_questions_per_turn` | 1 | number | 可配置 | ✅ 适合原子化 |
| `questioning_priority` | 最近卡住场景 > ... | string | 可配置 | ❌ 自由文本 |
| `fabrication` | forbidden | enum | 可配置 | ✅ 适合原子化（重复） |
| `all_planning_for_questioner` | true | boolean | 可配置 | ✅ 适合原子化 |
| `avoid_closing_phrases` | 禁止频繁使用... | string | 可配置 | ❌ 自由文本 |
| `avoid_meta_workflow` | 少用'为了给你规划...' | string | 可配置 | ❌ 自由文本 |
| `precision_vs_detail` | 如果下一个问题... | string | 可配置 | ❌ 自由文本 |

#### 3.2 understanding_stage（理解阶段规则）

**12 个子字段**，都是具体的行为指导：

| 字段 | 类型 | 是否原子化？ |
|------|------|------------|
| `reply_structure` | string | ❌ 自由文本 |
| `tone` | string | ✅ 可枚举 |
| `no_interrogation` | string | ❌ 自由文本 |
| `no_meta_explanation` | string | ❌ 自由文本 |
| `handle_vague_difficulty` | string | ❌ 自由文本 |
| `empathy_type` | string | ✅ 可枚举 |
| `empathy_example` | string | ❌ 自由文本 |
| `progress_awareness` | string | ❌ 自由文本 |
| `short_reply_handling` | string | ❌ 自由文本 |
| `real_problem_diagnostic` | string | ❌ 自由文本 |
| `background_capture` | string | ❌ 自由文本 |
| `learning_signal_capture` | string | ❌ 自由文本 |

#### 3.3 proposing_stage（提议阶段规则）

**11 个字段**，混合了结构化和自由文本：

| 字段 | 类型 | 是否原子化？ |
|------|------|------------|
| `scope` | string | ✅ 可枚举 |
| `detail_level` | string | ❌ 自由文本 |
| `focus_clarity` | string | ❌ 自由文本 |
| `nature` | string | ❌ 自由文本 |
| `required_content` | array | ⚠️ 半结构化 |
| `ending` | string | ❌ 自由文本 |
| `zero_base_rule` | string | ❌ 自由文本 |

#### 3.4 ready_stage（准备阶段规则）

| 字段 | 类型 | 是否原子化？ |
|------|------|------------|
| `scope` | string | ✅ 可枚举 |
| `no_expansion` | string | ❌ 自由文本 |

---

## 🔍 Rules 结构问题总结

### 问题 1：字段过于细碎
- `behavior.understanding_stage` 有 12 个字段
- 很多字段是一次性的规则描述，不会复用
- 原子化反而增加复杂度

### 问题 2：重复的概念
- `fabrication` 出现在多个地方：
  - `rules.context_usage.fabrication_policy`
  - `rules.behavior.fabrication`
- 应该合并

### 问题 3：层级不一致
- 有的是 `behavior.xxx`（顶层）
- 有的是 `behavior.understanding_stage.xxx`（嵌套）
- 缺乏统一的组织原则

---

## 📤 Output（输出规格）分析

| 字段 | 当前值 | 类型 | 分类 | 是否原子化？ |
|------|--------|------|------|------------|
| `format` | json | enum | 可配置 | ✅ 适合原子化 |
| `wrapper` | false | boolean | 可配置 | ✅ 适合原子化 |
| `no_preamble` | true | boolean | 可配置 | ✅ 适合原子化 |
| `no_explanation` | true | boolean | 可配置 | ✅ 适合原子化 |
| `no_apology` | true | boolean | 可配置 | ✅ 适合原子化 |
| `no_markdown_wrapper` | true | boolean | 可配置 | ✅ 适合原子化 |
| `no_natural_language` | true | boolean | 可配置 | ✅ 适合原子化 |
| `top_level_fields` | [array] | array | 可配置 | ⚠️ 半结构化 |
| `requirement` | 只输出... | string | 可推导 | ✅ 可从 format 推导 |

**发现**：
- 这个块非常适合原子化
- 很多 `no_xxx` 可以合并为一个 `forbidden_elements` 数组

**建议简化**：
```yaml
output:
  format: json
  wrapper: false
  forbidden_elements:
    - preamble
    - explanation
    - apology
    - markdown_wrapper
    - natural_language
  top_level_fields:
    - reply
    - state
    - understanding
    - nextQuestions
```

---

## 🚧 Constraints（边界约束）分析

当前格式：
```yaml
constraints:
  - subject: "默认面向提问者本人..."
  - fabrication: "不编造用户没有明确提供的信息..."
  - scope: "此阶段不直接替用户解决业务问题..."
```

**问题**：
- 为什么用对象数组而不是字符串数组？
- key（subject/fabrication/scope）有什么意义？
- 这些 key 和 rules 里的概念重复了

**建议**：
1. 如果 key 有分类意义，保留对象格式
2. 如果 key 无意义，改为字符串数组：
```yaml
constraints:
  - "默认面向提问者本人，不输出第三方作为主要学习执行者的计划"
  - "不编造用户没有明确提供的信息；不确定就保持空白或继续追问"
  - "此阶段不直接替用户解决业务问题，也不展开完整学习路径正文"
```

---

## 🔄 State Machine（状态机）分析

```yaml
state_machine:
  stages:
    - understanding
    - proposing
    - ready
  definitions:
    understanding: "..."
    proposing: "..."
    ready: "..."
  transitions:
    understanding_to_proposing:
      hard_requirements:
        - surface_goal
        - real_problem
        - available_resources
        - success_criteria
    proposing_to_ready:
      gate: "用户明确确认"
```

**发现**：
- 这是 conversational archetype 特有的
- 结构清晰，适合保留
- 可以考虑模板化（但要保留灵活性）

---

## 📊 字段分类总结

### 适合原子化的字段（可模板化）

| 字段路径 | 类型 | 原因 |
|---------|------|------|
| `behavior.max_questions_per_turn` | number | 简单数值，有明确编译规则 |
| `output.format` | enum | 枚举值，有固定编译模板 |
| `output.wrapper` | boolean | 布尔值，编译逻辑清晰 |
| `output.no_xxx` 系列 | boolean | 可合并为数组 |

### 不适合原子化的字段（保留自由文本）

| 字段路径 | 原因 |
|---------|------|
| `identity.mission` | 每个 Skill 都不同，措辞很重要 |
| `rules.context_usage.*` | 都是精心设计的具体指导 |
| `rules.behavior.understanding_stage.*` | 行为指导，不可模板化 |
| `rules.behavior.proposing_stage.*` | 同上 |
| `rules.behavior.avoid_xxx` 系列 | 反面指导，措辞重要 |

### 可推导的字段（自动生成）

| 字段路径 | 推导规则 |
|---------|---------|
| `skillId` | `skill:{blueprintId}` |
| `output.requirement` | 根据 `format` 自动生成 |
| `input.payload_structure` | 根据 `archetype` 自动生成 |

---

## 💡 核心发现

### 1. 大部分字段是**领域知识的精确表达**

Goal Conversation 的 rules 非常具体，是对学习辅导场景的深度理解。这些规则：
- 措辞经过精心设计
- 字段间有隐含的逻辑关联
- 很难模板化

**结论**：不要过度追求原子化，保留必要的自由文本配置。

### 2. 结构化 ≠ 模板化

YAML 已经提供了结构化，但不代表所有字段都能模板化。

**适合模板化的特征**：
- 值有限（枚举）
- 逻辑简单（数值、布尔）
- 编译规则明确

**不适合模板化的特征**：
- 措辞重要
- 上下文相关
- 一次性描述

### 3. 三层结构

```
固定模板层（编译器生成）
    ├─ 章节标题
    ├─ 基础结构
    └─ 自动编号

可配置层（用户填写）
    ├─ 简单原子（数值、枚举、布尔）
    └─ 复杂描述（自由文本）

推导层（自动生成）
    ├─ 冗余字段
    └─ 固定措辞
```

---

## 🎯 建议的 Schema 改进方向

### 改进 1：简化顶层元数据
```yaml
# 之前
blueprintId: goal-conversation
skillId: skill:goal-conversation  # 冗余
name: 目标对话
description: ...
version: 3.0.0
temperature: 0.7
maxTokens: 8000

# 之后
id: goal-conversation
name: 目标对话
description: ...
archetype: conversational
# skillId, temperature, maxTokens 使用默认值或推导
```

### 改进 2：合并 Output 的布尔字段
```yaml
# 之前
output:
  format: json
  wrapper: false
  no_preamble: true
  no_explanation: true
  no_apology: true
  no_markdown_wrapper: true
  no_natural_language: true

# 之后
output:
  format: json
  strict: true  # 不允许任何额外内容
  # 或者
  forbidden: [preamble, explanation, apology, wrapper, natural_language]
```

### 改进 3：Constraints 统一为字符串数组
```yaml
# 之前（对象数组，key 无意义）
constraints:
  - subject: "..."
  - fabrication: "..."
  - scope: "..."

# 之后（字符串数组）
constraints:
  - "默认面向提问者本人..."
  - "不编造信息..."
  - "不直接解决业务问题..."
```

### 改进 4：减少 Rules 的层级
```yaml
# 之前（3 层嵌套）
rules:
  behavior:
    understanding_stage:
      reply_structure: "..."
      tone: "..."

# 之后（2 层，用命名空间）
rules:
  understanding_reply_structure: "..."
  understanding_tone: "..."
  # 或者保持嵌套但减少字段数
```

---

## 🔜 下一步行动

### 立即做
1. ✅ 创建字段分析表（本文档）
2. 🔜 基于分析结果优化 YAML Schema
3. 🔜 更新编译器以支持优化后的 Schema
4. 🔜 验证编译结果和原 Prompt 的一致性

### 暂缓做
- ❌ 不要急着原子化所有字段
- ❌ 不要创建 atoms 和 modules 文件
- ❌ 保持 YAML 作为唯一的源文件

---

## 📋 字段清单（供参考）

### 必需字段（用户必须填写）
- `id`
- `name`
- `archetype`
- `identity.role`
- `identity.mission`
- `output.format`

### 可选字段（可以省略或使用默认值）
- `description`
- `version`
- `temperature`
- `maxTokens`
- `identity.scope`
- `rules.*`（根据 archetype 可能有默认值）
- `constraints`
- `state_machine`

### 自动推导字段（不需要用户填写）
- `skillId` = `skill:{id}`
- `output.requirement`（根据 format 生成）
- `input.payload_structure`（根据 archetype 生成）

---

**总结**：Goal Conversation 的配置非常具体和精细，不适合过度模板化。应该保持 YAML 作为灵活的配置格式，重点是优化结构和减少冗余，而不是强制原子化。
