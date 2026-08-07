# Agent 沙盘说明书（自动生成，勿手改）

> 生成命令：`npm run prompts:snapshots`（backend）。本文件由字段路由 seed + core fields 声明推导，
> 供写 Prompt 的同事查阅：每个 Agent 的输入通道与输出字段，以及 `sandbox:` ref 的合法沙盘键。
> 变更后请重新生成并提交，CI 会校验产物漂移。

## 输入来源分类（ref 前缀 = kind）

| 前缀 | 含义 | 对账 |
|---|---|---|
| `skill:<skillId>.<fieldPath>` | 上游 Skill 的模型输出字段 | 校验路由表 handoff |
| `sandbox:<agentId>.<key>` | 编排层注入/确定性定帧/状态池 | 校验沙盘路径注册表（本文件） |
| `user:<path>` | 用户/平台注入（对话消息、运行时控制） | 绿灯（自文档化） |

## 目标 Agent（Goal）（goal-agent）

### 输出/交付字段

| 字段 | 类型 | handoff |
|---|---|---|
| `understanding.surface_goal` | string | goal-agent |
| `understanding.real_problem` | string | goal-agent |
| `understanding.available_resources.time_budget` | string | goal-agent |
| `understanding.success_criteria.observable_result` | string | goal-agent |
| `understanding.available_resources.time_horizon` | string | goal-agent |
| `understanding.current_baseline.level` | string | goal-agent |
| `understanding.current_baseline.evidence` | string | goal-agent |
| `understanding.success_criteria.acceptance_check` | string | goal-agent |
| `understanding.available_resources.time_per_session` | string | goal-agent |
| `understanding.constraints_and_boundaries` | string | goal-agent |
| `understanding.pain_points` | string | goal-agent |
| `understanding.motivation` | string | goal-agent |
| `understanding.urgency` | string | goal-agent |
| `understanding.scenario` | string | goal-agent |
| `understanding.deadline_text` | string | goal-agent |
| `understanding.background_experience` | string | goal-agent |
| `understanding.learning_signal` | string | goal-agent |
| `confirmedProposal.learning_direction` | string | goal-agent |
| `confirmedProposal.first_deliverable` | string | goal-agent |
| `confirmedProposal.key_stages` | string | goal-agent |
| `confirmedProposal.out_of_scope` | string | goal-agent |
| `userVisible` | string | — |
| `goalConversation.nextQuestions` | array<string> | — |
| `goalConversation.quickReplies` | array<string> | — |
| `core.conversationId` | string | goal-agent |
| `core.stage` | string | goal-agent |
| `core.confidence` | number | — |
| `core.isCompleted` | boolean | goal-agent |

### 合法沙盘键（sandbox: 对账注册表）

```
sandbox:goal-agent.collectedData.confirmedProposal
sandbox:goal-agent.collectedData.history
sandbox:goal-agent.collectedData.latestMessage
sandbox:goal-agent.collectedData.state
sandbox:goal-agent.collectedData.understanding
sandbox:goal-agent.confirmedProposal.first_deliverable
sandbox:goal-agent.confirmedProposal.key_stages
sandbox:goal-agent.confirmedProposal.learning_direction
sandbox:goal-agent.confirmedProposal.out_of_scope
sandbox:goal-agent.understanding.available_resources.time_budget
sandbox:goal-agent.understanding.available_resources.time_horizon
sandbox:goal-agent.understanding.available_resources.time_per_session
sandbox:goal-agent.understanding.background_experience
sandbox:goal-agent.understanding.constraints_and_boundaries
sandbox:goal-agent.understanding.current_baseline.evidence
sandbox:goal-agent.understanding.current_baseline.level
sandbox:goal-agent.understanding.deadline_text
sandbox:goal-agent.understanding.learning_signal
sandbox:goal-agent.understanding.motivation
sandbox:goal-agent.understanding.pain_points
sandbox:goal-agent.understanding.real_problem
sandbox:goal-agent.understanding.scenario
sandbox:goal-agent.understanding.success_criteria.acceptance_check
sandbox:goal-agent.understanding.success_criteria.observable_result
sandbox:goal-agent.understanding.surface_goal
sandbox:goal-agent.understanding.urgency
```

