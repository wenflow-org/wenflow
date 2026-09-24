# 虚拟学习者 · 日期模拟与学习负担评估（设计稿 + 待做清单 v5）

> 状态：**设计稿 + 契约 + 待做清单（仅审阅，未实现）**。不是代码，不进运行时，**不改 Path 契约、不改 session/profile schema**。
> 系统层现状：日期重放脚手架已落地（`simulate-learner-days.ts`），其余见 §四 待做清单。
> 目的：把"学习分散在各自然天"的仿真语义、系统层契约、页面落点先钉死，与系统层对齐后直接对接。
> 粒度：**按自然日**；推进方向：**过去锚点 + 向前推进（历史重放）**（§8.8）。
> 关联：`doc/VIRTUAL_LEARNER_CHAIN.md`、`doc/LEARNER_STATE_REVIEW_DESIGN.md`、`doc/local/EDUCATIONAL_THEORY_RESEARCH_2026.md`、`doc/VIRTUAL_LEARNER_PRESET_DESIGN.md`。

---

## 〇、范围与不变式

**本稿负责**：日期模拟的语义定义、系统层 ↔ 页面层的数据契约、页面信息架构与**待做清单**。
**本稿不负责**：系统层时钟实现（由另一进程/其他 skill 开发）、跨日续跑的编排实现。

**不变式（硬约束）**：

1. **不改 Path 契约**：`learning_paths` / `milestones` / `subtasks` schema 与 `path-status` 既有字段不动。
2. **不改 `virtual-learners/presets.yaml`**：14 条预制样本保持冻结。
3. **仿真时钟只存 JSON**：`virtual_sessions.stageResults.simulationClock`（以及实验级 JSON），不新增必填列。
4. **数据隔离**：模拟推进只作用于 `isVirtualLearner = 1` 的账号；任何跨日写入不得命中真实用户。
5. **"一套"原则**：时间线/负担视图只做一个组件、一组接口，在列表页/画像页/座舱/批量实验复用，不各写一套。
6. **区分两种预算**：`session-budget.ts` 的 `costCeiling/turnChunkPerLesson` 是 **AI 调用成本预算**；本稿的 `plannedMinutesPerDay/budgetMinutes` 是 **每日学习时长预算**。两者不可混用。

---

## 一、语义定义

| 概念 | 定义 | 依据/来源 |
|---|---|---|
| 模拟日（simulated day） | 一个自然日，`YYYY-MM-DD`（**本地时区日界**） | `getTodaySchedule` 本地日界（`learning.service.ts:1542`，2026-08-21 定案） |
| `simulatedNow` | 该模拟日内的一个时间点（ISO），推进时锚定到 **09:00 active window** | `memory-trace.service.ts:150` `ACTIVE_START_HOUR = 9` |
| `dayIndex` | 相对会话起点的第 N 天，1-based；第 1 天 = 会话启动日 | 新增（JSON） |
| 睡眠周期 | 23:00–07:00；**首次提取/首次复习必须跨 ≥1 个睡眠周期** | `memory-trace.service.ts:146-171`；Rasch & Born 2013 / Gais 2006 |
| 学习负担（当日） | 当日 `consumedMinutes`（实学）与 `plannedMinutes`（计划）的对比，辅以 `loadAvg` 与 `LSS/KTL/LF` | `goal_scheduling_ledger`、`learning_metrics` |
| 系统干预 | `InterventionDecision{type, priority, content, reasoning}` | `learning-state.service.ts:1131` |
| 动态调整 | 复习负担预算随成功率回校准（1.0 / 2.0 / 3.0） | `review-plan.service.ts:85`，Bjork 有益困难 ~85% |

**推进语义**：`advance-day(+1)` = **模拟顺序**前进一天（dayIndex+1），日历写入 `baseDate + dayIndex`（锚点在过去，见 §8.8）；当日（可选）执行分配的 task，全部业务时间戳（课堂、记忆、证据、画像最近完成）均使用该模拟日。

---

## 二、系统层契约（由系统层实现，页面只消费）

### C0. 时钟存储（JSON，免改 schema）

```jsonc
// virtual_sessions.stageResults.simulationClock
{
  "baseDate": "2026-09-15T09:00:00.000+08:00",  // 会话启动的真实日期
  "simulatedNow": "2026-09-18T09:00:00.000+08:00",
  "dayIndex": 4,
  "timezone": "Asia/Shanghai",
  "source": "virtual"
}
```

- 实验级统一时钟（可选）：`batch_experiment_runs` 增加 JSON 字段或复用 `checkpoints`，用于"多个学习者同一天推进"的横向对比。

### C1. 需要注入 `asOf/now` 的时间读取点（系统层改造清单）

> 当前全是 `new Date()` 硬编码；这是"日期模拟"能否成立的关键。逐点加可选参数即可，默认 `new Date()` 保证现网不变。

| 位置 | 现状 | 需要的注入 |
|---|---|---|
| `learning.service.ts:1539` `getTodaySchedule` | 内部 `new Date()` | `asOf?: Date` |
| `learning.service.ts:1624` `planTodaySchedule` | `toISOString()`（UTC） | `asOf`，并统一为本地日界 |
| `learning.service.ts:4292-4332` streak 更新 | `new Date()` + UTC 串 | `asOf`，并统一日界 |
| `memory-trace.service.ts:185` `recordExtraction` | `const now = new Date()` | `now?: Date`（`getDueTraces:275` / `getRetentionSnapshot` 已有 `now?`） |
| `memory-trace.service.ts:394` `applyKtEstimate` / `:435` `bumpReviewInterval` | `new Date()` | `now?` |
| `learner-memory.ts:361` `recordCompletedArtifact` | `new Date().toISOString()` | `now?` |
| `learner-memory.ts:249` `buildLearnerMemorySnapshot` | 调 `getDueTraces` 不带 `now` | 透传 `now?` |
| `TeachingSessionRepository.reserve:172` / `AITeachingCoordinator.ts:719` | Prisma `@default(now())` / `Date.now()` | 显式 `startTime` / `asOf` |
| `learning-state.service.ts:473` `restoreMetrics(input, asOf)` | ✅ 已有 `asOf` | 直接复用 |
| `review-plan.service.ts:286` `buildReviewPlan(…, {now})` | ✅ 已有 `now` | 直接复用 |

### C2. 建议接口（统一前缀 `/api/admin/virtual-learners`，与现有风格一致）

#### ① 读时钟
```
GET /sessions/:sessionId/simulation-clock
→ { baseDate, simulatedNow, simulatedDay, dayIndex, timezone, status }
```

#### ② 跨日推进 = 历史重放（写；系统层实现，页面调用）

> 机制（已定 v4，§8.8）：**不做 mock 时钟**。把"第 `dayIndex` 天的第 K 节课"用 `timestamp = baseDate + dayIndex` 写进既有真实表（`updateLearningMetrics({timestamp})`、`subtasks.completedAt`、`teaching_sessions.startTime/endTime`、`learner_evidence.occurredAt`），读取侧一律按 `asOf = baseDate + dayIndex` 读回。日历锚点在过去（`baseDate = now - maxTotalDays`），推进到末尾≈今天。

```
POST /sessions/:sessionId/advance-day
body: {
  days?: number,                 // 默认 1：模拟顺序前进 N 天（日历 = baseDate + dayIndex）
  runTasks?: boolean,            // 默认 true：推进后执行当天任务
  maxMinutesPerDay?: number,     // 可选：当日时长上限，超出则顺延（负担旋钮）
  stopOnIntervention?: boolean   // 可选：触发高优先级干预即停
}
→ {
  advanced: 1,
  from: { dayIndex, simulatedDay, simulatedNow },
  to:   { dayIndex, simulatedDay, simulatedNow },
  dailyRun: {
    dayIndex, simulatedDay, asOf,
    // ↓ 全部来自已落地读写缝（C4），不新造口径
    dayLoad: { lessons, minutes, fatigueBonus },                    // ← getAggregatedState(asOf).dayLoad
    metrics: { lss, ktl, lf, lsb },                                 // ← getAggregatedState(asOf).metrics
    perPath: [{ pathId, metrics }],                                 // ← getAggregatedState(asOf).perPath
    tasks: [{ taskId, title, estimatedMinutes, actualMinutes, cognitiveLoad, status }], // ← subtasks + teaching_sessions
    interventions: [{ type, reason, at }],                          // ← determineNextStage='intervention' / loadIndex 三路由
    difficultyAdjustments: [{ baseline, adjusted, direction, reasons, applied }], // ← learner_evidence(task:difficulty:adjustment)
    replanSignal: { reasonCodes, primaryReasonCode, recommendation },// ← deriveReplanSignal + replan-attribution
    reviewQuota: { limitLoad, usedLoad, remainingLoad },            // ← ReviewQuotaService(asOf)
    memory: { dueCount, avgRetention }
  },
  dayCount: 12          // 已重放的总天数
}
```
- **幂等**：同一 session 同一天重复调用不重复写入（后端用 `simulationClock.dayIndex` 判定）。
- **可重放**：每次推进追加到 `stageResults.simulationClock.history[]`，页面可回放。
- **隔离**：只对 `isVirtualLearner = 1` 且 `enabled = true`；`asOf` 上界天然排除真实行（§8.8）。

