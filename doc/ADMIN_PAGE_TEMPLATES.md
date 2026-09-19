# 管理后台页面模板规范（v1 草案）

> 依据：`doc/ADMIN_UI_CONSISTENCY_AUDIT`（2026-09-15 全量审计，18 个导航页 / 约 4.26 万行 Vue / 5 组并行审查 + 逐条实测验证）。
> 本文档只定义**骨架与规则**，不含视觉换皮。目标是让"设计系统无法被绕过"。
>
> **校正记录（2026-09-19）**：本文档 §2 R1/R4/R5/R6、§3 T1 等处的"现存违规 / 现存量"清单写于收口之前，**部分条目已被后续阶段修复**，直接据此派活会出错。本次以磁盘代码为准做**只读核对 + 就地批注**（不删历史）：R4 自搓抽屉已全部收敛到 `.mk-drawer`；R6 三个幽灵类已补定义、页内新增 `mk-` 定义已清零；R1 双导航四页已修至 0（`VirtualLearners` 为登记例外）；R5 清单多数已合规或已修；T1 适用清单因导航收敛而过时。批注统一以 `> 状态（2026-09-19 校正）：…` 标注。
> 另两处全局改名：`shared.css` → `src/styles/mk-primitives.css`；`FieldFlowGraph.vue` / `Topology.vue` 已删。下文旧行号若与现码不符，以批注中的现行 `file:line` 为准。

---

## 0. 一句话诊断

后台不缺设计系统，缺的是**设计系统被采用**。

- **低层（token）**：`frontend/src/styles/main.css` 的 `--mk-*` —— 完整、可用。
- **低层（原语）**：`shared.css`（1366 行）的 `mk-*` —— 完整、可用。
- **中层（复合原语）**：分段控件 / 底部操作条 / 错误条 / 区块 / 实体头 —— **缺失**。
- **高层（页面）**：每页自建私有体系（`.cp-*` 373 类 / `.ld-*` 190 类 / `.vp-*` 169 类 / `.ac-*` 75 类）。

中层缺失 → 每页重造 → 同一动作多种形态 → 用户跨页重建预期。这就是"说不上来的不对劲"。

**结论：不推倒重来，做收口（consolidation）。** 12/18 导航页属于同一类模板（T1），修好 T1 的原语即覆盖 2/3 的页面。

---

## 1. 现状基线：哪些页做对了

模板设计不凭空发明，**以现有最优页为基线**向上抽象：

| 能力 | 现有最佳实现 | 可推广点 |
|---|---|---|
| 列表页骨架 | `OpsContent.vue` / `ExecLogs.vue` | `mk-page--fill` + `mk-card--fill` + 卡内吸底分页，全局最规范 |
| 结论先行 | `Overview.vue:3-31` | 健康结论 + 行动项置于最顶，是全站唯一有明确阅读顺序的页 |
| 异常展开/正常折叠 | `HealthCenter.vue:332-333` | `healthHighlight` / `healthRemaining` 分组，渐进披露的唯一样板 |
| 渐进披露（图形） | `DataFlowGraph.vue:46-87` | `.dfg-journey` 入口→本节点→出口的概览条 |
| 术语翻译层 | `AuditLogs.vue:269` `statusText.ts` | 技术枚举 → 人话，唯一系统化做对的地方 |
| 三态完整 | `Skills.vue:63,177-187` | 骨架 + 错误重试 + 空态齐全 |
| 抽屉原语 | `BatchExperiments.vue:143` | 全场唯一使用官方 `.mk-drawer` 的页 |

---

## 2. 跨模板通用规则（先立规矩，再画骨架）

### R1. 页头职责边界——`.mk-status` 只放三样东西

`.mk-status`（`shared.css:61-147`）目前被当成"什么都能装的一行"，导致「宿主页把主导航渲染两遍」（`People`/`GoalConversations`/`TeachingSessions`/`VirtualLearners` 都是状态条计数锚点 ↔ 下方 pills 切换同一个变量）。

> 状态（2026-09-19 校正）：四页中三页已修、`VirtualLearners` 转为登记例外。现行证据：`People.vue:9-12` 状态条仅 `mk-status__meta`（不可点），pills 计数在 `People.vue:26,32`；`GoalConversations.vue:9` 仅 `共 N 项`，pills 计数在 `GoalConversations.vue:17-19`；`TeachingSessions.vue:10-11` 仅只读 meta，pills 计数在 `TeachingSessions.vue:36`；`VirtualLearners.vue:12-19` 仍保留 3 个可点 `mk-status__meta-link`，但那是该筛选的**唯一入口**（无第二处同义切换），按 R1 允许保留（见 §6 阶段 1 续 ②）。

**允许**：① 页面身份（`__dot` + `__title` + `__sep`）② 只读结论数字（`__meta` / 可点击筛选锚点 `__meta-link`）③ 主操作（`__actions`，**最多 1 个 primary**）。

**禁止**：筛选控件（select/checkbox/搜索框）、指标组（≥4 格）、tab 切换、批量操作。

> 依据：页头同时出现"计数锚点"和"pills"切同一状态的违规页 4 个；`Feedback.vue:10` 的"待处理 N"不可点、而 `OpsContent.vue:9-24` 同类可点——**同一视觉元素交互性不一致**。
>
> 状态（2026-09-19 校正）：双导航违规页已由 4 → 0（`VirtualLearners` 为单入口例外，见上）。`Feedback.vue:10`（`mk-status__meta`，不可点）与 `OpsContent.vue:11,18`（`mk-status__meta-link`，可点）的交互差异仍在：前者为只读结论、后者为筛选锚点，是否把「待处理」也变为筛选锚点**待拍板**。

### R2. 状态语义色表（全局唯一口径）

| 档位 | token | 判定条件 |
|---|---|---|
| `ok` 绿 | `--mk-green` | 一切正常，且**用户无需行动** |
| `warn` 琥珀 | `--mk-amber` | 需关注、不紧急，且**运营可行动** |
| `bad` 红 | `--mk-red` | **需立即行动**，或**数据不可信** |
| `muted` 灰 | `--mk-faint` | 无数据 / 不适用（**不是 ok**） |

**两条硬约束**（均由审计中的真实缺陷推出）：

1. **不可行动的信号不得着色。** `Notifications.vue:265` 把"用户未读"标 warn——运营无法替用户"读"。未读应为 `muted`。
2. **失败不得静默降级为正常。** `OpsHub.vue:111-135` 三个计数初值 0 且 `.catch(() => x = 0)` → 后端挂掉时页头显示"已清零"；`OpsCenter.vue:7` 的 `.is-bad` 是死类名 → 死信告警永不标红；`PromptEval.vue:490` 的 `statusTone` 硬编码 `'mk-status--ok'` → 加载失败时顶栏仍绿。
   **规则：加载失败必须落到 `bad` + 显式重试入口，禁止任何形式的静默归零。**

### R3. 三态统一（加载 / 空 / 错误）

全站现状：加载 5 种形态、错误 6 种壳、空态只有 4 处用组件。统一为：

| 态 | 形态 | 现有资产 |
|---|---|---|
| 加载 | 表格 → `SkeletonTable`；卡片区 → `.mk-skeleton` 区块骨架 | `SkeletonTable.vue` |
| 空 | `MkEmptyState`（`icon + title + description + actionText`） | `MkEmptyState.vue` |
| 错误 | `.mk-alert` + 重试按钮；**页面级**失败用 `.mk-alert` 常驻顶部 | `shared.css:1326` |

**禁止**：纯文字"加载中…"（`VirtualProfile.vue:583`、`GoalConversations.vue:182`、`Orchestrator.vue:71`、`SandboxView.vue:50`）；页面私有 `*-error` / `*-none` / `*-empty`（`.ts-error`/`.gc-error`/`.cp-degrade`/`.vp-fallback`/`.fdp__empty`/`.sfr__empty` 等 10+ 种）。

### R4. 详情落点规则（收敛为唯一答案）

**行/项详情 → `.mk-drawer`（`shared.css:906-962`）。** 仅两种例外：

- 实体规模大到需要独立路由（学习者画像 / 虚拟人画像 / 会话座舱 / 用户详情）→ **T2 详情页**；
- 表单型操作 → `.mk-modal`。

**禁止**：自搓抽屉面板。现存量：`TeachingSessions.vue:832` `.ts-panel`、`GoalConversations.vue:882` `.gc-panel`、`SkillDrawer.vue:650` `.msk`、`DataFlowGraph.vue:1411` `.dfg-drawer`、`FieldFlowGraph.vue:1296` `.ffg-drawer`。
>
> 状态（2026-09-19 校正）：**上述五处已全部收敛**。现行 grep：`.ts-panel` / `.gc-panel` / `.ffg-drawer` 全仓 **0 命中**；`TeachingSessions.vue:204-218` 与 `GoalConversations.vue:186-197` 均改用 `.mk-drawer`；`SkillDrawer.vue:5,7,67` 用 `.mk-drawer__panel/__head/__body`，只剩 `.msk__*` 身份修饰类（裸 `.msk` 0 命中）；`DataFlowGraph.vue:417` 为 `.mk-drawer__panel dfg-drawer`，其 `.dfg-drawer`（`DataFlowGraph.vue:1599`）只保留画布底色修饰；`FieldFlowGraph.vue` **文件已删除**。`.mk-drawer` 原语现定义在 `frontend/src/styles/mk-primitives.css:1195`（`shared.css` 已迁名；原 906-962）。

> 附带清理：`shared.css:1350-1356` 的「推挤式抽屉」挂载在 `html.wf-drawer-open .msk`（SkillDrawer 私有类）上——**设计系统被私有实现反向绑架**。抽屉收敛后该规则应挂到 `.mk-drawer`。
>
> 状态（2026-09-19 校正）：**已修，并已整体删除推挤模式**。全仓 `wf-drawer-open` **0 命中**；抽屉统一为浮层，`--mk-z-drawer` 已抬到侧栏之上（240 > 侧栏 220，见 §6 阶段 1 续 ㉝）。"该规则应挂到 `.mk-drawer`"的诉求随推挤模式取消而消解。

### R5. 技术语义降级规则

`doc/ADMIN_TERMINOLOGY_AUDIT.md:8` 已定：本后台面向**非研发**，主文案中文，工程标识降级为括号/title/mono 小字，或收进"技术细节"折叠区。

强制降级清单（现有违规）：`storyOutline`/`storyTriggerEvent`/`visibleOpening`/`pressurePoints`（`VirtualProfile.vue:514-530`）；`promptRole`/`persistKey`/`pathInRawOutput`（`FieldAddWizard.vue:58-110`、`SkillFieldRouting.vue:56-78`）；`FSRS`/`快照 vN`/会话 UUID（`LearnerDetail.vue:276,31,378`）；`agentId` 当主标题（`SandboxView.vue:19`）；整对象 `JSON.stringify`（`OpsCenter.vue:56-65`、`SessionCockpit.vue:471`）；`aggregateId`/`eventType` 列（`OpsCenter.vue:96-111`）。
>
> 状态（2026-09-19 校正）：该清单写于术语收口前，**逐条核对后多数已不成立或已修**（详见 §6 阶段 1 续 ㉛）：
> - `VirtualProfile.vue:564,568,572,576`：已是「中文（标识）」形式（如「对抗点（pressurePoints，每行一条）」）→ **合规**（原 514-530）。
> - `FieldAddWizard.vue:58` 已改「角色（promptRole）」、`:98`「落库键（persistKey，别名时填）」、`:103`「抽取路径（pathInRawOutput）」→ **已修**。
> - `SkillFieldRouting.vue:53,75` 图例为「字段角色（promptRole）」「落库键（persistKey）」；`:140` 只显示路径末段 + `title` 全路径；`:157` 显示「同字段名 / 别名」+ `title` 真实键 → **已修/合规**；`FieldRoutingTable.vue:50,87,183,255` 同批处理。
> - `LearnerDetail.vue:284`「记忆痕迹与保持率（FSRS）」；`:397` 会话 id 走 `shortId` + `title` 全量；`:28` 快照版本仍以徽章「快照 N · 日期」呈现 → **基本合规**，仅快照版本口径**待拍板**。
> - `SandboxView.vue:26`：`agentId` 仍以 mono/加粗列于折叠头主位（`:27` 另给 `agentName`）→ **仍成立**（原行号 19 → 现 26）。
> - `OpsCenter.vue:63,67`：JSON 转储仍在（改为 `pretty()` 辅助函数，非模板内联 `{{ JSON.stringify }}`），用于「当前 / 模拟后」对比 → **仍存在、是否降级待拍板**；`SessionCockpit.vue` 的 `JSON.stringify` 现于 `:1776`（wrapup 结构化值）与 `:2640`，后者渲染在 `:490-493` 的 `<details class="cp-raw">原始会话数据` 内 → **合规（技术细节折叠区）**。
> - `OpsCenter.vue:100-113`：列头已中文（事件 / 用户 / 聚合），值为 mono + `title` + `shortId` 截断 → **合规（本轮增强）**。
> 汇总：原清单点名的真违规已修 5 处（`FieldAddWizard` ×1、`FieldRoutingTable` ×2、`SkillFieldRouting` ×2，另 `OpsCenter` ×2 属增强）；仅 `SandboxView` 的 `agentId` 主视觉位与 `OpsCenter` 的 JSON 转储两处待拍板。

**规则：面向运营的页面，主视觉位禁止出现内部标识；技术原文统一收进 `.mk-drawer` 的「技术细节」tab 或 `<details>`。**

### R6. 幽灵类禁令

以下类**看起来像设计系统、实际零定义**，必须删除或补定义：

| 幽灵类 | 使用处 | 后果 |
|---|---|---|
| `mk-btn--block` | `VirtualLearners.vue:498` | 按钮未占满宽度 |
| `mk-card__note` | `TokenCost.vue:118,138,158,167` | 空态渲染成无样式 `<p>` |
| `mk-link--active` | `ExecLogs.vue:67`、`MkCols.vue:3` | 激活态无视觉反馈 |

**新规：禁止在页面 scoped 内定义 `mk-` 前缀类**（现违规：`VirtualLearners.vue:1733,1744,1779`、`VirtualProfile.vue:1904,2035`）。`mk-` 前缀 = 全局原语，仅 `shared.css` 可定义。
>
> 状态（2026-09-19 校正）：**三个幽灵类均已在原语层补定义，上表"零定义"不再成立**：`mk-btn--block`（`frontend/src/styles/mk-primitives.css:1118`，现用于 `VirtualLearnerBatchCreate.vue:35`）、`mk-card__note`（`:325`，暗色 `:722`；`TokenCost.vue:119,139,159,168`）、`mk-link--active`（`:760` + hover `:761`；`ExecLogs.vue:89`、`components/mk/MkCols.vue:3`）。页内新增 `mk-` 定义亦已清零：`VirtualLearners.vue` 现 734 行（原 1733/1744/1779 行已不存在），`VirtualProfile.vue:1904,2035` 现为脚本语句 / `.vp` 规则、均非 `mk-` 类定义；门禁规则 1（`frontend/scripts/check-design-system.mjs:243-249`）只放行"覆写既有原语"，新增 `mk-` 类会失败。`mk-` 原语现统一定义于 `src/styles/mk-primitives.css`（`shared.css` 已迁名）。

---

## 3. T1 · 列表页模板

**适用（12 个导航页，最高杠杆）**：`people`、`sessions`、`virtual-learners`、`skills`、`prompt-eval`、`ops-achievements`、`feedback`、`messages`、`addons`、`session-security`、`execution-logs`、`audit-logs`

> 状态（2026-09-19 校正）：**该清单已因导航收敛而过时**（写于 19 项侧栏时代）。现行侧栏为 **14 项 / 7 组**（`manifest.ts:31-54`）：总览 `overview`；教学 `people` · `sessions` · `memory-review`；虚拟实验 `virtual-learners` · `batch-experiments`；Skill `orchestrator` · `skills` · `prompt-eval`；观测 `execution-logs` · `audit-logs`；系统 `api-config` · `ops-center`；运营 `ops-hub`。原清单中的 `feedback` / `ops-achievements` / `messages`（→ `ops-hub` tab）、`addons`（→ `api-config` tab）、`session-security`（→ `ops-center` tab）、`health-center`（→ `skills` tab）**已下线为 tab 宿主子页，不再是侧栏场景**；`sessions` 现外层为 `GoalConversations`（内嵌 `TeachingSessions`/`OpsContent`）；`memory-review`、`batch-experiments` 升为独立场景。T1 模板本身不变，但"适用导航页"应读作「场景 + tab 宿主子页」。

```
┌─ T1 列表页 ──────────────────────────────────────────┐
│ [.mk-status]                                [flex:none]│
│   ● 页面身份 │ 只读结论数字 │ 可点击筛选锚点 │  主操作   │
│                                                        │
│ [MkStatStrip]  ← 可选，仅当"指标是决策依据"时出现       │
│   4~6 格，全量口径；不得与下方计数重复                  │
│                                                        │
│ [.mk-card--fill]                        ← flex:1 填满  │
│   ├ .mk-card__head                                     │
│   │    左：MkFilterSearch + 清除筛选                    │
│   │    右：筛选 pills + MkCols + 「N / M 条」           │
│   ├ 主体（三态统一，见 R3）                             │
│   │    .mk-table--fixed + colgroup token 列宽           │
│   └ Pagination（卡内吸底，随卡片）                      │
│                                                        │
│ [.mk-batchbar]  ← 选中态浮现，禁止卡头内联批量按钮      │
│ [.mk-drawer]    ← 行详情唯一落点（R4）                  │
└────────────────────────────────────────────────────────┘
```

**T1 硬约束**

1. **指标只在一处**。页头 `__meta` 与卡头计数不得重复（违规：`SessionSecurity.vue:8-11` 与 `:59` 完全重复；`OpsContent.vue` 页头走 `/stats` 全量口径、卡头走客户端 `rows` 口径，**同屏两个数字**）。
2. **筛选只出现在卡头**，不在页头（R1）。
3. **`Pagination` 必须在卡片内**（违规：`Feedback.vue:154-160` 把分页器放在卡片外，破坏 `shared.css:31-34` 的吸底契约）。
4. **列表必须分页**（违规：`Announcements.vue:62` 全量 `v-for` 无分页）。
5. **`min-height` 撑屏禁令**。禁止用 `calc(100dvh - Npx)` 撑高列表（违规：`BatchExperiments.vue:455`、`Announcements.vue:484-486` 造成少数据时大片空白 + 嵌套滚动）。
6. **容器页（带 tab）不得双导航**：`people`/`messages`/`sessions` 的 tab 只保留一处（pills），状态条不再放同义切换（R1）。

**T1 需补齐的原语**：`.mk-status` 定位收窄（拆出「筛选条」职责）；`MkCols`/`MkFilterSearch`/`Pagination` 已有，需**强制采用**。

---

## 4. T2 · 详情页模板

**适用**：`learner-detail`、`user-detail`、`virtual-profile`、`session-cockpit`、`skill-drawer`（抽屉形态）

现状：详情页头有**三份独立实现**（`.ld-head` `LearnerDetail.vue:20`、`.ud-head` `UserDetail.vue:4`、`.vp-top` `VirtualProfile.vue:11`），加载态三份（自搓骨架 / `mk-spinner` / 纯文字"加载中…"）。

```
┌─ T2 详情页 ──────────────────────────────────────────┐
│ [.mk-entity]  ← 新原语：返回 + 头像/图标 + 身份 + 状态  │
│   状态徽章 + 主操作（写动作集中于此）                   │
│                                                        │
│ [MkStatStrip]  ← 该实体的关键指标（替代 KPI 卡片墙）    │
│                                                        │
│ [.mk-pills]    ← 分区 tab（总览 / 画像 / 证据 / …）     │
│                                                        │
│ [.mk-section]  ← 新原语：区块 = 标题 + 结论 + 明细      │
│   ├ 结论行（一句话，加粗）                              │
│   ├ 明细（次级，可折叠）                                │
│   └ 技术细节（收进 <details>，见 R5）                   │
│                                                        │
│ [.mk-card 区块] × N（渐进披露，禁止一屏平铺）           │
└────────────────────────────────────────────────────────┘
```

**T2 硬约束**

