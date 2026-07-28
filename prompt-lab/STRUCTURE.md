# Prompt Lab 目录结构

> **v4 现状注记（2026-07-28）**：本文描述 v2 目录模型。v4 落地后：
> - 业务 SSOT = `wenflow/prompts/core/<skillId>.yaml`（核心文件），不在本目录
> - `sources/`、`compiler-skill/`、`compiled/` 及 docs/ 过程稿已移至 `archive/`（v2 端点已移除）
> - `manifests/` 保留（契约 + 执行参数）；`backups/` 保留（回滚材料）；`field-lineage.yaml` 为字段血缘注册表

本文件描述的是 Prompt Lab 当前正式目录模型，而不是早期 blueprint / YAML 实验目录。

## 当前目录树

```text
prompt-lab/
  sources/                       # 唯一正文真相源
    goal-conversation.md
    path-planning.md
    teaching-turn.md
    ...

  manifests/                     # 唯一元数据真相源
    _template.yaml
    README.md
    # 后续正式接入后，每个 publishable skill 一个 manifest

  compiled/                      # 候选编译产物
    goal-conversation.md
    label-generator.md
    ...

  backups/                       # 导出/发布前快照
    goal-conversation/
    path-planning/
    adaptive-guidance-copy/

  compiler-skill/                # 编译相关资产
    README.md
    compile-spec.md
    config-spec.md
    prose-compiler-contract.md
    test-cases.md

  docs/                          # 规范与治理文档
    ARCHITECTURE.md
    SOURCE_PROTOCOL_V1.md
    INTERNAL_PROMPT_SKILLS.md
    COMPILER_GUIDE.md
    ...

  README.md
  STRUCTURE.md
```

## 目录职责

### `sources/`

唯一正文真相源。

约束：

- 每个 publishable skill 一个文件：`sources/<skillId>.md`
- 使用 `# DEFINITIONS` / `# EXECUTION` 结构
- 面向作者态编辑
- 不承载平台 runtime 生成态信息

### `manifests/`

唯一元数据真相源。

建议每个 skill 一个 manifest：`manifests/<skillId>.yaml`

典型字段：

- `skillId`
- `agentId`
- `name`
- `archetype`
- `description`
- `acceptableAgentIds`
- `runtimeDefaults`
- `publish`
- `ownership`

其中：

- `runtimeDefaults.tier` 用于运行路由分层
- `ownership.tier` 用于作者态治理分层

### `compiled/`

候选编译产物目录。

特点：

- 由 source compile 生成
- 用于 review / diff / 验收
- 可被覆盖，不承担真相源职责

### `backups/`

发布或导出前的快照目录。

特点：

- 以 skill 为子目录
- 一次发布一个时间戳文件
- 仅用于回滚或审计

### `compiler-skill/`

Prompt Lab 编译系统资产目录。

这里放两类东西：

- 当前 live compile contract
- 后续 hybrid compile 所需的内部 prompt skill 约定

重要边界：

- 这里存放的是编译系统资产，不是对外 publishable skill source
- 不要把它和 `sources/` 混成同一语义空间

### `docs/`

Prompt Lab 正式文档目录。

推荐阅读顺序：

1. `ARCHITECTURE.md`
2. `SOURCE_PROTOCOL_V1.md`
3. `INTERNAL_PROMPT_SKILLS.md`
4. `COMPILER_GUIDE.md`

## 文件命名规范

### Source Body

```text
sources/<skillId>.md
```

示例：

```text
sources/goal-conversation.md
sources/path-planning.md
```

### Source Manifest

```text
manifests/<skillId>.yaml
```

示例：

```text
manifests/goal-conversation.yaml
manifests/path-planning.yaml
```

### Candidate Artifact

```text
compiled/<skillId>.md
```

### Backup Snapshot

```text
backups/<skillId>/<timestamp>.md
```

## 数据所有权

Prompt Lab 内部的所有权约束：

- `sources/` 拥有 body truth
- `manifests/` 拥有 metadata truth
- `compiled/` 只拥有 candidate snapshot
- `backups/` 只拥有 rollback snapshot

平台侧对象不拥有 Prompt Lab source truth：

- `wenflow/prompts/*.md`
- `agent_prompts`
- `compiledSystemPrompt`
- runtime cache

## 当前迁移状态

### 已经成立

- `sources/*.md` 已经是 live source body
- `compiled/*.md` 已经被 `compile-source` 使用
- `backups/` 已经承担发布前快照职责

### 正在补齐

- `manifests/` 作为 metadata truth 的正式接入
- source compile 与 runtime compile 的职责分离
- internal prompt skills 的 hybrid compile 设计

### 明确不再作为当前结构真相的旧模型

以下目录模型属于历史实验，而不是当前正式结构：

- `blueprints/`
- `prompts/` 作为 Prompt Lab 内部编译产物目录
- 前端 `blueprintCompiler.ts` 作为 Prompt Lab 当前唯一编译器