#### ③ 按天负担时间线（读；页面主数据）

```
GET /sessions/:sessionId/day-timeline?from=1&to=N
→ {
  days: [{
    dayIndex, simulatedDay, asOf,
    dayLoad: { lessons, minutes, fatigueBonus },     // ← getAggregatedState(asOf).dayLoad
    metrics: { lss, ktl, lf, lsb },                  // ← getAggregatedState(asOf).metrics
    perPath: [{ pathId, metrics }],                  // ← getAggregatedState(asOf).perPath（路径隔离）
    tasks: [{ taskId, title, estimatedMinutes, actualMinutes, cognitiveLoad, status, completedAt }],
    interventions: [{ type, reason, at }],           // ← 课内阶段路由事件（determineNextStage）
    difficultyAdjustments: [{ baseline, adjusted, direction, reasons, applied }], // ← learner_evidence
    replanSignal: { reasonCodes, primaryReasonCode, recommendation },              // ← deriveReplanSignal + replan-attribution
    reviewQuota: { limitLoad, usedLoad, remainingLoad },                            // ← ReviewQuotaService
    memory: { dueCount, avgRetention, fragileCount }                                // ← getDueTraces(asOf)/getRetentionSnapshot(asOf)
  }]
}
```
> 页面**只读**此接口即可画时间线 + 负担曲线 + 干预清单；聚合口径全部来自已落地读写缝（C4），**不新增实体、不自造口径**（风险 12）。

#### ④ 跨学习者对比（读；批量实验用）
```
GET /api/admin/batch-experiments/:experimentId/day-timeline?metric=burden|intervention
→ { learners: [{ runId, name, days: [ /* 同 C2③.day */ ] }] }
```

### C3. 干预与动态调整的"落点"（供聚合读取，不新增表）

> **更正（v1）**：`learning-state.service.ts:1131` 的 `generateIntervention` / `InterventionDecision` **是全仓无调用者的死代码**，不能作为聚合来源。真正的"干预/动态调整"在授课链的阶段路由与技能内三路由（详见附件 A5）。

按可定位证据聚合（**全部是既有产出，不新增埋点**）：

- **课内干预（阶段路由）**：`AITeachingCoordinator.determineNextStage`（`:510-560`）进入 `stage='intervention'` 的事件，落在课堂事件历史（`buildClassroomEvent`，`:471`，含 `occurredAt`）。触发条件：`understanding<0.35 / emotion=frustrated / confusionPoints≥2 / (loadIndex>0.85 且 understanding<0.6) / (θ−d `ktStruggle` 且 understanding<0.6)`。
- **课内降载（技能内三路由）**：`teaching-turn` 的 `analysis.loadIndex` 阈值（<0.3 加难度 / 0.6–0.8 最小提示 / >0.85 拆步降载）+ `loadBasis`。
- **会话负荷聚合**：`commitSessionLoadMetric`（`AITeachingCoordinator.ts:964`）以 `metricType='session_load'`（`sourceKey=session-load:{sessionId}`）幂等写 `learning_metrics.metadata={max, basisDist, perTurnCount}`。
- **课后评估**：`session-wrapup` 的 `evaluation.sessionLss/sessionKtl/sessionLf` + `metricMetadata`（标注为间接推断）。
- **动态调整（记忆侧）**：`review-plan.computeLoadBudget` 的 `budget` 序列（1.0/2.0/3.0，按成功率回校准）。
- **动态调整（状态侧）**：`learning-state.service.restoreMetrics(…, asOf)` 的 KTL/LF 跨日自然衰减。
- **教师侧微调**：`teaching-turn` 开场消费 `scenario.learnerPrediction`（`stallRisk/reliability`）与 `behavioralProfile`。
- **负担顺延**：当 `consumedMinutes + nextTaskEstimated > maxMinutesPerDay` 时，系统层把任务留到次日（本稿只要求接口能表达"顺延"，具体策略由系统层定）。

### C4. 已落地系统层与对齐（v3 补充）

> **重要**：系统层**已经在做**日期模拟，选定机制是 **历史日期重放**（不是 mock 时钟）：把"第 N 天的第 K 节课"用**可指定的 `timestamp`** 写进 `learning_metrics`（`updateLearningMetrics({timestamp}) → asOf → metrics.timestamp → calculatedAt`），读取侧按 `asOf` 过滤，即可在**真实代码路径**上重放历史。验证器：`backend/src/scripts/simulate-learner-days.ts`（6 条断言）+ `simulate-learner-days.test.ts`。

已落地的读写缝（**页面直接消费，不要再造**）：

| 能力 | 位置 | 产出 |
|---|---|---|
| 全局聚合（按 `asOf`） | `learningStateService.getAggregatedState(userId,{asOf})` | `{metrics, perPath[], dayLoad:{lessons,minutes,fatigueBonus}}` |
| 路径级状态 | `learningStateService.getCurrentState(userId,{pathId,asOf})` | `metrics` |
| 当日课量 → 疲劳加成 | `computeDayLoadFatigueBonus({lessons,minutes})` | `fatigueBonus` |
| 节奏 | `LearnerSnapshotService.derivePacing(lf,ktl)` | `slow\|moderate\|fast` |
| 课内控制状态 | `deriveLearningControlState(...)` | `paceMode / challengeLevelCap / conceptLoad` |
| 重排召回信号 | `deriveReplanSignal(...)` | `reasonCodes[]`：`fatigue_high / lsb_negative / recent_trend_declining / fragile_concepts / struggling_concepts / blocked_foundations / prerequisite_gaps` |
| 任务级难度调整 | `TaskDifficultyAdjustmentService.decideTaskDifficulty(...)` | `{baseline, adjusted, direction, reasons[], cap, capSource, evidence}` |
| 调整留痕 / 效果度量 | `TaskDifficultyAdjustmentLedger` | `learner_evidence(evidenceType='task:difficulty:adjustment')`；`measureTaskDifficultyEffects`（对照 vs 执行） |
| 每日温故配额 + 顺延 | `ReviewQuotaService`（`learner_projections(scope='review-quota')`，UTC 日，默认上限 6.0，env `REVIEW_DAILY_LOAD_LIMIT`） | `{limitLoad, usedLoad, remainingLoad, reservedKeys}` |
| 指标写入可指定时间 | `updateLearningMetrics({timestamp})` | `learning_metrics.calculatedAt` |
| 日期重放验证器 | `backend/src/scripts/simulate-learner-days.ts` | 6 条断言（路径隔离 / 总负担 / 信号区分 / 难度调整 / 效果度量） |

**对本稿的影响**：
- §二 C1 的"注入 `asOf`"多数已具备；C2 的"跨日推进"可直接复用 `updateLearningMetrics({timestamp})` 做重放，**不必新造时钟**。
- 页面"日程 tab"应直接读 `getAggregatedState({asOf})` / `deriveReplanSignal` / `deriveLearningControlState`，而不是自造负担与干预口径。
- **已定（v4）**：采用 **"过去锚点 + 向前推进"（历史重放）**。理由与实证见 §8.8。验证器 `simulate-learner-days.ts` 即此法，且 `9c3fd45` 为此专门修了 `getPreviousMetrics` 接受 `asOf` 的真实缺口。

---

## 三、页面设计（本稿重点）

### 3.1 复用原则

- **一个时间线组件** `DayTimeline.vue`（草名）：接收 `days[]`，渲染"日历式按天卡片 + 负担条 + 干预标记"。在画像页/座舱/批量实验复用。
- **一个数据源**：C2③ 接口。列表页只取摘要（`dayCount` + 当前 `dayIndex`）。
- **一套状态机**：不新增生命周期状态；"推进日"作为**动作**挂到现有 `vlab-controls.ts` 的 `VsControlKey`（新增 `'advanceDay'`），沿用现有 confirm/权限体系。

### 3.2 列表页 `VirtualLearners.vue`

- 表格新增一列 **模拟进度**：显示 `第 N 天`（有模拟时钟时）/`—`（无）。沿用现有 `RunStageBar` 的紧凑风格。
- 运行中 chip 增加"当前模拟日"角标。
- 批量条新增 **跨日推进 N 天**（复用现有批量调用与轮询形态，如 `batchLaunchAllStories` 模式）。
- 不改现有列的含义；新增列可排序（复用 `useTableSort`）。

### 3.3 画像页 `VirtualProfile.vue`（主战场）