1. **实体头唯一原语**：`.mk-entity` 取代 `.ld-head`/`.ud-head`/`.vp-top`。
2. **结论与细节分层**。违规样板：`LearnerDetail.vue:331-505` 一屏同时出现指标卡 + 时间线 + 压力曲线 + 趋势建议 + 概念密度 + 预测校准，**同权重平铺**。
3. **进度条一律 `.mk-minibar`**（`shared.css:404-422`，注释已写明"进度量化统一表达"）。违规：`LearnerDetail.vue:1386,1590`、`UserDetail.vue:430`（渐变）、`SessionCockpit.vue:2645,3245` 各造一套。
4. **加载态用骨架**，禁止纯文字（违规：`VirtualProfile.vue:581-587`）。
5. **空态用 `MkEmptyState`**，禁止 `.vp-empty-state`/`.vp-none`/`.vp-fallback` 三套并存。
6. **`.vp-none` 缺基类**（`VirtualProfile.vue:339` 等 6 处引用，但只有 ≥2000px 覆盖）——补基类或删除。

---

## 5. T3 · 驾驶舱页模板

**适用**：`overview`、`ops-hub`、`health-center`、（`session-cockpit` 的会话级结论区）

这类的任务不是"展示数据"，而是**回答"现在要不要我动手、动哪几件"**。

```
┌─ T3 驾驶舱页 ────────────────────────────────────────┐
│ [结论条]  ← 一等公民，不是 .mk-status                  │
│   健康结论一句话 + 行动项列表（可点击直达）             │
│   ← 基线：Overview.vue:3-31                            │
│                                                        │
│ [MkStatStrip]  核心 KPI 4~6 格                         │
│                                                        │
│ [异常区]  展开：每条 = 是什么 + 影响 + 一键处理         │
│ [正常区]  折叠（<details>）                            │
│   ← 基线：HealthCenter.vue:332-333                     │
│                                                        │
│ [动态流]  最近事件，收敛到一栏                          │
└────────────────────────────────────────────────────────┘
```

**T3 硬约束**

1. **失败必须显式**（R2 第 2 条）。这是 T3 最重要的一条——驾驶舱的价值全在"结论可信"。三处必修：`OpsHub.vue:111-135`、`OpsCenter.vue:7`、`PromptEval.vue:490`。
2. **深链契约必须兑现**。`OpsHub.vue:199-204` 注释声明"跳到 Feedback 会默认筛待处理"，实际 `Feedback.vue:282` 无预筛 → 用户点了"去处理"看到全量列表。**所有跨页跳转的筛选参数必须有消费方，且失败不得静默**。
3. **口径单源**。`OpsHub.vue:10` / `Messages.vue:23` / `live.ts:1848` 对"公告"给出三个不同数字（全量 / 合计 / 已发布）——同名指标禁止多口径。
4. **状态条基调与所辖信号一致**：同一"待处理反馈"在 `Feedback.vue:4` 是 warn、在 `OpsHub.vue:3` 被忽略（绿）——同一信号跨页基调必须相同（R2）。

---

## 6. T4 · 图形页模板

**适用**：`orchestrator`（内嵌 `dataflow`）、`trace-waterfall`

现状：图形页形成**事实上的第二套设计系统**——自带页头（`.dfg-toolbar`/`.ffg-toolbar`/`.topo-toolbar`）、自带配色、自带空态/搜索/抽屉，且**三套并行调色板**（`--mk-*` 语义色、`store.ts:64 AGENT_TONES` 身份色、`dataFlow.ts:23,74 FAMILY_COLORS+PALETTE`）。

```
┌─ T4 图形页 ──────────────────────────────────────────┐
│ [.mk-status]   身份 + 结论                             │
│                                                        │
│ [.gr-toolbar]  ← 新原语，工具条                        │
│   图例 │ 范围切换 │ 搜索 │ 缩放 │ 列/层开关             │
│   ← 图例位置统一在此（现：DataFlowGraph 在底部、        │
│      FieldFlowGraph/Topology 在工具条）                │
│                                                        │
│ [.gr-journey]  ← 新原语，概览条                        │
│   入口 → 当前 → 出口（基线 DataFlowGraph.vue:46-87）    │
│                                                        │
│ [画布]  单一配色源（见下）                              │
│                                                        │
│ [.mk-drawer]  节点详情（R4）                           │
└────────────────────────────────────────────────────────┘
```

**T4 硬约束**

1. **配色单源**：`AGENT_TONES` / `FAMILY_COLORS` / `PALETTE` 必须派生自 `--mk-*`（或正式登记为 token 的第二组语义色），**禁止页面内硬编码**。现存量：`DataFlowGraph` 185 处、`FieldFlowGraph` 132 处、`Topology` 44 处、`TraceWaterfall` 33 处。
2. **明暗两套硬编码块下沉到 token**（`DataFlowGraph.vue:1470-1541` 等），否则改主题要改 N 处。
3. **交互命名统一**：现三图三套（`focusKey+familyFocus` / `focusId+dimmed+is-related` / `focusStage+viewScope`）→ 收敛为一套焦点模型。
4. **三态必须齐全**：`Topology.vue` 无 loading、无 error（失败被当"暂无运行时数据"）；`DataFlowGraph`/`FieldFlowGraph` 用纯文字"加载中…"。
5. **死代码先删**：`Topology.vue`(738 行) 与 `FieldFlowGraph.vue`(1435 行) 全仓**零引用**（已实测：仅注释提及），合计 **2173 行**。删掉再谈统一。
   > 更正：早先版本误记为「1446 + 1435 = 2881 行」——`1446` 是子代理给出的错误数字，实测 `Topology.vue` 为 **738 行**。

---

## 7. 页面归类总表

**T1 列表页（12）**
`overview`→T3 · `people` · `sessions` · `virtual-learners` · `skills` · `prompt-eval` · `ops-achievements` · `feedback` · `messages` · `addons` · `session-security` · `execution-logs` · `audit-logs`

> 状态（2026-09-19 校正）：名单随导航收敛而变——侧栏已为 14 项 / 7 组；`feedback`/`ops-achievements`/`messages`/`addons`/`session-security`/`health-center` 现为 tab 子页，`memory-review`/`batch-experiments` 为独立场景。详见 §3 T1 校正注。

**T2 详情页（4~5）**
`learner-detail` · `user-detail` · `virtual-profile` · `session-cockpit` · `skill-drawer`

**T3 驾驶舱页（3）**
`overview` · `ops-hub` · `health-center`

**T4 图形页（3）**
`orchestrator`(+`dataflow`) · `trace-waterfall` · （`fieldflow`/`topology` 删除）

**T5 配置/表单页（3）—— 本版暂缺模板，需补**
`api-config` · `ops-center`（系统工具）· `skill-design-page`

> T5 是本次方案的**已知缺口**。`ApiConfig.vue`（75 个 `.ac-*`、5 个 busy 源、`.ac-seg ≈ .mk-pills`、`.ac-save ≈ .mk-batchbar`）说明配置页同样需要"区块 + 脏位保存条 + 分段控件"三件原语，但目前没有最佳基线可抽象。建议单独一轮设计。

---

## 8. 模板落地的前置条件：需要补齐的中层原语

审计的核心结论是**中层复合原语缺失**。以下是模板依赖的新增项：

| 原语 | 替代的私有实现 | 优先级 |
|---|---|---|
| `.mk-entity`（实体头） | `.ld-head`/`.ud-head`/`.vp-top`（3 份） | 高 |
| `.mk-section`（区块：标题+结论+明细+折叠） | `.ld-*`/`.vp-*`/`.hc-*` 各自的区块 | 高 |
| `.mk-state`（三态容器：loading/empty/error+retry） | 5 种加载 + 6 种错误 + 10+ 种空态 | 高 |
| `.gr-toolbar` + `.gr-journey`（图形页工具条/概览条） | `.dfg-*`/`.ffg-*`/`.topo-*`/`.wf-*` | 中 |
| `.mk-seg`（分段控件） | `.ac-seg` ≈ `.mk-pills` | 中 |
| token 补档：**次级表面 / 细分割线 / 胶囊底** | 13 个硬编码 hex（`#eef2fa`/`#fafbfd`/`#edf0f6`/`#f8fafd`）的根因 | 高 |

**并修复既有原语的两个缺陷**：
- `.mk-status` 需拆清「结论条」与「筛选条」两种职责（R1）；
- 「推挤式抽屉」规则从 `html.wf-drawer-open .msk` 迁到 `.mk-drawer`（R4）。

---

## 9. 建议落地顺序

| 步 | 内容 | 风险 | 覆盖 |
|---|---|---|---|
| 0 | **门禁先行**：ESLint 规则——禁 scoped 内 `mk-` 前缀、禁硬编码 hex、禁未定义类 | 无 | 防新增违规 |
| 1 | 删死代码（2173 行）；修 3 个幽灵类；6 份计数锚点 → `.mk-status__meta-link`；Shell 分组标题选择器失效（`Shell.vue:751-803`） | 极低 | 立竿见影 |
| 2 | 补中层原语（§8）+ token 补档 | 低 | 为后续铺路 |
| 3 | **T1 收敛（12 页）** | 中 | **2/3 页面** |
| 4 | T2 实体头 + 区块化（4 页） | 中 | 详情体验 |
| 5 | T3 结论条 + 失败显式化（3 页） | 中 | 修复"绿点不可信" |
| 6 | T4 配色单源（2 页） | 中高 | 消除第二套设计系统 |
| 7 | T5 配置页模板（单独设计） | 中 | 补齐缺口 |

**视觉层面只做受控重设计，仅三件**：统一页头节奏（R1）、统一状态语义色（R2）、统一密度。不换皮。

---

## 附：本次审计已验证的具体缺陷（可直接修）

| # | 位置 | 缺陷 |
|---|---|---|
| 1 | `Shell.vue:751,762,772,785,803` | 5 个断点写 `.mshell__group-title`，模板实为 `.mshell__group-name` → 4K 下分组标题恒 14px 而子项 20px，**层级倒置** |
| 2 | `OpsHub.vue:111-135` | 计数初值 0 + `.catch(() => x=0)` → **后端故障显示"已清零"** |
| 3 | `OpsCenter.vue:7` | `.is-bad` 零定义 → 死信告警永不标红 |
| 4 | `PromptEval.vue:490` | `statusTone` 硬编码 `'mk-status--ok'` → 加载失败顶栏仍绿 |
| 5 | `HealthCenter.vue:169` | 未绑 `@openSkill`，`SkillReconciliation.vue:69` emit 无人接 → **点击无反应** |
| 6 | `VirtualProfile.vue:339` 等 | `.vp-none` 无基类样式（仅 ≥2000px 覆盖） |
| 7 | `TokenCost.vue:118,138,158,167` | `mk-card__note` 零定义 → 空态裸 `<p>` |
| 8 | `VirtualLearners.vue:498` | `mk-btn--block` 零定义 → 按钮未占满 |
| 9 | `TeachingSessions.vue:32` vs `:412` | 文案"最近 100 条" vs 实际 `limit: 1000` |
| 10 | `OpsAchievements.vue:19-65` | 定义 tab 缺 `v-else` 兜底 → 零数据渲染空白卡 |
| 11 | `OpsHub.vue:199-204` vs `Feedback.vue:282` | 深链承诺"默认筛待处理"未兑现 |
| 12 | `UserDetail.vue:373-492` / `LearnerDetail.vue:1352-1590` / `GoalConversations.vue:950-963` / `TeachingSessions.vue:787-795` | 死 CSS（模板已不引用） |
| 13 | `Confirm` `useConfirm.ts:8,54` | `danger` 默认 true → "关闭注册"是蓝、"开放公网"是红，红色失去区分度 |
| 14 | `Confirm` `busy` | 管理台从未使用（仅 `Profile.vue`/`Settings.vue` 在用）→ 破坏性操作点击即关、零反馈 |
| 15 | `shared.css:1350-1356` | 推挤式抽屉挂载在私有类 `.msk` 上 |

---

## 附 B：视觉审计（实测，2026-09-15）

### 方法

- **真实渲染**：Playwright + Chromium，真实登录管理台，非静态分析。
- **覆盖面**：19 个导航页 + 2 个子 tab = 21 个视图 × 明/暗 2 套 = **42 张全尺寸截图**（1440×900）。
- **客观检测**：横向溢出 / 越界元素扫描（1280 / 1440 / 1920 三档）、控制台错误、失败请求、状态条实测高度、原语使用计数。
- **存疑必复核**：所有涉及"切没切、坏没坏、颜色对不对"的判断，一律放大到 2~3 倍单独确认。

### 已验证结论

**A. 页头高度已统一。** 20 个页面的 `.mk-status` 实测高度**全部为 46px** → `shared.css:69` 的 `min-height:46` 修复生效。"页头高矮不齐"不是当前问题。

**B. 三档宽度下均无内容被裁剪。** 19 页 × 1280/1440/1920：文档无横向溢出、无越界元素。
唯一例外 `audit-logs` 在 1440 下 `.mk-card__head-right` 容器右缘超出视口 **30px**，但**放大 3 倍确认无任何可见内容被切**（尾部为空白）→ 潜在隐患，非缺陷。

**C. `overview` 是唯一的独立视觉体系，但同时是全站信息层级最好的一页。**
客观计数：`.mk-status` **0**、`.mk-card` **0**（全部 `.brief-*`）；4 张 `MkKpi`。
视觉上"结论先行"清清楚楚成立：`需要关注：今日成功率 87.3%` → 行动项列表（`…近 7 天 7 次失败 [去排查]`）。
→ **修正结论：`overview` 不是"要拉齐"的对象，而是 T3 模板的基线。**

**D. 编排结构页首屏"像坏了"。**
≥6s 停留在 `编排数据加载中…` 一行文字 + 转圈，**无骨架屏**，整页空白；状态条全是 `—` 占位。
接口实测正常（拓扑接口 `5695ms`，受后端仿真负载影响），最终能渲染出 5 阶段 / 21 Skill。
→ 这是 §2 R3"三态不统一"**最严重的一处实际后果**：加载慢被感知为故障。

**E. 暗色模式整体一致。** `SkeletonTable` 暗色适配有效（`html[data-theme='dark'] .skl__bar` → `#1d2739`），42 张内无刺眼的浅色残留。

**F. 列表页少数据时大片空白。** `feedback` 仅 1 行数据时，表格区留白约 **540px**。属 `--fill` 布局的必然，但构成"空旷感"。

**G. 零控制台错误、零失败请求**（42 次加载全程）。

### 需要撤回的更正

| 一度得出 | 放大复核后 |
|---|---|
| 编排页 "Unexpected error" 运行时崩溃 | **误读缩略图**。实为加载慢（6s+），最终正常渲染 |
| `audit-logs` "与用户截图同类的裁剪 bug" | **不成立**。容器溢出，但无可见内容被切 |
| 暗色下骨架屏发亮 | **不成立**。缩略图把 pills 的浅色描边糊化成了亮条 |

**方法教训**：联络表只能用于判断**块级结构**；颜色与文字细节必须放大到原尺复核，否则会产出假结论。

### 覆盖缺口（诚实声明）

- **未做交互态审计**：抽屉内的二次交互 / 确认框 / hover / 空态触发均未覆盖。
- **未覆盖 4K 档**（2000px+），尽管代码里存在 5 个断点的适配规则（其中 `Shell.vue` 的那组是失效的，见 §附 A #1）。

---

## 附 C：二三级页面实测（2026-09-15 补充）

### 覆盖

用深链 `?view=&id=`（`AdminConsole` 原生支持）绕过点击脆弱性，以接口返回的**真实 id** 下钻：

| 域 | 二级 | 三级 |
|---|---|---|
| 学习者 | `LearnerDetail`（总览 / 画像 / 证据）、`UserDetail` | — |
| 虚拟学习者 | `VirtualProfile`（故事池 / 运行 / 记忆池 / 画像） | **`SessionCockpit`**（会话座舱） |
| Skill | `SkillDrawer`（概览 / Prompt / 模型配置 / 模型测试） | **`SkillDesignPage`**（8 个 tab） |
| 学习会话 | 教学会话详情抽屉 `.ts-panel` | — |

### 结论 1：T2 顶部形态确实是"三套 + 一个例外"（客观计数）

| 页面 | 顶部类名 | 有没有 `.mk-status` |
|---|---|---|
| `LearnerDetail` | `.ld-head` | 无 |
| `UserDetail` | `.ud-head` | 无 |
| `VirtualProfile` | `.vp-top` | 无 |
| `SessionCockpit` | `.cp-topbar` | 无，且 **`.mk-pill` 数量 = 0** |
| `SkillDesignPage` | `.mk-status mk-status--ok` | **有** ✅ |

**L1 列表页全部有状态条，点进 L2 后页头语言突然换掉** —— 这是跨层级最刺眼的一处断裂，`.mk-entity` 原语的必要性由此坐实。

### 结论 2：`SessionCockpit` 是全站最大的孤岛（客观 + 视觉）

- 客观：`.cp-topbar` + **0 个 `.mk-pill`** + 首屏 **7 个 `<pre>`** + 1 张 `.mk-card`。
- 视觉：它**不是乱**——三栏（主对话 / 右栏状态 + 会话日志）信息组织其实清晰，阶段进度、辅助模式、AI 调用配额都到位。
- 但它**连设计系统的胶囊都没用**（阶段 tab 是自搓 `.cp-stage*`），与全站视觉语言不是一套。
- **阶段导航出现两遍**：顶栏 `Goal / Path / Learn` + 第二行 `Goal 对话 4 轮 / Path / Learn / 总结`。
- **同义不同词**：顶栏 `进行中`（胶囊）与右栏 `运行状态 运行中`。
- 原始数据是折叠的（`▸ 原始会话数据`、日志 `▶ 原文`），这点做得对。

### 结论 3：`LearnerDetail` 证据页——R2 与 R5 的实例

- 4 张 KPI **用缩写当标题**：`LSS 学习状态 0.3` / `KTL 知识轨迹 1.0` / `LF 学习疲劳 1.1` / `LSB 行为稳定 -0.1`。
  副标题给了中文解释，但**主视觉位是缩写** —— 与 `doc/ADMIN_TERMINOLOGY_AUDIT.md:8`「主文案中文、工程标识降级为括号/title/mono 小字」正好反过来。
- **四个数字全部标红**。`KTL 知识轨迹 1.0` 未必是坏值 → 红色失去区分度，与 `Confirm` 的 `danger` 默认红是同一个病。
- 证据时间线直出英文枚举：`incomplete`、`struggle`。

### 结论 4：`SkillDesignPage`——技术标识直出最集中的一页

- 状态条直出：`skill:goal-conversation · prompts/skill.goal-conversation.md · DB ACTIVE v…`。
- **8 个 tab**（协议 / 试跑 / 版本 / 运行时 / 工程 / 字段路由 / 源内容 / 编译产物），**31 个 `<code>`**、3 个 `<pre>`。
- 是 T5（配置/表单页）的典型，也是"研发工具挂在运营后台"最明显的证据。

### 结论 5：`VirtualProfile` 故事行密度过高 + 状态即按钮

- 单行承载：勾选框 + 单选框 + 标题 + `已选` + 长描述 + 4 项计数（运行/目标/路径/教学）+ **5 个阶段 chip** + 3 个操作（运行 / 编辑 / 删除）。
- 页头把**状态渲染成按钮**：`运行中`（绿）与 `暂停` / `终止` 并排，状态与动作同形，用户需自行分辨哪个是"显示"哪个是"操作"。

### 本轮再次撤回的误判

| 一度认为 | 放大 5 倍复核 |
|---|---|
| `LearnerDetail` 激活 tab 在两张图里样式不同（白底 vs 蓝底填充） | **不成立**。完全一致（白底 + 蓝字 + 蓝描边），缩略图把蓝字+描边糊成了蓝块 |

---

## 附 D：阶段 0 / 阶段 1 执行记录（2026-09-15）

### 阶段 0 · 门禁先行

ESLint 无法解析 `<style>` 块内的 CSS 声明，因此门禁实现为独立脚本（与仓库既有的 `scripts/secret-check.mjs` / `check-retired-skill-lists.ts` 同风格）：

**`frontend/scripts/check-design-system.mjs`** —— 三条规则：

