# 已归档：Prompt Lab Source Protocol v1

> v1 source 协议已由统一 Skill 协议 v4 取代。

## 目标

Prompt Lab Source Protocol v1 定义的是 Prompt Lab 作者态正文文件的正式协议。

它回答两个问题：

1. `sources/*.md` 里到底允许写什么
2. 这些作者态 section 将如何映射到编译后的 canonical prompt

本协议只约束 Prompt Lab source body。

它不等于平台运行时 prompt 协议，也不等于 `prompts/*.md` 的最终格式。

## 文件范围

协议文件位置：

```text
prompt-lab/sources/<skillId>.md
```

每个 publishable skill 一个 source file。

## 与 Manifest 的关系

Source body 只负责正文，不负责完整 metadata。

以下字段不属于 source body 主体职责，应由 `manifests/<skillId>.yaml` 提供：

- `skillId`
- `agentId`
- `name`
- `archetype`
- `description`
- `acceptableAgentIds`
- `runtimeDefaults`
- `publish` 策略

补充约束：

- manifest 文件路径中的 `<skillId>` 是该 skill 的稳定标识
- manifest 内容中的 `skillId` 不应与文件名漂移
- `agentId` 若无特殊兼容需求，默认应为 `skill:<skillId>`

## 顶层结构

每个 source 文件必须使用两个 H1 根段：

```markdown
# DEFINITIONS
...

# EXECUTION
...
```

约束：

- `DEFINITIONS` 在前
- `EXECUTION` 在后
- 不允许增加第三个同级 root section 作为正式结构

## `DEFINITIONS` 段职责

`DEFINITIONS` 负责静态契约、字段定义和状态空间说明。

### 建议 section

- `## Identity`
- `## Input`
- `## Output Schema`
- `## Stages`

### `Identity`

用途：

- 定义角色、任务、边界和总体工作对象

类型：

- prose 文本

### `Input`

用途：

- 定义输入字段与含义

推荐格式：Markdown 表格

```markdown
| field | type | required | description |
|-------|------|----------|-------------|
| userInput | string | yes | 当前轮用户输入 |
```

建议列：

- `field`
- `type`
- `required`
- `description`

### `Output Schema`

用途：

- 定义输出对象的顶层字段与核心子结构
- 为 compile 阶段提供输出契约来源

当前推荐格式：

- prose 总说明
- H3 字段块
- bullet 子字段

示例：

```markdown
## Output Schema

只输出一个合法 JSON 对象。

### reply · string
回复文本。

### state · object
`{ "stage": "understanding | proposing | ready", "confidence": 0-0.99 }`

### understanding · object
- **surface_goal** · string — 用户原始诉求锚点
- **real_problem** · string — 诊断结论
```

### `Stages`

用途：

- 定义对话阶段
- 定义推进门槛
- 为 compile 阶段提供状态机结构来源

推荐格式：

- 阶段表
- 硬条件列表
- 软信息列表

示例：

```markdown
## Stages

| stage | description |
|-------|-------------|
| understanding | 澄清目标与处境 |
| proposing | 给出第一版方向并请求确认 |
```

## `EXECUTION` 段职责

`EXECUTION` 负责行为、格式、约束和字段填充指导。

### 建议 section

- `## Format`
- `## Context Handling`
- `## Stage Logic`
- `## Output Guidance`
- `## Constraints`
- `## Quality Control`
- `## Examples`

### `Format`

定义输出包装、顶层对象形式、禁止性包装说明等。

### `Context Handling`

定义如何看待当前轮输入、历史摘要、state 优先级、冲突处理等。

### `Stage Logic`

定义阶段推进逻辑。

仅 `conversational` archetype 通常需要显式 `Stages + Stage Logic` 配合。

### `Output Guidance`

定义各字段如何填写。

典型内容：

- `reply` 如何说
- `surface_goal` 如何保持原话
- `real_problem` 如何形成诊断
- `confirmedProposal` 如何收敛

### `Constraints`

定义边界约束。

推荐格式：bullet list

### `Quality Control`

定义 source 侧自检点。

可选，但强烈建议保留。

### `Examples`

提供输入输出示例。

可选，但对 compile 和验收很有价值。

## Archetype 约束

archetype 来自 manifest，不从 source 文件本身推断为唯一真相。

### conversational

通常要求：

- `Identity`
- `Input`
- `Output Schema`
- `Stages`
- `Format`
- `Context Handling`
- `Stage Logic`
- `Output Guidance`
- `Constraints`

### generator

通常要求：

- `Identity`
- `Input`
- `Output Schema`
- `Format`
- `Context Handling`
- `Output Guidance`
- `Constraints`

通常不要求显式 `Stages`。

### extractor / distiller / copywriter

通常要求：

- `Identity`
- `Input`
- `Output Schema`
- `Format`
- `Context Handling`
- `Output Guidance`
- `Constraints`

是否保留 `Stage Logic` 视具体场景决定，但不应硬套 conversational 状态机。

## Compile Mapping

Source protocol 不是最终 runtime prompt 章节，但应稳定映射到 canonical prompt。

推荐映射：

| Source Section | Compiled Target |
|---|---|
| `Identity` | `## 身份定义` |
| `Input` | `## 输入说明` |
| `Output Schema` | `## 输出规格` 的结构骨架 |
| `Stages` | `## 状态机` |
| `Format` | `## 输出规格` 中的格式约束部分 |
| `Context Handling` | `## 执行规则` |
| `Stage Logic` | `## 执行规则` / `## 状态机` |
| `Output Guidance` | `## 输出规格` 的字段说明部分 |
| `Constraints` | `## 边界约束` |
| `Quality Control` | `## 质量控制` |
| `Examples` | `## 示例` |

## 协议约束

### 必须

- 根结构必须是 `DEFINITIONS / EXECUTION`
- section 标题应保持稳定英文命名
- source 内容必须面向作者态表达，而不是直接复制最终 runtime prompt

### 不建议

- 在 source 中直接手写最终 frontmatter
- 在 source 中强绑定平台特定运行元数据
- 把 source 当作平台 `prompts/*.md` 的镜像副本

### 禁止

- 让 `compiled/*.md` 反向覆盖 source truth
- 用 runtime effective prompt 回写 source

## 验证建议

Prompt Lab 后续应为本协议增加专用 validator，至少校验：

- 根结构是否完整
- 必需 section 是否存在
- Input 表格列是否齐全
- Output Schema 是否含核心顶层字段
- conversational archetype 是否提供 `Stages`
- Constraints 是否存在

## 与平台 Prompt 协议的关系

本协议只定义作者态 source。

平台最终 prompt 协议可以继续使用另一套规范，但那是 compile target，不是 source truth。
