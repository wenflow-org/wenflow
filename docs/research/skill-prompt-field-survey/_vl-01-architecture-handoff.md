# VL-01 虚拟学习者子系统与系统各阶段的对接机制（代码级专项调查）

- 仓库：D:\wenflow\wenflow，commit `e736f7aa`（2026-11-19）
- 主题：虚拟学习者（仿真 skill 9 个）在 goal / path / teaching 三个业务阶段上的编排、persona 供给、字段对接缝、日期模拟与风险
- 所有结论均带 `文件:行号`（相对 `backend/src` 或仓库根的路径）；字段底表见同目录 `_inventory-simulation-meta.md`

---

## 1 生命周期总览

### 1.1 双轨架构

一次黑盒演练会话有**两条互斥的实现轨**，由 `stageResults.experiment.mode` 区分：

- **assisted 轨**（编排状态机）：`SimulationOrchestrator`（`backend/src/coordinators/simulation.coordinator.ts:400`），状态存 `virtual_sessions.stageResults.{goal, path_review, teaching, runtimeStats, autopilot, simulationConfig, story}`；
- **blackbox 轨**（命令机）：`BlackboxVirtualLearnerRunner`（`backend/src/virtual-lab/blackbox-runner.ts:268`），状态存 `stageResults.{experiment, experimentSnapshot, blackbox.{publicTrace, refereeTrace, control, learnerPrivateState(Trace)}}`，每条命令落 `virtual_experiment_commands` 行 + Idempotency-Key 幂等（`blackbox-runner.ts:289-524`）。

### 1.2 一次会话从创建到终局（文字流程图）

```
[画像] virtual_learner_profiles.profile（personaSeed JSON + storyPool）
   │  POST /api/admin/virtual-learners                      routes/admin/virtual-learners.session-lifecycle.ts:121
   │  或 provisionVirtualProfile + persona/scenario designer virtual-lab/learner-provisioning.ts:46,135,199
   ▼
[选故事建会话] createSessionForProfile：storyPool 选 1 条 → stageResults.story + simulationConfig.frictionBudget
   │  blackboxOperatorId 有值 → createExperimentState（冻结 prompt/路由/温度快照）session-factory.ts:175-313, blackbox-runner.ts:581
   ▼
[Goal 阶段] currentStage='goal'
   ├─ assisted: executeSingleStep simulation.execution.ts:428
   │    开场轮（无 goalConversationId）：reply=storyDemand.text+scenarioBudget 行（不调模拟器）
   │      → goalConversationService.startConversation                    execution.ts:451-647
   │    后续轮：simulate-goal-dialogue skill ← learner/story/visibleContext/currentPhase/
   │      previousLearnerState/learnerMemory/frictionBudget              coordinator.ts:941-991
   │      → shouldEnd/repetition 兜底 → learnerEnded 终局                execution.ts:704-770
   │      → goalConversationService.continueConversation                 execution.ts:788-810
   ├─ blackbox: runCommand(step)→autoStep：goal 分支调同一 goal-dialogue skill  blackbox-runner.ts:1014-1044
   │    act(): chat / confirm_proposal → adapter.startGoal / replyGoal   blackbox-runner.ts:877-889
   ▼
[Goal 收敛判定] isGoalConverged；answer-only/oneoff/referral → noPath 合法终局（不进 path）execution.ts:564-605, 852-906
   ▼
[Path 阶段] currentStage='path'
   ├─ assisted: advanceToPathGeneration → buildGoalPathRequest（吃 Goal conversation.description）
   │      → pathCoordinator 异步生成 → waitForPathReady 轮询（进度签名续期）path-phase.ts:81-149, 214-232, 327
   │      评审环：reviewPathProposal（path-evaluate skill）→ accept / replan（上限 2）path-phase.ts:475, 606, 650
   │      resolvePathReview（startLearning:true）→ 进入 teaching          path-phase.ts:732-768
   ├─ blackbox: observe→visiblePath；start_learning 动作（**无 path-evaluate**）blackbox-runner.ts:1045-1055
   ▼
[Teaching 阶段] currentStage='teaching'
   ├─ assisted: startLearningPhase 开课（welcomeMessage 进 conversationHistory）learn-phase.ts（buildLessonOpeningHistory helpers.ts:922）
   │    executeLearningStep 每回合：
   │      ①读 pendingCheckpoint（getSessionDetail，答案键已剥离）          learn-phase.ts:974-987
   │      ②受控错误采样 decideControlledError（编排层）                    learn-phase.ts:993-1019
   │      ③simulation-epistemic-grounding skill（认知判决）                learn-phase.ts:1034-1057
   │      ④simulation-learn-turn skill（15 输入，见 §3.3）                 learn-phase.ts:1100-1135
   │      ⑤runTeachingTurnWithStepRetry：submitCheckpoint 或 processStudentMessage
   │           （AITeachingCoordinator，真实教学系统）                     coordinator.ts:769-916, learn-phase.ts:1248-1257
   │      ⑥收束判决→任务结算 completeCheckpointedSimulationTask：
   │           completeTask + endSession + 台账补记 + 温故回写 + 记忆回写   execution.ts:61-426
   │      ⑦transitionToNextLearningTask 开下一课（新课堂、清课内状态）      coordinator.ts:665-747
   │    executeAutoLearning = 上述循环至课界/预算界                        learn-phase.ts
   ├─ blackbox: autoStep teaching 分支：epistemic-grounding + learn-turn（同款输入）blackbox-runner.ts:1056-1199
   │    act(): chat / request_hint / request_example / submit_answer（buildCheckpointAction）
   │      / confirm_complete / request_extension（延伸课 ≤2 次、每课 ≤4 轮）blackbox-runner.ts:890-936, blackbox-checkpoint.ts:37-76
   │    confirm_complete → endTeaching → completeTask → getPath（三段 checkpoint）blackbox-runner.ts:1946-2017
   ▼
[终局] session.status ∈ completed / failed / abandoned
   completed：runCompleted（blackbox）或 isPathCompleted（assisted）          blackbox-runner.ts:1279-1330; execution.ts:294
   failed：persistLearningFailure（上游重试耗尽）                            coordinator.ts:1120-1175
        ｜ reclaim-stale 僵尸回收（24h）                                     routes/admin/virtual-learners.assisted-blackbox.ts:206-216
   abandoned：用户/批量 terminate                                             virtual-learners.assisted-shared.ts terminateSession
        ｜ 命令回执丢失 markSessionLostCommand                               blackbox-runner.ts:1607-1638
   可续跑暂停（非终局）：runtimeStats.lastError{retryable:true}              coordinator.ts:1187-1221
   ▼
[课后评估]（终态后手动触发）POST /api/admin/session-audits/sessions/:id/evaluations
   referee 终局评审 + actor-audit 角色保真审计（读 publicTrace/privateState） blackbox-runner.ts:696-759, 761-862; session-audits.ts:24-36
[课后 wrapup] assisted：generateWrapupForSession → teaching-wrapup skill → stageResults.teaching.wrapup   learn-phase.ts:2905-2990
   blackbox：endSession 走 finalization 产出 wrapup                           execution.ts:120-153
```