| 规则 | 内容 | 说明 |
|---|---|---|
| 1 | `mk-` 前缀类禁止在**页面** scoped 内定义 | 原语层（`shared.css`、`src/styles/*.css`、`Mk*.vue`、外壳/通用控件）豁免 |
| 2 | 模板引用的 `mk-*` 必须已定义 | 专门防幽灵类；排除 `var(--mk-*)` 变量引用与模板字面量拼接 |
| 3 | 页内硬编码 hex **不得超过基线**（棘轮：只降不升） | 基线落在 `frontend/scripts/design-system-baseline.json` |

挂载：`npm run design:check`（前端）→ `npm run design:check`（根）→ **已接入 `npm run check:quality` 链路**。

**基线现状**：`2371` 处硬编码色值（77 个文件），冻结为可下降的上限。已定义原语 `234` 个。

### 阶段 1 · 收口

| # | 动作 | 结果 |
|---|---|---|
| 1 | 删死代码 `Topology.vue` + `FieldFlowGraph.vue` | **−2173 行**；同步移除 `.eslintrc.cjs` 中对应豁免条目（35 → 34） |
| 2 | 补 3 个幽灵类定义 | `mk-btn--block` / `mk-link--active`（含 hover）/ `mk-card__note`（含暗色）写入 `shared.css` |
| 3 | 修 `Shell.vue` 失效选择器 | 5 处 `.mshell__group-title` → `.mshell__group-name`（4K 下分组标题不再比子项小） |
| 4 | 6 份计数锚点收敛 | `pp-/lc-/ts-/gc-/oc-/ms-count-link` → 全局 `.mk-status__meta-link`；**并把 `LearnerCenter` 的私有暗色补丁提升为全局**（原先另 5 处在暗色下几乎不可见） |
| 5 | 16 处页内 `mk-` 定义按三路处置 | **提升**：`.mk-status__filter`/`.mk-status__clear`（ExecLogs）、`.mk-field__opt`（PromptEval）、`.mk-link--muted`、`.mk-card__foot`（VirtualProfile，含暗色）<br>**收敛**：`.mk-num--na` → 既有 `.mk-na`<br>**改名**：`.mk-table-wrap` → `.sdp-table-wrap` |

### 验证

| 项目 | 结果 |
|---|---|
| `vue-tsc --noEmit` | ✓ |
| `eslint` | ✓（1 个既有 warning：`live.ts:2014`，与本次无关） |
| `vitest run` | ✓ **62 文件 / 421 测试全通过** |
| `design:check` | ✓ |
| 真机视觉复核（6 个改动页） | ✓ 零 console/page error；旧私有类残留 `0`；静止态 `padding:0`+muted、激活态 `2px 6px`+蓝底，与全局规范一致 |

### 阶段 1 续 · R2 状态语义 + 断链修复 + 回归测试（同日第二批）

**R2「绿点必须可信」四修**：

| 位置 | 原缺陷 | 修复 |
|---|---|---|
| `OpsHub.vue` | 三个待办域 `.catch(() => count = 0)` → 后端故障时伪装成「全部已清零」 | 改用 `Promise.allSettled` + `wbErrors` 记录失败；页头降 `bad`、加 `.mk-alert` 错误条、计数显示 `—`、按钮变「重试」、待办行加 `.ow-todo--failed` |
| `OpsCenter.vue:7` | `.is-bad` 全站零定义 → 死信告警永不标红 | → `mk-status__meta--bad` |
| `PromptEval.vue:490` | `statusTone` 硬编码 `'mk-status--ok'` → 接口挂了顶栏仍绿 | 由 `casesFailed \|\| runsFailed` 驱动 `bad` |
| `Notifications.vue:265` | 「用户未读」当 `warn` → 运营无法替用户读，非可行动信号 | 仅加载失败降 `bad`；未读保持中性 meta |

**断链与一致性修复**：

| 位置 | 原缺陷 | 修复 |
|---|---|---|
| `HealthCenter.vue:169` | 未绑 `@openSkill` → 对账行点击无反应 | 绑到全局 `openSkillDrawer` |
| `VirtualProfile.vue` | `.vp-none` 只有 ≥2000px 覆写、缺基础规则 → 空文案无颜色/内边距 | 补基类（对齐 `.ld-none`/`.ud-none` 规格） |
| `Feedback.vue` | `OpsHub` 承诺「预筛待处理」但从未消费 intent | `onMounted` 消费 `intent.statusFilter==='new'` 后清空 |
| `OpsAchievements.vue` | 定义 tab 缺 `v-else` 兜底 → 零数据渲染空白卡 | 补 `MkEmptyState` 空态；错误/空态一并改用共用组件 |
| `TeachingSessions.vue` | 文案「最近 100 条」vs 实现 `limit: 1000` | 抽 `LIST_LIMIT` 常量，文案与实现同源 |
| `shared.css` | 推挤式抽屉挂在私有类 `.msk` 上 | 规则扩到 `.mk-drawer__mask/__panel`（`.msk` 例外保留） |

**回归测试（防再次漂移）**：
- 新增 `__tests__/admin-status-semantics.test.ts`（3 例）：OpsHub 失败不得伪装成「已清零」；OpsHub 全 0 时为 ok；OpsCenter 死信使用已定义的语义类而非无效类名。
- `feedback.empty-skeleton.test.ts` 增 1 例：深链 `intent.statusFilter='new'` → 预筛「待处理」并清空 intent。

**验证**：`vue-tsc` ✓ / `eslint` ✓ / `design:check` ✓ / `vitest` **63 文件 425 测试** ✓。

### 阶段 1 续 ② · R1 页头职责边界（消除双导航，同日第三批）

**问题**：4 个宿主页把「视图/筛选切换」在同一屏做了两遍 —— 状态条里的可点计数锚点与下方 pills 绑定同一个变量。

**修法不是删信息，而是让计数回到唯一控件上**（`.mk-pill__count` 早已存在，Skills.vue 是既有范本）。

| 页面 | 原状 | 现状 |
|---|---|---|
| `People` | 状态条 `用户 24` / `学习者 24`（可点切 tab）+ pills `账号管理` / `学习状态`（无计数） | 状态条只留 `共 24 人` + 操作；pills 变 `账号管理 24` / `学习状态 24` |
| `Messages` | 状态条 `公告 0` / `通知 0`（可点切 tab）+ pills 无计数 | 状态条只留 `共 N 条`；pills 带计数 |
| `GoalConversations` | 状态条 `教学 N` / `对话 N` / `路径 N`（可点切 tab）+ pills 无计数 | 状态条只留 `共 N 项`；pills 带计数 |
| `TeachingSessions` | 状态条 3 个可点计数 + 卡头 pills **已有计数** | 删除状态条那 3 个（纯冗余） |
| `VirtualLearners` | 状态条 3 个筛选锚点 | **不改** —— 那是该筛选的唯一入口，无重复，R1 允许 |

**顺带修掉一个「计数撒谎」缺陷**：`TeachingSessions` 状态条的「高关注 N」按 `attention === 'high'` 统计，而它绑定的 `pill='attention'` 筛选口径是 `attention !== 'low'` —— 点「高关注 3」实际筛出 24 条。已删除该锚点，并让 pills 与页头基调共用同一计数（`attentionCount` / `missingWrapupCount`）。

**测试适配**：`merged-tabs.smoke.test.ts` 原先用精确文本匹配按钮（`text() === '学习状态'`），pill 加计数徽章后失配。改为按 `.mk-pill` 定位 + `includes` 匹配，并抽出 `clickPill()` 助手 —— 即**锚定规范控件而非文本**，反而更稳。

**验证（真机）**：

| 页面 | 状态条内可点计数 | 状态条内容 |
|---|---|---|
| people | **0** | `用户与学习者 共 24 人 [新建用户][刷新]` |
| sessions | **0** | `学习会话 共 0 项 [刷新]` |
| messages | **0** | `通知与公告 共 0 条 [新建公告][刷新]` |
| virtual-learners | 3（合规例外） | `共 18 人 运行中10 已暂停0 需关注8 活动会话13` |

零 console/page error。`vue-tsc` ✓ / `eslint` ✓ / `design:check` ✓ / `vitest` **63 文件 425 测试** ✓。

### 阶段 1 续 ③ · R3 三态收敛（空态统一，同日第四批）

**门禁先行**：给守卫加**规则 4** —— 页面模板不得手写 `.mk-empty` 结构（应使用 `MkEmptyState`）。加上后立刻枚举出 **45 处 / 28 个文件**的工单。

**顺带修正 规则 3 的作用域**：它原本扫描 `src/views/**` 全部 `.vue`，会与并行开发打架 —— 实测到 `views/v2/V2LearningPage.vue` 因用户侧界面在途改动（84 → 90 个硬编码色）而误报。**收窄为 `src/views/admin-redesign/`**（那才是本守卫治理的面），基线随之重算为 53 文件 / 1658 处。

**收敛结果**：45 处全部替换为 `<MkEmptyState>`（icon / title / description / action-text / min / compact / @action），**零遗漏**。

**保真度验证（机械化）**：逐文件比对 HEAD 与工作区的**中文文本集合**。28 个转换文件中，`Addons`/`Announcements`/`AuditLogs`/`BatchExperiments`/`Skills`/`TokenCost`/`Users`/`UserDetail`/`Overview` 等的文本集合**完全一致**（把 `<strong>` 文案搬到 `title=` 不改集合，这正是该检查的效力）；列出差异的 16 个文件，差异全部来自本轮之前的 R1/R2 有意改动与注释——**无一处空态文案漂移**。

**一处需登记的有意视觉变化**：`Overview` 的加载/失败态原为 `<p class="brief-card__note">` 内联小字，现改为 `MkEmptyState` 块（居中、`min` 撑满、标题 14px）。属 R3 归一，非等价重构。

**实现细节**：带 `:disabled` 的重试按钮与 `mk-link` 按钮保留在组件默认插槽内，以逐字保持原行为与样式。

**验证**：`design:check` 规则 1~4 全过 ✓ / 残留手写空态 **0** ✓ / 无死 CSS 残留 ✓ / `vue-tsc` ✓ / `eslint` ✓ / `vitest` **63 文件 426 测试全通过** ✓
> 诚实记录：测试总数由 425 变为 426，多出的 1 例**未能定位**。已排除的可能：代理未改动任何测试文件（`git status` 仅含我自己的 2 处改动 + 1 个新文件）；无程序化用例生成（逐文件「源码 `it(` 声明数」与「vitest 报告数」完全一致）；零失败、零跳过。

### 阶段 1 续 ④ · R3 加载态统一（同日第五批）

**新建原语**：`MkLoading.vue` + `shared.css` 的 `.mk-loading`（与 `.mk-empty` 同约定：样式在 shared.css，组件只放标记）。三种形态：默认（区块居中）/ `inline`（局部与**按钮忙碌态**）/ `min`（整页）。
关键设计：**根节点用 `<span>` 而非 `<div>`** —— 这样它能合法嵌进 `<button>`，把「按钮忙碌态」也一并统一（子代理初版在按钮里放了 `<div>`，会产出非法 HTML；改根节点类型比逐个回退更好）。

**门禁加规则 5**：页面模板不得手写加载态（自建 spinner 容器，或元素内的「加载中…」文案）。加上即枚举出 **25 处**工单。
规则 5 迭代了两次才正确：
- **文案检测必须排除属性值**：`>[^<>]*加载中…` 只认元素文本，否则 `:title="…'加载中…'…"` 与转换后的 `text="加载中…"` 都会被误报（`Addons` 就是被这一点误伤的）。
- **作用域收窄到 `admin-redesign`**：原先扫全 `src/views`，会命中 `views/v2/` 三个用户侧界面。

**收敛结果**：26 处全部替换 —— 子代理 24 处 + 我手做 `AdminConsole`（启动屏 `.ac-boot` 与异步 chunk 的 `loadingComponent`，后者原用非 mk 的 `.spinner`）与 `ApiConfig`（健康快照 inline + 两处按钮忙碌态「拉取中…」「测试中…」）。

**真机验证（拦截 `/api/admin/**` 注入延迟，确定性拍到加载态）**：

| 页面 | 实际加载形态 |
|---|---|
| people / virtual-learners | 5 行表格骨架（`SkeletonTable`） |
| sessions | `<MkLoading min>`「加载中…」 |
| skills | `<MkLoading inline>`「Skill 加载中…」+ 骨架 |
| feedback | `<MkLoading min>`「正在从后端拉取反馈。」 |
| api-config | 健康快照走 inline 分支 |

**全部页面 `游离 spinner = 0`** —— 页面里不再有任何手写 spinner。

**验证**：`design:check` 规则 1/2/4/5 全过 ✓ / `vue-tsc` ✓ / `vitest` **63 文件 426 测试** ✓

**未纳入规则 5 的残留（门禁抓不到，留待后续）**：
- 页面私有骨架形状：`ud-skel*`（UserDetail）、`cp-path-skel`/`cp-log-skel`（SessionCockpit）、`tc-skel-*`（TokenCost）、`sk-rec__skeleton`（SkillReconciliation）。这些是**形状化骨架**，统一需要一个"骨架块"原语，属下一轮。
- 文案不匹配规则模式的 3 处加载态：`VirtualProfile` 的 `◌ 正在读取记忆…` 与 `MkEmptyState title="加载中…"`、`TraceWaterfall` 的 `拉取重试时间线…`。

### 阶段 1 续 ⑤ · R3 骨架统一（同日第六批）

**新建原语**：`.mk-skeleton`（shared.css 单一定义，含暗色与 `prefers-reduced-motion`）。

**问题**：5 处各写一套 shimmer —— 亮色起始值就有 `#eef2f7`/`#eef2f8`/`#eef2fa` 三种，暗色两套（`#1b2537+#232f45` 与 `#1d2739+#2a3a55`），速度 1.2s/1.4s，`background-size` 200%/220%。像素级不一致。

**收敛**：`SkeletonTable` + `UserDetail`(`ud-skel*`) + `TokenCost`(`tc-skel*`) + `SkillReconciliation`(`sk-rec__skeleton`) + `SessionCockpit`(`cp-log-skel`/`cp-path-skel`) 全部改为「形状类只管尺寸/圆角 + `class="mk-skeleton"` 负责视觉」。

**门禁规则 6**：页面不得自搓 shimmer（特征：`background-size: 200%/220%` 或自定义 `shimmer|skel` keyframes）。加规则即枚举 4 处，收敛后归零。
> 中途曾建 `MkSkeleton.vue` 组件，但各页最终走的是 `.mk-skeleton` 类，组件无人使用 → **作为死代码删除**，门禁提示同步改掉。

### 阶段 1 续 ⑥ · ① `Confirm` 红色收窄（同日第七批）

**结论：不翻转 `danger` 默认值。** 67 个 `askConfirm` 调用点里只有 5 个显式 `danger: false`，说明约定是「默认红、显式 opt-out」，而**销毁类操作依赖这个默认** —— 翻转会让 60+ 个危险确认丢掉红色警示。

**真正的修法**：给**明确非危险**的确认显式 `danger: false`。共改 **19 处**（推进实验 / 模拟跨日衰减 / 同步到 DB / 一键修复 / 重放死信×2 / 恢复路径 / 从该课开始学习 / 重建学习路径 / 按评审意见重规划 / 刷新设计页 / 切换 Skill / 离开设计页 / 恢复用户×2 / 启动故事 / 批量启动自动驾驶 / 批量停止自动驾驶 / 批量启停自动驾驶）。

**保持红色**：删除 / 移除 / 终止 / 下线 / 撤回 / 强制下线 / **开放公网访问**（审计曾误判此处"反了"，实际它靠默认红，是正确的）。
**动态确认保持红色**：`SessionCockpit`×2 与 `VirtualProfile`×1 的 `c.confirm.title` 走共享 code path，同一路径可能渲染「终止学习/删除会话」→ 无法在 `askConfirm` 处区分，保持。

**`busy` 仍未启用（有意）**：`busy` 模式要求每个调用点在异步结束后调用 `done()`，漏调会让弹窗永久卡住。盲改风险高于收益，留待逐页接线。

### 阶段 1 续 ⑦ · R4 图形页配色单源（同日第八批）

**问题实质**：不是"颜色太多"，而是 `DataFlowGraph.vue` 的 CSS **把 `AGENT_TONES` / `FAMILY_COLORS` 的语义色又硬编码了一遍**，形成第三套调色板。

**做法（零色彩变化）**：把 `familyHue(fieldId)` 的结果在根元素注入为 `--fam-*`，CSS 改用 `var(--fam-*)`；中性色则只在**取值与 `--mk-*` token 完全相等**时才替换。

| 文件 | 硬编码色值 |
|---|---|
| `DataFlowGraph.vue` | 184 → **127**（去重 68 → 49） |
| `TraceWaterfall.vue` | 33 → **30** |
| 合计 | 217 → **157**（**−60**） |

**真机验证色彩未变**：`.dfg` 根上注入变量实测解析为 `--fam-path:#16a34a`、`--fam-classroom:#7c3aed`、`--fam-understanding:#2c63d0`、`--fam-core:#64748b`、`--fam-knowledge:#b45309` —— 与原硬编码值逐字一致；图渲染 15 个节点。

**明确拒绝的替换**（取值只是"恰好相等"、语义不符或会改变暗色渲染）：`#f0f2f5`（仅等于关闭按钮底色 token，语义误用）、`#fcd34d`、TraceWaterfall 的状态红/琥珀（那些规则无暗色覆写，换 token 会在暗色下变色）。

### 阶段 1 续 ⑧ · R4 图形页 token 层（同日第九批）

**做法**：在 `src/styles/main.css` 建 **64 个 `--mk-graph-*` token**（`:root` 亮值 + 暗色段覆写），把两页剩余的专属色（画布底/描边/渐变端点/状态色/芯片底…）收成单一来源。命名按**角色**而非色值。

| 文件 | 硬编码色值 |
|---|---|
| `DataFlowGraph.vue` | 127 → **1** |
| `TraceWaterfall.vue` | 30 → **0** |
| admin 范围存量 | 1220 → **1064**（文件 50 → 49） |

**为什么"零变化"而不是"换成语义 token"**：剩余这些色在主色板里**没有等值对应**；用"语义相近"的 token 去替会**改观感**。所以做法是**原值搬成 token**（同一角色在亮/暗的两个取值合成一个 token + 暗色覆写），既消除散落、又让图形页可被统一调整。

**真机验证（明/暗双主题）**：`--mk-graph-canvas` 实测亮 `#ffffff` / 暗 `#141c2b`，`--mk-graph-line` = `#e6ebf4` / `#232f45`，`--mk-graph-node-ink` = `#1a2a44` / `#c7d3e8`，`--mk-graph-blue-ink` = `#2c63d0` / `#9db8f5`，`--mk-graph-warn-ink` = `#b45309` / `#fcd34d`，`--mk-graph-flow-bg` = `#f0f5ff` / `#1b2a45`；`.dfg-frame` 计算背景 `rgb(255,255,255)` / `rgb(20,28,43)`，图渲染 15 节点 —— 与声明值**逐一吻合**，暗色覆写已接通。

**明确保留未替换的**（附原因）：
- `.dfg-pipe` 暗色 `#101725`：**仅暗色存在**、亮色无 background，建档需虚构亮值。
- `.dfg-step__badge--gate` 亮值 `color-mix(... var(--hz) ...)`：依赖元素级 `--hz`，写进 `:root` 会解析失效。
- 各处纯 `rgba()` 叠加（阴影/焦点环/遮罩）：多为单主题或无配对，收敛不影响 hex 棘轮却易改错。

发现 `var(--mk-muted, #64748b)` 这类 **fallback 兜底值被错计为硬编码**（全站通用写法，非违规）。剔除后基线 **1658 → 1290**，锁定 R4 成果后为 **1230**。

### 阶段 1 续 ⑨ · ① `Confirm` busy 接入（同日第十批）

**先发现一个真 bug**：`busy` 模式**根本是死锁的**。

`Confirm.vue` 点确认时只置 `busy = true`、**不 settle**，而调用方的写法是
`const ok = await askConfirm({ busy: true, … }); if (!ok) return; …业务…; doneConfirm()` ——
于是 `await` 永久挂起 → 业务永不执行 → `doneConfirm()` 永不被调用 → 弹窗卡死在「处理中…」。

