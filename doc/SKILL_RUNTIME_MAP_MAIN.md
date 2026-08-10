# 主链 Skill 运行环境地图（goal / path / teaching / profile）

> 审计产物（只读调查，2026-08-10）。证据精确到 `file:line`，行号以本次调查时仓库状态为准。
> 领域名词：编排文件 = `prompts/orchestration/{goal,path,teaching,profile,simulation}.yaml`；控制面 = `prompts/core/<skillId>.yaml`；配置式抽取 = `services/field-dispatcher/index.ts` 的 `assemble*`/`extractFieldsByPath`。

---

## 一、分节档案

### skill:goal-conversation（目标对话 Skill）

- **声明**：`prompts/orchestration/goal.yaml` 编排字段 31 个（hard-required 4 / soft-info 12 / hidden-inference 3 / proposal-output 4 / public-reply 3 / control-signal 5，见 goal.yaml:14-185）；路由行 31 个，产出均 handoff 给 goal-agent（goal.yaml:190-390）。
- **agent 归属**：manifest kind=skill、category=goal（agent-manifest.service.ts:137-150，aliases: goal-conversation-agent）；所属顶层 agent = `goal-agent`（agentMembers 唯一成员，agent-manifest.service.ts:67-69）；coordinator definition 位置：goal.definition.ts:7-13（step 1，loopOver conversation-rounds）。
- **调用链**：唯一运行时调用点 `goal-conversation.service.ts:636`（`executeSkill(goalConversationAgentDefinition, ...)`），调用者链：`routes/goal-conversation.ts:193/236`（用户请求）→ `coordinators/requirement.coordinator.ts:16/27` → `GoalConversationService.startConversation/continueConversation` → `callAI`（service:593）。输入为**手拼 buildUserPayload**（service:636-649：userInput/conversationHistory/previousUnderstanding/previousState），另有 sandbox 只读对账（service:619-633）；无配置式抽值输入。输出收取：skill 内部 `parseGoalConversationResponse` + `normalizeGoalConversationModelPayload`（skills/goal-conversation/index.ts:570-589），service 侧 `getStructuredOutputValid`/`resolveStageFromResponse` 读 `aiResponse.userVisible`、`aiResponse.internal.ext.goalConversation`（service:117-160、713-714）。skill 内还反向消费路由表：`getAgentRoutings('goal-conversation')` 取 hard-required 清单刷新 prompt 守卫（skills/goal-conversation/index.ts:537-551）。
- **流转**：handoff 目标 `[goal-agent]`（goal.yaml:193 等，stage=goal 内）；goal-agent 桥接路由 23 条 handoff `[path]`（goal.yaml:393-540）。数据落库：`goal_conversations.collectedData` JSON（service:760-767：understanding/confirmedProposal/structuredData/confidenceScores/runtimeEnvelope/normalizedGoalState），并 enqueue `goal:understanding:updated` 事件（service:768-783）；confirmProposal 硬规则建占位路径 `learning_paths`（service:451-477、562-588）。下游消费方：`path.coordinator`（同进程传参）、outbox 消费者（learner_evidence，见 LearnerEvidenceProjector.ts:21）、`profile-aggregator.fetchGoalConversationData`（profile-aggregator.ts:193-253）。
- **运行环境**：对话会话（用户请求驱动，HTTP 路由 → service → skill）。触发方式：用户消息/UI 显式确认（confirmProposal，service:426-428）。失败语义：结构化输出无效抛 422 `STRUCTURED_OUTPUT_INVALID`（service:246-252、509-518），skill 内格式重试预算 `MAX_FORMAT_RETRIES=2`（service:95）；executor 另按 retryBudget 逻辑重试（skills/executor.ts:161-166）。

### skill:path-planning（路径规划 Skill）

