# Learn Agent 中心化 + 三层统一化改造主计划（2026-08）

> 本文档为当前改造工作的**唯一进度真相源**。会话丢失时以此恢复上下文。
> 决策基座：[`EDUCATIONAL_THEORY_MAP.md`](../EDUCATIONAL_THEORY_MAP.md)（理论宪法）；[`AGENT_BOUNDARY_CONTRACT` 章节并入本文 §2.2]。
> 状态标记：⬜ 未开始 / 🔄 进行中 / ✅ 已完成 / 🧹 已清理。

---

## 0. 背景与目标

Wenflow 当前存在两类问题：

1. **架构断链**：loadIndex 只存不读（interactionProfile 构建后未注入）、自动调整链空转（agent-collaboration 等效死）、复习闭环断裂（complete_review 硬阻断、memory_traces 0 行）、多目标零调度（learning_goals 休眠表）。
2. **定义冗余**（考古确认，机制被反复发明）：编排定义 4 套（orchestrator_definitions 表 0 行 / agent_definitions 表 0 行 / agent_contracts 27 行 / coordinators/*.definition.ts）、数据传递 5 套、信号检测 3 套、画像存储 5 处；`sync-runtime-definitions.ts` 孤儿脚本从未挂载；死代码与 DB 残留互相缠绕。

**本阶段三支柱目标**：

- **统一**：三层定义链收敛为单一权威——Agent 层 = manifest；编排层 = coordinators/*.definition.ts；Skill 层 = prompts/core/*.yaml + skills/*/definition.ts。废弃镜像表与孤儿脚本，admin 改读实时编译。
- **清晰**：按批次清理死代码与 DB 残留（agent-collaboration 全家、SignalRegistry、plugins、退役 skill 残留、死表），收敛重复实现（KTL 三套、level 公式四处、聚合块两套）。
- **可视化**：admin 三页（Orchestrator / Topology / FieldRoutings）渲染真实定义与漂移报告，编排定义从"demo 骨架"变为"定义驱动视图"。

同时保留已确认的业务改造（profile-agent 中心化出口、复习闭环、loadIndex 消费、多目标预算），统一化是其底座。

## 1. 已确认决策（勿再变更）

