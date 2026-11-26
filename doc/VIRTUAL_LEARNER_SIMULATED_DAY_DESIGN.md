# 虚拟学习者 · 日期模拟与学习负担评估

> 📌 类型：设计方案（日期模拟的语义、系统层契约、页面落点与学习负担口径）｜索引见 [doc/README.md](./README.md)。

> **定位**：定义"学习分散在各自然天"的仿真语义、系统层契约与页面落点；不改 Path 契约、不改 session/profile schema。
> **粒度**：按自然日；推进方向：**过去锚点 + 向前推进（历史重放）**（§8.8）。
> **现行实现**：日期重放脚手架、`advance-day` 写路径（`backend/src/routes/admin/virtual-learners.ts:3239`）、会话级 `simulationClock`、按天时间线与座舱徽章（`backend/src/services/virtual-lab/simulated-day.service.ts`）；技能层时间维度与部分页面未实现（§6.2、§8.5、§9.2）。
> **关联**：`doc/VIRTUAL_LEARNER_CHAIN.md`、`doc/LEARNER_STATE_REVIEW_DESIGN.md`。

---

## 〇、范围与不变式

**本稿负责**：日期模拟的语义定义、系统层 ↔ 页面层的数据契约、页面信息架构与现行实现口径。
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
| 模拟日（simulated day） | 一个自然日，`YYYY-MM-DD`（**本地时区日界**） | `getTodaySchedule` 本地日界（`learning.service.ts:1542`） |
| `simulatedNow` | 该模拟日内的一个时间点（ISO），推进时锚定到 **09:00 active window** | `memory-trace.service.ts:150` `ACTIVE_START_HOUR = 9` |
| `dayIndex` | 相对会话起点的**已推进天数**，0-based；`0` = 会话启动日（尚未推进），推进 N 个上课日后日历 = `baseDate + dayIndex`；页面显示「第 `dayIndex + 1` 天」 | 新增（JSON） |
| 睡眠周期 | 23:00–07:00；**首次提取/首次复习必须跨 ≥1 个睡眠周期** | `memory-trace.service.ts:146-171`；Rasch & Born 2013 / Gais 2006 |
| 学习负担（当日） | 当日 `consumedMinutes`（实学）与 `plannedMinutes`（计划）的对比，辅以 `loadAvg` 与 `LSS/KTL/LF` | `goal_scheduling_ledger`、`learning_metrics` |
| 系统干预 | `InterventionDecision{type, priority, content, reasoning}`（仅类型定义；`generateIntervention` 不存在） | `learning-state-advisor.ts:39` |
| 动态调整 | 复习负担预算随成功率回校准（1.0 / 2.0 / 3.0） | `review-plan.service.ts:85`，Bjork 有益困难 ~85% |

**推进语义**：`advance-day(+1)` = **模拟顺序**前进一天（dayIndex+1），日历写入 `baseDate + dayIndex`（锚点在过去，见 §8.8）；当日（可选）执行分配的 task，全部业务时间戳（课堂、记忆、证据、画像最近完成）均使用该模拟日。

---

## 二、系统层契约（由系统层实现，页面只消费）

### C0. 时钟存储（JSON，免改 schema）

```jsonc
// virtual_sessions.stageResults.simulationClock
{
  "baseDate": "2026-09-15T09:00:00.000+08:00",  // 会话启动的真实日期
  "simulatedNow": "2026-09-19T09:00:00.000+08:00",  // 日历 = baseDate + dayIndex
  "dayIndex": 4,
  "timezone": "Asia/Shanghai",
  "source": "virtual"          // 设计稿字段（代码未实现）：真实写入无 source
}
```

- 实验级统一时钟（可选）：`batch_experiment_runs` 增加 JSON 字段或复用 `checkpoints`，用于"多个学习者同一天推进"的横向对比。

### C1. 时间读取点的 `asOf/now` 注入

时间读取点统一经环境模拟钟注入：写入与读取用 `simulatedNowOr()`（AsyncLocalStorage 携带 `asOf`），无模拟上下文时等价 `new Date()`，现网行为不变（`virtual-lab/simulation-clock-context.ts`）。读写缝清单见 C4。

### C2. 建议接口（统一前缀 `/api/admin/virtual-learners`，与现有风格一致）

#### ① 读时钟
```
GET /sessions/:sessionId/simulation-clock
→ { baseDate, simulatedNow, simulatedDay, dayIndex, timezone, status }
```
> 实现口径：实际返回 `SimulationClockView`——`{ enabled, status, timezone, baseDate, dayIndex, simulatedNow, maxSimulatedDays, autoAdvance, courseWeekdays, lessonsPerDay }`（`simulated-day.service.ts:45-60`）；其中 **无 `simulatedDay`**，上限字段名是 `maxSimulatedDays`（来自全局设置）。`simulatedDay` 属于按天时间线条目（C2③）。

#### ② 跨日推进 = 历史重放（写；系统层实现，页面调用）