- **声明**：`prompts/orchestration/path.yaml` 编排字段 11 个（path.id/name/summary/totalMilestones、cognitiveCore.* 2、milestones.* 5；path.yaml:89-136）；路由 11 行，handoff 至 path-agent 与 skill:stage-designer（path.yaml:313-379）。
- **agent 归属**：manifest kind=skill、category=path（agent-manifest.service.ts:153-164）；所属顶层 agent = `path-agent`（agentMembers 含 skill:path-planning、skill:stage-designer，agent-manifest.service.ts:80-84）；coordinator definition：path.definition.ts:15-21（step 2，role cognitive-core-and-milestones）。
- **调用链**：唯一调用点 `learning.service.ts:2509`（`executeSkill(pathAgentDefinition, ...)`，调用者 `analyzePathWithAgent` ← `generateLearningPath` ← `path.coordinator.generate`，path.coordinator.ts:380-406）。输入组装：**配置式 handoffFields 优先 + visibleSummary 确定性回退** —— `buildGoalPathRequest` 调 `assembleGoalHandoff`（goal-conversation.service.ts:808-834），`buildNormalizedInputV1` 按 routings 表 goal-agent 交付行 pathInRawOutput 抽值（path.coordinator.ts:164-227），再经 `buildFramedNormalizedInput` 定帧（path.coordinator.ts:355、learning.service.ts:2491-2507）。输出收取：`normalizeAgentOutput('skill:path-planning', agentResult)`（learning.service.ts:2514，函数在 agents/output-normalizer.ts:9），读 `internal.ext.path.path`/`internal.path`/`agentResult.path`（learning.service.ts:2515-2518）。
- **流转**：handoff 目标 `[path-agent, skill:stage-designer]`（path.yaml:313-379）；path-agent → teaching 聚合 handoff 6 行（path.yaml:432-467，声明语义，无 assemble 消费，见总结节缺口）。数据落库：`learning_paths` 行（learning.service.ts:2623-2646 更新 / 2653-2677 创建：title/name/description/subject/totalMilestones/aiPromptTemplate 含 pathName/summary/cognitiveDesign/suggestedMilestones）、`milestones` 行（learning.service.ts:2684-2703）；enqueue `path:created`（learning.service.ts:2765-2778）。下游消费方：stage-designer（同进程 cognitiveCore/milestones）、teaching 经 DB 读取（TeachingContextBuilder.ts:393-427）。
- **运行环境**：路径生成（后台任务 `learning.path.goal-generation`/`learning.path.async-generation`，path.coordinator.ts:426-499）。触发方式：goal 确认后异步（goal-conversation.service.ts:462-477）、API/learn/replan（learning.service.ts:2509 上游）。失败语义：失败抛 `PATH_GENERATION_FAILED`（learning.service.ts:2575）；path_generation_runs 留痕 + 启动/定时恢复轮询 `recoverStaleGeneratingPaths`/`retryEligibleFailedPathPreparations`（index.ts:659-674）；core.yaml failurePolicy: retry（path-planning.yaml:108）。

### skill:stage-designer（阶段设计 Skill）

- **声明**：`prompts/orchestration/path.yaml` 编排字段 8 个（subtasks.title/type/estimatedMinutes/acceptanceCriteria/linkedConcept/knowledgeType/cognitiveLevel/transferable；path.yaml:138-171）；路由 8 行 handoff `[path-agent]`（path.yaml:381-429）；另有 path-agent 注入行 `previousMilestone`（path.yaml:303-310，loopOver 上下文）。
- **agent 归属**：manifest kind=skill、category=path（agent-manifest.service.ts:165-176）；所属顶层 agent = path-agent；coordinator definition：path.definition.ts:21-27（step 3，loopOver milestones）。
- **调用链**：两个调用点，均在 `learning.service.ts`：① 首生成 `:2933`（`processStageDesign`，milestones 循环、2 路并发：2971-2976）；② replan/修复 `:4093`（repair milestone 子任务）。输入组装：调用点①走**配置式** `assembleStageDesignerChannels({ previousMilestone })`（learning.service.ts:2899-2913，field-dispatcher/index.ts:204-217），并拼 stageDesignerBaseInput（cognitiveCore+normalizedInput，learning.service.ts:2863-2866）；调用点②为**手拼**（learning.service.ts:4067-4092，previousMilestone 由代码按 sortedMilestones 组装）。输出收取：直接读 `stageResult.subtasks`（learning.service.ts:2935、4095），`assertStageTasksPresent` 校验。
- **流转**：handoff 目标 `[path-agent]`；`previousMilestone` 注入行 handoff `[skill:stage-designer]`（path.yaml:304-310）。数据落库：`subtasks` 行（learning.service.ts:3001-3024：title/type/estimatedMinutes/acceptanceCriteria=taskData.acceptanceHint/…/transferable）、stageDesignRawOutputs 写回 `learning_paths.aiPromptTemplate.stageDesigns`（learning.service.ts:3032-3043）；enqueue `path:generated`（learning.service.ts:3062-3075）。下游消费方：teaching（subtasks → TeachingContextBuilder.ts:393-405 读取 task/milestone/path）。
- **运行环境**：路径生成（后台阶段任务，stageDesign run phase：path_generation_runs phase='stageDesign'，learning.service.ts:2741-2757）。触发方式：path-planning 成功后自动（enrichment 阶段）；replan 触发。失败语义：单阶段失败整批打 failed（learning.service.ts:3120-3132）但路径保持骨架可用（learning.service.ts:3114），run retryAllowed=false，由恢复轮询重试（index.ts:662）；core.yaml failurePolicy: retry（stage-designer.yaml:67）。

### skill:teaching-turn（教学回合 Skill）

