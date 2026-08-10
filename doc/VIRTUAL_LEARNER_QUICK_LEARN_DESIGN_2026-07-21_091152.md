# Virtual Learner Quick Learn（一键代学）设计文档

> 日期：2026-07-21
> 状态：V1 实施基线
> 来源：开发者体验讨论——“我需要看到一堂课学习完，但不想自己模拟一套流程；想看到这节课结束后，学习者数据对下一个 task、Path、下一个 goal 的影响”。

---

## 1. 背景与问题

WenFlow 的学习主链（Goal → Path → Learn → Wrapup → Learner Evidence）已经真实运行，但开发者验证“一节课学完以后发生了什么”成本极高：

1. **必须跑完整上游**：想看 Learn，得先演完 Goal 对话、等 Path 生成、找到可学任务。
2. **必须亲自扮演学习者**：Teaching 是交互式的，看到一节课结束要手动输入十几轮。
3. **学完看不到影响**：课堂结束后，学习者模型（Learner Snapshot）变了什么、下一节课有没有用上、Path 有没有响应、新 Goal 有没有感知，当前没有任何一个视图能直接回答。

现有两套相关能力都不直接解决这个痛点：

- **Assisted Simulation**（`SimulationOrchestrator`）：能从 Goal 开始自动跑全流程，但入口是“完整会话”，不能从任意已有 Task 开始；`startLearningPhase` 强制要求 path_review 已 accept（`simulation.coordinator.ts:1963-1966`），且 completed 任务拒绝重启（`:2002-2004`）。
- **Blackbox Runner**：走真实 HTTP API、有完整轨迹与裁判，但同样从 Goal 开始，且是单步驱动。

## 2. 概念定位

Quick Learn 是 **Virtual Learner 的轻量化分支**，不是独立系统，也不是完整 GM 控制面：

```text
Virtual Learner
├─ Full Simulation（已有）：Goal → Path → Learn → Wrapup 全流程模拟
│    回答：一个设定好的学习者走完全流程时会发生什么？
└─ Quick Learn（本设计）：选 Task → 自动学完 → 看数据变化与下游影响
     回答：这节课到底留下了什么，以及这些东西后来有没有被系统使用？
```

三个角色分离：

| 角色 | 职责 | V1 载体 |
|---|---|---|
| 虚拟学习者（Actor） | 像学习者一样回答教师 | 复用 `virtual-learner-learn-turn-simulator` |
| 自动运行器（Runner） | 驱动教师与学习者交替直到课堂闭合、任务完成 | 新增 `QuickLearnService` |
| 轻量 GM（开发者控制） | 选择从哪开始、以什么模式跑、跑到哪停 | Admin API + 前端入口 |

关键原则：

1. **走真实生产链**：`AITeachingCoordinator.startSession → processStudentMessage × N → endSession（含 session-wrapup）→ LearningService.completeTask`。不通过直接改数据库状态作弊，否则测不到 Skill 与推断链。
2. **快进模式是功能验证，不是教育评测**：V1 只提供合作型学习者（`frictionBudget='none'`），目标是“合法地快速完成”，验证数据流；教育质量评测仍属 Full Simulation + Referee 的职责。
3. **报告以确定性代码为主**：前后 Snapshot 对比、生命周期检查、下游 Probe 全部由代码计算；不引入 AI 裁判来“猜”数据有没有传播。
4. **不修改生产 Prompt**：代学不改变 Goal/Path/Teaching 的 ACTIVE Prompt；被测系统不知道自己在被测试。

## 3. 现状盘点（代码核实结论）

### 3.1 可直接复用的能力

