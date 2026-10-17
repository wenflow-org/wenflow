// 模拟协调器 - Learn 阶段步进纯工具函数（自 simulation.coordinator.ts 抽离，行为保持不变；无 this）
import type {
  SimulationMilestone,
  SimulationTask,
  StageResults,
  TeachingState
} from '../virtual-lab/vlab-types';
import type {
  ConversationHistoryItem,
  LearnerLatentState,
  SimulationContext,
  VirtualLearnerProfile
} from './simulation.types';
import {
  buildLearningProgressSnapshot,
  getRunnableTasks,
  mergeLearnerState,
  parseStoryContextFromStageResults,
  resolveLearnerPhase,
  trimLearningConversationHistory
} from './simulation.helpers';
import {
  buildAssistedKnowledgeSnapshot,
  buildAssistedLearnerMemory
} from './simulation.memory';

/**
 * 收束循环熔断阈值（2026-10-10 逐字稿评审）：学员连续 N 轮自评完成而教学系统不给收束信号时，
 * 按学员意愿结课。实测病灶：老师反复布置收尾微任务、学生反复「收工」，双方空转到回合预算耗尽，
 * wrapup 被拖在长尾后退化。学员自评是模拟学习的最终事实，教师收束信号不该单方面卡死课界。
 */
export const LEARN_CLOSURE_LOOP_BREAK_TURNS = 3;

/** 收束循环连击计数：学员本轮自评完成且未达成双放行 → 连击 +1，否则清零（纯函数，供单测）。 */
export function advanceLearnerDoneStreak(
  priorStreak: number,
  closure: { learnerReady: boolean; canCompleteTask: boolean }
): number {
  return closure.learnerReady && !closure.canCompleteTask ? (Number(priorStreak) || 0) + 1 : 0;
}

/** 连击是否到顶（纯函数，供单测）。 */
export function shouldBreakClosureLoop(learnerDoneStreak: number): boolean {
  return learnerDoneStreak >= LEARN_CLOSURE_LOOP_BREAK_TURNS;
}

/** Learn 回合收束判决（teacher / learner 双侧信号聚合） */
export type LearningClosureDecision = {
  teacherReady: boolean;
  learnerReady: boolean;
  canCompleteTask: boolean;
  /** 本轮认知判决未放行完成（仅作留痕与有界放开判据，不再是单票否决，见 #46） */
  judgeBlocked: boolean;
  judgeBlockReason: string | null;
  teacherSignal: {
    isCompletion: boolean;
    autoEnded: boolean;
    classroomStage: string | null;
  };
  learnerFeedback: Record<string, unknown> | null;
  reason: string;
};

/** 定位当前里程碑/可运行任务；调用方仍需处理 currentMilestone / currentTask 缺失分支。 */
export function locateLearningTask(
  milestones: SimulationMilestone[],
  learningState: TeachingState
): {
  currentMilestoneIdx: number;
  currentTaskIdx: number;
  currentMilestone: SimulationMilestone | undefined;
  tasks: SimulationTask[];
  currentTask: SimulationTask | undefined;
} {
  const currentMilestoneIdx = learningState.currentMilestone || 0;
  const currentTaskIdx = learningState.currentTaskIdx || 0;
  const currentMilestone = milestones[currentMilestoneIdx];

  const tasks = getRunnableTasks(currentMilestone?.subtasks || []);
  const currentTask = tasks[currentTaskIdx];

  return { currentMilestoneIdx, currentTaskIdx, currentMilestone, tasks, currentTask };
}