### 1.3 驱动者表

| 驱动者 | 入口 | 驱动方式 | 轨 |
|---|---|---|---|
| 驾驶舱手动单步/自动 | `POST /sessions/:id/step｜auto｜advance-path`（`routes/admin/virtual-learners.assisted-runtime.ts:44,80,115`） | `executeSingleStep / executeAutoLoop / advanceToPathGeneration` | assisted |
| 教学面 | `start-learning｜teaching-step｜auto-learning｜run-full｜wrapup｜restart-*｜pause｜hold…`（`virtual-learners.assisted-teaching.ts:27-351`） | `startLearningPhase / executeLearningStep / executeAutoLearning / executeFullSession` | assisted |
| Path 评审面 | `review-path｜accept-path｜replan-path｜retry-path-generation`（`virtual-learners.assisted-path.ts:16-243`） | `reviewPathProposal / acceptPathReview / replanPathFromReview` | assisted |
| 黑盒实验面 | `start-blackbox-session｜blackbox-action｜blackbox-step｜blackbox-observe｜blackbox-rerun`（`virtual-learners.assisted-blackbox.ts:23-133`） | `runner.act / autoStep / observe / createSessionForProfile(rerun)` | blackbox |
| 自动驾驶 autopilot | `autopilot/start｜stop`（`assisted-blackbox.ts:162-197`） | 后台循环：assisted=goal 逐轮+path 等待+learn 分片（`autopilot.service.ts:675-917`）；blackbox=逐 autoStep（`:1077-1135`）；阶段级 target='stage'（`:1152-1390`） | 双轨自适应（`resolveMode :262`） |
| advance-day 日期推进 | `advance-day`（`virtual-learners.assisted-simulation.ts:189-276`） | `runWithSimulatedClock` 内 `runDayLearning`（`assisted-shared.ts:470-533`）→ `resolvePathReview/executeAutoLearning` | assisted（黑盒被 `assertDateSimulationAllowedForSession` 显式拒绝 `:205-211`） |
| 跑批 harness | `scripts/simulate-learner-e2e.ts` + 纯函数 `services/virtual-lab/run-harness.ts:1-60` | HTTP 驱动 advance-day，断点续跑/按天分类 | assisted |
| 批量实验矩阵 | `services/virtual-lab/batch-experiment.service.ts` | 批量建学习者/故事/会话并跑 | 双轨 |
| 回收/终止 | `sessions/reclaim-stale｜sessions/terminate`（`assisted-blackbox.ts:206-265`） | 只改状态+审计，不删数据 | 双轨 |

### 1.4 终局判定清单

| 终局 | 触发点 | 证据 |
|---|---|---|
| `learnerEnded` | 模拟器自报 `shouldEnd===true` → `learnerEndReason`（leaving/satisfied/declining/no_more_questions） | `simulation.execution.ts:704-770`；字段声明 `prompts/core/simulation-goal-dialogue.yaml:77-84` |
| `repetition-loop` | 确定性兜底：连续短告别句或与最近两条发言三字组重合 ≥0.35 | `simulation.goal.steps.ts:106-145`；触发 `execution.ts:706-729` |
| `noPath` | answer-only/oneoff/referral 收敛但不排课（开场或后续轮） | `execution.ts:564-605, 852-906` |
| `completed` | assisted：`isPathCompleted`（`execution.ts:294`）；blackbox：`control.runCompleted`（`blackbox-runner.ts:1280, 1329`） | |
| `failed` | 上游重试耗尽 `persistLearningFailure`；abort-like 改写为可续跑暂停不终局（`coordinator.ts:1120-1133`）；僵尸回收 `reclaim-stale`（`assisted-blackbox.ts:206`） | |
| `abandoned` | 用户/批量 terminate；黑盒命令回执丢失；黑盒 `abandon` 动作（`blackbox-runner.ts:873-876, 1329`） | |
| 兜底护栏 | `repetition-loop`（上表）；教学回合抖动暂停 `TEACHING_TURN_STEP_PAUSED`（`coordinator.ts:135-136, 1187`）；预算耗尽 `RETRY_BUDGET_EXHAUSTED`（`coordinator.ts:589-601`）；path 重规划上限 `MAX_PATH_REPLANS=2` 后 force-accept（`path-phase.ts:46, 206-228`）；无进展看门狗 `no_progress_watchdog`（`autopilot.service.ts:825-851`）；解绑课堂续跑上限 3（`execution.ts:1200-1240`） | |

