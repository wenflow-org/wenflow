# Agent I/O 设计 V3：Agent 中心的字段路由模型

> 📌 类型：活规范（字段路由的概念模型；声明源的规范性定义见 [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) §2.6，表结构以 `backend/prisma/system/schema.prisma` 为准）｜索引见 [doc/README.md](./README.md)。

适用：平台后端与前端管理台。受众：平台开发者、运营管理员、新接手字段路由体系的工程师。

---

## 1. 设计动机与核心理念

### 1.1 要解决的问题

- **字段调度散落在多处硬编码**：要在 goal 阶段加一个字段（如 `preferredLanguage`），需要改 8–15 处代码（prompt、TS 类型、归一化、可见摘要类型与构造、下游定帧、数据契约文档）。
- **可见性分层没有统一归一层**：各 agent 的 `parse*Response` 各自承担 normalize 责任，实现风格不一。
- **「hidden 字段」只靠三层软约束**：prompt 提示模型不要塞进回复、后端不主动暴露但全字段透传、前端约定不读——没有任何代码层强约束。

根因：把「字段可见性」当成字段自身的属性。而同一个字段在不同消费侧（用户视图 / 路径阶段 / 测试模式）本就有不同可见性；也没有回答「字段如何流到下游」。

### 1.3 核心理念

> **平台内部由 Agent 协调器驱动能力节点（Skill）来实现一组范围功能；每个字段的「路由策略」（透出前端 / 交给下游 / 仅内部 / 累积画像）由所属 Agent 决定，admin 在网页上编辑。**

| 旧做法 | 现行模型 |
|---|---|
| 字段可见性是字段自己的属性 | **字段的路由策略是 Agent 对它的标签** |
| Agent / Skill 概念混用 | **统一为 Skill**（「Agent」只作协调器与历史名称） |
| 字段调度散落代码 | **按路由声明统一调度** |
| 加字段要改多处代码 | **加字段是 admin 可完成的安全操作** |

设计目的：让「加一个字段、改一个字段、删一个字段、调整字段流向」都是安全可控的 admin 操作，而不需要改代码。

---

## 2. 核心模型

### 2.1 三层概念：Field / Skill / Agent

| 层 | 职责 | 契约 | 例子 |
|---|---|---|---|
| **Agent**（协调器） | 驱动一组 Skill，实现一组范围功能 | 自身输入字段 + 自身输出字段 + 下辖 Skill 的字段路由策略 | `goal-agent` / `path-agent` |
| **Skill**（能力节点） | 实现单一原子能力（对话 / 规划 / 解析） | 输入 schema + 输出字段集合 | `skill:goal-conversation` |
| **Field**（字段） | 原子数据单元 | id / 类型 / 在原始输出中的路径 | `real_problem`、`background_experience` |

### 2.2 命名约定（agent → skill 统一）

- 「Skill」是能力节点，平台内部基本单元；「Agent」是协调器，驱动若干 Skill。
- Skill 的 id 统一用 `skill:<name>` 前缀；运行时与接口入参都经 `getCanonicalAgentId` 归一到这个 canonical 形式，别名 id 不会落库。

### 2.3 Agent 中心：字段路由策略归 Agent 所有

字段路由策略不是字段自己的属性，而是 **Agent 对字段的标签**。例：字段 `real_problem` 由 `skill:goal-conversation` 产出，它的路由在 `prompts/orchestration/goal.yaml` 里声明：

```yaml
- agentId: skill:goal-conversation
  fieldId: understanding.real_problem
  render: visible            # 透出给前端
  handoff: [goal-agent]      # 交给哪些下游
  internal: false
  accumulate: true
  visibilityPreset: user-clarification
```

模型允许同一字段出现在不同 Agent 下并有不同路由（`agent_field_routings` 以 `agentId + fieldId` 唯一）。

---

## 3. 数据模型

四张表都在 **system database**（`backend/prisma/system/schema.prisma`），不动业务库。下面只列关键字段，完整列定义以 schema 为准。

### 3.1 field_definitions（字段身份）

| 列 | 含义 |
|---|---|
| `stage` + `fieldId` | 字段身份；fieldId 在 stage 内唯一，跨 stage 允许同名（如 teaching / simulation 都有 `reply`） |
| `promptRole` | 字段在 prompt 中的角色（§4.2） |
| `valueType` / `enumValues` | 取值类型与枚举值 |
| `snakeName` / `camelName` / `persistKey` | 命名与落库键别名（落库键与 fieldId 不一致时单独标注，仅供展示与对账） |
| `pathInRawOutput` | 值抽取路径：字段值在产出方原始输出中的物理位置（如 `internal.ext.goalConversation.understanding.real_problem`），是配置式值流转的抽取依据；空 = 尚未登记 |
| `source` / `managedByCode` | 归属：`code`（由代码/编排文件管理）或 `admin` |
| `systemLocked` / `structureLocked` / `bindings` | 锁（§3.6）与绑定信息 |

### 3.2 agent_contracts（Agent 自身契约）

一个 agent 一行：`agentId`（唯一）、`stage`、`displayName`、`description`、`metadata`。Agent 的输入与下游关系**不在本表上**——由 v4 inputs 声明 + 路由的 `handoff` 表达。

### 3.3 agent_field_routings（字段路由策略）

admin 操作的主表，每个 `(agentId, fieldId)` 一行：

