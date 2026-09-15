/**
 * ReplanAttributionService（路径重排建议的归因层）
 *
 * 现状问题：`LearnerSnapshotService.deriveReplanSignal` 用 7 条阈值给出 `recommendation / rationale`，
 * 逻辑可复算但有代价——**用户看到"建议调整后续路径"却不知道凭什么**（rationale 是模板句），
 * 于是不知道该不该点确认。这层只补归因与方向，不动召回：
 *
 * - **阈值仍是唯一召回门**：`shouldSuggest / priority / scope` 由确定性信号决定，LLM 不能凭空
 *   建议重排，也不能越过召回范围；
 * - LLM 只在 `allowedRecommendations`（系统真能执行的方向）里选一个，并给出主因与一条可证伪断言；
 * - 断言经 `insight-calibration` 以 `insightType='replan_attribution'` 单独成列（不与
 *   learner-state-review 的可靠性混算）；
 * - 超时/失败/越界 → 返回 null，调用方保留阈值版（护栏：失败降级，不阻塞课后收束）。
 */
import { logger } from '../../utils/logger';
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';
import type { LearnerReplanSignal } from '../../agents/learner-model-agent/types';

/** 归因超时（毫秒）：课后收束路径上，宁可不要归因也不拖住收束 */
export const ATTRIBUTION_TIMEOUT_MS = 8000;
/** 断言最多 1 条（多了就是噪声，也会稀释校准样本） */
export const MAX_CLAIMS = 1;

export interface ReplanAttributionEvidence {
  id: string;
  kind: string;
  text: string;
}

export interface ReplanAttribution {
  primaryReasonCode: string;
  recommendation: string;
  reason: string;
  claim: string;
  checkOn: 'next_lesson' | 'next_task';
  expect: string;
  evidenceRefs: string[];
  source: 'llm';
}

export interface ReplanAttributionDeps {
  callSkill: (input: Record<string, unknown>) => Promise<{ success: boolean; output?: any; error?: any }>;
}

const defaultDeps: ReplanAttributionDeps = {
  callSkill: (input) => executeSkillWithResult(auxSkillDefinitionMap['replan-attribution'], input as any) as any,
};

/** 系统真正能执行的方向：与 ReplanAdvisoryService 的 UI options 保持一致 */
export const EXECUTABLE_RECOMMENDATIONS = ['keep', 'reinforce', 'slow_down', 'resequence', 'accelerate'] as const;

/**
 * 校验并整形归因输出（越界即丢弃该字段，主因/方向必须落在允许集合里）。
 * 纯函数，便于单测。
 */
export function normalizeAttribution(
  raw: any,
  context: { reasonCodes: string[]; allowedRecommendations: string[]; evidenceIds: string[] },
): ReplanAttribution | null {
  if (!raw || typeof raw !== 'object') return null;
  const reasonCode = String(raw.primaryReasonCode || '').trim();
  const recommendation = String(raw.recommendation || '').trim();
  const reason = String(raw.reason || '').trim().slice(0, 60);
  if (!reason) return null;
  const knownEvidence = new Set(context.evidenceIds);
  const evidenceRefs = (Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs : [])
    .map((item: any) => String(item || '').trim())
    .filter((id: string) => id && knownEvidence.has(id))
    .slice(0, 4);
  const rawClaim = String(raw.claim || '').trim().slice(0, 80);
  const source: ReplanAttribution = {
    primaryReasonCode: context.reasonCodes.includes(reasonCode) ? reasonCode : (context.reasonCodes[0] || ''),
    // 方向必须在"系统真能执行"且"本轮允许"的交集里；不在就给 keep（宁可不动）
    recommendation: context.allowedRecommendations.includes(recommendation) ? recommendation : 'keep',
    reason,
    claim: rawClaim,
    checkOn: raw.checkOn === 'next_task' ? 'next_task' : 'next_lesson',
    expect: String(raw.expect || '').trim().slice(0, 40),
    evidenceRefs,
    source: 'llm',
  };
  return source;
}

/**
 * 只有"风险方向"的断言才与校准口径同向（hit = 相关概念仍然不稳）。
 * accelerate / keep 的断言语义相反，记进去会污染命中率，故不记录（如对称性实现在后续做）。
 */
export function isCalibratableDirection(recommendation: string): boolean {
  return ['reinforce', 'slow_down', 'resequence'].includes(recommendation);
}

class ReplanAttributionService {
  constructor(private readonly deps: ReplanAttributionDeps = defaultDeps) {}

  /**
   * 产出归因。调用方必须在 `recall.shouldSuggest === true` 时才调用（阈值是唯一召回门）。
   */
  async attribute(input: {
    recall: LearnerReplanSignal;
    evidence: ReplanAttributionEvidence[];
    pathContext?: { milestoneTitle?: string | null; stageNumber?: number | null };
    allowedRecommendations?: string[];
    timeoutMs?: number;
  }): Promise<ReplanAttribution | null> {
    const reasonCodes = (input.recall?.reasonCodes ?? []).filter(Boolean);
    // 允许集合：默认"真能执行的"，且必须在阈值给出的方向之外也不越界（阈值方向一定放行）
    const allowed = (input.allowedRecommendations ?? EXECUTABLE_RECOMMENDATIONS as unknown as string[])
      .filter((item) => (EXECUTABLE_RECOMMENDATIONS as readonly string[]).includes(item));
    if (allowed.length === 0) return null;
    const recallRecommendation = String(input.recall?.recommendation || '');
    if (recallRecommendation && !allowed.includes(recallRecommendation)) {
      allowed.unshift(recallRecommendation);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.deps.callSkill({
          recall: {
            reasonCodes,
            recommendation: recallRecommendation,
            priority: input.recall?.priority,
            rationale: input.recall?.rationale,
          },
          allowedRecommendations: allowed,
          evidence: input.evidence.slice(0, 12),
          ...(input.pathContext ? { pathContext: input.pathContext } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`REPLAN_ATTRIBUTION_TIMEOUT:${input.timeoutMs ?? ATTRIBUTION_TIMEOUT_MS}`)),
            input.timeoutMs ?? ATTRIBUTION_TIMEOUT_MS,
          );
        }),
      ]);
      if (!result?.success) throw new Error(String(result?.error?.message || 'replan-attribution failed'));
      const normalized = normalizeAttribution(result.output, {
        reasonCodes,
        allowedRecommendations: allowed,
        evidenceIds: input.evidence.map((item) => item.id).filter(Boolean),
      });
      if (normalized) {
        logger.info('[replan-attribution] 归因完成', {
          reasonCode: normalized.primaryReasonCode,
          recommendation: normalized.recommendation,
          hasClaim: !!normalized.claim,
        });
      }
      return normalized;
    } catch (error) {
      logger.warn('[replan-attribution] 归因失败/超时，保留阈值版建议', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const replanAttributionService = new ReplanAttributionService();
export { ReplanAttributionService };
export default replanAttributionService;
