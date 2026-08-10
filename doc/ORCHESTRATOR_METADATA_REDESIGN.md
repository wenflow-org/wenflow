# 编排结构页 · 元数据优化设计

> 目标页面：`/admin/orchestrator`（`frontend/src/views/admin-redesign/Orchestrator.vue` + `FieldRoutingTable.vue` + `DriftAuditPanel.vue`）
> 视角：把"已实施但页面没用上的元数据"变成一级信息，让页面从"结构浏览"升级为"元数据健康总览"。
> 日期：2026-08-10

---

## 1. 现状数据流审计

### 1.1 页面消费的端点与各区块数据来源

| 区块 | 数据来源（端点） | demo/live 分支 |
| --- | --- | --- |
| 顶部状态条统计 | 全部前端派生：`stages.length`、`totalSkills`（sum of stage.skills）、接力 = `max(stages.length-1, 0)`（**公式硬编码**）、定义源计数（runtime-definitions） | demo 用 `demoStages` 骨架；live 全 API |
| 「编排存在未解析节点」 | 前端派生：`defSteps[].resolved.unresolved`（来自 runtime-definitions orchestrators） | live only |
| 运行时定义卡 | `GET /admin/runtime-definitions/orchestrators` + `/agents`（仅 6+6 条摘要展示） | live only（demo 隐藏） |
| 阶段流水线 | `GET /admin/field-routings/stages`（displayName）；成员/调用数来自拓扑 `GET /admin/agents/topology`（`liveTopoNodes`，live.ts 预拉） | demo 用骨架；live 拓扑失败 → 空态 |
| 定义 tab · 变量流 | `GET /admin/prompt-ops/skill-catalog`（inputFields/outputFields，截断 5 个） | live only |
| 定义 tab · 定义步骤 | `GET /admin/runtime-definitions/orchestrators`（steps/role/condition/loopOver/resolved） | live only |
| 定义 tab · Skill 卡 | 拓扑成员 + skill-catalog 输出字段 + `node.stats.totalCalls`；点击卡 → SkillDrawer（`GET /admin/skills/:id/workbench-meta`） | 卡内容 demo 有骨架 |
| 字段路由 tab | `GET /admin/field-routings/stages/:stage`（fields/agents/routings）；编辑弹窗 `GET/PUT /orchestration/:stage` + `POST /orchestration/:stage/sync` | 无 demo 分支（直接打 API） |
| 沙盘 tab | `GET /admin/prompt-ops/sandbox-view` | 同上 |
| 漂移与审计 tab | `GET /admin/field-routings/drift` + `/changes` | 同上 |

### 1.2 信息架构问题

1. **顶部条统计口径陈旧**：`接力 N 处` 是 `stages.length - 1` 的公式推导，不是元数据；`定义源 5 编排 / 17 Skill` 只表达"有多少定义"，不表达"定义健康度"。**没有任何完成度/对账/漂移信息**——这是本系统最值钱的元数据。
2. **告警只给结论不给清单**："编排存在未解析节点"不可点开，运维无法知道是哪些节点、在哪个阶段。
3. **阶段按钮信息密度不足**：只有 Skills 数与调用数；同阶段技能处于 draft 还是 live 无从得知，无法在流水线上发现"某阶段整体没上线"。
4. **Skill 卡缺完成度与血缘**：只有名称/输出变量/调用数；draft 状态、fields-sync 卡点、db 表血缘全在抽屉里（且抽屉只按需拉单个 skill）。
5. **字段路由表信息冗余/缺失并存**：行级已展示 render/handoff/internal/accumulate/锁，但 `pathInRawOutput`（字段落点）完全没展示；表头无元数据摘要条（字段数/路由数/缺项/孤儿），页面级"健康度"要等漂移 tab 才知道。
6. **层级混淆**：编排文件的 `parsed` 摘要（契约/字段/路由数）只在编辑弹窗里出现一次；stage description 从 `/stages` 拉到了但从未渲染。
7. **每阶段数据流转无总览**：fields→routings→handoff 的链路散落在多个 tab，页面无法一眼看出"这阶段的字段往哪流"。

---

## 2. 已实施但页面未消费的元数据清单（优化空间）

