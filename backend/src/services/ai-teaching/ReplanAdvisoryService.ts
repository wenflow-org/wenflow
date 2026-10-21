import type { LearnerReplanProjection } from '../../agents/learner-model-agent/types';
import type { SessionWrapupArtifact } from '../../skills/session-wrapup';
import type { ReplanAttribution } from './ReplanAttributionService';
import { DISPLAY_LABEL_MAP } from '../learning/learning.constants';

import type { LearnerReplanSignal } from '../../agents/learner-model-agent/types';

/**
 * 兜底文案与占位 id 不是概念名（与 LearnerKnowledgeMemoryService 的 F2 同源口径）：
 * `wrapup.progress.movedToReview` 的名字由教学层写进复习队列、**不经概念集合**，
 * 会把「理解核心原理」这类认知层级×领域组合词和 `concept-N` 占位 id 直接带进建议正文
 * （2026-10-15 真课实测：修复后新课正文仍含兜底词，走的正是这条 F2 管不到的通道）。
 */
const DISPLAY_LABEL_PHRASES: ReadonlySet<string> = new Set(
  Object.values(DISPLAY_LABEL_MAP).flatMap((levelMap) => Object.values(levelMap))
);
const PLACEHOLDER_NAME_RE = /^concept-\d+$/i;

function isRealConceptName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && !PLACEHOLDER_NAME_RE.test(trimmed) && !DISPLAY_LABEL_PHRASES.has(trimmed);
}

export interface ReplanAdvisory {
  shouldSuggest: boolean;
  priority: 'none' | 'low' | 'medium' | 'high';
  recommendation: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  /**
   * 建议影响范围。`downstream_path` **刻意没有自动执行器**（2026-10-17 判定为不做）：
   * 它意味着改动会波及后续整条路径，而路径改动一律走「学习者确认 → 重排 + 快照可回退」这条门
   * （replan-snapshots / replan-rollback）。若为它加自动执行，等于绕过确认门并让学习者失去
   * 一键回退——省一次点击的收益远小于误改整条路径的代价。本字段只用于文案与执行范围提示。
   */
  scope: 'none' | 'next_milestone' | 'downstream_path';
  /**
   * 建议所指的目标阶段（= 生成建议时的「下一阶段」）。确认时前端/后端据此传
   * stageNumber / fromStageNumber，避免文案说「下一阶段」而执行落点回落到当前活动阶段（#58）。
   */
  targetStageNumber?: number | null;
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
    /** 阶段序号（#58：建议落点随建议一起落库，确认时不再靠缺省推断） */
    stageNumber?: number;
  } | null;
}

