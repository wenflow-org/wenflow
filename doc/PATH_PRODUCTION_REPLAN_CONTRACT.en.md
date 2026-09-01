# Path Production Scenario Refactoring Notes (Unified Architecture)

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

- Annotation field source corrected to `label-generator`'s `displayLabel/shortLabel`.
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
| `replan` + `mode=overwrite` | ✅ Sole current mode (default) | In-place redesign of a **single target stage** (`resolveStageReplanTarget` locates the active stage): delete unfinished tasks of that stage, keep completed ones (order continues), freeze learning evidence, rollbackSnapshot recoverable; emits `path:adjusted` event |
| `replan` + `mode=new_version` | ❌ Not implemented (throws `PATH_VERSIONING_NOT_SUPPORTED` 409) | First-version contract promised "create new path version"; never landed. Per 2026-08-31 decision **versioning/rollback will NOT be implemented** (no user-side need for old versions; overwrite + freeze semantics suffice) |
| `regenerate` (no adjustments) | ✅ | Full path overwrite rebuild (replace-path): delete old milestones and rebuild; **409 blocked when learning progress exists (completed/in_progress)** |
| `regenerate` + `adjustments` (added 2026-08-31) | ✅ | User-side "supplement-driven regeneration": no progress → full path rebuild (supplement injected into `normalizedInput.understanding.adjustments` for path-agent replanning); has completed, no in_progress → converges to replan-stage redesign of current active stage (reason=supplement, completed preserved); has in_progress / open session → 409 |

Contract fields:

- `triggerSource`: `goal-conversation|learner-model-agent|ai-teaching|admin|system|api`
- `mode`: `new_version|overwrite` (server default `overwrite`; `new_version` throws)
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
- Any replan blocked when `in_progress` tasks or open teaching sessions exist (409, prompt to finish session first)
- Default replan mode is `overwrite`