在现有 tabs（`ProfileTab`：`stories` / `runs` / `memory` / `profile`，`tabs` computed `:1625`）中新增：

**`日程`（timeline）tab**，包含三块：

1. **多日时间线**（`DayTimeline`）
   - 按天卡片：`第 N 天 · 日期` → 当天任务列表（标题/预计/实学/认知负荷状态）→ 负担条（`consumed/planned`）→ 干预徽章。
   - 空态：未开始模拟时提示"该会话尚未启用日期模拟"。
   - 点击某天 → 展开当天详情（复用座舱的课程/知识点卡片样式）。

2. **负担曲线**
   - `plannedMinutes vs consumedMinutes` 双线（按天）。
   - `loadAvg` 单线。
   - `LSS / KTL / LF` 三线（可切换）。
   - 直接暴露"负担是否被系统顺延"的视觉证据（consumed 被 planned 截断的天）。

3. **干预与动态调整清单**
   - 每天触发的 `InterventionDecision`：类型图标 + `reasoning` + `content`。
   - 复习预算变化：`budget: 2.0 → 1.0`（成功率偏低）这类，附成功率。
   - 按类型统计（简化/换讲法/提示/休息/挑战/鼓励）出现频次。

> 现有 **`记忆池` tab 保留为"当前快照"**；新 `日程` tab 是"随时间演化"。两者数据可互相跳转。

### 3.4 会话座舱 `SessionCockpit.vue`

- 顶栏（现有 `RunStateBadge + RunStageBar + modeText + budget`）追加 **`第 N 天 · 2026-09-18`** 徽章（有模拟时钟时显示）。
- Learn 阶段课程列表**按天分组**（现有 `pathMilestonesView`/lesson tree 之上加一层日期分组）。
- 控制台新增 **推进到下一天**（与现有 `step/auto/advancePath/startLearning` 并列；黑盒模式下按现有禁用规则禁用）。
- Trace/日志时间轴区分 **真实时间** 与 **模拟时间**（现 `formatTime` 只显示绝对时间，`SessionCockpit.vue:2182`）。

### 3.5 批量实验 `BatchExperiments.vue`

- 把现有抽屉里的 **衰减**（`decayRun`，固定 3/7/14 天）升级/并列一个 **跨日推进**（按自然日、可连续）。
- 详情抽屉新增 **按天负担/干预对比**：多学习者同一 `dayIndex` 横向对比（正是"评估学习负担变化"的天然场所）。
- 保留现有 `推进 / 衰减 / 快照`；新增能力不替换旧能力，避免破坏既有回归。

### 3.6 运维中心 `OpsCenter.vue`（可选）

- 现有 **时间推进**（`adminDevtoolsApi.advanceTime`，只读预览，`OpsCenter.vue:234`）保留。
- 可加"跳转到该虚拟学习者的日程页"，形成"预览 → 落到具体会话"的闭环。

---

## 四、分期落地与待做清单（TODO）

> 图例：`[x]` 已完成（系统层已提交，2026-09-16）、`[ ]` 待做。

### 4.1 分期

| 期 | 内容 | 依赖 |
|---|---|---|
| **P0（本稿）** | 契约冻结 + 页面信息架构 + skill 层契约（六/七节）+ 设置契约（八节） | 无 |
| **P0.5** | skill 层最小注入：`temporalContext` 只接 `learn-turn-simulator` + `session-wrapup`；`learnerMemory` 加时间维度；`loadRetrievabilityHints(asOf)` | 系统层 `simulatedNow` |
| **P1** | 全局 `dateSimulation` 设置（默认关）+ 只读 `日程` tab（C2③ + `DayTimeline`）+ 列表页模拟进度列 | C1 的 `asOf` 注入 + C2③ |
| **P2** | 跨日推进控件（C2② + `advanceDay` 动作）+ 画像级/会话级 `simulationClock` 配置与重置 + 座舱徽章/分组；`dayLoadContext` 接文案/预测 | C2② 写接口 |
| **P3** | 批量实验横向对比 + 干预观测（C2④）+ 实验级统一起点对齐 | P1/P2 稳定 |

### 4.2 待做清单

> **已落地快照（2026-09-16，提交 e2af8f7 / ce8c983 / b57c480 / 7791b00 / 71d09f4）**
> - ✔ Path 评审不再拦截 Learn（护栏谱系前移 + 重规划失败强制接受 + `acceptPathReview({force})` + 前端逃生口）
> - ✔ P1 后端：全局 `dateSimulation`（默认关）+ `simulated-day.service` 只读聚合 + `GET /sessions/:id/simulation-clock` + `GET /sessions/:id/day-timeline`
> - ✔ P1 前端：`DayTimeline.vue` + 画像页「日程」tab + 列表页 `SimulatedDaySettings` 设置区 + 座舱评审强制接受
> - ✔ 会话级时钟配置/重置 + `elapsedDays` 进度
> - ✔ 技能层 `temporalContext`（learn-turn-simulator 感知跨天；可选注入）
> - ✔ 系统层对齐：日界统一 **UTC**（`700b718`）；脚手架复用本侧 `resolveDayWindow`（`fcf651b`）
> - ✖ 仍待做：`advance-day` 写路径、`simulationClock` 下推、画像级配置/重置、列表"模拟进度"列、座舱"第 N 天"徽章、批量实验、`session-wrapup` 的 `temporalContext`


**A. 系统层（时钟与重放）**
- [x] `updateLearningMetrics({timestamp})` → `learning_metrics.calculatedAt` 可指定
- [x] `getCurrentState / getPreviousMetrics({ pathId, asOf })`（`9c3fd45` 修 asOf 缺口）
- [x] `getAggregatedState({asOf})` → `{metrics, perPath[], dayLoad}`
- [x] `computeDayLoadFatigueBonus` / `derivePacing` / `deriveLearningControlState` / `deriveReplanSignal`
- [x] `TaskDifficultyAdjustmentService` + `TaskDifficultyAdjustmentLedger` + 效果度量
- [x] `ReviewQuotaService`（每日温故配额 + 顺延）
- [x] 日期重放验证器 `simulate-learner-days.ts` + 测试
- [ ] `simulationClock` 落地：`baseDate = now - maxTotalDays` 自动生成 + `stageResults.simulationClock` 读写
- [ ] `advance-day` 写接口（重放式，C2②）
- [ ] 记忆/画像时间戳注入：`recordCompletedArtifact(now)`、`recordExtraction(now)`、`loadRetrievabilityHints(asOf)`（C1 剩余项）
- [ ] 日界统一为本地（`planTodaySchedule` / streak；风险 1）

**B. 技能层（契约增补）**
- [ ] `temporalContext` 输入：core yaml `inputs` + handler 透传 + runtime-contract parity 校验（先 `learn-turn-simulator`、`session-wrapup`）
- [ ] `learnerMemory` 增 `dueInDays`（7.2）
- [ ] `dayLoadContext`（`adaptive-guidance-copy` / `learning-predictor`，7.3）
- [ ] `loadRetrievabilityHints(asOf)`（7.4）
- [ ] 编译流程：`compile-core-files.ts` → `ensure-core-agent-prompts --sync`

**C. 后端接口**
- [ ] C2① `GET /sessions/:id/simulation-clock`
- [ ] C2② `POST /sessions/:id/advance-day`（重放式）
- [ ] C2③ `GET /sessions/:id/day-timeline`
- [ ] C2④ `GET /batch-experiments/:id/day-timeline`
- [ ] 设置：`GET/PUT /settings` 扩展 `dateSimulation`；`GET/PUT /:id` 扩展 `simulationClock`；`POST /:id/simulation-clock/reset`；列表返回进度字段（8.4）

**D. 前端页面**
- [ ] `DayTimeline.vue`（一个组件，画像页/座舱/批量实验三处复用）
- [ ] `VirtualLearners.vue`：日期模拟设置区 + 模拟进度列（3.2）
- [ ] `VirtualProfile.vue`：`日程` tab（时间线/负担曲线/干预清单）+ 画像"日期模拟"区块 + 重置（3.3）
- [ ] `SessionCockpit.vue`：第 N 天徽章 + 推进按钮 + 按天分组（3.4）
- [ ] `BatchExperiments.vue`：跨日推进 + 横向对比 + 统一起点（3.5）
- [ ] `vlab-controls.ts`：新增 `advanceDay` 动作

**E. 设置**
- [ ] `dateSimulation`（默认关）+ `simulationClock` 四层解析优先级（8.1/8.2）
- [ ] 每日负担设置组：`dailyMinutesCap` / `maxLessonsPerDay` / 展示 `REVIEW_DAILY_LOAD_LIMIT`（8.9）

