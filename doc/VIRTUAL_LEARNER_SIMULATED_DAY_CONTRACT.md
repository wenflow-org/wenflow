# 虚拟学习者 · 日期模拟 接口冻结清单（系统层 ↔ 页面层）

> 目的：把"学习分散在各自然天"的仿真的**分工边界与数据契约**钉死，避免系统层与页面层各写一半。
> 状态：**待系统层 owner 确认**（本页由页面侧提出）。
> 设计全文：`doc/VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md`。
> 已落地（页面侧，commits `e2af8f7` / `ce8c983` / `b57c480`）：只读聚合 + 全局设置 + 前端挂载 + Path 评审修复。

---

## 一、机制（已定，双方共同遵守）

**不做 mock 时钟**，用**历史日期重放 + `asOf` 读回**：

- 写入：把"第 dayIndex 天"的业务时间戳写成 `timestamp = baseDate + dayIndex`（`updateLearningMetrics({timestamp})`、`subtasks.completedAt`、`teaching_sessions.startTime/endTime`、`learner_evidence.occurredAt`）。
- 读取：一律按 `asOf = endOfDayUtc(baseDate + dayIndex)` 读回。
- **日历锚点在过去**：`baseDate = now - horizon`（或会话创建日），推进到末尾 ≈ 今天，**不进入未来**。
- **隔离**：只对 `isVirtualLearner = 1`；`asOf` 上界（`calculatedAt <= asOf`）天然排除真实行。
- **推进顺序向前**（day0→day1→…）；审计/运维列（`createdAt/updatedAt`）保持真墙钟。

依据：`learning-state.service.ts:399-401`（窗口 `lte: asOf`）、`scripts/simulate-learner-days.ts`（6 条断言已在跑）、commit `9c3fd45`。

---

## 二、责任边界

| 归属 | 负责内容 |
|---|---|
| **系统层（对方）** | ① 各时间读取点接受 `asOf/now`（见 §四）；② `advance-day` 的**重放执行**（写当天业务时间戳并跑任务）；③ `simulationClock` 下推与 `history` 维护；④ 跨日续跑的调度切口。 |
| **页面层（本侧，已完成）** | ① 只读聚合 `simulated-day.service`（`getAggregatedState/derivePacing/ReviewQuotaService/learner_evidence/memory_traces` 口径）；② 全局设置 `dateSimulation`；③ 前端 `DayTimeline` / 日程 tab / 设置区；④ Path 评审不拦截修复。 |

**页面层只读**：不写任何业务表；进度字段服务端唯一写者。

---

## 三、冻结接口（页面已实现 ①②；③④待系统层）

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

### ③ `POST /sessions/:sessionId/advance-day`（**待系统层**）
```jsonc
// body
{ "days": 1, "runTasks": true, "maxMinutesPerDay": 45, "stopOnIntervention": false }
// 语义
// - 校验 isVirtualLearner + dateSimulation.enabled；否则 409
// - 幂等：同 session 同 dayIndex 重复调用不重复写
// - 写：simulationClock.dayIndex++ / simulatedNow=endOfDay(baseDate+dayIndex) / history.push({...})
// - runTasks=true 时：用 baseDate+dayIndex 作为业务时间戳跑当天分配任务（重放）
```

### ④ `GET /api/admin/batch-experiments/:experimentId/day-timeline?metric=burden|intervention`（待系统层）

---

## 四、系统层必须补的注入点（`asOf/now`）

| 位置 | 现状 | 需要 |
|---|---|---|
| `learning.service.ts:1539 getTodaySchedule` | 内部 `new Date()` | `asOf?: Date` |
| `learning.service.ts:1624 planTodaySchedule` | UTC `toISOString()` | `asOf` + 统一本地日界 |
| `learning.service.ts:4292` streak 更新 | `new Date()` | `asOf` + 统一日界 |
| `memory-trace.service.ts:185 recordExtraction` / `:394 applyKtEstimate` / `:435 bumpReviewInterval` | `new Date()` | `now?: Date`（`getDueTraces:275` / `getRetentionSnapshot` 已有 `now?`） |
| `learner-memory.ts:361 recordCompletedArtifact` | `new Date().toISOString()` | `now?: Date` |
| `learner-memory.ts:249 buildLearnerMemorySnapshot` | 不透传 `now` | `now?` |
| `TeachingSessionRepository.reserve:172` / `AITeachingCoordinator.ts:719` | Prisma `@default(now())` / `Date.now()` | 显式 `startTime` / `asOf` |
| `AITeachingCoordinator.ts:2867 loadRetrievabilityHints` | `new Date()` | `asOf` |

> 只读侧已就绪（`getCurrentState/getPreviousMetrics({pathId,asOf})`、`getAggregatedState({asOf})`、`buildReviewPlan({now})`）。

---

## 五、不变式（双方都不得破坏）

1. **不改 Path 契约**（`learning_paths/milestones/subtasks` schema 与 `path-status` 既有字段）。
2. **不动 `virtual-learners/presets.yaml`**。
3. `simulationClock` 只存 `stageResults` JSON，不新增必填列。
4. **只对 `isVirtualLearner=1` 生效**；真实用户零变更（依赖 `asOf` 上界）。
5. **不得重复造负担口径**：`getAggregatedState().dayLoad.fatigueBonus`、`deriveReplanSignal.reasonCodes`、`decideTaskDifficulty.reasons`、`ReviewQuotaService` 为权威。
6. `epistemic-grounding`（ESS 认知硬判决）**保持无时间**；时间只影响叙事/节奏，不得让它"隔几天突然会了"。
7. 每日温故额度（`ReviewQuotaService`）与每日时长（`dailyMinutesCap`）**不合并**，各自映射既有公式。

---

## 六、待确认（请系统层 owner 回复）

> **已定案（系统层 2026-09-16）**：日界统一为 **UTC**（commit `700b718`：自然衰减统一到 UTC 日界，四口径合一）；日期模拟脚手架已复用本侧的 `resolveDayWindow` 作为**规范助手**（commit `fcf651b`）。本页以下为该结论后的剩余项。

- [x] 日界统一为 **UTC** —— 已实现（`getNaturalDayDiff` 改为 UTC 日界；与 `getAggregatedState.dayLoad` / `ReviewQuotaService` / `resolveDayWindow` 一致）。
- [ ] `baseDate` 归属：系统层按 `now - maxTotalDays` 自动生成，还是由会话 `createdAt`？页面侧建议：**默认为会话创建日，可在画像级/会话级覆盖**（会话级配置已实现）。
- [ ] `advance-day` 是否复用 `simulate-learner-days.ts` 的重放写法（独立模拟路径 vs 真实会话路径）？
- [ ] `runTasks` 的日时长上限（`maxMinutesPerDay`）由谁裁决（系统层顺延策略）？
- [ ] `history[]` 直接存 `stageResults.simulationClock.history` 可否（页面回放用）？
- [ ] 技能层还需给 `session-wrapup` 注入 `temporalContext`（教学会话 → 虚拟会话时钟的映射由谁提供）？

---

## 七、变更记录

- 2026-09-16 v1：首版（页面侧提出，待系统层确认）。
