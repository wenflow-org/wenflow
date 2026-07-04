# Prompt Lab 架构说明

## 定位

Prompt Lab 是 WenFlow 的独立 Prompt authoring / build 子系统。

它的目标不是直接把平台当前 `prompts/` 目录变成可视化编辑器，而是先在 `prompt-lab/` 域内建立一套自洽的作者态真相源、编译产物与导出边界。

这意味着：

- Prompt Lab 有自己的 source truth
- Prompt Lab 有自己的编译语义
- 平台运行时只消费 Prompt Lab 导出的结果
- 平台运行时状态不能反向定义 Prompt Lab source

## 架构原则

### 1. Source First

Prompt Lab 的唯一真相源在 `prompt-lab/` 内部。

- 正文真相源：`sources/*.md`
- 元数据真相源：`manifests/*.yaml`

### 2. Compile Is Explicit

source 的保存不等于运行态生效。

- 保存 source：只更新作者态
- compile：生成 candidate
- publish / export：推动到平台集成目标

### 3. Runtime Is Downstream

平台 `prompts/*.md`、DB active prompt、cache、runtime compile 都属于下游消费层。

它们是重要集成对象，但不是 Prompt Lab source truth。

### 4. Structure Before Prose

结构、契约、章节映射、字段与状态机应该尽量由确定性编译器拥有；LLM 只负责受约束的 prose 生成。

### 5. Prompt Lab And Skill Editor Serve Different Jobs

- Prompt Lab：作者态建模、编译、审核、发布
- Skill 编辑器：运行态观察、诊断、参数与有效 prompt 查看

## 领域对象模型

### Source Body

定义：作者态正文文件。

位置：`prompt-lab/sources/<skillId>.md`

职责：

- 使用 `DEFINITIONS / EXECUTION` 结构表达 skill 的作者态内容
- 面向可视化编辑器和结构化编辑器
- 不直接承担运行态格式要求

### Source Manifest

定义：作者态元数据文件。

位置：`prompt-lab/manifests/<skillId>.yaml`

职责：

- 提供 `skillId / agentId / archetype / description / publishable / runtimeDefaults`
- 作为导出前 frontmatter 与 runtime 参数的来源
- 避免 Prompt Lab 反向依赖平台当前 `prompts/*.md` metadata

注意：

- `runtimeDefaults.tier` 属于 runtime route tier
- `ownership.tier` 属于作者态归属/治理 tier

两者不要混用。

### PromptLab IR

定义：Prompt Lab 编译阶段的中间表示。

它不必直接落盘，但架构上应存在。

建议包含：

- `manifest`
- `definitions.identity`
- `definitions.inputFields`
- `definitions.outputSchema`
- `definitions.stages`
- `execution.format`
- `execution.contextHandling`
- `execution.stageLogic`
- `execution.outputGuidance`
- `execution.constraints`
- `execution.qualityControl`
- `execution.examples`

### Candidate Artifact

定义：source compile 的候选产物。

位置：`prompt-lab/compiled/<skillId>.md`

职责：

- 作为 review target
- 可供 diff、lint、acceptance test 使用
- 不承担真相源职责

### Exported Prompt

定义：Prompt Lab 发布到外部平台或其他集成目标的导出产物。

当前平台目标包括：

- `wenflow/prompts/skill.*.md`
- DB `agent_prompts` ACTIVE 版本

### Effective Runtime Prompt

定义：平台真正喂给 LLM 的 prompt。

它可能进一步经过：

- runtime field routing
- field ref resolve
- `compiledSystemPrompt` 生成
- cache

它不属于 Prompt Lab source domain。

## 生命周期

```text
Source Body + Source Manifest
  -> Source Validation
  -> PromptLab IR
  -> Source Compile
  -> Candidate Artifact
  -> Candidate Review / Acceptance
  -> Export / Publish
  -> Platform Published Prompt
  -> Runtime Compile / Runtime Injection
  -> Effective Runtime Prompt
```

## 编译层拆分

Prompt Lab 和平台内部同时存在两种“编译”，必须严格区分。

### A. Source Compile

所属：Prompt Lab

输入：

- `sources/*.md`
- `manifests/*.yaml`
- `compiler-skill/` 下的编译规则与内部 prompt skills

输出：

- `compiled/*.md`
- 导出所需的 frontmatter / runtime defaults / metadata

目标：

- 生成 canonical publish candidate

### B. Runtime Compile

所属：平台 runtime

输入：

- published prompt
- routing / runtime context

输出：

- `compiledSystemPrompt`
- effective runtime prompt

目标：

- 在不改变作者态真相源的情况下，让运行时拿到适合执行的版本

## 页面边界

### Prompt Lab 页面

职责：

- 选择 skill
- 编辑 source body
- 编辑 manifest
- 编译 candidate
- 审核 candidate
- 发布或导出

页面语义应明确表达：

- `source 已保存`
- `candidate 已编译`
- `当前运行态未变`
- `发布后才会推动到平台`

### Skill 编辑器 / Runtime Workbench

职责：

- 查看 effective prompt
- 查看 runtime compile 状态
- 查看 drift / cache / model config
- 必要时跳转到 Prompt Lab

不应承担：

- Prompt Lab 唯一 source 编辑入口
- Prompt Lab 作者态真相源治理职责

## 数据所有权约束

### Prompt Lab 拥有

- source body
- source metadata
- compile contract
- candidate artifacts

### 平台拥有

- published prompt storage
- runtime model config
- runtime compile result
- execution logs / telemetry / cache

### 严禁的反向依赖

- 不应再从 `prompts/*.md` 回推 Prompt Lab source truth
- 不应把 runtime effective prompt 当成作者态 source
- 不应让 Skill 编辑器直接取代 Prompt Lab source 协议

## 当前实现债务

当前仓库里仍有几处实现债务，和正式架构相比存在差距：

1. `compile-source` 仍偏向 LLM 全文生成
2. publish 结果仍未完全落到平台 runtime compile 字段模型
3. `sources/` 和 `compiler-skill/` 的资产分类仍需进一步清晰化

这些债务属于接入节奏问题，不改变本文定义的正式架构方向。

## 迁移原则

从当前实现走向正式架构，推荐按以下顺序推进：

1. 文档和术语先定型
2. Source Protocol v1 落地校验器
3. Source compile 从全文 LLM 转向 hybrid compile
4. publish 与 runtime compile 字段模型继续收口
5. 最后再考虑是否把 Prompt Lab 能力嵌入 Skill 编辑器

## 关联文档

- `SOURCE_PROTOCOL_V1.md`
- `INTERNAL_PROMPT_SKILLS.md`
- `COMPILER_GUIDE.md`
