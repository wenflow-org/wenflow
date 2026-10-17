import prisma from '../../config/database';
import { learnerProfileService } from './LearnerProfileService';
import { personalizationEngine } from '../../agents/learner-model-agent/personalization';
import learningStateService from '../learning/learning-state.service';
import type {
  LearnerDynamicState,
  LearnerLearningControlState,
  LearnerKnowledgeMemory,
  LearnerReplanSignal,
  LearnerSnapshot,
  LearnerTeachingHints,
} from '../../agents/learner-model-agent/types';
import { learnerKnowledgeMemoryService } from './LearnerKnowledgeMemoryService';
// 相对量判据（ACWR/form）单一真理源——把"疲劳/节奏/可加速"从绝对阈值迁到尺度无关的判据上。
import { classifyLoad } from '../learning/learning-load-verdict';

export interface LearnerSnapshotScopeInput {
  userId: string;
  learningPathId?: string;
  milestoneId?: string;
  taskId?: string;
  mode?: 'global' | 'path' | 'teaching';
}

function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 疲劳档（**相对量判据**，2026-10-15 PMC 改造）：由 ACWR = lf/ktl 定，不再用绝对 `lf >= 6`。
 * 绝对阈值在 PMC 日负荷口径下失效——习惯每天多课的学习者（已适应）KTL/LF 会同步升高，
 * 但 acwr≈1（稳态）；绝对 `lf>=6` 会把他永久判成"高疲劳"。相对量尺度无关。
 */
function deriveFatigueRisk(ktl: number, lf: number): 'low' | 'medium' | 'high' {
  return classifyLoad({ ktl, lf }).fatigueRisk;
}

/** SRL 三阶段（Zimmerman 2000）：活跃会话=performance，完结会话=reflection，否则=forethought */
function deriveSrlPhase(latestSession: { updatedAt?: Date; status?: string } | null): 'forethought' | 'performance' | 'self-reflection' {
  if (!latestSession) return 'forethought';
  if (latestSession.status === 'active' || latestSession.status === 'paused') return 'performance';
  return 'self-reflection';
}

/**
 * 全局节奏（**相对量判据**）：由相对形态定，不再用绝对 `lf>=6`/`ktl>=5`。
 * - LSS 是**单课**压力，不在这里决定全局节奏（否则"今天这门课很难"会被当成"这周很累"）；
 *   单课压力的去处是课内控制状态（deriveLearningControlState）。
 * - "总负荷失衡"（form < 0，旧 `lsb < 0`）**不在这里重复消费**：它由难度判定（降档）与
 *   重排信号（减速/补强）各司其职。节奏只回答"该快还是该慢"。
 */
export function derivePacing(lf: number, ktl: number): 'slow' | 'moderate' | 'fast' {
  return classifyLoad({ ktl, lf }).pacing;
}

/** 本节质量（**相对量判据**）：恢复良好 → strong；爬升过快 → weak；否则 mixed。 */
function deriveSessionQuality(ktl: number, lf: number): 'strong' | 'mixed' | 'weak' {
  const v = classifyLoad({ ktl, lf });
  if (v.recovered) return 'strong';
  if (v.fatigueRisk === 'high') return 'weak';
  return 'mixed';
}