**先写测试复现**（`__tests__/confirm.busy.test.ts`）：修复前 `点确认后 resolve(true)` 实测为 `pending`、`failConfirm` 用例直接 20s 超时；而「busy 期间按钮禁用」「非 busy 模式不变」两条通过 —— 精确定位到只有 confirm 路径坏。

**修复**：busy 模式点确认时**立即 resolve(true)**（让调用方开始干活），同时保持弹窗打开并进入 busy 态，由 `done()/failConfirm()` 真正关闭。修后 4/4 通过。

> 顺带影响：既有 3 处 `busy: true`（`Profile.vue` ×2、`user/Settings.vue` ×1，均为学习者侧页面）此前点确认就卡死，现在**一并修好**。
> 另修状态卫生：`settleConfirm` 关闭时未复位 `busy`/`busyMode`，会留下「已关闭但标记忙碌」的脏状态，现已归零。

**接入 17 处销毁类确认**（删除用户/虚拟学习者/故事/会话、下线与删除路径、删除目标对话/公告/通知、删除 MCP、撤回成就、强制下线会话…）：加 `busy: true` + 成功 `doneConfirm()` + 失败 `failConfirm()`，并保证 `ok` 为真后**任何路径都恰好关一次弹窗**。

**验证**：
- **配对审计（独立 grep）**：10 个文件全部 `busy == done == fail`（17/17/17），无遗漏无重复。
- **端到端用例**（新增于 `virtual-learners.batch.test.ts`）：真挂载 `Confirm.vue` 并真点弹窗确认按钮 → 断言进入 busy（按钮禁用、文案「处理中…」）、弹窗仍开、接口以正确参数被调用；业务结束后断言弹窗关闭且状态归零。
- `vue-tsc` ✓（仅剩你 WIP 的 `completion-card.attribution.test.ts`）/ `eslint` ✓ 0 error（我的文件）/ `vitest` **66 文件 438 测试** ✓ / `design:check` ✓

### 阶段 1 续 ⑩ · 骨架版式层（同日第十一批）

**先研究再设计**：把 5 个页面的私有骨架逐一拆开，归纳出 **5 种版式**（不是拍脑袋定）：

| 版式 | 归拢自 | 复用 |
|---|---|---|
| **rows** N×等高横条 | `sk-rec__skeleton`(8×26)、`cp-path-skel`(3×40)、`cp-log-skel`(4×11)、`tc-skel--row`(4×22) | 4 处 |
| **cards** N×块（自动填列 / 固定列数） | `tc-skel-kpi`(3)、`ud-skel__stats`(4)、`ud-skel__grid`(2) | 3 处 |
| **identity** 头像 + 两行 | `ud-skel__id` | 1 处 |
| **bars** N 根错落竖条 | `tc-skel-chart`(7) | 1 处 |
| **table** N 行×M 列 | `SkeletonTable` | 已有 |

**分层设计**：视觉层（shimmer / 暗色 / `prefers-reduced-motion`）早已统一在 `.mk-skeleton`；本批补的是**形状层**——
- `shared.css` 新增 `.mk-skeleton-rows` / `-cards`（含 `--mk-skel-cols` 固定列、`--mk-skel-card-min` 自动填列）/ `-identity` / `-bars`（3 档错落高度）
- `MkSkeleton.vue` 一个新组件承载 5 种 `variant`（与 `MkEmptyState`/`MkLoading` 同约定：样式在 shared.css、组件只放标记）
- 顺手给 `.mk-skeleton` 补 `display: block`，使宽高在非 grid/flex 父级下也生效

**迁移**：`SkillReconciliation` / `SessionCockpit`（path + log）/ `TokenCost`（KPI + 标题条 + 柱状 + 行）/ `UserDetail`（身份行 + 4 联指标 + 2 联卡片）全部改用版式组件，删掉各自的形状类。

**读码时额外发现的死代码**：`SessionCockpit:3804` 还留着骨架的**暗色硬编码覆写**（`#1d2739 → #2a3a55`）——`.mk-skeleton` 已统一处理暗色，该规则在迁移后既冗余又会覆盖 token；已删除。

**验证**：
- 单测 `__tests__/mk-skeleton.test.ts`（8 例）锁定 5 种版式契约：block 的 w/h/radius/circle、rows 的条数与 jitter 首宽末窄、cards 的固定列 vs 自动填列、identity 的 3 块、bars 的容器高度与条数、各版式根的 `aria-hidden`。
- **真机（明/暗双主题，延迟 API 拍骨架）**：`执行日志 › 成本分析` 实测 `rows:1 + bars:1 + 19 个骨架块`，且**旧形状类在 DOM 中为 0**（`.ud-skel__*` / `.tc-skel--*` / `.cp-*-skel` / `.sk-rec__skeleton span` 均已消失）。截图确认 KPI 行（3 卡×2 条）与柱状区（7 根错落）形状正确。
- `vue-tsc` ✓ / `eslint` ✓ 0 error / `vitest` **67 文件 448 测试** ✓ / `design:check` ✓（存量 1061）

### 已知未处理（非本次改动引入）

- **`MemoryReview.vue` 已收口**：原 9 处真实硬编码色值已全部换成 token（`--mk-line` / `--mk-surface` / `--mk-blue-bg` / `--mk-red-strong` / `--mk-amber` / `--mk-accent-deep`），顺带**修好了它在暗色下的白底按钮与浅色分隔线**；6 处 `var(--token, #fallback)` 兜底值也统一为全站口径（`#5b6577` / `#5f6f8c`）。基线 1230 → **1220**，文件数 51 → 50。
- `live.ts:2014` 未用变量 warning（既有）。

### 阶段 1 续 ⑪ · R3 错误态统一 + 次级表面/胶囊底 token 补档（同日第十二批）

**对账发现 R3 只做了 2/3**：加载态（`MkLoading`）、空态（`MkEmptyState`）都收口了，**错误态从没做**。审计 §8 说的「5 种加载 + 6 种错误 + 10+ 种空态」里，错误态一类原封未动。

**现状盘点（客观计数）**：

| 形态 | 处数 | 例子 |
|---|---|---|
| 各写各的 error 容器 | **9** | `.audit-error` / `.sbx__empty--error` / `.fdp__empty--error`（×2）/ `.dfg-empty--error` / `.frt__empty` / `.sfr__empty` / `.vp-empty-state` / `.ac-error` |
| 已用 `MkEmptyState` 但手拼重试按钮 | **10** | Addons / Announcements / BatchExperiments / HealthCenter / DataFlowGraph / DriftAuditPanel(×2) / FieldRoutingTable / SandboxView / SkillFieldRouting / VirtualProfile |

手拼按钮的根因是 `MkEmptyState` 的 `actionText` **表达不了「重试中…/禁用」**，于是各页绕过组件在自己 slot 里拼同一颗按钮。

**改动**：
1. `MkEmptyState` 增 **`tone="error"`**（`--error` 修饰 + 图标底转红系 + 自动带 `role="alert"`）与 **`actionBusy` / `actionBusyText`**（进行中禁用并换文案）。中性空态不加 role，避免读屏把空态当告警播报。
2. **token 补档**（§8 点名的「次级表面 / 胶囊底」）：`--mk-surface-2`（亮 `#eef2fa` / 暗 `#1d2739`）、`--mk-blue-bg-strong`（亮 `#dbeafe` / 暗 `rgba(91,141,239,.26)`）。
3. 原语层自身的硬编码换 token（`.mk-empty__icon` / `.mk-empty__action` / `.mk-icon-btn:hover` / `.mk-badge--self` / `.mk-btn--ghost`），并**删掉暗色块里因此冗余的 4 条覆写**（值就等于 token 的暗色值）。
4. 11 处错误态改 `tone="error"`；删掉 7 个页面的 error 容器 CSS；**顺带修掉上批 R3 空态的遗漏**：`VirtualProfile` 的 `.vp-empty-state`（4 处）→ `MkEmptyState` / `MkLoading`。

**从代码里读出来的真 bug**（不是猜的）：`shared.css` 暗色块里 `html[data-theme='dark'] .mk-empty__icon { background: #1d2739 }` 的**选择器权重高于**新的 `.mk-empty--error .mk-empty__icon`，若不删除，**暗色下错误态图标永远拿不到红色底**。删掉它不是清理，是让错误态在暗色下成立的必要条件。

**验证**：
- 单测 +4（`mk-shared.test.ts`）：`tone=error` 加类 + `role=alert`；中性态不加 role；`actionBusy` 禁用 + 换文案 + **不再 emit**；只禁用不改文案（不猜动作语义）。
- **真机 4 页 × 明/暗双主题**（手法：放行 boot 依赖、abort 页面自己的接口 → 页面进错误分支；并轮询到 `liveLoading` 结束再断言）：

| 页 | 结果 |
|---|---|
| 健康中心 | `mk-empty--error` ×1、role=alert、标题「健康报告加载失败」、按钮「重试」、legacy 0 |
| 审计日志 | 同上（「审计日志加载失败」） |
| 通知与公告 | 同上（「公告加载失败」） |
| 批量实验 | 同上（「批量实验加载失败」） |

  轨迹可作证：`skel:30 → err:1`（骨架 → 错误态），全程 7 个被删类在 DOM 中为 **0**。
- 手拼 `mk-empty__action` 从 **10 处 → 0**（只剩原语自身）。
- `vue-tsc` ✓ / `eslint` ✓ 0 error / `vitest` **67 文件 452 测试** ✓。

**本轮撤回的误判**：一度以为「公告接口失败时页面卡在加载态、错误态不可达」（连续 4 次诊断都指向这个结论）。实际是我**测早了** —— `liveLoading` 要等全部 10 个后台域 settle（本机 4~8s），期间界面是骨架。等到位后错误态正常渲染。**教训记下：以 `liveLoading` 为门禁的页面，断言前必须等骨架消失，不能用固定短等待。**

### 阶段 1 续 ⑫ · 门禁规则 3 的洞（同日第十三批）

**洞**：`check-design-system.mjs` 的 `walk()` 只收 `.vue`，规则 3 的计数写在那层循环里 —— 于是 **`shared.css` / `src/styles/*.css` 完全不在 hex 计数内**。原语层恰恰是设计系统的最后一道防线：`#eef2fa` / `#eef5ff` / `#dbeafe` 与一串暗色补丁就是这么无声堆出来的（本轮 ⑪ 才手工发现）。

**改法**：
- 抽出 `countHardcodedHex(css, { tokenDefsAreLegal })`，两条计数路径（.vue scoped / CSS 文件）共用同一口径。
- 治理面扩为 **页面 scoped 块 + admin 原语层 CSS**（`shared.css` / `main.css` / `src/styles/admin-*.css`）。
- `tokenDefsAreLegal` **只对 `src/styles/*` 为真**（那是 `:root` / `html[data-theme]` token 的定义处，定义值是合法值）；`shared.css` 只放组件类（token 已上移至 main.css），其自定义属性算组件局部变量 —— 否则任何颜色都能靠 `--x: #hex` 洗白。
- **不含应用级全局样式**（`design-system` / `tremor-theme` / `modern-enhancements` / `learning-components`）：它们服务整个应用（含用户侧 `views/v2`），纳入会计到用户侧改动，与本守卫「只管 admin-redesign、不与并行开发打架」的既有边界不符。
- 顺带把过期的头注释「三条规则」订正为六条。

**基线**：49 文件 / 1061 → **53 文件 / 1239**（+178 = `shared.css` 114 + `admin-theme.css` 61 + `admin-surface.css` 2 + `main.css` 1）。棘轮只降不升，此后原语层的新增硬编码会在 CI 直接被拦住。

**验证（7 个探针，脚本化临时注入再复原）**：

| 探针 | 期望 | 结果 |
|---|---|---|
| ① 基线 | 通过 | ✓ |
| ② `shared.css` 直接写 `#abcdef` | 失败 | ✓ 114→115 |
| ③ `shared.css` 用 `--x: #abcdef` 洗白 | 失败 | ✓ 114→115（绕过被堵） |
| ④ `main.css` 非 token 行的 hex | 失败 | ✓ 1→2 |
| ⑤ `main.css` 的 token 定义行 | 通过 | ✓（定义值合法） |
| ⑥ `var(--token, #hex)` 兜底 | 通过 | ✓（有意写法） |
| ⑦ 复原 | 通过 | ✓ |

另：`vue-tsc` ✓ 0 error / `vitest` **67 文件 452 测试** ✓ / 根 `npm run design:check` ✓。
**注意 .vue 侧计数未变**（1061 → 1061），+178 全部来自新纳入的 CSS，说明扩展没有污染既有口径。

### 阶段 1 续 ⑬ · 原语层「亮色硬编码 + 暗色补丁」双份维护的收敛（第一批，同日第十四批）

⑫ 把原语层纳入棘轮后，`shared.css` 的 114 处、`admin-theme.css` 的 61 处就成了账面债。本批按 ⑪ 的做法**原样提升为 token**（暗色值即 token 的暗色档），并把暗色补丁行删掉 —— 暗色配对从"靠选择器权重的补丁段"搬到"token 一处定义"。

**为什么这一步顺带让基线下降**：`src/styles/*` 的 token 定义行不计入（定义值是合法值）。所以基线数字的准确含义是**「尚未集中定义的颜色数」**，而不是"硬编码总数"——把值提升成 token 正是它的目标态，不是绕过。

**本批 token（12 组，亮色档写 `:root`、暗色档写 `html[data-theme='dark']`，同名）**：

| token | 亮 / 暗 | 覆盖 |
|---|---|---|
| `--mk-surface-3` | `#f0f2f5` / `#253049` | `.mk-badge--muted` / `--role-control-signal` / `--render-hidden`（3 处共用一对） |
| `--mk-table-head-bg` | `#fafbfc` / `#141c2b` | `.mk-table th` |
| `--mk-table-head-hover-bg` | `#f2f6fb` / `#1c2637` | `.mk-table th:hover` |
| `--mk-table-row-line` | `#eef1f7` / `#1f2a3d` | `.mk-table td` 分隔线 |
| `--mk-table-row-hover-bg` | `#f6f9ff` / `#1a2436` | `.mk-table tbody tr:hover` |
| `--mk-menu-btn-hover-bg` | `#eef2fa` / `#222e44` | `.mk-menu__btn:hover` |
| `--mk-menu-item-hover-bg` | `#f0f5ff` / `#1f2b40` | `.mk-menu__item:hover` |
| `--mk-pills-bg` | `#eef2fa` / `#1d2739` | `.mk-pills` |
| `--mk-minibar-bg` | `#eef2fa` / `#232f45` | `.mk-minibar` |
| `--mk-hover-surface` | `#eff6ff` / `#1b2740` | `.mk-back/:hover` / `.mk-link/:hover` / `.mk-link--active` / `.mk-icon-btn:hover` |
| `--mk-btn-hover-bg` | `#f6f9ff` / `#1b2740` | `.mk-btn:hover` |
| `--mk-blue-hover` | `#2b64d8` / `#6a9cf3` | `.mk-btn--primary:hover` |

**顺带修掉的两个既有问题**：
- `.mk-link--active` 原本只有亮色 `#eff6ff`、**暗色没有补丁** → 暗色下是个近白的浅蓝块。改走 `--mk-hover-surface` 后暗色正确（属修 bug，非纯重构）。
- `.mk-icon-btn:hover` 在 ⑪ 被我改成了 `var(--mk-blue-bg)`，但它的暗色补丁其实是中性的 `#1b2740`（不是蓝调）—— 本批改走 `--mk-hover-surface` 才真正对得上。

**门禁顺带修一处噪声**：`#hex` 出现在**注释**里也被计入（`/* … 原来 #f6f9ff 近白闪 */` 反过来抬高了基线）。注释不渲染，现在先剥掉块注释再数。

**基线**：**1239 → 1192**（−47）。分文件：`shared.css` 114 → **76**、`admin-theme.css` 61 → 57、`main.css` 1 → 0、`admin-surface.css` 2 → 0，共 51 文件。

**验证（computed-style 断言，不是看截图）**：共 **24 条**断言，逐条比对浏览器算出的颜色与**改造前的原值**，明/暗两态各一遍 —— 全部一致：

- 真页面 14 条（`/admin/users`、`/admin/virtual-learners`）：表头/表行分隔线/表行悬停/表头悬停/胶囊/中性徽章/文字链悬停 × 亮暗
- **探针 10 条**：对随机页面上不常出现的全局原语（`.mk-btn`、`.mk-btn--primary`、`.mk-menu__item`、`.mk-minibar`、`.mk-link`）注入元素后 hover 再读（原语定义在 shared.css，全局生效，注入合法）

另：`vue-tsc` ✓ 0 error / `eslint` ✓ 0 error / `vitest` **67 文件 452 测试** ✓ / `npm run design:check` ✓。

**本批只做了「干净的对」，其余按下不表（需要你拍板）**：徽章族与按钮族里那些值是**近邻重复**的 —— 4 种绿 tint、3 种 slate 面、`#f0f2f5` 与 `#f1f5f9`、`#253049` 与 `#232f45`、`#fafbfc` 与 `#fafbfe`。严格零色差 ⇒ 得为每个近邻值各建一个 token（约 22 个一次性 token）；合并 ⇒ 会有 ≤4/255 的**不可见**改动。这违反你定的「不用语义相近 token 替换」，所以我没有擅自决定。

### 阶段 1 续 ⑭ · 原语层双份维护收敛（第二批：徽章族/按钮族/其余组件，同日第十五批）

按你选的口径（**严格零色差，建一次性 token**）把 ⑬ 剩下的全部收掉。近邻值不合并，各建各的 token；代价是 token 数上去了，换来的是**没有任何一处颜色发生 1/255 的变化**。

**新增 47 个 token**（亮色档 `:root`、暗色档 `html[data-theme='dark']` 同名成对）：

| 组 | token |
|---|---|
| 徽章族（14） | `--mk-badge-info-bg`、`-virtual-bg/-fg/-line`、`-deleted-bg/-fg`、`-hidden-bg/-fg`、`-proposal-bg`、`-visible-bg`、`-handoff-bg`、`-internal-bg/-fg`、`-accumulate-bg` |
| 按钮族（7） | `--mk-ghost-line/-fg`、`--mk-btn-ok-bg/-line/-fg`、`--mk-btn-ok-bg-hover/-line-hover` |
| 实心底文字（1） | `--mk-on-fill`（**9 处 `color: #fff` 收敛为 1 个 token**；明暗同值，无需暗色档） |
| 其余组件对（25） | `--mk-toast-info-fg`、`-pill-active-bg/-fg`、`-pill-count-active-bg/-fg`、`-meta-link-on-bg/-fg`、`-search-clear-bg/-fg`、`-modal-close-bg/-hover-bg`、`-drawer-close-bg/-hover-bg`、`-input-disabled-bg`、`-card-foot-bg/-line`、`-batchbar-bg/-line/-danger-fg/-danger-hover-bg`、`-alert-ok-bg/-fg`、`-alert-info-bg/-fg`、`-skeleton-from/-to` |

**顺带修回 ⑬ 我自己的一个回归**：⑬ 删暗色补丁时把 `.mk-badge--flow-handoff` 的暗色行**误删**了（本该保留），暗色下它会退化成近白块 —— 本批由 `--mk-badge-handoff-bg` 修回（值与原暗色完全一致）。

**数字**：

```
基线 1192 → 1120  (−72)
shared.css 76 → 4      main.css token 定义行不计入
```

`shared.css` 只剩 **4 处**，且都不是「亮暗成对」可提升的：
- `#e9f1fd`（`.mk-th--sortable:hover`）、`#cbd5e1`（`.mk-search__clear:hover`）、`#e2ecff`（`.mk-link--active:hover`）—— **只有亮色、没有暗色档**。给它们造 token 只能靠编一个暗色值（新增设计），或者造一个"没有暗色档的 token"（那只是把不对称藏起来）。属于**设计决策**，留给你。
- `#131b29`（`.mk-field__input:disabled`）—— 它亮色侧没有任何规则，提升会给它在亮色下凭空加一个底色。

**验证（决定性：computed-style 断言，106 条，明/暗各一遍，逐条比对改造前的原值）**：