**F. 测试与回归**（详见五）
- [ ] C1–C4 契约测试
- [ ] 重放语义测试（`asOf` 过滤 / 自然衰减；**不 mock 时钟**）
- [ ] 隔离测试（仅 `isVirtualLearner`，真实用户零变更）
- [ ] 幂等测试（同日重复 `advance-day`）
- [ ] 既有基线不破（`batch-experiment` / `resolve-llm-call-params` / `vlab-controls`）

**G. 明确不做（边界）**
- [ ] 不改 Path 契约、不动 `presets.yaml`
- [ ] 不做纯"未来推进"（除非满足 §8.8 三条件）
- [ ] 不合并负担口径（§8.9）
- [ ] 不重定义 `epistemic-grounding`（ESS 无时间，6.3）

---

## 五、测试与回归

- **契约测试**：C1–C4 的请求/响应形状（可先用 mock）。
- **重放语义测试**：`asOf` 的过滤与自然衰减（`9c3fd45` 已覆盖"asOf=行时间不衰减 / 缺省按现在衰减 / 过滤参数透传"5 例，在此扩展）。**重放本身不 mock 时钟**（写过去日期 + asOf 读回）；`jest.useFakeTimers({ now })` 只用于需要"真实 now"的守卫（仓库既有模式：`simulation.coordinator.lease.test.ts:172`、`blackbox-runner.test.ts:837`）。
- **隔离测试**：断言推进逻辑只在 `isVirtualLearner = 1` 生效，真实用户数据零变更（依赖 `asOf` 上界，见 §8.8）。
- **幂等测试**：同日重复 `advance-day` 不重复写入、不重复计。
- **既有基线**：不得破坏 `batch-experiment.service.ts` 的 `setup→…→decay→done`、`resolve-llm-call-params`、`vlab-controls`、`simulate-learner-days` 现有测试。

---

## 六、相关 skill 实现摸底（v1 补充）

摸底范围：`prompts/core/*.yaml`（v4 核心文件，prompt 真源）+ `prompts/skill.*.md`（编译产物）+ `backend/src/skills/**` handler + `backend/src/services/ai-teaching/**` 编排 + `backend/src/skills/virtual-learner-shared/**`（共享 schema）。

### 6.1 两条技能族与各自的时间感知

**真实教学链**

| skill | 角色 | 现在读时间吗 | 时间从哪来 | 日期模拟需要 |
|---|---|---|---|---|
| `teaching-turn` | 授课回合（认知分析+讲解） | 间接 | `scenario.learnerPrediction`、`behavioralProfile`、`interactionProfile` | 开场节奏受跨日疲劳影响（`dayLoadContext`） |
| `session-wrapup` | 课后总结+评分 | **是** | `reviewHints`（FSRS retrievability，真实 `now`） | 注入需 `asOf=simulatedNow` |
| `peer-reinforcement` | 同伴讨论 | 否 | — | 无 |
| `adaptive-guidance-copy` | Dashboard 文案 | 间接 | `paceHint/warningCopy` 与负荷联动 | 需 `dayLoadContext`（第几天/负担趋势） |
| `learning-predictor` | 任务前卡壳预测 | 间接 | 疲劳信号、概念台账 | 跨日累积疲劳进 `stallRisk` |
| `learner-state-review` | 状态诊断 | 否 | `fatigue` insight | `falsifiableClaims.checkOn(next_lesson/next_task/next_review)` 锚定模拟日 |
| `replan-attribution` | 路径重排归因（aux，**新增**） | 否 | 阈值召回（`deriveReplanSignal`）→ LLM 只在 `allowedRecommendations` 里选方向 | `checkOn(next_lesson/next_task)` 可锚定模拟日；**不改召回门**（阈值仍是唯一召回者） |
| `concept-consolidator` / `concept-load-estimator` | 概念归并 / 负担档位 | 否 | — | 无（`concept-load-estimator` 只出档位，权重由代码给；已接 BKT 难度分档） |

**虚拟学习者模拟链**

| skill | 角色 | 时间感知 | 备注 |
|---|---|---|---|
| `virtual-learner-persona-designer` / `scenario-designer` | 生成人设/故事 | 否 | 预制到"故事"为止 |
| `virtual-learner-goal-dialogue-simulator` | Goal 阶段扮演 | 间接 | 读 `learnerMemory`（`dueReview` 等） |
| `virtual-learner-epistemic-grounding` | 认知判决器（ESS 硬约束） | **必须保持无时间** | 能力悖论的解，只出对错判决 |
| `virtual-learner-learn-turn-simulator` | Learn 阶段扮演 | 间接 | 读 `learnerMemory`/`currentPhase`；受 `epistemicGrounding` 硬约束 |
| `virtual-learner-memory-curator` | 课后记忆提炼 | 否 | `memoryDelta` 无时间戳语义 |
| `virtual-learner-path-evaluator` | Path 评审扮演 | 间接 | 读 `learnerMemory`，可提"这段我会了" |
| `virtual-learner-referee` / `actor-auditor` | 终局评估 / 角色保真审计 | 证据里有 timestamp | `actor-auditor` 专门审计"能力悖论泄露" |

### 6.2 时间进入 skill 的 4 条通道（**全部读真实 `now`**）

1. **`learnerMemory`**（`mastered/dueReview/struggling/recentCompleted`）
   `simulation.memory.ts:44 buildAssistedLearnerMemory` → `buildLearnerMemorySnapshot(userId,{limit})`（`learner-memory.ts:249`）**不传 `now`** → `memory-trace.service.ts:275 getDueTraces` 用真实 `now`。
   这是"跨日"进入模拟器的**唯一语义通道**，但当前只能表达"到期"，不能表达"几天前/隔了几天"。
2. **`session-wrapup.reviewHints`**（FSRS 保持率百分比）
   `AITeachingCoordinator.ts:2867 loadRetrievabilityHints` 硬编码 `const now = new Date()`。
3. **`teaching-turn.analysis.loadIndex / loadBasis` + `interactionProfile`**
   真实前端交互特征；虚拟学习者该 profile 为 `absent`（prompt 规则已明确处理）。
4. **`adaptive-guidance-copy` 的 `paceHint/warningCopy`**（负荷联动）

> **结论**：**没有任何 skill prompt 知道"日期/第几天"**；所有"跨日"只通过 `dueReview` 间接体现。

### 6.3 不可破坏的硬约束

`virtual-learner-epistemic-grounding` 是"物理两阶段"的第一段（先只判对错，再让 learn-turn 生成叙事），是对抗 **能力悖论（Capability Paradox）** 的架构解（`doc/local/EDUCATIONAL_THEORY_RESEARCH_2026.md §7.1`：ESS 认识论状态硬约束 + 认知-决策解耦）。
→ **时间注入不得让它输出对错判决以外的内容，也不得放松 `sampledCorrectness` 与 persona 掌握度的一致性**（`actor-auditor` 规则的"epistemicGrounding 一致性检查"专门审计这条）。

### 6.4 干预 / 动态调整的真实落点（更正 `generateIntervention` 死代码）

- **课内阶段路由**：`AITeachingCoordinator.determineNextStage`（`:510-560`）→ `LearnStage='intervention'`，条件见 C3；事件落 `buildClassroomEvent`（`:471`，含 `occurredAt`）。
- **技能内负荷三路由**：`teaching-turn` 的 `loadIndex <0.3 / 0.6-0.8 / >0.85`（prompt 规则 89 行）。
- **会话负荷聚合**：`commitSessionLoadMetric`（`:964`）→ `learning_metrics.metricType='session_load'`。
- **课后评分**：`session-wrapup.evaluation.sessionLss/sessionKtl/sessionLf`。
- **记忆侧动态调整**：`review-plan.computeLoadBudget`（1.0/2.0/3.0）。
- **状态侧动态调整**：`learning-state.restoreMetrics(asOf)` 的 KTL/LF 跨日衰减。
- **教师侧微调**：`teaching-turn` 消费 `learnerPrediction`（`stallRisk/reliability`）。
- **难度侧动态调整（已落地）**：`TaskDifficultyAdjustmentService.decideTaskDifficulty`（档位由代码给，LLM 只出观测）→ `TaskDifficultyAdjustmentLedger` 留痕（`learner_evidence(evidenceType='task:difficulty:adjustment')`）+ `measureTaskDifficultyEffects`（A/B 对照）。
- **重排侧（已落地）**：`deriveReplanSignal` 出 `reasonCodes[]`（唯一召回门）→ `ReplanAttributionService.attribute`（新 skill `replan-attribution` 只在允许方向里选 + 一条可证伪断言）。
- **节奏侧（已落地）**：`derivePacing(lf,ktl)` → `slow|moderate|fast`；课内 `deriveLearningControlState` → `paceMode/challengeLevelCap`。
- **当日负担（已落地）**：`computeDayLoadFatigueBonus({lessons,minutes})` → `getAggregatedState().dayLoad.fatigueBonus`。
- **每日温故配额 + 顺延（已落地）**：`ReviewQuotaService`（UTC 日，默认上限 6.0，env `REVIEW_DAILY_LOAD_LIMIT`）——**本稿"负担顺延"的既有实现**。