- **声明**：`prompts/orchestration/teaching.yaml` 编排字段 14 个（reply、analysis.* 6、knowledge.* 2、pedagogy.strategies、control.* 4；teaching.yaml:17-75）；路由 14 行（teaching.yaml:211-308）；另有 teaching-agent → teaching-turn 输入通道 5 行（learner.learnerProjection/knowledge.state/controls.teachingControlContext/classroomContext/visibleDialogueContext，teaching.yaml:310-350）。
- **agent 归属**：manifest kind=skill、category=teaching（agent-manifest.service.ts:179-191）；所属顶层 agent = teaching-agent（agentMembers 首位，agent-manifest.service.ts:95-101）；coordinator definition：ai-teaching.definition.ts:21-27（step 3，loopOver messages）。
- **调用链**：唯一调用点 `AITeachingCoordinator.processStudentMessage` `:1399`（`executeSkill(teachingTurnAgentDefinition, turnInput, ...)`）。输入组装：`buildTeachingTurnInput`（AITeachingCoordinator.ts:767-890）——**配置式通道优先** `assembleTeachingTurnChannels({ session, teachingState, context })`（:854，field-dispatcher/index.ts:218-231），按 teaching.yaml pathInRawOutput（`context.learnerProjection`/`session.knowledgeState`/`teachingState.teachingControlContext`/`teachingState.classroomContext`/`session.messages`）抽值，缺失回退手拼（:863-888）；另有 sandbox 对账（:829-847）。输出收取：`extractTeachingOutput`（AITeachingCoordinator.ts:949-954，读 `internal.ext.teachingTurnOutcome.artifact`，skill 侧装配在 skills/teaching-turn/index.ts:641）；`reconcileTeachingKnowledgeState` 合并知识看板（:918-947）。
- **流转**：handoff 目标 `[teaching-agent]`（analysis.cognitiveLevel/understanding 另含 `skill:peer-reinforcement`，teaching.yaml:248-261；control.shouldTriggerPeer 同，:287-293）。数据落库：本轮状态经 `commitTurnState` 写 `teaching_sessions.messages/knowledgeState/teachingState`（AITeachingCoordinator.ts:1726-1733 → TeachingSessionRepository.ts）；最终随 lesson 事件沉淀（见 session-wrapup）。下游消费方：peer-reinforcement（PeerTriggerService.ts:33 读 `control.shouldTriggerPeer`、:49 读 `analysis.understanding`）、knowledgeStateService.merge、checkpoint 门禁（submitCheckpoint :2150-2210）。
- **运行环境**：对话会话（教学会话 LearnStage 状态机，用户消息触发 processStudentMessage）。触发方式：用户消息/checkpoint 作答（submitCheckpoint → processStudentMessage，:2190）。失败语义：`turnResult.success=false` 直接 throw（:1406-1408）；completion 为知识看板硬门禁 + envelope soft 信号（:1421-1434）；executor 按 retryBudget 重试；core.yaml failurePolicy: retry（teaching-turn.yaml:139）。

### skill:peer-reinforcement（伴学补强 Skill）

- **声明**：`prompts/orchestration/teaching.yaml` 字段 2 个（message、followUpQuestions；teaching.yaml:105-113）；路由 2 行 handoff `[teaching-agent]`（teaching.yaml:352-364）。
- **agent 归属**：manifest kind=skill、category=teaching（agent-manifest.service.ts:192-204，aliases: peer-agent）；所属顶层 agent = teaching-agent；coordinator definition：ai-teaching.definition.ts:28-34（step 4，condition when control.shouldTriggerPeer = true）。
- **调用链**：两个调用点：① `AITeachingCoordinator.ts:1470`（processStudentMessage 内，peerTriggerService 判定后）；② `:2588`（processPeerMessage，用户单独发起伴学对话）。输入**手拼**（:1458-1468 / :2589-2600：topic/strategy/studentMessage/tutorContext/cognitiveLevel/understanding/peerHistory），无配置式抽值。输出收取：`peerResult.internal?.ext?.peer?.message || peerResult.userVisible`（:1483、2613），`extractPeerDebug`（:956-958）。
- **流转**：handoff 目标 `[teaching-agent]`；trigger 信号 control.shouldTriggerPeer 由 teaching-turn 产出并经 PeerTriggerService 消费（PeerTriggerService.ts:9-55，含 help-keyword 与低理解度窗口两个非模型触发源）。数据落库：伴学消息带 `peer:true` 标记 append 进 `teaching_sessions.messages`（:2616-2619）。下游消费方：classroomEventHistory 'peer-support' 事件（:1537-1541）、wrapup 上下文。
- **运行环境**：对话会话（教学会话内嵌流程）。触发方式：模型控制信号/帮助关键词/理解度窗口（PeerTriggerService.ts:32-54）。失败语义：catch 后仅 warn 不阻断主回合（:1488-1490）；core.yaml failurePolicy: fallback（peer-reinforcement.yaml:56）。

### skill:session-wrapup（课后产出 Skill）

