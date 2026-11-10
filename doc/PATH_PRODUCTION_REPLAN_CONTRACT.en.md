# Path Production Scenario Refactoring Notes (Unified Architecture)

> 📌 类型：活规范（英文同步版，与中文同样存在已知待办）｜最后核验：2026-11-02（校正 replan/regenerate 的 409 判定，补记 compress 与 rebuild-all 模式）。索引见 [doc/README.md](./README.md)。

## Scope

Only covers path production pipeline:

- goal-conversation -> learning.service -> path-agent -> learning_paths/milestones/subtasks

Does not include teaching sessions, summary, session-evaluation, etc.

## Unified Output Convention (path-agent)

path-agent return follows `agent-output-v1`:

- `userVisible`
- `internal.core`
  - `stage`
  - `confidence`
  - `isCompleted`
- `internal.ext.path`
  - `path`
  - `totalMilestones`
- `renderHints`
- `schemaVersion`
- `metadata`

During compatibility period, keep legacy top-level fields `path` and `internal.path`.

## Input Pass-through Convention (Path Generation)

When learning.service calls path-agent, besides base fields need to pass through:

- `structuredData`
- `confirmedProposal`
- `confidenceScores`
- `conversationHistory`
- `metadata.totalWeeks` (optional)

## Anderson Annotation Strategy

- Annotation field source is the deterministic function `generateDisplayLabel` (produces `displayLabel` by looking up `DISPLAY_LABEL_MAP` with `knowledgeType × cognitiveLevel`); the `label-generator` skill was retired in 2026-07 and `shortLabel` is no longer written anywhere.
- Annotation failure uses fail-open: path continues generating, not interrupted by annotation failure.

## existingPathId Overwrite Strategy

When passing `existingPathId`:

1. Update path main record
2. Delete old milestones under that path (cascade delete subtasks)
3. Rebuild milestones/subtasks based on new results

Ensures same path ID won't have old structure residue mixed in.

## Replan Capability (Current Implementation)

Service and route contract:

- `POST /api/learning/paths/:pathId/replan` (learner-side / admin-side: post-lesson advisory adjustment)
- `POST /api/learning/paths/:pathId/regenerate` (user-side: supplement-driven regeneration / failure retry)

### Current modes

| Mode | Status | Semantics |
|---|---|---|
| `regenerate` (no learning progress) | ✅ | Full path overwrite rebuild (replace-path): delete old milestones and rebuild |
| `regenerate` (has `completed`, no `in_progress`) | ✅ | Converges to replan-stage: redesign the current active stage, completed tasks preserved; with `fromStageNumber` it becomes a multi-stage re-plan starting at that stage |
| `regenerate` + `mode=rebuild-all` | ✅ | Explicit "start over": even with `completed` tasks it takes replace-path full rebuild (old sessions/records are orphaned but kept in DB); `in_progress` → 409 `PATH_MUTATION_HAS_IN_PROGRESS` |
| `regenerate` + `adjustments` | ✅ | `adjustments` is **not a branch switch** (branching is decided by learning progress); it is injected as `reason` and as `normalizedInput.understanding.adjustments`, taking highest priority during re-planning |
| `replan` + `mode=overwrite` | ✅ Default mode | In-place redesign of a **single target stage** (`resolveStageReplanTarget` locates the active stage): delete unfinished tasks of that stage, keep completed ones (order continues), freeze learning evidence, rollbackSnapshot recoverable; emits `path:adjusted` event |
| `replan` + `mode=compress` | ✅ Compress mode (bidirectional since 2026-10-15) | Same single-stage redesign, but compresses the target stage into fewer tasks: task-count ratio 0.5 (`REPLAN_TASK_RATIO.compress`, injected via `resolveReplanTaskRatio` into `planningHints.targetSubtasksForStage`); core tasks are protected when compressing, flexible ones are trimmed first |
| `replan` + `mode=new_version` | ❌ Not implemented (throws `PATH_VERSIONING_NOT_SUPPORTED` 409) | First-version contract promised "create new path version"; never landed. Per 2026-08-31 decision **versioning/rollback will NOT be implemented** (no user-side need for old versions; overwrite + freeze semantics suffice) |

Contract fields:

- `triggerSource`: `goal-conversation|learner-model-agent|ai-teaching|admin|system|api`
- `mode`: replan uses `new_version|overwrite|compress` (server default `overwrite`; `new_version` throws `PATH_VERSIONING_NOT_SUPPORTED`; `compress` compresses the target stage into fewer tasks, ratio 0.5); regenerate additionally accepts `rebuild-all` (explicit full rebuild)
- `evidence`: Custom evidence object
- `adjustments` (regenerate-only): User supplement text

### Behavior conventions

- `replan` (overwrite):
  - Redesigns current active stage based on current path + learner replan projection
  - Completed tasks preserved and frozen; `request.evidence.learnerReplanProjection` injected
  - Writes `learning_paths.replanMode/replanReason/replanTriggerSource` (lineage fields)
  - When user supplement (regenerate → replan branch), supplement passed as `reason` to stage-designer
- `regenerate` (progress-free rebuild):
  - Supplement enters `metadata.replan` / `normalizedInput.understanding.adjustments`; path-agent prioritizes it during replanning (supplement wins on conflict with confirmed proposal)

## Replan Input Convention

`learning.service -> path-agent` passes through in replan scenarios:

- `metadata.replan.mode`
- `metadata.replan.triggerSource`
- `metadata.replan.sourcePathId`
- `metadata.replan.freezeCompletedTaskIds`
- `metadata.replan.learnerReplanProjection`
- `normalizedInput.understanding.adjustments` (user supplement, regenerate scenario)

Meaning:

- `learnerReplanProjection`: Learner projection for path replan consumption
- `freezeCompletedTaskIds`: Reminds path-agent this is existing learning history, cannot be ignored as regular new planning
- `adjustments`: User's direct statement of what is unsuitable about the path; highest-priority input during replanning

Constraints:

- `path-agent` still reuses main generation capability
- Prompt already clearly distinguishes "new path" and "path replan" semantics (path-planning.yaml includes supplement consumption rules)

Hard rules:

- Learned content frozen (`completed` tasks cannot be rewritten)
- **replan-stage is blocked only by "open teaching sessions within scope"** (409 `PATH_MUTATION_HAS_OPEN_SESSION`, response carries the session list so the frontend can run the "clear → auto-retry" loop). Since P0-1 (2026-10-15) it **no longer treats the `in_progress` flag alone as a blocker** — end_only abandonment and timeout wrap-up leave tasks in `in_progress` as fossil markers, and treating them as blockers made "clear → retry" hit 409 forever (`path-mutation-safety.ts:260-277`)
- **replace-path is blocked by "learning progress (`completed`/`in_progress`) or completed teaching-session evidence"** (409); an explicit full rebuild (`mode=rebuild-all`) lets `allowCompleted` through for completed tasks and only blocks `in_progress`
- Default replan mode is `overwrite`