| # | 决策 | 依据 |
|---|---|---|
| D1 | **profile-agent 绝不改名**；中心化只是职责扩展；不新增 learn-agent id；"组长/组"仅为描述概念，不做进系统 | dc41571 改名牵连 30+ 文件、31a97e4 被迫回退一半；field-routings.ts:289 已有 `learner: 'profile-agent'` 别名映射 |
| D2 | 新能力按**服务直调模式**挂 profile-agent 名下，**不扩 learner.definition 主链 step** | 与 2026-08 去 LLM 化方向一致；memory/ 服务是现成先例 |
| D3 | **退役删除 agent-collaboration 自动调整链**（含 adjustment.ts/strategies.ts/concept-priority/path-adjustment-generator） | 等效死（enableAutoAdjustment=false + 无事件源 + 零外部消费者）；修复会与生产 replan 管道双调整源冲突 |
| D4 | 复习闭环、loadIndex 消费、多目标预算台账**全部纳入本次改造** | 用户确认 + 补充调查 |
| D5 | **不做 StepRunner 定义驱动引擎**（第 5 次"定义驱动"发明；历史 4 次全部无执行器）。编排的真实形态 = 4 个命令式执行体 + outbox 事件链，保持 | 考古结论：全仓无任何组件读取 steps[]；"运行时引擎化"已被用户撤回（"不做那么多冗余"） |
| D6 | **统一化走方案 B**：废弃 orchestrator_definitions / agent_definitions 表 + 删除 sync-runtime-definitions 孤儿脚本；admin API 改读 coordinators/*.definition.ts + manifest **实时编译**（天然一致，无镜像漂移） | 统一化调查：方案 B 工作量差距小、消除整条镜像维护面、符合去冗余 |
| D7 | 前端契约**零破坏**（后端内部改造；snapshot 字段只增不改，snapshotVersion 保持 v1） | 前端消费面调查 |
| D8 | 双引擎（推理+执行）试点默认 feature flag **关闭**，优先级降至工程补强可选项 | 用户确认 |
| D9 | 组长"沉淀数据"载体 = **事件投影承担**（LearnerEvidenceProjector），不新建 agent 状态池；accumulate=true 语义补注释 | 用户确认 |

## 2. 核心架构设计

### 2.1 三层定义链统一（本阶段主线）

```
┌─ Agent 层权威：backend/src/services/agent-manifest.service.ts
│   5 顶层 agent + 20 skill + agentMembers + defaultModelConfig（运行时唯一真理源，✅现状不动）
│   └─ 镜像废弃：
│       ├─ orchestrator_definitions 表（0 行）→ 删除（admin 改读 definition.ts 实时编译）
│       ├─ agent_definitions 表（0 行）→ 删除
│       └─ sync-runtime-definitions.ts（孤儿脚本，无 npm/启动/CI 挂载）→ 删除
│
├─ 编排层权威：backend/src/coordinators/*.definition.ts（5 个，steps + variableGraph）
│   前提：修正 phantom id 与错位（§2.3），否则"权威"本身是错的
│   消费：admin API 实时 import 编译（新端点），不再落表
│
└─ Skill 层权威：prompts/core/*.yaml（业务契约）+ skills/*/definition.ts（io schema/温度参数）
    ├─ 产物链：core.yaml → 编译 skill.*.md → agent_prompts ACTIVE（File-as-Truth 闭环，✅现状）
    ├─ 修正：manifest defaultModelConfig 与 skills/*/definition.ts 参数单源化（消除 path-planning 0.4 vs 0.2 漂移）
    └─ SKILL_PROTOCOL_V4 附录 A 改为自动盘点（36→27 修正 + 3 个无 core 项说明）
```

### 2.2 Agent 边界与数据边界契约（并入本计划）

**规则集**：

| 规则 | 内容 |
|---|---|
| B1 单写原则 | 每张表唯一授权写方（域内）；跨域写仅三条合法通道：① outbox 事件 ② 域公开服务方法 ③ 授权例外（下表登记） |
| B2 profile 出口原则 | teaching/path 读学习者信息只准经出口（LearnerSnapshotService.getSnapshot / LearnerExitService）；禁止直查 learner_evidence/memory_traces/student_baselines 源表；profile 聚合层"读以聚合"允许但对外不可见 |
| B3 users 收敛 | xp 统一经成就域服务；learningStateRevision 仅 learning-state 服务提交；dashboardGuidanceSnapshot 仅 profile 域写 |
| B4 事件单向流 | goal/path/teaching → outbox → profile 投影；profile 不反向直写（applyUpdate 退役） |
| B5 simulation 经服务 | simulation 访问生产域一律经 coordinator 服务方法，禁止直查直写 |
| B6 授权例外登记 | teaching 结算写 learning_metrics/users.learningStateRevision（已走 prepareSessionScoreCommit）；teaching 读 subtasks 任务上下文；profile 聚合层直查源表 |

**越界点处置**（22 处，调查结论）：退役消除（W1 applyUpdate、W8 agent-collaboration 写 milestones）；收敛到出口（teaching 读 memoryTrace 改出口、path 复习取 due 改出口）；授权例外登记（W2/W3/W4/R14/R1-R4）；simulation 改经服务（W6/W7/R12/R13）；修复（R22 platform_api_configs 表分裂）；死表清理（virtual_experiment_runs/learningContents/platform_stats）。

### 2.3 definition.ts 修正清单（统一化前置）

| 文件 | 修正 |
|---|---|
| `ai-teaching.definition.ts:7,10,12` | `context-builder`/`checkpoint-engine`/`replan-advisory` 是 **phantom id**（不在 manifest）→ 标注 `kind:'service'`（真实执行体：TeachingContextBuilder / AITeachingCoordinator.submitCheckpoint / ReplanAdvisoryService）；补 opening 步骤（teaching-opening-generator，真实链第一拍） |
| `learner.definition.ts:9` | `snapshot-refresh-service` phantom id → 归并到 `skill:learner-model`（getSnapshot 即刷新核心）或标注 service 节点 |
| `learner-model-agent/definition.ts:7` | `category:'agent'` 与 manifest `kind:'skill'` 冲突 → 改 `'skill'` |
| `path.definition.ts:7` | step1 `skill:goal-conversation` 错位（goal 阶段属于 goal-agent）→ 改为 `role:'input-framing'` 伪节点（标注确定性无 LLM）或删除 |
| `simulation.definition.ts` | 8 步总体吻合，补 persona/scenario-designer 前置步骤说明；variableGraph 键名与 skills/*/definition.ts 的 variableBindings 命名体系统一 |