---

## 2 persona 供给链

### 2.1 persona 从哪来

1. **管理台手建**：`POST /api/admin/virtual-learners`，body.profile 即 personaSeed，整包 JSON 存 `virtual_learner_profiles.profile`；创建时把 personaSeed 内层 `availableTime/cognitiveLoadTolerance` 抬到顶层防收紧失效（`routes/admin/virtual-learners.session-lifecycle.ts:121-225, 52-60`）。
2. **persona-designer skill 生成**：`generateAndApplyPersona` 合并 DB profile + 调用方覆盖为 `existingPersonaSeed`，调 `simulation-persona-designer`，产出 `personaSeed` 写回 `profile` JSON（`virtual-lab/learner-provisioning.ts:135-184`；学生样本提示必须用键 `recentPersonaHints`，`:157-160`）。缺省兜底 `ensurePersonaFallbacks` 补 9 个必填字段（`:97-114`；story-drafts 重复一份 `routes/admin/virtual-learners.story-drafts.ts:302-311`）。
3. **草稿面**：story-drafts 先出 personaSeed（`anchorPersonaIdentity` 锚定 identity）→ 确认后落库（`virtual-learners.story-drafts.ts:233-258`）。
4. **预置/卡库**：builtin-learners seeder（presetKey 幂等，`learner-provisioning.ts:11` 注释声明独立）与 `card-import.service.ensureCardKey`（`session-lifecycle.ts:156-158`、`learner-provisioning.ts:66`）。

### 2.2 存哪

- 主体：`virtual_learner_profiles.profile`（JSON：personaSeed 全字段 + `storyPool` + `runtimePrefs` + `simulationClock` + 卡 key）；列字段 `learningGoal/knownConcepts/struggleConcepts/personalityTraits/simulationTemperature`（`learner-provisioning.ts:67-81`）。
- 身份：`users` 行 `isVirtualLearner:true`，email `virtual_*@test.local`，随机密码不可登录（`learner-provisioning.ts:47-62`、`session-lifecycle.ts:160-177`）。
- 会话侧快照：`stageResults.story`（当前故事切片）+ `stageResults.learnerContext`（= profile 整包）+ blackbox `stageResults.experimentSnapshot.actorProfile`（`session-factory.ts:272-298`、`blackbox-runner.ts:2982-3005`）。

### 2.3 怎么进 prompt

- **learner 键**：编排层只传 5 件套 `{profile(整包), learningGoal, knownConcepts, struggleConcepts, personalityTraits}`（`coordinator.ts:956-963`、`learn-phase.ts:1103-1109`、`blackbox-runner.ts:1023`）；skill wrapper 再加工：`knownConcepts/struggleConcepts` 从 learner 剥离为尾部 `conceptProgress`（KV 缓存稳定前缀优化，`skills/simulation-learn-turn/index.ts:520-532, 593-609`）。
- **personaAnchorHint**：不是逐画像数据，是**平台常量字符串** `PERSONA_FIELD_ANCHORS_HINT`（点名 verbosity/confusionStyle/questionStyle/emotionalRange/helpSeekingPattern/adversarialPattern/emotionalTriggers/failurePatterns + story.disclosurePlan/pressurePoints 十个锚点），由 wrapper 在 payload 稳定前缀注入（`skills/virtual-learner-shared/schemas.ts:388-401`；`simulation-learn-turn/index.ts:581, 597`；声明处 `prompts/core/simulation-goal-dialogue.yaml:44-46`、`simulation-learn-turn.yaml:79-81` ref `sandbox:simulation.personaAnchorHint`）。**后端编排层从不传该键**（grep 无编排侧写入）。
- **friction**：编排传标签 `frictionBudget`（`helpers.ts:946-950` 读 `stageResults.simulationConfig.frictionBudget`；blackbox 读冻结快照 `blackbox-runner.ts:2958-2967, 2999-3000`），wrapper 每轮采样 `decideFrictionTrigger`（`schemas.ts:243-255`）合成 `{budget, triggerProbability, triggered, guidance}` 注入（`simulation-learn-turn/index.ts:503, 575-580`）。
- **storyPool→storyHistory**：发送前深投影把画像里 `storyPool`（含别的故事 `hiddenDetails/disclosurePlan/goalSeed` 私有底牌）收敛为只带 `title+summary` 的 `storyHistory`，防串场防泄底（`skills/virtual-learner-shared/payload-projection.ts:1-98`；挂载点 `simulation-learn-turn/index.ts:666`；提示词消费规则 `simulation-learn-turn.yaml`「learner.profile.storyHistory…只用来让你显得有生活史」）。
- **existingPersonaSeed / existingStoryPool**：只作为 **designer skill 的输入**（persona/scenario 生成时的素材），不进对话轮 payload（`learner-provisioning.ts:148-160, 207-217`）。

### 2.4 storyPool / storyHistory 读写方