| 能力 | 位置 | 备注 |
|---|---|---|
| Learn Actor Skill | `backend/src/skills/virtual-learner-learn-turn-simulator/index.ts` | 输入输出契约完整：reply / learnerState.phaseFocus / learnerFeedback（selfReportedTaskDone、stopAsking、wantsMoreHelp、remainingBlockers） |
| 双重收束范式 | `backend/src/coordinators/simulation.coordinator.ts:2371-2396` | teacherReady（isCompletion‖autoEnded）&& learnerReady（learnerFeedback 四条件） |
| Teaching 生产入口 | `AITeachingCoordinator.startSession({userId, taskId})`（`:64-67`）、`processStudentMessage(sessionId, msg, {expectedRevision})`、`endSession(sessionId, endReason, expectedRevision)`（`:1554`） | endSession 同步生成 wrapup 并在事务内提交 learning_metrics + 写 durable outbox |
| 任务完成入口 | `LearningService.completeTask({taskId, userId, ...})`（`learning.service.ts:826-833`） | 对已 completed 幂等 |
| 学习前门禁 | `LearningService.assertTaskReadyForLearning(taskId, userId)`（`:3843`） | 校验 path.userId===userId、milestone 非 locked、path 可学 |
| 学习者快照 | `LearnerSnapshotService.getSnapshot({userId, learningPathId?, milestoneId?, taskId?, mode?})`（`LearnerSnapshotService.ts:163-272`） | **实时构建、无缓存**；`freshness.basedOn` 含 latestMetricAt / latestTeachingSessionAt / latestTaskCompletionAt，可用于判断数据是否已落地 |
| 下游投影 | `LearnerProjectionService.toTeachingProjection / toReplanProjection`（纯函数） | Next-Task Probe 与 Replan Probe 的直接原料 |
| Replan 信号 | `snapshot.replanSignal`（deriveReplanSignal） | 只读，无副作用 |
| 异步消费 | outbox worker 1s 轮询（`outbox.worker.ts:6,22`）；lesson:completed → learner evidence / knowledge enrichment | 通常秒级完成 |
| Profile 绑定 | `virtual_sessions.userId = profile.userId`（`virtual-learners.ts:2067`） | Quick Learn 运行在 profile 绑定 user 名下 |

### 3.2 缺口（本设计要补的）

1. **无“从任意 Task 开始”的入口**：现有两条模拟链都要求从 Goal 起跑。
2. **无 Path 测试夹具**：仓库不存在 path 级 clone（已全仓搜索确认）。修改 Teaching 后想对照实验，无法保证任务内容一致。
3. **无运行到终态的 Learn-only 循环**：Blackbox 单步、Assisted 全流程，均不适用。
4. **无学习前后对比视图**：没有任何代码做 snapshot diff。
5. **无下游传播报告**：Learner Evidence → 下一 Task / Replan / Goal 的消费情况不可见。
6. **已知产品缺口（Quick Learn 负责暴露，不负责修复）**：Goal 不读 Learner Snapshot；初始 Path 不用长期掌握记忆（只有 Replan 用）。

### 3.3 关键约束（来自 schema 与门禁）

- `learning_paths.activeGenerationRunId` 有 `@unique`，克隆必须置 null（`schema.prisma:621`）。
- `subtasks.userId` 是冗余索引列，`subtasks.usersId` 才是 FK（`:762,776`）——克隆时两列都要写目标 user。
- `milestones @@unique([learningPathId, stageNumber])`（`:703`）——新 pathId 下原样复制不冲突。
- 学习门禁：`assertTaskReadyForLearning` 要求 path.userId===userId、milestone.status!=='locked'；`aiPromptTemplate` 内含 `_generation.stageDesign==='succeeded'` 时直接放行（`learning.service.ts:1610-1616`）→ 克隆时原样复制该 JSON 即可通过门禁。
- Teaching 不检查 subtask.status，但 Quick Learn 自己拒绝 completed 任务（代学语义是“学一遍”）。

## 4. V1 范围

### 4.1 做

1. **Path 夹具克隆**：把任意已有 Path（含 milestones、subtasks 及全部教学标注字段）确定性复制到指定虚拟学习者 user 名下，状态全部重置，可立即开始学习。
2. **Quick Learn 运行器**：选定 Task → 自动学完 → 正常闭合课堂 → 完成任务 → 等待异步投影 → 生成报告。后台异步执行，状态持久化，支持轮询与中止。
3. **Propagation Report**：生命周期检查 + Learner Snapshot 前后对比 + 下游 Probe（Next Task / Replan / Goal）。
4. **Admin API**：夹具克隆、可学任务列表、启动/查询/中止/历史。
5. **前端最小入口**：VirtualProfile 页内“快速代学”面板（选任务 → 启动 → 进度 → 报告摘要）。

### 4.2 不做（明确非目标）

- 真实模拟模式 / 指定轨迹模式（V2；V1 仅 fast_forward 合作型）。
- AI Referee / Actor Auditor 接入（报告全确定性）。
- 跨 Run 统计、Suite、批量矩阵。
- 服务端断点续跑（进程中断的 running 记录标记为 interrupted）。
- Goal Probe 的真实运行（V1 输出静态能力结论）。
- 浏览器级 E2E。
- 修复任何被暴露的生产问题（如 Goal 不读画像）——Quick Learn 只报告。