## 路径 Agent（Path）（path-agent）

### 输入通道（编排注入 → 成员 skill）

| 沙盘路径 | 字段 | 类型 | 抽取路径 |
|---|---|---|---|
| `sandbox:path-agent.normalizedInput.learnerProfile.backgroundExperience` | `normalizedInput.learnerProfile.backgroundExperience` | string | — |
| `sandbox:path-agent.normalizedInput.learnerProfile.constraintsAndBoundaries` | `normalizedInput.learnerProfile.constraintsAndBoundaries` | string | — |
| `sandbox:path-agent.normalizedInput.problemSpace.realProblem` | `normalizedInput.problemSpace.realProblem` | string | — |
| `sandbox:path-agent.normalizedInput.problemSpace.scenario` | `normalizedInput.problemSpace.scenario` | string | — |
| `sandbox:path-agent.normalizedInput.problemSpace.currentPainPoint` | `normalizedInput.problemSpace.currentPainPoint` | string | — |
| `sandbox:path-agent.normalizedInput.resources.timeBudget` | `normalizedInput.resources.timeBudget` | string | — |
| `sandbox:path-agent.normalizedInput.resources.timeBudgetCadence` | `normalizedInput.resources.timeBudgetCadence` | string | — |
| `sandbox:path-agent.normalizedInput.successCriteria.observableResult` | `normalizedInput.successCriteria.observableResult` | string | — |
| `sandbox:path-agent.normalizedInput.confirmedProposal.firstDeliverable` | `normalizedInput.confirmedProposal.firstDeliverable` | string | — |
| `sandbox:path-agent.normalizedInput.confirmedProposal.keyStages` | `normalizedInput.confirmedProposal.keyStages` | string | — |
| `sandbox:path-agent.normalizedInput.planningHints.paceSignal` | `normalizedInput.planningHints.paceSignal` | string | — |
| `sandbox:path-agent.normalizedInput.planningHints.milestoneRange` | `normalizedInput.planningHints.milestoneRange` | string | — |
| `sandbox:path-agent.normalizedInput.planningHints.conceptRange` | `normalizedInput.planningHints.conceptRange` | string | — |
| `sandbox:path-agent.normalizedInput.planningHints.subtasksPerStageRange` | `normalizedInput.planningHints.subtasksPerStageRange` | string | — |
| `sandbox:path-agent.normalizedInput.planningHints.subtaskMinutesRange` | `normalizedInput.planningHints.subtaskMinutesRange` | string | — |
| `sandbox:path-agent.normalizedInput.planningHints.maxWeeks` | `normalizedInput.planningHints.maxWeeks` | number | — |
| `sandbox:path-agent.previousMilestone` | `previousMilestone` | object | previousMilestone |

### 输出/交付字段

| 字段 | 类型 | handoff |
|---|---|---|
| `normalizedInput.learnerProfile.backgroundExperience` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.learnerProfile.constraintsAndBoundaries` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.problemSpace.realProblem` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.problemSpace.scenario` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.problemSpace.currentPainPoint` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.resources.timeBudget` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.resources.timeBudgetCadence` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.successCriteria.observableResult` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.confirmedProposal.firstDeliverable` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.confirmedProposal.keyStages` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.planningHints.paceSignal` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.planningHints.milestoneRange` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.planningHints.conceptRange` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.planningHints.subtasksPerStageRange` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.planningHints.subtaskMinutesRange` | string | skill:path-planning, skill:stage-designer |
| `normalizedInput.planningHints.maxWeeks` | number | skill:path-planning, skill:stage-designer |
| `previousMilestone` | object | skill:stage-designer |
| `path.id` | string | path-agent |
| `path.name` | string | path-agent |
| `path.summary` | string | path-agent |
| `path.totalMilestones` | number | path-agent |
| `cognitiveCore.cognitiveDomain` | string | path-agent, skill:stage-designer |
| `cognitiveCore.coreConcepts` | array<object> | path-agent, skill:stage-designer |
| `milestones.stageNumber` | number | skill:stage-designer, path-agent |
| `milestones.title` | string | skill:stage-designer, path-agent |
| `milestones.coreConcept` | string | skill:stage-designer, path-agent |
| `milestones.goal` | string | skill:stage-designer, path-agent |
| `milestones.estimatedHours` | number | skill:stage-designer, path-agent |
| `subtasks.title` | string | path-agent |
| `subtasks.type` | string | path-agent |
| `subtasks.estimatedMinutes` | number | path-agent |
| `subtasks.acceptanceCriteria` | string | path-agent |
| `subtasks.linkedConcept` | string | path-agent |
| `subtasks.knowledgeType` | string | path-agent |
| `subtasks.cognitiveLevel` | string | path-agent |
| `subtasks.transferable` | boolean | path-agent |

