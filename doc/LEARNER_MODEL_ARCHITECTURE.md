# 学习者模型场景设计（新版架构）

## 1. 目标

本文档定义新版架构下的学习者模型场景，目标是：

- 为教学、路径重调、后台诊断提供统一的学习者快照（Learner Snapshot）
- 将用户长期画像、近期学习状态、路径级知识记忆从教学链路中解耦
- 保持现有路径编排器与教学编排器不变，仅新增稳定的上游状态层
- 为未来 milestone 级路径重构提供可消费的结构化证据

本文档覆盖：

- `skill:learner-model`
- `LearnerSnapshot`
- `TeachingContextBuilder` 的 learner 接入
- learner snapshot 的后台观察与重算入口

本文档不覆盖：

- 具体 prompt 文案
- 最终 UI 视觉稿
- milestone replan 算法细节

## 2. 场景定位

`skill:learner-model` 是一个上游状态 Agent，不直接负责：

- 生成课堂回复
- 生成路径结构
- 直接改写路径

它的职责是将以下数据源聚合为统一快照：

- `goal_conversations`
- `student_baselines`
- `learning_metrics`
- `teaching_sessions`
- `learning_paths / milestones / subtasks`

输出给：

- `TeachingContextBuilder`
- 未来的 path/milestone replan
- admin 观察与诊断

## 3. 是否需要编排器

当前阶段不单独为学习者模型场景增加 orchestrator。

原因：

1. 学习者模型场景不是一个独立用户流程，而是跨路径/教学/admin 的共享上游状态层。
2. 当前主要工作是确定性聚合、事件触发刷新、按需读取，不是多 Agent 多阶段编排。
3. 过早引入 orchestrator 会放大实现复杂度，包括阶段状态、失败重试、阶段日志与后台管理。

### 当前推荐形态

- 对外：`skill:learner-model`
- 对内：若干 deterministic service
- 更新方式：事件驱动刷新 + 按需读取

### 未来何时引入 orchestrator

当满足以下任一条件时，可考虑新增 `learner-refresh-orchestrator`：

- 学习者快照由多个子 Agent 共同产出
- 刷新过程变成明显的多阶段流程
- 存在高成本异步批量重算需求
- 需要失败重试、阶段日志、后台运行状态管理

在此之前，不新增 orchestrator。

## 4. 在新版架构中的位置

```text
goal_conversations
student_baselines
learning_metrics
teaching_sessions
learning_paths / milestones / subtasks
        ↓
skill:learner-model
        ↓
LearnerSnapshot
        ↓
TeachingContextBuilder
        ↓
ai-teaching-agent
        ↓
teaching-turn-agent / peer-agent / summary-agent / session-evaluation-agent
teaching-turn-agent / peer-agent / session-wrapup-agent
```

## 5. Agent 约定

### 5.1 Canonical Agent Id

- `skill:learner-model`（别名 `learner-model-agent`，2026-08-09 统一为 canonical 前缀）

### 5.2 输出命名空间

- `internal.ext.learner`

### 5.3 统一输出外壳

遵循 `agent-output-v1`：

- `success`
- `userVisible`
- `internal.core`
- `internal.ext.learner`
- `schemaVersion`
- `metadata`

## 6. LearnerSnapshot 契约

```ts
type LearnerSnapshot = {
  snapshotVersion: 'learner-snapshot-v1'

  scope: {
    userId: string
    learningPathId?: string
    milestoneId?: string
    taskId?: string
    mode: 'global' | 'path' | 'teaching'
  }

  freshness: {
    generatedAt: string
    confidence: number
    basedOn: {
      latestGoalConversationAt?: string
      latestMetricAt?: string
      latestTeachingSessionAt?: string
      latestTaskCompletionAt?: string
      latestPathUpdateAt?: string
    }
  }

  profile: StableLearnerProfile
  dynamicState: DynamicLearnerState
  knowledgeMemory: LearnerKnowledgeMemory
  teachingHints: TeachingHints
}
```