| 列 | 含义 |
|---|---|
| `render` | `visible` / `hidden`：是否透出给前端 |
| `handoff` | 交给哪些下游 Agent |
| `internalFlag` | 仅本 Agent 内部使用 |
| `accumulate` | 累积到 learner profile 的标注 |
| `visibilityPreset` | 可见性预设（§4.3） |
| `ordering` / `notes` | 展示顺序与备注 |
| `systemLocked` / `structureLocked` | 行级锁 |

### 3.5 node_config_changes（审计）

字段路由相关的改动留痕：`changeType`（如 `routing-patch`）、`targetTable` / `targetId`、`agentId` / `fieldId`、改前改后快照（`before` / `after`）、操作人（`actorId` / `actorRole`）与原因。

### 3.6 锁机制

锁级别由两个布尔列派生，字段定义与路由行上各有：

| 级别 | 条件 | 效果 |
|---|---|---|
| system-locked | `systemLocked = true` | 路由行禁止行级修改 |
| structure-locked | `structureLocked = true`（且未 system-locked） | 路由行禁止行级修改 |
| fully-editable | 两者皆否 | 可行级编辑 |

字段定义级锁会传导：字段被锁 → 它的所有路由行都锁定。锁目前只拦路由行的行级修改，不拦字段删除。

### 3.7 编辑与审计规则

- **编排文件是唯一声明源**：`prompts/orchestration/<stage>.yaml`（File-as-Truth）。字段定义只走编排文件。
- **行级 PATCH 只编辑路由行属性**（`render` / `handoff` / `internal` / `accumulate` / `visibilityPreset` / `notes`），落库前把改动回写编排文件对应条目；文件写失败则整体拒绝，DB 与文件不产生分叉。
- 上锁的路由行禁止行级修改；每次行级修改写一条 `node_config_changes` 审计。

---

## 4. 字段路由模型详解

### 4.1 路由四属性：render / handoff / internal / accumulate

| 属性 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `render` | `visible` / `hidden` | `visible` | 是否透出给前端渲染 |
| `handoff` | string[] | `[]` | 交给哪些下游 Agent |
| `internal` | boolean | `false` | 仅本 Agent 内部使用（不进 envelope） |
| `accumulate` | boolean | `false` | 累积到 learner profile 的标注 |

四个属性不互斥，可同时成立。实现边界：`accumulate` 在运行时只产出 prompt 标签「累积到 learnerProfile」，不做写入；需要落库的事件走 **DB outbox**（与业务写入同事务，由 `backend/src/events/outbox.worker.ts` 消费），不走进程内事件总线。

### 4.2 promptRole 7 类

| 角色 | 界面标签 | 含义 |
|---|---|---|
| `hard-required` | 必填 | 缺了这个字段，本阶段流程就无法推进 |
| `soft-info` | 可选补充 | 拿到更好，缺失也能继续 |
| `hidden-inference` | 隐式推断 | 模型内部推理，不直接展示给用户 |
| `public-reply` | 公开回复 | 直接呈现给用户看的对话内容 |
| `proposal-output` | 方案产出 | 确认下来的结论 / 计划 / 范围 |
| `derived-presentation` | 派生展示 | 由其他字段计算派生，用于界面展示 |
| `control-signal` | 控制信号 | 平台流程 / UI 控制用，不是学习内容 |

受控词表与人话映射的单源是 `backend/src/services/yaml-vocabulary.ts`（`PROMPT_ROLES` / `PROMPT_ROLE_META`）；prompt 分组标签、运营术语表、字段路由表图例都从它派生，不得各写一份字面量。

### 4.3 visibilityPreset 与 reachability

- `visibilityPreset` 是受控词表，目前两个值：`user-clarification`（用户澄清得来的字段）与 `agent-internal`（Agent 内部字段）。新值走词表扩展。
- `reachability` 是路由上的受控键，说明该路由声明的产出如何被触达：缺省 = 主链自动触发；`manual` = 人工入口；`external` = 独立面 / 外部端点入口。确认为自动触发的路由在 `notes` 里以 `auto — <入口说明>` 登记。非 auto 的声明边不计入「死边」审计口径。

### 4.4 输出信封（`agent-output-v1`）

Agent / Skill 的输出经 `normalizeAgentOutput`（`backend/src/agents/output-normalizer.ts`）归一成统一信封，类型定义见 `backend/src/agents/protocol.ts` 的 `AgentOutput`：

| 段 | 内容 |
|---|---|
| `userVisible` | 用户可见文本 |
| `internal` | 内部结构化输出。阶段状态放 `internal.core`（stage / confidence / isCompleted）；按命名空间归档的业务字段放 `internal.ext.<namespace>`，如 `internal.ext.goalConversation.understanding.surface_goal` |
| `renderHints` | 渲染提示（组件、快捷回复） |
| `runtimeEnvelope` | 运行契约：`artifact`（产物）、`businessState`（阶段 / 终态 / 下一步）、`contextUpdate`（状态归属与下一状态） |
| `metadata` / `debug` / `error` | 元数据、调试信息、错误 |

字段的 `pathInRawOutput` 就是以这个信封为根的物理路径（如 `internal.ext.goalConversation.understanding.real_problem`、`userVisible`）。

### 4.5 治理检查

| 检查 | 作用 |
|---|---|
| `npm --prefix backend run prompts:check-handoff:strict` | inputs 与 handoff 双向对账 |
| `detectFieldRoutingDrift` | 声明（编排文件）与 DB 漂移，启动时 warn |
| `validateFieldRoutingSeedSemantics` | handoff 白名单与组合语义，启动时 fail-fast |
