# 字段路由页「运营友好化」重设计

日期：2026-08-10 · 范围：admin 控制台 → Orchestrator →「字段路由」tab（`frontend/src/views/admin-redesign/FieldRoutingTable.vue`）

## 一、审计结论

### 1.1 页面现状（改动前）

- 按 agent 分组两张表（goal 阶段：`skill:goal-conversation` 31 行 / `goal-agent` 24 行），列：字段 / 类型 / 角色 / render / handoff / internal / accumulate / 锁定（8 列）。
- 顶部：「编排文件」编辑按钮 + "行级编辑已收敛"引导文案。
- 数据源：`GET /api/admin/field-routings/stages/:stage`（`backend/src/routes/admin/field-routings.ts:124`）。

### 1.2 当前渲染列 → 数据字段映射

| 列 | 数据来源 | 备注 |
|---|---|---|
| 字段 | `routing.fieldId` | 点分名（`understanding.scenario`），无任何可读化 |
| 类型 | `field.valueType`（按 fieldId join） | — |
| 角色 | `field.promptRole` | **纯文本灰 pill，无中文文案映射**（之前审计说的"无文案映射"现状属实） |
| render | `routing.render` | 纯文本 |
| handoff | `routing.handoff` | 数组 join，截断 |
| internal / accumulate | `routing.internal` / `routing.accumulate` | 是/否 |
| 锁定 | `routing.locks.level` | 已有三态徽章（系统锁/结构锁/可编辑），无含义提示 |

### 1.3 未渲染但接口已返回的字段（可直接用）

- `field.description` → **含义列**（用户痛点 1 的直接解法）
- `field.enumValues` → 含义悬浮提示里展示取值枚举
- `field.source` / `field.managedByCode` → 数据来源，暂不展示（密度控制）
- `routing.notes` → 并入"含义"单元格悬浮提示
- `routing.visibilityPreset`（`user-clarification` / `agent-internal`）→ 并入 render 悬浮提示，即轻量"沙盘联动"线索（与沙盘 tab 的 inputChannels.source 口径同源）

### 1.4 后端缺口（本次不改，仅报告）

- **`field.pathInRawOutput` 未被 API 序列化**：DB schema（`backend/prisma/system/schema.prisma:180`）与编排 YAML 均有该列，但 `serializeField()`（`backend/src/routes/admin/field-routings.ts:39-60`）未返回。
  - 影响：字段↔沙盘键（物理抽取路径）联动无法纯前端实现；"字段值从哪来"仍只能看 YAML。
  - 建议（后续排期）：`serializeField` 增加 `pathInRawOutput: row.pathInRawOutput` 一行即可，前端即可在"含义"悬浮提示中展示抽取路径。
- 其余可用字段（description/enumValues/notes/visibilityPreset）齐全，无需后端改动。

### 1.5 前端现有模式（沿用）

- 设计 token：`shared.css` 的 `--mk-*`（ink/muted/faint/line/blue/green/amber/red/mono/shadow）。
- 组件模式：`mk-filter`（输入 + select 筛选）、`mk-badge`、`<details>` 折叠（DriftAuditPanel / GoalConversations 已用）、`title` 原生悬浮提示（全站惯例）、`details` 带 `▸` 旋转箭头（本页新增）。
- 弹窗体系：`mk-modal` + `useEscape` / `useOverlay` / `useMaskClose`（编排文件编辑弹窗原样保留）。

## 二、运营友好化设计

### 2.1 含义列（痛点 1）

- 新增「含义」列（第 2 列），渲染 `field.description`；为空显示 `—`。
- **点分字段名方案选择**：保持原名（mono）+ 含义列，字段名下方以浅色小字输出层级分段 `understanding · scenario`（纯分段、不翻译，避免与声明源字段 ID 产生二义）。理由：字段 ID 是 YAML/DB 中的真实标识，翻译或改写会导致运营对不上声明源；含义列负责"人话"，分段小字负责"可读性"。
- 悬浮提示（title）：`description + 取值枚举（enumValues）+ 备注（notes）` 三段式，替代翻文件。