## 3. 阶段计划

### 阶段 0：基线收口（⬜，0.5 天）
- [ ] `npm run check` 验证未提交 58 条目（M1 认知负荷 + M2 记忆引擎 + simulation seed）
- [ ] 拆 3 个 commit 落袋：M2 → M1 → simulation 字段路由
- [ ] 验收：`npm run check` 全绿；工作区干净

### 阶段 1：统一化——三层定义链收敛（⬜，1.5-2 天）**本阶段主线第一**

**1a. 修正 definition.ts（§2.3 清单）**
- 修 ai-teaching/learner/path/simulation 四个 definition 的 phantom id、错位、category 冲突

**1b. 废弃镜像层（方案 B）**
- 删除 `orchestrator_definitions` / `agent_definitions` 表（schema + 迁移）+ `scripts/sync-runtime-definitions.ts` 孤儿脚本
- 新增/修改 admin API：`routes/admin/runtime-definitions.ts` 的 `/orchestrators` 改实时 import 5 个 definition.ts + manifest 编译，响应含 `stepsResolved`（step.agentId → `{displayName, kind}`）；`/agents` 改读 manifest + skills/*/definition.ts
- 新增 `GET /admin/runtime-definitions/consistency`（steps 可解析性校验结果）
- 前端 `Orchestrator.vue` 依赖同步调整（见阶段 3）

**1c. 参数单源化**
- manifest `defaultModelConfig` 与 `skills/*/definition.ts` 的 defaultTemperature/defaultMaxTokens 统一（definition.ts 为权威，manifest 标注"仅展示/兜底"）；修正 path-planning 0.4 vs 0.2 漂移

**1d. agent_contracts 收敛**
- 5 组 seed 常量中 displayName/description 改为从 manifest 派生（stage 列保留为路由分组键），删除重复常量

**1e. SKILL_PROTOCOL_V4 附录 A 修订**（36→27 + 3 个无 core 项说明，或改为自动盘点）

**测试**：新增 `runtime-definitions` 实时编译契约测试；definition.ts 校验（steps agentId 可解析）进 `prompts:check:all`

**验收**：两张定义表删除；admin API 返回真实定义；`context-builder` 等 phantom id 全部消解

### 阶段 2：清晰化——死代码与 DB 残留清理（⬜，1-1.5 天）

**P0 安全清理**（无依赖）：
- [ ] DB：`agent_field_routings` 删 45 条退役路由（6 个 skill：path-scene-framing/learning-pattern-distiller/goal-profile-inference/label-generator/session-knowledge-distiller/dialogue-concept-extractor）
- [ ] DB：`agent_contracts` 删 6 条退役契约（保留 skill:learner-model）
- [ ] DB：`agent_prompts` 删 agent-snapshots 7 行 + 移出 `prompts/agent-snapshots.md`（loader.ts 排除文档文件，防重建）；删 10 条退役/残留 ACTIVE 行 + 对应 23 条 ARCHIVED
- [ ] DB：`virtual_experiment_runs` 删表（schema.prisma:896 + 迁移）
- [ ] 代码：field-dispatcher 4 死方法（getFieldRender/shouldHandoff/isDispatcherEnabled/logEnvelopeDrift）；prompt-cache 2 死方法（getCachedPrompt/preloadPrompts）；`emitLearningEvent`；孤儿 `services/learning/student-baseline.service.ts`
- [ ] 代码：level 公式 4 处收敛为 `getLevelFromXp(xp)` 单点

**P1 依赖清理**（按序）：
- [ ] 1. agent-collaboration.service.ts（先删 index.ts 接线）→ adjustment.ts → strategies.ts → strategies/concept-priority → v4-aux 的 path-adjustment-generator/concept-priority + prompt 文件 + DB 行
- [ ] 2. Gateway SignalRegistry/StrategyRegistry + executeAgent 死链 + signal 监听
- [ ] 3. agents/plugins 链（basic-evaluator/skill-adapter/plugin-registry）+ plugins/goal-alignment-checker + v4-aux 同名重复注册
- [ ] 4. LLM skill 本体注销：goal-understanding-composer / teaching-strategy-selector / acceptance-evidence-evaluator（改 handler-only/noPromptFile，保留纯函数引用）
- [ ] 5. `learningContents` 表（先改 learning.service.ts:3690,3756）、`platform_stats` 表（先改 routes/admin/platform.ts:562）
- [ ] 6. LearnerProgressService 伪指标收敛（getCurrentMetrics 恒 0）

**P2 与改造同批**：
- [ ] 内存 event-bus 收编：域事件全量 outbox 化；内存 bus 仅留调试用途
- [ ] DashboardGuidanceSnapshotService 与 LearningStateGuidanceService 聚合块合并（assembleLearningState 共享）
- [ ] KTL/LF 三套收敛到 learning-state.service（LearningMetricService 私有公式委托）
- [ ] `student_baselines` + `services/student-baseline.service.ts` + profile-aggregator.ts:263 使用点退役（随 M1 认知负荷层改造）
- [ ] 前端 demo 数据更新退役 skill 引用（store.ts / Orchestrator.vue demoStages）或加"离线演示"标识

**验收**：清理后 `npm run check` 全绿；DB 无退役 skill 残留；死代码 grep 零命中

### 阶段 3：可视化——admin 三页定义级渲染（⬜，1.5-2 天）

**3a. Orchestrator.vue（定义级渲染）**
- 后端：`/orchestrators` 返回 stepsResolved + variableGraphResolved（依赖阶段 1b）
- 前端：`Orchestrator.vue:99-127` 结构化缓存定义；`:205-237` stages computed 改定义驱动（demo 仅离线 fallback）；`:27-43/:46-81` 模板渲染 role/loopOver/condition + variableGraph 字段
- 验收：5 个阶段按钮来自真实定义（teaching 6 步 / simulation 8 步含 role/condition 标注）；点阶段见真实成员与字段流

**3b. Topology.vue（定义层叠加）**
- 前端：`live.ts:1061-1080` 透传 modelConfig/ioContractVersion/category；新增"定义层"开关——拉 5 个 stage 的 `getFlow`（端点已有数据）叠加字段流边；agentCard 显示定义步骤数
- 验收：可切换"运行时拓扑 / 定义字段流"视图

**3c. FieldRoutings.vue（补齐闭环）**
- 后端：新增 `GET /admin/field-routings/drift`（复用 detectFieldRoutingDrift）；`/changes` 响应补 `.changes` 包装
- 前端：handoff 列可编辑（patch 已支持）；新增"新建字段"表单（createField 已定义）；新增"漂移报告"卡片；修复 changes 取数（:200）
- 验收：seed vs DB 漂移逐项可见（红黄对比）；handoff 可编辑落审计；可新建字段

**3d. 一致性展示（可选）**：定义 steps 与 manifest 不一致项在页面上可见（consistency API）

### 阶段 4：profile-agent 统一出口（⬜，1.5-2 天）

（沿用原计划，含 interactionProfile 断链修复、LearnerExitService、xp 收敛、level 单点化——level 单点化已提前到阶段 2）

- 新增 `services/learner/LearnerExitService.ts`（getLearnerContext 门面 + exit 增量字段挂 LearnerSnapshotService.getSnapshot return 前）
- `skill:learner-model` action 加 `'get-exit'`；definition.ts 同步
- 改造调用点：TeachingContextBuilder 四件套、AITeachingCoordinator dueReview/快照/结算、replan 取数、DashboardGuidance 与 LearningStateGuidance 聚合块合并（阶段 2 已做）
- **P0 断链修复**：AITeachingCoordinator scenario 组装补 interactionProfile 字段
- xp 收敛：learning.service.ts:4419 与 achievement.service.ts:89 统一经成就域服务
- 测试：getLearnerContext.test.ts

### 阶段 5：prompt 提升（⬜，1.5-2 天）

（沿用原计划，理论依据见理论地图）teaching-turn 三路由/苏格拉底阶梯/情绪急救/间隔回捞/自检；goal-conversation 预算消费条文；session-wrapup loadIndex 输入/情绪收尾/检索题原文；peer-reinforcement 死输入消费+手法表；path-adjustment-generator 与 adaptive-guidance-copy 的 inputs 段——**注意：path-adjustment-generator 随阶段 2 退役，其提升项取消**；编译器死输入 lint + 规则分组

### 阶段 6：复习闭环激活（⬜，1.5-2 天）

（沿用原计划）due API / review session / complete_review 激活 / SM-2 间隔递增 / lastRetention 落库 / LearnerKnowledgeMemoryService 读侧并轨 / 前端复习卡与复习页

### 阶段 7：loadIndex 聚合消费（⬜，1 天）

（沿用原计划）session_load 写入 learning_metrics、determineNextStage 辅助证据、前端负荷 chip

### 阶段 8：多目标预算台账（⬜，1.5-2 天）

（沿用原计划）learning_goals 扩字段、goal_scheduling_ledger 新表、schedule API、cognitive_bandwidth 接线、V2Dashboard 预算卡

### 阶段 9：工程补强（⬜，2 天，可选优先级）

- 可观测先行：ttftMs/promptCacheHit 入 metadata JSON（免迁移）；session_load 已有（阶段 7）
- 死配置接线：ResolvedRoute 加 reasoningModel/lightModel；router getUserProvider 读 reasoningModel（**注意：阶段 2 的 R22 修复与此相邻**）
- 双引擎试点：feature flag 默认关（D8），降级为可选项
- KV 前缀：recap 改 user payload 末尾 + buildMessages 拆消息数组
- 缓存复活：getActivePrompt 内存缓存（key 含 version:coreHash）

### 阶段 10：质量门禁（⬜，1 天）

- `llm:calls:check` + `prompts:check:all`（含阶段 1 新增的 definition 校验）并入 `npm run check`
- `prompts:core:check` / `prompts:runtime-contract:check` 进 CI 独立 step
- 三层一致性校验落地：① steps agentId 可解析性 ② manifest ↔ skills/definition 参数对账 ③ manifest skill 集 ↔ core 文件集 ↔ skillHandlers 三方差集
- 补测高风险文件（TeachingContextBuilder / LearnerSnapshotService / profile-aggregator / memory-trace 服务层 / cache）

### 阶段 11：文档同步（⬜，1 天）

- ✅ 已落：`doc/EDUCATIONAL_THEORY_MAP.md`（理论宪法）
- 🔄 本文档（唯一进度真相源，随进度更新状态表）
- `doc/ARCHITECTURE_ALIGNMENT_AND_REMEDIATION_PLAN.md` §10 状态表同步
- `doc/LEARNER_MODEL_ARCHITECTURE.md` / `doc/AGENT_IO_DESIGN_V3.md` 落地注记
- `doc/README.md` 索引；`README.md` "7 个官方 Agent"表述统一为"5 顶层 Agent + Skill"
- 新设计文档：`doc/design/goal-scheduling-design.md`（台账 + 复习闭环）
- `prompts/agent-snapshots.md` 处置（阶段 2 移出 prompt 源后，作为独立文档保留或重定位）
- SKILL_PROTOCOL_V4 附录 A 修订（阶段 1e）

## 4. 依赖关系

```
阶段0 → 阶段1（统一化）→ 阶段2（清晰化）→ 阶段3（可视化）
     └──────────────────────────────────────┴→ 阶段4（出口）→ 阶段5（prompt）
                                              → 阶段6（复习）→ 阶段7（loadIndex）
                                              → 阶段8（预算）→ 阶段9（工程，可并行）
                                              → 阶段10（门禁）→ 阶段11（文档）
