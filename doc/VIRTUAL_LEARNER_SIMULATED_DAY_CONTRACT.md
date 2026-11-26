# 虚拟学习者 · 日期模拟 接口冻结清单（系统层 ↔ 页面层）

> 📌 类型：活规范（系统层与页面层之间日期模拟的机制契约与冻结接口）｜索引见 [doc/README.md](./README.md)。

> **定位**：钉死"学习分散在各自然天"仿真的分工边界与数据契约，避免系统层与页面层各写一半。
> **设计全文**：`doc/VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md`。

---

## 一、机制（已定，双方共同遵守）

**不做 mock 时钟**，用**历史日期重放 + `asOf` 读回**：

- 写入：把"第 dayIndex 天"的业务时间戳写成 `timestamp = baseDate + dayIndex`（`updateLearningMetrics({timestamp})`、`subtasks.completedAt`、`teaching_sessions.startTime/endTime`、`learner_evidence.occurredAt`）。
- 读取：一律按 `asOf = endOfDay(baseDate + dayIndex)`（应用时区日末）读回。
- **模拟日可进入真实未来**：`baseDate + dayIndex` 允许超过真实 `now`，用于跨日/长程模拟；未来日不拒绝。
- **真实时间窗统计必须设上界**：任何面向真人运维/学习者的「近 N 天/今日」查询，除下界外还必须带 `lte: now`（或用 `asOf` 读回），不得把未来模拟日的完成记录当成已发生事实。
- **隔离**：只对 `isVirtualLearner = 1`；`asOf` 上界（`calculatedAt <= asOf`）天然排除真实行。VL 数据进入真实时间窗时以 `now` 为上界。
- **推进顺序向前**（day0→day1→…）；审计/运维列（`createdAt/updatedAt`）保持真墙钟。

依据：`learning-state.service.ts:399-401`（窗口 `lte: asOf`）、`scripts/simulate-learner-days.ts`（6 条断言已在跑）。

---

## 二、责任边界

| 归属 | 负责内容 |
|---|---|
| **系统层（对方）** | ① 各时间读取点接受 `asOf/now`（见 §四）；② `advance-day` 的**重放执行**（写当天业务时间戳并跑任务）；③ `simulationClock` 下推与 `history` 维护；④ 跨日续跑的调度切口。 |
| **页面层（本侧）** | ① 只读聚合 `simulated-day.service`（`getAggregatedState/derivePacing/ReviewQuotaService/learner_evidence/memory_traces` 口径）；② 全局设置 `dateSimulation`；③ 前端 `DayTimeline` / 日程 tab / 设置区；④ Path 评审不拦截修复。 |

**页面层只读**：不写任何业务表；进度字段服务端唯一写者。

---

## 三、冻结接口（①②③ 已实现；④ 未实现）

### ① `GET /api/admin/virtual-learners/sessions/:sessionId/simulation-clock` ✅ 已实现
```jsonc
{ "enabled": false, "status": "disabled|ready|in_progress",
  "timezone": "Asia/Shanghai", "baseDate": "YYYY-MM-DD",
  "dayIndex": 0, "simulatedNow": "ISO", "maxSimulatedDays": 90 }
```

### ② `GET /api/admin/virtual-learners/sessions/:sessionId/day-timeline?from=&to=&baseDate=` ✅ 已实现
每天返回（全部来自已落地读写缝）：
`dayLoad{lessons,minutes,fatigueBonus}` / `metrics{lss,ktl,lf,lsb}` / `pacing` / `perPath[]` /
`signals[]` / `tasks[]` / `difficultyAdjustments[]` / `reviewQuota{limitLoad,usedLoad,remainingLoad}` /
`memory{traceCount,dueCount,fragileCount,stableCount,avgRetention}`。

### ③ `POST /api/admin/virtual-learners/sessions/:sessionId/advance-day` ✅ 已实现
```jsonc
// body
{ "days": 1, "runTasks": true }
// 语义
// - 校验 isVirtualLearner + dateSimulation.enabled；否则 409
// - days 限 1..60；runTasks=true 时一次只能推进 1 天（多天请用 runTasks=false 纯记账）
// - 幂等：同 session 同 dayIndex 重复调用不重复写
// - 写：simulationClock.dayIndex++ / simulatedNow=endOfDay(baseDate+dayIndex) / history.push({...})
// - runTasks=true 时：在模拟时钟上下文内用 baseDate+dayIndex 作为业务时间戳跑当天分配任务（重放）
```
> 实现 `backend/src/routes/admin/virtual-learners.assisted-simulation.ts`（经 `virtual-learners.assisted-runtime.ts` 挂载）；当前只消费 `days`/`runTasks`，不含 `maxMinutesPerDay`/`stopOnIntervention`。