| # | 元数据 | 端点 / 来源 | 现状 | 消费方（他处） |
| --- | --- | --- | --- | --- |
| 1 | **完成度五档状态机**（draft→handler-ready→core-ready→fields-synced→live，含每档 gate 依据） | `GET /admin/skills/reconciliation`（items[].completion + summary.byStatus + 差集 unregistered/activeMissing/orphanRegistrations；**items 自带 stage/kind**，可无后端改动按阶段聚合） | ❌ 未用 | Skills.vue 对账面板 |
| 2 | **readiness W1-W5**（W4.drifted = core 漂移 skillId 清单，coreHash 对账） | `GET /admin/skills/readiness` | ❌ 未用 | —（Skills 页也未展示 W4 明细） |
| 3 | 编排文件 stage 元数据 `description` | `GET /admin/field-routings/stages`（已拉取） | ⚠️ displayName 用了，description 丢弃 | — |
| 4 | 编排文件 parsed 摘要（contractCount/fieldCount/routingCount） | `GET /admin/field-routings/orchestration/:stage` | ⚠️ 仅在编辑弹窗展示一次 | — |
| 5 | 字段 `pathInRawOutput` / `visibilityPreset` / notes | `GET /admin/field-routings/stages/:stage`（fields） | ❌ 表未展示 pathInRawOutput | — |
| 6 | 字段 `promptRole` 分组维度 | 同上 | ⚠️ 逐行有角色列，无分组/折叠 | — |
| 7 | fields-sync 状态（含缺项数） | `completion.gates.fieldsSynced.detail`（"fields-sync 存在 N 个缺项"） | ❌ 未用 | — |
| 8 | 户口簿 kind（mainline/aux/handler-only）与 stage | reconciliation items | ❌ 未用 | Skills.vue |
| 9 | 调用统计（拓扑 stats.totalCalls） | `GET /admin/agents/topology` | ✅ 已用（阶段/卡调用数） | — |
| 10 | skill-catalog 变量流 | `GET /admin/prompt-ops/skill-catalog` | ✅ 已用（但截断 5 个） | — |
| 11 | runtime-definitions steps | `GET /admin/runtime-definitions/orchestrators` | ✅ 已用（defSteps） | — |
| 12 | workbench-meta completion（单 skill 粒度） | `GET /admin/skills/:id/workbench-meta` | ⚠️ 抽屉用；页面卡不显示 | SkillDrawer |

**端点缺口（需后端配合，本轮不动后端）：**

| 缺口 | 说明 | 建议 |
| --- | --- | --- |
| dataSource.db 血缘无 admin 端点 | skills.yaml `dataSource.db/sandbox` 只有脚本（check-data-source.ts）消费，reconciliation/workbench-meta 均不返回 | 在 reconciliation items 或 workbench-meta 附加 `dataSource: { db: string[]; sandbox: string[] }`（skills-file 已解析，纯透传） |
| core.yaml fields 顶层契约数无端点 | 无 `/admin/skills/:id/core-fields`；core fields N vs 编排 fields N 对比只能拿到编排侧 | 方案 A：workbench-meta 附加 `coreFieldCount`；方案 B：前端降级为只展示 `completion.gates.fieldsSynced` 的 ok/detail（缺项数已内嵌），P1 前先走 B |
| 对账端点无"每阶段缺项/孤儿"汇总 | fields-sync 检查是 CLI 脚本（check-core-fields-sync.ts），无 HTTP 面 | 与上一条合并：在 reconciliation 中附 `fieldsSync: { missingCount, orphanCount, typeMismatchCount }` 按 stage 聚合 |

---

## 3. 优化设计（从元数据角度）

### 3.1 顶部条（P0）

**现状 → 目标：**

```
阶段 5 · Skills 16 · 接力 4 · 定义源 5 编排 / 17 Skill
↓
阶段 5 · Skills 16 · 完成度 live 16/27 · 未注册 2 · 缺 ACTIVE 1 · 幽灵 1 · W4 漂移 2 · 接力 4
```

- 保留 阶段/技能/接力（接力改为"实际存在 handoff 路由的阶段间连接数"，可用字段路由 handoff 统计；后端未提供前保留公式并标注）。
- 新增：**完成度分布**（reconciliation summary.byStatus 投影为 `live N / total` 绿字 + 非零档红/黄警示 pill：未注册 / 缺 ACTIVE / 幽灵注册 / W4 漂移）。
- **「编排存在未解析节点」可展开**：标题旁「未解析明细 N」按钮 → 展开列出 `阶段名 · agentId`（数据已在前端 defSteps，零新请求）。
- 刷新按钮语义升级：「刷新定义」同时重拉 reconciliation + readiness + runtime-definitions（一键刷新全部元数据）。

### 3.2 阶段流水线（P0）