export function deriveLearningControlState(input: {
  dynamicState: LearnerDynamicState;
  knowledgeMemory: LearnerKnowledgeMemory;
  /**
   * 课内判断用的状态：优先取"本节课所在路径"的状态（该路径无历史时回退全局聚合）。
   * 全局聚合管节奏/疲劳，路径级管单课难易 —— 分母（同一路径的基线）对了，难易判断才有意义。
   */
  lessonMetrics?: { lss: number; ktl: number; lf: number; lsb: number };
}): LearnerLearningControlState {
  const { dynamicState, knowledgeMemory } = input;
  const lesson = input.lessonMetrics ?? dynamicState.metrics;
  const { lss, ktl, lf, lsb } = lesson;
  // #59/#60 第 5 条：控制状态用**严重度**而不是裸 fragileCount——
  // fragile 名单此前几乎恒大于 0（低分/幽灵痕都会进），拿它判 reviewPriority/checkpointNeed
  // 等于把「刚学一半」当成「需要复习」，同时把难度升档口一路挡死。
  const severeStrugglingCount = (knowledgeMemory.globalSignals.severeStrugglingConcepts || []).length;
  const strugglingCount = knowledgeMemory.globalSignals.strugglingConcepts.length;
  const prerequisiteGapCount = knowledgeMemory.currentPath?.prerequisiteGaps.length || 0;

  // 相对量判据（ACWR/form，尺度无关）：见 learning-load-verdict。绝对 `lf>=6` 在 PMC 日负荷口径下失效。
  // 失衡用 verdict.imbalanced（= form<0 **且基座成熟**）——PMC 从 0 爬升期新学习者 lsb 天然 <0，
  // 那是"正在建立适应"，不是失衡（旧模型播种 ktl/lf 掩盖了这一点）。
  const lessonVerdict = classifyLoad({ ktl: lesson.ktl, lf: lesson.lf });
  const globalVerdict = classifyLoad({ ktl: dynamicState.metrics.ktl, lf: dynamicState.metrics.lf });
  const overloaded = lessonVerdict.fatigueRisk === 'high' || lessonVerdict.imbalanced;

  // 单课压力大 → 课内降档/加支架。
  // LSS 是**会话级**量：只有拿到了"本节课所在路径"的状态时才成立；
  // 该路径还没有历史时不借用别的路径的单课压力（跨路径污染），只保留全局疲劳这一路信号。
  const lessonStress = Boolean(input.lessonMetrics) && lss >= 6;

  const paceMode: LearnerLearningControlState['paceMode'] = overloaded || lessonStress
    ? 'recover'
    : dynamicState.recentTrend === 'improving' && lessonVerdict.recovered && lss <= 4
      ? 'push'
      : 'steady';

  const conceptLoad: LearnerLearningControlState['conceptLoad'] = overloaded || lessonStress
    ? 'low'
    : dynamicState.recentTrend === 'improving' && globalVerdict.recovered && prerequisiteGapCount === 0
      ? 'high'
      : 'medium';

  const reviewPriority: LearnerLearningControlState['reviewPriority'] = prerequisiteGapCount > 0 || severeStrugglingCount > 0 || globalVerdict.imbalanced
    ? 'high'
    : strugglingCount > 0
      ? 'medium'
      : 'low';

  const checkpointNeed: LearnerLearningControlState['checkpointNeed'] = dynamicState.recentTrend === 'declining' || severeStrugglingCount > 0 || strugglingCount > 1
    ? 'high'
    : paceMode === 'push'
      ? 'low'
      : 'medium';

  return {
    paceMode,
    conceptLoad,
    reviewPriority,
    challengeLevelCap: paceMode === 'recover' ? 'low' : paceMode === 'push' ? 'high' : 'medium',
    checkpointNeed,
    shouldAvoidNewConcepts: conceptLoad === 'low',
    shouldPreferConsolidation: reviewPriority === 'high',
    shouldOfferBreak: lessonVerdict.fatigueRisk === 'high' || dynamicState.fatigueRisk === 'high',
  };
}

/**
 * P1.6 落后触发器（TIME-TRUST-SCHEME-20261001）的信号码与阈值。
 *
 * 判据（工程启发式，标弱证据）：外部截止是高可信锚（方案 L1），把「剩余时间」与
 * 「剩余体量」对表——时间进度百分位（自路径起点到截止日的线性刻度）与实际完成百分位
 * 的偏差 ≥ DEADLINE_PACE_BEHIND_THRESHOLD（保守起步 0.2）即视为明显失配。
 * 只产出建议信号（reasonCode），重排仍走既有 awaiting-confirmation 建议流，
 * 不自动执行、不做每日排程。
 */