## 5. 总体设计

```text
开发者
  │  ① POST /admin/virtual-learners/:id/quick-learn/fixtures {sourcePathId}   （可选）
  │     → PathFixtureService.clonePathToUser → fixturePathId（profile user 名下）
  │
  │  ② POST /admin/virtual-learners/:id/quick-learn/runs {taskId, maxTurns?}
  │     → 创建 virtual_quick_learn_runs(status=queued) → 立即返回 runId
  │
  ▼  ③ 后台执行（进程内，状态写库）
QuickLearnService.run()
  ├─ pre  = getSnapshot(user, {learningPathId, taskId, mode:'teaching'})
  │         + 预算 nextTask → preNextProjection = toTeachingProjection(snapshot')
  ├─ assertTaskReadyForLearning(taskId, userId)
  ├─ startSession({userId, taskId})                      ─┐
  ├─ loop（≤ maxTurns，默认 25）                          │ 真实生产链
  │    ├─ simulator(visibleContext, phase, prevState)    │
  │    ├─ processStudentMessage(sessionId, reply, rev)   │
  │    └─ 双重收束判定（teacherReady && learnerReady）     │
  ├─ endSession(endReason, rev)  → wrapup（同步）        ─┘
  ├─ completeTask({taskId, userId})（仅收束达成时）
  ├─ awaitProjection：轮询 inbox/freshness（≤45s）
  ├─ post = getSnapshot(...)
  ├─ PropagationReport = buildReport(pre, post, transcript, lifecycle)
  └─ 写回 runs(status=completed, report)
  │
  │  ④ GET /quick-learn/runs/:runId → {status, progress, report}
  ▼
前端报告面板
```

### 5.1 循环退出条件

| 条件 | 动作 | 报告标记 |
|---|---|---|
| teacherReady && learnerReady | endSession('quick-learn-completed') + completeTask | `completionReached: true` |
| teacherReady 但 learner 持续不认可（连续 >4 轮） | endSession('quick-learn-teacher-only-close')，**不** completeTask | `completionReached: false, divergence: 'teacher_ready_learner_not'` |
| learnerReady 但 teacher 始终不收束（至 maxTurns） | endSession('quick-learn-turns-exhausted')，不 completeTask | `divergence: 'learner_ready_teacher_not'` |
| autoEnded | 按收束达成处理 | transcript 中标记 |
| 中止请求 | endSession('quick-learn-aborted')，不 completeTask | `status=aborted` |
| 异常 | 尽力 endSession('quick-learn-error') | `status=failed, error` |

强制完成（教师未认可也 completeTask）在 V1 中**不提供**——那会污染“完成判断是否可信”这一被测对象。

### 5.2 可见上下文与学习者状态维护

- `transcript: [{role:'teacher'|'learner', content}]`；首轮 teacher 消息来自 startSession 的 opening。
- simulator 输入：`visibleContext.history`（截最近 12 条）、`lastTeacherMessage`、`currentPhase = 上一轮 learnerState.phaseFocus`（首轮 'trying'）、`previousLearnerState`、`currentTask{title, milestoneTitle}`、`knowledgeSnapshot: []`、`frictionBudget: 'none'`。
- 与 Assisted 一致：simulator 输出 degraded/无 reply 视为该轮失败，连续 3 次失败终止运行（避免无限烧 token）。

## 6. 详细设计

### 6.1 Path 夹具克隆 `PathFixtureService.clonePathToUser`

**签名**：`clonePathToUser(sourcePathId: string, targetUserId: string, options?: { titlePrefix?: string }) → { fixturePathId, milestoneCount, taskCount }`

**复制（逐字）**：
- path：title/name/description/subject/difficulty/estimatedHours/totalMilestones/aiGenerated/aiPromptTemplate/deadline/deadlineText。
- milestone：stageNumber/title/description/goal/estimatedHours/order/coreConceptId/coreConceptName。
- subtask：title/description/taskType/estimatedMinutes/acceptanceCriteria/order/cognitiveLoad 及全部教学字段（knowledgeType/cognitiveLevel/learningObjectives/coreConcept/displayLabel/linkedConceptId/linkedConceptName/annotationConfidence/transferable）。

