/**
 * KT 幽灵痕判定（唯一口径，2026-11-09 运营字段真值核查）
 *
 * 定义：`source='kt-estimate' && extractionCount=0` 的 memory_traces。
 * 来源：教学回合把模型输出 `analysis.ktEstimate.conceptMastery[].mastery` 直写进
 * memory_traces（`teaching-turn-engine.ts`），概念首次出现时 `extractionCount=0`。
 *
 * 它承载的是**模型自报的掌握概率**，不是学习证据。三处读侧都必须排除它：
 *   - 画像聚合（`LearnerKnowledgeMemoryService`，issue #59/#60）
 *   - 复习队列（`review-plan.service`）
 *   - 概念图谱（`concept-graph.service`）
 * 清理脚本（`scripts/cleanup-kt-ghost-traces.ts`）也用同一条件删库。
 *
 * 抽成单一函数是为了防止「一处排除了、另一处漏了」——2026-11-09 核查时
 * 图谱读路径正是漏了这道门，导致节点百分比可能是模型编的数。
 */
export interface KtGhostTraceLike {
  source?: string | null;
  extractionCount?: number | null;
}

/** 是否是 KT 幽灵痕（模型估计、从未真正提取过）。 */
export function isKtGhostTrace(trace: KtGhostTraceLike): boolean {
  return trace.source === 'kt-estimate' && (Number(trace.extractionCount) || 0) === 0;
}

/** 与 isKtGhostTrace 等价的 Prisma where 片段（清理脚本/查询用，避免 SQL 条件漂移）。 */
export const KT_GHOST_TRACE_WHERE = { source: 'kt-estimate', extractionCount: 0 } as const;