export const DEADLINE_PACE_BEHIND_CODE = 'deadline_pace_behind';
export const DEADLINE_PACE_BEHIND_THRESHOLD = 0.2;

export interface DeadlinePaceJudgement {
  behind: boolean;
  /** 时间进度百分位（0..1，已过期取 1） */
  expectedRatio: number;
  /** 实际完成百分位（0..1） */
  actualRatio: number;
  /** 落后幅度 = expectedRatio - actualRatio（>0 即落后） */
  gap: number;
}

/**
 * deadline × 进度失配判据（纯函数，可注入 now 便于钉边界）。
 * 返回 null = 判据不适用：无 deadline、无起点、截止窗非法（start ≥ deadline）或无体量（totalTasks=0）。
 */
export function judgeDeadlinePace(input: {
  deadline: Date | string | null | undefined;
  now: Date;
  pathStartedAt?: Date | string | null;
  totalTasks: number;
  completedTasks: number;
  threshold?: number;
}): DeadlinePaceJudgement | null {
  const deadlineMs = input.deadline ? new Date(input.deadline).getTime() : NaN;
  const startMs = input.pathStartedAt ? new Date(input.pathStartedAt).getTime() : NaN;
  const nowMs = new Date(input.now).getTime();
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return null;
  // 起点缺失或窗口非法（start ≥ deadline / start 在未来）时不判——时间刻度没有可信分母
  if (!Number.isFinite(startMs) || startMs >= deadlineMs || startMs > nowMs) return null;
  if (!(input.totalTasks > 0)) return null;

  const threshold = input.threshold ?? DEADLINE_PACE_BEHIND_THRESHOLD;
  const expectedRatio = Math.min(1, Math.max(0, (nowMs - startMs) / (deadlineMs - startMs)));
  const actualRatio = Math.min(1, Math.max(0, input.completedTasks / input.totalTasks));
  const gap = expectedRatio - actualRatio;
  return {
    behind: gap >= threshold,
    expectedRatio,
    actualRatio,
    gap,
  };
}