- **声明**：`prompts/orchestration/teaching.yaml` 字段 15 个（summary.* 10、evaluation.* 5；teaching.yaml:115-175）；路由 15 行 handoff `[teaching-agent]`（teaching.yaml:366-463）。
- **agent 归属**：manifest kind=skill、category=teaching（agent-manifest.service.ts:205-217）；所属顶层 agent = teaching-agent；coordinator definition：ai-teaching.definition.ts:43-49（step 6，condition when session ends）。
- **调用链**：唯一调用点 `AITeachingCoordinator.endSession` `:1842`（`executeSkill(sessionWrapupAgentDefinition, ...)`）。输入**手拼**（:1843-1879：messages/knowledgePoints/sessionInfo/learningState/knowledgeContext/sessionEvidence/sessionStructure）。输出收取：`wrapupOutput.internal.ext.sessionWrapup.result/artifact`（:1892-1893），`hasReliableSessionEvaluation` 门禁（:1898-1906）。
- **流转**：handoff 目标 `[teaching-agent]`；teaching-agent → profile 累积路由含 summary.knowledgeItems/evaluation.sessionLss/sessionKtl/sessionLf 等 8 行（teaching.yaml:515-571，声明语义，无 assemble 消费）。数据落库：`teaching_sessions.wrapup` JSON（TeachingSessionRepository.ts:1052，经 completeWithEvent :981-1065）；evaluation 经 `prepareSessionScoreCommit`（learning-state.service.ts:706-774）投影后写 `learning_metrics`（TeachingSessionRepository.ts:1027-1028）；`lesson:completed` 事件 data.wrapup/advisory/performance（AITeachingCoordinator.ts:1981-2006）。下游消费方：ReplanAdvisoryService.build（AITeachingCoordinator.ts:1963-1972）、DashboardGuidanceSnapshotService（assembleLearningState 读 wrapup）、LessonKnowledgeEnrichmentConsumer（data.wrapup，LessonKnowledgeEnrichmentConsumer.ts:37）、learner_evidence 投影。
- **运行环境**：对话会话收束（endSession 状态机，finalization lease 保护）。触发方式：用户/系统结束会话、超时兜底（:2556-2559 写 fallback wrapup）。失败语义：core.yaml failurePolicy: fallback（session-wrapup.yaml:74）；skill 内部 fallback wrapup + `session-evaluation-fallback` aux skill（skills/session-wrapup/index.ts:630-631）；endSession 外层 5 次重试（AITeachingCoordinator.ts:1920、2030-2037）。

### skill:adaptive-guidance-copy（自适应引导文案 Skill）

- **声明**：`prompts/orchestration/teaching.yaml` 字段 8 个（headline/subtitle/todayActions/nextStep/pathHint/paceHint/emptyStateCopy/warningCopy；teaching.yaml:177-209）；路由 8 行 handoff `[teaching-agent]`（teaching.yaml:465-513）。
- **agent 归属**：manifest kind=skill、category=teaching（agent-manifest.service.ts:218-229）；所属顶层 agent = teaching-agent（agentMembers 末位）；coordinator definition：**不在 AITeachingCoordinatorRuntimeDefinition steps 中**（ai-teaching.definition.ts:6-58 无此 skill）——声明归属 teaching 但执行体在 dashboard 后台服务。
- **调用链**：两个运行时调用点：① `DashboardGuidanceSnapshotService.performRefresh` `:149`（`executeSkill(adaptiveGuidanceCopyDefinition, { view:'dashboard', learnerSnapshot, learningState, path, sessionWrapup, advisory, userId })`，输入来自 assembleLearningState 共享聚合 :132）；② `LearningStateGuidanceService.perform` `:89`（view='learning-state'）。触发接线：`refreshInBackground(userId, trigger)`（:118-124），trigger 来自 path-created（learning.service.ts:3098）、lesson-wrapup（AITeachingCoordinator.ts:2041）、启动回填（index.ts:676-679）。
- **流转**：handoff 声明 `[teaching-agent]` 无运行时消费；实际产物直接落 `users.dashboardGuidanceSnapshot` JSON（DashboardGuidanceSnapshotService.ts:182-187）与 learning-state 页按需生成（LearningStateGuidanceService.ts:73-129）。下游消费方：前端 Dashboard/learning-state 页（field-lineage.ts:44-45 有标注）。
- **运行环境**：后台事件（dashboard 快照服务，非教学对话链）。触发方式：事件（path-created/lesson-wrapup）+ 启动回填 + 页面按需。失败语义：skill 内部 fallback/cache（executor 的 quality/cached 桥接，executor.ts:94-107）；refresh 失败返回 null 不阻断（DashboardGuidanceSnapshotService.ts:190-197）。

### skill:lesson-knowledge-enricher（课后知识增强 Skill）

