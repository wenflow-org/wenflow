/**
 * 目标澄清的上下文装配契约（纯函数，便于单测）。
 *
 * 契约字段 `contextMode: 'recent' | 'full'`（前端/协调器默认 `'recent'`）：
 * - `full`：回传全量可见历史（配合 state-first）
 * - `recent`：只回传最近 `RECENT_CONTEXT_LIMIT` 条，控制长澄清对话的 token 与上下文长度
 *
 * 结构化状态（`previousState.understanding`）由调用方**始终完整传入**，不因历史截断而丢失。
 * 此前服务端忽略该字段、恒用全量历史，契约被静默忽略（2026-09-17 审计 §1.3）。
 */

/** `contextMode='recent'` 时回传的历史条数上限 */
export const RECENT_CONTEXT_LIMIT = 20;

export type GoalContextMode = 'recent' | 'full';

/** 契约 contextMode → 实际回传的历史 */
export function selectGoalHistory<T>(
  history: T[],
  mode: GoalContextMode | undefined,
  limit: number = RECENT_CONTEXT_LIMIT
): T[] {
  if (mode !== 'recent') return history;
  const bounded = Math.max(0, Math.floor(limit));
  // 注意：`slice(-0) === slice(0)`＝全量，必须显式处理 0
  if (bounded === 0) return [];
  return bounded >= history.length ? history : history.slice(-bounded);
}