### 6.5 负担 / 干预 评估矩阵（每天一行，来源全为既有产出）

| 评估维度 | 来源表 / 产出 | 字段 |
|---|---|---|
| 时间负担（计划/实学） | `goal_scheduling_ledger` | `budgetMinutes / consumedMinutes / loadAvg` |
| **当日总负担（已落地）** | `getAggregatedState().dayLoad` | `lessons / minutes / fatigueBonus` |
| **路径级 vs 全局（已落地）** | `getAggregatedState().perPath[]` | `perPath[].metrics`（按路径隔离） |
| 认知负荷（会话级） | `learning_metrics(metricType='session_load')` | `value`(均值) / `metadata.max` / `metadata.basisDist` |
| 任务级负荷档位 | `subtasks` | `estimatedMinutes / cognitiveLoad / status / completedAt` |
| 知识负荷（跨日） | `learning_metrics` + `restoreMetrics(asOf)` | `lss / ktl / lf / lsb` |
| 干预（课内） | 课堂事件历史 | `type='intervention'` + `occurredAt` + reason |
| 降载（回合级） | 会话消息 analysis | `loadIndex / loadBasis` |
| **难度调整（已落地）** | `learner_evidence(evidenceType='task:difficulty:adjustment')` | `baseline / adjusted / direction / reasons[] / applied` |
| **难度调整效果（已落地）** | `measureTaskDifficultyEffects` | 同类理由缓解率、`Δlsb`（执行组 vs 对照组） |
| **重排信号（已落地）** | `deriveReplanSignal` | `reasonCodes[]`（`fatigue_high` 等 7 类） |
| **重排归因（新 skill）** | `replan-attribution` 输出 | `primaryReasonCode / recommendation / claim / checkOn` |
| **每日温故额度（已落地）** | `learner_projections(scope='review-quota')` | `limitLoad / usedLoad / remainingLoad / reservedKeys` |
| 动态调整（记忆） | `buildReviewPlan(now=simulatedNow)` | `budget / usedLoad / backlogCount / successRate` |
| 动态调整（状态） | `restoreMetrics` | `ktl / lf` 衰减 |
| 节奏（已落地） | `derivePacing(lf,ktl)` | `slow / moderate / fast` |
| 预测校准 | `learning-predictor` + 实收 | `stallRisk / reliability` vs 任务结果 |
| 课后主观负荷 | `session-wrapup.evaluation` | `sessionLss / sessionKtl / sessionLf` |

---

## 七、技能层契约增补（v1 新增）

> 原则：**能不加字段就不加**；字段全走既有 input 通道，不改 Path 契约、不改 presets。skill 契约改动走现有编译流程（`compile-core-files.ts` → `ensure-core-agent-prompts --sync`），并过 `check-prompt-runtime-contract-metadata-parity.ts`。

### 7.1 新增统一输入 `temporalContext`（可选，缺省不注入 = 现网不变）

```jsonc
temporalContext: {
  "simulatedNow": "2026-09-18T09:00:00+08:00",
  "simulatedDay": "2026-09-18",
  "dayIndex": 4,                 // 会话内第几天（1-based）
  "timezone": "Asia/Shanghai",
  "sinceLastSessionDays": 2,     // 距上一次学习几天（无则 null）
  "daysOnTask": 1,               // 当前 task 已跨几天
  "streakDays": 4                // 连续学习天数（users.streakDays）
}
```

落点与约束：

| skill | 用途 | 约束 |
|---|---|---|
| `learn-turn-simulator` | 允许"隔了两天有点忘了"的自然引用 | **不改变** `epistemicGrounding` 判决 |
| `goal-dialogue-simulator` | 语境化"前阵子聊过/试过" | 不编造记忆外经历 |
| `path-evaluator` | 评估节奏是否可执行（每天能学多少） | 不改路径契约 |
| `memory-curator` | `memoryDelta` 带时间语义 | 概念仍须来自输入 |
| `session-wrapup` | `actionPlan` 的"下一次"锚定模拟日 | 数值仍须引用输入 |
| `adaptive-guidance-copy` | `paceHint` 反映第几天/负担 | 不指责、不制造愧疚 |
| `learning-predictor` | 跨日累积疲劳进 `stallRisk` | 证据不足仍取中值 |
| `learner-state-review` | `falsifiableClaims` 锚定模拟日 | 不用精确数值 |
| `replan-attribution` | `checkOn(next_lesson/next_task)` 锚定模拟日 | 不改召回门；方向取自 `allowedRecommendations` |

### 7.2 `learnerMemory` 增补时间维度

- `dueReview[]` 增加 `dueInDays`（距到期天数，负数=已逾期）或 `lastSeenDaysAgo`，让模拟器能说"这个学过快忘了"而非只有名单。
- `recentCompleted[]` 已有 `completedAt`，页面/模拟器可算出"几天前完成"。
- 实现：`buildLearnerMemorySnapshot(userId, { limit, now? })` 透传到 `getDueTraces(userId, { limit, now })`（`getDueTraces` **已支持 `now`**）；`dueAt` 已有列。

### 7.3 新增 `dayLoadContext`（给文案 / 预测 / 可解释性）

```jsonc
dayLoadContext: {
  "simulatedDay": "2026-09-18",
  "dayIndex": 4,
  "plannedMinutes": 45, "consumedMinutes": 38, "loadAvg": 0.52,
  "recentDays": [ { "dayIndex": 3, "plannedMinutes": 45, "consumedMinutes": 52, "avgLoadIndex": 0.71 } ],
  "reviewBudget": 2.0, "successRate": 0.86
}
```

落点：`adaptive-guidance-copy`（paceHint/warningCopy）、`learning-predictor`（stallRisk）、`session-wrapup`（叙事引用负担趋势）。
**注意**：`reviewBudget` 只作为可解释输入，**调度决策仍由 `review-plan` 代码算**（fsrs.ts 注释明确"调度是已解决的优化问题，不应交给 LLM"）。

### 7.4 `session-wrapup` 的 `reviewHints` 去墙钟

`loadRetrievabilityHints(userId, asOf = new Date())`；`buildReviewPlan`/`getDueTraces` 已有 `now`，一并透传。

### 7.5 明确"不改"的 skill（边界）

- `virtual-learner-epistemic-grounding`：**保持无时间**（硬约束）。
- `referee` / `actor-auditor`：可读取模拟时间戳做证据定位，但**不得把"时间推进"当作角色漂移/平台缺陷**（保真分不因跨日而降）。
- `concept-consolidator` / `concept-load-estimator`：无时间。
- `path-planning` / `presets.yaml`：不动。

### 7.6 落地的三处"必须与系统层对齐"的 skill 级细节

1. `buildAssistedLearnerMemory` / `buildAssistedKnowledgeSnapshot`（`simulation.memory.ts:44/66`）需要 `asOf` 透传，否则 `learn-turn` 引用的记忆是真实 `now`。
2. `recordCompletedArtifact`（`learner-memory.ts:361`）、`persistKnowledgeState`（`simulation.memory.ts:21`）、`writeProfileConceptsAfterLesson`（`learner-memory.ts:173`）的 `new Date()` → 业务时间戳用 `simulatedNow`。
3. `AITeachingCoordinator.loadRetrievabilityHints`（`:2867`）的 `new Date()`。

---

## 八、虚拟侧"日期模拟"设置与推进进度（v2 新增）

> 目标：把"日期模拟"做成**可配置、可观测、可重置**的虚拟侧能力，默认关闭，绝不影响真实用户。
> 原则：**复用现有 4 层设置存储，不新增表**；**进度字段只读、服务端唯一写者**。

### 8.1 设置分层（复用现有 4 层）

| 层 | 存储 | 现有字段 | 本次新增 | 语义 |
|---|---|---|---|---|
| 全局（平台级·虚拟侧） | `system.platform_settings` key=`virtualLab`（JSON，`virtual-lab-settings.service.ts`，30s runtime cache） | `virtualLearnerRpmLimit` | `dateSimulation{...}` | 默认值与护栏；**默认关** |
| 画像级 | `virtual_learner_profiles.profile`（JSON） | `simulationBudget` / `runtimePrefs` | `simulationClock{...}` | 该学习者的配置 + **进度快照** |
| 会话级（**权威时钟**） | `virtual_sessions.stageResults`（JSON） | `simulationConfig` | `simulationClock{...}`（C0 扩展） | 运行时真源 |
| 故事级（可选） | `profile.storyPool[i]` | `budget` | `pace?` | 故事节奏覆盖（呼应 `goalSeed.urgencyHint`） |

**解析优先级**（与 `resolveSessionBudget` 的 `story > profile > default` 三级同构）：
`session.simulationClock > story.pace > profile.simulationClock > global.dateSimulation > 代码默认`