- **声明**：`prompts/orchestration/profile.yaml` 字段 5 个（conceptLedger/reusableFoundations/blockedFoundations/transferSignals/recurringConfusions；profile.yaml:17-38）；路由 5 行 handoff `[profile-agent]`（profile.yaml:70-106）。
- **agent 归属**：manifest kind=skill、category=profile（agent-manifest.service.ts:246-257）；所属顶层 agent = profile-agent（agentMembers 之一，agent-manifest.service.ts:111-114）；coordinator definition：learner.definition.ts:14-20（step 2，condition when lesson ends）。
- **调用链**：唯一调用点 `LessonKnowledgeEnrichmentConsumer.handle` `:27`（outbox 消费者，接线 index.ts:621-648）。输入**手拼**（:28-42：knowledgeState/knowledgeDelta/wrapup/taskContext/sessionEvidence/visibleDialogueContext/classroomEventHistory，均来自 lesson:completed 事件 data）。输出收取：直接读 enriched.conceptLedger 等（:44-53）。
- **流转**：handoff 目标 `[profile-agent]`（聚合终点，profile.yaml:167-174 注明"learner 画像终点"）。数据落库：`learner_evidence` 两行（session-knowledge-distilled / dialogue-concepts-extracted，:61-92），幂等 via `domain_event_inbox`（:93-99）。下游消费方：`LearnerKnowledgeMemoryService.build` 聚合进 globalBackground（LearnerKnowledgeMemoryService.ts:160-169、650-660）→ snapshot.globalSignals/currentPath → learner_projections。
- **运行环境**：后台事件（outbox 消费者，lesson:completed）。触发方式：事件驱动（DurableOutboxWorker）。失败语义：core.yaml failurePolicy: fallback（lesson-knowledge-enricher.yaml:46）；消费者幂等（inbox 去重）；worker 重试预算 MAX_ATTEMPTS（outbox.worker.ts:118）。

### skill:learner-model（学习者模型 Skill）

- **声明**：`prompts/orchestration/profile.yaml` 字段 7 个（snapshot.dynamicState/learningControlState/replanSignal/teachingHints/knowledgeMemory.currentPath/knowledgeMemory.globalSignals/profile.curriculumControls；profile.yaml:40-68）；路由 7 行 handoff `[profile-agent]`（profile.yaml:108-164，注明"确定性聚合产出，非 LLM 输出"）。
- **agent 归属**：manifest kind=skill、category=profile、`noPromptFile: true`（agent-manifest.service.ts:232-245，handler-only）；所属顶层 agent = profile-agent；coordinator definition：learner.definition.ts:6-13（step 1，role goal-and-learning-signal-ingestion）。
- **调用链**：**无 executeSkill 调用**。handler `learnerModelAgentHandler`（agents/learner-model-agent/index.ts:235-240）仅注册进 gateway agent-registry 供可发现性（agents/index.ts:81、98-115）。真实执行体是绕开 handler 的直接服务调用：`LearnerSnapshotRefreshService.refresh`（:33 `learnerSnapshotService.getSnapshot`）→ `LearnerSnapshotService.getSnapshot`（:164-273）组装 dynamicState（:198）/teachingHints（:224）/learningControlState（:236）/replanSignal（:240）/knowledgeMemory（:232），profile 由 `LearnerProfileService.getProfile` → `profileAggregator.aggregateProfile`（LearnerProfileService.ts:14，profile-aggregator.ts:153-169 产 profile 含 curriculumControls）；learner.definition.ts step1 的"信号摄入"实际落在 `profileAggregator.fetchGoalConversationData`（profile-aggregator.ts:193-253，读 learner_evidence 的 goal:understanding:updated + goal_conversations.collectedData）。
- **流转**：handoff 目标 `[profile-agent]`（终点）；profile-agent 行注明"写入 snapshot 与 projection"（profile.yaml:167-262）。数据落库：`learner_projections`（snapshot 全量 JSON，LearnerSnapshotRefreshService.ts:41-64）；画像源在 `learner_evidence` + `goal_conversations.collectedData.learner_background`（applyUpdate 写回，profile-aggregator.ts:709-740）。下游消费方：teaching（TeachingContextBuilder.ts:420-427 → toTeachingProjection）、ReplanAdvisoryService、dashboard 服务、quick-learn、admin learner-models。
- **运行环境**：画像刷新（后台事件 outbox 消费者序列，index.ts:631-645）。触发方式：事件驱动（goal:understanding:updated / task:completed / lesson:completed / path:*）。失败语义：refresh 有 lastEventId 幂等快照短路（LearnerSnapshotRefreshService.ts:20-31）；profile 5min 缓存（LearnerProfileService.ts:6-11）。

---

## 二、总结节

### 1. 运行环境分类表