/** 组装教学回合的可见上下文（裁剪历史 + 合并学习者状态 + simulationContext）。 */
export function buildTeachingTurnContext(params: {
  profile: VirtualLearnerProfile;
  learningState: TeachingState;
  stageResults: StageResults;
  currentMilestone: SimulationMilestone;
  currentTask: SimulationTask;
  currentMilestoneIdx: number;
  milestones: SimulationMilestone[];
}): {
  trimmedConversationHistory: ConversationHistoryItem[];
  lastAssistantMessage: string;
  mergedLearnerState: LearnerLatentState;
  simulationContext: SimulationContext;
} {
  const {
    profile,
    learningState,
    stageResults,
    currentMilestone,
    currentTask,
    currentMilestoneIdx,
    milestones
  } = params;

  const trimmedConversationHistory = trimLearningConversationHistory(learningState.conversationHistory || [])
  const lastAssistantMessage = [...trimmedConversationHistory]
    .reverse()
    .find((item) => item.role === 'assistant')?.content || '';

  const mergedLearnerState = mergeLearnerState(profile, learningState.learnerState as Partial<LearnerLatentState> | undefined, 'teaching', parseStoryContextFromStageResults(stageResults))
  const simulationContext: SimulationContext = {
    profile,
    conversationHistory: trimmedConversationHistory,
    lastAssistantMessage,
    currentStage: 'teaching',
    learnerState: {
      ...mergedLearnerState,
      phaseFocus: resolveLearnerPhase(mergedLearnerState)
    },
    learningState: {
      currentMilestone: currentMilestone.title,
      currentTask: currentTask.title,
      milestoneProgress: currentMilestoneIdx + 1,
      totalMilestones: milestones.length
    }
  };

  return { trimmedConversationHistory, lastAssistantMessage, mergedLearnerState, simulationContext };
}

/** 加载教学回合所需的知识看板快照与学习者记忆（assisted 模式）。 */
export async function loadTeachTurnKnowledgeAssets(
  userId: string,
  currentTask: SimulationTask,
  currentMilestone: SimulationMilestone
): Promise<{
  knowledgeSnapshot: Array<{ name: string; status: string; progress: number }>;
  learnerMemoryForSimulator: {
    mastered: string[];
    dueReview: string[];
    struggling: string[];
    recentCompleted: string[];
  } | null;
}> {
  // 知识看板快照：当前任务概念为锚 + 学习者记忆（已掌握/到期复习/易混淆/最近成果）
  const knowledgeSnapshot = await buildAssistedKnowledgeSnapshot(
    userId,
    currentTask,
    currentMilestone
  );
  const learnerMemoryForSimulator = await buildAssistedLearnerMemory(userId);
  return { knowledgeSnapshot, learnerMemoryForSimulator };
}

/**
 * 认知判决的完成门阈值（P1-5）：masteryProb 低于该值视为"尚未掌握"，不得结课。
 * 与 learn-turn-simulator 内的同口径常量保持一致（两处均在授权面内，避免跨层 import 造成
 * skills→coordinators 反向依赖）。
 */
export const LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD = 0.5;

/** 判决字段的结构化视图（与 epistemic-grounding 输出同形；用结构类型避免 skills→coordinators 反向依赖） */
export type JudgeGroundingLike = {
  sampledCorrectness?: boolean | null;
  blockedConcept?: string | null;
  errorPattern?: string | null;
  masteryProb?: number | null;
} | null | undefined;

/**
 * 判决是否放行「完成」：判决缺失 → 放行（宁松勿误伤，保持现网行为）；
 * sampledCorrectness=false 或 masteryProb 低于阈值 → 拦截。
 * 与 simulator 侧的 normalizeOutput 完成门同口径，构成完成链的两道防线。
 */
export function evaluateJudgeCompletionGate(
  grounding: JudgeGroundingLike,
  threshold = LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD
): { allowsCompletion: boolean; reason: string | null } {
  if (!grounding || typeof grounding !== 'object') return { allowsCompletion: true, reason: null };
  if (grounding.sampledCorrectness === false) {
    return { allowsCompletion: false, reason: 'judge-sampled-correctness-false' };
  }
  const mastery = typeof grounding.masteryProb === 'number' && Number.isFinite(grounding.masteryProb)
    ? grounding.masteryProb
    : null;
  if (mastery !== null && mastery < threshold) {
    return { allowsCompletion: false, reason: 'judge-mastery-below-threshold' };
  }
  return { allowsCompletion: true, reason: null };
}