| 方向 | 主体 | 证据 |
|---|---|---|
| 写 | scenario-designer 生成追加 | `learner-provisioning.ts:226-234` |
| 规整（补 id/标题） | `ensureProfileStoryPool`（锁内重读防覆盖记忆回写） | `session-factory.ts:85-115` |
| 读（会话启动选故事） | `pickStoryFromPool`：多故事必须显式 storyId | `session-factory.ts:151-166, 206-236` |
| 读（管理台列表） | storyPool 计数展示 | `session-lifecycle.ts:324` |
| 读（模拟器） | 投影为 storyHistory | `payload-projection.ts:58-98` |
| 写（课后记忆，另一条 JSON 通道） | `writeProfileConceptsAfterLesson / recordCompletedArtifact`（knownConcepts/struggleConcepts/recentCompleted，锁 `vlab-profile:<userId>`） | `virtual-lab/learner-memory.ts`、`coordinators/simulation.memory.ts:210-238`、`session-factory.ts:91-98` |

---

## 3 阶段对接缝逐个核对

### 3.1 goal ↔ 模拟器

**assisted 轨**（`executeSingleStep`，`simulation.execution.ts:428`）：

| 键 | 谁产出 | 传递键 | 谁消费 | 断线行为 |
|---|---|---|---|---|
| story | `createSessionForProfile` 写 `stageResults.story`；`parseStoryContextFromStageResults` 读 | `story` | goal-dialogue skill | 无 story 时 `resolveStorySessionDemand` 回落 `profile.learningGoal`，再缺 → 开场轮抛错拒绝推进（`execution.ts:454-469`；`virtual-lab/story-demand.ts:60-86`） |
| visibleContext | goal_conversations.collectedData 历史（`parseGoalConversationHistory`）+ `buildGoalVisibleContext`（净化/限长） | `visibleContext.{history,lastGoalAgentMessage}` | goal-dialogue | `coordinator.ts:965`、`helpers.ts:802-820` |
| currentPhase | `goalState.stage` 映射 opening/understanding/proposal_evaluation | `currentPhase` | goal-dialogue | `execution.ts:677`、`helpers.ts mapGoalStageToLearnerPhase` |
| previousLearnerState | `stageResults.goal.learnerState`（上一轮写回） | `previousLearnerState` | goal-dialogue | 首轮 null（`execution.ts:678`；首轮写回 `:526-531`） |
| learnerMemory | `buildAssistedLearnerMemory(userId)`（memory_traces + 画像 + 成果物） | `learnerMemory` | goal-dialogue | 无 userId → null（`coordinator.ts:953-955`；`simulation.memory.ts:51-88`） |
| frictionBudget | `stageResults.simulationConfig.frictionBudget`（会话级标签） | `frictionBudget` | wrapper→`friction` | 缺省 `normal`（`helpers.ts:946-950`；`schemas.ts:208-213`） |
| shouldEnd / endReason | 模拟器输出字段 | — | 协调器 → `learnerEnded/learnerEndReason/learnerEndedAt` 写 `stageResults.goal` | 见 V-H2：仅 autopilot 消费 |
| 确认拍板 | 学习者 reply 文本（goal-confirm-adjudicator 裁决）；env `VIRTUAL_LEARNER_PROXY_CONFIRM=1` 才按 readyToAdvance 代发 | — | goalConversationService | `execution.ts:795-810` |
| → `stageResults.goal` | 协调器 | `success/finalStage/learningPathId/learnerState/concernPool/disclosedConcerns/responseTriage/lastRuntimeEnvelope` | 驾驶舱/autopilot/后续轮 | `execution.ts:778-784, 861-872, 917-929` |

**blackbox 轨**（`autoStep` goal 分支，`blackbox-runner.ts:1014-1044`）：同款 skill；差异键——`visibleContext` 来自 `publicTrace` 的 `visibleMessages`（`visibleHistory :2472-2474`）、`previousLearnerState` 来自 `blackbox.learnerPrivateState.goal`（`:1030`）、`frictionBudget` 来自**冻结快照**（`:1032` + `:2958-2967`）、`confirm_proposal` 按 `availableActions + learnerState.readyToAdvance`（`:1037-1038`）；`shouldEnd` **不消费**（见 V-M2）。

**终局键 → 消费方**：`buildGoalStepResult` 透出 `goalReady/learnerEnded/learnerEndReason/noPath`（`goal.steps.ts:74-102`）。autopilot 消费 `noPath`（标记 completed 收口）与 `learnerEnded`（markStopped，`autopilot.service.ts:653-669`）；`executeAutoLoop/executeFullSession` 只认 `goalReady`（`execution.ts:1015-1062, 1125-1130`，见 V-H2）。

### 3.2 path ↔ 模拟器

**输入来源**：不是 `stageResults`，而是**平台库表**——`prisma.learning_paths.findUnique` + `prisma.milestones.findMany`（`path-phase.ts:497-508`），拼成 `pathProposal{title,description,totalMilestones,estimatedHours,difficulty,milestones[{stageNumber,title,description,estimatedHours}]}`（`:515-527`）。Goal 产物走 `conversation.description` → `GoalPathRequest.rawGoal`（`path-phase.ts:214-232`；`story-demand.ts:resolvePathRawGoalFromSession`），故事本身**不进 Path**（领域边界 `story-demand.ts` 头注释）。

| 键 | 谁产出 | 谁消费 | 断线行为 |
|---|---|---|---|
| `learner` | 画像整包（含 `resolveLearnerLoadProfile` 抬升的顶层负荷字段） | path-evaluate | `path-phase.ts:493, 231` |
| `pathProposal` | learning_paths/milestones 表 | path-evaluate | 路径缺失 → 抛「学习路径不存在」`:489-503` |
| `previousReaction` | `stageResults.path_review` | path-evaluate | 首评 null `:529` |
| `learnerState` | `path_review.learnerState ∥ goal.learnerState` 经 `mergeLearnerState` | path-evaluate | `:531` |
| `learnerMemory` | `buildAssistedLearnerMemory` | path-evaluate | `:511` |
| `frictionBudget` | 会话级标签 | path-evaluate | `:532` |
| `goalState` | **恒 null** | path-evaluate | `:528`（见 V-M6） |
| 输出 decision | `debug.internalDecision`（非 accept/modify/reject 一律回落 accept） | `stageResults.path_review` | `:542-544, 565-577` |
| 收敛护栏 | `shouldForceAcceptPathReview`：同路径已重规划过或 replanCount≥2 → force-accept | resolvePathReview | `path-phase.ts:206-228, 732-768` |

