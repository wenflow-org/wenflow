# Learner Model Scenario Design (New Architecture)

> 📌 Type: Living spec (defines the learner snapshot contract, data sources, refresh timing and admin observation) | Index: [doc/README.md](./README.md).

## 1. Objective

This document defines learner model scenario under new architecture, with goals:

- Provide unified Learner Snapshot for teaching, path adjustment, backend diagnostics
- Decouple user long-term profile, recent learning state, path-level knowledge memory from teaching pipeline
- Keep existing path orchestrator and teaching orchestrator unchanged, only add stable upstream state layer
- Provide consumable structured evidence for milestone-level path replanning

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
- `learning_metrics`
- `teaching_sessions`
- `learning_paths / milestones / subtasks`

Output to:

- `TeachingContextBuilder`
- Path/milestone replan
- Admin observation and diagnostics

## 3. Whether Orchestrator Needed

A learner mainline orchestrator is registered at the orchestration layer: `learnerAgentRuntimeDefinition` (id `profile-agent`, `managedByCode: true`), chaining `skill:learner-model` → `skill:lesson-knowledge-enricher` → `LearnerSnapshotRefreshService` (`backend/src/coordinators/learner.definition.ts`; listed in `ORCHESTRATOR_RUNTIME_DEFINITIONS`).

The criterion for whether a separate orchestration layer is needed:

1. Learner model scenario is not an independent user flow, but shared upstream state layer across path/teaching/admin.
2. Main work is deterministic aggregation, event-triggered refresh, on-demand reading, not multi-Agent multi-stage orchestration.
3. Turning it into multi-stage orchestration would increase implementation complexity (stage state, failure retry, stage logs and backend management), so the chain stays single-line.

Only when any of the following needs arises is it worth expanding refresh into a multi-sub-Agent orchestration chain: snapshot produced by multiple sub-Agents together, refresh becoming an obvious multi-stage flow, high-cost async batch recomputation, or needing failure retry / stage logs / backend running-state management.

### Current Form

- External: `skill:learner-model`
- Internal: Several deterministic services
- Update method: Event-driven refresh + on-demand reading

## 4. Position in New Architecture

```text
goal_conversations
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

- `skill:learner-model` (alias `learner-model-agent`)

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

  profile: LearnerModelProfile
  dynamicState: LearnerDynamicState
  knowledgeMemory: LearnerKnowledgeMemory
  teachingHints: LearnerTeachingHints
}
```

### 6.1 LearnerModelProfile

Long-term relatively stable, sourced from:

- `goal_conversations`

Main content:

- cognitive
- preferences
- emotional
- behavioral

### 6.2 LearnerDynamicState

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

### 6.4 LearnerTeachingHints

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
2. Path/milestone replan
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

### 10.2 Pages

#### 1. Learner Models List Page

Implemented at `frontend/src/views/admin-redesign/LearnerCenter.vue`.

Display:

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

Implemented at `frontend/src/views/admin-redesign/LearnerDetail.vue`.

Tabs:

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

## 12. Service Split

The orchestrator for the learner model scenario is registered at the orchestration layer (see §3); the services behind it:

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

## 13. File Locations

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
- `backend/src/services/ai-teaching/AITeachingCoordinator.ts`
- `backend/src/skills/teaching-turn/`

### Admin API

- `backend/src/routes/admin/learner-models.ts` (list/detail page routes are now `/admin/learner-state`; `/admin/learner-models` and `/admin/learner-center` redirect here)

### Admin Frontend

- `frontend/src/views/admin-redesign/LearnerCenter.vue`
- `frontend/src/views/admin-redesign/LearnerDetail.vue`
- `frontend/src/api/adminApi.ts`
- `frontend/src/router/index.ts`

## 14. Implementation Scope

Implemented: `LearnerSnapshot` / `TeachingLearnerProjection` contract and Teaching integration, Knowledge Memory v1 (`taskMastery / conceptStates / milestoneProgress / recentEvidence`), event refresh (`goal:understanding:updated`, `path:generated`, `lesson:completed`, `task:completed`, `path:adjusted`), Admin observation pages (list / detail / manual recompute / recent evidence).

Replan consumption: milestone/path replan reads state from learner memory rather than only `completedTaskIds`. `requestPathReplan()` puts `learnerReplanProjection` into returned `request.evidence`, and the replan flow consumes this projection as one of its upstream inputs (see PATH_PRODUCTION_REPLAN_CONTRACT.md).

## 15. Current Decision Summary

1. `skill:learner-model` is the canonical id.
2. Output namespace use `internal.ext.learner`.
3. A learner mainline orchestrator is registered at the orchestration layer (id `profile-agent`, `managedByCode: true`; chain `skill:learner-model` → `skill:lesson-knowledge-enricher` → `LearnerSnapshotRefreshService`).
4. Learner snapshot use "event refresh + on-demand read" model.
5. Admin v1 only do "read-only + recompute", no human edit.