### 合法沙盘键（sandbox: 对账注册表）

```
sandbox:path-agent.cognitiveCore
sandbox:path-agent.milestones
sandbox:path-agent.milestones.goal
sandbox:path-agent.milestones.title
sandbox:path-agent.normalizedInput
sandbox:path-agent.normalizedInput.confirmedProposal
sandbox:path-agent.normalizedInput.confirmedProposal.firstDeliverable
sandbox:path-agent.normalizedInput.confirmedProposal.keyStages
sandbox:path-agent.normalizedInput.learnerProfile.backgroundExperience
sandbox:path-agent.normalizedInput.learnerProfile.constraintsAndBoundaries
sandbox:path-agent.normalizedInput.learnerProfile.surfaceGoal
sandbox:path-agent.normalizedInput.planningHints.conceptRange
sandbox:path-agent.normalizedInput.planningHints.maxWeeks
sandbox:path-agent.normalizedInput.planningHints.milestoneRange
sandbox:path-agent.normalizedInput.planningHints.paceSignal
sandbox:path-agent.normalizedInput.planningHints.subtaskMinutesRange
sandbox:path-agent.normalizedInput.planningHints.subtasksPerStageRange
sandbox:path-agent.normalizedInput.problemSpace.currentPainPoint
sandbox:path-agent.normalizedInput.problemSpace.realProblem
sandbox:path-agent.normalizedInput.problemSpace.scenario
sandbox:path-agent.normalizedInput.resources.timeBudget
sandbox:path-agent.normalizedInput.resources.timeBudgetCadence
sandbox:path-agent.normalizedInput.successCriteria.observableResult
sandbox:path-agent.path.name
sandbox:path-agent.path.summary
sandbox:path-agent.planningHints
sandbox:path-agent.previousMilestone
sandbox:path-agent.replan
sandbox:path-agent.subtasks.acceptanceCriteria
sandbox:path-agent.subtasks.title
```

## 教学 Agent（Teaching）（teaching-agent）

### 输入通道（编排注入 → 成员 skill）

| 沙盘路径 | 字段 | 类型 | 抽取路径 |
|---|---|---|---|
| `sandbox:teaching-agent.learner.learnerProjection` | `learner.learnerProjection` | object | context.learnerProjection |
| `sandbox:teaching-agent.knowledge.state` | `knowledge.state` | object | session.knowledgeState |
| `sandbox:teaching-agent.controls.teachingControlContext` | `controls.teachingControlContext` | object | teachingState.teachingControlContext |
| `sandbox:teaching-agent.classroomContext` | `classroomContext` | object | teachingState.classroomContext |
| `sandbox:teaching-agent.visibleDialogueContext` | `visibleDialogueContext` | array<object> | session.messages |

### 输出/交付字段