export function deriveReplanSignal(input: {
  dynamicState: LearnerDynamicState;
  learningControlState: LearnerLearningControlState;
  knowledgeMemory: LearnerKnowledgeMemory;
  /** 落后判据的时钟（可注入；缺省当前时刻）。测试用它钉 0.2 阈值边界 */
  now?: Date;
}): LearnerReplanSignal {
  const { dynamicState, learningControlState, knowledgeMemory } = input;
  const fragileCount = knowledgeMemory.globalSignals.fragileConcepts.length;
  const strugglingCount = knowledgeMemory.globalSignals.strugglingConcepts.length;
  const severeStrugglingCount = knowledgeMemory.globalSignals.severeStrugglingConcepts?.length || 0;
  const blockedCount = knowledgeMemory.globalBackground.blockedFoundations.length;
  const prerequisiteGapCount = knowledgeMemory.currentPath?.prerequisiteGaps.length || 0;
  const reasonCodes: string[] = [];

  // 路径完成度：重规划建议的意义是「后续安排怎么走」；若当前路径已走完（下游无可调整阶段），
  // 再报「建议重排后续路径」既无动作对象、也与学习者已完成的事实矛盾。
  // 历史实测：全库 159 条 teaching 投影里 158 条恒 shouldSuggest=true，其中含 18/18 全完成、
  // 每课 5/5 的路径仍报 priority=high + resequence —— 判据只看「计数>0」，无完成度/量级归一。
  const progress = knowledgeMemory.currentPath?.progress;
  const totalTasks = progress?.totalTasks ?? 0;
  const completedTasks = progress?.completedTasks ?? 0;
  const pathFullyComplete = totalTasks > 0 && completedTasks >= totalTasks;
  const completionRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  // 结构性风险（**一跳直接前置缺口**）才是「重排后续」的正当理由；单纯脆弱的点属于课内补强，不构成重排。
  // 判据与 ReplanAdvisoryService 的 highRisk 口径对齐：只有 severity==='high'（一跳直接阻塞当前任务）算结构性，
  // 契约见 ai-teaching/__tests__/replan-prerequisite-severity.test.ts。
  //
  // 为什么这里还要再排除 `source==='fallback'`：图缺失时的回落口径算的是「**当前任务自己**的概念没掌握」，
  // 那在 S4b 注释里正是被判定为"不是缺口"的旧口径，且它的 severity 按**稳定性**而非**深度**打，
  // 与契约（severity=缺口深度）不同义。刚上完一节课、概念还没掌握的会话会稳定命中它——
  // 全库实测 242 条带 advisory 的会话全部 shouldSuggest=true / priority=high /
  // recommendation=resequence / 同一条 rationale，正是本注释 136-137 行记过的"只看计数"老毛病复发。
  const structuralRisk = (knowledgeMemory.currentPath?.prerequisiteGaps || [])
    .some((gap) => gap.severity === 'high' && gap.source !== 'fallback');
  // 接近完成（≥90%）且无结构性风险时，也不值得为「重排后续」打断收尾。
  const nearCompleteNoStructural = !pathFullyComplete && completionRatio >= 0.9 && !structuralRisk;

  // 相对量判据（尺度无关）：全局疲劳由 ACWR 定，失衡由 form 定（imbalanced 已含"基座成熟"门，
  // 避免 PMC 爬升期新学习者 lsb 天然 <0 被误报）。
  const globalVerdict = classifyLoad({ ktl: dynamicState.metrics.ktl, lf: dynamicState.metrics.lf });
  const fatigueHigh = globalVerdict.fatigueRisk === 'high';

  if (fatigueHigh) reasonCodes.push('fatigue_high');
  if (globalVerdict.imbalanced) reasonCodes.push('lsb_negative');
  if (dynamicState.recentTrend === 'declining') reasonCodes.push('recent_trend_declining');
  if (fragileCount > 0) reasonCodes.push('fragile_concepts');
  if (strugglingCount > 0) reasonCodes.push('struggling_concepts');
  if (blockedCount > 0) reasonCodes.push('blocked_foundations');
  if (prerequisiteGapCount > 0) reasonCodes.push('prerequisite_gaps');
  if (pathFullyComplete) reasonCodes.push('path_completed');

  // P1.6 落后触发器：deadline × 进度失配（判据见 judgeDeadlinePace）。只在未完成时判——
  // 已完成路径提前返回 keep，这里的 reasonCode 供观测（上游通知/决策流消费）。
  const deadlinePace = !pathFullyComplete && knowledgeMemory.currentPath?.deadline
    ? judgeDeadlinePace({
        deadline: knowledgeMemory.currentPath.deadline,
        now: input.now ?? new Date(),
        pathStartedAt: knowledgeMemory.currentPath.startedAt ?? null,
        totalTasks,
        completedTasks,
      })
    : null;
  if (deadlinePace?.behind) reasonCodes.push(DEADLINE_PACE_BEHIND_CODE);

  // highRisk：疲劳/失衡/结构性风险。**路径已完成或接近完成且无结构性风险时，不进入 high**——
  // 此时没有「后续路径」可重排，报 high 只会误导用户去做一次空转的重规划。
  const fatigueOrImbalance = fatigueHigh || globalVerdict.imbalanced;
  const highRisk = (fatigueOrImbalance || structuralRisk)
    && !pathFullyComplete
    && !nearCompleteNoStructural;
  // 动作必须对准**触发源**：缺口触发 → 重排后续阶段；疲劳/失衡触发 → 降速。
  // 2026-09-29 前这里按「prerequisiteGapCount>0 || blockedCount>0」挑派生动作，于是
  // 疲劳/失衡触发的高危也被配成 resequence——学习者拿到一条与自身状态无关的「重排路径」建议
  // （新采集会话实测：reasonCodes 只有 lsb_negative 仍是 recommendation=resequence）。
  const highAction = structuralRisk
    ? { recommendation: 'resequence' as const, scope: 'downstream_path' as const }
    : { recommendation: 'slow_down' as const, scope: 'next_milestone' as const };
  // mediumRisk（F3，2026-10-15）：fragile 通道被记忆引擎的「未巩固」常态饱和——实测四位 VL 的
  // 痕迹 70-100% mastery<0.5（刚学的概念本来就在 0.5 以下），`fragile>0` 恒真；reviewPriority 又是
  // `fragile>0` 的派生，拿它来判等于同一事实判两遍。两者合起来 = 「每课必发」的根。
  // 收敛为：卡点达**数量门槛**（≥2 处，单处卡点是课堂教学的事，不值得动「重排路径」）或趋势下滑。
  const MEDIUM_STRUGGLING_COUNT_THRESHOLD = 2;
  const mediumRisk = !nearCompleteNoStructural
    && (strugglingCount >= MEDIUM_STRUGGLING_COUNT_THRESHOLD || dynamicState.recentTrend === 'declining');
  // 加速资格（F4，2026-10-15；2026-10-15 PMC 改造改相对量）：原 `fragile=0 && struggling=0`
  // 在饱和通道下生产不可达（全库 0 次「压缩」）。改**相对量门**：明显有余力（ACWR ≤ 0.6，
  // 对齐旧 `ktl>=6 && lf<=3`）+ 节奏非 recover + 无高严重度卡点。绝对 `ktl>=6 && lf<=3` 在 PMC
  // 日负荷口径下失效（量随课量放大，绝对上限无意义）。
  const accelerateReady = globalVerdict.accelerateReady
    && dynamicState.metrics.ktl > 0
    && learningControlState.paceMode !== 'recover'
    && severeStrugglingCount === 0;
  // 路径已完成：下游没有可「重排/减速」的阶段，任何重规划建议都是空转。
  // 明确回 keep（保留 reasonCodes 供观测），不再进 accelerate/high/medium 分支。
  if (pathFullyComplete) {
    return {
      shouldSuggest: false,
      priority: 'none',
      recommendation: 'keep',
      scope: 'none',
      rationale: '当前路径已完成，无可调整的后续阶段。',
      reasonCodes,
    };
  }

  // 顺序即优先级：风险/落后**先于**加速——"可以加速"绝不能盖过真实的结构性缺口或落后。
  if (highRisk) {
    return {
      shouldSuggest: true,
      priority: 'high',
      recommendation: highAction.recommendation,
      scope: highAction.scope,
      rationale: '当前学习状态和知识风险都提示继续按原路径推进的成本偏高，建议先经过人工确认后再调整后续安排。',
      reasonCodes,
    };
  }

  // P1.6 落后触发器分支：外部截止下进度百分位明显落后于时间百分位（偏差 ≥ 0.2）。
  // 排在 highRisk 之后（结构性风险/疲劳优先），动作对准触发源——落后该调的是后续安排
  // （收缩/重切），不是补强单点。保持「建议+确认」，不自动执行。
  if (deadlinePace?.behind) {
    return {
      shouldSuggest: true,
      priority: 'medium',
      recommendation: 'resequence',
      scope: 'downstream_path',
      rationale: `外部截止前时间进度已走到约 ${Math.round(deadlinePace.expectedRatio * 100)}%，实际完成约 ${Math.round(deadlinePace.actualRatio * 100)}%，进度明显落后于剩余时间；建议确认后续安排（收缩范围或调整节奏），已完成内容不受影响。`,
      reasonCodes,
    };
  }

  if (accelerateReady) {
    return {
      shouldSuggest: true,
      priority: 'low',
      recommendation: 'accelerate',
      scope: 'next_milestone',
      rationale: '当前掌握较稳定，且近期压力与疲劳都较低，可以考虑把下一阶段调整为更聚焦的推进版本。',
      reasonCodes: ['stable_mastery', 'ready_to_accelerate'],
    };
  }

  if (mediumRisk) {
    return {
      shouldSuggest: true,
      priority: 'medium',
      recommendation: 'reinforce',
      scope: 'next_milestone',
      rationale: '当前存在不稳定知识点或学习趋势下滑，建议在进入下一阶段前先补强关键基础。',
      reasonCodes,
    };
  }

  return {
    shouldSuggest: false,
    priority: 'none',
    recommendation: 'keep',
    scope: 'none',
    rationale: '',
    // 观测口径：不发信号 ≠ 没看到信号。阈值收紧后（F3）多数课会落到这里，
    // 丢掉累计的 reasonCodes 会让「为什么没建议」在决策流/审计里失明。
    reasonCodes,
  };
}