/** 依据教学系统信号与 AI 学生自评，计算本回合收束判决。 */
export function computeClosureDecision(
  aiResult: {
    isCompletion?: boolean;
    autoEnded?: boolean;
    promptDebug?: {
      learnDebug?: {
        output?: {
          stageDecision?: { stage?: string | null };
        };
      };
    };
  },
  learnerFeedback: Record<string, unknown> | null,
  /** 本轮认知判决（P1-5）。#46：以「有界否决」接入——判决不放行时不立即结课，
   *  但也不再把 learnerReady 直接改写为 false（那会让收束连击永远到不了熔断阈值）。 */
  judge?: JudgeGroundingLike,
  /** 本 task 之前连续「学员自评完成但未结课」的轮数（决定有界否决何时放开） */
  priorLearnerDoneStreak = 0
): LearningClosureDecision {
  const teacherReady = !!(aiResult.isCompletion || aiResult.autoEnded);
  const judgeGate = evaluateJudgeCompletionGate(judge);
  // #46 根因 A：旧实现把 judgeGate 焊进 learnerReady，判决一旦不开就连「学员想下课」都不成立，
  // 收束熔断（advanceLearnerDoneStreak）永远数不到——实测 29/29 轮 judgeCompletionBlock 非空、
  // 学员自评恒 false、40 轮空转到 turn-budget-skip。学员自评只取决于学员侧信号。
  const learnerReady = !!(
    learnerFeedback?.selfReportedTaskDone === true &&
    learnerFeedback?.wantsMoreHelp !== true &&
    learnerFeedback?.stopAsking === true &&
    (!Array.isArray(learnerFeedback?.remainingBlockers) || learnerFeedback.remainingBlockers.length === 0)
  );
  const judgeBlocked = !judgeGate.allowsCompletion;
  // 有界否决：判决连续两轮不放行后，第三轮按 teacher+learner 双方意愿结课（留痕 judgeBlocked）。
  // 只在「双方都认为可以下课」时生效——判决仍能拦住单方抢跑。
  const judgeOverride = judgeBlocked
    && (Number(priorLearnerDoneStreak) || 0) >= LEARN_CLOSURE_LOOP_BREAK_TURNS - 1;
  const canCompleteTask = teacherReady && learnerReady && (!judgeBlocked || judgeOverride);
  return {
    teacherReady,
    learnerReady,
    canCompleteTask,
    judgeBlocked,
    judgeBlockReason: judgeBlocked ? judgeGate.reason : null,
    teacherSignal: {
      isCompletion: !!aiResult.isCompletion,
      autoEnded: !!aiResult.autoEnded,
      classroomStage: aiResult.promptDebug?.learnDebug?.output?.stageDecision?.stage || null
    },
    learnerFeedback,
    reason: teacherReady && learnerReady && judgeOverride
      ? `教学系统与学员均认为可结课；认知判决连续多轮未放行（${judgeGate.reason}），按双方意愿结课。`
      : teacherReady && learnerReady && canCompleteTask
        ? '教学系统给出收束信号，AI 学生也自评当前 task 已完成。'
        : teacherReady && judgeBlocked
          ? `教学系统给出收束信号，但本轮认知判决未放行完成（${judgeGate.reason}）。`
          : teacherReady
            ? '教学系统给出收束信号，但 AI 学生仍未自评完成或仍想继续获得帮助。'
            : learnerReady
              ? 'AI 学生自评当前 task 已完成，但教学系统尚未给出收束信号。'
              : '教学系统与 AI 学生均未同时满足当前 task 收束条件。'
  };
}

