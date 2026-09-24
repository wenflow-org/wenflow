import type { LearnerReplanProjection } from '../../agents/learner-model-agent/types';
import type { SessionWrapupArtifact } from '../../skills/session-wrapup';
import type { ReplanAttribution } from './ReplanAttributionService';

import type { LearnerReplanSignal } from '../../agents/learner-model-agent/types';

export interface ReplanAdvisory {
  shouldSuggest: boolean;
  priority: 'none' | 'low' | 'medium' | 'high';
  recommendation: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  scope: 'none' | 'next_milestone' | 'downstream_path';
  rationale: string;
  reasonCodes: string[];
  /** LLM 归因（阈值召回后补的"为什么"）；未启用/失败时为 null */
  attribution?: ReplanAttributionNote | null;
  ui: {
    title: string;
    body: string;
    options: Array<{
      key: string;
      label: string;
      description: string;
    }>;
  };
}

/** 归因注记：LLM 给的主因与方向，附一条可证伪断言（用于事后校准） */
export interface ReplanAttributionNote {
  primaryReasonCode: string;
  reason: string;
  claim: string;
  expect: string;
  checkOn: 'next_lesson' | 'next_task';
  evidenceRefs: string[];
  /** 阈值原本给出的方向（归因方向与之不同时留痕，便于事后看分歧） */
  thresholdRecommendation: string;
}

interface BuildInput {
  wrapup: SessionWrapupArtifact;
  learnerReplanProjection: LearnerReplanProjection | null;
  nextMilestone?: {
    milestoneId: string;
    title: string;
    goal?: string | null;
    totalTasks?: number;
  } | null;
}

const NO_ADVISORY: ReplanAdvisory = {
  shouldSuggest: false,
  priority: 'none',
  recommendation: 'keep',
  scope: 'none',
  rationale: '',
  reasonCodes: [],
  attribution: null,
  ui: {
    title: '',
    body: '',
    options: [],
  },
};

/**
 * 把 LLM 归因并进建议：**只在建议本身已成立（shouldSuggest）时**才并，
 * 且方向必须落在本条建议的可选项里（否则 UI 会出现"按钮说一套、推荐说另一套"）；
 * 不在可选项里时退回阈值方向，但仍保留归因注记（含阈值方向，便于事后看分歧）。
 */
export function applyAttribution(
  advisory: ReplanAdvisory,
  attribution: ReplanAttribution | null | undefined,
): ReplanAdvisory {
  if (!advisory.shouldSuggest || !attribution?.reason) return advisory;
  const optionKeys = new Set(advisory.ui.options.map((option) => option.key));
  const recommendation = optionKeys.has(attribution.recommendation)
    ? (attribution.recommendation as ReplanAdvisory['recommendation'])
    : advisory.recommendation;
  return {
    ...advisory,
    recommendation,
    attribution: {
      primaryReasonCode: attribution.primaryReasonCode,
      reason: attribution.reason,
      claim: attribution.claim,
      expect: attribution.expect,
      checkOn: attribution.checkOn,
      evidenceRefs: attribution.evidenceRefs,
      thresholdRecommendation: advisory.recommendation,
    },
  };
}

/**
 * 归因 skill 的召回输入：**只从建议本身派生**（单一来源）。
 *
 * 断链修复（审计 §3.19 P1⑦）：此前 `recall` 传的是信号层 `learnerReplanProjection.signal`，
 * 而 `allowedRecommendations` 来自建议层 —— 两套阈值各自成立，会出现
 * 「允许的动作是 accelerate，但可选原因码里没有 ready_to_accelerate」这类不一致
 * （`high_risk` / `moved_to_review` / `repeated_confusion` 更是只有建议层才有）。
 * 现在召回与动作同源：都取自最终 advisory。
 */
export function toAttributionRecall(advisory: ReplanAdvisory): LearnerReplanSignal {
  return {
    shouldSuggest: advisory.shouldSuggest,
    priority: advisory.priority,
    recommendation: advisory.recommendation,
    scope: advisory.scope,
    rationale: advisory.rationale,
    reasonCodes: [...advisory.reasonCodes],
  };
}

export class ReplanAdvisoryService {
  /** 归因合并（纯函数委托，见 applyAttribution） */
  applyAttribution(advisory: ReplanAdvisory, attribution: ReplanAttribution | null | undefined): ReplanAdvisory {
    return applyAttribution(advisory, attribution);
  }