| 批次 | 条数 | 内容 |
|---|---|---|
| ⑭ 本批 | **82** | 14 个徽章变体的底/字/边、幽灵/成功按钮的三属性、提示条、胶囊激活、搜索清除、关闭按钮、批次条、卡片脚、骨架渐变变量… |
| ⑬ 回归 | 24 | 表格四态、胶囊、中性徽章、菜单、迷你条、按钮悬停 |

做法：对页面上不常出现的原语，**注入探针元素**后读 `getComputedStyle`（原语定义在 shared.css，全局生效，注入合法）。全部 106 条 → **零色差**。

另：`vue-tsc` ✓ 0 error / `eslint` ✓ 0 error / `vitest` **67 文件 452 测试** ✓ / `npm run design:check` ✓。

**过程中被抓出来的两个错（都是守卫/验证的功劳，非事后打扫）**：
1. 我替换 `.mk-modal__close` 那段时**误删了 `.mk-modal__body` 规则** → **门禁规则 2（幽灵类）当场报错**并列出 4 个引用它的页面。已修回。
2. `⑬` 误删 `.mk-badge--flow-handoff` 暗色行 → 本批读 diff 时发现并修回。

**一条重要验证教训（已记档）**：**Vite dev server 会送过期的 CSS**。本轮有 3 条断言先报失败，我一路查到浏览器 CSSOM 里那段 token"不存在"，最后发现源码里在、**服务端送的是旧版本**；`touch` 源文件后立刻正常。**结论：验证 CSS 改动前必须 ensure 服务端已刷新（touch 或重启），否则会把自己的正确改动误判成 bug。** 这轮差点据此"修一个不存在的问题"。

### 阶段 1 续 ⑮ · T2 实体头原语 `.mk-entity`（同日第十六批）

§8 标「高」优先级、T2 硬约束 1 指名的第一块中层原语：**详情页身份区唯一化**。原状是**三份独立实现**（`.ld-head` / `.ud-head` / `.vp-top`），且 L1 列表页全有状态条、点进 L2 后页头语言突然换掉（附 C 结论 1 的"跨层级断裂"）。

**设计**（类级原语，与 `.mk-card`/`.mk-status` 同族；页面直接写类）：

```
.mk-entity                    卡片：grid gap 12 + padding 16/18/14 + border + radius 12 + surface
  --flat                      无卡片（本身已有页面留白的详情页用）
  .mk-back                    返回行（复用既有原语，不由 entity 提供）
  .mk-entity__main            flex / align-center / gap 14
    .mk-entity__avatar        46×46 r14 形状层（不含颜色）
      --user                  绿蓝渐变（原 .ud-avatar 值，已提升为 token）
      --learner               蓝紫渐变（原 .ld-avatar）
      --round                 圆形 + 内描边；**具体颜色由页面按名称哈希给**
    .mk-entity__id            grid gap 2 flex 1
      .mk-entity__name-row    flex wrap gap 10（vp 的 `__meta` 参数与之完全一致 → 可直接当行容器用）
        .mk-entity__name      18px（`--lg` = 20px/紧排，原 .vp-top__name）
        .mk-entity__badges    flex wrap gap 8
      .mk-entity__sub         faint / 12px
    .mk-entity__actions       右对齐（margin-left auto）+ wrap
```

**研究阶段的关键发现**：`.ud-head` 与 `.ld-head` 除 **gap（14 vs 12）、名字行 gap（8 vs 10）、头像渐变** 外逐属性相同 —— 两者本是同一形态抄了两遍；`.vp-top` 才是真变体（无卡片、圆形头像、20px 名字、名字与徽章同行）。所以原语取 ld 的 12/10 为准，ud 只动 2px 可忽略；vp 用 `--flat` + `--round` + `--lg` 表达。

**顺带解决的一个更隐蔽的重复**：三页各自维护了一套**4K 三档覆写**（`.ud-avatar`/`.ld-avatar`/`.vp-avatar` 的 54/62/72、52/60/68、名字 21/24.5/28.5 …）。已**上移到原语一处**（头像/名字/副行 + `--lg` 名字）。副作用：vp 的头像 4K 档从 52/60/68 统一到 54/62/72（仅 ≥2000px 生效）。

**页面保留什么**：vp 的头像**色板**（按名称哈希的 8 色）留在页面 —— 原语管**形状**、页面管**调色**，这是有意的分工，不是漏收。

**验证（真机，明/暗 × 3 页 × 1440/2560px）**：

| 页 | 实测 |
|---|---|
| 用户详情 | border 1px `--mk-line`（亮 rgb(230,235,244) / 暗 rgb(42,56,80)）、radius 12、bg `--mk-surface`（亮白/暗 rgb(23,32,47)）、头像 46×46 r14、名字 18px、副行 12px `--mk-faint`、操作右贴边（gap 19 = padding 18 + border 1） |
| 学习者画像 | 同上一组；**2560px 下 4K 档生效**：头像 54×54、名字 21px、副行 14px；3 个徽章在名字行内 |
| 虚拟学习者 | `--flat` ✓（bg 透明 / border 0）、头像 46×46 **r50%**、**色板仍生效**（哈希取到 rgb(6,182,212)）、名字 20px、3 个操作右对齐 |

截图（亮/暗）逐页留档，观感与改造前一致。

**过程纪律**：门禁规则 2 只覆盖 `mk-*` 幽灵类，**页面前缀的死类它抓不到** —— 三页里那 18 条 4K 死规则是我手工 grep 出来的（`grep ud-avatar/ld-avatar/...`）。这条已记进「仍未动的」（见下）。

另：`vue-tsc` ✓ 0 / `eslint` ✓ 0 error / `vitest` **67 文件 452 测试** ✓ / `design:check` ✓（1115，−5）。

### 阶段 1 续 ⑯ · T2 区块原语 `.mk-section`（同日第十七批）

§8 第二块「高」优先级原语。**只收敛"区块头/折叠头"这一件事** —— 区块**正文**各页结构不同（引导段落 / 图例分组 / 子组件），属于页面内容，**不收敛**（这是有意的边界，不是漏收）。

**盘点（客观计数）**：

| 私有实现 | 处数 | 文件 |
|---|---|---|
| `hc-details__summary`（与 `mk-card__head` 同用） | 4 | HealthCenter |
| `fdp__box-summary` | 3 | DriftAuditPanel |
| `orch-fold__summary` | 2 | Orchestrator |
| `frt__legend-summary` | 1 | FieldRoutingTable |
| `msk__sec-head`（区块头，非折叠） | 4 | SkillDrawer |
| `sdp-sec-head`（同上，与上一族除字号外逐属性相同） | 6 | skill-design ×2 |

四份折叠头各写一遍「隐藏默认三角 + ▸/▾ 指示 + pointer/hover」，两族区块头同形重复。

**原语**：

```
.mk-section__head          区块头：flex / space-between / gap 10
.mk-section__head h4,
.mk-section__title         标题：12px / 700 / .06em / 大写 / faint
                           （元素选择器让 10 处既有 <h4> 不必改标记即可收敛）
.mk-section__summary       折叠头行为：list-style none + ::before ▸ + 展开 rotate(90deg) + pointer
  --muted                  弱化档（orch/frt 的既有基调）
  :not(.mk-card__head)     独立使用时的缺省排版
.mk-section__conclusion    结论行：一句话、加粗、常驻可见 ← T2 硬约束 2 的载体
```

**几处刻意的统一（都会改变像素，逐条列出）**：
- **指示器**统一为 `▸` + `rotate(90deg)`（原本 2 处用 rotate、1 处用换字、**HealthCenter 4 处完全没有指示器**）→ HealthCenter 的折叠区**获得可见的可折叠提示**。这是补 affordance，不是改风格：它此前把 `::-webkit-details-marker` 隐藏了又没有替代，**用户看不出那是一条可点开的标题**。
- 指示器颜色统一 `--mk-blue`（`fdp` 原为 `--mk-faint`）。
- 内边距/字号/字重统一 `10px 14px / 12.5px / 700`（原 9/10/11px、12/12.5px、700/800 各不同）。
- hover 统一到 `--mk-blue`（`frt` 原为 hover 到 ink）。
- `--muted` 修饰保住 orch/frt 的次级基调 → **这两处的颜色零变化**。
- **与 `mk-card__head` 同用时，排版归后者**：用 `:not(.mk-card__head)` 显式表达。一开始这个效果是"白捡"的（我把 `.mk-section` 段插在了 `.mk-card__head` 之前，靠源码顺序取胜），那样太脆 —— 已改成不依赖顺序的显式写法。

**验证**：

| 对象 | 实测 |
|---|---|
| HealthCenter 折叠头 ×4 | `hasCardHead: true`、padding **9px**（= `mk-card__head` 的，**零变化**）、颜色未变、`::before` = `"▸"` 蓝、**展开态 `transform: matrix(0,1,-1,0,0,0)` = rotate(90deg)** ✓ |
| Orchestrator muted 折叠头 | `--mk-muted`（亮 rgb(91,101,119) / 暗 rgb(159,176,200)）、padding 10px 14px、12.5px、`▸` 蓝 ✓ |
| sec-head 两族（10 处） | **结构验证**：门禁确认 `mk-section__head` 已定义且非幽灵类；10/10 站点的 `<h4>` 均紧随其后（`h4` 排版生效的前提）；typecheck/lint/测试通过 |

**诚实声明**：sec-head 两族**未做像素级验证** —— Skill 设计页需要真实注册的 skill id，而目录 API 给出的 `goal-agent` 等 id 在页内解析不到（页面报「未找到 Skill」，工程/版本 tab 渲染不出来）。改法是纯类名替换 + 同形选择器提升，风险低，但确实没有像素证据。

另：`vue-tsc` ✓ 0 / `eslint` ✓ 0 error / `vitest` **67 文件 452 测试** ✓ / `design:check` ✓（1114）。

### 阶段 1 续 ⑰ · 逐步收尾（同日第十八批）

#### 步骤 1 · `.mk-section` 的 4K 档上移到原语

与 ⑮ 把实体头 4K 档上移同构。原来三页各在 4K 块里覆写同一组尺寸，值还不一致：

| 断点 | Orchestrator | DriftAuditPanel | FieldRoutingTable | → 统一为（众数） |
|---|---|---|---|---|
| 2000px | 12/16 + 13.5px | 13/17 + 14px | 11/17 + 14px | **12px 17px + 14px** |
| 2800px | 14/19 + 16px | 15/21 + 16.5px | 13/21 + 16.5px | **14px 21px + 16.5px** |
| 3600px | 16/22 + 18.5px | （无） | （无） | **16px 22px + 18.5px** |

注意 4K 档也带 `:not(.mk-card__head)` —— 否则权重压不过基类，且会把 HealthCenter 的卡片头式折叠头一起放大（它本来不缩放）。

**验证（真机 computed）**：Orchestrator 独立折叠头 1440px = `10px 14px / 12.5px`，**2560px = `12px 17px / 14px`**（4K 档生效）；HealthCenter 卡片头式两宽度都保持 `9px 14px / 14.5px`（**零变化**）。

#### 步骤 2 · 门禁规则 7：死 CSS 检测

**动机**：规则 1/2 只覆盖 `mk-` 前缀，`.ud-*` / `.ld-*` 这类**页面前缀的死类无人管** —— ⑮ 那 18 条死 4K 规则是手工 grep 出来的。

**判定（刻意保守）**：
- "用过" = 名字出现在**全 src**（不只 admin）的**模板 + 脚本**里（去 style 块）。用全局语料是因为原语/子组件的修饰类常由**父页面**通过 class 落到子组件根元素上（`mk-kpi--linked-on`），或由 admin 之外的界面施加；只查本文件会误判。
- 剥注释后再抽选择器（注释里的 `.css` 会被误当类名）。
- 剥伪类/伪元素（含 `:not(.x)` 的参数），避免把参数里的类当成"被定义"。
- 跳过 `:deep()`。

**中途发现并修掉的假阳性**：最初用"去掉末段的类名前缀再模糊匹配"处理动态拼类名，结果 `probe-dead` 因为语料里恰好有 `probe-` 而被判成"用过" —— **反验证探针 ② 当场暴露**（本该失败却通过）。改成从语料里**精确抽取动态前缀**（`` `x--${v}` `` / `'x--' + v` 两种写法，182 个前缀），用 `startsWith` 判定。修正后探针 ② 如期失败。

**棘轮**：基线记 126 处（25 个文件），**只降不升**。

**6 个探针（全部用文件备份复原）**：

| 探针 | 期望 | 实测 |
|---|---|---|
| ① 基线 | 通过 | ✓ |
| ② scoped 里加一条没人用的类 | 失败 | ✓ 新增死类=1 |
| ③ 加类且模板里用了 | 通过 | ✓ |
| ④ 定义在 A、用在 B（跨文件） | 通过 | ✓ |
| ⑤ 删掉一条基线内死类 | 通过 | ✓（棘轮只降不升） |
| ⑥ 由备份复原 | 通过 | ✓ |

**发现**：admin 代码里有 **126 处死 CSS**（VirtualProfile 22、SessionCockpit 17、LearnerDetail 7、GoalConversations 6、ExecLogs 5…），例如 `.vp-guide__*`（整块引导样式）、`.cp-topbar__dot--*`、`.vp-back`、`.gc-stack__*`、`ld-concept-label--warn`（模板只用 `--ok`/`--bad`）。抽查 6 处全部确认只存在于 CSS 定义里。
**没有直接删**：里面像 `vp-guide__*` 很可能是**在建代码的脚手架**，删除是破坏性操作 —— 入账后把清单留给拍板。

#### 一次事故与恢复（如实记录）

探针 ⑥ 我一开始用 `git checkout -- <file>` 复原，结果把 **`SessionCockpit.vue` 回退到了 HEAD，抹掉了 ⑬ 在该文件的全部改动**（MkSkeleton 接入、旧骨架类删除、暗色补丁删除）。**是门禁的失败把我叫醒的**（回退后那些旧类变成"新增死 CSS"，退出码 1）。已按 ⑬ 的记录逐条重做并复核（`MkSkeleton` 3 处引用、旧骨架类 0、门禁 ✓）。
**教训**：验证期间复原**只能用自己的文件备份**，绝不对工作区文件用 `git checkout`；本项目工作区长期是未提交状态，`git checkout` = 数据丢失。

另：本轮我**三次**把"删除某段 CSS"写成了"替换成另一段"（占位残留），都靠随后的核对发现 —— 删除类编辑必须复核。

### 阶段 1 续 ⑱ · 五项收尾（同日第十九批）

#### ① 死 CSS 126 → 0
一次性 codemod 精确删除含"死类"的规则。**codemod 自身 4 个 bug 全靠核对抓出**：删除区间吃掉前导换行 → 上下行粘成一行；注释里的 `{}` 破坏结构扫描；**跳过 `@media` 内部**（漏 54）；**跳过原生嵌套容器** `html[data-theme='dark'] { .x {} }`（漏 37）。每轮都用整目录逐文件比对确认**只动 `<style>` 内容**。
hex 随之 1114 → 1032（死规则里带的硬编码一并清掉）。真机核验 6 页正常渲染、无页面错误。

**规则 7 第一轮就抓到我 ⑯ 的 bug**：`mk-section__title` 在 3 页 4K 档被当选择器、模板却是裸 `<h4>` → 那三处 4K 字号**从未生效**。已修。

#### ② `.mk-seg`（分段控件）
与 `.mk-pills` 对照后确认**不能硬并**（激活态语义不同：ink+微阴影 vs blue+蓝环）→ 按文档原意新建原语、值逐条搬：亮色**零变化**，暗色**修好**（原无暗色覆写、留浅底）。同步更新 `api-config.smoke.test.ts` 选择器。

#### ③ 进度条统一 `.mk-minibar`
迁移 5 处（HealthCenter 完成度条 / UserDetail 学习路径 / LearnerDetail 进度·分布·校准）。**渐变填充全部换平色**（`data-tone`），正是 §4 点名的违规；页面的 rec 色调类保留在 fill 上。
真机 computed：健康中心 5 条（6px/99px/`#eef2fa`↔`#232f45` + 5 个 rec 色调）、学习者详情 1 条（填充已是平蓝）。

#### ④ token 补档：`shared.css` 4 → 0、`admin-theme.css` 57 → 0
- shared.css 的 3 处「只有亮色」补成对 token（暗色档按本仓既有惯例取值：蓝调叠加 / 深一档表面）；第 4 处 `.mk-field__input:disabled` 与 `.mk-input:disabled` 同基调（原只给暗色值，**亮色下没有底色**）。
- `admin-theme.css` 的 57 处：会话校验遮罩自带配色 + EP 覆写调色板，新建 **25 个 token**（亮暗成对，或仅暗色段使用的同值 token）。
  **零色差静态证明**：逐处核对「token 在该行所属主题下的值 == 原 hex」→ **57/57 相等**（脚本化，含 `var()` 解引用与 3 位 hex 归一化）。

#### ⑤ `.mk-section` 首次真正使用（T2 硬约束 2）
把「证据时间线」卡改成 **结论常驻 + 明细分折叠**：

```
<section class="mk-card ld-ev-main">
  <div class="mk-card__head">证据时间线 + 条数 meta</div>
  <p class="mk-section__conclusion">共 N 条学习事件，其中 M 条置信度低于 50%（仅供参照）。</p>
  <details class="ld-ev-details"><summary class="mk-section__summary">逐条明细</summary>…</details>
</section>
```
**结论文字严格取自本卡已有数据**（条数 + 卡片里本来就标的「证据不足」），未新增任何判断 —— 这是"结构我做、文案用现成"的边界。

**门禁又抓到我一次**：我写了 `class="mk-card mk-section"`，但原语只定义了 `__head/__title/__summary/__conclusion`，**没有裸 `.mk-section`** → 规则 2 当场报幽灵类。已去掉并在原语文档里写明「容器复用 mk-card，本原语没有裸容器类」。

**限制（诚实声明）**：本地库**没有学习证据数据**，结论行与明细分走 `v-if="evidence.length"` 的 `v-else`（空态）→ 浏览器里只能核到「卡片类正确 + 空态正常 + 门禁确认两个类都是已定义原语」，**未能核到结论/明细的实际像素**。要看到实际效果需要有证据数据的账号。

### 阶段 1 续 ⑲ · 收尾四件（同日第二十批）

#### ① EP 覆写的死活 —— **是活的**（查了再动，没删）
`admin-theme.css` 里 ~50 条 `body.admin-route .el-*` 一度像是死重（redesign 里零 EP 组件）。查证：`body.admin-route` 由路由对**所有 `/admin/*`** 打上（`router/index.ts:357`），而 `admin-redesign/VirtualProfile.vue` 嵌了旧版 EP 面板 **`QuickLearnPanel`** → 覆写**确实生效**。
**副产品**：那是 redesign 里**唯一**的 EP 孤岛（一处旧设计语言嵌在新页面里），记进「仍未动的」。

#### ② `.mk-seg` 推广（第 2 处）
`LearnerDetail` 的「42 天 / 90 天」分段控件原本是 `.ld-load__seg*`（还带着一份**重复定义**）→ 改走 `.mk-seg`。
**真机核验**：2 项、激活态正确、明暗两态（激活底 `#fff` / `rgba(91,141,239,0.22)`，字号 12px）。
已记的像素差异：容器圆角 9→10、gap 2→4、项内边距 4/10→6/12、字重 700→600、激活字色 blue→ink（属"统一密度 + seg 语义"）。

#### ③ 错误横幅统一：3 份私有 → `.mk-alert--row`
原状：`Addons/.ac-error`、`ApiConfig/.ac-config-error`、`ExecLogs/.exec-error` 三份 flex 行（消息 + 重试），差异只在 padding/radius/按钮样式。原语 `.mk-alert` 只有 `display:block` 的条，**缺 flex 行与重试位**。补：

```
.mk-alert--row    行式布局（flex / space-between / gap 10）
.mk-alert__msg    消息位
.mk-alert__act    右侧动作位（保留给非按钮动作）
.mk-alert__btn    横幅内重试按钮（取多数形态：红字下划线，无描边）
```