export class LearnerSnapshotService {
  async getSnapshot(input: LearnerSnapshotScopeInput): Promise<LearnerSnapshot> {
    const [{ profile, confidence }, knowledgeMemory, latestGoalEvidence, latestMetricAt, latestSession, latestCompletedTask] = await Promise.all([
      learnerProfileService.getProfile(input.userId),
      learnerKnowledgeMemoryService.build({
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
      }),
      prisma.learner_evidence.findFirst({
        where: { userId: input.userId, evidenceType: 'goal:understanding:updated' },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      learningStateService.getLatestCommittedStateAt(input.userId),
      prisma.teaching_sessions.findFirst({
        where: { userId: input.userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true, status: true },
      }),
      prisma.subtasks.findFirst({
        where: { userId: input.userId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);

    const personalization = {
      config: personalizationEngine.generateConfig(profile),
      promptEnhancement: personalizationEngine.generatePromptEnhancement(profile),
      contentHints: personalizationEngine.generateContentHints(profile),
    };

    const metrics = profile.learning;
    // 课内（路径级）状态：全局 metrics 管节奏/疲劳，课内难度与支架按本路径状态判断
    const lessonScopePathId = input.learningPathId || knowledgeMemory.currentPath?.learningPathId || null;
    const lessonMetrics = await this.resolveLessonState(input.userId, lessonScopePathId);
    const dynamicState: LearnerDynamicState = {
      metrics: {
        lss: metrics.lss,
        ktl: metrics.ktl,
        lf: metrics.lf,
        lsb: metrics.lsb,
      },
      recentTrend: metrics.recentProgress,
      fatigueRisk: deriveFatigueRisk(metrics.ktl, metrics.lf),
      confidenceTrend: profile.emotional.confidenceLevel === 'anxious' ? 'falling' : profile.emotional.confidenceLevel === 'confident' ? 'rising' : 'stable',
      recentSessionQuality: deriveSessionQuality(metrics.ktl, metrics.lf),
      recommendedPacing: derivePacing(metrics.lf, metrics.ktl),
      recommendedInteraction: {
        hintTiming: personalization.config.interaction.hintTiming,
        encouragement: personalization.config.interaction.encouragementFrequency,
        challenge: personalization.config.interaction.challengeFrequency,
      },
      // SRL 三阶段（Zimmerman 2000）：活跃会话=performance，刚完结=reflection，否则=forethought
      srlPhase: deriveSrlPhase(latestSession),
      lessonScopePathId,
      ...(lessonMetrics ? { lessonMetrics } : {}),
    };

    const currentPath = knowledgeMemory.currentPath
      ? {
          ...knowledgeMemory.currentPath,
          pathSummary: await this.resolvePathSummary(knowledgeMemory.currentPath.learningPathId),
        }
      : undefined;

    const teachingHints: LearnerTeachingHints = {
      promptEnhancement: personalization.promptEnhancement,
      recommendedApproach: profile.derivedInsights.suggestedApproach,
      emphasize: personalization.contentHints.emphasisAreas,
      avoid: personalization.contentHints.avoidFormats,
      riskFactors: profile.derivedInsights.riskFactors,
    };

    const finalKnowledgeMemory: LearnerKnowledgeMemory = {
      ...knowledgeMemory,
      ...(currentPath ? { currentPath } : {}),
    };
    const learningControlState = deriveLearningControlState({
      dynamicState,
      knowledgeMemory: finalKnowledgeMemory,
      lessonMetrics,
    });
    const replanSignal = deriveReplanSignal({
      dynamicState,
      learningControlState,
      knowledgeMemory: finalKnowledgeMemory,
    });

    return {
      snapshotVersion: 'learner-snapshot-v1',
      scope: {
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
        mode: input.mode || (input.taskId ? 'teaching' : input.learningPathId ? 'path' : 'global'),
      },
      freshness: {
        generatedAt: new Date().toISOString(),
        confidence,
        basedOn: {
          latestGoalConversationAt: latestGoalEvidence?.occurredAt?.toISOString(),
          latestMetricAt: latestMetricAt?.toISOString?.(),
          latestTeachingSessionAt: latestSession?.updatedAt?.toISOString(),
          latestTaskCompletionAt: latestCompletedTask?.completedAt?.toISOString(),
          latestPathUpdateAt: currentPath ? await this.resolvePathUpdatedAt(currentPath.learningPathId) : undefined,
        },
      },
      profile,
      dynamicState,
      learningControlState,
      replanSignal,
      knowledgeMemory: finalKnowledgeMemory,
      teachingHints,
    };
  }

  async previewSnapshotFromMetrics(input: LearnerSnapshotScopeInput & {
    metrics: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
    };
    generatedAt?: Date;
  }): Promise<LearnerSnapshot> {
    const [{ profile, confidence }, knowledgeMemory, latestConversation, latestSession, latestCompletedTask] = await Promise.all([
      learnerProfileService.getProfile(input.userId),
      learnerKnowledgeMemoryService.build({
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
      }),
      prisma.learner_evidence.findFirst({
        where: { userId: input.userId, evidenceType: 'goal:understanding:updated' },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      prisma.teaching_sessions.findFirst({
        where: { userId: input.userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true, status: true },
      }),
      prisma.subtasks.findFirst({
        where: { userId: input.userId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);

    const personalization = {
      config: personalizationEngine.generateConfig(profile),
      promptEnhancement: personalizationEngine.generatePromptEnhancement(profile),
      contentHints: personalizationEngine.generateContentHints(profile),
    };

    // 课内（路径级）状态：全局 metrics 管节奏/疲劳，课内难度与支架按本路径状态判断
    const lessonScopePathId = input.learningPathId || knowledgeMemory.currentPath?.learningPathId || null;
    const lessonMetrics = await this.resolveLessonState(input.userId, lessonScopePathId);
    const dynamicState: LearnerDynamicState = {
      metrics: {
        lss: input.metrics.lss,
        ktl: input.metrics.ktl,
        lf: input.metrics.lf,
        lsb: input.metrics.lsb,
      },
      recentTrend: profile.learning.recentProgress,
      fatigueRisk: deriveFatigueRisk(input.metrics.ktl, input.metrics.lf),
      confidenceTrend: profile.emotional.confidenceLevel === 'anxious' ? 'falling' : profile.emotional.confidenceLevel === 'confident' ? 'rising' : 'stable',
      recentSessionQuality: deriveSessionQuality(input.metrics.ktl, input.metrics.lf),
      recommendedPacing: derivePacing(input.metrics.lf, input.metrics.ktl),
      recommendedInteraction: {
        hintTiming: personalization.config.interaction.hintTiming,
        encouragement: personalization.config.interaction.encouragementFrequency,
        challenge: personalization.config.interaction.challengeFrequency,
      },
      srlPhase: deriveSrlPhase(latestSession),
      lessonScopePathId,
      ...(lessonMetrics ? { lessonMetrics } : {}),
    };

    const currentPath = knowledgeMemory.currentPath
      ? {
          ...knowledgeMemory.currentPath,
          pathSummary: await this.resolvePathSummary(knowledgeMemory.currentPath.learningPathId),
        }
      : undefined;

    const teachingHints: LearnerTeachingHints = {
      promptEnhancement: personalization.promptEnhancement,
      recommendedApproach: profile.derivedInsights.suggestedApproach,
      emphasize: personalization.contentHints.emphasisAreas,
      avoid: personalization.contentHints.avoidFormats,
      riskFactors: profile.derivedInsights.riskFactors,
    };

    const finalKnowledgeMemory: LearnerKnowledgeMemory = {
      ...knowledgeMemory,
      ...(currentPath ? { currentPath } : {}),
    };
    const learningControlState = deriveLearningControlState({
      dynamicState,
      knowledgeMemory: finalKnowledgeMemory,
      lessonMetrics,
    });
    const replanSignal = deriveReplanSignal({
      dynamicState,
      learningControlState,
      knowledgeMemory: finalKnowledgeMemory,
    });
    const generatedAt = input.generatedAt || new Date();

    return {
      snapshotVersion: 'learner-snapshot-v1',
      scope: {
        userId: input.userId,
        learningPathId: input.learningPathId,
        milestoneId: input.milestoneId,
        taskId: input.taskId,
        mode: input.mode || (input.taskId ? 'teaching' : input.learningPathId ? 'path' : 'global'),
      },
      freshness: {
        generatedAt: generatedAt.toISOString(),
        confidence,
        basedOn: {
          latestGoalConversationAt: latestConversation?.occurredAt?.toISOString(),
          latestMetricAt: generatedAt.toISOString(),
          latestTeachingSessionAt: latestSession?.updatedAt?.toISOString(),
          latestTaskCompletionAt: latestCompletedTask?.completedAt?.toISOString(),
          latestPathUpdateAt: currentPath ? await this.resolvePathUpdatedAt(currentPath.learningPathId) : undefined,
        },
      },
      profile,
      dynamicState,
      learningControlState,
      replanSignal,
      knowledgeMemory: finalKnowledgeMemory,
      teachingHints,
    };
  }

  /**
   * 课内（路径级）状态：本节课所在路径的最新状态。
   * 该路径还没有任何历史时返回 undefined（调用方回退到全局聚合 —— 与写入侧的"冷启动继承"同口径）。
   */
  private async resolveLessonState(
    userId: string,
    pathId?: string | null
  ): Promise<{ lss: number; ktl: number; lf: number; lsb: number } | undefined> {
    if (!pathId) return undefined;
    const state = await learningStateService.getCurrentState(userId, { pathId }).catch(() => null);
    if (!state) return undefined;
    return { lss: state.lss, ktl: state.ktl, lf: state.lf, lsb: state.lsb };
  }

  private async resolvePathSummary(learningPathId: string): Promise<string | null> {
    const path = await prisma.learning_paths.findUnique({
      where: { id: learningPathId },
      select: { aiPromptTemplate: true },
    });

    const parsed = parseJsonSafe(path?.aiPromptTemplate);
    return typeof parsed?.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null;
  }

  private async resolvePathUpdatedAt(learningPathId: string): Promise<string | undefined> {
    const path = await prisma.learning_paths.findUnique({
      where: { id: learningPathId },
      select: { updatedAt: true },
    });

    return path?.updatedAt?.toISOString();
  }
}

export const learnerSnapshotService = new LearnerSnapshotService();