> ⚠️ **单一真源**：会话级是**权威时钟**；画像级/全局只是**配置与默认**。页面读进度以会话级为准，画像级仅作汇总展示，避免双写漂移。

### 8.2 字段定义

**全局 `dateSimulation`**
```jsonc
{
  "enabled": false,               // 默认关 → 现网零变化
  "timezone": "Asia/Shanghai",    // 模拟时区（默认服务器本地）
  "defaultDailyMinutesCap": 45,   // 每日学习时长上限（分钟）
  "defaultDaysPerWeek": 5,        // 每周学习天数（0-7；0=不限）
  "defaultPaceDaysPerAdvance": 1, // 每次推进跨几个自然日
  "maxSimulatedDays": 90,         // 护栏：单会话最多模拟天数
  "pauseOnIntervention": false,   // 触发高优先级干预时暂停推进
  "autoAdvanceEnabled": false     // 批量/自动学习是否自动跨日
}
```

**画像级 `simulationClock`**（配置 + 进度快照）
```jsonc
{
  // ---- 配置（前端可写）----
  "enabled": null,               // null=跟随全局；true/false=覆盖
  "startDate": "2026-09-16",     // 模拟起点（默认创建日）
  "dailyMinutesCap": null,       // null=跟随全局
  "daysPerWeek": null,
  "paceDaysPerAdvance": null,
  "maxTotalDays": null,
  // ---- 进度（只读，服务端写）----
  "currentDayIndex": 4,
  "currentSimulatedDay": "2026-09-19",
  "advancedTimes": 4,
  "lastAdvancedAt": "2026-09-16T09:12:00+08:00"
}
```

**会话级 `simulationClock`**（权威，C0 扩展）
```jsonc
{
  "baseDate": "2026-09-16T09:00:00+08:00",
  "simulatedNow": "2026-09-19T09:00:00+08:00",
  "dayIndex": 4,
  "timezone": "Asia/Shanghai",
  "source": "virtual",
  "advancedTimes": 4,
  "history": [
    { "dayIndex": 1, "simulatedDay": "2026-09-16", "advancedAt": "...", "consumedMinutes": 38, "interventions": 0 }
  ]
}
```

### 8.3 "推进进度"口径（页面展示）

| 指标 | 来源 | 用途 |
|---|---|---|
| `currentDayIndex / maxTotalDays` | 会话级 / 配置 | 进度条（例：第 4 / 30 天） |
| `currentSimulatedDay` | 会话级 | 显示"当前模拟日期" |
| `advancedTimes` | 会话级 | 已推进次数 |
| 每日 `consumedMinutes / dailyMinutesCap` | C3 时间线 | 是否被"每日时长上限"截断（负担证据） |
| `history[].interventions` | 会话级 | 每天是否触发干预 |

### 8.4 API 变更（在 C2 接口族上扩展）

| 方法 | 路径 | 变更 |
|---|---|---|
| GET / PUT | `/settings` | `data.settings.dateSimulation`（全局默认）；PUT 只接配置字段 |
| GET | `/:id` | 增 `simulationClock`（画像级配置 + 进度快照） |
| PUT | `/:id` | 接 `body.simulationClock`（**仅配置字段**；进度字段忽略） |
| POST | `/:id/simulation-clock/reset` | **新增**：重置该学习者进度（起点/计数归零；不回改已写时间戳） |
| PUT | `/sessions/:id/simulation-config` | 扩展 `simulationClock`（会话级覆盖配置） |
| GET | `/`（列表） | 每条增 `simulationClock: { enabled, currentDayIndex, maxTotalDays, currentSimulatedDay }`，供列表进度列 |

> 幂等/越权：**进度字段服务端唯一写者**，前端 PUT 携带进度字段一律忽略；`reset` 写 `admin_audit_logs`。

### 8.5 UI 落点

- **`VirtualLearners.vue`**：`VL RPM`（`:98-101`）旁新增 **"日期模拟"设置区**（开关 + 每日时长上限 + 每周天数 + 每次推进天数）；列表新增 **"模拟进度"列**（第 N/上限 天 + 进度条 + 当前模拟日）。
- **`VirtualProfile.vue`**：`画像与运行预算` tab（现 `budgetForm`，`:120-155`）新增 **"日期模拟"区块**（enabled / startDate / dailyMinutesCap / daysPerWeek / paceDaysPerAdvance / maxTotalDays + 进度只读 + 重置按钮）；`日程` tab（3.3）顶部显示进度。
- **`SessionCockpit.vue`**：会话级模拟日覆盖 + 进度徽章（与 3.4 的第 N 天徽章同源）。
- **`BatchExperiments.vue`**：实验级"统一起点 / 每次推进天数"，用于多学习者**对齐到同一天**做横向对比。

### 8.6 与现有设置的区别（避免混淆）

| 设置 | 含义 | 与日期模拟的关系 |
|---|---|---|
| `simulationBudget.maxRetriesPerStep/maxRetriesTotal` | **AI 调用成本**预算 | 正交（控制成本，不控制时长） |
| `runtimePrefs.turnCapPerLesson` | 每课**回合**上限 | 正交（控制单课长度，不控制每天几课） |
| `virtualLearnerRpmLimit` | 虚拟侧**出站速率** | 正交（控制并发/速率） |
| `dailyMinutesCap`（新） | 每日**学习时长**上限 | 本稿新增，用于负担评估与顺延 |
| `REVIEW_DAILY_LOAD_LIMIT`（已有，env） | 每日**温故负担**上限（默认 6.0 负担单位，`ReviewQuotaService`） | 已有；属"每日额度"族，建议与 `dailyMinutesCap` 在设置页并列展示 |

### 8.7 默认与安全

- `enabled=false` 默认 → **现网零变化**；只有 `isVirtualLearner = 1` 且 `enabled=true` 的会话才推进。
- 设置变更**不回改**已写时间戳；`reset` 只影响后续推进。
- 数值全部走 `normalizeVirtualLabSettings` 同款 clamp（防手误写超大值）。

### 8.8 重放方向决议：过去锚点 + 向前推进（v4）

**结论：采用"过去锚点 + 向前推进"（历史重放）。** 实证依据（按证据强度）：

1. **隔离性由 `asOf` 上界决定**：`buildCommittedMetricWhere` 的窗口是 `calculatedAt: { gte: since, lte: asOf }`（`learning-state.service.ts:399-401`）。
   - 写过去：`asOf` 早于任何真实行 → 真实行被 `lte: asOf` 天然排除 → **仿真封闭**。
   - 写未来：`asOf` 晚于真实行 → **真实历史全部被卷入**，仿真不封闭（除非再加 `baseDate` 下界，属额外改造）。
2. **默认读取可见性**：现存读路径都默认 `asOf = new Date()`（`ai-teaching.routes.ts:846 getCurrentState(userId)`、`state-tracking.routes.ts:27`；虚拟画像/记忆池同理）。
   - 写过去：仿真行 `calculatedAt <= now`，**立即被看到**（虚拟学习者的"历史"本就该可见）。
   - 写未来：仿真行 `calculatedAt > now`，默认读取**看不到** → 记忆池/聚合/画像全空，必须给每条读路径显式传未来 `asOf`。
3. **时间倒挂**：写未来时 `createdAt/updatedAt`（Prisma 真墙钟）< 业务时间戳；`teaching_sessions.duration = Date.now() - startTime` 会为负；`streak`（`learning.service.ts:4292`）、`goal_scheduling_ledger.date`（`:1625`）、`ReviewQuotaService.quotaDateKey` 均按真实 now / UTC 日 → 语义错位。写过去则"真墙钟 ≥ 业务时间戳"，与真实数据同构。
4. **守卫不受影响**：`session-reclaim.service.ts` 按 `updatedAt`（真墙钟）判 stale，两向都不被业务时间戳影响；但写未来会与"未来日期"叠加出混乱。
5. **已被实现并加固**：`9c3fd45` 明确选择"过去日期"以实现封闭仿真，并修复了 `getPreviousMetrics` 缺 `asOf` 导致"历史重放算错衰减"的真实 bug；`simulate-learner-days.test.ts` 已在跑。
6. **理论支持**：`doc/LEARNER_STATE_REVIEW_DESIGN.md` 引用的 EduClaw-Bench（2026）即"30 天长程、KT 驱动模拟学习者"——长程仿真标准做法是**回放**，不是写未来。

**精确表述（避免"向后 vs 向前"的伪对立）**：
- **推进顺序**永远**向前**（day0→day1→…），否则模拟不出"负担随天数累积"；
- **日历锚点**固定在**过去**（`baseDate = now - horizon`），推进到末尾≈今天，**不进入未来**。

**落法**：`simulationClock.baseDate` 由系统层按 `now - maxTotalDays` 自动生成（画像级可覆盖）；`advance-day` 在**模拟顺序上 +1**，日历写入 `baseDate + dayIndex`。

