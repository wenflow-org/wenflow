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

## Replan Capability Reservation (First Version)

Reserved service and route contract:

- `POST /api/learning/paths/:pathId/replan`

Current status:

- `mode=new_version`: Enabled
- `mode=overwrite`: Not yet enabled, returns `status=not_enabled`

Fixed contract:

- `triggerSource`: `goal-conversation|progress-agent|ai-teaching|admin|system|api`
- `mode`: `new_version|overwrite` (default `new_version`)
- `evidence`: Custom evidence object

First version behavior:

- Under `new_version` mode:
  - Based on current path + learner replan projection creates new path version
  - Does not overwrite old path
  - Learner memory injected via `request.evidence.learnerReplanProjection`
  - Path generation input explicitly enters `metadata.replan`

## Replan Input Convention (First Version)

When `new_version` mode triggers path replan, `learning.service -> path-agent` besides regular fields also passes through:

- `metadata.replan.mode`
- `metadata.replan.triggerSource`
- `metadata.replan.sourcePathId`
- `metadata.replan.freezeCompletedTaskIds`
- `metadata.replan.learnerReplanProjection`

Meaning:

- `learnerReplanProjection`: Learner projection for path replan consumption
- `freezeCompletedTaskIds`: Reminds path-agent this is existing learning history, cannot be ignored as regular new planning

First version constraints:

- `path-agent` still reuses main generation capability
- But prompt already clearly distinguishes "new path" and "path replan" semantics

Hard rules:

- Learned content frozen (`completed` tasks cannot be rewritten)
- Default replan mode is `new_version`