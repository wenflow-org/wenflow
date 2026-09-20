/**
 * 课堂教学阶段状态机与上下文构建（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：LearnStage 阶段集合与初值、端到端意图检测（detectEndIntent）、下一阶段决策
 * （determineNextStage）、课堂上下文组装（buildClassroomContext：路径背景/学习者状态/控制
 * 信号三路输入）、课堂事件与教学状态落库件（buildTeachingStateWithArtifacts）。
 * 自 AITeachingCoordinator 头部迁出，行为保持不变。
 */
import { simulatedNowOr } from '../../services/virtual-lab/simulation-clock-context';
import { learningStateService, type LearningStateMetrics } from '../learning/learning-state.service';
import type { TeachingSessionMessage, TeachingKnowledgePointState } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';

/**
 * 教学阶段。
 *
 * **产出集合 = {opening, teaching, intervention, ready_to_close}**：
 * `classroomContext.stage.current` 的唯一推进来源是 `determineNextStage`；新课堂由
 * `initialClassroomStage()` 恒初始化为 `opening`。
 *
 * `checkpoint` / `wrapup` 保留在联合类型里，但它们**不是阶段值**：
 * - 检查点是**回合内控制对象**（`control.checkpoint` → `pendingCheckpoint`，只出现在回合内，
 *   见 README「检查点仅在回合内出现」），通过 `submitCheckpoint` + 代码裁决闭环；
 * - `wrapup` 是收尾语义（由 `ready_to_close` + `sessionArtifacts.endReason` 表达）。
 * 因此代码中 `stage === 'checkpoint' | 'wrapup'` 的分支均为**防御性**（兼容历史持久化值），当前不可达。
 */
export type LearnStage = 'opening' | 'teaching' | 'intervention' | 'checkpoint' | 'ready_to_close' | 'wrapup';

/** 新课堂初始阶段恒为 `opening`（开场定位）。旧实现写作 `openingMode ? 'opening' : 'opening'`（恒真三目），已收敛。 */
export function initialClassroomStage(): LearnStage {
  return 'opening';
}

function dedupeStringList(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean)));
}

export function getLatestUserMessage(messages: TeachingSessionMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user' && message.content?.trim())?.content || '';
}

export function buildPathBackgroundContext(context: TeachingScenarioContext) {
  return {
    pathPosition: {
      pathTitle: context.pathProgress.pathTitle,
      pathSummary: context.pathProgress.pathSummary,
      currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
      currentStageNumber: context.pathProgress.currentStageNumber,
      currentTaskOrder: context.pathProgress.currentTaskOrder,
      totalTasksInMilestone: context.pathProgress.totalTasksInMilestone,
    },
    taskIntent: {
      subject: context.subject,
      topic: context.topic,
      taskTitle: context.taskTitle,
      taskDescription: context.taskDescription,
      acceptanceCriteria: context.currentTaskContext.acceptanceCriteria,
      taskType: context.taskType,
      taskGoal: context.cognitiveFrame.targetRelation,
      milestoneIntent: context.cognitiveFrame.milestoneIntent,
      transferGoal: context.cognitiveFrame.transferGoal,
    },
    knowledgeBoundary: {
      primaryConcepts: context.taskKnowledgeScope.primaryConcepts,
      prerequisiteConcepts: context.taskKnowledgeScope.prerequisiteConcepts,
      learningObjectives: context.taskProfile.learningObjectives,
      coreConcept: context.taskProfile.coreConcept,
    },
    cognitiveFrame: context.cognitiveFrame,
    teachingGuidance: context.teachingStrategyGuidance,
  };
}

export function buildLearnerStateContext(
  context: TeachingScenarioContext,
  teachingState: Record<string, any> | null | undefined,
  latestAnalysis?: any,
) {
  const previous = teachingState?.learnerStateContext || {};
  const ktEstimate = latestAnalysis?.ktEstimate;
  const frustratedStreak = latestAnalysis?.emotionalState === 'frustrated'
    ? (previous.frustratedStreak ?? 0) + 1
    : 0;
  const selfAssessmentSignal = latestAnalysis?.selfAssessmentSignal ?? previous.selfAssessmentSignal ?? null;
  return {
    currentUnderstanding: latestAnalysis?.understanding ?? previous.currentUnderstanding ?? null,
    currentCognitiveLevel: latestAnalysis?.cognitiveLevel || previous.currentCognitiveLevel || null,
    currentConfusionPoints: latestAnalysis?.confusionPoints || previous.currentConfusionPoints || [],
    emotionalState: latestAnalysis?.emotionalState || previous.emotionalState || null,
    engagement: latestAnalysis?.engagement ?? previous.engagement ?? null,
    struggleDetected: previous.struggleDetected === true,
    frustratedStreak,
    selfAssessmentSignal,
    // θ−d 路由信号（回合级知识状态估计）：供 wrapup 证据消费与 session_load 聚合
    ...(ktEstimate ? { ktEstimate } : {}),
  };
}