### 6.1 StableLearnerProfile

长期相对稳定，来源于：

- `goal_conversations`
- `student_baselines`

主要内容：

- cognitive
- preferences
- emotional
- behavioral

### 6.2 DynamicLearnerState

近期学习态，来源于：

- `learning_metrics`
- 最近几次 `teaching_sessions`
- session 评估与总结

主要内容：

- `lss / ktl / lf / lsb`
- `recentTrend`
- `fatigueRisk`
- `confidenceTrend`
- `recentSessionQuality`
- `recommendedPacing`
- `recommendedInteraction`

### 6.3 LearnerKnowledgeMemory

这是学习者模型场景的核心。

主要回答：

1. 用户当前在整条路径中的哪里
2. 当前里程碑推进到了哪里
3. 哪些任务完成但掌握不稳
4. 哪些知识点稳定、脆弱、或持续卡住

```ts
type LearnerKnowledgeMemory = {
  currentPath?: PathKnowledgeMemory
  globalSignals: {
    masteredConcepts: string[]
    fragileConcepts: string[]
    strugglingConcepts: string[]
  }
}
```

#### PathKnowledgeMemory

```ts
type PathKnowledgeMemory = {
  learningPathId: string
  pathTitle: string
  pathSummary?: string | null

  progress: {
    totalMilestones: number
    completedMilestones: number
    totalTasks: number
    completedTasks: number
  }

  currentPosition: {
    milestoneId: string
    stageNumber: number
    milestoneTitle: string
    milestoneGoal?: string | null
    taskId?: string
    taskTitle?: string
    taskOrder?: number
    totalTasksInMilestone?: number
    completedTasksInMilestone?: number
  }

  milestoneProgress: Array<{
    milestoneId: string
    stageNumber: number
    title: string
    goal?: string | null
    totalTasks: number
    completedTasks: number
    masteryState: 'unknown' | 'partial' | 'stable' | 'at-risk'
  }>

  taskMastery: Array<{
    taskId: string
    milestoneId: string
    title: string
    status: 'todo' | 'in_progress' | 'completed'
    masteryState: 'unknown' | 'learning' | 'developing' | 'stable' | 'fragile'
    confidence: number
    lastEvidenceAt?: string
  }>

  conceptStates: Array<{
    conceptKey: string
    label: string
    sourceType: 'task-label' | 'session-knowledge' | 'derived'
    masteryScore: number
    stability: 'unknown' | 'fragile' | 'developing' | 'stable'
    status: 'pending' | 'learning' | 'mastered' | 'review'
    relatedTaskIds: string[]
    relatedMilestoneIds: string[]
    lastSeenAt?: string
  }>

  prerequisiteGaps: Array<{
    conceptKey: string
    label: string
    reason: string
    severity: 'low' | 'medium' | 'high'
  }>

  recentEvidence: Array<{
    type: 'task-completed' | 'teaching-session' | 'summary' | 'evaluation'
    taskId?: string
    sessionId?: string
    conceptKeys: string[]
    signal: 'mastery' | 'struggle' | 'fatigue' | 'incomplete'
    score?: number
    happenedAt: string
  }>
}
```

### 6.4 TeachingHints

给 teaching 直接消费的指导信息：

- `promptEnhancement`
- `recommendedApproach`
- `emphasize`
- `avoid`
- `riskFactors`

## 7. Teaching 投影

`TeachingContextBuilder` 不应把完整 learner snapshot 直接传给 `teaching-turn-agent`。

需要将 snapshot 裁剪为教学专用投影：

```ts
type TeachingLearnerProjection = {
  stableProfile: {
    thinkingStyle: string
    preferredStyle: string
    theoryVsPractice: string
    sessionLength: string
    confidenceLevel: string
  }

  liveState: {
    lss: number
    ktl: number
    lf: number
    lsb: number
    recentTrend: string
    recommendedPacing: string
  }

  pathContext: {
    pathTitle: string
    pathSummary?: string | null
    currentMilestoneTitle: string
    currentStageNumber: number
    currentTaskOrder: number
    totalTasksInMilestone: number
    completedPrerequisiteTasks: string[]
  }

  relevantKnowledge: {
    mastered: string[]
    fragile: string[]
    struggling: string[]
  }

  teachingHints: {
    promptEnhancement: string
    recommendedApproach: string
    emphasize: string[]
    avoid: string[]
  }
}
```

