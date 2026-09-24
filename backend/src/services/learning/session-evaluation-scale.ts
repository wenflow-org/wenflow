/**
 * session-wrapup 评估档位（low | mid | high）↔ 0-10 数值的**唯一**映射实现。
 *
 * 单一事实来源（single source of truth）：
 * - 档位定义来自 `prompts/core/session-wrapup.yaml` 的 evaluation「评分参考」三档锚点
 *   （1-4 / 5-7 / 8-10）。锚点表是 LLM 的判断依据；本文件的 min/max 必须与 yaml 同步。
 * - 除本文件外，任何地方都**不得**再写一份 "high → 9" 之类的映射；下游只允许调用
 *   `sessionEvaluationTierToValue()` / `resolveSessionEvaluationTier()`。
 *   否则"确定性聚合"的地基又会出现两份口径（这正是本次改动要消除的问题）。
 *
 * 为什么返回值里带 range / uncertainty：
 * 档位是**区间**（例如 high = 8-10），区间内没有更细的证据。把 high 当成精确的 9 使用，
 * 会丢掉"到底是 8 还是 10 我们并不知道"这一事实。因此映射同时给出：
 *   - value：区间中点，**仅**用于满足既有 0-10 数值契约（点估计）；
 *   - range / uncertainty：显式携带不确定性，供影子比对与后续加权使用。
 */

export type SessionEvaluationTier = 'low' | 'mid' | 'high';

export interface SessionEvaluationTierAnchor {
  tier: SessionEvaluationTier;
  /** 锚点区间下界（含） */
  min: number;
  /** 锚点区间上界（含） */
  max: number;
  /** 点估计 = 区间中点；不代表精确测量 */
  representative: number;
  /** 锚点行为描述（与 yaml「评分参考」一致；改锚点必须同步改这里与 yaml） */
  anchor: string;
}

export const SESSION_EVALUATION_TIER_ANCHORS: readonly SessionEvaluationTierAnchor[] = [
  {
    tier: 'low',
    min: 1,
    max: 4,
    representative: 2.5,
    anchor: 'KTL：反复卡住未能完成核心任务或关键误解仍未解决；LSS：课堂整体顺畅；LF：精力基本稳定、课堂参与和回应效率良好',
  },
  {
    tier: 'mid',
    min: 5,
    max: 7,
    representative: 6,
    anchor: 'KTL：引导下能推进但对核心概念仍模糊或应用不稳定；LSS：有明显吃力和停顿但引导下仍能推进；LF：存在一定疲劳或重复但仍能维持参与',
  },
  {
    tier: 'high',
    min: 8,
    max: 10,
    representative: 9,
    anchor: 'KTL：学生能独立完成核心任务，或修正关键误解后稳定应用核心知识点；LSS：多轮阻塞、反复困惑、高负荷；LF：明显疲劳、低效重复、情绪受挫或持续投入下降',
  },
];

const ANCHOR_BY_TIER: ReadonlyMap<SessionEvaluationTier, SessionEvaluationTierAnchor> = new Map(
  SESSION_EVALUATION_TIER_ANCHORS.map((anchor) => [anchor.tier, anchor] as const),
);

export const SESSION_EVALUATION_TIERS: readonly SessionEvaluationTier[] = SESSION_EVALUATION_TIER_ANCHORS.map(
  (anchor) => anchor.tier,
);

export function isSessionEvaluationTier(value: unknown): value is SessionEvaluationTier {
  return typeof value === 'string' && ANCHOR_BY_TIER.has(value as SessionEvaluationTier);
}

export interface SessionEvaluationTierResolution {
  tier: SessionEvaluationTier;
  /** 区间中点（0-10 点估计） */
  value: number;
  range: { min: number; max: number };
  /** 区间半宽（max-min)/2：点估计的对称不确定度 */
  uncertainty: number;
}

export function resolveSessionEvaluationTier(tier: SessionEvaluationTier): SessionEvaluationTierResolution {
  const anchor = ANCHOR_BY_TIER.get(tier);
  if (!anchor) throw new Error(`未知的会话评估档位：${String(tier)}`);
  return {
    tier: anchor.tier,
    value: anchor.representative,
    range: { min: anchor.min, max: anchor.max },
    uncertainty: (anchor.max - anchor.min) / 2,
  };
}

/** 便捷入口：档位 → 0-10 点估计（内部走 resolve，保证只有一份映射） */
export function sessionEvaluationTierToValue(tier: SessionEvaluationTier): number {
  return resolveSessionEvaluationTier(tier).value;
}

/**
 * 零证据兜底（确定式，唯一来源）：会话没有任何可评估证据时使用。
 * 与 `prompts/core/session-wrapup.yaml` 规则「零证据分支」一致：三项均取保守值 3、confidence 0.1。
 *
 * 注意区分两件事：
 * - **零证据**（整节课都没有观测）→ 用本常量（显式兜底，值固定）；
 * - **部分输入缺失**（某一轮/某一项信号没有）→ 一律按权重 0 处理（见聚合层），
 *   绝不用默认值补——历史坑：缺失被兜底成本地最大模具。
 */
export const SESSION_EVALUATION_ZERO_EVIDENCE = {
  lss: 3,
  ktl: 3,
  lf: 3,
  confidence: 0.1,
  reasoning: '无对话证据',
} as const;