| 环境 | 成员 skill | 触发源 | 输入来源 | 持久化去向 |
|---|---|---|---|---|
| **对话环境**（goal 对话会话） | skill:goal-conversation | 用户消息 / UI 确认（routes/goal-conversation.ts:193,236） | 手拼 payload：previousState + 可见历史（goal-conversation.service.ts:636-649） | goal_conversations.collectedData（:760-767）+ goal:understanding:updated 事件（:768-783） |
| **路径生成环境**（后台阶段任务） | skill:path-planning、skill:stage-designer | goal 确认异步（service:462-477）/ API / learn / replan | 配置式 goalHandoffFields（path.coordinator.ts:164-227）+ assembleStageDesignerChannels（learning.service.ts:2899）；replan 手拼（:4067-4092） | learning_paths / milestones / subtasks（learning.service.ts:2623-3024）+ path:created/path:generated 事件（:2765,3062） |
| **对话环境**（教学会话） | skill:teaching-turn、skill:peer-reinforcement、skill:session-wrapup | 用户消息 / checkpoint 作答 / 会话结束（AITeachingCoordinator.ts:1399,1470,1842,2150） | 配置式 assembleTeachingTurnChannels（:854）+ 手拼（wrapup :1843-1879、peer :1458-1468） | teaching_sessions.messages/knowledgeState/teachingState/wrapup/advisory（TeachingSessionRepository.ts:1038-1053）+ learning_metrics（:1027-1028）+ lesson:completed 事件（AITeachingCoordinator.ts:1981-2006） |
| **后台事件**（dashboard 引导） | skill:adaptive-guidance-copy | 事件（path-created / lesson-wrapup）+ 启动回填 + 页面按需（index.ts:676-679；AITeachingCoordinator.ts:2041；learning.service.ts:3098） | assembleLearningState 共享聚合（DashboardGuidanceSnapshotService.ts:132） | users.dashboardGuidanceSnapshot（:182-187） |
| **画像刷新环境**（outbox 消费者） | skill:lesson-knowledge-enricher、skill:learner-model（执行体为 LearnerSnapshotService/ProfileAggregator，非 handler） | 事件：goal:understanding:updated / task:completed / lesson:completed / path:created / path:generated / path:adjusted / path:completed（index.ts:623-646） | 事件 data（LessonKnowledgeEnrichmentConsumer.ts:17-42）；证据表重放（LearnerSnapshotService.ts:164-189） | learner_evidence（LearnerEvidenceProjector.ts:21、LessonKnowledgeEnrichmentConsumer.ts:61）+ learner_projections（LearnerEvidenceProjector.ts:44、LearnerSnapshotRefreshService.ts:41）+ goal_conversations.collectedData.learner_background（profile-aggregator.ts:737-740） |

### 2. 阶段间数据流转总图（文字版）

```
goal 阶段                              path 阶段                                teaching 阶段                           profile 阶段
─────────                            ─────────                               ────────────                           ────────────
用户消息 → routes/goal-conversation   skill:goal-conversation 产出
  → requirement.coordinator          ├─ userVisible / internal.ext.goalConversation
  → GoalConversationService.callAI      （goal-conversation.service.ts:636）
      ↓ skill 输出                     ↓ 同进程（事件链 A）
  goal:understanding:updated 事件 ──→ outbox ──→ learner_evidence(goal:...) → profile-aggregator（画像源）
      （service:768-783）                                                       │
  [A] 同进程传参：buildGoalPathRequest                                       （服务调用链 C）
      （service:822-842, 配置式 assembleGoalHandoff :808）
      ↓ pathOrchestrator.runGoalAsync / generateFromGoal（service:462-477, :902）
  ────────────────────────────────────
  path 阶段：path.coordinator.buildNormalizedInputV1（handoffFields 优先 + visibleSummary 回退，path.coordinator.ts:164-227）
      → learning.service.analyzePathWithAgent（:2509 executeSkill path-planning；normalizeAgentOutput :2514）
      → persistGeneratedPath（learning_paths/milestones，:2579-2784；path:created 事件 :2765）
      → enrichLearningPathWithAnderson（:2786；assembleStageDesignerChannels :2899；executeSkill stage-designer :2933；subtasks :3001；path:generated 事件 :3062）
      ↓ [B] 事件链 B（outbox）：path:created/path:generated → learnerEvidenceProjector → learner_projections → snapshot 刷新（index.ts:623-646）
      ↓ [C] DB 直读：teaching 侧无 handoff 消费方，TeachingContextBuilder 直接查 subtasks/milestones/learning_paths（TeachingContextBuilder.ts:393-427）
  ────────────────────────────────────
  teaching 阶段：AITeachingCoordinator.processStudentMessage
      → buildTeachingTurnInput（配置式 assembleTeachingTurnChannels :854；executeSkill teaching-turn :1399）
      → PeerTriggerService（control.shouldTriggerPeer / understanding 窗口）→ executeSkill peer-reinforcement :1470 / :2588
      → endSession（executeSkill session-wrapup :1842；metrics → learning_metrics :1920-1936, TeachingSessionRepository.ts:1027-1028；
         lesson:completed 事件 :1981-2006，data 含 wrapup/advisory/knowledgeState）
      ↓ [B] 事件链 B：lesson:completed / task:completed（learning.service.ts:4501）→ outbox 消费者
  ────────────────────────────────────
  profile 阶段：index.ts:623-646 消费者序列
      learnerEvidenceProjector.handle（learner_evidence + learner_projections.events）
      lessonKnowledgeEnrichmentConsumer.handle（executeSkill lesson-knowledge-enricher :27 → learner_evidence 蒸馏行）
      learnerSnapshotRefreshService.refresh（LearnerSnapshotService.getSnapshot 装配 snapshot.* → learner_projections 快照行）
      ↓ [D] 服务调用链：teaching 侧实时读 snapshot（TeachingContextBuilder.ts:420-427）、endSession 预览快照（AITeachingCoordinator.ts:1952-1958）
```