**重置/改写**：
- path：新 id；userId=targetUserId；`status='active'`；`completedMilestones=0`；`activeGenerationRunId=null`；`sourcePathId=源 id`（血缘）；replanMode/replanReason/replanTriggerSource=null；title 加前缀 `[Fixture] `（可配）。
- milestone：新 id/learningPathId；第一个（order 最小）`status='active'`，其余 `'locked'`；unlockedAt/startedAt/completedAt=null。
- subtask：新 id/milestoneId（按旧 id 映射）；**userId 与 usersId 均=targetUserId**；`status='todo'`；completedAt/rating/feedback=null。
- learningContents：V1 不复制（Teaching 启动不读）。

单事务执行；源 path 任意 user 均可作为模板（admin 操作），产物只属于 targetUserId。

### 6.2 Quick Learn 运行器 `QuickLearnService`

新目录 `backend/src/virtual-lab/quick-learn/`：

- `quick-learn.service.ts`：运行生命周期（queued → running → completed/failed/aborted/interrupted）。
  - API 立即返回 runId；`setImmediate` 启动后台执行；每轮结束把 progress（当前轮次、最近动作）写库。
  - abort： runs 表 `abortRequestedAt` 标志，循环每轮检查。
  - 进程启动恢复：`recoverInterruptedRuns()` 把 updatedAt 超过 10 分钟的 running/queued 标记 `interrupted`（V1 不续跑）。
  - 幂等：startSession 对同 (userId, taskId) 已有 active session 的语义由生产代码保证（resumed）；endSession/completeTask 本身幂等。
- `propagation-report.ts`：纯函数报告构建（见 6.3）。
- `snapshot-diff.ts`：snapshot/projection 字段级 diff 工具（数字变化、集合增减、枚举迁移）。

### 6.3 Propagation Report（全确定性）

```jsonc
{
  "schemaVersion": "quick-learn-report-v1",
  "run": {
    "runId": "...", "mode": "fast_forward",
    "profileId": "...", "userId": "...",
    "pathId": "...", "taskId": "...", "taskTitle": "...",
    "status": "completed", "turns": 9, "durationMs": 183000,
    "startedAt": "...", "completedAt": "..."
  },
  "lifecycle": {
    "sessionStarted": true,
    "sessionClosed": true,
    "wrapupGenerated": true,
    "wrapupSource": "model",            // model | fallback | failed
    "completionReached": true,
    "divergence": null,                  // teacher_ready_learner_not | learner_ready_teacher_not | null
    "taskCompleted": true,
    "alreadyCompletedBefore": false,     // 防御：任务开始前已完成则拒绝运行，此处恒 false
    "outboxConsumerDone": true,          // inbox 轮询结果
    "projectionWaitMs": 3200,
    "warnings": []
  },
  "learnerDelta": {
    "metrics": { "before": {"lss":..,"ktl":..,"lf":..,"lsb":..}, "after": {...}, "changed": ["lss","ktl"] },
    "knowledge": {
      "newMastered": ["..."], "newFragile": ["..."], "newStruggling": ["..."],
      "resolvedStruggling": ["..."], "newRecurringConfusions": ["..."],
      "conceptLedgerAdded": 2
    },
    "controlState": { "before": {...}, "after": {...}, "changed": ["paceMode"] },
    "teachingHintsChanged": true,
    "freshness": { "before": {...}, "after": {...} }
  },
  "downstream": {
    "nextTask": {
      "taskId": "...", "title": "...",
      "projectionChanged": true,
      "changedFields": ["relevantKnowledge.mastered", "pathContext.completedPrerequisiteTasks", "liveState.lss"]
    },
    "replan": {
      "before": {"shouldSuggest": false, "priority": "none", "reasonCodes": []},
      "after":  {"shouldSuggest": true,  "priority": "medium", "reasonCodes": ["fragile-concepts"]},
      "signalChanged": true,
      "projectionAvailable": true
    },
    "goal": {
      "consumesLearnerSnapshot": false,
      "conclusion": "Goal 当前不读取 Learner Snapshot（已知产品缺口）；本节课数据不会影响新 Goal。",
      "evidence": "backend/src/services/learning/goal-conversation.service.ts: buildGoalConversationUserPayload 仅含 userInput/state/conversationContext"
    }
  },
  "transcript": [
    {"turn": 1, "learner": "...", "teacher": "...", "isCompletion": false,
     "strategies": ["scaffold"], "knowledgePoints": ["..."], "phaseFocus": "trying", "degraded": false}
  ]
}
```

