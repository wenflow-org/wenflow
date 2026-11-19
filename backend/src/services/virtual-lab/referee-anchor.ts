/**
 * Referee 人工锚点抽样（2026-11-19，调研报告 P2 效度闭环）。
 *
 * 背景：referee / actor-audit 与被评者同为 LLM，prompt 层隔离挡不住自偏好/位置/冗长偏差；
 * 报告建议「人工锚点抽样 + 复测一致性档案」。本模块只做两件纯事：
 *   1. 从已落库的 referee 报告中做**确定性均匀抽样**，导出给人复核；
 *   2. 复核标签回填后，计算 verdict 一致率与 overall 分数 MAE。
 * 不改变 referee 运行时行为，也不自动把 LLM 分数当 ground truth。
 */

export interface RefereeAnchorSample {
  sessionId: string;
  runId: string;
  reportId: string;
  verdict: string;
  overall: number | null;
  scores: Record<string, number | null>;
  findings: Array<{ code?: string; severity?: string; title?: string }>;
  reportVersion?: string;
  inputFingerprint?: string;
  evaluatedAt?: string;
  /** 人工复核回填（导出时为空；回读标签文件后填充） */
  human?: {
    verdict?: string;
    overall?: number | null;
    reviewer?: string;
    reviewedAt?: string;
  };
}

/** 确定性均匀抽样：按 sessionId 排序后等距取 limit 条（同输入必得同一样本）。 */
export function selectRefereeAnchorSample(
  samples: readonly RefereeAnchorSample[],
  limit = 20,
): RefereeAnchorSample[] {
  const max = Math.max(1, Math.floor(limit));
  const sorted = [...samples].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  if (sorted.length <= max) return sorted;
  if (max === 1) return [sorted[0]];
  const step = (sorted.length - 1) / (max - 1);
  const picked: RefereeAnchorSample[] = [];
  for (let i = 0; i < max; i += 1) {
    picked.push(sorted[Math.min(sorted.length - 1, Math.round(i * step))]);
  }
  return picked;
}

export interface RefereeAnchorAgreement {
  labeled: number;
  verdictCompared: number;
  verdictAgreement: number | null;
  overallCompared: number;
  meanAbsOverallError: number | null;
}

/** 人工标签 vs referee：verdict 一致率 + overall MAE（无标签项自动跳过）。 */
export function summarizeRefereeAnchorAgreement(
  samples: readonly RefereeAnchorSample[],
): RefereeAnchorAgreement {
  let labeled = 0;
  let verdictCompared = 0;
  let verdictMatched = 0;
  let overallCompared = 0;
  let absErrorSum = 0;
  for (const sample of samples) {
    const human = sample.human;
    if (!human) continue;
    labeled += 1;
    if (typeof human.verdict === 'string' && human.verdict.trim()) {
      verdictCompared += 1;
      if (human.verdict.trim().toLowerCase() === String(sample.verdict || '').trim().toLowerCase()) {
        verdictMatched += 1;
      }
    }
    if (typeof human.overall === 'number' && Number.isFinite(human.overall)
      && typeof sample.overall === 'number' && Number.isFinite(sample.overall)) {
      overallCompared += 1;
      absErrorSum += Math.abs(human.overall - sample.overall);
    }
  }
  return {
    labeled,
    verdictCompared,
    verdictAgreement: verdictCompared > 0 ? verdictMatched / verdictCompared : null,
    overallCompared,
    meanAbsOverallError: overallCompared > 0 ? absErrorSum / overallCompared : null,
  };
}