三处迁移；页面只保留**位置**（`ac-error` / `ac-config-error` 退化成 margin 一行）。
**真机探针核验（明/暗）**：`flex` / `space-between` / gap 10 / 底 `#fef2f2`↔`rgba(248,113,113,0.14)` / 字 `#dc2626`↔`#f87171` / fs 12.5 / r8 / 按钮 `underline` + `inherit` 色 ✓。
**已记的像素差异**：`ExecLogs` 那条原来是更"重"的样式（padding 12/16、r12、带红描边、暗色字 `#fca5a5`）→ 统一为标准条（暗色字改走 token 的 `#f87171`）。
**未迁移**：`AdminConsole` 的三处错误面（整页错误卡 + 诊断折叠 + errorbar）形状不同，仍留页面私有。

#### ④ 图形页 `.dfg-pipe` 补成对 token
原来**只有暗色档**（`linear-gradient(180deg, var(--mk-graph-canvas), #101725)`），亮色侧无声明。新增 `--mk-graph-pipe-bg`（`:root` = `none`、暗色 = 同一条渐变），页面的暗色覆写随之删除。
**真机读值**：亮 `none`、暗 `linear-gradient(180deg, #141c2b, #101725)` —— 与原值逐个一致（零色差）。

### 阶段 1 续 ⑳ · 修掉旁支违规，门禁全绿（同日第二十一批）

你的新文件 `DayTimeline.vue` / `SimulatedDaySettings.vue` 一直在让门禁与 lint 变红。这轮按你"继续"的指示把它们修掉了（**是修，不是记进基线**）：

- **`DayTimeline.vue` 用的是不存在的 token 名**（`--mk-text-muted` / `--mk-danger` / `--mk-border` / `--mk-text`）→ 实际渲染的一直是 `var()` 兜底值，而且**整个文件没有暗色适配**（`#222` 文字在暗色下几乎不可见）。已换成真实 token：`--mk-faint` / `--mk-red` / `--mk-line` / `--mk-ink`；5 处硬编码色值走 `--mk-green` / `--mk-surface-3` / `--mk-amber` / `--mk-amber-fill` / `--mk-blue` 及其 `*-bg` 底色 —— **顺带把这个文件补上了暗色适配**。
- 手写「加载中…」→ `<MkLoading text="加载中…" />`。
- 2 处 `catch (e: any)` → `catch (e)` + 本仓既有的 `errMsg(e)`。
- `SimulatedDaySettings.vue` 的 `apply(raw: any)` → `Partial<typeof DEFAULT>`。
- 核验：该文件用到的 **12 个 token 全部已定义** ✓；门禁 7 条全过、`vue-tsc` 0 error、`eslint` **0 error**、`vitest` 453 测试 ✓。

**基线收紧**：47 文件 / **945 处** hex / **死 CSS 0**（首轮审计时是 .vue 侧 1061 + 原语层 178）。

### 阶段 1 续 ㉑ · 门禁规则 8 + `.mk-section` 再落地（同日第二十二批）

#### ① 修掉 16 处「引用了不存在的 token」
一次全仓扫描发现 **6 个文件、16 处 `var(--mk-*)` 引用了根本没定义的 token**（PromptEval / VirtualLearners / VirtualProfile / SimulatedDaySettings / SessionSecurity；含 DayTimeline 那批的同类）：`--mk-indigo`、`--mk-text`、`--mk-strong`、`--mk-ok`、`--mk-warn`、`--mk-border`、`--mk-text-muted`、`--mk-active-muted`。
后果是**静默降级**：浏览器采用 `var()` 的兜底值（多为没有暗色适配的硬编码色），页面照常渲染、CI 全绿。已逐个换成真实 token（`--mk-purple` / `--mk-ink` / `--mk-muted` / `--mk-green` / `--mk-amber` / `--mk-line` / `--mk-faint`），**顺带修好这些位置的暗色适配**。
另识别出 **5 处「有意的可覆盖钩子」**（`--mk-empty-min-h`、`--mk-skel-card-min/-cols`，文档写明"页面可覆盖"）→ 是设计，不是 bug。

#### ② 门禁**规则 8：`var(--mk-*)` 引用的 token 必须已定义**
治本：这类 bug 靠人眼极难发现（CI 全绿），本仓已证明存在 16 处。规则把「定义面」取全量（原语 CSS + 全部 .vue 的自定义属性）、「引用面」收在 admin-redesign + `src/styles`（与规则 3 同界），并保留 `TOKEN_HOOK_WHITELIST` 登记有意留白的钩子。

**反向验证（5 探针）**：

| 探针 | 期望 | 实测 |
|---|---|---|
| 基线 | 通过 | ✓ 未定义 0 |
| 引用不存在的 token | 失败 | ✓ 精确报出 `文件 ×1 mk-nope` |
| 用白名单里的可覆盖钩子 | 通过 | ✓ 规则 8 沉默 |
| 页面自己定义局部 token 再引用 | 通过 | ✓ |
| 跨文件用已定义 token | 通过 | ✓ |

（过程中我发现自己第一版把「定义面」写成只扫 `.vue`、漏掉 CSS，导致 897 处误报 —— 已修。）

#### ③ `.mk-section` 再落地 2 处（LearnerDetail）
- **概念掌握**：结论行由现有 `conceptBars` 的 tone **派生**（「共 N 个概念：X 个转移就绪、Y 个待巩固、Z 个证据不足」），明细（逐概念条）折进 `<details>`。
- **预测校准**：结论本就常驻（两个命中率大数），把「校准分布 + 最近预测」折进 `<details>`。

两处结论都**没有新增判断**，只用页面已有的数据组句。核验：标签配对（section 22/22、details 3/3、div 98/98、p 13/13、summary 3/3）、`vue-tsc` 0、门禁 8 条全过、453 测试 ✓、页面冒烟无 JS 错误 ✓。
**限制**：本地库无概念账本/证据数据 → 结论行与明细走 `v-if` 的空态分支，**像素仍未核到**（同前）。

### 阶段 1 续 ㉒ · EP 孤岛重写 + 删掉整条 EP 桥（同日第二十三批）

**背景**：`admin-redesign` 里嵌着旧版 `views/admin/components/virtual/QuickLearnPanel.vue`（画像页「账号自动学习」）—— 全站 admin 侧**最后一个** Element Plus 消费者，872 行、11 种 EP 组件，**一个 mk- token 都没用**；`admin-theme.css` 里 45 条 `body.admin-route .el-*` 覆写就是为它活的。

#### ① 重写（EP → mk-*，逐个映射）

| EP | → | 原语 |
|---|---|---|
| `el-dialog` | → | `mk-modal`（Teleport + `mk-modal__panel--wide` + `__head/__title/__close/__body`） |
| `el-button` ×12 | → | `mk-btn`（`--primary` / `--danger-ghost` / `--sm`）；`text` 类改 `mk-link`；`:loading` 改「禁用 + 文案切换」 |
| `el-select` ×3 / `el-option` ×7 / `el-option-group` | → | 原生 `<select class="mk-field__select">` + `<optgroup>` / `<option disabled>` |
| `el-input` / `el-input-number` | → | `<input class="mk-field__input">` / `type="number"` |
| `el-collapse(-item)` ×2 | → | `<details>` + `mk-section__summary` |
| `el-tag` ×4 | → | `mk-badge`（`--ok`/`--warn`/`--bad`/`--info`） |
| `el-alert` | → | `.mk-alert--info` |
| 私有 spinner | → | `MkLoading inline` |

样式的 24 处 `--el-*` 变量也换成 mk token（`--el-text-color-secondary`→`--mk-faint`、`--el-color-primary`→`--mk-blue`、`--el-fill-color-light`→`--mk-surface-3` …）。
**已知取舍**：EP 的 `filterable`（下拉可搜）无法一对一映射，改为按路径分组的原生下拉（`<option disabled>` 保留"不可学"语义）。

#### ② 走查抓到的**行为回归**（这就是为什么要交互验证）

新 modal 没有 Esc 处理（旧 `el-dialog` 自带）→ **Esc 关不掉**。已补 `useEscape(() => props.visible, close)`，并把 `close()` 与原 `@closed` 的收尾（停轮询）对齐。

**走查结果（真机）**：入口存在 ✓ / 弹窗结构（wide 面板、标题、✕、info 条、3 个下拉、number 输入、4 个按钮、fixture 折叠）✓ / **面板内 EP 类 = 0** ✓ / 折叠可展开 ✓ / 下拉选择生效（`stress_test`）✓ / **Esc 可关闭** ✓ / 无页面错误 ✓ / 关闭后 VirtualProfile 正常 ✓

#### ③ 删掉整条 EP 桥

- 删前确认：全仓 EP **组件**只剩用户侧 `App.vue` + `CompletionCard`/`SessionFeedbackPanel`（在 `LearningEvaluationPage`，**不在** `body.admin-route` 下）✓ 且被删的 45 条**全部**是 `body.admin-route`（或 `html[data-theme=dark] body.admin-route`）作用域 ✓ → 删除只影响 admin，而 admin 已零 EP ✓
- 结果：`admin-theme.css` **467 → 196 行**（只剩"会话校验遮罩"），并删掉我为它建的 **20 行 `--mk-ep-*` token 定义** ✓

#### ④ 顺带又抓到一处同类 bug

`VirtualProfile.vue:2418` 引用了 `var(--el-border-color-lighter, #e8ecf2)` —— 若直接删桥，这条边框在暗色下会退化成固定浅灰。已改 `--mk-line`。
**并把规则 8 扩展到覆盖 `--el-*`**：admin 侧引用 EP 桥变量同样报错（探针验证：注入 `var(--el-border-color-lighter, #ccc)` → 精确报出「EP 桥变量」✓）。

`vue-tsc` 0 / `eslint` 0 error / `vitest` 67 文件 453 测试 / 门禁 8 条全过 ✓

### 阶段 1 续 ㉓ · SessionCockpit 切片收敛 · 第 1 片（同日第二十四批）

**先做了结构调查**（结论影响后续做法）：

- 3815 行、**61 个 `cp-*` 类族**，但按族拆开看，**多数是功能内容**（`cp-trace-list` 70、`cp-timeline` 36、`cp-lesson-wrapup` 36、`cp-eval` 25、`cp-learn-tree` 25、`cp-transcript` 16 …）—— 这些是"这一个页面才有的视图"，**不是设计系统重复**，按约定保持页面私有。
- 它已经用了 **37 个 `mk-*`**、25 个 token（`mk-back` / `RunStateBadge` / `RunStageBar` / `mk-minibar`…）✓ 部分已接轨。
- 真正"孤岛"的只有三样：**页头形态**（`.cp-topbar` 是粘性状态条，与 L1 页的 `.mk-status` 语言不同 —— 正是附 C 结论 1 点名的跨层级断裂）、**状态语义**（自一套 tone）、**量化表达**（预算条自造 track/fill）。

**第 1 片：预算条 → `.mk-minibar`（并全 token 化）**

`.cp-budget` 原本自造了 track/fill：`height 6px / radius 3px / bg #e2e8f0` + `#10b981` 填充，并有三档 `.is-warn` / `.is-full` —— **与 `.mk-minibar` 的 ok/warn/bad 语义一一对应**，是干净的一对一收敛：

```
<span class="mk-minibar cp-budget__track">
  <i class="mk-minibar__fill" :data-tone="budgetTone === 'full' ? 'bad' : budgetTone === 'warn' ? 'warn' : 'ok'" … />
</span>
```

同时把胶囊自身的 6 处硬编码换 token（`#e2e8f0`→`--mk-line`、`#f8fafc`→`--mk-card-foot-bg`、`#64748b`→`--mk-muted`、`#334155`→`--mk-ink`、两处 7% 色调→`--mk-amber-bg`/`--mk-red-bg`、`#dc2626`→`--mk-red`），并**删掉 5 条因此冗余的暗色覆写**（`#232f45`/`#141c2b`/`#2a3850`/`#9fb0c8`/`#e6edf7` 的值就是对应 token 的暗色档）。
其中 label 特意映射到 `--mk-muted`（而非 `--mk-faint`）—— 因为原暗色值 `#9fb0c8` 正是 `--mk-muted` 的暗色档，这样删覆写才零色差。

**核验**：门禁 ✓（hex **945 → 931**）、`vue-tsc` 0、`eslint` 0 error、453 测试 ✓、CSS 花括号平衡 ✓、sessions / virtual-learners 页无 JS 错误 ✓
**更正（原以为进不去）**：座舱需要一个**有运行记录**的虚拟学习者 —— 入口是「画像 → 运行 tab → 打开座舱」；本地库里那个学习者有 1 条运行 ✓ 所以**能进**。进去后两片都核到了：`.cp-topbar .mk-status` 存在、标题 `会话监控 <id>`、`.mk-status__action` 刷新按钮 1 个、`.cp-budget .mk-minibar` 1 条且 `data-tone="ok"`、无页面错误 ✓ 截图留档。

### 阶段 1 续 ㉔ · SessionCockpit 第 2 片：页头改用 `.mk-status` 语言（同日第二十五批）

**取舍与定法**：`.cp-topbar` 是**粘性状态条**，直接换成 `.mk-status`/`.mk-entity` 会变成卡片形态、**丢掉 sticky**（监控页滚动时状态不再常驻）。定法是**分离职责**：

```
.cp-topbar            ← 页面自己的"粘性放置"（sticky / top / z-index / 页面底色），不碰外观
  .mk-status--muted   ← 状态条外观与内容协议全由原语提供
    __dot / mk-back / __title / __sep / RunStateBadge / RunStageBar / __meta / .cp-budget / __actions(__action)
```

**删掉的自造样式**（15 条规则 + 4K 档）：`.cp-topbar__row`、`.cp-title`、`.cp-topbar__spacer`、`.cp-topbar__sep`、`.cp-topbar__mode`、`.cp-topbar__btn`(+hover/disabled)。
**保留**：`.cp-title__id`（会话 id 的小字）、`.cp-topbar__autopilot`（自动驾驶指示，现挂在 `__meta` 上）。

**顺带**：`.cp-*` 类族从 61 → 60，页面 3818 → 3772 行；`刷新` 按钮从自造按钮变成 `.mk-status__action`（与 L1 页一致），并带上「刷新中…」文案。

**真机核验（座舱内）**：页头渲染为 `灰点 + ← 画像 + 会话监控 <id> + ✕已放弃(RunStateBadge) + 阶段条(RunStageBar) + 辅助模式 + 预算条 6/1500 + 刷新`，与 L1 页同语言 ✓ sticky 保留 ✓ 无页面错误 ✓

### 阶段 1 续 ㉕ · SessionCockpit 第 3 片：状态语义对齐 R2（同日第二十六批）

**先找缺陷（三处，都是真实可复现的）**：

1. **`.cp-aside-card__dot` 根本没有 `is-bad` 档** —— 只有 `is-ok`/`is-warn`/`is-muted`（`background` 就是 `--mk-faint`）。于是**运行失败 / 未完成（疑似卡死）时状态点显示灰色** ✗ 这正是 R2 硬约束 2「失败不得静默降级为正常」，与当初 `OpsCenter.vue:7` 的死类名**同一种形状**（那次已修，这次是同一坑的第二处）。
2. **页头状态点是写死的 `mk-status--muted`** —— 于是 `.mk-status__dot` 的固定 hover 提示渲染成「**暂无数据**」✗，而这是一个**有数据**的会话；同时 `::after` 文案与真实态势无关。
3. **`sessionStatusLabel` 对 `abandoned` 等状态返回空串** —— 「运行状态」卡左边点着琥珀、右边却**不说明原因** ✗（`abandoned`/`paused`/`queued` 都没有文案）。

**做法：把"状态 → 颜色"抽成共享派生函数，而不是在页面里各写一套**

`statusText.ts` 新增 `runHealthTone()`（紧邻 `runStateTone`），**与 `runStateTone` 同源**（同一份状态判定），把 8 个徽章档折叠为 R2 的 4 个健康档：

| 健康档 | 来源 | 依据（R2） |
|---|---|---|
| `ok` | `ok` / `running` | 进行中或已完成，**用户无需行动** |
| `bad` | `bad` | 失败，**需立即行动**（禁止降级为灰） |
| `warn` | `warn`/`queued`/`paused`/已放弃 | **需关注且运营可行动**（重试、重启、清理） |
| `muted` | 空值 / 未知 | 无数据或不适用（**不是 ok**） |

页面接线三处：页头 `:class="`mk-status--${headerHealth}`"`、`.cp-aside-card__dot.is-bad { background: var(--mk-red) }`（补上缺档）、「运行状态」点改用 `runHealthTone(autopilotHealthState)`（自动驾驶终态优先，无自动驾驶状态时回到会话生命周期；失败/未完成/收尾失败 → bad，与同一张卡里 `.cp-run__autopilot-result--bad` 的判定一致）。
顺带**复活了一处死代码**：`pathGenerationFailed`（原定义后从未被引用）现在驱动「预生成 Path」点的红档。`sessionStatusLabel` 补上兜底 `statusText(st)`（**沿用共享字典、不改既有措辞** —— `running` 仍是「运行中」）。

**核验**：`statusText.test.ts` 32 → **37 测试**（新增 5 组覆盖 4 档 + 与 `runStateTone` 同源）；真机（座舱 Learn 阶段）：
- 页头 `mk-status mk-status--warn` + 点色 `rgb(180,83,9)`（`--mk-amber`）+ hover 提示 **「需关注」**（原为「暂无数据」）✓
- **用 scoped 属性注入探针**实测新增的 `.is-bad` → `rgb(220,38,38)`（`--mk-red`）✓ —— 证明它是**活类名**，不是又一个死档
- 「运行状态」卡：点 `is-warn` 琥珀 + 文案 **「已放弃」**（原为空）✓
- 门禁 ✓（hex 仍 931）、`vue-tsc` 0、`eslint` 0 error、**全量 458 测试** ✓、无页面错误 ✓

**枚举本片可见增量（R2 属受控改动"统一状态语义色"）**：① 已放弃会话：点 灰→琥珀（页头 + 运行状态卡两处，语义点从"暂无数据"纠正为"需关注"）；② 运行状态卡文案 空→「已放弃」；③ 自动驾驶已完成时该点 灰→绿；④ Path 生成失败时该点 灰→红。③④ 本地无对应数据，**只由单测覆盖映射，未核到像素**。

### 阶段 1 续 ㉖ · 术语单源：会话状态「运行中」→「进行中」（同日第二十七批）

**触发**：上一批留下的待拍板项（`sessionStatusLabel` 页内「运行中」 vs 全局字典「进行中」）—— 你定"统一到一个"。

**统一到哪个**：共享单源 `statusText.ts`（术语审计 §4.3 明写"枚举必须经 `statusText.ts` 转换"）→ 权威词 **`进行中`**。仓库自己早就把这条记为缺陷（`ADMIN_PAGE_TEMPLATES:409`「顶栏 `进行中` 与右栏 `运行状态 运行中`」= 同义不同词），§5 也有同形先例（`degraded` 一处翻译、一处直出 → 统一「降级」）。

**结论先行：不能机械"禁字符串"** —— 「运行中」在仓库里有三种语义，见下。

**替换 48 处 / 10 文件**：`VirtualLearners` 20、`VirtualProfile` 9、`SessionCockpit` 4、`BatchExperiments` 2、`Overview` 2、`vlab-controls.ts` 2、`QuickLearnPanel` 1、测试 6。

**明确不动（会逼出错误文案的地方）**：

| 位置 | 语义 | 不动的原因 |
|---|---|---|
| `SkillDesignPage`「源文件与**运行中**的 Prompt 不一致」 | 运行时/线上 | 状态词换成「进行中」语义就错了 |
| `SkillReconciliation`「是否已在系统**运行中**注册」 | 同上 | 同上 |
| `skill-design/trial-tab.vue`「**运行中**…」 | 动词进行态（"运行"这个动作） | 不是状态名词 |
| `live.ts` / `vlab.ts` 注释 | 非 UI 文案 | 内部散文 |
| `views/v2/V2NotifCenter.vue` | 另一个界面 | 不在 admin-redesign |

**结构收敛（不只是替换词）**：删掉 3 处私有状态字典，改引共享单源 ——

1. `BatchExperiments` 私有 `statusText`（**还遮蔽了共享模块的同名导出**，是"文案单源"最坏的一种）→ 改 `import { statusText } from './statusText'`；给 `statusText.ts` 补 `stopped: '已停止'` / `done: '已完成'`（该枚举的既有实际取值，字典本来就是同义词表）。
2. `GoalConversations` 私有 `statusLabel`（与字典**逐条完全重合**）→ 共享单源，**零文案变化**。
3. `SessionCockpit` `sessionStatusLabel` → 共享单源；`VirtualProfile.formatRunResult` 的 running 分支 → `进行中`。