> 机制（§8.8）：**不做 mock 时钟**。把"第 `dayIndex` 天的第 K 节课"用 `timestamp = baseDate + dayIndex` 写进既有真实表（`updateLearningMetrics({timestamp})`、`subtasks.completedAt`、`teaching_sessions.startTime/endTime`、`learner_evidence.occurredAt`），读取侧一律按 `asOf = baseDate + dayIndex` 读回。日历锚点在过去（实际取**会话创建日**为 `baseDate`，见 §8.8），推进到末尾≈今天。

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
    // ↓ 全部来自现行读写缝（C4），不新造口径
    dayLoad: { lessons, minutes, fatigueBonus },                    // ← getAggregatedState(asOf).dayLoad
    metrics: { lss, ktl, lf, lsb },                                 // ← getAggregatedState(asOf).metrics
    perPath: [{ pathId, metrics }],                                 // ← getAggregatedState(asOf).perPath
    tasks: [{ taskId, title, estimatedMinutes, actualMinutes, cognitiveLoad, status }], // ← subtasks + teaching_sessions
    interventions: [{ type, reason, at }],                          // ← determineNextStage='intervention' / loadIndex 三路由
    difficultyAdjustments: [{ baseline, adjusted, direction, reasons, applied }], // ← learner_evidence(task:difficulty:adjustment)
    replanSignal: { reasonCodes, primaryReasonCode, recommendation },// ← deriveReplanSignal + teaching-replan-attribution
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
    replanSignal: { reasonCodes, primaryReasonCode, recommendation },              // ← deriveReplanSignal + teaching-replan-attribution
    reviewQuota: { limitLoad, usedLoad, remainingLoad },                            // ← ReviewQuotaService
    memory: { dueCount, avgRetention, fragileCount }                                // ← getDueTraces(asOf)/getRetentionSnapshot(asOf)
  }]
}
```
> 页面**只读**此接口即可画时间线 + 负担曲线 + 干预清单；聚合口径全部来自现行读写缝（C4），**不新增实体、不自造口径**（风险 12）。

#### ④ 跨学习者对比（读；批量实验用）
```
GET /api/admin/batch-experiments/:experimentId/day-timeline?metric=burden|intervention
→ { learners: [{ runId, name, days: [ /* 同 C2③.day */ ] }] }
```
> 此接口未实现（无批量实验页，运行态在「虚拟学习者」页）；按天时间线只有会话级 C2③。

### C3. 干预与动态调整的"落点"（供聚合读取，不新增表）

> **`generateIntervention` 不存在于代码**；`InterventionDecision` 仅作为类型定义保留在 `learning-state-advisor.ts:39`，不能作为聚合来源。真正的"干预/动态调整"在授课链的阶段路由与技能内三路由（详见 §6.4）。

按可定位证据聚合（**全部是既有产出，不新增埋点**）：

- **课内干预（阶段路由）**：`AITeachingCoordinator.determineNextStage`（`:510-560`）进入 `stage='intervention'` 的事件，落在课堂事件历史（`buildClassroomEvent`，`:471`，含 `occurredAt`）。触发条件：`understanding<0.35 / emotion=frustrated / confusionPoints≥2 / (loadIndex>0.85 且 understanding<0.6) / (θ−d `ktStruggle` 且 understanding<0.6)`。
- **课内降载（技能内三路由）**：`teaching-turn` 的 `analysis.loadIndex` 阈值（<0.3 加难度 / 0.6–0.8 最小提示 / >0.85 拆步降载）+ `loadBasis`。
- **会话负荷聚合**：`commitSessionLoadMetric`（`AITeachingCoordinator.ts:964`）以 `metricType='session_load'`（`sourceKey=session-load:{sessionId}`）幂等写 `learning_metrics.metadata={max, basisDist, perTurnCount}`。
- **课后评估**：`teaching-wrapup` 的 `evaluation.sessionLss/sessionKtl/sessionLf` + `metricMetadata`（标注为间接推断）。
- **动态调整（记忆侧）**：`review-plan.computeLoadBudget` 的 `budget` 序列（1.0/2.0/3.0，按成功率回校准）。
- **动态调整（状态侧）**：KTL/LF 的**按天日负荷 EWMA**（`learning-load.pmc.ts`，权威时钟）——当日负荷 = 该日各节课 `lss` 之和，空闲日以 0 参与（即自然回落）。
- **教师侧微调**：`teaching-turn` 开场消费 `scenario.learnerPrediction`（`stallRisk/reliability`）与 `behavioralProfile`。
- **负担顺延**：当 `consumedMinutes + nextTaskEstimated > maxMinutesPerDay` 时，系统层把任务留到次日（本稿只要求接口能表达"顺延"，具体策略由系统层定）。

### C4. 系统层读写缝

> **实现机制**：系统层采用**历史日期重放**（不是 mock 时钟）：把"第 N 天的第 K 节课"用**可指定的 `timestamp`** 写进 `learning_metrics`（`updateLearningMetrics({timestamp}) → asOf → metrics.timestamp → calculatedAt`），读取侧按 `asOf` 过滤，即可在**真实代码路径**上重放历史。验证器：`backend/src/scripts/simulate-learner-days.ts`（6 条断言）+ `simulate-learner-days.test.ts`。

读写缝（**页面直接消费，不要再造**）：

| 能力 | 位置 | 产出 |
|---|---|---|
| 全局聚合（按 `asOf`） | `learningStateService.getAggregatedState(userId,{asOf})` | `{metrics, perPath[], dayLoad:{lessons,minutes,fatigueBonus}}`（`metrics`/`perPath` 为 PMC 日负荷重放；`dayLoad` 为**原始观测**，`fatigueBonus` 恒 0，不再叠加进 lf） |
| 路径级状态 | `learningStateService.getCurrentState(userId,{pathId,asOf})` | `metrics`（PMC 重放） |
| 当日课量（原始观测） | `computeDayLoadFatigueBonus({lessons,minutes})` | `fatigueBonus`（沿用旧算法只为观测；PMC 已把同日多课求和进 KTL/LF，此值不再进 lf） |
| 节奏 | `LearnerSnapshotService.derivePacing(lf,ktl)` | `slow\|moderate\|fast` |
| 课内控制状态 | `deriveLearningControlState(...)` | `paceMode / challengeLevelCap / conceptLoad` |
| 重排召回信号 | `deriveReplanSignal(...)` | `reasonCodes[]`：`fatigue_high / lsb_negative / recent_trend_declining / fragile_concepts / struggling_concepts / blocked_foundations / prerequisite_gaps` |
| 任务级难度调整 | `TaskDifficultyAdjustmentService.decideTaskDifficulty(...)` | `{baseline, adjusted, direction, reasons[], cap, capSource, evidence}` |
| 调整留痕 / 效果度量 | `TaskDifficultyAdjustmentLedger` | `learner_evidence(evidenceType='task:difficulty:adjustment')`；`measureTaskDifficultyEffects`（对照 vs 执行） |
| 每日温故配额 + 顺延 | `ReviewQuotaService`（`learner_projections(scope='review-quota')`，UTC 日，默认上限 6.0，env `REVIEW_DAILY_LOAD_LIMIT`） | `{limitLoad, usedLoad, remainingLoad, reservedKeys}` |
| 指标写入可指定时间 | `updateLearningMetrics({timestamp})` | `learning_metrics.calculatedAt` |
| 日期重放验证器 | `backend/src/scripts/simulate-learner-days.ts` | 6 条断言（路径隔离 / 总负担 / 信号区分 / 难度调整 / 效果度量） |

**对本稿的影响**：
- C1 的"注入 `asOf`"多数已具备；C2 的"跨日推进"可直接复用 `updateLearningMetrics({timestamp})` 做重放，**不必新造时钟**。
- 页面"日程 tab"应直接读 `getAggregatedState({asOf})` / `deriveReplanSignal` / `deriveLearningControlState`，而不是自造负担与干预口径。
- **已定**：采用 **"过去锚点 + 向前推进"（历史重放）**。理由与实证见 §8.8。验证器 `simulate-learner-days.ts` 即此法；`getPreviousMetrics` 已接受 `asOf`。

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

无此页面：运行态在「虚拟学习者」页，按天时间线只有会话级（C2③）；「衰减 / 跨日推进 / 按天横向对比」不在页面范围内。

### 3.6 运维中心 `OpsCenter.vue`（可选）

- 现有 **时间推进**（`adminDevtoolsApi.advanceTime`，只读预览，`OpsCenter.vue:234`）保留。
- 可加"跳转到该虚拟学习者的日程页"，形成"预览 → 落到具体会话"的闭环。

---

## 四、时间注入的现行实现

业务时间戳与时间读取统一经环境模拟钟注入：`advance-day` 的 `runTasks` 分支用 `runWithSimulatedClock(asOf, …)` 建立 AsyncLocalStorage 上下文，写入/读取点用 `simulatedNowOr()` 取值；无模拟上下文时等价 `new Date()`，现网行为不变（`virtual-lab/simulation-clock-context.ts`）。读写缝与重放机制见 C4、§8.8；实现范围见 §8.5，未定项见 §9.2。

---

## 六、相关 skill 的时间感知

覆盖：`prompts/core/*.yaml`（core 文件，prompt 真源）+ `prompts/skill.*.md`（编译产物）+ `backend/src/skills/**` handler + `backend/src/services/ai-teaching/**` 编排 + `backend/src/skills/virtual-learner-shared/**`（共享 schema）。

### 6.1 两条技能族与各自的时间感知

**真实教学链**

| skill | 角色 | 现在读时间吗 | 时间从哪来 | 日期模拟需要 |
|---|---|---|---|---|
| `teaching-turn` | 授课回合（认知分析+讲解） | 间接 | `scenario.learnerPrediction`、`behavioralProfile`、`interactionProfile` | 开场节奏受跨日疲劳影响（`dayLoadContext`） |
| `teaching-wrapup` | 课后总结+评分 | **是** | `reviewHints`（FSRS retrievability，当前模拟时刻） | 注入需 `asOf=simulatedNow` |
| `teaching-peer-reinforcement` | 同伴讨论 | 否 | — | 无 |
| `profile-adaptive-copy` | Dashboard 文案 | 间接 | `paceHint/warningCopy` 与负荷联动 | 需 `dayLoadContext`（第几天/负担趋势） |
| `profile-learning-predict` | 任务前卡壳预测 | 间接 | 疲劳信号、概念台账 | 跨日累积疲劳进 `stallRisk` |
| `profile-state-review` | 状态诊断 | 否 | `fatigue` insight | `falsifiableClaims.checkOn(next_lesson/next_task/next_review)` 锚定模拟日 |
| `teaching-replan-attribution` | 路径重排归因（aux） | 否 | 阈值召回（`deriveReplanSignal`）→ LLM 只在 `allowedRecommendations` 里选方向 | `checkOn(next_lesson/next_task)` 可锚定模拟日；**不改召回门**（阈值仍是唯一召回者） |
| `profile-concept-consolidate` / `profile-concept-load` | 概念归并 / 负担档位 | 否 | — | 无（`profile-concept-load` 只出档位，权重由代码给；已接 BKT 难度分档） |

**虚拟学习者模拟链**

| skill | 角色 | 时间感知 | 备注 |
|---|---|---|---|
| `simulation-persona-designer` / `scenario-designer` | 生成人设/故事 | 否 | 预制到"故事"为止 |
| `simulation-goal-dialogue` | Goal 阶段扮演 | 间接 | 读 `learnerMemory`（`dueReview` 等） |
| `simulation-epistemic-grounding` | 认知判决器（ESS 硬约束） | **必须保持无时间** | 能力悖论的解，只出对错判决 |
| `simulation-learn-turn` | Learn 阶段扮演 | 间接 | 读 `learnerMemory`/`currentPhase`；受 `epistemicGrounding` 硬约束 |
| `simulation-memory-curate` | 课后记忆提炼 | 否 | `memoryDelta` 无时间戳语义 |
| `simulation-path-evaluate` | Path 评审扮演 | 间接 | 读 `learnerMemory`，可提"这段我会了" |
| `simulation-referee` / `actor-auditor` | 终局评估 / 角色保真审计 | 证据里有 timestamp | `actor-auditor` 专门审计"能力悖论泄露" |

### 6.2 时间进入 skill 的 4 条通道

1. **`learnerMemory`**（`mastered/dueReview/struggling/recentCompleted`）
   `simulation.memory.ts:44 buildAssistedLearnerMemory` → `buildLearnerMemorySnapshot(userId,{limit})`（`learner-memory.ts:249`）**不传 `now`** → `memory-trace.service.ts:275 getDueTraces` 缺省走当前模拟时刻（无模拟上下文回落真实 now）。
   这是"跨日"进入模拟器的**唯一语义通道**，但当前只能表达"到期"，不能表达"几天前/隔了几天"。
2. **`teaching-wrapup.reviewHints`**（FSRS 保持率百分比）
   `AITeachingCoordinator.ts:2867 loadRetrievabilityHints` 经 `simulatedNowOr()` 取时（模拟上下文内即模拟日）。
3. **`teaching-turn.analysis.loadIndex / loadBasis` + `interactionProfile`**
   真实前端交互特征；虚拟学习者该 profile 为 `absent`（prompt 规则已明确处理）。
4. **`profile-adaptive-copy` 的 `paceHint/warningCopy`**（负荷联动）

> **结论**：没有 skill prompt 直接知道"日期/第几天"；所有"跨日"只通过 `dueReview` 间接体现。`learn-turn-simulator` 已接 `temporalContext`（`prompts/core/simulation-learn-turn.yaml:40-49`），其余 skill（含 `teaching-wrapup`）尚未注入。

### 6.3 不可破坏的硬约束

`simulation-epistemic-grounding` 是"物理两阶段"的第一段（先只判对错，再让 learn-turn 生成叙事），是对抗 **能力悖论（Capability Paradox）** 的架构解（`doc/local/EDUCATIONAL_THEORY_RESEARCH_2026.md §7.1`：ESS 认识论状态硬约束 + 认知-决策解耦）。
→ **时间注入不得让它输出对错判决以外的内容，也不得放松 `sampledCorrectness` 与 persona 掌握度的一致性**（`actor-auditor` 规则的"epistemicGrounding 一致性检查"专门审计这条）。

### 6.4 干预 / 动态调整的落点

- **课内阶段路由**：`AITeachingCoordinator.determineNextStage`（`:510-560`）→ `LearnStage='intervention'`，条件见 C3；事件落 `buildClassroomEvent`（`:471`，含 `occurredAt`）。
- **技能内负荷三路由**：`teaching-turn` 的 `loadIndex <0.3 / 0.6-0.8 / >0.85`（prompt 规则 89 行）。
- **会话负荷聚合**：`commitSessionLoadMetric`（`:964`）→ `learning_metrics.metricType='session_load'`。
- **课后评分**：`teaching-wrapup.evaluation.sessionLss/sessionKtl/sessionLf`。
- **记忆侧动态调整**：`review-plan.computeLoadBudget`（1.0/2.0/3.0）。
- **状态侧动态调整**：`learning-state.restoreMetrics(asOf)` 的 KTL/LF 跨日衰减。
- **教师侧微调**：`teaching-turn` 消费 `learnerPrediction`（`stallRisk/reliability`）。
- **难度侧动态调整**：`TaskDifficultyAdjustmentService.decideTaskDifficulty`（档位由代码给，LLM 只出观测）→ `TaskDifficultyAdjustmentLedger` 留痕（`learner_evidence(evidenceType='task:difficulty:adjustment')`）+ `measureTaskDifficultyEffects`（A/B 对照）。
- **重排侧**：`deriveReplanSignal` 出 `reasonCodes[]`（唯一召回门）→ `ReplanAttributionService.attribute`（新 skill `teaching-replan-attribution` 只在允许方向里选 + 一条可证伪断言）。
- **节奏侧**：`derivePacing(lf,ktl)` → `slow|moderate|fast`；课内 `deriveLearningControlState` → `paceMode/challengeLevelCap`。
- **当日负担**：`computeDayLoadFatigueBonus({lessons,minutes})` → `getAggregatedState().dayLoad.fatigueBonus`。
- **每日温故配额 + 顺延**：`ReviewQuotaService`（UTC 日，默认上限 6.0，env `REVIEW_DAILY_LOAD_LIMIT`）——**本稿"负担顺延"的既有实现**。

### 6.5 负担 / 干预 评估矩阵（每天一行，来源全为既有产出）

| 评估维度 | 来源表 / 产出 | 字段 |
|---|---|---|
| 时间负担（计划/实学） | `goal_scheduling_ledger` | `budgetMinutes / consumedMinutes / loadAvg` |
| **当日总负担** | `getAggregatedState().dayLoad` | `lessons / minutes / fatigueBonus` |
| **路径级 vs 全局** | `getAggregatedState().perPath[]` | `perPath[].metrics`（按路径隔离） |
| 认知负荷（会话级） | `learning_metrics(metricType='session_load')` | `value`(均值) / `metadata.max` / `metadata.basisDist` |
| 任务级负荷档位 | `subtasks` | `estimatedMinutes / cognitiveLoad / status / completedAt` |
| 知识负荷（跨日） | `learning_metrics` + `restoreMetrics(asOf)` | `lss / ktl / lf / lsb` |
| 干预（课内） | 课堂事件历史 | `type='intervention'` + `occurredAt` + reason |
| 降载（回合级） | 会话消息 analysis | `loadIndex / loadBasis` |
| **难度调整** | `learner_evidence(evidenceType='task:difficulty:adjustment')` | `baseline / adjusted / direction / reasons[] / applied` |
| **难度调整效果** | `measureTaskDifficultyEffects` | 同类理由缓解率、`Δlsb`（执行组 vs 对照组） |
| **重排信号** | `deriveReplanSignal` | `reasonCodes[]`（`fatigue_high` 等 7 类） |
| **重排归因** | `teaching-replan-attribution` 输出 | `primaryReasonCode / recommendation / claim / checkOn` |
| **每日温故额度** | `learner_projections(scope='review-quota')` | `limitLoad / usedLoad / remainingLoad / reservedKeys` |
| 动态调整（记忆） | `buildReviewPlan(now=simulatedNow)` | `budget / usedLoad / backlogCount / successRate` |
| 动态调整（状态） | `restoreMetrics` | `ktl / lf` 衰减 |
| 节奏 | `derivePacing(lf,ktl)` | `slow / moderate / fast` |
| 预测校准 | `profile-learning-predict` + 实收 | `stallRisk / reliability` vs 任务结果 |
| 课后主观负荷 | `teaching-wrapup.evaluation` | `sessionLss / sessionKtl / sessionLf` |

---

## 七、技能层契约

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
| `teaching-wrapup` | `actionPlan` 的"下一次"锚定模拟日 | 数值仍须引用输入 |
| `profile-adaptive-copy` | `paceHint` 反映第几天/负担 | 不指责、不制造愧疚 |
| `profile-learning-predict` | 跨日累积疲劳进 `stallRisk` | 证据不足仍取中值 |
| `profile-state-review` | `falsifiableClaims` 锚定模拟日 | 不用精确数值 |
| `teaching-replan-attribution` | `checkOn(next_lesson/next_task)` 锚定模拟日 | 不改召回门；方向取自 `allowedRecommendations` |

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

落点：`profile-adaptive-copy`（paceHint/warningCopy）、`profile-learning-predict`（stallRisk）、`teaching-wrapup`（叙事引用负担趋势）。
**注意**：`reviewBudget` 只作为可解释输入，**调度决策仍由 `review-plan` 代码算**（fsrs.ts 注释明确"调度是已解决的优化问题，不应交给 LLM"）。

### 7.4 `teaching-wrapup` 的 `reviewHints` 去墙钟

`loadRetrievabilityHints(userId, asOf = new Date())`；`buildReviewPlan`/`getDueTraces` 已有 `now`，一并透传。

> **实现口径**：未新增 `asOf` 参数；`teaching-session-lifecycle.ts:1223` 用 `simulatedNowOr()`（AsyncLocalStorage 模拟钟），效果等价于"去墙钟"。

### 7.5 明确"不改"的 skill（边界）

- `simulation-epistemic-grounding`：**保持无时间**（硬约束）。
- `referee` / `actor-auditor`：可读取模拟时间戳做证据定位，但**不得把"时间推进"当作角色漂移/平台缺陷**（保真分不因跨日而降）。
- `profile-concept-consolidate` / `profile-concept-load`：无时间。
- `path-planning` / `presets.yaml`：不动。

### 7.6 三处必须与系统层对齐的 skill 级细节

1. `buildAssistedLearnerMemory` / `buildAssistedKnowledgeSnapshot`（`simulation.memory.ts:44/66`）需要 `asOf` 透传，否则 `learn-turn` 引用的记忆是真实 `now`。
2. `recordCompletedArtifact`（`learner-memory.ts:361`）、`persistKnowledgeState`（`simulation.memory.ts:21`）、`writeProfileConceptsAfterLesson`（`learner-memory.ts:173`）的 `new Date()` → 业务时间戳用 `simulatedNow`。
3. `AITeachingCoordinator.loadRetrievabilityHints`（`:2867`）的 `new Date()`。

---

## 八、虚拟侧"日期模拟"设置与推进进度

> 目标：把"日期模拟"做成**可配置、可观测、可重置**的虚拟侧能力，默认关闭，绝不影响真实用户。
> 原则：**复用现有 4 层设置存储，不新增表**；**进度字段只读、服务端唯一写者**。

### 8.1 设置分层（复用现有 4 层）

| 层 | 存储 | 现有字段 | 日期模拟新增 | 语义 |
|---|---|---|---|---|
| 全局（平台级·虚拟侧） | `system.platform_settings` key=`virtualLab`（JSON，`virtual-lab-settings.service.ts`，30s runtime cache） | `virtualLearnerRpmLimit` | `dateSimulation{...}` | 默认值与护栏；**默认关** |
| 画像级 | `virtual_learner_profiles.profile`（JSON） | `simulationBudget` / `runtimePrefs` | `simulationClock{enabled, startDate}` | 该学习者的**配置**（代码仅读 `enabled`/`startDate`）；**不存进度快照**（进度以会话级为准） |
| 会话级（**权威时钟**） | `virtual_sessions.stageResults`（JSON） | `simulationConfig` | `simulationClock{...}`（C0 扩展） | 运行时真源 |
| 故事级（可选） | `profile.storyPool[i]` | `budget` | `pace?` | 故事节奏覆盖（呼应 `goalSeed.urgencyHint`） |

**解析优先级**（与 `resolveSessionBudget` 的 `story > profile > default` 三级同构）：
`session.simulationClock > story.pace > profile.simulationClock > global.dateSimulation > 代码默认`

> 现行 `resolveSimulationClock` 只读 session / profile / global；故事级 `pace` 覆盖未接入。

> ⚠️ **单一真源**：会话级是**权威时钟**；画像级/全局只是**配置与默认**。页面读进度以会话级为准，画像级仅作汇总展示，避免双写漂移。

### 8.2 字段定义

**全局 `dateSimulation`**
```jsonc
{
  "enabled": false,               // 默认关 → 现网零变化
  "timezone": "Asia/Shanghai",    // 模拟时区（默认服务器本地）
  "defaultPaceDaysPerAdvance": 1, // 每次推进跨几个自然日
  "maxSimulatedDays": 90,         // 护栏：单会话最多模拟天数
  "pauseOnIntervention": false,   // 触发高优先级干预时暂停推进
  "autoAdvanceEnabled": false,    // 批量/自动学习是否自动跨日
  "courseWeekdays": [1, 2, 3, 4, 5], // 上课星期（0=周日 … 6=周六），推进时跳过非上课日
  "lessonsPerDay": 1              // 课表：每天安排几节
}
```
> 说明：`defaultDailyMinutesCap` / `defaultDaysPerWeek` 不在现行字段中（模拟时钟与时间线均不消费，属"定义了但没人读"的死旋钮；学习者可用时间的权威统一在 `services/learning/capacity-authority.ts`）。当前真实字段见 `virtual-lab-settings.service.ts:21-38`。

**画像级 `simulationClock`**（仅配置；**不存进度**）
```jsonc
{
  // ---- 配置（前端可写；代码只读 enabled / startDate）----
  "enabled": null,               // null=跟随全局；true/false=覆盖
  "startDate": "2026-09-16"      // 模拟起点（默认会话创建日）
  // ── 以下为设计稿字段（代码未实现）：dailyMinutesCap / daysPerWeek /
  //    paceDaysPerAdvance / maxTotalDays，以及进度快照 currentDayIndex /
  //    currentSimulatedDay / advancedTimes / lastAdvancedAt。
  //    进度一律以**会话级**为准（见下表：dayIndex / simulatedNow / advancedTimes）。
}
```
> ⚠️ 层级口径：画像级 `simulationClock` 只有**配置**语义，`resolveSimulationClock` 仅读 `profileClock.enabled` 与 `profileClock.startDate`（`simulated-day.service.ts:172,181,189-191`）。进度字段（`dayIndex` / `simulatedNow` / `advancedTimes`）只存在于**会话级** `stageResults.simulationClock`。

**会话级 `simulationClock`**（权威，C0 扩展）
```jsonc
{
  "baseDate": "2026-09-16T09:00:00+08:00",
  "simulatedNow": "2026-09-20T09:00:00+08:00",
  "dayIndex": 4,
  "timezone": "Asia/Shanghai",
  "source": "virtual",        // 设计稿字段（代码未实现）
  "autoAdvance": false,       // 会话级自动推进开关
  "advancedTimes": 4,
  "history": [
    // 实际写入字段见 simulated-day.service.ts:451-456 / planClockAdvance
    { "dayIndex": 1, "simulatedDay": "2026-09-17", "advancedAt": "...", "plannedLessons": 1 }
  ]
}
```
> 实际写入的顶层字段为 `baseDate` / `simulatedNow` / `dayIndex` / `advancedTimes` / `history` / `autoAdvance`（`simulated-day.service.ts:462-468`、`virtual-learners.assisted-simulation.ts:147-153`）；`source` 为设计稿字段（代码未实现）。`history[]` 每条实际为 `{ dayIndex, simulatedDay, advancedAt, plannedLessons }`（`consumedMinutes` / `interventions` 未实现）。`maxSimulatedDays` 不在会话时钟里，它来自全局设置（见上行 global `dateSimulation`）。

### 8.3 "推进进度"口径（页面展示）

| 指标 | 来源 | 用途 |
|---|---|---|
| `dayIndex` | 会话级 | 进度条分子（例：已推进 4 天；页面显示「第 `dayIndex + 1` 天」） |
| `maxSimulatedDays` | 全局 `dateSimulation`（配置） | 进度条分母/护栏（**不在会话时钟里**） |
| `simulatedNow` | 会话级 | 显示"当前模拟日期"（日历 = `baseDate + dayIndex`） |
| `advancedTimes` | 会话级 | 已推进次数 |
| 每日 `consumedMinutes` | C2③ 时间线 | 是否被每日课量/时长截断（负担证据）；`dailyMinutesCap` 为设计稿字段（代码未实现） |
| `history[].plannedLessons` | 会话级 | 每天安排的节数（实际写入字段；`interventions` 未实现） |

### 8.4 API 变更（在 C2 接口族上扩展）

| 方法 | 路径 | 变更 |
|---|---|---|
| GET / PUT | `/settings` | `data.settings.dateSimulation`（全局默认）；PUT 只接配置字段 |
| GET | `/:id` | 增 `simulationClock`（画像级配置 + 进度快照）——**设计稿字段（代码未实现）**：`GET /:id` 只原样回 `profile` JSON，无该字段 |
| PUT | `/:id` | 接 `body.simulationClock`（**仅配置字段**；进度字段忽略）——**设计稿字段（代码未实现）**：PUT 只按 `body.profile` 深合并，无 `body.simulationClock` 处理 |
| POST | `/:id/simulation-clock/reset` | **设计稿接口（代码未实现）**：画像级重置不存在；现行的是**会话级** `POST /sessions/:sessionId/simulation-clock/reset`（`virtual-learners.assisted-simulation.ts:136`） |
| PUT | `/sessions/:id/simulation-config` | 扩展 `simulationClock`（会话级覆盖配置；实际只接 `baseDate/enabled/autoAdvance`） |
| GET | `/`（列表） | 每条增 `simulation: { enabled, dayIndex, baseDate, autoAdvance } \| null`（**不是** `simulationClock`，也**无** `currentDayIndex/maxTotalDays/currentSimulatedDay`；`virtual-learners.session-lifecycle.ts:352-366`），供列表进度列 |

> ⚠️ 列表进度字段口径：列表每条的字段名是 `simulation`（会话级时钟优先、其次画像级，`session-lifecycle.ts:358`），字段为 `enabled / dayIndex / baseDate / autoAdvance`。上限 `maxSimulatedDays` 来自全局设置，**不在列表返回里**。
> 幂等/越权：**进度字段服务端唯一写者**，前端 PUT 携带进度字段一律忽略；`reset` 写 `admin_audit_logs`。

### 8.5 UI 落点

- **日期模拟设置区**（在「模型与接入 → 虚拟学习者」压测参数卡）：`SimulatedDaySettings.vue` 实际表单为 **开关 + 每次推进天数（`defaultPaceDaysPerAdvance`）+ 单会话最多模拟天数（`maxSimulatedDays`）+ 上课星期（`courseWeekdays`）+ 每天安排几节（`lessonsPerDay`）**；"每日时长上限 / 每周天数"未实现（§8.2 说明）。
- **`VirtualLearners.vue`**：列表新增 **"模拟进度"列**（第 N 天 + 进度条 + 当前模拟日）——后端已返回 `simulation`（`session-lifecycle.ts:352-366`），前端表格未消费（`VirtualLearners.vue` 无该字段渲染）。
- **`VirtualProfile.vue`**：**设计稿（代码未实现）**——`画像与运行预算` tab 新增"日期模拟"区块（enabled / startDate / dailyMinutesCap / daysPerWeek / paceDaysPerAdvance / maxTotalDays + 进度只读 + 重置按钮）；当前仅有只读 `日程` tab（`DayTimeline` 以 `readonly` 嵌入，`VirtualProfile.vue:625-644`）。
- **`SessionCockpit.vue`**：会话级模拟日覆盖 + 进度徽章（与 3.4 的第 N 天徽章同源）——只有徽章（`SessionCockpit.vue:17-26`），推进按钮/按天分组未实现。
- **`BatchExperiments.vue`**：实验级"统一起点 / 每次推进天数"，用于多学习者**对齐到同一天**做横向对比——不适用：无批量实验页。

### 8.6 与现有设置的区别（避免混淆）

| 设置 | 含义 | 与日期模拟的关系 |
|---|---|---|
| `simulationBudget.maxRetriesPerStep/maxRetriesTotal` | **AI 调用成本**预算 | 正交（控制成本，不控制时长） |
| `runtimePrefs.turnCapPerLesson` | 每课**回合**上限 | 正交（控制单课长度，不控制每天几课） |
| `virtualLearnerRpmLimit` | 虚拟侧**出站速率** | 正交（控制并发/速率） |
| `dailyMinutesCap`（设计稿字段，代码未实现） | 每日**学习时长**上限 | 本稿设计的新增项，用于负担评估与顺延；当前代码**未实现**该字段（全仓 0 命中） |
| `lessonsPerDay`（已实现） | 每天**安排几节** | `virtual-lab-settings.service.ts:37,73`，推进时每天节数上限 |
| `REVIEW_DAILY_LOAD_LIMIT`（已有，env） | 每日**温故负担**上限（默认 6.0 负担单位，`ReviewQuotaService`） | 已有；属"每日额度"族 |

### 8.7 默认与安全

- `enabled=false` 默认 → **现网零变化**；只有 `isVirtualLearner = 1` 且 `enabled=true` 的会话才推进。
- 设置变更**不回改**已写时间戳；`reset` 只影响后续推进。
- 数值全部走 `normalizeVirtualLabSettings` 同款 clamp（防手误写超大值）。

### 8.8 重放方向决议：过去锚点 + 向前推进

**结论：采用"过去锚点 + 向前推进"（历史重放）。** 实证依据（按证据强度）：

1. **隔离性由 `asOf` 上界决定**：`buildCommittedMetricWhere` 的窗口是 `calculatedAt: { gte: since, lte: asOf }`（`learning-state.service.ts:399-401`）。
   - 写过去：`asOf` 早于任何真实行 → 真实行被 `lte: asOf` 天然排除 → **仿真封闭**。
   - 写未来：`asOf` 晚于真实行 → **真实历史全部被卷入**，仿真不封闭（除非再加 `baseDate` 下界，属额外改造）。
2. **默认读取可见性**：现存读路径都默认 `asOf = new Date()`（`ai-teaching.routes.ts:846 getCurrentState(userId)`、`state-tracking.routes.ts:27`；虚拟画像/记忆池同理）。
   - 写过去：仿真行 `calculatedAt <= now`，**立即被看到**（虚拟学习者的"历史"本就该可见）。
   - 写未来：仿真行 `calculatedAt > now`，默认读取**看不到** → 记忆池/聚合/画像全空，必须给每条读路径显式传未来 `asOf`。
3. **时间倒挂**：写未来时 `createdAt/updatedAt`（Prisma 真墙钟）< 业务时间戳；`teaching_sessions.duration = Date.now() - startTime` 会为负；`streak`（`learning.service.ts:4292`）、`goal_scheduling_ledger.date`（`:1625`）、`ReviewQuotaService.quotaDateKey` 均按真实 now / UTC 日 → 语义错位。写过去则"真墙钟 ≥ 业务时间戳"，与真实数据同构。
4. **守卫不受影响**：`session-reclaim.service.ts` 按 `updatedAt`（真墙钟）判 stale，两向都不被业务时间戳影响；但写未来会与"未来日期"叠加出混乱。
5. **实现选择过去日期**以实现封闭仿真；`getPreviousMetrics` 接受 `asOf`，`simulate-learner-days.test.ts` 覆盖该语义。
6. **理论支持**：`doc/LEARNER_STATE_REVIEW_DESIGN.md` 引用的 EduClaw-Bench（2026）即"30 天长程、KT 驱动模拟学习者"——长程仿真标准做法是**回放**，不是写未来。

**精确表述（避免"向后 vs 向前"的伪对立）**：
- **推进顺序**永远**向前**（day0→day1→…），否则模拟不出"负担随天数累积"；
- **日历锚点**固定在**过去**（`baseDate = now - horizon`），推进到末尾≈今天，**不进入未来**。

**落法（以实现为准）**：`simulationClock.baseDate` 实际**不**按 `now - maxTotalDays` 自动生成，而是取**会话创建日**为锚点（`simulated-day.service.ts:186-191`，仍属过去锚点）；`advance-day` 在**模拟顺序上 +1**，日历写入 `baseDate + dayIndex`。上限 `maxSimulatedDays` 只作推进护栏，不参与 `baseDate` 推导。`maxTotalDays` 不存在于代码（应为全局配置 `maxSimulatedDays`）。

**纯"未来推进"何时才考虑**：仅当产品要"预演未来学习计划"（plan preview）。届时必须同时：(a) 每条读路径显式传未来 `asOf`；(b) 聚合加 `baseDate` 下界过滤防卷真实行；(c) 审计/运维列与业务列分离。当前读模型不满足，成本高收益低 → **暂不做**。

### 8.9 每日负担设置是否合并：不合并，做成分组

**结论：不合并，做"每日负担"设置组，各字段独立映射既有公式。**

| 字段 | 量纲 | 映射的既有公式 | 现状 |
|---|---|---|---|
| `dailyMinutesCap` | 分钟 | 时长侧（`dayLoad.minutes`） | **设计稿字段（代码未实现）** |
| `lessonsPerDay`（原稿名 `maxLessonsPerDay`） | 节数 | `dayLoad.lessons` → `computeDayLoadFatigueBonus` | **已实现**（`virtual-lab-settings.service.ts:37,73`） |
| `REVIEW_DAILY_LOAD_LIMIT` | 负担单位（默认 6.0） | `ReviewQuotaService`（3 课 × 2.0） | 已有（env） |

理由：三者量纲与公式都不同（`computeDayLoadFatigueBonus` 吃 `lessons+minutes`；复习配额吃"负担单位"），合并会破坏"档位由代码给"的纪律，且要动两处既有公式与测试。设置页并列展示即可（见 8.6 最后一行）。

---

## 九、风险与未决问题

> 条目编号固定：`§9.5` = 条目 5（`simulatedNow` 与真墙钟列），`§9.11` = 条目 11（重放方向）。

### 9.1 已定案（有代码/文档落点）

- **1. 日界：应用时区本地日** —— 单一真理源 `backend/src/services/time/day-boundary.ts:4-14`：一律按**应用时区本地日**切日，禁止 UTC `toISOString().slice(0,10)` 与服务器机器本地时区；时区来源为平台设置 `timezone`（默认 `Asia/Shanghai`），虚拟侧可用 `dateSimulation.timezone` 覆盖。`goal_scheduling_ledger` 的"今天"（`goal-schedule.service.ts:88`）、streak（`learning/tasks/streak.ts:45`）、PMC 日负荷（`learning-state.service.ts:365`）与日期模拟均同口径。
- **4. "负担"口径** —— 页面同时给"时间口径"（分钟）与"认知口径"（load/档位），不混成一根线（C3 / §6.5 按此消费）。
- **5. `simulatedNow` 与真实 `createdAt/updatedAt`** —— 业务时间戳走模拟日，Prisma 自动列保持真墙钟；实现为 `simulatedNowOr()`（见 §四）。
- **6. 能力悖论（ESS）不得被时间注入放松** —— 硬约束：`simulation-epistemic-grounding` 保持无时间，时间只影响叙事与节奏（§6.3 / §7.5）。
- **9. 双时钟源** —— 会话级是权威时钟，画像/全局只是配置；列表读取亦会话级优先（`virtual-learners.ts:1605`：`stageResults.simulationClock || profile.simulationClock`）。
- **10. 设置越权** —— 进度字段服务端唯一写者；`PUT /sessions/:id/simulation-config` 只接收 `baseDate/enabled/autoAdvance`，`dayIndex/history` 不接收（`virtual-learners.ts:3072-3102`）。
- **11. 重放方向** —— 「过去锚点 + 向前推进」（§8.8），实现为 `advance-day`（`virtual-learners.ts:3239`）。
- **12. 不要重复造负担口径** —— 权威口径清单见 §6.5；页面只消费 `getAggregatedState` / `deriveReplanSignal` / `TaskDifficultyAdjustment*` / `ReviewQuotaService`。

### 9.2 未定项

- **2. 一次会话=一次跑完 / 跨日续跑编排**：`advance-day runTasks=true` 已能按天真实跑课，但自动推进调度只做时钟簿记、不跑课（`simulated-day-scheduler.ts:1-14`）；「跨多日无人值守续跑」不在实现范围内。
- **3. 跨日成本护栏**：N 天推进 = N 倍 LLM 调用；`session-budget` 的 `costCeiling/noProgressChunkLimit` 是否覆盖跨日累计调用，尚未在推进链上显式确认。
- **7. "跨日"语义只能表达"到期"**：`learnerMemory.dueReview` 仍无 `dueInDays`（全仓 0 命中），模拟器无法自然表达"几天前学过"；落点见 §7.2。
- **8. `generateIntervention`**：代码中不存在；`InterventionDecision` 仅作为类型定义保留在 `learning-state-advisor.ts:39`。干预口径一律以 C3 的真实产出为准。
