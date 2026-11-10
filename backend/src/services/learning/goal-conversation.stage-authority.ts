/**
 * goal 会话 stage 的权威源收口（172-1）。
 *
 * 背景：一轮 Goal 回合里 stage 会有三份副本——
 *  - `collectedData.stage` / `goal_conversations.stage` 列：平台持久化的权威值；
 *  - `collectedData.runtimeNextState`：模型自报值的快照（updateCollectedData 从 envelope 抄出）；
 *  - `collectedData.runtimeEnvelope.contextUpdate.nextState`：同上一份的另一层副本。
 *
 * 平台把模型自报的 ready/completed 回落成 proposing 时，若只改权威值，下一轮
 * buildPreviousState 会从快照读回 ready → `previousStage=ready` → goal skill 的 ready
 * floor 0.95 把 confidence 抬到 ≥0.95，降级形同虚设。
 *
 * 本模块只提供两个纯函数：读 stage 只认权威值；降级时三处一起改写。
 * confidence 的归一规则属产品口径，尚未拍板，此处不处理（见 skills/goal-conversation
 * STAGE_MINIMUMS 的 TODO）。
 */

type GoalStateRecord = Record<string, unknown>;

/**
 * 读取下一轮要交给模型的 previousStage：只认持久化权威源。
 * `runtimeNextState.stage` 是模型自报值的副本，不能反向覆盖降级结果。
 */
export function resolveAuthoritativeGoalStage(
  data: GoalStateRecord | null | undefined,
  fallbackStage?: string | null
): string {
  const stage = data?.stage;
  if (typeof stage === 'string' && stage.length > 0) return stage;
  return fallbackStage || 'understanding';
}

/**
 * 平台降级 stage（模型自报 ready/completed → proposing）时同步三处副本，
 * 保证任何读取方（buildPreviousState、前端快照、下一轮 prompt）看到的都是降级后的值。
 */
export function syncDegradedGoalStage(data: GoalStateRecord, stage: 'proposing' | 'understanding'): void {
  data.stage = stage;

  const nextState = data.runtimeNextState;
  if (nextState && typeof nextState === 'object') {
    (nextState as Record<string, unknown>).stage = stage;
  }

  const envelope = data.runtimeEnvelope;
  const envelopeNextState = envelope && typeof envelope === 'object'
    ? ((envelope as Record<string, unknown>).contextUpdate as Record<string, unknown> | undefined)?.nextState
    : undefined;
  if (envelopeNextState && typeof envelopeNextState === 'object') {
    (envelopeNextState as Record<string, unknown>).stage = stage;
  }
}