### 2.2 角色图例（痛点 2，可折叠）

表格上方 `<details>` 图例，三组：

**字段角色（promptRole）人话表（7 类）**

| promptRole | 人话 | 徽章色 |
|---|---|---|
| hard-required | 必填：缺了这个字段，本阶段流程就无法推进 | 红 |
| soft-info | 可选补充：拿到更好，缺失也能继续 | 蓝 |
| hidden-inference | 隐式推断：模型内部推理，不直接展示给用户 | 紫 |
| public-reply | 公开回复：直接呈现给用户看的对话内容 | 绿 |
| proposal-output | 方案产出：确认下来的结论 / 计划 / 范围 | 青 |
| derived-presentation | 派生展示：由其他字段计算派生，用于界面展示 | 琥珀 |
| control-signal | 控制信号：平台流程 / UI 控制用，不是学习内容 | 灰 |

**render**：visible = 对外可见（用户/界面）；hidden = 仅内部流转。

**锁定**：系统锁 = 平台派生/代码消费，admin 不可直接改（需改编排文件）；结构锁 = 结构约束，修改需谨慎；可编辑 = 可自由调整。

角色徽章同步按 7 色着色，列内悬浮提示带人话（一句话看懂，不翻图例）。

### 2.3 分组 / 可读性（痛点 3）

- **搜索框**：匹配字段名 / 含义 / 角色人话 / render / 移交目标 / 锁定 / 备注（不区分大小写）。
- **角色下拉过滤**：7 类角色 + "全部"。
- 过滤激活时：agent 计数徽章显示 `命中 / 总数`，顶部显示 `命中 X / Y 行`；空结果显示"无匹配行"提示。
- 列宽：含义列 200-340px 两行截断；字段列保持 300px 上限 + 层级小字。

### 2.4 沙盘联动（可选，轻量）

本次落地为：render 悬浮提示附带 `visibilityPreset`（如 `user-clarification`），与沙盘 tab 的输入通道来源同口径。完整路径级联动（`pathInRawOutput` ↔ 沙盘键）待后端补序列化后实施（见 1.4）。

### 2.5 编辑引导

现有「编排文件」按钮 + 收敛提示已清晰，保留不动。补充：图例底部一行注明文档位置（`prompts/orchestration/_README.md`、`doc/FIELD_ROUTING_UX_REDESIGN.md`）。

## 三、文档补充

- `prompts/orchestration/_README.md`：新增「运营阅读指南」章节（字段名读法 / 角色表 / render / 锁 / 与 admin 表的关系）。
- `doc/FIELD_ROUTING_UX_REDESIGN.md`：本文档。
- **Orchestrator 页入口评估**：不加页面内链接——指南是仓库内文件，运行时无 URL 可指向；通过字段路由页图例底部文字告知路径即可。

## 四、小样改动清单

| 文件 | 改动 |
|---|---|
| `frontend/src/views/admin-redesign/FieldRoutingTable.vue` | ① 新增含义列（description + notes/enumValues 悬浮）；② 角色 7 色徽章 + 人话映射（`ROLE_META` 单一来源）；③ 可折叠图例（角色/render/锁）；④ 搜索 + 角色过滤（`mk-filter`）；⑤ render 徽章 + visibilityPreset 悬浮；⑥ 锁定列悬浮提示；⑦ 字段层级分段小字；⑧ 空行 colspan 8→9；⑨ 表格窄屏 min-width 720→900 |
| `prompts/orchestration/_README.md` | 新增「运营阅读指南」 |
| `doc/FIELD_ROUTING_UX_REDESIGN.md` | 本文档（新建） |

未改动：后端、编排文件编辑弹窗、漂移面板、SandboxView、Orchestrator 其余部分；live/demo 双模式逻辑不变（字段路由 tab 本就直连 API）。

## 五、验收

见执行记录（build / typecheck / lint / 浏览器快照）。