**守卫（防回潮，不靠人记）**：术语审计新增 **§4.6 状态词单源**，`terminology-guard.test.ts` 加第 8 条断言 —— 禁的是**译名位置**而非子串：

```
/running['"]?\s*:\s*['"]运行中/      /'running'\)\s*return\s*['"]运行中/
/运行中\s*\{\{/                      /运行中\s*\$\{/
```

用**探针文件**验证过它不是空转：注入 `{ running: '运行中' }` → 断言失败并报出「文件名 + 命中片段」；删除探针 → 恢复 8 通过 ✓

**核验**：jest 守卫 7 → **8 条** ✓（含探针验证）；`vue-tsc` **0** ✓；门禁 ✓（hex 931 未变）；前端 **458 测试** ✓；真机四页（VirtualLearners / VirtualProfile / Overview / BatchExperiments）**渲染文本与 title/hint 属性中「运行中」= 0 处**、「进行中」按位置出现 ✓、无页面错误 ✓

### 阶段 1 续 ㉗ · SessionCockpit 第 4 片（收尾）：旁栏卡片 → `.mk-card`（同日第二十八批）

`.cp-aside-card` 与 `.mk-card` 是**逐字重复**的同一张卡（border/radius 12/background/shadow-sm），唯一差别是 `overflow: hidden` vs 原语的 `clip` —— 而原语注释已写明 `clip` 是刻意的（不产生滚动容器，卡内 sticky 表头才能吸顶）。

**卡头本来就是重复**：本页**别处早已在用** `.mk-card__head` + `.mk-card__title`（147 / 189 行「Path 内容」「Goal 对话」），只有旁栏另起了一套 `.cp-aside-card__head`。收敛后页内卡头语言一致。

改动：模板 4 容器 + 4 卡头 + 4 标题；删 3 条私有规则（`.cp-aside-card` / `__head` / `__head h4`）。
**顺带修孤儿块名**：块类没了就不该留 `cp-aside-card__body` / `__dot` → 改名 `cp-aside-body` / `cp-aside-dot`（BEM 子类不该指向已不存在的块）。

**枚举增量**：① 卡头标题 12.5px/800 → 原语 `--mk-fs-14`(14.5px)/700（统一卡头节奏）；② 容器 `overflow` hidden → clip（旁栏卡内无 sticky，**无可见差异**）。

**真机核验**：`.cp-aside-card` 剩余 **0** 处；旁栏卡实测取到原语值（radius 12px、border `--mk-line`、surface 底、`overflow: clip`）；标题 14.5px/700；状态点仍为琥珀 `--mk-amber` ✓ 无页面错误 ✓；门禁 ✓（hex 931 未变）、`vue-tsc` 0、458 测试 ✓

**有意不收敛**：`cp-trace-panel` / `cp-trace-list` / `cp-timeline` / `cp-transcript` / `cp-wrapup-*` 等**功能视图**保持页面私有 —— 这不是漏收敛，是这批类的正确定位（`.cp-trace-panel` 的折叠头虽然形式上像 `.mk-section__summary`，但其内容是采样视图，合并只会把页面私有细节塞进原语）。

**至此 SessionCockpit 四片收官**（预算条 → `.mk-minibar`；页头 → `.mk-status` 语言；状态语义 → R2 四档；旁栏卡片 → `.mk-card`），`cp-*` 类族 61 → 60。

### 阶段 1 续 ㉘ · 收尾三件（同日第二十九批，由我裁定）

**① 结果态方言 → 字典单源（沿用 running 的同一条规则）**

| 原页内写法 | 定为 | 依据 |
|---|---|---|
| 已终止 | **已放弃** | 后端批量终止动作实际写 `status='abandoned'`（`simulation.coordinator.ts:3201`）—— 文案与落库状态对齐 |
| 已失败 / 未完成 | **失败** | 字典 `failed` |
| 创建中 | **已创建** | 字典 `created`（会话记录已存在，不是在创建中） |

字典补齐 3 个既有枚举，**词沿用页面现状、零漂移**：`incomplete` 未收束 / `aborted` 已中止 / `interrupted` 已中断。
删掉两个私有实现：`VirtualProfile.formatRunResult` → `statusText`（并保证未知值**不直出英文枚举**，返回「—」）、`QuickLearnPanel.statusLabel` → `statusText`。
单测 `statusText` 37 → **38** ✓；真机：画像运行列表状态列实测为「**已放弃**」✓

**② `.mk-section` 结论文案 → 就地派生，不新增后端字段**

裁定：结论一律**从页面已有 computed 派生**，不猜默认值、不加接口。已落地座舱「预生成 Path」卡头 —— 由描述（「Goal 收敛后生成学习路径方案」）改为结论：

```
已生成 N 个里程碑 · M 节课  /  目标已收敛，待生成  /  未生成（目标未收敛）
```

真机核到「未生成（目标未收敛）」✓。「Path 评审」「运行状态」「总结统计」三个卡头**本来就是结论**（`未评审 — …` / `已放弃` / `终局总结已生成`），无需改。

**③ 纯 `rgba()` 叠加 → 裁定不动（从待办移除）**

多数是 **tone-mix**（由 hue 变量派生，改 token 会丢掉"同色相不同透明度"的语义）；余下"半透明叠父级底"没有唯一正解，属设计决策而非一致性缺陷。故**不列为待办**。

### 阶段 1 续 ㉙ · 全站回顾（9-17，23 页真机走查）（同日第三十批）

**问的是"是否都达到了目标"，答案是：统一类达到了，规则还差两条。**

| 规则 | 结论 | 证据 |
|---|---|---|
| R1 页头职责 | ✅（本轮修一处） | 21/23 有 `.mk-status`；L2 走 `.mk-entity`（People→详情实测）；`MemoryReview` 违反「禁筛选控件进状态条」→ 已修 |
| R2 状态语义 | ✅ | 4 档 + 提示可信（座舱 / MemoryReview 实测） |
| R3 三态 | ✅ | 空/骨架/错误壳统一；两页实测 `MkEmptyState` |
| R4 详情落点 | ❌ 未做 | `.gc-panel` / `.ts-panel` / `.dfg-drawer` 仍在 |
| R5 技术语义降级 | ❌ 未做 | 10 个内部标识仍在 6 个页面（`{{ JSON.stringify }}` 已清零） |
| R6 幽灵类 | ✅ | 门禁死 CSS 规则 + 0 违规；`.mono` 经查是全局定义 |
| 原语层 / 门禁 | ✅ | 原语层硬编码 0、hex 931 在基线内、门禁 8 条、全站无 `--el-*` 引用 |

**手段**：Playwright 全站扫描（23 个 L1 页 + L2 详情/抽屉），逐页采集 `mk-status/entity/section/card/empty/drawer` 计数、`el-*` 泄漏、页面私有类族频次、JS 错误、截图。**全站 0 页面错误。**

**修掉的一处**：`MemoryReview` 页头是私有 `.mr__head` 且把「包含虚拟学习者」checkbox 放在页头 —— R1 明禁筛选控件进状态条。改为标准 `.mk-status`（点档由「到期积压」派生：>0 → warn，未加载 → muted；三个只读结论数字进 `__meta`；主操作只有一个「刷新」），筛选开关移出为独立筛选行。真机核到 `controlsInBar: 0`、`mk-status--warn`、琥珀点、提示「需关注」（与"当前到期 34"一致）。

**判定说明**：各页仍存在 200–400 个私有类引用（`tc428`/`log358`/`frt315`…）。依文档"功能子视图保持页面私有"，这不判为违规；但须明确：**统一覆盖的是共享模式（页头/状态/卡片/徽标/三态），页面内部仍自成一体**。

### 阶段 1 续 ㉚ · R4 详情落点：三处自搓抽屉 → `.mk-drawer`（同日第三十一批）