**blackbox 轨不运行 path-evaluate**：autoStep path 分支仅 `observe`（`adapter.getPath`）+ `start_learning`（`blackbox-runner.ts:1045-1055`）；观察面的 `visiblePath` 只带 milestone 标题/描述（sanitize 截断 `:2846-2850`）。评审语义只存在于 assisted（见 V-M1）。

### 3.3 teaching ↔ 模拟器

**learn-turn 15 输入字段（yaml 声明 ↔ 编排实传对照）**，声明见 `prompts/core/simulation-learn-turn.yaml:12-90`：

| # | yaml 输入 | assisted 实传（`simulation.learn-phase.ts:1100-1135`） | blackbox 实传（`blackbox-runner.ts:1135-1157`） | 备注 |
|---|---|---|---|---|
| 1 | learner | 画像 5 件套 | 快照 actorProfile | wrapper 再剥离概念数组 |
| 2 | conceptProgress | wrapper 由 learner 合成 | 同左 | `simulation-learn-turn/index.ts:532` |
| 3 | story | `stageResults.story` | 快照 story | `:1110` / `:1140` |
| 4 | visibleContext | `trimmedConversationHistory`(≤6) + lastTeacherMessage（assistant→teacher 改名） | `visibleLessonHistory`(本课起截断).slice(-6) | `helpers.ts:705`、`runner :1062-1069, 2481-2493` |
| 5 | currentPhase | `learnerState.phaseFocus` | `learnerPrivateState.teaching.phaseFocus ∥ 'trying'` | `:1119` / `:1145` |
| 6 | previousLearnerState | `mergedLearnerState` | `learnerPrivateState.teaching` | |
| 7 | currentTask | `{title, milestoneTitle, acceptanceCriteria, description}`（subtasks 表） | observation.visibleTask | `:1121-1127` / `:1147` |
| 8 | knowledgeSnapshot | `loadTeachTurnKnowledgeAssets`：本课看板优先 → memory 快照 | `buildLearnerKnowledgeSnapshot` | `simulation.memory.ts:114-143`、`runner :2230-2248` |
| 9 | learnerMemory | 含 `recentDetails`（成果物/记忆增量） | 无 recentDetails（只 4 名单） | `memory.ts:51-88`、`runner :2254-2270` |
| 10 | temporalContext | `simulatedDayService.getTemporalContext`（日期模拟开才注入） | **不注入**（黑盒禁日期模拟） | `:1090, 1133`；§4 |
| 11 | memoryRecall | `buildAssistedMemoryRecall`（dayIndex 做步进种子） | `buildLearnerMemoryContextForSimulator`（sessionId 种子） | `memory.ts:94-108`、`runner :2276-2298` |
| 12 | epistemicGrounding | epistemic-grounding skill 产出 + forcedCorrectness 覆写 | 同构 | `:1034-1087` / `:1089-1134` |
| 13 | personaAnchorHint | **编排不传**；wrapper 注入常量 | 同左 | `schemas.ts:388-401` |
| 14 | friction | 编排传 `frictionBudget`；wrapper 采样合成 | 同左（快照标签） | §2.3 |
| 15 | pendingCheckpoint | `aiTeachingOrchestrator.getSessionDetail().pendingCheckpoint`（答案键已剥离） | observation.visibleCheckpoint（题面） | `:976-987` / `:1153` |

另有编排加传、yaml 未声明的 `routingUserId`（扮演身份=VL 本人，接独立 RPM 桶，`learn-phase.ts:1038, 1102`）。

**受控错误（编排层采样）**：`decideControlledError`（`schemas.ts:310-382`：head 2 轮豁免、struggle∩本课概念域、误区语料库 `config/misconception-corpus`）→ `forcedCorrectness` 硬指令进判决器；判决器不服从时编排层兜底覆写 `sampledCorrectness:false/masteryProb:0.15`（`learn-phase.ts:1061-1086`；`runner :1109-1133`）。服从核验 `auditGroundingCompliance` + 掌握度钳制（`learn-phase.ts:1141-1162`）。

**与真实 teaching skill 的镜像关系**：真实教师回合由 `AITeachingCoordinator.processStudentMessage / submitCheckpoint` 承载，输入由 `buildTeachingTurnInput` 组装，7 个声明输入为 `learner/knowledge/classroomContext/classroomEventContext/controls/scenario/interactionProfile`（`prompts/core/teaching-turn.yaml` inputs 7 键；`services/ai-teaching/teaching-turn-shared.ts:65, 164-173, 233-235`）。**模拟器不消费教师侧注入键**：`scenario`（taskKcs/cognitiveFrame/materials/taskProfile/pathProgress）、`interactionProfile`（出题节奏画像）、`controls.checkpointVerdict`（判卷结果结构键）均教师专用；模拟器侧的镜像只有——`visibleContext` ↔ 教师看到的课堂消息、`pendingCheckpoint` ↔ 教师挂载的检查点题面。checkpointVerdict 对学习者的回传走**自然语言**：`normalizeCheckpointSubmitTurn` 把 `feedback` 当 `aiResponse` 写进可见历史（`coordinator.ts:356-398`），可见历史里的作答用 `buildCheckpointLearnerVisibleMessage` 与实际提交 payload 对齐（`:323-346`，P0-4）。

