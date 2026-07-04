# Prompt Lab Internal Prompt Skills

## 目标

本文定义 Prompt Lab 内部 prompt skills 的正式职责边界。

核心原则只有一句：

> 内部 prompt skill 负责 prose，不负责结构真相源。

也就是说，内部 prompt skills 是编译系统的子部件，不是作者态 source 的替代者，也不是整篇最终 markdown 的自由生成器。

## 为什么要单独定义

如果内部 prompt skill 直接生成整篇 prompt，会出现三个问题：

1. 结构权责被模型接管
2. source / candidate / runtime 的边界被冲淡
3. compile 结果难以做精细校验与稳定 diff

Prompt Lab 要“更标准”，就必须把这些权责切开。

## 正式职责边界

### 内部 prompt skills 应负责

- 身份段 prose 收束
- 行为规则 prose 化
- 字段说明 prose 化
- 示例文案草稿
- 风格统一和语言压缩

### 内部 prompt skills 不应负责

- 新增或删除章节
- 定义 section 顺序
- 定义 JSON key
- 定义 archetype
- 定义 frontmatter
- 决定状态机硬条件
- 决定平台禁用字段
- 决定 publish metadata

## 推荐结构

第一阶段推荐只保留一个核心内部 skill：

- `prose-compiler`

后续可选扩展：

- `example-writer`
- `style-normalizer`

不建议第一阶段就拆成多个强耦合 skill 并联生成整篇 prompt。

## 推荐编译模型

```text
Source Body + Manifest
  -> Deterministic Structure Compile
  -> Prose Slots
  -> prose-compiler
  -> Slot Fill
  -> Candidate Compose
```

也就是说：

- 结构先由代码定型
- 模型只补 slot
- 最终合成仍由代码完成

## `prose-compiler` 的推荐输入

推荐输入 JSON，而不是整篇 markdown 或整个 source dump。

建议输入结构：

```json
{
  "manifest": {
    "skillId": "goal-conversation",
    "archetype": "conversational",
    "name": "目标澄清助手"
  },
  "structurePlan": {
    "sections": ["identity", "input", "rules", "state_machine", "output", "constraints"],
    "ruleSlots": ["context_1", "context_2", "stage_logic_1"],
    "fieldNoteSlots": ["understanding.surface_goal", "understanding.real_problem"]
  },
  "sourceContext": {
    "identity": "...",
    "contextHandling": "...",
    "outputGuidance": "..."
  }
}
```

## `prose-compiler` 的推荐输出

推荐输出结构化 JSON，而不是整篇最终 markdown。

```json
{
  "identityText": "你是学习目标澄清与方向收敛助手...",
  "rulePhrases": [
    { "slotId": "context_1", "text": "优先依据 state 判断当前阶段和缺口。" },
    { "slotId": "stage_logic_1", "text": "信息足够时及时进入 proposing。" }
  ],
  "fieldNotes": {
    "understanding.surface_goal": "必须保留用户原话，不概括、不升级。",
    "understanding.real_problem": "应回答为什么会这样，而不是改写表面诉求。"
  },
  "exampleDrafts": []
}
```

## 为什么不用“整篇 markdown 输出”

因为整篇 markdown 输出会把以下事情全部交给模型：

- 章节顺序
- 字段名一致性
- 状态机硬门槛
- frontmatter
- 编号体系

这些都属于 deterministic compile 更适合拥有的东西。

## 目录约定

`prompt-lab/compiler-skill/` 建议逐步收成三类文件：

### 1. 当前 live compile contract

- `compile-spec.md`

### 2. 内部 prompt skill 约定

- `prose-compiler-contract.md`
- 后续如有需要再增加 `example-writer-contract.md`

### 3. 草拟/实验入口

- `config-spec.md`
- `test-cases.md`

## 设计建议

### 建议一：不要把 publishable skill source 放进 `compiler-skill/`

`compiler-skill/` 应表达“编译系统资产”。

`sources/` 应表达“对外 publishable authoring source”。

两者不要混用。

### 建议二：让内部 skill 成为编译器子部件，而不是唯一编译器

编译器本体应存在于代码中。

内部 skill 只是其中的 prose generation 模块。

### 建议三：把 internal skill 的输出也纳入 validator

例如检查：

- 是否填满必需 slots
- 是否引入不存在字段名
- 是否输出了不应生成的新 section

## 分阶段落地

### Phase 1

- 一个 `prose-compiler`
- 结构先由代码生成
- 仅填 identity / rules / field notes

### Phase 2

- 增加 examples 生成
- 增加风格压缩
- 增加 archetype-specific prose templates

### Phase 3

- 根据不同 skill family 拆出专门 prose policies
- 接入 compile telemetry 与 acceptance metrics

## 当前建议

当前 Prompt Lab 最稳的方向是：

- `compile-source` 逐步退出“全文黑盒生成”
- 引入 deterministic structure compile
- 保留一个小而稳的 internal prose skill

这比“继续让 LLM 直接生成整篇最终 prompt”更标准，也更利于后续治理。