/** 判决服从核验结果（P1-4）：主链路把判决产出与模拟器实际回复做一致性对账的产物 */
export interface GroundingComplianceAudit {
  judged: boolean;
  sampledCorrectness: boolean | null;
  blockedConcept: string | null;
  masteryProb: number | null;
  /** 判错轮：reply 是否命中 blockedConcept / errorPattern 关键词 */
  conceptSurfacedInReply: boolean;
  /** 判错轮：reply 是否同时宣称已会/已完成（与 judge=false 冲突） */
  replyClaimsSuccess: boolean;
  /** 判错轮：自评掌握度是否 ≤ masteryProb 上界（含容差） */
  masteryWithinBound: boolean;
  /** 主链钳制前的字段，用于证据链证明确实发生过修正 */
  masteryClampedFields?: string[];
  preClampDrift?: string[];
  compliant: boolean;
  drift: string[];
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

function conceptTokens(concept: string): string[] {
  return concept
    .split(/[—\-–、,，/·|:：\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function replySurfacesConcept(reply: string, concept: string | null): boolean {
  if (!concept) return false;
  const normalizedReply = normalizeForMatch(reply);
  if (!normalizedReply) return false;
  if (normalizedReply.includes(normalizeForMatch(concept))) return true;
  return conceptTokens(concept).some((token) => normalizedReply.includes(normalizeForMatch(token)));
}

/**
 * 判错轮里"宣称已会/已完成"的确定性信号（P1-4）：即便 reply 提到 blockedConcept，
 * 只要同时宣称这一步会了/懂了/可以继续，就与 judge=false 冲突——这正是
 * 「判决→翻案→答对」的形态（审计 VL-1 锚点必须能区分它）。
 */
const SUCCESS_CLAIM_PATTERN = /(我会了|我会做|我懂了|明白了|知道了|懂了|搞懂了|搞定了|没问题了|没问题|可以继续|继续吧|这样就对|应该是对|应该就是|对了|完成|学会了|掌握了|能做对)/;

function replyClaimsSuccess(reply: string): boolean {
  return SUCCESS_CLAIM_PATTERN.test(String(reply || ''));
}

/**
 * 把自评掌握度钳制到判决上界（P1-4 最低验收）：sampledCorrectness=false 且给出 masteryProb 时，
 * learnerState.conceptualMastery / proceduralMastery 不得超过 masteryProb——"判 0.3 掌握"不得
 * 继续以 0.9 的自评掌握度进入后续状态。判决缺失/判对 → 原样（宁松勿误伤）。
 * 返回新对象（不改入参）与被钳制字段名（供证据链留痕）。
 */
// 学习态是键集开放的动态 JSON 记录，此处 any 为契约本身（收窄成 unknown 会在调用面要求逐字段守卫，无收益）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clampLearnerStateToJudgment<T extends Record<string, any> | null | undefined>(
  learnerState: T,
  grounding: JudgeGroundingLike
): { learnerState: T; clampedFields: string[] } {
  if (!learnerState || typeof learnerState !== 'object') return { learnerState, clampedFields: [] };
  const judgeFalse = !!grounding && typeof grounding === 'object' && grounding.sampledCorrectness === false;
  const bound = grounding && typeof grounding === 'object'
    && typeof grounding.masteryProb === 'number' && Number.isFinite(grounding.masteryProb)
    ? grounding.masteryProb
    : null;
  if (!judgeFalse || bound === null) return { learnerState, clampedFields: [] };

  const clampedFields: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上：动态学习态记录
  const next: Record<string, any> = { ...learnerState };
  for (const field of ['conceptualMastery', 'proceduralMastery'] as const) {
    const value = next[field];
    if (typeof value === 'number' && Number.isFinite(value) && value > bound) {
      next[field] = bound;
      clampedFields.push(field);
    }
  }
  return { learnerState: next as T, clampedFields };
}

/**
 * 判决服从核验（P1-4）：判错轮（sampledCorrectness=false）下核对模拟器 reply 是否暴露了
 * blockedConcept/errorPattern、是否同时宣称"已会/可以继续"、自评掌握度是否越过 masteryProb 上界。
 * 命中不一致只记 drift（供证据链区分「判决→服从→答错」与「判决→翻案→答对」），不改写学习者可见文本。
 */
export function auditGroundingCompliance(params: {
  grounding: JudgeGroundingLike;
  reply: string;
  learnerState?: { conceptualMastery?: number; proceduralMastery?: number } | null;
  tolerance?: number;
}): GroundingComplianceAudit {
  const { grounding, reply, learnerState } = params;
  const tolerance = typeof params.tolerance === 'number' ? params.tolerance : 0.1;
  const judged = !!grounding && typeof grounding === 'object';
  const sampled = judged && typeof grounding!.sampledCorrectness === 'boolean' ? grounding!.sampledCorrectness! : null;
  const blocked = judged && typeof grounding!.blockedConcept === 'string' && grounding!.blockedConcept!.trim()
    ? grounding!.blockedConcept!.trim()
    : null;
  const errorPattern = judged && typeof grounding!.errorPattern === 'string' && grounding!.errorPattern!.trim()
    ? grounding!.errorPattern!.trim()
    : null;
  const masteryProb = judged && typeof grounding!.masteryProb === 'number' && Number.isFinite(grounding!.masteryProb)
    ? grounding!.masteryProb!
    : null;

  const drift: string[] = [];
  let conceptSurfacedInReply = true;
  let successClaim = false;
  let masteryWithinBound = true;
  if (judged && sampled === false) {
    // 无 blockedConcept/errorPattern 时无从核对（判决器未定位卡点）——不记为漂移
    conceptSurfacedInReply = (blocked === null && errorPattern === null)
      ? true
      : (replySurfacesConcept(reply, blocked) || replySurfacesConcept(reply, errorPattern));
    if (!conceptSurfacedInReply) drift.push('blocked-concept-not-surfaced');

    // 判错却宣称已会/可以继续：即便提到卡点，也属"翻案答对"形态
    successClaim = replyClaimsSuccess(reply);
    if (successClaim) drift.push('judge-false-but-reply-claims-success');

    const bound = masteryProb !== null ? masteryProb : LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD;
    const selfMastery = Math.max(
      typeof learnerState?.conceptualMastery === 'number' ? learnerState.conceptualMastery : 0,
      typeof learnerState?.proceduralMastery === 'number' ? learnerState.proceduralMastery : 0
    );
    masteryWithinBound = selfMastery <= bound + tolerance;
    if (!masteryWithinBound) drift.push('mastery-exceeds-judgment-bound');
  }

  return {
    judged,
    sampledCorrectness: sampled,
    blockedConcept: blocked,
    masteryProb,
    conceptSurfacedInReply,
    replyClaimsSuccess: successClaim,
    masteryWithinBound,
    compliant: drift.length === 0,
    drift,
  };
}

/**
 * 看板 × 判决对账（P1-6）：判错轮里被 blockedConcept 命中的教师侧看板项若仍标 mastered，
 * 降级为 learning（progress 收敛到 ≤40），使 yaml「自评必须先对照看板」的校准权威单义。
 * 返回新数组（不改入参）；判决缺失或非判错轮原样返回。
 */
export function reconcileKnowledgeBoardWithJudgment(
  knowledgePoints: Array<Record<string, unknown>> | null | undefined,
  grounding: JudgeGroundingLike
): {
  points: Array<Record<string, unknown>>;
  downgraded: Array<{ name: string; from: string; to: string }>;
} {
  const points = Array.isArray(knowledgePoints) ? knowledgePoints : [];
  const judgeFalse = !!grounding && typeof grounding === 'object' && grounding.sampledCorrectness === false;
  const blocked = grounding && typeof grounding === 'object'
    && typeof grounding.blockedConcept === 'string' && grounding.blockedConcept.trim()
    ? grounding.blockedConcept.trim()
    : '';
  if (!judgeFalse || !blocked) return { points, downgraded: [] };

  const downgraded: Array<{ name: string; from: string; to: string }> = [];
  const next = points.map((point) => {
    const name = point && typeof point.name === 'string' ? point.name.trim() : '';
    const status = point && typeof point.status === 'string' ? point.status : '';
    if (name === blocked && status === 'mastered') {
      downgraded.push({ name, from: 'mastered', to: 'learning' });
      const progress = Number.isFinite(Number(point.progress)) ? Number(point.progress) : 0;
      return { ...point, status: 'learning', progress: Math.min(progress, 40) };
    }
    return point;
  });
  return { points: next, downgraded };
}

/**
 * P1-6 实际看板闭环：persistProfileConcepts 的历史 knownConcepts 是 union-only，
 * 因而单纯把当前点改成 learning 仍会让旧 knownConcepts 在下一轮被 buildLearnerMemorySnapshot
 * 读回 mastered。此纯函数计算授权面内 learn-phase 需要执行的画像 demotion：移除 stale
 * knownConcepts，并把同名概念保留到 struggleConcepts。判决缺失/无降级项时原样返回。
 */
export function demoteProfileKnownConcepts(
  profileData: Record<string, unknown> | null | undefined,
  downgraded: Array<{ name: string; from: string; to: string }> | null | undefined
): Record<string, unknown> {
  const source = profileData && typeof profileData === 'object' ? profileData : {};
  const names = new Set(
    (Array.isArray(downgraded) ? downgraded : [])
      .map((item) => typeof item?.name === 'string' ? item.name.trim() : '')
      .filter(Boolean)
  );
  if (!names.size) return { ...source };

  const known = Array.isArray(source.knownConcepts) ? source.knownConcepts : [];
  const struggle = Array.isArray(source.struggleConcepts) ? source.struggleConcepts : [];
  const knownConcepts = known.filter((item) => !names.has(typeof item === 'string' ? item.trim() : ''));
  const struggleConcepts = [...new Set([
    ...struggle.filter((item) => typeof item === 'string' && item.trim()),
    ...names,
  ])];
  return { ...source, knownConcepts, struggleConcepts };
}

/** 组装本回合结束后的 teaching 状态（进度快照 + 学习者状态 + taskRuntime + 对话历史）。 */
export function buildNextLearningState(params: {
  learningState: TeachingState;
  teachingRevision: number | undefined;
  isPathCompleted: boolean;
  milestones: SimulationMilestone[];
  nextMilestoneIdx: number;
  nextTaskIdx: number;
  virtualReply: {
    userVisible: string;
    learnerState?: Record<string, unknown> | null;
    learnerFeedback?: Record<string, unknown> | null;
    internal?: {
      learnerState?: Record<string, unknown> | null;
      learnerFeedback?: Record<string, unknown> | null;
    };
  };
  profile: VirtualLearnerProfile;
  stageResults: StageResults;
  closureDecision: LearningClosureDecision | null;
  learningStepError: string | null;
  currentTask: SimulationTask;
  teachingSessionId: string | null | undefined;
  aiResponse: string;
}): Record<string, unknown> {
  const {
    learningState,
    teachingRevision,
    isPathCompleted,
    milestones,
    nextMilestoneIdx,
    nextTaskIdx,
    virtualReply,
    profile,
    stageResults,
    closureDecision,
    learningStepError,
    currentTask,
    teachingSessionId,
    aiResponse
  } = params;

  return {
    ...learningState,
    teachingRevision,
    ...(isPathCompleted
      ? {
          currentMilestone: milestones.length,
          currentMilestoneTitle: null,
          currentTaskIdx: 0,
          currentTaskId: null,
          currentTaskTitle: null,
          totalMilestones: milestones.length
        }
      : buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx)),
    learnerState: mergeLearnerState(profile, (virtualReply.learnerState || virtualReply.internal?.learnerState) as Partial<LearnerLatentState> | undefined, 'teaching', parseStoryContextFromStageResults(stageResults)),
    latestLearnerFeedback: virtualReply.learnerFeedback || virtualReply.internal?.learnerFeedback || null,
    closureDecision,
    taskRuntime: {
      ...((learningState.taskRuntime ?? {}) as Record<string, unknown>),
      status: learningStepError
        ? 'error'
        : closureDecision?.teacherReady && !closureDecision?.learnerReady
          ? 'teacher_ready_learner_not_satisfied'
          : closureDecision?.learnerReady && !closureDecision?.teacherReady
            ? 'learner_ready_waiting_teacher'
            : 'active',
      taskId: currentTask.id,
      taskTitle: currentTask.title,
      turns: learningState.taskRuntime?.taskId === currentTask.id
        ? Number(learningState.taskRuntime.turns || 0) + 1
        : 1,
      /* 收束循环连击：与 learn-phase 完成判决点同口径（学员自评完成而未双放行 → +1），跨回合继承 */
      learnerDoneStreak: advanceLearnerDoneStreak(
        learningState.taskRuntime?.taskId === currentTask.id
          ? Number(learningState.taskRuntime.learnerDoneStreak || 0)
          : 0,
        {
          learnerReady: closureDecision?.learnerReady === true,
          canCompleteTask: closureDecision?.canCompleteTask === true,
        }
      ),
      teachingSessionId,
      error: learningStepError,
      closureDecision,
      updatedAt: new Date().toISOString()
    },
    conversationHistory: [
      ...(learningState.conversationHistory || []),
      { role: 'user', content: virtualReply.userVisible },
      { role: 'assistant', content: aiResponse }
    ]
  };
}