**checkpointAnswer ↔ checkpointVerdict 闭环**（两条轨都已闭合）：
- assisted：`resolveCheckpointSubmitAction`（存在待答检查点 + 模拟器给出合法作答才提交；非法 id 丢弃/单选取一/简答只认 answerText/空 payload 退回聊天）→ `submitCheckpoint` → 失败回退 `processStudentMessage`（`coordinator.ts:190-229, 769-812`；挂载 `learn-phase.ts:1248-1257`）。
- blackbox：`buildCheckpointAction`（合法选项→submit_answer；文本→submit_answer；allowSkip→skip；全无→选第一项，保「答错可重答」路径）→ `adapter.submitTeachingCheckpoint`（`blackbox-checkpoint.ts:37-76`；`runner :903-908, 1173`）。
- 已知残留：中断窗口两轨差一轮不自动对账（`coordinator.ts:830-835` 注释留痕，属产品决策）。

**wrapup**：assisted `generateWrapupForSession` 业务闸（任务结算后）→ `sessionWrapupAgent.generate` → `stageResults.teaching.wrapup`（`learn-phase.ts:2905-2990`）；blackbox 走 `endSession('task-completed')` 的 finalization + `recordDirectTaskCompletion` 台账 + `applyWarmupExtractionForSession` 温故回写（`execution.ts:120-199`）。

### 3.4 沙盘键注册与对账

- `SANDBOX_EXTRA_KEYS['simulation-agent']` 共 50 键（`services/agent-contract-view.ts:170-223`）：对话轮键 `learner/story/visibleContext/currentPhase/previousLearnerState/currentTask/knowledgeSnapshot/learnerMemory/knownConcepts/struggleConcepts/conceptProgress/temporalContext/memoryRecall/personaAnchorHint/friction/forcedCorrectness/pendingCheckpoint/task/goalState/pathProposal/previousReaction/learnerState`；评估键 `publicTrace/refereeTrace/control/experimentSummary/storyMeta/metricCompleteness/actorProfile/frictionBudget/learnerPrivateState`；designer 键 `preferredLevels/candidatePersonas/recentPersonaHints/existingPersonaSeed/preferredDomains/preferredGoalTypes/preferredMotivations/avoidDomains/candidateDomains/recentScenarioHints/existingStoryPool`；curator 键 `persona/turnSequence/existingKnown/existingStruggle`。
- 对账规则（`prompts:check-handoff:strict` = `ts-node src/scripts/check-input-handoffs.ts --strict`，`backend/package.json:45,64`）：core yaml 的 inputs ref 必须 ①`skill:Y.F` 在上游路由表有产出且 handoff 指向本 skill；②`sandbox:<agent>.<key>` 的 agent 属顶层 5 agent 且 key 解析到 routings 通道、产出字段或 `SANDBOX_EXTRA_KEYS`（`validateSandboxPath`，`agent-contract-view.ts:312-332`；规则注释 `check-input-handoffs.ts:14-17`，违规码 `sandbox-ref-unregistered`/`sandbox-path-unregistered`，strict 退出码 1 `:70`）。运行时另有只读旁路对账 `checkAgentSandboxRefsFromContext`（blackbox 每次模拟器调用前异步执行、失败不阻断，`blackbox-runner.ts:3162-3171`）。

---

## 4 日期与时间感

- **状态与解析**：`stageResults.simulationClock{baseDate,dayIndex,timezone,enabled,autoAdvance,history}`；优先级 session > profile > 全局设置，baseDate 同口径，dayIndex=已推进天数（`services/virtual-lab/simulated-day.service.ts:198-215`）。日窗 `resolveDayWindow` 映射为 `baseDate+dayIndex` 的应用时区日界，`asOf=当日 23:59:59-1ms`（`:152-166`）。
- **推进入口**：`POST /sessions/:id/advance-day`（1..60 天；`runTasks` 一次只准 1 天）：非 teaching 先 `resolvePathReview(startLearning)`（未进 Learn 视为没上课、回滚时钟不消耗模拟日）→ 在 `runWithSimulatedClock(dayWindow.asOf)` 内 `runDayLearning`（`lessonsPerDay` 节 `executeAutoLearning`，解绑课堂重启一次）→ 只有当天确实上课才 `mergeSessionStageResults` 推进时钟（`routes/admin/virtual-learners.assisted-simulation.ts:189-276`；`virtual-learners.assisted-shared.ts:470-533`）。
- **写入侧同钟**：AsyncLocalStorage 携带 asOf，写点用 `simulatedNowOr()`（无上下文=真墙钟，现网零变化），如完课台账 `asOf`（`simulation.execution.ts:112-114`）、下一课时间戳（`coordinator.ts:687`）；autopilot 后台链显式绑钟防「同表双钟」（`autopilot.service.ts:597-606`）。
- **读侧注入（时间感）**：`simulatedDayService.getTemporalContext`（显式 override 优先，否则取 ALS 当前 asOf，防「推进前 dayIndex 注入当天课堂」#172-5）产出 `{simulatedDay, dayIndex, simulatedNow, timezone, sinceLastSessionDays}`，注入 learn-turn `temporalContext`（`simulated-day.service.ts:695-723`；`learn-phase.ts:1090, 1133`）。`sinceLastSessionDays` 按**课表**口径计算（`previousCourseDayGap`，`:234-251`）；提示词约束「可选，不得改对错判决、不得编造跨度」（`simulation-learn-turn.yaml` temporalContext 输入 + 规则）。
- **memory-curate/到期复习依赖**：`dueReview` 来自 `memoryTraceService.getDueTraces`（FSRS/retention），到期比较用 `simulatedNowOr()`；管理端读侧不在 ALS 内会回落真墙钟，故 `buildLearnerMemorySnapshot` 支持显式传 `now`（`virtual-lab/learner-memory.ts:470-505`）。到期点进一步经 `buildMemoryRecallHints` 按 `(会话, dayIndex/stepIndex, 概念)` 派生确定性随机流做「这次还想不想得起来」代码裁决（CLEAR/VAGUE/CONFUSED/FAILED 硬约束，`simulation.memory.ts:94-108`、`blackbox-runner.ts:2276-2298`；声明 `simulation-learn-turn.yaml` memoryRecall 输入）。**即：日期模拟推进 dayIndex → FSRS 到期面扩大 → dueReview/memoryRecall 让学习者「隔了几天快忘了」**。
- **黑盒轨边界**：黑盒会话禁开日期模拟（`assertDateSimulationAllowedForSession`，配置与 advance-day 双处显式拒绝，`assisted-simulation.ts:78-87, 205-211`），blackbox-runner 全程不绑模拟钟、写真实墙钟——防同一会话双时间口径。