**纯"未来推进"何时才考虑**：仅当产品要"预演未来学习计划"（plan preview）。届时必须同时：(a) 每条读路径显式传未来 `asOf`；(b) 聚合加 `baseDate` 下界过滤防卷真实行；(c) 审计/运维列与业务列分离。当前读模型不满足，成本高收益低 → **暂不做**。

### 8.9 每日负担设置是否合并：不合并，做成分组（v4）

**结论：不合并，做"每日负担"设置组，各字段独立映射既有公式。**

| 字段 | 量纲 | 映射的既有公式 | 现状 |
|---|---|---|---|
| `dailyMinutesCap` | 分钟 | 时长侧（`dayLoad.minutes`） | 新增 |
| `maxLessonsPerDay`（可选） | 节数 | `dayLoad.lessons` → `computeDayLoadFatigueBonus` | 新增 |
| `REVIEW_DAILY_LOAD_LIMIT` | 负担单位（默认 6.0） | `ReviewQuotaService`（3 课 × 2.0） | 已有（env） |

理由：三者量纲与公式都不同（`computeDayLoadFatigueBonus` 吃 `lessons+minutes`；复习配额吃"负担单位"），合并会破坏"档位由代码给"的纪律，且要动两处既有公式与测试。设置页并列展示即可（见 8.6 最后一行）。

---

## 九、风险与未决问题

1. **日界（已定案 UTC，2026-09-16）**：系统层 `700b718` 已把学习状态自然衰减统一到 **UTC 日界**，与 `getAggregatedState.dayLoad` / `ReviewQuotaService` / `resolveDayWindow` **四口径合一**；`fcf651b` 进一步把日期模拟脚手架切到本稿的 `resolveDayWindow` 作为规范助手。本稿据此对齐（早前的"建议本地日界"作废）。
2. **一次会话=一次跑完**：`autopilot` 现在一口气跑 goal→path→learn；跨日续跑需要新的调度切口（系统层负责）。页面只消费结果，不假设调度方式。
3. **成本**：跨 N 天推进 = N 倍 LLM 调用；需复用 `session-budget` 的 `costCeiling/noProgressChunkLimit` 做护栏。
4. **"负担"口径待定**：`consumedMinutes`（实际）vs `estimatedMinutes`（预估）vs `cognitiveLoad`（档位）三种口径在意义上是不同的。建议页面同时给"时间口径"（分钟）与"认知口径"（load/档位），不混成一根线。
5. **`simulatedNow` 与真实 `createdAt/updatedAt`**：Prisma 自动列仍用真墙钟（用于运维/审计），模拟时间只进业务时间戳。两者在 UI 上要明确区分标签。
6. **能力悖论（ESS）不能被时间注入放松**：`epistemic-grounding` 判决与 persona 掌握度的一致性由 `actor-auditor` 审计；时间只影响叙事与节奏，不得让"隔了几天"变成"突然会了"或"突然全忘"。
7. **"跨日"语义目前只能表达"到期"**：`learnerMemory.dueReview` 没有"几天前"，需要 7.2 的时间维度补充；否则模拟器说"上次学过"没有时间感。
8. **`generateIntervention` 死代码**：要么删除，要么接线；在接线前，页面/评估一律以 C3 列出的真实产出为准。
9. **双时钟源**：会话级是权威时钟，画像/全局只是配置。页面读进度必须走会话级（或后端汇总），不得把画像级 `simulationClock` 当权威，否则多会话并行时会漂移。
10. **设置越权**：`simulationClock` 进度字段只能由服务端写；前端 PUT 携带进度字段必须显式忽略，避免前端手改造成双写。
11. **重放方向（已定 v4）**：采用"**过去锚点 + 向前推进**"（见 §8.8）。若将来要做"未来预演"，须先满足 §8.8 末段三条件；`createdAt/updatedAt` 等审计/运维列保持真墙钟，业务时间戳用模拟时间。
12. **不要重复造负担口径**：`getAggregatedState().dayLoad.fatigueBonus`、`deriveReplanSignal.reasonCodes`、`decideTaskDifficulty.reasons`、`ReviewQuotaService` 已是权威口径；页面/设置**不得自建平行定义**，否则"评估负担变化"会两套数。

---

## 十、变更记录

- 2026-09-15 v0：首版（调查后落地设计稿 + 契约）；粒度=自然日；范围=仅设计稿。
- 2026-09-15 v1：补充"相关 skill 实现摸底"（两条技能族 / 4 条时间通道 / ESS 硬约束 / 干预真实落点 / 评估矩阵）与"技能层契约增补"（`temporalContext`、`learnerMemory` 时间维度、`dayLoadContext`、`reviewHints` 去墙钟、不改边界）；更正 C3 中 `generateIntervention` 为死代码。
- 2026-09-16 v2：新增"虚拟侧日期模拟设置与推进进度"（4 层设置复用、`dateSimulation`/`simulationClock` 字段、进度口径、API 与 UI 落点、与现有设置的区别、默认关闭与安全）。
- 2026-09-16 v3：对齐系统层已落地实现——C4 记录"历史日期重放（可指定 `timestamp` + `asOf` 读取）"机制与全部读写缝（`getAggregatedState` / `computeDayLoadFatigueBonus` / `derivePacing` / `deriveLearningControlState` / `deriveReplanSignal` / `decideTaskDifficulty` / `ReviewQuotaService` / `simulate-learner-days.ts`）；技能表补入新 skill `replan-attribution` 及 learner aux 族；6.4/6.5 改为真实信号口径；8.6 补 `REVIEW_DAILY_LOAD_LIMIT`；新增风险 11（重放方向）/12（不得重复造负担口径）。
- 2026-09-16 v4：**重放方向决议**（§8.8：过去锚点 + 向前推进；含 6 条实证依据与"未来推进"的准入条件）；**每日负担设置不合并、做成分组**（§8.9）；C4/风险 11 更新为已定结论。
- 2026-09-16 v5：C2 改为**重放式定义**（`advance-day` = 写 `baseDate + dayIndex`，读 `asOf`，来源全部指向 C4 已落地读写缝）；新增"**分期落地与待做清单（TODO）**"（§四：A 系统层 / B 技能层 / C 后端接口 / D 前端 / E 设置 / F 测试 / G 明确不做，含 `[x]` 已完成标记）；测试章节补重放语义测试口径；标题与状态更新为 v5。
- 2026-09-16 v6：补**端到端验证**（§十一）——可丢弃学习者跑通 `advance-day runTasks=true`，实证业务时间戳落模拟日、行创建时间留真墙钟；并据此修掉"评审未进入 Learn 却推进（烧模拟日）"缺陷（`9ebb514`）。
- 2026-09-16 v7：**完整验证（跑到任务结算）**（§11.1）——发现结算类写入点落真墙钟（`subtasks.completedAt` / `endTime` / 指标 / 完成类 evidence / 课堂事件），根因 `completeTask` 的 `completedAt = new Date()` 忽略 `asOf`；已修（`3297703`）并加确定性单测 + 接线守卫。
- 2026-09-16 v8：**「第一个里程碑没有可用任务」根因定位**（§11.2）——非"没生成"，而是子任务由后台异步产出（不 await）+ 「删路径重建」的错误补救；已改为按生成状态处置（`9bda3e7`）。
- 2026-09-17 v9：**推进并上课空烧模拟日**（§11.3）——零节成功仍 `started:true` → 白推一天；改为 `summarizeDayLearning` 判定（`d39cf17`）。

---

## 十一、端到端验证（可丢弃虚拟学习者 · 2026-09-16）

**做法**：新建可丢弃画像（手工故事，省一次 LLM）→ 会话级开时钟（`baseDate=2026-01-05`，**不动**全局 `enabled=false`）→ `step` 驱动 goal（6 步）→ `advance-day runTasks=true`；临时把全局 `lessonsPerDay` 降到 1（事后恢复）；验证后删画像（级联清会话/用户，残留全 0）。

**结论（业务时间 vs 行创建时间）**：

| 表.字段 | 值 | 判定 |
|---|---|---|
| `teaching_sessions.startTime` | `2026-01-06T23:59:59.999Z` | 模拟日 ✅ |
| `memory_traces.lastSeenAt` | `2026-01-06T23:59:59.999Z` | 模拟日 ✅ |
| `memory_traces.dueAt` | `2026-01-07T23:59:59.999Z` | 由模拟日推导 ✅ |
| `teaching_sessions.createdAt` | `2026-09-16T14:31:00Z` | 真墙钟（DB 默认，未 mock 时钟）✅ |

→ AsyncLocalStorage 模拟时钟**经真实 HTTP 路由端到端生效**；`day-timeline` 在模拟日窗口读到 2 条记忆痕迹。