export function extractTeachingStateMetrics(teachingState: Record<string, any> | null | undefined): LearningStateMetrics | null {
  return learningStateService.coerceMetrics(teachingState);
}

export function deriveTeachingRuntimeSignals(context: TeachingScenarioContext) {
  const lss = Number(context.learningState?.lss ?? 0);
  const ktl = Number(context.learningState?.ktl ?? 0);
  const lf = Number(context.learningState?.lf ?? 0);
  const lsb = Number(context.learningState?.lsb ?? 0);

  const recommendedPacing: 'slow' | 'moderate' | 'fast' = lf >= 6 || lss >= 6
    ? 'slow'
    : ktl >= 5 && lf <= 3 && lss <= 4
      ? 'fast'
      : 'moderate';

  const recentTrend: 'improving' | 'stable' | 'declining' = lf >= 6 || lsb < 0
    ? 'declining'
    : ktl >= 6 && lf <= 3 && lss <= 4
      ? 'improving'
      : 'stable';

  const confidenceLevel: 'confident' | 'moderate' | 'anxious' = lsb < 0 || lf >= 6
    ? 'anxious'
    : ktl >= 6 && lf <= 3 && lss <= 4
      ? 'confident'
      : 'moderate';

  return {
    confidenceLevel,
    recentTrend,
    recommendedPacing,
  };
}

export function buildTeachingControlContext(
  stage: LearnStage,
  context: TeachingScenarioContext,
  learnerStateContext: Record<string, any>,
  sessionArtifacts: Record<string, any>,
) {
  const canTriggerPeer = stage === 'intervention' || learnerStateContext.struggleDetected === true;
  const runtimeSignals = deriveTeachingRuntimeSignals(context);
  const recommendedApproach = runtimeSignals.confidenceLevel === 'anxious'
    ? '先给低压切入口，确认学生能跟上后再继续推进'
    : context.taskType === 'project' || context.taskType === 'practice'
      ? '以小步执行和即时反馈推进'
      : context.taskProfile.knowledgeType === 'procedural'
        ? '先示范步骤，再引导学生完成关键一步'
        : context.taskProfile.knowledgeType === 'conceptual'
          ? '先澄清关系，再用贴题例子验证'
          : context.taskProfile.knowledgeType === 'metacognitive'
            ? '先让学生说出判断与策略，再帮助其澄清和校正'
            : '先简洁解释，再做一次小检核';
  return {
    priority: stage === 'opening'
      ? '定位首个焦点知识点'
      : stage === 'intervention'
        ? '先脱离卡点并恢复推进'
        : stage === 'ready_to_close'
          ? '确认本任务已达到收束条件'
        : stage === 'checkpoint'
          ? '验证当前知识点是否真正建立'
          : stage === 'wrapup'
            ? '收束当前课堂并准备评估'
            : '围绕当前焦点知识点继续推进',
    recommendedApproach,
    targetDepth: context.teachingStrategyGuidance.targetDepth,
    allowPrerequisiteRecovery: true,
    allowPeerSupport: canTriggerPeer,
    allowCheckpoint: stage === 'checkpoint' || stage === 'teaching' || stage === 'ready_to_close',
    nearWrapup: sessionArtifacts.endReason === 'completion-candidate' || stage === 'ready_to_close' || stage === 'wrapup',
  };
}

export function buildClassroomEvent(
  type: string,
  summary: string,
  payload: Record<string, any> = {},
) {
  return {
    type,
    summary,
    occurredAt: simulatedNowOr().toISOString(),
    payload,
  };
}