每个阶段按钮 meta 下新增一行**完成度分布徽章**（色标与 Skills.vue 对账面板同源）：

```
01 Goal 阶段 · 1 Skills · 204 次调用
   [live 1]                  ← 该阶段技能完成度聚合
02 Path 阶段 · 2 Skills · 113 次调用
   [live 1][sync 1]
```

- 数据：reconciliation items 按 `stage` 聚合（零后端改动）。
- 色标五档与全局一致：draft #9aa4b2 / handler-ready #d97706 / core-ready #3478f6 / fields-synced #0d9488 / live #16a34a。
- tooltip：`live 1 · 同步 1`；hover 到按钮本身即切换详情区，两个入口一致。

### 3.3 详情区 · 定义 tab（P0 skill 卡 / P1 血缘）

Skill 卡信息行升级（沿用现有网格卡）：

```
● 目标对话  goal-conversation        [live]  204 次调用
  ↳ 输出: dialogue_concepts
  ▸ db: goal_conversations            ← P1：血缘 chips
```

- **完成度徽章**（P0）：`completion.status` 五档色标 + tooltip 显示首个未过档依据（复用 Skills.vue `recGateDetail` 逻辑，提取为共享 util 或复制小函数）。
- **数据血缘摘要**（P1）：db 表 chips —— 依赖 §2 端点缺口补齐（dataSource 透传）。
- **字段统计**（P1）：`编排 fields N · fields-sync ✓/缺项 N`（fieldsSynced gate detail 已内嵌缺项数，先做 gate 态，缺项计数等端点补齐）。
- 输入→输出区：加"handoff 链"一行（该阶段 routings 中 `handoff` 非空的字段 → 目标，来自 stage detail），说明数据往哪流。

### 3.4 详情区 · 字段路由 tab（P1）

- 顶部加**元数据摘要条**：`字段 N · 路由 N · handoff 链 N · 缺项 0 · 孤儿 0`（字段/路由数已有；缺项/孤儿等 §2 端点缺口）。
- 表格优化（不动后端，纯前端）：
  - **按 promptRole 分组折叠**：hard-required / soft-info / hidden-inference 三个 `<details>` 组，默认展开 hard-required；角色列改为组头摘要。
  - **角色色标**：hard-required 红 / soft-info 蓝 / hidden-inference 灰（现有 `.frt__role` 单灰）。
  - **pathInRawOutput 列**：默认截断省略，hover/点击展开完整路径（`internal.ext.goalConversation...`）；锁列已有色标保留。
  - render/handoff 列用图标 + 短标签降噪。

### 3.5 新增区块：每阶段「数据流转总览」（P2）

详情区定义 tab 顶部（或独立第五 tab）加一行可视摘要：

```
fields(24) ──routings(28)──▶ handoff 链 6 条（→ path-agent） · internal 8 · accumulate 3
```

- 数据：stage detail 一次拉取即可计算（fields/routings 全部字段都在）。
- 用途：一眼看清该阶段"字段产出 → 流向谁 → 哪些是内部/累积"。

### 3.6 整体信息架构建议

| 元数据 | 层级 |
| --- | --- |
| 完成度分布（全局）· 未注册/缺 ACTIVE/幽灵/W4 漂移 · 未解析节点清单 | **一级（顶部条）** |
| 每阶段完成度分布 · 调用数 | **一级（阶段按钮）** |
| 完成度徽章 · 血缘 chips · 字段统计 · handoff 链 | tab 内（定义 tab） |
| pathInRawOutput / 缺项孤儿 / promptRole 分组 | tab 内折叠（字段路由 tab） |
| 漂移明细 / 审计 / 编排文件编辑 | 维持 tab 内（漂移与审计 tab / 弹窗） |
| dataSource 表级血缘明细 | 折叠（tooltip / 抽屉） |

原则：**一级页面只放"健康度结论 + 差集计数"，明细一律 tab 内折叠**；所有统计优先来自 reconciliation/readiness 这类"已对账"端点，杜绝前端硬编码公式。

---

## 4. 实施清单

### P0 —— 顶部条 + 阶段徽章 + skill 卡完成度（本轮已完成示范）

