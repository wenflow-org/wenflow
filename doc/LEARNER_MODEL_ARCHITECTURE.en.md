# Learner Model Scenario Design (New Architecture)

## 1. Objective

This document defines learner model scenario under new architecture, with goals:

- Provide unified Learner Snapshot for teaching, path adjustment, backend diagnostics
- Decouple user long-term profile, recent learning state, path-level knowledge memory from teaching pipeline
- Keep existing path orchestrator and teaching orchestrator unchanged, only add stable upstream state layer
- Provide consumable structured evidence for future milestone-level path restructuring

This document covers:

- `learner-model-agent`
- `LearnerSnapshot`
- `TeachingContextBuilder` learner integration
- Learner snapshot backend observation and recomputation entry

This document does not cover:

- Specific prompt text
- Final UI visual drafts
- Milestone replan algorithm details

## 2. Scenario Positioning

`learner-model-agent` is an upstream state Agent, not directly responsible for:

- Generating classroom replies
- Generating path structures
- Directly rewriting paths

Its responsibility is aggregating following data sources into unified snapshot:

- `goal_conversations`
- `student_baselines`
- `learning_metrics`
- `teaching_sessions`
- `learning_paths / milestones / subtasks`

Output to:

- `TeachingContextBuilder`
- Future path/milestone replan
- Admin observation and diagnostics

## 3. Whether Orchestrator Needed

Current stage no separate orchestrator for learner model scenario.

Reasons:

1. Learner model scenario is not an independent user flow, but shared upstream state layer across path/teaching/admin.
2. Current main work is deterministic aggregation, event-triggered refresh, on-demand reading, not multi-Agent multi-stage orchestration.
3. Early orchestrator introduction increases implementation complexity, including stage state, failure retry, stage logs and backend management.

### Current Recommended Form

- External: `learner-model-agent`
- Internal: Several deterministic services
- Update method: Event-driven refresh + on-demand reading

### When to Introduce Orchestrator in Future

Consider adding `learner-refresh-orchestrator` when any condition met:

- Learner snapshot produced by multiple sub-Agents together
- Refresh process becomes obvious multi-stage flow
- High-cost async batch recomputation needs exist
- Failure retry, stage logs, backend running state management needed

Before that, no new orchestrator.

## 4. Position in New Architecture

```text
goal_conversations
student_baselines
learning_metrics
teaching_sessions
learning_paths / milestones / subtasks
        ↓
learner-model-agent
        ↓
LearnerSnapshot
        ↓
TeachingContextBuilder
        ↓
ai-teaching-agent
        ↓
teaching-turn-agent / peer-agent / session-wrapup-agent
```

## 5. Agent Convention

### 5.1 Canonical Agent Id

- `learner-model-agent`

### 5.2 Output Namespace

- `internal.ext.learner`

### 5.3 Unified Output Shell

Follow `agent-output-v1`:

- `success`
- `userVisible`
- `internal.core`
- `internal.ext.learner`
- `schemaVersion`
- `metadata`

## 6. LearnerSnapshot Contract

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

Long-term relatively stable, sourced from:

- `goal_conversations`
- `student_baselines`

Main content:

- cognitive
- preferences
- emotional
- behavioral

### 6.2 DynamicLearnerState

Recent learning state, sourced from:

- `learning_metrics`
- Recent `teaching_sessions`
- Session evaluation and summary

Main content:

- `lss / ktl / lf / lsb`
- `recentTrend`
- `fatigueRisk`
- `confidenceTrend`
- `recentSessionQuality`
- `recommendedPacing`
- `recommendedInteraction`

### 6.3 LearnerKnowledgeMemory

This is learner model scenario core.

Main questions answered:

1. Where user currently is in whole path
2. Where current milestone progressed to
3. Which tasks completed but mastery unstable
4. Which knowledge points stable, fragile, or continuously stuck

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

Guidance information for teaching direct consumption:

- `promptEnhancement`
- `recommendedApproach`
- `emphasize`
- `avoid`
- `riskFactors`

## 7. Teaching Projection

`TeachingContextBuilder` should not pass complete learner snapshot directly to `teaching-turn-agent`.

Need to crop snapshot to teaching-specific projection:

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

## 8. AI Intervention Timing

Not recommended to recompute full learner snapshot after every message round.

### 8.1 Strong Intervention Nodes (call learner-model-agent)

1. `goal:understanding:updated`

- Goal: Establish or update stable profile
- Output focus: `profile`, initial `teachingHints`

2. `path:generated`

- Goal: Initialize `knowledgeMemory.currentPath`
- Output focus: Path structure, milestone/task positions, concept seeds

3. `lesson:completed`

- Goal: Write classroom evidence back to learner memory
- Output focus: `dynamicState`, `conceptStates`, `taskMastery`, `recentEvidence`

4. `task:completed`

- Goal: Refresh task and milestone progress state
- Output focus: `progress`, `currentPosition`, `taskMastery`

5. `path:adjusted` / future `path:replanned`

- Goal: Rebuild path-scoped snapshot

### 8.2 Weak Intervention Nodes (no full snapshot recomputation)

1. `processStudentMessage`
2. `processPeerMessage`

Such nodes only update session internal overlay, e.g.:

- latest analysis
- knowledgeState merge
- latest strategies
- peerTriggered

### 8.3 Read Nodes (read-only snapshot)

1. `TeachingContextBuilder`
2. Future replan
3. Admin detail page

## 9. Computation Strategy

### 9.1 Basic Principle

- Deterministic aggregation as main
- LLM-assisted summarization as supplement

### 9.2 Recommended Data Priority

1. `subtasks.status / completedAt`
2. `teaching_sessions.knowledgeState`
3. `summary / evaluation`
4. `goal_conversations`
5. `student_baselines`