export function detectEndIntent(message: string) {
  const text = (message || '').trim();
  if (!text) return { isEndIntent: false, reason: '' };

  const patterns = [
    /结束(本节|这节|课程|课堂|学习)/,
    /到此结束/,
    /现在结束/,
    /请.*结束/,
    /标记.*结束/,
    /本节课结束/,
    /停止学习/,
    /不学了/,
    /结束吧/,
  ];

  if (patterns.some((pattern) => pattern.test(text))) {
    return { isEndIntent: true, reason: '检测到显式结束课堂意图' };
  }

  return { isEndIntent: false, reason: '' };
}

/**
 * 阶段推进的**唯一来源**。产出仅 `{opening, teaching, intervention, ready_to_close}`——
 * 不产出 `checkpoint`/`wrapup`（见 `LearnStage` 注释：检查点是回合内控制对象，wrapup 是收尾语义）。
 */
export function determineNextStage(params: {
  currentStage: LearnStage;
  teachingOutput: TeachingTurnOutput;
  peerTriggered: boolean;
  learnerMessage: string;
  taskMode?: 'normal' | 'productiveFailure';
  frustratedStreak?: number;
}): { stage: LearnStage; reason: string } {
  const { currentStage, teachingOutput, peerTriggered, learnerMessage, taskMode, frustratedStreak } = params;
  const understanding = Number(teachingOutput.analysis?.understanding ?? 0.5);
  const emotion = teachingOutput.analysis?.emotionalState;
  const confusionPoints = Array.isArray(teachingOutput.analysis?.confusionPoints)
    ? teachingOutput.analysis.confusionPoints
    : [];
  const completionCandidate = teachingOutput.control?.isCompletionCandidate === true;
  // loadIndex 作为 intervention 的辅助证据（认知过载 >0.85 且理解不足时倾向干预，
  // 而非仅依赖情绪/困惑点显式信号；M1 感知层消费接入）
  const loadIndex = Number(teachingOutput.analysis?.loadIndex);
  const highLoad = Number.isFinite(loadIndex) && loadIndex > 0.85;
  // θ−d 路由（回合级知识追踪信号）：mastery 显著低于任务难度或建议 scaffold 时，
  // 视同"知识状态层面的卡点"，与负荷路由（瞬态）互补作为 intervention 辅助证据
  const ktEstimate = teachingOutput.analysis?.ktEstimate;
  const ktLowMastery = Array.isArray(ktEstimate?.conceptMastery)
    ? ktEstimate!.conceptMastery!.some((c) => Number.isFinite(c.mastery) && c.mastery < 0.4)
    : false;
  const ktHighDifficulty = Number.isFinite(ktEstimate?.currentTaskDifficulty) && (ktEstimate!.currentTaskDifficulty as number) > 0.6;
  const ktStruggle = ktEstimate?.recommendation === 'scaffold' || (ktLowMastery && ktHighDifficulty);

  if (completionCandidate) {
    return { stage: 'ready_to_close', reason: '检测到完成候选，当前任务已接近收束' };
  }

  // PF 逃生舱：连续 2 轮 frustrated 或 loadIndex > 0.85 → 强制退出 PF 模式（标记可收束，跳过整合）
  if (taskMode === 'productiveFailure' && ((frustratedStreak ?? 0) >= 2 || highLoad)) {
    return { stage: 'ready_to_close', reason: `PF 逃生舱触发：${highLoad ? '认知过载' : `连续 ${frustratedStreak} 轮受挫`}，退出有效失败模式` };
  }

  if (peerTriggered || understanding < 0.35 || emotion === 'frustrated' || confusionPoints.length >= 2 || (highLoad && understanding < 0.6) || (ktStruggle && understanding < 0.6)) {
    return { stage: 'intervention', reason: highLoad ? '认知负荷过高，进入干预降载' : ktStruggle ? '知识状态低于任务难度（θ−d），进入干预' : '学生出现明显卡点，进入干预阶段' };
  }

  if (currentStage === 'opening' && learnerMessage.trim()) {
    return { stage: 'teaching', reason: '已完成开场定位，进入正常推进' };
  }

  if (currentStage === 'intervention' && understanding >= 0.5) {
    return { stage: 'teaching', reason: '卡点已缓解，回到授课推进' };
  }

  if ((currentStage === 'checkpoint' || currentStage === 'ready_to_close') && understanding < 0.5) {
    return { stage: 'teaching', reason: '检核信号不足，回到授课推进' };
  }

  return { stage: currentStage === 'opening' ? 'teaching' : currentStage, reason: '保持当前教学推进阶段' };
}