四条 transfer 通路汇总：
1. **同进程传参（goal→path）**：goal-conversation.service.ts:808-842 → path.coordinator.ts:164-227（配置式抽取优先）。
2. **事件 outbox（goal→profile、path→profile、teaching→profile）**：enqueue（service:768、learning.service.ts:2765/3062、AITeachingCoordinator.ts:1981）→ DurableOutboxWorker（index.ts:647-648）→ 消费者（index.ts:621-646）。
3. **DB 直读（path→teaching）**：无 handoff 消费方，TeachingContextBuilder.ts:393-427 直接查表；wrapup/advisory 亦经 teaching_sessions 表（TeachingSessionRepository.ts:1038-1053）。
4. **服务调用（profile→teaching 回流）**：learnerSnapshotService.getSnapshot / toTeachingProjection（TeachingContextBuilder.ts:420-427）、previewSnapshotFromMetrics（AITeachingCoordinator.ts:1952-1958）。

### 3. 字段到调用的完整链示例

**示例 A：`understanding.surface_goal`（goal→path 配置式首链）**
1. 声明：goal.yaml:17-24（fieldId + pathInRawOutput `internal.ext.goalConversation.understanding.surface_goal`）与 goal.yaml:190-196（skill:goal-conversation 行 handoff [goal-agent]）、goal.yaml:393-398（goal-agent 行 handoff [path]）。
2. 灌 DB：index.ts:584 bootstrap → field-routing-bootstrap.service.ts:206 → :157-177（field_definitions.upsert，含 pathInRawOutput）→ :181-201（agent_field_routings.upsert）；yaml 加载在 orchestration-file.ts:229-243。
3. 读取：field-dispatcher loadRoutings（index.ts:85-135，30s TTL）→ `assembleGoalHandoff`（:183-196：取 goal-agent 名下 handoff 含 'path' 的行，`extractFieldsByPath` :161-174 按 pathInRawOutput 从 goal skill 输出抽 `internal.ext.goalConversation.understanding.surface_goal`）。
4. 运行时消费：goal-conversation.service.ts:808-814 → path.coordinator.ts:169-172（pick('understanding.surface_goal')）→ :188-189 写入 normalizedInputV1.learnerProfile.surfaceGoal → :355 buildFramedNormalizedInput → learning.service.ts:2509 executeSkill path-planning（skill 侧读 metadata.normalizedInput）。
5. 落库：learning_paths.description / aiPromptTemplate（learning.service.ts:2628-2643），随 path:created 事件（:2765-2778）进 learner_evidence → snapshot。

**示例 B：`evaluation.sessionKtl`（teaching wrapup → 画像）**
1. 声明：teaching.yaml:140-143（fieldId + valueType number）与 teaching.yaml:436-442（skill:session-wrapup 行 handoff [teaching-agent]）、teaching.yaml:558-564（teaching-agent 行 handoff [profile]，声明语义）。
2. 灌 DB：同示例 A（bootstrap field_definitions/agent_field_routings）。
3. 运行时消费：AITeachingCoordinator.endSession `:1842` executeSkill session-wrapup → 输出 `internal.ext.sessionWrapup.result.evaluation.sessionKtl`（:1892-1893）→ :1898-1906 可靠性门禁 → :1909-1918 scoreInput（sessionKtl 字段映射）→ :1920-1936 `prepareSessionScoreCommit`（learning-state.service.ts:706-774，sessionKtl 归一化/降权/投影）→ :2017-2029 completeWithEvent → TeachingSessionRepository.ts:1027-1028 写 `learning_metrics`。
4. 画像沉淀：同事务 enqueue lesson:completed 事件（TeachingSessionRepository.ts:1065）→ outbox 消费者（index.ts:631-645）→ learner_evidence（LearnerEvidenceProjector.ts:21，data.performance 含 ktl）→ `LearnerSnapshotService.getSnapshot` 经 learningStateService/learnerKnowledgeMemoryService 重放 → learner_projections（LearnerSnapshotRefreshService.ts:41-64）。
5. 下游：teaching 回读（TeachingContextBuilder.ts:416-427 取 learningState/learnerProjection）、ReplanAdvisory（AITeachingCoordinator.ts:1963）、dashboard guidance。