**共同做法**：原语是它们的超集 —— `.mk-drawer`（fixed/inset/flex-end）= 原来的 `*-mask` 容器，`.mk-drawer__mask` 提供遮罩底色，`.mk-drawer__panel` 提供宽/高/网格/阴影/**动画**（`mk-drawer-in`，与各页自写的 `gc-in`/`ts-in`/`dfg-slide` 重复），`__head/__title/__sub/__close/__body` 逐项对应。故页面只需保留原语没有的东西。

| 页面 | 删除 | 保留（页面私有） |
|---|---|---|
| GoalConversations | `.gc-mask` `.gc-panel` `@keyframes gc-in` `__head/__title/__id/__close/__body` + 4K·暗色档覆写 | `gc-detail__title`（标题栈）· `gc-detail__body`（网格） |
| TeachingSessions | 同上（ts-*） | `ts-detail__title` · `ts-detail__body` · `ts-tabs`（抽屉内 tab） |
| DataFlowGraph | `.dfg-drawer-mask` `@keyframes dfg-slide` `__head/__title/__sub` + 档位 | `.dfg-drawer`（**只留画布底色** `--mk-graph-canvas` —— 与画布同色是刻意的）· `__body` 网格 |

**脚本教训（值得记）**：第一版用「非贪婪匹配到下一个 `\n}\n`」删规则，把 `@keyframes` 之后的一整个 `@media` 开头**吞掉了**（花括号失衡暴露）。改法是**用列 0 的 `^}` 作为规则闭合锚点**并逐条断言命中；同时 `git diff | grep -v` 核对"删掉的都是重复属性"，避免误删。GoalConversations 用备份复原后重做。

**验证强度（诚实记账）**：

| 页面 | 强度 | 证据 |
|---|---|---|
| GoalConversations | **真机全验** | 抽屉渲染（560px 宽 · `mk-drawer-in` 动画 · 遮罩 `rgba(15,23,42,0.45)` · 私有类 0）+ ESC 关闭 ✓ + 内容区点遮罩关闭 ✓ + JS 派发遮罩点击关闭 ✓ |
| TeachingSessions | 结构级 | 与上一处同构 + 花括号/`vue-tsc`/门禁/测试通过；**本地该域无数据**（pill「全部 0」）→ 打不开，未核像素 |
| DataFlowGraph | 结构级 | 图需先选技能（本地 0 卡片）→ 未核像素 |

**顺带结论**：`shared.css` 的「推挤式抽屉」规则**已经**同时挂 `.mk-drawer__*` 与登记例外 `.msk`（§附 A #15 已修；上一轮我说"仍被私有类绑架"是看漏了）。

**新发现的既有问题**：遮罩左侧被侧栏盖住 —— 真机 `elementFromPoint(40,500)` 返回 `NAV.mshell__nav`，点左边缘不关抽屉（点内容区可关）。属 `--mk-z-drawer=200` 与侧栏的层叠关系问题，三处抽屉共用；修法待定（给侧栏定 z-index，或抬高抽屉档），未擅自改。

### 阶段 1 续 ㉛ · R5 技术语义降级（同日第三十二批）

**先把判定标准取出来**：R5 原文允许「工程标识降级为**括号 / title / mono 小字**，或收进「技术细节」折叠区」。所以审计清单里那 10 个标识**要分真假**，不能一律当违规 —— 否则会把合规的改成不合规。

| 位置 | 判定 | 依据 |
|---|---|---|
| `VirtualProfile` 故事表单 4 处 | ✅ 已合规 | 「对抗点（pressurePoints，每行一条）」= 中文在前、标识在括号（审计清单写于该允许形式之前） |
| `DataFlowGraph` 抽屉 2 处 | ✅ 已合规 | 位于 `.mk-drawer` 内的 `<dl>` —— 正是规则指定的「技术细节」落点 |
| `FieldRoutingTable` / `SkillFieldRouting` 图例标题 | ✅ 已合规 | 「字段角色（promptRole）」括号形式 |
| `OpsCenter` 两列 | ✅ 已合规（本轮增强） | 列头中文、值 mono + 截断；本轮补全量 `title`（简写后仍可取回原文） |
| `FieldAddWizard:58` | ❌ 真违规 | **标识在首位**「promptRole（角色）」→ 改「角色（promptRole）」 |
| `FieldRoutingTable:183`、`SkillFieldRouting:140` | ❌ 真违规 | 单元格**直出原始抽取路径** → 只显示末段，完整路径留 `title` |
| `SkillFieldRouting:157` | ❌ 真违规 | 单元格直出**落库键**（多数与 fieldId 相同 = 冗余）→ 显示「同字段名 / 别名」，真实键名留 `title` |
| `FieldRoutingTable:255` | ❌ 真违规 | 速查条以 `<b>promptRole</b>` 当标签 → 改「字段角色…（promptRole）」 |

共改 7 处（含 OpsCenter 2 处增强）。

**验证强度**：**结构级**。三个宿主本地取不到数据（编排页需阶段/Skill 配置、运营中心无死信行、故事编辑是弹层）→ 未核像素；`vue-tsc` 0 / 门禁 ✓（hex 929）/ 467 测试 ✓ / 走查 0 页面错误 ✓。

**R5 收口判断**：规则要求「主视觉位不放内部标识」—— 现在**可见位要么是人话、要么是括号/title/mono 这类被明确允许的降级形式**；剩余标识都在脚本、`title` 或 `.mk-drawer` 的技术细节区内，符合规则。

### 阶段 1 续 ㉜ · 收尾四件（同日第三十三批）

1. **侧栏盖住遮罩 → 判定为刻意，不改**（㉚ 的"修法待定"到此有结论）：`--mk-z-sidebar: 220` > `--mk-z-drawer: 200` 是 token 里的**显式排序** —— 侧栏是常驻 chrome，推挤式抽屉模式下它本就要保持可交互。所以"点抽屉左边缘不关"不是缺陷而是设计；从待办移除。
2. **`el-*` 残留 → 找到并修**：不是 EP popper，而是 **ExecLogs 里残留的幽灵类** `class="mk-pills el-tabs"`（EP 迁移留下的类名，正是 R6 要禁的）。已删；真机核到该页 `el-*` 元素 **0**。
   **更正**：之前说"token-cost / trace-waterfall 各 1 个"，实为**路由兜底**（那两个 slug 不存在 → 落到默认页 = ExecLogs）→ 本就是同一处。
3. **`.mk-section` 结论推广**：给 `LearnerDetail`「预测校准」卡头加了结论常驻 —— 就地派生「卡壳 X% · 基调 Y% · n=Z」，原说明「非自报置信度」降级到 `title`，无样本时仍显示说明（座舱「预生成 Path」上一批已做）。
4. **像素级验证缺口（如实在案，不消失）**：TeachingSessions / DataFlowGraph 两处抽屉、R5 的几处宿主页 —— 本地取不到数据（编排页需阶段/Skill 配置、运营中心无死信行、故事编辑是弹层）→ 只有结构级验证。

### 阶段 1 续 ㉝ · 抽屉重新设计（同日第三十四批）

**用户报的 bug**：抽屉一开页面就出现横向滚动。**先证明再修** —— 真机在 `/admin/skills` 对比开抽屉前后：

```
抽屉关闭: mainW 1200 · mainPR 0px · 表格容器无横向溢出 · docX 0
抽屉打开: mainW 1200 · mainPR 560px · html.wf-drawer-open · 表格容器横向溢出 156px   ← bug
```

根因是**我自己在收口阶段加的「宽屏推挤式抽屉」**（`html.wf-drawer-open .mshell__main { padding-right: … }`）：它把主区压窄 560px，于是接近满宽的表格容器凭空多出滚动条。它本意是"避免浮层遮住右侧列"，但代价正是"一开抽屉页面就横向滚动" —— 用户读到的是 bug。

**重新设计（三件）**

1. **抽屉一律为浮层：删除推挤模式**。`shared.css` 删掉 4 个 `wf-drawer-open` 媒体块；`SkillDrawer` 删掉挂标记的 `watch`（并清掉随之无用的 `onBeforeUnmount` 导入 —— typecheck 抓到的）。
2. **加固抽屉容器**（宽内容只在抽屉内滚、永不外溢）：`.mk-drawer__panel { min-width: 0; overflow: hidden }`、`.mk-drawer__body { overflow: auto; min-width: 0; overscroll-behavior: contain; scrollbar-gutter: stable }`、`.mk-drawer__body pre/table { max-width: 100% }`（代码块自己滚）、`@media (max-width: 720px) { .mk-drawer__panel { width: 100vw } }`（窄屏全宽面板）、`.mk-drawer { overscroll-behavior: contain }`。
3. **修正层级顺序**：`--mk-z-drawer: 200 → 240`（原 `--mk-z-sidebar: 220` 压在抽屉之上）。推挤模式在时"侧栏压住遮罩"是自洽的（推挤后侧栏要可用）；推挤去掉后它只剩"侧栏亮着、点它不关"的怪相 → 修正后遮罩盖住全屏（含侧栏），点任意遮罩处都关闭；模态(300)/toast(400) 仍在其上。

**验证（真机）**

- 开抽屉 after：`mainPR: 0px` ✓ · 无 `wf-drawer-open` ✓ · **表格容器 156px 横向溢出消失** ✓ · `docX 0` ✓
- 容器实测：面板 `overflow:hidden` / `min-width:0`；正文 `overflow:auto` / `scrollbar-gutter:stable` / `overscroll-behavior:contain` ✓
- 行为：ESC 关 ✓ · 点遮罩（含原侧栏区域，`elementFromPoint(120,500)` 现为 mask）关 ✓ · 关闭按钮 ✓
- 截图：主区保住全宽（表格露出更多列）✓ · 遮罩正常压暗（不再透明）✓
- `vue-tsc` 0 · eslint 0 error · 门禁 ✓（hex 928）· vitest 72 文件 / 493 测试 ✓

**两条附带结论**：① 上一批把"侧栏盖住遮罩"判定为"刻意"是**不完整的** —— 它只在推挤模式成立，现已一并修正；② `.msk`（SkillDrawer，登记例外）仍是自己的面板样式，本次加固只覆盖 `.mk-drawer__panel`，要完全统一需把 `.msk` 收敛到原语（列后续）。

### 阶段 1 续 ㉞ · 子代理并行收尾（同日第三十五批）

派出 4 个子代理，按"各占文件、互不重叠、独立验证、不提交不改文档"分工；回来由我复核（并修掉两处越界不了的遗留 + 两处我自己的手滑）。

**① `.msk` → `.mk-drawer`（SkillDrawer，R4 最后一处）**：容器/遮罩/面板/头/标题/子标题/关闭/正文全部走原语，保留身份 hero 与 tabs 等页面私有部分。`SkillDrawer.vue` 1115 → 1051 行（+22/−86），`.msk` 残留 **0**。真机：三项关闭路径 + 长 id（260 字符）不撑宽 + tabs 可切换。**至此所有抽屉都收敛到 `.mk-drawer`**。

**② `tremor-theme.css`：判定"半死"，剪除而非删除**：`--tremor-*`（28 个）与 `.tremor-*`（10 个）**外部消费方 0** ✓；EP 覆写里除 `el-button / el-tag / el-input / el-textarea / el-message / el-loading` 之外**全无模板消费方**（现存 EP 使用者只有 `App.vue` 的 config-provider、`components/CompletionCard.vue`、`components/learning/SessionFeedbackPanel.vue`）。975 → **252 行**（−731/+8）。验证用**同页换样式 A/B + 像素差**（≤0.03%，且被无换样式对照组复现为动画噪声）→ 无视觉变化。**保留的那几组是真实负载**，彻底删除需要先让那两个组件脱离 EP（列后续）。

**③ 孤儿文件盘点：我上一轮转述的调查结论是错的** —— 那 9 个"未注册"的 admin 页面**并非孤儿**：`Users`/`LearnerCenter`(People)、`TeachingSessions`/`OpsContent`(GoalConversations)、`TokenCost`/`TraceWaterfall`(ExecLogs)、`BatchExperiments`(VirtualLearners)、`Announcements`/`Notifications`(Messages) 都是**被内嵌 tab 引用**的。真正死的只有 `views/v2/V2Runtime.vue`（490 行，零引用）→ 已删（并清 `.eslintrc.cjs` 忽略项）。19/19 管理端路由冒烟通过（0 页面错误）。

**④ 像素级验证缺口：三项补齐，一项仍缺**（此前"结构级"是因为看错了时序/数据）
- `TeachingSessions` 抽屉 **REACHED**：之前"0 条"是**数据未加载完**；现 39 行，抽屉 `.mk-drawer__panel/__mask/__close` 齐全，标题正常。
- `DataFlowGraph` 抽屉 **REACHED**：之前"0 卡片"是**要等 ~10s 稳定**；现按阶段 1~12 张卡片，字段详情抽屉用的是 `.mk-drawer`。
- R5 单元格 **REACHED**：FRT 56 个「抽取 → 末段」+ `title` 全路径；SFR 33 行「同字段名」32 + 「别名」1（`title` 给真实键名）✓
- `OpsCenter` 死信行 **仍缺**：本地 `deadCount: 0`，`eventType`/`aggregateId` 的 `title` 无法像素验证（需造数据）。

**⑤ 抽屉加固复核**：开抽屉时页面横向溢出 0 ✓、面板 `overflow:hidden`/`min-width:0` ✓、`wf-drawer-open` 已不存在于源码与 DOM ✓、三项关闭路径 ✓。

**我补的两处遗留**：`shared.css` 里"SkillDrawer 属登记例外"的注释已过期 → 改为"已全部迁入"，并核实 `AdminGlossaryDrawer` **早已**用 `.mk-drawer`（我一度写反）；`v2.css` 里 `V2Runtime` 遗留的死规则 `html[data-theme='dark'] .runtime` → 删除（**教训**：我第一版把它改名、第二版又换成另一个真实类名 ✗ —— 两次都是靠 `git diff` 复核才发现的，已完全回退为纯删除）。

**终检**：`vue-tsc` 0 · eslint 0 error（1 既有 warning）· 门禁 ✓ **hex 928 → 922** · vitest **74 文件 / 506 测试** ✓ · 术语守卫 8 ✓

### 阶段 1 续 ㉟ · 设计系统边界修复（子代理并行，同日第三十六批）

**背景**：全项目摸底发现结构性问题 —— `--mk-*` token 与 `.mk-*` 原语都住在 `views/admin-redesign/` 下、门禁只扫该目录 → **v2 学习者端 / 用户中心 / 营销站都在体系之外**。

**第一步（已完成并提交 `ba168ecb`）：原语提到中立层**
- `shared.css` → `src/styles/mk-primitives.css`，**仍是 admin 入口懒加载**（不进 `main.ts` —— 不把 1650 行 admin CSS 发给学习者端）
- 8 个 `Mk*.vue` → `src/components/mk/`；**45 文件 / 107 处**导入改写；admin-shell 组件（Shell/TabBar/Confirm/Pagination/SkeletonTable/…）保持原位
- 门禁同步：`isGoverned = admin ∪ components/mk`；`PRIMITIVE_FILES` / `HEX_CSS_TARGETS` 指向新路径；基线**仅改名** `MkCols`/`MkKpi` 两个键 —— **规则语义与棘轮数字未加、未减、未放宽，全程未用 `--update`**
- 我复核时另清了 guard 中因改判断谓词而失去引用的 `ADMIN` 常量
- 验证：`vue-tsc` 0 · eslint 0 error · 门禁 ✓（275 原语 · hex 922）· vitest **74 文件 / 506 测试** ✓；真机 `/admin/overview`、`/admin/people`、`/admin/virtual-learners`（含抽屉）、`/admin/skills`→SkillDesignPage 全部 0 页面错误，`.mk-status` 描边/底色与 `.mk-card` radius 12px 仍生效 ✓

**第二步（进行中·后台代理）：EP 消费者迁移 → 删 `tremor-theme.css` 余量**
把 `App.vue`(el-config-provider)、`components/CompletionCard.vue`(el-icon/button/tag)、`components/learning/SessionFeedbackPanel.vue`(el-input/button) 迁到**学习者侧**原语（`v2.css` / `learning-components.css` / `uc.css`，明确**不引入 admin 的 `mk-*`**），之后删除 tremor 余量；验证要求亮暗双截图前后对比。结论待其回报。

**第三步（已出可执行清单·只读代理）：逐面收敛路线**
- **零色差候选**（把"与该面自身 token 等值"的字面量换成 token）：v2 视图 **228** 处、`v2.css` 49、`uc.css` 16、`HomeNext` 38、`VisionNext` 19、`MarketingNav` 9 …
- **跨面重复的原语家族**：卡片 / 按钮 / 空态 / 加载 / 徽标 / 表格 / 抽屉 **各有 2–3 个方言**（admin `.mk-*`、用户中心 `.uc-*`、v2 无前缀类 + `learning-components.css` + `modern-enhancements.css`）
- **需要你拍板的 token 值冲突**（机械替换解决不了，这才是真正的拦路石）：

| 名 | 冲突值（定义处） | 归一后谁变 |
|---|---|---|
| ink | `--mk-ink #1a2a44`(main.css:50) vs v2/营销 `--ink #172033`(v2.css:5) vs `--text-primary #2C3E50`(design-system:53) | admin 或 v2/营销 |
| faint | `--mk-faint #5f6f8c`(52) vs v2 `#67758f`(7) vs 营销 `#8492ab`(HomeNext:303) | 三个都不同，归一要改 2 面 |
| line | `--mk-line #e6ebf4`(54) vs v2 `#e3e9f4`(8) vs 营销 `rgba(23,32,51,.08)`(304) vs `--border-default #E9ECEF` | **4 套描边体系**，处处可见 |
| canvas | `--mk-bg #f7f8fa`(55) vs v2 `#f3f6fb`(9) vs `--bg-body #F8F9FA` | 页面底色；暗色还差 `#0f1624`↔`#0f1620` |
| surface | 亮色都是 `#fff`，**暗色不同**：`#17202f` vs `#182230` | 暗色模式 |
| green / red / amber | `#15803d`/`#1e9e58`/`#31b16f`；`#dc2626`/`#ef7578`；`#b45309`/`#f4aa46` | admin vs 学习者，语义色三套 |
| 半径 | mk `8/10/12/16` vs design-system `8/12/16` vs v2/uc 硬编码 `12/16/20` | 全站控件 |
| 阴影 | mk（sm/pop/drawer/modal） vs v2/uc 卡片 vs design-system（xs…2xl） vs 营销 | 4 套 elevation |

- **门禁扩面的风险（逐条判定）**：规则 **1/2 可直接扩**（低风险）；规则 **3/7 需按面加棘轮基线**；规则 **4/5/6 不能扩** ✗（会误伤 —— v2/uc 合法地使用 `.chart__empty`/`.spinner`/自身 shimmer，且不 import `MkEmptyState`）；规则 8 只认 `--mk-*`，扩面需按面泛化命名空间。
- **攻击顺序**：8 个小批次（用户中心 → 营销 → v2 → 共享学习者样式），每批 = 一个面 × 一个家族；验证 = 字面量==token 值 + `getComputedStyle` 快照 + 亮/暗双截图。**其中 6 批需要学习者登录**才能浏览器验证（路由 `requiresAuth` 已记录）。

### 阶段 1 续 ㊱ · 边界修复第二步完成：EP 样式面清零（同日第三十七批）

**结果**：全仓 markup **已无 `<el-` 标签**，`.el-*` / `--el-*` CSS 命中 **0**。

| 文件 | 处理 |
|---|---|
| `components/CompletionCard.vue` | 10×`el-icon` → `.completion-icon`（+`aria-hidden`）；2×`el-tag` → `.status-tag` 原语（新增 `tagClass()` 映射，复用同一批 `--color-*` token）；6×`el-button` → 原生 `<button class="completion-btn">`；`:loading` → `.spinner--sm` |
| `components/learning/SessionFeedbackPanel.vue` | `el-input[textarea]` → 原生 `<textarea>` + 字数 span（`aria-describedby`）；`el-button[primary]` → 原生 `.feedback-btn` + `.spinner--sm` |
| `App.vue` | 去掉 `<el-config-provider>` 与 `zhCn` |
| `main.ts` | 去掉 `ElLoading` 注册与 3 个 EP 样式导入、`tremor-theme.css` 导入 |
| `styles/tremor-theme.css` | **整体删除**（252 行全是 EP 覆写，无其它引用） |
| `styles/design-system.css` | 清掉不可达的 `.el-button*`（685–768）与 `.admin-list-card .el-table*`（934–956）死样式 + 孤儿注释（我复核时补做） |
| `main.ts` 的 `ADMIN_OVERLAY_SELECTOR` | **保留原样**（防御性、不可达；EP 依赖去留属你的决定。我一度改成自造选择器 ✗ —— 已回退，只在上面加了说明注释） |

**验证**：`vue-tsc` 0 · eslint 0 error · 门禁 ✓（275 / hex 922）· vitest **74 文件 / 506 测试** ✓
**浏览器**：学习者评测页 **0 个 `el-*` 元素**、无错误；迁移前后 **bbox 完全一致**，像素差 light **0.07%** / dark **0.18%**，差异全部是刻意的 token 归一（暗色按钮底色、CTA 辉光、字数胶囊、placeholder 用 `--text-muted`）；管理端 overview / people / virtual-learners / skills **0 个 `el-*` 元素**、0 错误、`.mk-card` radius 12px 与 `.mk-status` 描边仍生效。

**需要你知道的一处数据变更**：为取得学习者侧的可视化基线，代理**重置了 QA 账号 `yanzheng0918` 的密码**（新密码 `QaEpMig_2026`，仅该账号、仅本地库、未改其它字段）。这是本轮唯一一处对本地数据的写入。

### 阶段 1 续 ㊲ · 复查报告收尾 + 后端三问调查（同日第三十八批）

**A. 收尾两处（前端，均已提交）**
- **#11** 审计日志「操作」列补 16px 右留白（页面私有 `.al-act`，不动 `mk-` 原语）。★**像素级未核到**：探测时该页未渲染出表格；且早先探针显示末列是展开箭头 —— 若操作列非物理末列，这 16px 会落在箭头之前。待有数据时复核。
- **#18** 会话状态徽章加 `title` 原因提示（「已中止：通常因长时间无心跳被自动回收；可从故事行重新启动」）。★本地无 `abandoned` 行 → 渲染路径未验，仅代码路径。
- **顺带**：探针发现 `proposing` 阶段枚举被**原样直出**（`STAGE_TEXT` 只有 `proposal`）→ 补同义项「方案收敛中」（属 §4.3「枚举直出」同类问题，只是不在守卫的固定枚举清单里）。

**B. 后端三问（只读代理调查 → 我复核后落一条修复）**

| 问题 | 结论 |
|---|---|
| **间歇 500** | **根因是已修的历史 bug**：`021b0c98`(09-13 22:03) 在默认分支写 `{ sourceEntry: null }`，而该列是 `String @default` 不可空 → `PrismaClientValidationError` → 500；`ce4e3d4b`(22:35) 已改为 `AND.push({ not: 'system-canary' })`。`backend/logs/error.log` **21 次失败全落在 22:05–22:27**，与提交窗口吻合；现锤 120 次 100% 200。**另有一条仍活着的 500**：`platform.ts` 的 `skip=(Number(page)-1)*Number(limit)` 完全不校验（`page=abc`/`limit=abc`/`page=-1` → NaN/-1 交给 Prisma）→ 已按 `learning-content` 既有范式夹紧（page≥1、1≤limit≤200），真机六个坏参数**全部 200** ✓ |
| **#19 auto-learning 每次 1 步** | **是设计**（按课界停止）：`taskCompleted` 即返回（注释「状态机已自动开下一课，但不代跑」），`LEARN_AUTO_TURN_CAP=40`，前端发 `maxMilestones:1` → 建议在管理端文档标注即可 |
| **#22 `learningPathId` 未回写** | **不是完全不写**：`goal_conversations` 即时写 ✓，`virtual_sessions` 在**下一步**写 ✓；但**管理端 regenerate 路由确实不写任何指针** ✗。活库实测 0 处「有路径却未关联」，学习路径 tab = **18**（非 0；98 条属虚拟学习者、被真实用户口径挡掉）→ 「恒为 0」更可能是**口径/时序**问题，而非数据缺失 |

**C. 交回所有者（我没动）**：① `regenerate-path` 路由补写 `goal_conversations.learningPathId`（位于 `routes/admin/goal-conversations.ts` + 协调器域 —— 正是你在动的 vlab/协调器区域）；② 给 `platform.ts` 的分页夹紧补一条 jest 回归（现有 `agents-logs.*` 测试是 mock 形态，照抄即可）。

### 阶段 1 续 ㊳ · token 归一：①→④ 全批（同日第三十九–四十一批）

**口径（所有者定）：token 冲突一律以 `--mk-*` 为准。** 关键事实使这件事比预估便宜一个量级：`--mk-*` 在 `main.css` 里**全局加载** → 其余各面可直接**别名转接**，一处改、全端跟随，且亮/暗自动一致（`--mk-*` 自带暗色档）。

| 批次 | 内容 | 量 | 提交 |
|---|---|---|---|
| ①-1 | `v2.css` 中性色（亮+暗）→ `var(--mk-*)` | 12 | `93662e8c` |
| ①-2 | 营销三处 scoped token 别名化 | 28 | `32444c5e` |
| ①-3 | `design-system.css` 语义别名（text-primary/border-default/bg-body/text-muted） | 8 | `32444c5e` |
| ①-4 | 刻度类：radius 按同名档换算（lg 12→10、xl 16→12、2xl 24→16）、shadow 折叠到 mk 三档 | 19 | `9ebc7e06` |
| ②-1 | `uc.css` 试点 14 处 + 按「层叠胜出」定位的 8 文件 9 处卡片阴影 | 23 | `5309af6b`／`96f6400b` |
| ②-2 | 学习者端/用户中心/营销：值匹配替换（41 hex + 294 处 rgba→`color-mix`） | 335 | `30b162cb` |
| ②-3 | 补收「旧 token 值的硬编码副本」（漂移态） | 29 | `30b162cb` |
| ②-4 | 圆角字面量 → `--mk-radius-*`（值逐位相等，零形变） | 242 | `52c04119` |
| ④ | 语义色（blue/green/amber/red/accent）→ mk；**因②-3 引入不一致而提前做** | 5 | `4162cfef` |
| ③ | 旧 token 字面量残留 2 处（+「纯别名去重」45 行 **已回退**，见下） | 2 | `d05af861`／`bb06ec04` |

**事故与教训（③ 去重被回退）**：③ 曾判定「页面 token 块里 `--x: var(--mk-y)` 在全局 `:root` 已有等价定义 → 可去重」，删掉 45 行。**这是错的**：全局只有 `--mk-ink`/`--mk-blue`，而页面代码引用的是 `--ink`/`--blue` —— 这些页面级声明**不是冗余，而是把 mk 词汇桥接到页面词汇的唯一位置**。删掉后 `var(--ink)` 失去定义，**颜色静默丢失**（不报错、不白屏，只是继承默认色）。已用 `git checkout d05af861^ -- <4 个页面文件>` 精确回退（`admin-surface.css` 里修对的字面量保留）→ `bb06ec04`。
**发现方式**：整体回顾时加的 **token 断言**（读完页面后断言 `{--ink,--line,--canvas,--blue,--red}` 非空）—— 若无这条断言，肉眼扫截图很可能漏过。
**新规则**：**去重别名前必须先确认「谁引用了那个名字」** —— 名字不同即存在桥接关系，不是冗余。

**合计约 750 处**；中性色 / 圆角 / 阴影 / 语义色现在全部指向 `--mk-*`；用户中心随 v2 token 一并统一。

**这一路抓出的四类坑（以后复用）**
1. **统计里的"字面量"大半不是债务** —— `var(--x, #fallback)` 的兜底值被算进去了（`uc.css` 16 处里 11 处如此）。
2. **真正生效的那份常藏在组件 scoped 样式里**：`.uc-card` 改成 `var(--shadow-sm)` 后浏览器纹丝不动，因为 `.uc__body[data-v-…] .glass-card`（两层选择器更具体）在层叠里胜出 —— **改动必须真机复核，不能只看 diff**。
3. **还有第三类债务："旧值副本"** —— token 换了值，页面里仍写死旧值（如 `--canvas`=#f7f8fa 而页面写 `#f3f6fb`），形成"一半新一半旧"的漂移态。
4. **填充色上的白字不能换 token**（`color:#fff` on fill）—— 换成 `var(--surface)` 会在暗色下失效。

**工程教训**：正则转义在本会话翻车三次（`@keyframes` 吞掉整个 `@media`、斜杠/括号转义），最终统一改成 **归一 LF → 纯字符串替换 → 写回 CRLF** 才稳。

**恒等替换的证明方式**：`rgba(52,120,246,α)` → `color-mix(in srgb, var(--blue) α%, transparent)` 逐位恒等（`--blue` 的 rgb 即 52,120,246 ✓），且 `--blue` 亮暗同值 → 两种主题都零变化。

**遗留（诚实记账）**
- **`document.body` 计算背景仍是 `#f3f6fb`**，而 `--bg-body` 在 `:root` 上已解析为 `#f7f8fa` → 该值应来自 **body 局部的自定义属性改写**。已排除：`App.vue` 全局 style、`main.css`、`v2.css`、各面 scoped 样式、以及 `styleSheets` 中所有匹配 `body`/`html` 且声明 `background(s)` 的规则。差 4/255，肉眼不可辨，不再追。
- **`--blue-deep` / `--cyan` 与全部 `-ink` 变体**仍是字面量（mk 无对应档；`-ink` 是"浅底上的文本色"，与填充色角色不同）。
- **EP 依赖已移除**（`b7ef7e3c`／`8712c6f9`：markup 与样式面清零 → 卸载包 + 清解析器/分包 + 9 个图标改内联 SVG）。

### 仍未动的（后续）

**复查报告（4 轮 19 项）现状：已全部处理完毕**

| 状态 | 项 |
|---|---|
| ✅ 已修（含真机验证） | #7/#14 批量实验子标签 · #8 导出数据子标签 · #10 标签栏箭头常驻 · #1 健康中心骨架 · #12/#16 会话详情深链（并因此确认 URL 直达化，成了删标签栏的依据）· #21 缓存按 userId 隔离 + 登出清理 · #20 重试死路（根因在后端的结构化输出失败信封） |
| ✅ 判定不成立（附证据） | #6 分页栏压表格（滚到底实测重叠 0）· #9 event-center/traces（显式带注释的兼容重定向，侧栏无该入口）· #3/#4/#15 375px（`docX=0`、侧栏标签 `display:none`）· #2 侧栏高亮（实测在可视区内且高亮）——仅「健康中心挂在 Skill 管理组下」这条信息架构疑问成立 |
| ✅ 已裁定不改 | #5「立即探测」红色脉冲（是「快照过期且自动探针关闭」的唯一信号，R2 有据）· #11 操作列留白（已改，像素待复核） |
| ✅ 由观察转结论 | #18 已中止原因提示（已加 title）· #19 auto-learning 每步 = 设计· #22 learningPathId = 写回时机 + regenerate 路由未写 |

**交给所有者的两件（都在你在动的 vlab/协调器域）**
1. `regenerate-path` 路由补写 `goal_conversations.learningPathId`（`routes/admin/goal-conversations.ts`）。
2. 给 `platform.ts` 的分页夹紧补一条 jest 回归（现有 `agents-logs.*` 测试是 mock 形态，照抄）。

**结构性待办（需你拍板，非本轮范围）**
3. **8 组 token 值冲突该以谁为准**（ink / faint / line / canvas / surface 暗色 / green-red-amber / 半径 / 阴影）—— 归一必然让某些面改色。
4. **`element-plus` 依赖与 auto-import 插件是否彻底移除**（markup 与样式面均已清零，只剩 `package.json` 与 `vite.config.ts` 的声明）。
5. **零色差 token 化**（v2 视图 228 处 / `v2.css` 49 / `uc.css` 16 / `HomeNext` 38 / `VisionNext` 19 / `MarketingNav` 9）与**门禁扩面**（规则 1/2 可直接扩；规则 4/5/6 明确不扩）。

**零散**
6. `OpsCenter` 死信行 `title` 仍未验（本地 `deadCount: 0`，需造数据）。
7. `.mk-section` 结论文案按「就地派生、不加后端字段」增量做。
8. 你在并行改的 `scripts/run-vl-one.js`、`backend/vlab-runs/`、`backend/src/services/topology/**` 我一行没碰。