export function buildClassroomContext(params: {
  previousState: Record<string, any> | null | undefined;
  stage: LearnStage;
  stageReason: string;
  teachingOutput?: TeachingTurnOutput | null;
  learnerMessage: string;
  context: TeachingScenarioContext;
  knowledgeState: TeachingKnowledgePointState[];
  learnerStateContext: Record<string, any>;
  peerTriggered?: boolean;
  peerMessage?: string;
}) {
  const {
    previousState,
    stage,
    stageReason,
    teachingOutput,
    learnerMessage,
    context,
    knowledgeState,
    learnerStateContext,
    peerTriggered,
  } = params;
  const previousClassroom = previousState?.classroomContext || {};
  const currentFocus = teachingOutput?.knowledge?.currentPoint
    || previousClassroom?.focus?.currentKnowledgePoint
    || knowledgeState.find((point) => point.status === 'learning')?.name
    || knowledgeState[0]?.name
    || context.taskProfile.coreConcept
    || null;
  const progressed = knowledgeState.filter((point) => point.progress > 0).map((point) => point.name);
  const pending = knowledgeState.filter((point) => point.status === 'pending').map((point) => point.name);
  const recovering = knowledgeState.filter((point) => point.status === 'review').map((point) => point.name);
  const mastered = knowledgeState.filter((point) => point.status === 'mastered').map((point) => point.name);
  const confusionPoints = learnerStateContext.currentConfusionPoints || [];

  return {
    stage: {
      current: stage,
      goal: stage === 'opening'
        ? '完成本节课切入点定位'
        : stage === 'intervention'
          ? '先处理当前卡点并恢复可推进状态'
          : stage === 'ready_to_close'
            ? '确认本任务已达到结束课堂条件'
          : stage === 'checkpoint'
            ? '验证当前焦点知识点是否真正建立'
            : stage === 'wrapup'
              ? '完成课堂收束并准备课后评估'
              : '围绕焦点知识点继续推进理解与应用',
      reason: stageReason,
    },
    focus: {
      currentKnowledgePoint: currentFocus,
      linkedTaskGoal: context.cognitiveFrame.targetRelation,
      latestLearnerMessage: learnerMessage,
    },
    progress: {
      progressedKnowledgePoints: dedupeStringList(progressed),
      pendingKnowledgePoints: dedupeStringList(pending),
      recoveringKnowledgePoints: dedupeStringList(recovering),
      initiallyMasteredKnowledgePoints: dedupeStringList(mastered),
    },
    risk: {
      confusionPoints,
      emotionalState: learnerStateContext.emotionalState || null,
      engagement: learnerStateContext.engagement ?? null,
      struggleDetected: learnerStateContext.struggleDetected === true,
      peerSupportActive: peerTriggered === true,
    },
    nextStep: {
      suggestedAction: stage === 'opening'
        ? '继续定位首个焦点知识点'
        : stage === 'intervention'
          ? '先降阶讲解或触发伴学'
          : stage === 'ready_to_close'
            ? '结束课堂并进入评估'
          : stage === 'checkpoint'
            ? '组织验证性追问或小检核'
            : stage === 'wrapup'
              ? '准备结束课堂并进入评估'
              : '继续围绕焦点知识点推进',
    },
  };
}

export function buildTeachingStateWithArtifacts(
  teachingState: Record<string, any> | null | undefined,
  sessionArtifacts: Record<string, any>
) {
  return {
    ...(teachingState || {}),
    sessionArtifacts,
  };
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  // 超时取消钩子：调用方可传入 controller，超时 reject 的同时 abort 底层 LLM 调用，
  // 避免"上层已超时、底层流仍在跑"的幽灵 CALLER_ABORTED 日志与 token 浪费。
  const controller = new AbortController();
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(errorMessage));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 同 withTimeout，但把超时取消信号暴露给调用方（传给 gateway.execute 的 abortSignal）。
 */
export async function withTimeoutSignal<T>(
  promise: (signal: AbortSignal) => Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const controller = new AbortController();
  try {
    return await Promise.race([
      promise(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(errorMessage));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
