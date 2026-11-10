/**
 * 概念掌握度唯一口径（2026-11-09 画像链路核查）
 *
 * 问题：同一概念在三处读到三个数——
 *   - 画像（`LearnerKnowledgeMemoryService`）：最近一条有业务时间的证据说了算（#59/#60/#195）
 *   - 概念图谱（`concept-graph.service`）：所有痕迹里取 `masteryScore` **最大值**
 *   - 复习队列（`review-plan.service`）：到期那条 trace 自己的值
 *
 * 「最大值」与「当前状态」语义不同：一个概念曾经掌握、后来退化成 fragile，取最大值会永远显示高分；
 * 而画像的「最新一条」才符合「这个概念现在会不会」的语义。两页数字因此可以长期不一致。
 *
 * 本模块把「取哪一个信号」抽成单一实现：**业务时间最新的那条**；全部无时间戳时退回等权均值
 * （与画像对旧数据/测试桩的回退口径一致）。
 *
 * 复习队列里的 `masteryScore` 是「本次要复习的那条痕迹」的调度输入，不参与对外展示
 * （前端只渲染 retention/load），因此保持原样；对外可见的画像与图谱共用本口径。
 */

export interface MasterySignalLike {
  masteryScore?: number | null;
  /** 业务时间（不是墙钟写入时间）：证据 occurredAt / 痕迹 lastSeenAt。 */
  seenAt?: string | Date | null;
}

function timeOf(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function scoreOf(signal: MasterySignalLike): number | null {
  const n = Number(signal.masteryScore);
  return Number.isFinite(n) ? n : null;
}

/**
 * 取「业务时间最新」的一条信号。
 * 没有可用时间戳、或时间戳并列时返回 `null` / 首条（调用方按数组顺序稳定）。
 */
export function pickLatestMasterySignal<T extends MasterySignalLike>(signals: readonly T[]): T | null {
  let best: T | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const signal of signals) {
    if (scoreOf(signal) == null) continue;
    const at = timeOf(signal.seenAt);
    if (at == null) continue;
    if (at > bestAt) {
      best = signal;
      bestAt = at;
    }
  }
  return best;
}

/**
 * 解析一组信号的掌握度（0–1）：
 * 1. 有业务时间 → 取最新一条的分数；
 * 2. 全无业务时间（旧数据/测试桩）→ 等权均值；
 * 3. 没有任何有效信号 → 0。
 */
export function resolveMasteryScore(signals: readonly MasterySignalLike[]): number {
  const valid = signals.filter((signal) => scoreOf(signal) != null);
  if (valid.length === 0) return 0;
  const latest = pickLatestMasterySignal(valid);
  const score = latest
    ? (scoreOf(latest) as number)
    : valid.reduce((sum, signal) => sum + (scoreOf(signal) as number), 0) / valid.length;
  return Math.max(0, Math.min(1, score));
}