**判定细节**：

- `outboxConsumerDone`：endSession 后从 `domain_event_outbox` 按 aggregateId=teachingSessionId 找 lesson:completed 事件，轮询 `domain_event_inbox` 出现该 eventId 的消费记录（≤45s，间隔 1s）；超时则 false 并加 warning（不判失败，因为 committed metric 是同步的）。
- `learnerDelta`：pre/post `getSnapshot(userId,{learningPathId, taskId, mode:'teaching'})` 字段级 diff（metrics、globalSignals 三集合、globalBackground.recurringConfusions/conceptLedger、learningControlState、teachingHints、freshness）。
- `nextTask`：run 开始前按“完成当前 task 后的下一个非 completed 任务”（扁平化 milestones×subtasks 顺序）预算 nextTaskId，并为它构建 pre-projection；完成后对同一 taskId 构建 post-projection，diff 顶层字段。若当前任务是最后一个，则 `nextTask=null` 并报告 path 是否整体完成。
- `replan`：pre/post `snapshot.replanSignal` + `toReplanProjection` 是否可得，只读。

### 6.4 数据模型（Main DB 新表）

```prisma
model virtual_quick_learn_runs {
  id               String    @id @default(uuid())
  profileId        String
  userId           String                       // profile 绑定 user，运行身份
  pathId           String
  taskId           String
  fixtureOfPathId  String?                      // 若跑在夹具上，记录血缘
  mode             String    @default("fast_forward")
  status           String    @default("queued") // queued|running|completed|failed|aborted|interrupted
  maxTurns         Int       @default(25)
  turns            Int       @default(0)
  teachingSessionId String?
  progress         String?                      // JSON：最近动作，供轮询展示
  transcript       String?                      // JSON：轮次记录
  report           String?                      // JSON：Propagation Report
  error            String?
  abortRequestedAt DateTime?
  startedAt        DateTime?
  completedAt      DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([profileId, createdAt])
  @@index([status])
  @@index([userId])
}
```

独立表而非复用 virtual_sessions：语义不同（无 goal/path 阶段状态机）、避免 SessionCockpit 误识别、可独立查询统计。Migration 走 main Prisma 标准流程。

### 6.5 Admin API（新文件 `backend/src/routes/admin/virtual-quick-learn.ts`）