| 字段 | 类型 | handoff |
|---|---|---|
| `reply` | string | teaching-agent |
| `analysis.levelScore` | number | teaching-agent |
| `analysis.confusionPoints` | array<string> | teaching-agent |
| `analysis.engagement` | number | teaching-agent |
| `analysis.emotionalState` | string | teaching-agent |
| `analysis.cognitiveLevel` | string | teaching-agent, skill:peer-reinforcement |
| `analysis.understanding` | number | teaching-agent, skill:peer-reinforcement |
| `knowledge.currentPoint` | string | teaching-agent |
| `knowledge.points` | array<object> | teaching-agent |
| `pedagogy.strategies` | array<string> | teaching-agent |
| `control.isCompletionCandidate` | boolean | teaching-agent |
| `control.shouldTriggerPeer` | boolean | skill:peer-reinforcement, teaching-agent |
| `control.checkpoint` | object | teaching-agent |
| `control.completionCandidateEvidence` | object | teaching-agent |
| `learner.learnerProjection` | object | skill:teaching-turn |
| `knowledge.state` | object | skill:teaching-turn |
| `controls.teachingControlContext` | object | skill:teaching-turn |
| `classroomContext` | object | skill:teaching-turn |
| `visibleDialogueContext` | array<object> | skill:teaching-turn |
| `peer.message` | string | teaching-agent |
| `peer.followUpQuestions` | array<string> | teaching-agent |
| `wrapup.summary.topicSummary` | string | teaching-agent |
| `wrapup.summary.knowledgeSummary` | string | teaching-agent |
| `wrapup.summary.knowledgeItems` | array<object> | teaching-agent |
| `wrapup.summary.learningEvaluation` | string | teaching-agent |
| `wrapup.summary.practiceAdvice` | string | teaching-agent |
| `wrapup.summary.keyTakeaways` | array<string> | teaching-agent |
| `wrapup.summary.actionPlan` | array<string> | teaching-agent |
| `wrapup.summary.evaluationHighlights` | object | teaching-agent |
| `wrapup.summary.metricInterpretation` | object | teaching-agent |
| `wrapup.summary.summaryVersion` | string | teaching-agent |
| `wrapup.evaluation.sessionLss` | number | teaching-agent |
| `wrapup.evaluation.sessionKtl` | number | teaching-agent |
| `wrapup.evaluation.sessionLf` | number | teaching-agent |
| `wrapup.evaluation.confidence` | number | teaching-agent |
| `wrapup.evaluation.reasoning` | string | teaching-agent |
| `guidance.headline` | string | teaching-agent |
| `guidance.subtitle` | string | teaching-agent |
| `guidance.todayActions` | array<object> | teaching-agent |
| `guidance.nextStep` | string | teaching-agent |
| `guidance.pathHint` | string | teaching-agent |
| `guidance.paceHint` | string | teaching-agent |
| `guidance.emptyStateCopy` | string | teaching-agent |
| `guidance.warningCopy` | string | teaching-agent |

### 合法沙盘键（sandbox: 对账注册表）

```
sandbox:teaching-agent.analysis.confusionPoints
sandbox:teaching-agent.analysis.understanding
sandbox:teaching-agent.classroomContext
sandbox:teaching-agent.controls.teachingControlContext
sandbox:teaching-agent.knowledge.points
sandbox:teaching-agent.knowledge.state
sandbox:teaching-agent.learner.learnerProjection
sandbox:teaching-agent.learningState
sandbox:teaching-agent.pedagogy.strategies
sandbox:teaching-agent.scenario
sandbox:teaching-agent.session.evidence
sandbox:teaching-agent.session.info
sandbox:teaching-agent.session.knowledgeState
sandbox:teaching-agent.session.messages
sandbox:teaching-agent.session.mode
sandbox:teaching-agent.session.topic
sandbox:teaching-agent.session.wrapup
sandbox:teaching-agent.teachingState.classroomContext
sandbox:teaching-agent.teachingState.classroomEventHistory
sandbox:teaching-agent.teachingState.teachingControlContext
sandbox:teaching-agent.visibleDialogueContext
sandbox:teaching-agent.wrapup.evaluation.sessionKtl
sandbox:teaching-agent.wrapup.evaluation.sessionLf
sandbox:teaching-agent.wrapup.evaluation.sessionLss
sandbox:teaching-agent.wrapup.summary.knowledgeItems
```

## 学习者 Agent（Profile）（profile-agent）

### 输出/交付字段

