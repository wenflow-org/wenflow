# Prompt Lab

> **v4 现状注记（2026-07-28）**：统一 Skill 协议 v4 已落地（`doc/SKILL_PROTOCOL_V4.md`）。
> 业务真相源已迁移至 **`prompts/core/<skillId>.yaml`（核心文件）**，prompt 均为五块编译产物。
> 本目录中：`sources/`、`compiler-skill/`、`compiled/`、过程文档已归档至 `archive/`（v2 端点 compile-source/publish/sources 已随运营工作台上线移除）；`manifests/` 继续作为契约与执行参数的平台层家园；`backups/` 为回滚材料；`field-lineage.yaml` 为字段血缘注册表（可编辑）。
> 编辑入口：核心文件 → `POST /api/prompt-lab/compile-core`（预览+守门）→ `POST /api/prompt-lab/publish-core`（发布）；管理界面：Admin「Prompt 工作台」。

Prompt Lab 是 WenFlow 的独立 Prompt authoring / build 工作区。

它的职责不是直接充当平台运行时 `prompts/` 目录的编辑器，而是维护一套独立的作者态真相源，并把这套真相源编译、审核、导出到平台集成目标。

## 当前正式定义

Prompt Lab 内部的真相源分两部分：

- `sources/*.md`：Prompt 正文的唯一真相源
- `manifests/*.yaml`：Prompt 元数据的唯一真相源

Prompt Lab 内部的派生产物：

- `compiled/*.md`：候选编译产物，用于审核，不是源
- `backups/`：发布前快照或回滚材料，不是源

平台侧对象与 Prompt Lab 的关系：

- `wenflow/prompts/*.md`：当前平台集成目标之一，不是 Prompt Lab 的真相源
- `agent_prompts` / `compiledSystemPrompt` / runtime cache：运行时对象，不是 Prompt Lab 的真相源

一句话：

> Prompt Lab 负责作者态建模与编译；平台负责运行态消费与执行。

## 目录结构

```text
prompt-lab/
  sources/                 # 作者态正文真相源（唯一 body truth）
  manifests/               # 作者态元数据真相源（唯一 metadata truth）
  compiled/                # 候选编译产物（review target）
  backups/                 # 导出/发布前快照
  compiler-skill/          # 编译相关约定、内部 prompt skill 资产
  docs/                    # 架构、协议、编译与治理文档
  README.md
  STRUCTURE.md
```

详见：

- `STRUCTURE.md`
- `docs/ARCHITECTURE.md`
- `docs/SOURCE_PROTOCOL_V1.md`
- `docs/INTERNAL_PROMPT_SKILLS.md`

## 核心对象

### 1. Source Body

位置：`sources/<skillId>.md`

职责：

- 存放 `DEFINITIONS / EXECUTION` 结构化作者态正文
- 面向运营、策划、提示词设计者编辑
- 不直接等于平台当前运行 Prompt

### 2. Source Manifest

位置：`manifests/<skillId>.yaml`

职责：

- 存放 `skillId / agentId / archetype / name / description / runtimeDefaults` 等元数据
- 作为发布与导出的 metadata truth
- 让 Prompt Lab 不再依赖平台现有 `prompts/*.md` frontmatter 回读

`runtimeDefaults` 内建议显式包含 runtime `tier`，它和 `ownership.tier` 不是一回事：

- `runtimeDefaults.tier`：运行路由层级，例如 `chat / reasoning / light`
- `ownership.tier`：作者态归属或治理分层，例如 `production / experimental`

### 3. Candidate Artifact

位置：`compiled/<skillId>.md`

职责：

- 存放源码编译后的候选 Prompt
- 供审核、diff、验收使用
- 可被覆盖重算，不承担真相源职责

### 4. Export Target

当前平台集成目标之一：

- `wenflow/prompts/skill.*.md`
- `agent_prompts` ACTIVE 版本

注意：导出目标可以有多个，但都不应反向定义 Prompt Lab source。

### 5. Effective Runtime Prompt

运行时真正喂给模型的 prompt，可能进一步经过字段路由、引用展开、runtime compile 或缓存层处理。

它属于平台运行时层，不属于 Prompt Lab authoring truth。

## 生命周期

```text
Source Body + Source Manifest
  -> Source Validate
  -> Source Compile
  -> Candidate Review
  -> Export / Publish
  -> Platform Published Prompt
  -> Runtime Compile / Runtime Injection
  -> Effective Runtime Prompt
```

关键边界：

- 保存 source 不会自动重写运行态 truth
- compile 生成 candidate，不等于生效
- publish/export 才会推动到平台集成目标
- runtime compile 属于平台层，不属于 Prompt Lab source compile

## 页面职责

### Prompt Lab

负责：

- 编辑 source body
- 编辑 source manifest
- 编译 candidate
- 审核 candidate
- 导出或发布

不负责：

- 直接定义平台 runtime effective prompt 为真相源
- 承担运行时诊断页面的职责

### Skill 编辑器 / Runtime Workbench

负责：

- 查看当前 effective prompt
- 查看 runtime compile 状态
- 查看调用、漂移、缓存与参数
- 跳转到 Prompt Lab 进行 source 编辑

不负责：

- 充当 Prompt Lab 唯一 source 编辑入口

## 当前实现与目标架构的关系

当前代码已经具备一部分真实能力：

- `sources/*.md` 已经是 live 作者态正文
- `compile-source` 已经会把 source 编译到 `compiled/*.md`
- `PromptLab.vue` 和 `PromptWorkbench.vue` 已经能编辑 source

但仍有几项待收口债务：

- 当前 compile 仍偏向 LLM 全文生成，而不是 hybrid compile
- publish 结果还未完全与平台 runtime compile 字段模型统一
- `sources/` 与 `compiler-skill/` 的资产分类仍需继续清晰化

这些债务不影响 Prompt Lab 的正式定义，但会影响后续落地节奏。

## 文档分层

当前文档以这几份为准：

- `docs/ARCHITECTURE.md`：系统边界与对象模型
- `docs/SOURCE_PROTOCOL_V1.md`：source 文件协议
- `docs/INTERNAL_PROMPT_SKILLS.md`：内部 prompt skill 设计
- `docs/COMPILER_GUIDE.md`：编译流程与职责拆分

旧的 blueprint / YAML 设计文档仍保留为历史探索材料，但不再代表当前 Prompt Lab 的正式模型。