## 8. AI 介入时机

不建议在每轮消息后重算完整 learner snapshot。

### 8.1 强介入节点（调用 skill:learner-model）

1. `goal:understanding:updated`

- 目标：建立或更新稳定画像
- 输出重点：`profile`、初版 `teachingHints`

2. `path:generated`

- 目标：初始化 `knowledgeMemory.currentPath`
- 输出重点：path 结构、里程碑/任务位置、concept 种子

3. `lesson:completed`

- 目标：将课堂证据写回 learner memory
- 输出重点：`dynamicState`、`conceptStates`、`taskMastery`、`recentEvidence`

4. `task:completed`

- 目标：刷新任务与里程碑推进状态
- 输出重点：`progress`、`currentPosition`、`taskMastery`

5. `path:adjusted` / future `path:replanned`

- 目标：重建 path-scoped snapshot

### 8.2 弱介入节点（不重算全量 snapshot）

1. `processStudentMessage`
2. `processPeerMessage`

此类节点仅更新 session 内 overlay，例如：

- latest analysis
- knowledgeState merge
- latest strategies
- peerTriggered

### 8.3 读取节点（只读 snapshot）

1. `TeachingContextBuilder`
2. future replan
3. admin 详情页

## 9. 计算策略

### 9.1 基本原则

- 确定性聚合为主
- LLM 辅助总结为辅

### 9.2 建议的数据优先级

1. `subtasks.status / completedAt`
2. `teaching_sessions.knowledgeState`
3. `summary / evaluation`
4. `goal_conversations`
5. `student_baselines`

### 9.3 Concept Key 归一化优先级

1. `coreConcept`
2. `displayLabel`
3. `learningObjectives`
4. `teaching_sessions.knowledgeState.name`

### 9.4 v1 最小判断规则

#### taskMastery

- `todo` -> `unknown`
- `in_progress` -> `learning`
- `completed` 且近期无负面信号 -> `stable`
- `completed` 但近期理解低或 `review` 偏高 -> `fragile`

#### milestoneProgress.masteryState

- 全未完成 -> `unknown`
- 有完成但概念稳定度低 -> `partial`
- 大部分完成且概念稳定 -> `stable`
- 已推进但近期 concept fragility/struggle 较多 -> `at-risk`

#### prerequisiteGaps

若当前 task/milestone 所需 concept 在已完成任务或近期 session 中缺少稳定证据，且近期出现持续 confusion/low understanding，则标记为 prerequisite gap。

## 10. Admin 设计

### 10.1 设计原则

admin v1 优先做：

- 可观测
- 可解释
- 可重算

暂不做：

- 人工直接编辑 learner snapshot
- 人工直接改 concept mastery
- 人工改 teaching hints

### 10.2 推荐页面

#### 1. Learner Models 列表页

建议新增：

- `frontend/src/views/admin/LearnerModels.vue`

建议展示：

- user
- active path
- snapshot freshness
- confidence
- recent trend
- fatigue risk
- current milestone
- current task
- top fragile concepts
- top struggling concepts

#### 2. Learner Model 详情页

建议新增：

- `frontend/src/views/admin/LearnerModelDetail.vue`

建议 tab：

1. Profile
2. Dynamic State
3. Knowledge Memory
4. Teaching Hints

### 10.3 v1 必要操作

1. 手动重算 snapshot
2. 查看 recent evidence
3. 查看 snapshot version / freshness / confidence

## 11. Admin API 设计

建议新增：

### 11.1 列表

`GET /api/admin/learner-models`

参数：

- `userId`
- `pathId`
- `riskOnly`
- `staleOnly`
- `page`
- `limit`

