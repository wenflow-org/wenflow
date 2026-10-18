/**
 * 收束事件观测口径（#105，2026-10-18）
 *
 * 背景：真人侧与 VL 侧原本各算各的完成量（管理端曾出现同屏不同源）。两条轨实际都经
 * `learningService.completeTask` 发 `task:completed` / `path:completed`，并由
 * `LearnerEvidenceProjector` 落到 `learner_evidence`——缺的只是事件里的「哪条轨 / 哪个通道」。
 * 本模块统一解析这份事件（纯函数，不做 DB 访问）：
 * - track：真人 / 虚拟学习者，由 `users.isVirtualLearner` 在写入侧派生；
 * - completionSource：结算入口（human-ui / teaching-finalize / vl-assisted / learning-api / probe）；
 * - 2026-10-18 之前的历史行没有 track，一律标 `legacy`，不猜、不混入新口径。
 */

export type ClosureTrack = 'human' | 'virtual-learner' | 'unknown' | 'legacy';

export interface ClosureObservation {
  eventType: 'task:completed' | 'path:completed';
  track: ClosureTrack;
  completionSource: string;
}

export interface ClosureObservationSummary {
  total: number;
  byTrack: Record<ClosureTrack, number>;
  bySource: Record<string, number>;
  /** `${track}|${source}` → 条数，用于一眼看出「同屏不同源」是否还存在 */
  matrix: Record<string, number>;
}

const CLOSURE_EVENT_TYPES = new Set(['task:completed', 'path:completed']);
const KNOWN_TRACKS = new Set<ClosureTrack>(['human', 'virtual-learner', 'unknown']);

/** 解析单条 learner_evidence；非收束事件或坏 payload 返回 null（不计入分母） */
export function parseClosureObservation(eventType: string, payload: string | null | undefined): ClosureObservation | null {
  if (!CLOSURE_EVENT_TYPES.has(eventType)) return null;
  let data: Record<string, unknown> = {};
  if (payload) {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // 坏 payload 仍算一条收束事件（track/source 走 unknown），避免静默丢样本
    }
  }
  const rawTrack = typeof data.track === 'string' ? data.track : '';
  const track: ClosureTrack = KNOWN_TRACKS.has(rawTrack as ClosureTrack)
    ? rawTrack as ClosureTrack
    : 'legacy';
  const completionSource = typeof data.completionSource === 'string' && data.completionSource.trim()
    ? data.completionSource.trim()
    : 'unknown';
  return {
    eventType: eventType as ClosureObservation['eventType'],
    track,
    completionSource,
  };
}

export function summarizeClosureObservations(observations: ClosureObservation[]): ClosureObservationSummary {
  const byTrack: Record<ClosureTrack, number> = { human: 0, 'virtual-learner': 0, unknown: 0, legacy: 0 };
  const bySource: Record<string, number> = {};
  const matrix: Record<string, number> = {};
  for (const item of observations) {
    byTrack[item.track] += 1;
    bySource[item.completionSource] = (bySource[item.completionSource] || 0) + 1;
    const key = `${item.track}|${item.completionSource}`;
    matrix[key] = (matrix[key] || 0) + 1;
  }
  return { total: observations.length, byTrack, bySource, matrix };
}
