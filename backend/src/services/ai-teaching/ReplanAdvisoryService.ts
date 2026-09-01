import type { LearnerReplanProjection } from '../../agents/learner-model-agent/types';
import type { SessionWrapupArtifact } from '../../skills/session-wrapup';

export interface ReplanAdvisory {
  shouldSuggest: boolean;
  priority: 'none' | 'low' | 'medium' | 'high';
  recommendation: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  scope: 'none' | 'next_milestone' | 'downstream_path';
  rationale: string;
  reasonCodes: string[];
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
  ui: {
    title: '',
    body: '',
    options: [],
  },
};

export class ReplanAdvisoryService {
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
    const highRisk = (
      (lss !== null && lss >= 6) ||
      (lf !== null && lf >= 6) ||
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
    const canAccelerate = (
      currentMilestoneComplete &&
      (ktl !== null && ktl >= 7) &&
      (lss !== null && lss <= 4.5) &&
      (lf !== null && lf <= 4.5) &&
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