| 项 | 改动文件 | 消费端点 | 前端改动点 | 验收 |
| --- | --- | --- | --- | --- |
| P0-1 顶部条完成度统计 | `Orchestrator.vue` | `GET /admin/skills/reconciliation` | 新增 `loadReconciliation()`（失败静默置 null，live-only），顶部条追加 `完成度 live N/N` + 未注册/缺 ACTIVE/幽灵/W4 漂移警示 pill | live 模式显示真实分布；demo 模式无变化；端点失败不影响页面 |
| P0-2 未解析节点明细展开 | `Orchestrator.vue` | 无新请求（复用 defSteps） | `unresolvedNodes` computed + 展开按钮 + 明细卡片 | 有 unresolved 时标题旁出现按钮，展开列出 `阶段 · agentId` |
| P0-3 阶段完成度徽章 | `Orchestrator.vue` | 同上（items[].stage 聚合） | `recByStage` + `stageComp()`，阶段按钮 meta 下渲染色标徽章 + tooltip | 每阶段徽章数与 Skills 页对账面板按 stage 过滤一致 |
| P0-4 W4 漂移计数 | `Orchestrator.vue` | `GET /admin/skills/readiness` | 与 reconciliation 并行拉取，`checks.W4.drifted.length` | 存在 core 漂移时顶部条出现红字 `W4 漂移 N` |
| P0-5 skill 卡完成度徽章 | `Orchestrator.vue` | 同上（items 按 skillId 建 Map） | skill 卡右侧加五档色标徽章 + tooltip（首个未过档 gate 依据） | 卡上徽章与抽屉 completion 一致 |

### P1 —— 血缘摘要 + 字段摘要（依赖后端小补，见 §2 端点缺口）

| 项 | 改动文件 | 消费端点 | 前端改动点 | 验收 |
| --- | --- | --- | --- | --- |
| P1-1 db 表血缘 chips | `Orchestrator.vue` | reconciliation 扩展 `dataSource`（后端透传 skills.yaml） | skill 卡第二行渲染 db 表 chips（mono，可复制） | 卡上显示 `goal_conversations` 等真实表名 |
| P1-2 字段统计行 | `Orchestrator.vue` | workbench-meta 扩展 `coreFieldCount` + stage detail | `core fields N · 编排 fields N · fields-sync ✓/缺项 N` | 数字与 CLI `prompts:fields-sync:check` 一致 |
| P1-3 字段路由摘要条 + 表格优化 | `FieldRoutingTable.vue` | `GET /admin/field-routings/stages/:stage`（已有） | 顶部摘要条（字段/路由/handoff 链数）；promptRole 分组折叠；角色色标；pathInRawOutput 可展开列 | 表格可折叠到 3 组，缺项数显示在摘要条 |

### P2 —— 数据流转总览 + 交互打磨

| 项 | 改动文件 | 消费端点 | 前端改动点 | 验收 |
| --- | --- | --- | --- | --- |
| P2-1 每阶段数据流转总览 | `Orchestrator.vue`（定义 tab 顶部） | stage detail（已有） | `fields→routings→handoff` 一行式摘要 | 切阶段时摘要随动 |
| P2-2 变量流去截断 | `Orchestrator.vue` | skill-catalog（已有） | 去掉 slice(0,5)，超出折叠 | 全量字段可查 |
| P2-3 刷新语义合并 | `Orchestrator.vue` | 全部 | 「刷新定义」→ 并行重拉 definitions+reconciliation+readiness | 一键全刷新，loading 态合并 |

---

## 5. 验收结果（本轮小样）

**已实现（P0-1/P0-2/P0-3/P0-4）：**

- `Orchestrator.vue` 顶部条新增：`完成度 live N/N`（绿）、`未注册 N`（黄）、`缺 ACTIVE N`（黄）、`幽灵注册 N`（红）、`W4 漂移 N`（红）——全部 live-only、失败静默（`Promise.all` + `.catch(() => null)`），demo 模式零影响。
- 未解析节点：状态条追加「未解析明细 N」按钮，展开显示 `阶段 · agentId` 清单（纯前端派生）。
- 阶段按钮：meta 下新增五档色标完成度徽章（reconciliation items 按 stage 聚合，与 Skills.vue 对账面板同源同色）。
- 刷新时机：onMounted + demo→live 切换 watch 触发拉取。

**验证：**
- `npx vue-tsc --noEmit -p tsconfig.json` ✅ 通过
- `npx eslint src/views/admin-redesign/Orchestrator.vue` ✅ 0 error（1 个 warning 为既有 `orchDefs` 的 any，非本次引入）
- 回滚方式：删除 `loadReconciliation` 相关 ref/computed/模板段即可，无跨文件依赖。

**未做（依赖后端或属 P1+）：** db 表血缘 chips、core/编排字段对比、字段路由表分组折叠——均已列入 §4 清单并标注端点缺口。
