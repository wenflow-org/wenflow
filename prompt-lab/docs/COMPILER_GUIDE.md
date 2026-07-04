# Prompt Lab 编译指南

## 本文作用

本文定义 Prompt Lab 当前和目标态的编译模型，用来回答三件事：

1. Prompt Lab 到底编译什么
2. 哪些部分应由代码确定性生成
3. 哪些部分适合交给内部 prompt skills 生成

## 两种编译，必须分开命名

### 1. Source Compile

Prompt Lab 自己的作者态编译。

输入：

- `sources/<skillId>.md`
- `manifests/<skillId>.yaml`

输出：

- `compiled/<skillId>.md`
- 导出所需 metadata

职责：

- 把作者态 source 转成 canonical candidate prompt

### 2. Runtime Compile

平台运行时编译。

输入：

- published prompt
- runtime routing / refs / context

输出：

- runtime effective prompt

职责：

- 让平台在运行阶段拿到适合执行的 prompt

## 当前状态

### 已存在能力

- Prompt Lab 已有 `compile-source`
- 当前会读取 `sources/*.md` 和 `compiler-skill/compile-spec.md`
- 生成物会落到 `compiled/*.md`

### 当前问题

当前 `compile-source` 仍然偏向：

- 把 source 全量丢给 LLM
- 让模型同时负责结构映射和 prose 成文

这会导致：

- 结构权责不稳定
- metadata 与章节规则难以严控
- compile 行为不容易做精细验证

## 正式推荐模型

推荐使用：

> 确定性结构编译 + 受约束 prose skill

也就是 hybrid compile。

## 职责拆分

### 确定性结构编译器负责

- 读取 source body 与 manifest
- 建立 PromptLab IR
- archetype 校验
- section 映射
- section 顺序
- 章节标题
- frontmatter 生成
- input/output schema 结构生成
- stage scaffold 生成
- 编号策略
- 平台禁用字段
- 最终 compose
- compile diagnostics

### 内部 prose skill 负责

- 身份段的措辞整理
- 行为规则 prose 化
- 字段说明 prose 化
- 示例文案草稿
- 风格收紧和一致性润色

### 内部 prose skill 不负责

- 新增或删除章节
- 修改字段名
- 决定 JSON key
- 决定 archetype
- 决定编号体系
- 决定状态机硬门槛
- 生成 frontmatter

## 推荐流水线

```text
Load Source Body
  -> Load Source Manifest
  -> Parse Source
  -> Build PromptLab IR
  -> Validate Source
  -> Deterministic Structure Compile
  -> Call Internal Prose Skill
  -> Compose Candidate
  -> Lint Candidate
  -> Review / Acceptance
  -> Export / Publish
```

## Deterministic Structure Compile

建议先由代码生成一份骨架，再把需要 prose 的位置标成 slots。

示例：

```text
## 身份定义
{{identityText}}

## 输入说明
...由代码生成字段骨架...

## 执行规则
### 上下文处理
{{rule.context_1}}
{{rule.context_2}}

## 输出规格
...由代码生成字段结构...
{{fieldNote.understanding.real_problem}}
```

这样模型只填 slot，不拥有整体结构。

## 内部 Prose Skill

推荐第一阶段只保留一个核心内部 skill：

- `prose-compiler`

它接收结构化 JSON 输入，返回结构化 JSON 输出。

不建议第一阶段就做：

- 多 skill 串联生成整篇 prompt
- 让 LLM 直接返回最终 markdown 全文

## Compile Diagnostics

Prompt Lab compile 应把错误和警告当成正式概念。

### Error

- source 缺失必需 section
- archetype 与 section 不匹配
- `Input` 表格字段不合法
- `Output Schema` 缺失核心定义
- `Stages` 结构不完整
- manifest 缺失 `skillId / agentId / archetype`

### Warning

- prose slot 为空
- 示例未提供
- 约束与规则描述可能重复
- candidate 过长
- 可导出但建议补齐 metadata

## 与当前 `compile-spec.md` 的关系

`compiler-skill/compile-spec.md` 目前仍是 live compile contract。

在 hybrid compile 体系下，它的角色应逐步收敛为：

- section 映射规则说明
- deterministic compiler 的参考契约
- 内部 prose skill 的上下文补充材料

而不是继续充当“整篇 markdown 生成提示词”的唯一黑盒入口。

## 与简化 YAML config 的关系

`compiler-skill/config-spec.md` 代表另一类入口：

- sparse config
- 快速原型
- 草拟新 skill

它可以继续存在，但不应取代 `sources/*.md + manifests/*.yaml` 这条正式 authoring 流程。

推荐关系：

- `config-spec.md`：草拟入口
- `sources/*.md`：正式 source body
- `manifests/*.yaml`：正式 metadata truth

## 第一阶段落地建议

1. 先把 `manifests/` 接入 source compile
2. 先做 `parse source -> IR -> deterministic skeleton`
3. 用一个 `prose-compiler` 内部 skill 只填 prose slots
4. 用现有 lint / schema 能力校验 candidate
5. publish 只从 Prompt Lab truth 导出，不再借平台 `prompts/*.md` frontmatter