### ④ `GET /api/admin/batch-experiments/:experimentId/day-timeline?metric=burden|intervention`（未实现）

---

## 四、时间注入点（`asOf/now`）

8 处时间读取点全部经环境模拟钟 `simulatedNowOr()` 注入（`virtual-lab/simulation-clock-context`），不额外加 `asOf` 参数；无模拟上下文时回落真实时钟，现网行为不变。

| # | 位置（现行） | 契约要求 | 实现 |
|---|---|---|---|
| 1 | `services/learning/goals/goal-schedule.service.ts:86 getTodaySchedule` | `asOf?: Date` | ✓ 日窗走 `simulatedNowOr()`；进行中会话「已学分钟」也走模拟钟（不用 `Date.now()`） |
| 2 | 同文件 `:171 planTodaySchedule` | `asOf` + 本地日界 | ✓ `dayKeyOf(simulatedNowOr())`（台账 date 键）；`updatedAt` 等审计列保留墙钟 |
| 3 | `services/learning/tasks/task-completion.service.ts:470` → 纯函数 `tasks/streak.ts advanceStreak` | `asOf` + 日界 | ✓ `data.asOf ?? new Date()`；日界用 `dayKeyOf/dayDiffInDays`（应用时区） |
| 4 | `services/memory/memory-trace.service.ts recordExtraction` / `applyKtEstimate` | `now?: Date` | ✓ `simulatedNowOr()`；读侧 `getDueTraces({ now })` 已带参 |
| 5 | `virtual-lab/learner-memory.ts recordCompletedArtifact` | `now?: Date` | ✓ `completedAt: simulatedNowOr()` |
| 6 | `virtual-lab/learner-memory.ts buildLearnerMemorySnapshot` | `now?` | ✓ 经 `getDueTraces` 缺省 `simulatedNowOr()`（不额外传参） |
| 7 | `services/ai-teaching/TeachingSessionRepository.ts reserve` | 显式 `startTime` | ✓ `startTime: now`（`simulatedNowOr()`），租约同源 |
| 8 | `services/ai-teaching/teaching-session-lifecycle.ts loadRetrievabilityHints` | `asOf` | ✓ `simulatedNowOr()`（FSRS 可提取度） |

> 只读侧已就绪（`getCurrentState/getPreviousMetrics({pathId,asOf})`、`getAggregatedState({asOf})`、`buildReviewPlan({now})`）。
> 仍未做的是系统层的 batch day-timeline 路由（§三 ④）。

---

## 五、不变式（双方都不得破坏）

1. **不改 Path 契约**（`learning_paths/milestones/subtasks` schema 与 `path-status` 既有字段）。
2. **不动 `virtual-learners/presets.yaml`**。
3. `simulationClock` 只存 `stageResults` JSON，不新增必填列。
4. **只对 `isVirtualLearner=1` 生效**；真实用户零变更（依赖 `asOf` 上界）。
5. **不得重复造负担口径**：`getAggregatedState().dayLoad.fatigueBonus`、`deriveReplanSignal.reasonCodes`、`decideTaskDifficulty.reasons`、`ReviewQuotaService` 为权威。
6. `epistemic-grounding`（ESS 认知硬判决）**保持无时间**；时间只影响叙事/节奏，不得让它"隔几天突然会了"。
7. 每日温故额度（`ReviewQuotaService`）与每日时长（学习者可用时间，权威在 `services/learning/capacity-authority.ts`）**不合并**，各自映射既有公式。

---

## 六、日界与会话锚点

日界统一为**应用时区本地日**（单一真理源 `backend/src/services/time/day-boundary.ts`；`getNaturalDayDiff` 走 `dayDiffInDays`，与 `getAggregatedState.dayLoad` / `ReviewQuotaService` / `resolveDayWindow` 同口径）。`baseDate` 默认取**会话创建日**，可在会话级覆盖；`advance-day` 在模拟时钟上下文内走真实会话路径（写 `baseDate + dayIndex`、按 `asOf` 读回）。