### 4. 环境缺口 / 异常

**声明了但无运行时调用/消费：**
1. **path-agent → teaching 的 6 条聚合 handoff**（path.yaml:432-467：path.name/summary、milestones.title/goal、subtasks.title/acceptanceCriteria）**无任何 assemble/消费函数**——field-dispatcher 仅实现 goal-handoff（:183）、stage-designer-channels（:204）、teaching-turn-channels（:218）三个装配器。数据实际经 DB 表由 TeachingContextBuilder 读取（TeachingContextBuilder.ts:393-427）。声明语义与运行时通路不一致。
2. **teaching-agent → profile 的 8 条 handoff**（teaching.yaml:515-571）同样无消费方；实际路径是 lesson:completed 事件 data（wrapup/evaluation/performance/knowledgeState）→ learner_evidence/learning_metrics。且**字段名错位**：声明键为 `evaluation.sessionKtl` 等，事件里实际是 `performance.ktl`（AITeachingCoordinator.ts:1995 的 persistedEvaluation 用 lss/ktl/lf 短名，:1925-1936）。声明与落库键不完全同名。
3. **skill:learner-model 无 executeSkill 调用点**：coordinator definition 声明为 step1（learner.definition.ts:6-13），profile.yaml 声明 7 个 snapshot.* 字段，但运行时全链只经 `learnerSnapshotService.getSnapshot`/`profileAggregator` 直接服务调用；handler 仅注册 gateway（agents/index.ts:81）。"skill 调用"是名义上的，实际是服务直调（noPromptFile: true 佐证，agent-manifest.service.ts:242）。
4. **adaptive-guidance-copy 的 handoff [teaching-agent] 无消费**（teaching.yaml:465-513）：该 skill 不在 AITeachingCoordinator steps（ai-teaching.definition.ts:6-58），真实环境是 dashboard 后台服务（DashboardGuidanceSnapshotService.ts:149）。归属 teaching-agent 与运行时拓扑不符（routes/adaptive-guidance.routes.ts:30 注释亦承认"只作为 dashboard snapshot 对外提供"）。
5. **goal.yaml 的 `core.confidence` 无 handoff**（goal.yaml:372-378，internal=true 仅作 UI 进度条）——有意的例外，非缺口。

**调用了但无声明/弱声明：**
6. **skill:teaching-opening-generator**：AITeachingCoordinator.ts:1261 调用且 fallback 机制完整，但**不在本报告主链调查对象内**，teaching.yaml contracts 亦未声明（teaching.yaml:10-15 仅 5 个 agent）——opening 属于 teaching 阶段真实 LLM 调用但路由表不覆盖。
7. **session-evaluation-fallback / goal-alignment-checker 等 aux skill**（session-wrapup/index.ts:630-631 调用）不在任何 orchestration contracts 中。
8. **stage-designer replan 调用点（learning.service.ts:4093）不走配置式通道**：previousMilestone/cognitiveCore/normalizedInput 全部代码手拼（:4065-4084），与首生成路径（:2899 assembleStageDesignerChannels）行为不一致——同一 skill 两条装配通路并存。
9. **structuredData 消费不对称**：goal.yaml:307-314 声明 handoff [goal-agent] 且 path 侧消费（path.coordinator.ts:351），但 profile-aggregator.fetchGoalConversationData（profile-aggregator.ts:193-253）只读 understanding/learner_background，structuredData.learner.identity 不进画像。
10. **core.yaml 与编排 fieldId 命名漂移**：goal-conversation.yaml 顶层字段为 `reply/state/understanding/nextQuestions/quickReplies/confirmedProposal/confidenceScores/structuredData`（goal-conversation.yaml:44-114），编排层 pathInRawOutput 却指向 `internal.ext.goalConversation.*` 且含 `userVisible`（goal.yaml:144-149）；运行时实际消费 `aiResponse.userVisible` + `internal.ext.goalConversation`（service:229-244）。控制面（core.yaml）与字段路由（orchestration.yaml）是两套字段命名，仅靠 pathInRawOutput 桥接，`reply/state` 两个 core 字段在编排层无对应 fieldId。

**运行环境归类提醒**：`goal:understanding:updated` 事件同时被 goal→path 的同进程传参**和** goal→profile 的事件链消费（双通路，非替代关系）；profile 刷新由 7 类事件（index.ts:623-630）统一驱动，goal/path/teaching 阶段均不直接写 learner_projections（teaching 的 endSession 仅"预览"快照 AITeachingCoordinator.ts:1952-1958，落库由 outbox 消费者完成）。