```

- 阶段 1 必须先于 3（可视化依赖实时编译 API）与 10（校验）
- 阶段 2 的 P1 与阶段 5 有冲突点：path-adjustment-generator 退役后其 prompt 提升项取消
- 阶段 4 与阶段 2 共享 level 单点化（已提前）；xp 收敛依赖成就域服务现状

## 5. 风险与注意事项

| 风险 | 缓解 |
|---|---|
| 58 个未提交条目丢失 | 阶段 0 立即提交（拆 3 commit） |
| 改名牵连（D1） | 严禁改名；alias 机制兜底 |
| 废弃定义表后 admin 无数据 | 阶段 1 的实时编译 API 必须先于删表上线（同批） |
| 清理破坏运行时 | 每批清理后跑 `npm run check`；P1 依赖清理严格按序（先删上游接线） |
| 出口字段破坏 snapshot 契约 | 只增不改；snapshotVersion 保持 v1；propagation-report 字段 diff 验证 |
| agent-snapshots.md 移出后文档丢失 | 保留文件但排除出 prompt 扫描（loader.ts 过滤），作为独立参考文档 |
| 前端 demo 引用退役 skill | 阶段 2 更新 demo 数据或加"离线演示"标识 |

## 6. 状态跟踪表

| 阶段 | 内容 | 状态 | 完成日期 | 备注 |
|---|---|---|---|---|
| 0 | 基线收口（提交 M1/M2/simulation） | ✅ | 2026-08-08 | e8be15f/a3a6ec1/5e48635 |
| 1 | 统一化（定义链收敛/删表删脚本/参数单源/附录修订） | ✅ | 2026-08-08 | 5ae58e4/7eea60d/bb7cdd1；definitions-registry + 实时编译 + /consistency |
| 2 | 清晰化（P0/P1 清理批次） | ✅ | 2026-08-08 | 837dc08/023a094/52c8a21/68c0839/79336ed/bb106a5/8f657c9；累计 -4167 行；P2 项（event-bus 收编/聚合块合并/KTL 收敛/student_baselines 退役）留待后续阶段 |
| 3 | 可视化（admin 三页定义级渲染 + 漂移/一致性 API） | 🔄 | | 后端 drift API 进行中 |
| 4 | profile-agent 统一出口 + interactionProfile 断链 + xp 收敛 | ✅ | 2026-08-08 | e633a97；LearnerExitService/level.util/get-exit action；interactionProfile 注入修复（loadIndex 规则激活）；xp 单点 addXp |
| 5 | prompt 提升（三路由/苏格拉底/情绪急救/间隔回捞/自检） | ✅ | 2026-08-08 | 1bc7d96；teaching-turn/goal-conversation/session-wrapup/peer-reinforcement/adaptive-guidance-copy |
| 6 | 复习闭环（due/review/complete_review/SM-2） | ✅ | 2026-08-08 | e5e2c47；due API/review session/complete_review 回写；前端复习卡；SM-2 间隔递增留待 M2 完善 |
| 7 | loadIndex 聚合消费 | ✅ | 2026-08-08 | 75e4b83；session_load 指标 + determineNextStage 干预辅助证据 |
| 8 | 多目标预算台账 | ✅ | 2026-08-08 | 9726d56；learning_goals 扩展 + goal_scheduling_ledger + schedule API + 预算卡 |
| 9 | 工程补强（观测/死配置/KV/缓存；双引擎可选） | ✅ | 2026-08-08 | f3b87e9；ttftMs/cache tokens 可观测 + reasoningModel 接线；getActivePrompt 缓存已存在；KV 前缀与双引擎列为后续可选 |
| 10 | 质量门禁（prompt 检查入 CI + 测试补齐） | ✅ | 2026-08-08 | 5ad516e；check 链 + CI DB 级检查 |
| 11 | 文档同步 | ✅ | 2026-08-09 | 3630c53；状态表收口 + README 表述统一 |
| 12 | 后续收尾（M2 完善 + KV 前缀 + 去冗余） | ✅ | 2026-08-09 | M2 收尾：4fd8e4b/faf6126/87f0aca/f24b637/1c25700/4b2ea2c。KV 前缀：022c20a/d9e8ec1/5b2b85f/8a4e2e4/254bcda（实测 96% 命中 + TTFT -83%）。去冗余：9d324ba（DashboardGuidance/LearningStateGuidance 聚合块合并）。**全部完成** |

## 7. 总工作量估计

约 17-21 人日。阶段 1-3（统一/清晰/可视化）约 4-5.5 人日，是本阶段核心；阶段 4-8（业务改造）约 8 人日；阶段 9-11 约 4 人日。预算充足，阶段 9 可与 4-8 并行。
