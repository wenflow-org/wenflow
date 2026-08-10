# Orchestration 编排文件目录

字段路由/编排结构的**数据面唯一声明源**（File-as-Truth，进 git），机制详见 `doc/SKILL_PROTOCOL_V4.md` §2.6。

## 定位：数据面配置

- **数据面**：本目录描述"谁产出什么、往哪路由"——字段定义（fields）+ 路由矩阵（routings），是字段路由域的声明源。
- **控制面**：`prompts/core/<skillId>.yaml` 只描述"模型该怎么产出"（prompt 内容与字段功能描述）。两面按 SKILL_PROTOCOL_V4 §1.1 原则 3（控制面与数据面分离）切分。
- **边界**：编排文件**不修改 core.yaml 任何条款**，也不承载 prompt 文本；core.yaml 不声明嵌套结构与路由（组装是平台数据面的事，见 §2.4 平铺命名）。

## 文件约定

- 每阶段一个文件：`goal.yaml` / `path.yaml` / `teaching.yaml` / `profile.yaml` / `simulation.yaml`（新增阶段 = 新增文件）。
- 进 git，File-as-Truth；加载器按文件名排序批量读取，解析失败即 fail-fast。
- 下划线开头的文件（如 `_README.md`）被加载器跳过。

## Schema

顶层键：

| 键 | 必填 | 含义 |
|---|---|---|
| `stage` | 是（loader 硬性） | 阶段名（goal/path/teaching/profile/simulation），与文件名一致 |
| `displayName` | 否 | 阶段显示名 |
| `description` | 否 | 阶段一句话说明 |
| `contracts` | 约定必填 | agent 契约清单：**只声明 `agentId`**；displayName/description 由 agent-manifest 派生 |
| `fields` | 约定必填 | 字段定义表 |
| `routings` | 约定必填 | 路由矩阵（agentId × fieldId） |

### fields 条目

| 键 | 必填 | 值域 / 说明 |
|---|---|---|
| `fieldId` | 是 | 全 stage 唯一 |
| `promptRole` | 是 | 7 类：`hard-required` / `soft-info` / `hidden-inference` / `public-reply` / `proposal-output` / `derived-presentation` / `control-signal` |
| `valueType` | 是 | `string` / `number` / `boolean` / `object` / `array<string>` 等 |
| `snakeName` / `camelName` | 否 | 派生命名（如 `surface_goal` / `surfaceGoal`） |
| `pathInRawOutput` | 否 | 字段值在产出方原始输出中的**物理抽取路径**（点分，如 `internal.ext.goalConversation.understanding.surface_goal`） |
| `description` | 是 | 字段含义 |
| `enumValues` | 否 | 枚举取值 |
| `systemLocked` | 否 | 默认 false；**系统锁**（平台派生/需代码消费的字段，admin 创建与修改受限） |
| `structureLocked` | 否 | 默认 false；**结构锁** |
| `bindings` | 否 | 附加绑定（如 `accumulate: true`） |

### routings 条目

| 键 | 必填 | 值域 / 说明 |
|---|---|---|
| `agentId` | 是 | 产出方 agent |
| `fieldId` | 是 | 必须已在 `fields` 声明（否则 loader 报错） |
| `render` | 是 | `visible` / `hidden` |
| `handoff` | 否 | 默认 `[]`（不转交）；合法目标 = **阶段名**（goal/path/teaching/profile/simulation）或 **manifest 中存在的 agent**（`skill:<id>` / `<stage>-agent`）；禁止自环 |
| `internal` | 否 | 默认 false；true = 仅供 UI 消费、不进业务状态（visible+internal 组合仅允许 control-signal 字段） |
| `accumulate` | 否 | 默认 false；true = 累积进 learner/state |
| `visibilityPreset` | 否 | 可见性预设（如 `user-clarification` / `agent-internal`） |
| `notes` | 否 | 备注 |

## 派生链

```text
prompts/orchestration/<stage>.yaml
  → loader  backend/src/services/field-routing/orchestration-file.ts
       （解析 + 校验：promptRole/render 值域、fieldId 唯一、routing 引用字段必须在 fields 声明）
  → bootstrap 生成器  backend/src/services/field-routing-bootstrap.service.ts
  → DB 三表  field_definitions / agent_contracts / agent_field_routings
```

- **单源化**：seed-*-field-routings.ts 已退役（2026-08 单源化收尾），编排文件为字段路由唯一声明源与唯一编辑入口。

## 运营阅读指南

> 给不写代码的运营同学：这张表（admin → 编排 →「字段路由」tab）在讲什么、怎么看。

### 怎么看一个字段

1. **字段名**（如 `understanding.scenario`）是点分路径：第一段是命名空间（`understanding`=理解/澄清），后面逐级细化（`scenario`=场景）。表里字段名下方有浅色分段小字，含义列直接给一句话人话，不需要翻本文件。
2. **含义列**：悬停可看 取值枚举 / 备注。
3. **角色列**决定"这个字段是干嘛的"，见下表。
4. **render 列**决定"用户看不看得到"：visible=对外可见，hidden=仅内部流转。
5. **锁定列**决定"能不能改"：系统锁/结构锁要改编排文件并谨慎操作，可编辑也不建议直接改 DB（唯一编辑入口就是「编排文件」按钮）。

### 角色人话表（promptRole）

| promptRole | 人话 |
|---|---|
| hard-required | 必填：缺了这个字段，本阶段流程就无法推进 |
| soft-info | 可选补充：拿到更好，缺失也能继续 |
| hidden-inference | 隐式推断：模型内部推理，不直接展示给用户 |
| public-reply | 公开回复：直接呈现给用户看的对话内容 |
| proposal-output | 方案产出：确认下来的结论 / 计划 / 范围 |
| derived-presentation | 派生展示：由其他字段计算派生，用于界面展示 |
| control-signal | 控制信号：平台流程 / UI 控制用，不是学习内容 |

### 流转怎么读

- **handoff**：该字段产完后移交给谁（`goal-agent` / `path` 等阶段或 skill），空 = 不转交。
- **internal = 是**：仅供 UI 消费、不进业务状态；**accumulate = 是**：累积进学习者状态。
- 字段的实际物理位置（`pathInRawOutput`）在编排文件 `fields[].pathInRawOutput` 里，admin 表当前版本不展示。

## 变更流程

1. **改字段/路由 = 改编排文件** + 跑 bootstrap（`npm run prompts:bootstrap`，或等后端启动自动灌入）。
2. admin 在线编辑后续收敛为"改编排文件 → bootstrap"链路（字段路由单源化下一步），当前管理端直改 DB 的通道为过渡形态。
3. 提交 git：`git add prompts/orchestration/ && git commit`。