**未观测到**（当天未跑到任务完成）：`learning_metrics`、`learner-memory.recordCompletedArtifact`、课堂 `duration`——留待更长课时验证。

**发现并已修（`9ebb514`）**：`decision=modify` 且重规划成功时，`resolvePathReview` 返回 `success:true` 但 `currentStage` 仍为 `path`（当天没上课）；`runDayLearning` 只判 `success` → `advance-day` 报成功、时钟已推进，当天却无任何教学产物（**烧掉一个模拟日**，`reverted` 也不触发）。修复：纯函数 `resolutionEnteredLearn`（仅 `teaching/learn` 算"这天上了课"），未进入 Learn 即 `started:false` → 路由回滚时钟。

**残留（未修，非 P0）**：进入 teaching 后若当课全部失败（LLM 抖动），仍 `started:true, chunks:1` 记账一天；`chunks` 是"尝试次数"而非"成功课数"。

### 11.1 完整验证（跑到任务结算）与修复（`3297703`）

第二次跑到**任务完成**（同法，可丢弃学习者），首次覆盖结算类写入点，暴露**真墙钟写入**：

| 写入点 | 修复前 | 修复后 |
|---|---|---|
| `subtasks.completedAt` | ❌ 真墙钟 | ✅ 模拟日 |
| `teaching_sessions.endTime` | ❌ 真墙钟 | ✅ 模拟日 |
| `learning_metrics.recordedAt/calculatedAt` | ❌ 真墙钟 | ✅ 模拟日（随 task:completed 事件）|
| 完成类 `learner_evidence.occurredAt` | ❌ 真墙钟 | ✅ 模拟日 |
| 课堂事件 `occurredAt` | ❌ 真墙钟 | ✅ 模拟日 |
| `users.streakLastDate` / `goal_scheduling_ledger.date` | ✅（asOf）| ✅ |

根因：`learning.service.completeTask` 的 `const completedAt = new Date()` 忽略了已传入的 `asOf`（台账/streak 用了 asOf，主时间戳没用）；`TeachingSessionRepository` / `AITeachingCoordinator` 的 `endTime` 用 `new Date()`。

下游可见错误：`day-timeline` 按模拟日窗口聚合 `completedAt`，故**已完成的课在所有模拟日都显示为空**。

修复：统一 `simulatedNowOr()` / `data.asOf`（无模拟上下文自动回落真墙钟 → 现网不变）。测试：`learning.complete-task` 加 `asOf` 确定性断言；`simulation-clock-wiring.audit` 加守卫（`endTime: new Date()` 不得再出现）。

**验证局限**：完整 E2E 受路径质量影响不稳定（本轮曾卡在「第一个里程碑没有可用任务（重生成后仍为空）」，`MAX_PATH_REGENERATIONS=1` 用尽即秒失败——属路径生成侧，非时钟链路）；故结算口径另用**确定性单测**固化。

### 11.2 「第一个里程碑没有可用任务」根因与修复（`9bda3e7`）

**根因不是「任务没生成出来需要重生成」**，而是异步竞态 + 错误补救叠加：

1. **异步竞态**：`generateLearningPath` 只是建骨架，子任务由「阶段设计」**后台**产出
   （`runBackgroundTask('learning.path.stage-enrichment', …)` **不 await**）。
   调用方（`advance-day runTasks` / `startLearningPhase`）在骨架就绪后立刻查「可启动子任务」→ 读到空。
2. **错误补救**：原「空子任务补救」此时调 `restartPathPhase`（`learning_paths.delete` + 重新生成），三重有害：
   - 重启同一竞态（下一轮仍在生成窗口内，仍为空）；
   - 删路径留下**孤儿里程碑**（库中实测：3 条路径共 11 个零子任务里程碑，其中 1 条 path 行已不存在）；
   - 烧掉唯一重试预算（`MAX_PATH_REGENERATIONS=1`）→ 直接抛「需人工介入」。

另有一类**永久空**：回填走 `replace-tasks` 被 `assertPathMutationSafe` 拦下
（`PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE`，`stageDesignRetryCount=3` 全部被拒）——
路径已有完成课堂记录时不得删改任务。

**修复**：不再删路径，改用既有生成状态机 `learningService.retryPathEnrichment(pathId,userId)`：
仍在生成 → 如实上报「未就绪」（调用方稍后重试）；确实 `failed/stale` → 触发官方阶段设计重试
（同一 Path 重跑 stage-designer）。移除 `MAX_PATH_REGENERATIONS`；新增会话日志
`path-enrichment-not-ready`（含 `notReadyReason` / `retryTriggered`）。行为级测试锁定「绝不 `learning_paths.delete`」。

### 11.3 「推进并上课」空烧模拟日与修复（`d39cf17`）

E2E 复现：会话转 `failed` 后 `executeAutoLearning` 立即返回失败，而 `runDayLearning` 仍报
`started:true, chunks:1`（`chunks` 记的是"尝试次数"）→ `advance-day` 报成功、时钟照推，
当天却没有任何教学产物（实测连续两轮各 0 秒"烧掉" `2026-02-06` / `2026-02-09`）。

修复：纯函数 `summarizeDayLearning`——只有"**至少一节课成功**"才算这天被用掉；零成功 →
`started:false`（路由回滚时钟 `reverted:true`），`chunks` 只数成功课次。

**本轮 E2E 的边界**：三次完整 E2E 均**未跑到任务结算**——第 1 次遇上路径评审 `modify`+重生成；
第 2 次卡在空子任务（已修，§11.2）；第 3 次已真正上课（3 轮对话、AI 判"任务完成"、learner
`ready_to_close`），但在**上游 LLM 重试耗尽**时中断（`Learn 上游调用重试耗尽` → 会话 failed），
结算未发生。故结算口径以**确定性单测**为准（§11.1），E2E 作集成证据。

### 11.4 追加式补齐全链路验证（`87efa46` / `a5915ed` / `232e6f1`）

- **只读**：两条真实卡死路径 `replace-tasks` 被 `PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE` 拦下，
  `append-tasks` 放行（契约要求"必须限定到空白阶段 + 只创建不删除"）。
- **实跑**（后台自愈环 `retryEligibleFailedPathPreparations`，60s 轮询）：`lp_1788527568886_4pu9qy1`
  （基础理财规划入门）由**全阶段 0 任务** → `s1:5 / s2:5 / s3:6 / s4:5`，`stageDesign=succeeded`（appendCount=2），
  期间**未删除任何既有数据**；另一条 `lp_1788440710958_2l6k633` 首轮遇上游 `PATH_ENRICHMENT_FAILED`
  （非变更冲突），将在其独立预算内自动重试。

**关键设计**：追加通道有**独立预算** `stageDesignAppendCount`（不被 replace 的终止码"顶满"拖累）；
自愈环选路 `useReplace = canReplace && replace 预算未耗尽`，否则只要存在空白阶段即走追加；
生成在途一律不追加（避免与在途生成重复）。

---

## 十二、autopilot 状态自愈与 `virtual_sessions.status` 同步（2026-09-17 · `44f614c`）

**用户报告**：① autopilot 状态无启动自愈（重启后遗留）；② `autopilot.status` 与 `virtual_sessions.status` 不同步。

**同一根因（实测）**：`reconcileStaleRuns` 的查询**排除了终态会话**（`status notIn ['completed','failed','abandoned']`），
于是「`session=failed` + `autopilot=running/queued`」的僵尸态**永远不被自愈**——库中实测 2 条
（`0d9a5c7b` / `33e600ce`，2026-09-10 遗留）。而列表接口把 `stageResults.autopilot.status` 直接当
`autopilotStatus` 返回，于是**一个 failed 会话显示「运行中」**，与 session 状态自相矛盾。

**修复**：
- `reconcileStaleRuns` 不再排除终态会话；**进程内正在跑的**（`runningSessions`/`pendingQueue`）一律跳过
  → 因此可安全周期执行。终态会话收敛为匹配终态（completed→completed / failed→failed /
  abandoned→incomplete，并清 `queuePosition`、`stopRequested`）；非终态仍复位 `idle`（原语义不变）。
- 新增**周期对账** `startReconcileScheduler`（5min，unref），`index.ts` 启动注册、优雅关闭停止——
  运行期错位也能在 1 个周期内收敛，不只依赖重启。

**实测**：重启对账后 `2 session=failed | autopilot=running` → `autopilot=failed`；僵尸数 0、终态但 autopilot 活跃 0；
接口 `sessionStats.running=0`、`autopilotConcurrency.used=0`。

**仍存的设计角（当前 0 例，未改）**：manual 模式会话（无 autopilot）在重启后仍为 `running`，由
24h 僵尸回收兜底；`autopilot=stopped`（用户暂停）时 session 仍 `running`，由列表页按「已暂停」口径显示——
这两处是既有刻意的口径映射，如需更严可另行收紧。