---

## 5 对接风险清单

编号 V-H1…；严重度 H=会造成错误行为/资源浪费且无对冲，M=语义缺口或单侧失效有留痕，L=已知受控残留。

**V-H1（H）TIR 摩擦反馈闭环三处落空（写入目标 ≠ 任何读方）**
actor-audit `frictionCalibration<60` → `bumpFrictionBudget` 上调后写回 `stageResults.simulationConfig.frictionBudget`（`blackbox-runner.ts:836-848`）。但：① blackbox 会话运行中读方是**冻结快照** `experimentSnapshot.frictionBudget`（`getExperimentSnapshot` 快照优先，`blackbox-runner.ts:2958-2967`；autoStep `:1032, 1151`）→ 本 run 不生效；② rerun 重建会话时取 `snapshot.frictionBudget` 原值而非被上调后的 simulationConfig（`routes/admin/virtual-learners.assisted-blackbox.ts:77`）→ 跨 run 也不生效；③ 只有 assisted 轨 `getSessionFrictionBudget` 读 simulationConfig（`helpers.ts:946-950`），而 TIR 评估只在 blackbox 终态产生。注释只修了「写画像级」的旧问题（`:823-830`），未修「读冻结快照」。结果：校准反馈通道整体死写。

**V-H2（H）`learnerEnded`/`noPath` 终局只被 autopilot 消费，run-full/auto-loop 空转烧预算**
`executeAutoLoop` 循环条件只有 `!success` 与 `goalReady`（`simulation.execution.ts:1015-1062`），`executeFullSession` 只看 `lastGoal.goalReady`（`:1125-1130`）；而 `learnerEnded` 步返回 `success:true, goalReady:false`（`goal.steps.ts:74-102`），且 `executeSingleStep` 的闸门只挡 `failed/abandoned` 与非 goal 阶段、**不检查 `stageResults.goal.learnerEnded` 已置位**（`execution.ts:443-449, 741-750`）。学习者已告别后，run-full/auto-loop 会继续逐轮重跑对话到 `maxRounds`，每轮白烧 2 次 LLM 调用且计入会话预算（`coordinator.ts:589-601`）。autopilot 有专门分支（`autopilot.service.ts:653-669`），两条驱动路径行为不一致。

**V-M1（M）blackbox 轨不执行 path-evaluate，评审证据链缺失**
assisted 有评审环（`path-phase.ts:475, 606, 650`）；blackbox autoStep path 分支只有 observe + `start_learning`（`blackbox-runner.ts:1045-1055`），学习者的路径接受是隐式的。referee 的 `stageCoverage.path` 只反映「有 path 观测」（`blackbox-runner.ts:2702-2709`），审计方无法区分「评审后接受」与「未评审直接开课」两轨。

**V-M2（M）blackbox goal 轮忽略 `shouldEnd/endReason`，学习者无法主动离场**
goal-dialogue 输出声明 `shouldEnd/endReason`（`prompts/core/simulation-goal-dialogue.yaml:77-84`），assisted 消费为终局（`execution.ts:704-729`）并配 repetition 兜底（`goal.steps.ts:106-145`）；blackbox autoStep goal 分支只取 `output.reply` 造 chat/confirm_proposal（`blackbox-runner.ts:1019-1038`），`shouldEnd` 被丢弃 → 黑盒学习者只能靠 `abandon` 动作或平台侧收口结束 goal，「像真人一样离场」的人设行为在黑盒轨结构性不可达。

**V-M3（M）referee 与 actor-audit 输入互不包含，且双评估串行一损俱损**
`buildRefereeInput` = `{publicTrace, refereeTrace, control, experimentSummary, storyMeta, metricCompleteness}`（`blackbox-runner.ts:2604-2625`），不含 `actorAuditReports`；`buildActorAuditInput` = `{actorProfile, story, frictionBudget, learnerPrivateState(+trace), publicTrace, experimentSummary}`（`:2678-2692`），不含 referee 结论。裁判看不到「扮演保真度」证据、审计看不到「平台合规」裁决，两报告结论无法交叉引用。另外 `POST /session-audits/sessions/:id/evaluations` 在同一对象字面量里串行 await，referee 抛错即整个请求失败、actor 报告也不产出（`routes/admin/session-audits.ts:27-31`）。