### 11.2 详情

`GET /api/admin/learner-models/:userId`

query：

- `pathId`
- `mode=global|path|teaching`

### 11.3 手动重算

`POST /api/admin/learner-models/:userId/recompute`

body：

- `pathId?`
- `scope=global|path`

### 11.4 最近证据

`GET /api/admin/learner-models/:userId/evidence`

query：

- `pathId?`
- `limit?`

## 12. 服务拆分建议

当前阶段不引入 orchestrator，但建议引入以下服务：

### 12.1 `LearnerSnapshotService`

职责：

- 聚合生成 `LearnerSnapshot`
- 控制 freshness / confidence / scope

### 12.2 `LearnerKnowledgeMemoryService`

职责：

- 计算 path/milestone/task/concept 级记忆
- 生成 `taskMastery / conceptStates / milestoneProgress / prerequisiteGaps`

### 12.3 `LearnerProjectionService`

职责：

- 将完整 snapshot 裁剪为 teaching/replan/admin 不同投影

当前至少包含：

- `toTeachingProjection(snapshot)`
- `toReplanProjection(snapshot)`

### 12.4 `LearnerSnapshotRefreshService`

职责：

- 响应事件触发局部或全量重算

## 13. 建议文件落点

### 后端 Agent

- `backend/src/agents/learner-model-agent/index.ts`
- `backend/src/agents/learner-model-agent/types.ts`
- `backend/src/agents/learner-model-agent/profile-aggregator.ts`
- `backend/src/agents/learner-model-agent/personalization.ts`

### 后端 Service

- `backend/src/services/learner/LearnerSnapshotService.ts`
- `backend/src/services/learner/LearnerKnowledgeMemoryService.ts`
- `backend/src/services/learner/LearnerProjectionService.ts`
- `backend/src/services/learner/LearnerSnapshotRefreshService.ts`

### Teaching 接入

- `backend/src/services/ai-teaching/TeachingContextBuilder.ts`
- `backend/src/services/ai-teaching/AITeachingOrchestrator.ts`
- `backend/src/agents/teaching-turn-agent/index.ts`

### Admin API

- `backend/src/routes/admin/learner-models.ts`

### Admin 前端

- `frontend/src/views/admin/LearnerModels.vue`
- `frontend/src/views/admin/LearnerModelDetail.vue`
- `frontend/src/api/adminApi.ts`
- `frontend/src/router/index.ts`

## 14. 分阶段实施计划

### Phase 1：契约与 Teaching 接入

目标：

- 定义 `LearnerSnapshot`
- 定义 `TeachingLearnerProjection`
- `TeachingContextBuilder` 接 learner snapshot
- `skill:learner-model` 输出收口到 `internal.ext.learner`

不做：

- 新表
- admin 页面
- replan 消费

### Phase 2：Knowledge Memory v1

目标：

- 计算 path-scoped `knowledgeMemory`
- 形成 `taskMastery / conceptStates / milestoneProgress / recentEvidence`

### Phase 3：刷新机制

目标：

- 在 `goal:understanding:updated`
- `path:generated`
- `lesson:completed`
- `task:completed`
- `path:adjusted`

这些节点触发 snapshot 刷新

### Phase 4：Admin 观察页

目标：

- 列表页
- 详情页
- 手动重算
- recent evidence

### Phase 5：Replan 消费

目标：

- milestone/path replan 从 learner memory 读状态
- 不再只依赖 `completedTaskIds`

当前预埋：

- `requestPathReplan()` 已将 `learnerReplanProjection` 放入返回的 `request.evidence`
- 后续真正启用 replan 时，可直接将其作为上游输入之一

## 15. 当前决策总结

1. `skill:learner-model` 是 canonical id。
2. 输出命名空间使用 `internal.ext.learner`。
3. 当前不单独建设 learner orchestrator。
4. learner snapshot 采用“事件刷新 + 按需读取”模型。
5. admin v1 只做“只读 + 重算”，不做人工编辑。