| 字段 | 类型 | handoff |
|---|---|---|
| `goalNarrative` | string | profile-agent |
| `backgroundContextNote` | string | profile-agent |
| `motivationNarrative` | string | profile-agent |
| `timeConstraintNote` | string | profile-agent |
| `selfAssessmentNote` | string | profile-agent |
| `contentReceptionPattern` | string | profile-agent |
| `practicePreferenceNote` | string | profile-agent |
| `frictionPatternNote` | string | profile-agent |
| `effectiveTeachingPattern` | string | profile-agent |
| `supportStyleNote` | string | profile-agent |
| `taskGranularityNote` | string | profile-agent |
| `conceptLedger` | object[] | profile-agent |
| `reusableFoundations` | string[] | profile-agent |
| `blockedFoundations` | string[] | profile-agent |
| `transferSignals` | object[] | profile-agent |
| `recurringConfusions` | object[] | profile-agent |
| `snapshot.dynamicState` | object | profile-agent |
| `snapshot.learningControlState` | object | profile-agent |
| `snapshot.replanSignal` | object | profile-agent |
| `snapshot.teachingHints` | object | profile-agent |
| `snapshot.knowledgeMemory.currentPath` | object | profile-agent |
| `snapshot.knowledgeMemory.globalSignals` | object | profile-agent |
| `profile.curriculumControls` | object | profile-agent |

### 合法沙盘键（sandbox: 对账注册表）

```
sandbox:profile-agent.backgroundContextNote
sandbox:profile-agent.blockedFoundations
sandbox:profile-agent.conceptLedger
sandbox:profile-agent.contentReceptionPattern
sandbox:profile-agent.effectiveTeachingPattern
sandbox:profile-agent.frictionPatternNote
sandbox:profile-agent.goalNarrative
sandbox:profile-agent.motivationNarrative
sandbox:profile-agent.practicePreferenceNote
sandbox:profile-agent.profile.curriculumControls
sandbox:profile-agent.profile.narrativeInsights
sandbox:profile-agent.recurringConfusions
sandbox:profile-agent.reusableFoundations
sandbox:profile-agent.selfAssessmentNote
sandbox:profile-agent.snapshot.dynamicState
sandbox:profile-agent.snapshot.knowledgeMemory.currentPath
sandbox:profile-agent.snapshot.knowledgeMemory.globalSignals
sandbox:profile-agent.snapshot.learningControlState
sandbox:profile-agent.snapshot.replanSignal
sandbox:profile-agent.snapshot.teachingHints
sandbox:profile-agent.supportStyleNote
sandbox:profile-agent.taskGranularityNote
sandbox:profile-agent.timeConstraintNote
sandbox:profile-agent.transferSignals
```

## simulation-agent（simulation-agent）

### 合法沙盘键（sandbox: 对账注册表）

```
sandbox:simulation-agent.actorProfile
sandbox:simulation-agent.avoidDomains
sandbox:simulation-agent.candidateDomains
sandbox:simulation-agent.candidatePersonas
sandbox:simulation-agent.control
sandbox:simulation-agent.currentPhase
sandbox:simulation-agent.currentTask
sandbox:simulation-agent.existingPersonaSeed
sandbox:simulation-agent.experimentSummary
sandbox:simulation-agent.frictionBudget
sandbox:simulation-agent.goalState
sandbox:simulation-agent.knowledgeSnapshot
sandbox:simulation-agent.learner
sandbox:simulation-agent.learnerPrivateState
sandbox:simulation-agent.learnerState
sandbox:simulation-agent.metricCompleteness
sandbox:simulation-agent.pathProposal
sandbox:simulation-agent.preferredDomains
sandbox:simulation-agent.preferredGoalTypes
sandbox:simulation-agent.preferredLevels
sandbox:simulation-agent.preferredMotivations
sandbox:simulation-agent.previousLearnerState
sandbox:simulation-agent.previousReaction
sandbox:simulation-agent.publicTrace
sandbox:simulation-agent.recentPersonaHints
sandbox:simulation-agent.recentScenarioHints
sandbox:simulation-agent.refereeTrace
sandbox:simulation-agent.story
sandbox:simulation-agent.storyMeta
sandbox:simulation-agent.task
sandbox:simulation-agent.visibleContext
```

---
> 本文件由 `npm run prompts:snapshots` 生成。