**V-M4（M）friction/判错采样双点双掷，语义只有 wrapper 单点裁决**
同一 `frictionBudget` 标签驱动两个独立采样器：对抗触发 `decideFrictionTrigger` 在 **skill wrapper**（`simulation-learn-turn/index.ts:503`；`Math.random`），首答判错 `decideControlledError` 在**编排层**（`learn-phase.ts:993-1019`、`blackbox-runner.ts:1072-1087`）。同源✓（都归一化到同一张表 `schemas.ts:126-199, 265-276`），但 `triggered`（对抗）与 `forced`（判错）各自独立掷骰，「触发对抗的轮次未必判错、判错轮未必对抗」，且采样结果除 `friction.guidance` 文本外无结构化留痕（session 日志无 triggered 字段），跑批统计要靠文本反推。goal/path/learn 三 skill 各自内联同一 wrapper 模式，若把采样上收编排层只改一处即三处漂移。

**V-M5（M）personaSeed 31 字段「整包进 payload、少数被点名」**
persona 全字段随 `learner.profile` 整包进 payload（`simulation-learn-turn/index.ts:597-609`），但提示词锚点常量只点名 10 个字段（`schemas.ts:388-401`）；`communicationStyle/corePersonality/personalityDrivers/resiliencePattern/metacognitiveProfile/selfRegulationStyle/digitalLiteracy/memoryRepairPattern/behaviorBoundaries/learningPreferences` 等（persona schema `schemas.ts:30-69`）以及故事的 `behaviorHooks/misdiagnosis` 只能靠模型自主挖掘，无规则引导。设计者侧声明 `personalityDrivers/emotionalTriggers/failurePatterns` 是 friction 行为的直接依据（`prompts/core/simulation-persona-designer.yaml:44`），其中 `personalityDrivers` 不在锚点提示内——设计意图与消费面不对齐（非断线，是「注入了但未被点名消费」）。

**V-M6（M）path-evaluate 的 `goalState` 恒 null，评审器对「谈定的方案」失明**
编排实传 `goalState: null`（`path-phase.ts:528`）；goal 对话的产物（confirmedProposal/understanding，`coordinators/goal.definition.ts:16` variableGraph 登记 `learnerContext` 通道）没有进入评审输入，评审器只能对 pathProposal 本身反应，「Path 是否符合当初确认的诉求」这条判断只能靠 learnerState/story 间接携带。yaml 声明 `goalState` 输入（`prompts/core/simulation-path-evaluate.yaml`）与实参长期不一致（check-handoff 只对账 ref 注册，不对账实参非空）。

**V-L1（L）检查点闭环已闭合，中断窗口两轨差一轮为已知残留**
assisted（`coordinator.ts:190-229, 769-812`）与 blackbox（`blackbox-checkpoint.ts:37-76`）闭环成立；被中断回合「已落教师会话、虚拟侧历史未写回」的轮次差不自动对账，注释明确留作产品决策（`coordinator.ts:830-835`）。

**V-L2（L）终态语义分桶在消费方已对齐**
`abandoned`（terminate / 命令回执丢失 / abandon 动作）与 `failed`（上游耗尽 / 僵尸回收）在 referee 准入（`blackbox-runner.ts:700`）、executeSingleStep 闸（`execution.ts:443-445`）、runCommand 终态闸（`blackbox-runner.ts:113, 320-322`）、列表分桶统计（`session-lifecycle.ts:261-272`）口径一致，未发现单侧漏判。

**V-L3（L）时间感注入面不对称（有意为之）**
`temporalContext` 只进 learn-turn（`learn-phase.ts:1090`），goal/path 评审无时间键；黑盒全轨禁日期模拟（`assisted-simulation.ts:78-87, 205-211`）。到期复习（dueReview/memoryRecall）依赖 `simulatedNowOr`，黑盒禁止开日期模拟的闸门挡住了双钟风险；管理端读侧显式传 `now` 的约定见 `learner-memory.ts:470-478`（M-16）。

**V-L4（L）goal 开场轮绕过模拟器（双轨同构，风险低）**
开场 reply 固定 `storyDemand.text` + 场景卡预算行（`execution.ts:454-466`），learnerState 从画像确定性推导（`:475-480`），开场不调 goal-dialogue（P2-10 修复：防白烧 LLM 与状态不自洽）；blackbox 开场同构（`blackbox-runner.ts:1006-1013`）。断线行为：诉求链全空时双轨都显式报错拒绝推进（`execution.ts:467-469`、`runner :1012`）。

**V-L5（L）模拟器冻结路由只套主叙事器，判决器旁路**
blackbox 只对 goal/learn 主模拟器套冻结路由（快照 route/prompt/温度），epistemic-grounding 等旁路 skill 走平台正常路由——否则每次被 provider 校验打回静默降级（2026-11-13 实证，`blackbox-runner.ts:3172-3176`）。代价：同一回合内叙事器与判决器可能落在不同模型/渠道，判决-叙事一致性依赖 prompt 硬约束而非运行时同源。

---

### 附：本报告与字段底表的关系
- 字段级（每 skill 输入/输出字段清单）以 `_inventory-simulation-meta.md` 为准；本报告负责「字段背后的谁产出/谁消费/断线行为」。
- 关键对照结论：`friction`、`personaAnchorHint`、`conceptProgress` 三个 yaml 声明输入由 **skill wrapper 在 payload 装配层合成**（编排层传的是 `frictionBudget` 标签），`goalState`（path-evaluate）声明但恒 null（V-M6），`shouldEnd`（goal）声明但 blackbox 不消费（V-M2）。