/** 「无建议」单例：延伸课一期只观测（#124），与其它不满足建议条件的场景共用。 */
export const NO_ADVISORY: ReplanAdvisory = {
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

/** 补救型建议动作：它们的语义前提是「这节课让人吃力」，故只在有吃力证据时才允许发出。 */
export const REMEDIAL_ADVISORY_ACTIONS = ['reinforce', 'slow_down'] as const;

/**
 * 哪些课型不产出路径调整建议。
 * - extension（#124）：不是任务完成课，一期只观测。
 * - review：复习课的知识看板是**跨路径**到期点，而建议会挂到「开课时借用的那条路径」上，
 *   属于对象错配（2026-10-21 实测 105 个复习课堂里 32 个带了 shouldSuggest 建议）。
 *   复习结果只走 FSRS/温故，不推动路径重排；要重排也应从正课或路径视图发起。
 */
export function shouldBuildReplanAdvisory(mode: string | null | undefined): boolean {
  return mode !== 'extension' && mode !== 'review';
}

/**
 * 建议可信度阈值（2026-10-15）。此前判据是「计数>0 即发」→ 建议退化成**每课必发**
 * （实测全库 51 条带建议会话：`reinforce` 27 条、`resequence` 10 条，其中
 * **19 条是 `reinforce` 打在 sessionLss=low 且 sessionLf=low 的课上**——这节课并没有吃力，
 * 「补强关键基础」于是被稀释成噪音）。
 *
 * 注意 `wrapup.evaluation.confidence` **不能**当阈值：41 节实测恒落在 0.7-0.9（评测自评饱和），
 * 阈值设 0.5/0.6/0.7 全都等于没设。真正的口子在本节课**自身**的档位证据。
 *
 * 口径（只压"补救型"、不动其它轴）：
 * - 本节课双低（sessionLss=low 且 sessionLf=low）→ 压制 reinforce/slow_down；
 * - `accelerate`（压缩下一阶段）**不压**——课不吃力正是它成立的理由；
 * - `resequence` **不压**——它由结构性风险/截止落后驱动，与本节课难度是两条轴；
 * - `highRisk` 与 `explicitKnowledgeEvidence`（本课真的浮出脆弱/卡点知识点）**豁免**——
 *   它们是独立于自评档位的硬证据，"自评说不难"不应盖过它们；
 * - 档位缺失（legacy 行）一律放行，避免误伤存量。
 */
export function shouldSuppressRemedialAdvisory(input: {
  recommendation?: string | null;
  sessionLss?: string | null;
  sessionLf?: string | null;
  highRisk?: boolean;
  explicitKnowledgeEvidence?: boolean;
}): boolean {
  if (input.highRisk || input.explicitKnowledgeEvidence) return false;
  if (input.sessionLss !== 'low' || input.sessionLf !== 'low') return false;
  return (REMEDIAL_ADVISORY_ACTIONS as readonly string[]).includes(String(input.recommendation || ''));
}

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
    const lss = wrapup.evaluation?.sessionLss ?? null;
    const lf = wrapup.evaluation?.sessionLf ?? null;
    // ktl/confidence 不再在本层判「能否加速」（F4 2026-10-15 归一到快照 accelerateReady）：
    // ktl 是本会话训练负荷（会话量纲 0-10），"能不能加速"是学习者级判断，本层不重复真值；
    // confidence 实测恒 0.7-0.9（自评饱和），从未起过阈值作用。
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
    // 2026-09-27 阈值收紧：movedToReview（知识点移入复习队列）是每节课的正常产物，
    // 不能单独构成 highRisk——全量库实测 361 节结课 163 节触发建议（45%），
    // "调整"动作被稀释成每课必发的噪音。highRisk 只保留评估高档与前置缺口两类真异常。
    const highRisk = (
      isHighSignal(evaluationTiers?.sessionLss, lss) ||
      isHighSignal(evaluationTiers?.sessionLf, lf) ||
      prerequisiteGaps.some((item) => item.severity === 'high')
    );

    // 建议可信度阈值：本节课双低时压制"补救型"动作（详见 shouldSuppressRemedialAdvisory 的注释）。
    // 「显式知识证据」只认**卡点**（struggling，证据均分 <0.55 的真接触证据）——2026-10-15 实测教训：
    // 此前写成 `fragile>0 || struggling>0`，而 fragile 是记忆引擎「未巩固」的饱和通道（刚学的概念
    // 本来 <0.5，四位 VL 痕迹 70-100% 命中）→ 豁免恒成立，双低压制形同虚设（真课实测：修复后新课
    // 仍每课必发 reinforce 就是走的这个口）。
    const explicitKnowledgeEvidence = strugglingConcepts.length > 0;
    const advisoryThreshold = {
      sessionLss: evaluationTiers?.sessionLss,
      sessionLf: evaluationTiers?.sessionLf,
      highRisk,
      explicitKnowledgeEvidence,
    };
    const suppressSignalAdvisory = shouldSuppressRemedialAdvisory({
      ...advisoryThreshold,
      recommendation: learnerSignal?.recommendation,
    });

    if (learnerSignal?.shouldSuggest && !suppressSignalAdvisory) {
      const recommendation = learnerSignal.recommendation === 'keep' ? 'reinforce' : learnerSignal.recommendation;
      const scope = learnerSignal.scope === 'none' ? 'next_milestone' : learnerSignal.scope;
      const priority = learnerSignal.priority === 'none' ? 'low' : learnerSignal.priority;
      // 点名只列真卡点与真实复习项：fragile 是饱和通道（会挤掉真名字），movedToReview 过兜底词/占位 id。
      const focusPoints = [
        ...strugglingConcepts.slice(0, 2),
        ...wrapup.progress.movedToReview.filter(isRealConceptName).slice(0, 2),
      ].filter(Boolean);
      // accelerate（压缩）走专用文案：界面语义是「把下一阶段压得更聚焦」，不是通用的「确认调整」。
      const isAccelerate = recommendation === 'accelerate';
      return {
        shouldSuggest: true,
        priority,
        recommendation,
        scope,
        targetStageNumber: nextMilestone.stageNumber ?? null,
        rationale: learnerSignal.rationale || '学习者状态中心判断当前路径后续安排需要重新确认。',
        reasonCodes: learnerSignal.reasonCodes || [],
        ui: isAccelerate
          ? {
              title: '可以考虑加速下一阶段',
              body: `你在当前阶段的掌握比较稳定，而且本节课学习压力与疲劳都不高。建议把下一阶段“${nextMilestone.title}”调整成更聚焦的安排。该调整只会调整后续阶段的课程安排，不影响你已完成的内容。`,
              options: [
                { key: 'keep', label: '保持原计划', description: '继续按当前路径推进。' },
                { key: 'accelerate', label: '压缩下一阶段', description: '减少重复内容，更快进入重点。' },
                { key: 'preview', label: '先看建议', description: '先查看系统建议，再决定是否调整。' },
              ],
            }
          : {
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

    // fragile 不再单独把流程救活（饱和通道，见上方 explicitKnowledgeEvidence 注释）：
    // 阶段没完、无高危、无卡点 → 直接不发，哪怕 fragile 名单再长。
    if (!currentMilestoneComplete && !highRisk && strugglingConcepts.length === 0) {
      return suppressSignalAdvisory
        ? { ...NO_ADVISORY, reasonCodes: ['advisory_suppressed_lesson_not_hard'] }
        : NO_ADVISORY;
    }

    const needsReinforcement = (
      wrapup.progress.stillLearning.length > 0 ||
      strugglingConcepts.length > 0 ||
      repeatedConfusion ||
      // movedToReview 降档后归入补强语义：阶段收尾时还有点在复习队列 → 建议补强（而非风险）
      wrapup.progress.movedToReview.length > 0
    );
    // 压缩（accelerate）不再在这里二次判定（F4，2026-10-15）：此处的 canAccelerate 是
    // LearnerSnapshotService.accelerateReady 的更严孪生（fragile=0 && struggling=0 && movedToReview=0
    // 在饱和通道下生产不可达）——同一事实两处真值、严者静默胜出，「压缩下一阶段」从未出现过。
    // 归一为单一来源：accelerate 只由快照的 accelerateReady 判定，经上方信号分支直出（含专用文案）。

    // 同一阈值也管这条补强分支（该分支非 highRisk 时的唯一产出就是 reinforce）：
    // 本节课双低且没有显式知识证据时，不再凭 movedToReview/stillLearning 这类每课副产品发「补强」。
    if (shouldSuppressRemedialAdvisory({ ...advisoryThreshold, recommendation: 'reinforce' })) {
      return { ...NO_ADVISORY, reasonCodes: ['advisory_suppressed_lesson_not_hard'] };
    }

    if (highRisk || (currentMilestoneComplete && needsReinforcement)) {
      if (highRisk) reasonCodes.push('high_risk');
      if (fragileConcepts.length > 0) reasonCodes.push('fragile_concepts');
      if (strugglingConcepts.length > 0) reasonCodes.push('struggling_concepts');
      if (wrapup.progress.movedToReview.length > 0) reasonCodes.push('moved_to_review');
      if (repeatedConfusion) reasonCodes.push('repeated_confusion');

      // 与信号分支同口径：点名只列真卡点与真实复习项（fragile 饱和会挤掉真名字）。
      const focusPoints = [
        ...strugglingConcepts.slice(0, 2),
        ...wrapup.progress.movedToReview.filter(isRealConceptName).slice(0, 2),
      ].filter(Boolean);

      return {
        shouldSuggest: true,
        priority: highRisk ? 'high' : 'medium',
        recommendation: highRisk ? 'slow_down' : 'reinforce',
        scope: 'next_milestone',
        targetStageNumber: nextMilestone.stageNumber ?? null,
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