### 9.3 Concept Key Normalization Priority

1. `coreConcept`
2. `displayLabel`
3. `learningObjectives`
4. `teaching_sessions.knowledgeState.name`

### 9.4 v1 Minimum Judgment Rules

#### taskMastery

- `todo` -> `unknown`
- `in_progress` -> `learning`
- `completed` with no recent negative signal -> `stable`
- `completed` but recent low understanding or high `review` -> `fragile`

#### milestoneProgress.masteryState

- All incomplete -> `unknown`
- Some completed but concept stability low -> `partial`
- Mostly completed and concept stable -> `stable`
- Progressed but recent concept fragility/struggle high -> `at-risk`

#### prerequisiteGaps

If current task/milestone required concept lacks stable evidence in completed tasks or recent sessions, and recent continuous confusion/low understanding appears, mark as prerequisite gap.

## 10. Admin Design

### 10.1 Design Principle

Admin v1 prioritize:

- Observable
- Explainable
- Recomputable

Not do:

- Human direct edit learner snapshot
- Human direct change concept mastery
- Human change teaching hints

### 10.2 Recommended Pages

#### 1. Learner Models List Page

Suggested add:

- `frontend/src/views/admin/LearnerModels.vue`

Suggested display:

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

#### 2. Learner Model Detail Page

Suggested add:

- `frontend/src/views/admin/LearnerModelDetail.vue`

Suggested tabs:

1. Profile
2. Dynamic State
3. Knowledge Memory
4. Teaching Hints

### 10.3 v1 Necessary Operations

1. Manual recompute snapshot
2. View recent evidence
3. View snapshot version / freshness / confidence

## 11. Admin API Design

Suggested add:

### 11.1 List

`GET /api/admin/learner-models`

Parameters:

- `userId`
- `pathId`
- `riskOnly`
- `staleOnly`
- `page`
- `limit`

### 11.2 Detail

`GET /api/admin/learner-models/:userId`

query:

- `pathId`
- `mode=global|path|teaching`

### 11.3 Manual Recompute

`POST /api/admin/learner-models/:userId/recompute`

body:

- `pathId?`
- `scope=global|path`

### 11.4 Recent Evidence

`GET /api/admin/learner-models/:userId/evidence`

query:

- `pathId?`
- `limit?`

## 12. Service Split Suggestion

Current stage no orchestrator, but suggested introduce following services:

### 12.1 `LearnerSnapshotService`

Responsibility:

- Aggregate generate `LearnerSnapshot`
- Control freshness / confidence / scope

### 12.2 `LearnerKnowledgeMemoryService`

Responsibility:

- Compute path/milestone/task/concept level memory
- Generate `taskMastery / conceptStates / milestoneProgress / prerequisiteGaps`

### 12.3 `LearnerProjectionService`

Responsibility:

- Crop complete snapshot to teaching/replan/admin different projections

Current at least include:

- `toTeachingProjection(snapshot)`
- `toReplanProjection(snapshot)`

### 12.4 `LearnerSnapshotRefreshService`

Responsibility:

- Respond event trigger partial or full recomputation

## 13. Suggested File Locations

### Backend Agent

- `backend/src/agents/learner-model-agent/index.ts`
- `backend/src/agents/learner-model-agent/types.ts`
- `backend/src/agents/learner-model-agent/profile-aggregator.ts`
- `backend/src/agents/learner-model-agent/personalization.ts`

### Backend Service

- `backend/src/services/learner/LearnerSnapshotService.ts`
- `backend/src/services/learner/LearnerKnowledgeMemoryService.ts`
- `backend/src/services/learner/LearnerProjectionService.ts`
- `backend/src/services/learner/LearnerSnapshotRefreshService.ts`

### Teaching Integration

- `backend/src/services/ai-teaching/TeachingContextBuilder.ts`
- `backend/src/services/ai-teaching/AITeachingOrchestrator.ts`
- `backend/src/agents/teaching-turn-agent/index.ts`

### Admin API

- `backend/src/routes/admin/learner-models.ts`

### Admin Frontend

- `frontend/src/views/admin/LearnerModels.vue`
- `frontend/src/views/admin/LearnerModelDetail.vue`
- `frontend/src/api/adminApi.ts`
- `frontend/src/router/index.ts`

## 14. Phased Implementation Plan

### Phase 1: Contract and Teaching Integration

Goal:

- Define `LearnerSnapshot`
- Define `TeachingLearnerProjection`
- `TeachingContextBuilder` receive learner snapshot
- `learner-model-agent` output converge to `internal.ext.learner`

Not do:

- New tables
- Admin pages
- Replan consumption

### Phase 2: Knowledge Memory v1

Goal:

- Compute path-scoped `knowledgeMemory`
- Form `taskMastery / conceptStates / milestoneProgress / recentEvidence`

### Phase 3: Refresh Mechanism

Goal:

- At `goal:understanding:updated`
- `path:generated`
- `lesson:completed`
- `task:completed`
- `path:adjusted`

These nodes trigger snapshot refresh

### Phase 4: Admin Observation Page

Goal:

- List page
- Detail page
- Manual recompute
- Recent evidence

### Phase 5: Replan Consumption

Goal:

- Milestone/path replan read state from learner memory
- No longer only depend on `completedTaskIds`

Current prebuilt:

- `requestPathReplan()` already put `learnerReplanProjection` into returned `request.evidence`
- Future when truly enable replan, can directly use as one of upstream inputs

## 15. Current Decision Summary

1. `learner-model-agent` is canonical id.
2. Output namespace use `internal.ext.learner`.
3. Current no separate learner orchestrator build.
4. Learner snapshot use "event refresh + on-demand read" model.
5. Admin v1 only do "read-only + recompute", no human edit.