挂载于既有 `/api/admin/virtual-learners` 同一 admin 保护下（`backend/src/index.ts:348` 区域新增 mount）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/:id/quick-learn/fixtures` | body `{sourcePathId, titlePrefix?}` → 克隆夹具到 profile user 名下 |
| GET | `/:id/quick-learn/tasks` | 列出 profile user 名下 active path 的可学任务树（path→milestones→subtasks，标注 status） |
| POST | `/:id/quick-learn/runs` | body `{taskId, maxTurns?}` → `{runId}`；校验任务归属 profile user、非 completed |
| GET | `/:id/quick-learn/runs` | 该 profile 的历史运行（分页） |
| GET | `/quick-learn/runs/:runId` | 单次运行状态 + progress + report |
| POST | `/quick-learn/runs/:runId/abort` | 请求中止 |

统一 admin 鉴权与错误格式（`{success, data|error, code?}`），参数校验与现有 virtual-learners 路由风格一致。

### 6.6 前端最小集成（控制器定位）

分工原则：**虚拟学习者管理页 = 运行控制器 + 历史索引 + 身份投影入口；普通用户前台 = 实际验收界面；数据库 = 每堂课记录与评价的永久留存。** Admin 不复刻课程、路径、学习状态等用户页面。

1. `frontend/src/api/adminApi.ts`：`adminVirtualLearnersApi` 增加 `cloneQuickLearnFixture / getQuickLearnTasks / startQuickLearnRun / getQuickLearnRuns / getQuickLearnRun / abortQuickLearnRun`（命名与 URL 模式对齐既有 Blackbox 组）。
2. `frontend/src/views/admin/components/virtual/QuickLearnPanel.vue`（新组件）：
   - 触发：VirtualProfile 页头“快速代学”按钮。
   - 任务选择 → 开始自动学习 → 运行中仅显示简洁状态（不展示逐轮过程）→ 完成后展示一句话结果与一行技术状态（课堂闭合/评价留存/任务完成/学习者数据已处理）。
   - 完成后提供真实前台入口（自动签发 Projection Token 以该学习者身份打开普通用户页面）：课程结果（`/learn/:taskId/evaluation/:sessionId`）、学习路径、学习状态、下一任务、学习首页。
   - “技术详情”折叠区保留生命周期 checklist 与 Learner Delta 摘要；完整 transcript 仅存后端，不在管理页展示。
   - 历史运行为简单索引列表，点击查看结果。
3. 不新增路由，不改 SessionCockpit。

## 7. 安全与边界

- 仅 admin 可调用；运行身份是 profile 绑定的 user（与普通用户数据隔离在同一套 user 边界规则内）。
- 夹具克隆只读源 path，不修改源数据；产物独立。
- Quick Learn 不放宽任何生产门禁：locked milestone、非本人 path、生成中 path 都会被 `assertTaskReadyForLearning` 拒绝。
- 不修改生产 Prompt、不写 learner 数据以外的任何业务表；所有学习者数据变化均由生产链自然产生。
- 资源保护：maxTurns 上限 40（默认 25）；simulator 连续失败 3 次终止；单 profile 同时只允许 1 个 running（DB 检查 + 进程内锁）。
- 已知误用提示：fast_forward 的完成不代表教育质量；报告面板固定展示该提示。

## 8. 测试计划

1. `path-fixture.service.test.ts`：字段复制完整性、状态重置、唯一约束（activeGenerationRunId）、userId/usersId 双写、血缘、门禁放行（aiPromptTemplate 原样）、源数据不可变。
2. `snapshot-diff.test.ts`：集合增减、指标变化、枚举迁移、空快照边界。
3. `quick-learn.service.test.ts`（mock simulator skill / teaching / learning service）：
   - 正常收束全流程（start→N 轮→end→complete→report）。
   - teacherReady 但 learner 不认可 → 不 completeTask + divergence 标记。
   - maxTurns 耗尽、simulator 连续失败、abort。
   - completed 任务拒绝、非本人任务拒绝。
   - 投影等待超时降级（outboxConsumerDone=false + warning）。
4. `routes` 安全测试：非 admin 拒绝、参数校验、归属校验。
5. 全量回归：后端 typecheck + 相关测试文件 + `npm test`（受影响范围）+ 前端 vite build。

## 9. 后续路线（V2+，仅记录不实施）

1. **真实模拟 / 指定轨迹模式**：mode 扩展（realistic / scripted），scripted 通过 simulator 输入增加轨迹目标实现；接入 Platform Referee / Actor Auditor。
2. **Goal Probe 真实化**：新 Goal 会话验证长期画像消费（依赖生产侧先接通 Learner→Goal）。
3. **跨 Run 统计**：runs 表已规范化，可加成功率/轮次分布/抖动分析。
4. **断点续跑**：基于 teachingSessionId + revision 恢复。
5. **与 GM 控制面汇合**：阶段快照 Fork、Prompt Override 实验、A/B 分支。

## 10. 改造清单总览

| # | 位置 | 动作 |
|---|---|---|
| 1 | `backend/prisma/schema.prisma` + migration | 新增 `virtual_quick_learn_runs` |
| 2 | `backend/src/services/learning/path-fixture.service.ts` | 新增夹具克隆服务 |
| 3 | `backend/src/virtual-lab/quick-learn/quick-learn.service.ts` | 新增运行器 |
| 4 | `backend/src/virtual-lab/quick-learn/propagation-report.ts` | 新增报告构建 |
| 5 | `backend/src/virtual-lab/quick-learn/snapshot-diff.ts` | 新增 diff 工具 |
| 6 | `backend/src/routes/admin/virtual-quick-learn.ts` | 新增 Admin API |
| 7 | `backend/src/index.ts` | 挂载路由 + 启动恢复 interrupted 记录 |
| 8 | `frontend/src/api/adminApi.ts` | 新增 6 个 API 方法 |
| 9 | `frontend/src/views/admin/components/virtual/QuickLearnPanel.vue` | 新增面板组件 |
| 10 | `frontend/src/views/admin/VirtualProfile.vue` | 页头接入入口 |
| 11 | 测试文件 ×4 | 见第 8 节 |