  build(input: BuildInput): ReplanAdvisory {
    const { wrapup, learnerReplanProjection, nextMilestone } = input;
    if (!learnerReplanProjection || !nextMilestone) {
      return NO_ADVISORY;
    }

    const reasonCodes: string[] = [];
    const ktl = wrapup.evaluation?.sessionKtl ?? null;
    const lss = wrapup.evaluation?.sessionLss ?? null;
    const lf = wrapup.evaluation?.sessionLf ?? null;
    const confidence = wrapup.evaluation?.confidence ?? 0;
    const fragileConcepts = learnerReplanProjection.mastery.fragileConcepts || [];
    const strugglingConcepts = learnerReplanProjection.mastery.strugglingConcepts || [];
    const prerequisiteGaps = learnerReplanProjection.risk.prerequisiteGaps || [];
    const currentMilestone = learnerReplanProjection.evidence.milestoneStates.find(
      (item) => item.milestoneId === learnerReplanProjection.path.currentPosition.milestoneId
    );
    const currentMilestoneComplete = !!currentMilestone && currentMilestone.totalTasks > 0 && currentMilestone.completedTasks >= currentMilestone.totalTasks;

    const repeatedConfusion = wrapup.evidence.topConfusionPoints.length >= 2;
    const learnerSignal = learnerReplanProjection.signal;
    // 2026-09-22：档位化后 mid 的中点=6，会让整个 mid 档（"有明显吃力但能推进"）压到 >=6 被算作高风险。
    // 改为按档位判定（只有 high 才算高风险）；legacy 数值（无档位）仍走数值阈值。
    const evaluationTiers = (wrapup.evaluation as { metricTiers?: { sessionLss?: string; sessionLf?: string } } | undefined)?.metricTiers;
    const isHighSignal = (tier: string | undefined, value: number | null): boolean =>
      tier ? tier === 'high' : (typeof value === 'number' && Number.isFinite(value) && value >= 6);
    const highRisk = (
      isHighSignal(evaluationTiers?.sessionLss, lss) ||
      isHighSignal(evaluationTiers?.sessionLf, lf) ||
      prerequisiteGaps.some((item) => item.severity === 'high') ||
      wrapup.progress.movedToReview.length > 0
    );

    if (learnerSignal?.shouldSuggest) {
      const recommendation = learnerSignal.recommendation === 'keep' ? 'reinforce' : learnerSignal.recommendation;
      const scope = learnerSignal.scope === 'none' ? 'next_milestone' : learnerSignal.scope;
      const priority = learnerSignal.priority === 'none' ? 'low' : learnerSignal.priority;
      const focusPoints = [
        ...fragileConcepts.slice(0, 2),
        ...strugglingConcepts.slice(0, 2),
        ...wrapup.progress.movedToReview.slice(0, 2),
      ].filter(Boolean);

      return {
        shouldSuggest: true,
        priority,
        recommendation,
        scope,
        rationale: learnerSignal.rationale || '学习者状态中心判断当前路径后续安排需要重新确认。',
        reasonCodes: learnerSignal.reasonCodes || [],
        ui: {
          title: priority === 'high' ? '建议先确认路径调整' : '可以考虑调整后续路径',
          body: focusPoints.length > 0
            ? `系统检测到 ${focusPoints.join('、')} 这些点仍会影响后续推进。建议先确认是否调整“${nextMilestone.title}”及后续阶段安排。该调整只会调整后续阶段的课程安排，不会覆盖你已完成的内容。`
            : `系统判断当前学习者状态与知识背景提示“${nextMilestone.title}”之后的推进方式需要重新确认。该调整只会调整后续阶段的课程安排，不会覆盖你已完成的内容。`,
          options: [
            { key: 'keep', label: '保持原计划', description: '继续按当前路径推进。' },
            { key: 'preview', label: '查看调整建议', description: '先查看系统建议，再决定是否调整。' },
            { key: 'confirm', label: '确认调整后续阶段', description: '确认后基于当前证据调整后续阶段的课程安排。' },
          ],
        },
      };
    }

    if (!currentMilestoneComplete && !highRisk && fragileConcepts.length === 0 && strugglingConcepts.length === 0) {
      return NO_ADVISORY;
    }

    const needsReinforcement = (
      wrapup.progress.stillLearning.length > 0 ||
      fragileConcepts.length > 0 ||
      strugglingConcepts.length > 0 ||
      repeatedConfusion
    );
    // 层级要对齐：`ktl` 是**本会话**的训练负荷（这节课练得扎实，会话量纲 0-10），
    // 而"能不能加速"是**学习者级**判断 —— 后者必须看学习者级疲劳/负荷，
    // 不能拿单会话的 lss/lf 当全局闸门（"这节课难" ≠ "这个人该慢下来"）。
    const canAccelerate = (
      currentMilestoneComplete &&
      (ktl !== null && ktl >= 7) &&
      learnerReplanProjection.risk.fatigueRisk === 'low' &&
      learnerSignal?.priority !== 'high' &&
      confidence >= 0.6 &&
      fragileConcepts.length === 0 &&
      strugglingConcepts.length === 0 &&
      wrapup.progress.movedToReview.length === 0
    );

    if (canAccelerate) {
      reasonCodes.push('stable_mastery', 'ready_to_accelerate');
      return {
        shouldSuggest: true,
        priority: 'low',
        recommendation: 'accelerate',
        scope: 'next_milestone',
        rationale: '当前阶段掌握较稳定，下一阶段可以考虑压缩为更聚焦的推进版本。',
        reasonCodes,
        ui: {
          title: '可以考虑加速下一阶段',
          body: `你在当前阶段的掌握比较稳定，而且本节课学习压力与疲劳都不高。建议把下一阶段“${nextMilestone.title}”调整成更聚焦的安排。该调整只会调整后续阶段的课程安排，不影响你已完成的内容。`,
          options: [
            { key: 'keep', label: '保持原计划', description: '继续按当前路径推进。' },
            { key: 'accelerate', label: '压缩下一阶段', description: '减少重复内容，更快进入重点。' },
            { key: 'preview', label: '先看建议', description: '先查看系统建议，再决定是否调整。' },
          ],
        },
      };
    }

    if (highRisk || (currentMilestoneComplete && needsReinforcement)) {
      if (highRisk) reasonCodes.push('high_risk');
      if (fragileConcepts.length > 0) reasonCodes.push('fragile_concepts');
      if (strugglingConcepts.length > 0) reasonCodes.push('struggling_concepts');
      if (wrapup.progress.movedToReview.length > 0) reasonCodes.push('moved_to_review');
      if (repeatedConfusion) reasonCodes.push('repeated_confusion');

      const focusPoints = [
        ...fragileConcepts.slice(0, 2),
        ...strugglingConcepts.slice(0, 2),
        ...wrapup.progress.movedToReview.slice(0, 2),
      ].filter(Boolean);

      return {
        shouldSuggest: true,
        priority: highRisk ? 'high' : 'medium',
        recommendation: highRisk ? 'slow_down' : 'reinforce',
        scope: 'next_milestone',
        rationale: '当前阶段虽然已结束或接近结束，但仍有关键知识点不够稳定，直接进入下一阶段可能会放大后续理解风险。',
        reasonCodes,
        ui: {
          title: '建议先调整下一阶段安排',
          body: focusPoints.length > 0
            ? `你刚完成当前阶段，但 ${focusPoints.join('、')} 这些点还不够稳定。建议在进入“${nextMilestone.title}”前，先补强相关安排。该调整只会调整后续阶段的课程安排，不影响你已完成的内容。`
            : `你刚完成当前阶段，但当前学习信号显示直接进入“${nextMilestone.title}”的风险偏高。建议先调整下一阶段安排。该调整只会调整后续阶段的课程安排，不影响你已完成的内容。`,
          options: [
            { key: 'keep', label: '保持原计划', description: '继续按当前路径进入下一阶段。' },
            { key: 'reinforce', label: '补强后再进', description: '先补一个关键小节，再进入下一阶段。' },
            { key: 'resequence', label: '调整下一阶段顺序', description: '保留目标，但重新安排下一阶段内容顺序。' },
            { key: 'later', label: '稍后再决定', description: '先保留建议，暂时不调整。' },
          ],
        },
      };
    }

    return NO_ADVISORY;
  }
}

export const replanAdvisoryService = new ReplanAdvisoryService();