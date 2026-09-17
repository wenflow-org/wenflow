// 模拟协调器 - 模块级纯工具函数（自 simulation.coordinator.ts 抽离，行为保持不变；无 this / prisma）
import { asErrorLike } from '../virtual-lab/vlab-types';
import type {
  SimulatorSkillOutput,
  SimulationMilestone,
  SimulationTask,
  StageResults,
  VirtualLearnerProfileRow,
  VirtualSessionWithProfile
} from '../virtual-lab/vlab-types';
import type {
  ConversationHistoryItem,
  GoalConcernPool,
  KnowledgePointState,
  LearnerLatentState,
  PersonalityTraits,
  SimulationContext,
  VirtualLearnerProfile,
  VirtualLearnerProfileData
} from './simulation.types';
import { safeJsonParse } from '../utils/safe-json';
import { getRequestContext } from '../gateway/api-gateway/context';
import { normalizeFrictionBudget, type FrictionBudget } from '../skills/virtual-learner-shared';
import { LEARN_TASK_TURN_BUDGET } from './simulation.constants';

/** 判断错误是否为 LLM Provider 可重试错误（过载/超时/JSON 解析失败） */
export function isProviderRetryable(errorMsg: string): boolean {
  const e = errorMsg.toLowerCase();
  // turn_budget_exhausted 是课时预算闸门的显式终止信号：若被当作可重试，
  // 自动循环会静默 restartLearningPhase 把 turns 归零，预算形同虚设
  // retry_budget_exhausted 同理：总 AI 调用预算耗尽后 restart 只会再次耗尽，空转恢复次数
  if (e.includes('turn_budget_exhausted') || e.includes('retry_budget_exhausted')) return false;
  return e.includes('provider') || e.includes('retry') || e.includes('timeout')
    || e.includes('overload') || e.includes('budget') || e.includes('503')
    || e.includes('does not contain valid json') || e.includes('response does not contain');
}

export function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && asErrorLike(error).code === code;
}

export function isLeaseDatabaseBusyError(error: unknown) {
  if (isPrismaErrorCode(error, 'P1008')) return true;
  const code = typeof error === 'object' && error !== null ? String(asErrorLike(error).code || '') : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return code === 'SQLITE_BUSY'
    || /SQLITE_BUSY|database (?:is|table is) locked|timed out|timeout/i.test(message);
}

export function sanitizeVisibleDialogue(text: string): string {
  if (!text) return '';

  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function inferLearningPhase(learnerState: LearnerLatentState | null | undefined): 'trying' | 'blocked' | 'verifying' | 'ready_to_close' {
  const state = learnerState || {};
  const blockerCount = Array.isArray(state.remainingBlockers) ? state.remainingBlockers.length : 0;
  const cognitiveLoad = typeof state.cognitiveLoad === 'number' ? state.cognitiveLoad : 0;
  const misconceptionRisk = typeof state.misconceptionRisk === 'number' ? state.misconceptionRisk : 0;
  const taskUnderstanding = typeof state.taskUnderstanding === 'number' ? state.taskUnderstanding : 0;

  if (state.readyForNextTask === true) return 'ready_to_close';
  if (blockerCount > 0 || cognitiveLoad >= 0.72 || misconceptionRisk >= 0.7) return 'blocked';
  if (taskUnderstanding >= 0.7) return 'verifying';
  return 'trying';
}

export function getRunnableTasks(tasks: SimulationTask[] = []) {
  return tasks.filter(task => task.status !== 'completed');
}

export function countTaskProgress(milestones: SimulationMilestone[], completedTaskId?: string | null) {
  const tasks = milestones.flatMap((milestone) => milestone?.subtasks || []);
  return {
    totalTasks: tasks.length,
    completedTasks: tasks.filter((task) => task.status === 'completed' || task.id === completedTaskId).length
  };
}

export function isRetryableLearnUpstreamError(error: unknown) {
  const message = String(asErrorLike(error).message || error || '').toLowerCase();
  // 注意：不匹配 "retry budget" —— RETRY_BUDGET_EXHAUSTED 是网关的终止信号，
  // 上层若将其视为可重试，等于每次重试都重新发放预算，预算形同虚设。
  return /structured_output_invalid|invalid chat completion|finish_reason|length|empty content|reply completion mismatch|api request canceled|fetch failed|timeout|timed out|econnreset|socket|network|rate.?limit|\b429\b|\b502\b|\b503\b|\b504\b|\b529\b/.test(message);
}

/** 请求级取消检测（客户端断开 / 上层 abort）；无 abortSignal（如自动驾驶）时恒为 false */
export function isRequestAborted(): boolean {
  try {
    return getRequestContext().abortSignal?.aborted === true;
  } catch {
    return false;
  }
}

/**
 * 当前 Path 是否已（含 force）接受过评审。
 *
 * 用于跳过"重复评审"（虚拟学习者跑数观察 #1）：`resolvePathReview` 若看不到已接受状态，
 * 每次 `advance-day` 都会重跑一次评审 LLM 并反复触顶 replan 上限。
 * 条件：`path_review.status === 'accepted'` 且 `reviewedPathId` 与当前 path 一致
 * （Path 换版后 reviewedPathId 会不同 → 仍需重新评审）。
 */
export function isPathReviewAlreadyAcceptedForCurrentPath(
  stageResults: unknown,
  learningPathId: string | null | undefined
): boolean {
  if (!learningPathId || !stageResults || typeof stageResults !== 'object') return false;
  const review = (stageResults as Record<string, unknown>).path_review;
  if (!review || typeof review !== 'object') return false;
  const state = review as Record<string, unknown>;
  return state.status === 'accepted' && state.reviewedPathId === learningPathId;
}

/**
 * 中止类错误（客户端断开 / 进程重启导致 in-flight 上游调用被取消）。
 *
 * 与 `isRetryableLearnUpstreamError` 的区别是**语义**：这里回答"是不是被中止"，
 * 用于决定**是否把虚拟会话终局化（failed）**，而不是"能否重试"。
 *
 * 背景（虚拟学习者跑数观察 #3）：`advance-day runTasks` 在 HTTP 请求上下文里跑，
 * 另一次进程重启把 in-flight LLM 调用取消 → `API request canceled` → 被当作"上游重试耗尽"
 * → 会话 **failed**（不可恢复）。而正确语义是"中断、保留当前 task 可续跑"。
 */
export function isAbortLikeLearnError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'REQUEST_ABORTED' || code === 'ABORT_ERR' || code === 'ECONNRESET') return true;
  const message = String(asErrorLike(error).message || error || '').toLowerCase();
  return /request_aborted|api request canceled|aborted|abort_err|econnreset|socket hang up|请求已取消/.test(message);
}

export function boundTaskCompletionError(error: unknown): string {
  const message = asErrorLike(error).message || String(error || '任务完成失败');
  return message.length > 1000 ? `${message.slice(0, 997)}...` : message;
}

export function findTaskInPath(milestones: SimulationMilestone[], taskId?: string | null) {
  if (!taskId) return null;

  for (let milestoneIdx = 0; milestoneIdx < milestones.length; milestoneIdx += 1) {
    const milestone = milestones[milestoneIdx];
    const taskIdx = (milestone?.subtasks || []).findIndex((task) => task.id === taskId);
    if (taskIdx >= 0) {
      return { milestone, milestoneIdx, task: milestone.subtasks[taskIdx], taskIdx };
    }
  }

  return null;
}

export function buildProgressAfterTaskCompletion(milestones: SimulationMilestone[], completedTaskId: string) {
  const flattenedTasks = milestones.flatMap((milestone: SimulationMilestone, milestoneIdx: number) =>
    (milestone?.subtasks || []).map((task: SimulationTask) => ({ milestone, milestoneIdx, task }))
  );
  const completedTaskIdx = flattenedTasks.findIndex((item) => item.task.id === completedTaskId);
  const isRunnable = (item) => item.task.id !== completedTaskId && item.task.status !== 'completed';
  const nextTask = flattenedTasks.find((item, index: number) => index > completedTaskIdx && isRunnable(item))
    || flattenedTasks.find(isRunnable)
    || null;

  if (!nextTask) {
    return {
      isPathCompleted: true,
      currentTask: null,
      progress: {
        currentMilestone: milestones.length,
        currentMilestoneTitle: null,
        currentTaskIdx: 0,
        currentTaskId: null,
        currentTaskTitle: null,
        totalMilestones: milestones.length
      }
    };
  }

  const runnableTasks = (nextTask.milestone.subtasks || [])
    .filter((task) => task.id !== completedTaskId && task.status !== 'completed');
  return {
    isPathCompleted: false,
    currentTask: nextTask.task,
    progress: {
      currentMilestone: nextTask.milestoneIdx,
      currentMilestoneTitle: nextTask.milestone.title || null,
      currentTaskIdx: Math.max(0, runnableTasks.findIndex((task) => task.id === nextTask.task.id)),
      currentTaskId: nextTask.task.id,
      currentTaskTitle: nextTask.task.title || null,
      totalMilestones: milestones.length
    }
  };
}

export function isGoalConverged(stage?: string | null) {
  return stage === 'ready' || stage === 'completed';
}

export function parseProfileData(profileRecord: VirtualLearnerProfileRow): VirtualLearnerProfile {
  const profileData = safeJsonParse<VirtualLearnerProfileData>(profileRecord.profile, {});
  const knownConcepts = safeJsonParse<string[]>(profileRecord.knownConcepts, []);
  const struggleConcepts = safeJsonParse<string[]>(profileRecord.struggleConcepts, []);
  const personalityTraits = safeJsonParse<PersonalityTraits>(profileRecord.personalityTraits, {});

  return {
    id: profileRecord.id,
    userId: profileRecord.userId,
    profile: profileData,
    learningGoal: profileRecord.learningGoal,
    knowledgeLevel: (profileRecord.knowledgeLevel || 'beginner') as VirtualLearnerProfile['knowledgeLevel'],
    knownConcepts,
    struggleConcepts,
    personalityTraits,
    simulationPrompt: profileRecord.simulationPrompt,
    simulationModel: profileRecord.simulationModel,
    simulationTemperature: profileRecord.simulationTemperature
  };
}

export function buildStoryBehaviorBias(storyContext?: SimulationContext['storyContext']): Partial<LearnerLatentState> {
  if (!storyContext) return {};

  const pressurePoints = Array.isArray(storyContext.pressurePoints) ? storyContext.pressurePoints : [];
  const behaviorHooks = Array.isArray(storyContext.behaviorHooks) ? storyContext.behaviorHooks : [];
  const text = [...pressurePoints, ...behaviorHooks].join('；');

  const partial: Partial<LearnerLatentState> = {};

  if (text.includes('焦虑') || text.includes('紧张') || text.includes('压力')) {
    partial.frustrationLevel = 0.34;
    partial.confusionLevel = 0.54;
  }

  if (text.includes('追问') || text.includes('确认') || text.includes('求助')) {
    partial.wantsClarification = true;
  }

  if (text.includes('保留') || text.includes('质疑') || text.includes('防御')) {
    partial.readyToAdvance = false;
  }

  if (text.includes('装懂') || text.includes('先猜') || text.includes('模糊带过')) {
    partial.selfPerceivedMastery = 0.58;
    partial.actualMastery = 0.38;
  }

  return partial;
}

export function buildDefaultLearnerState(
  profile: VirtualLearnerProfile,
  currentStage: 'goal' | 'path' | 'teaching'
): LearnerLatentState {
  const traits = profile.personalityTraits || {};
  const p = profile.profile || {};

  const patienceBase = traits.patience === 'low' ? 0.35 : traits.patience === 'high' ? 0.78 : 0.58;
  const enthusiasmBase = traits.enthusiasm === 'low' ? 0.4 : traits.enthusiasm === 'high' ? 0.76 : 0.58;
  const attentionPenalty = typeof p.cognitiveLoadTolerance === 'string' && p.cognitiveLoadTolerance.includes('信息一多') ? 0.12 : 0;
  const frustrationBoost = p.emotionalBaseline || (Array.isArray(p.emotionalTriggers) && p.emotionalTriggers.length) ? 0.08 : 0;
  const helpSeeking = typeof p.helpSeekingPattern === 'string' ? p.helpSeekingPattern : '';
  const wantsClarificationByTrait = traits.questionStyle === 'clarifying'
    || traits.questionStyle === 'challenging'
    || helpSeeking.includes('追问')
    || helpSeeking.includes('确认')
    || helpSeeking.includes('具体例子');

  return {
    motivationLevel: enthusiasmBase,
    attentionLevel: Math.max(0.2, patienceBase - attentionPenalty),
    persistenceLevel: patienceBase,
    confusionLevel: currentStage === 'goal' ? 0.48 : 0.32,
    frustrationLevel: Math.min(0.75, 0.18 + frustrationBoost),
    goalReadiness: currentStage === 'goal' ? 0.28 : currentStage === 'path' ? 0.6 : undefined,
    wantsClarification: currentStage === 'goal' ? wantsClarificationByTrait : undefined,
    readyToAdvance: currentStage === 'goal' ? false : undefined,
    selfPerceivedMastery: profile.knowledgeLevel === 'beginner' ? 0.24 : profile.knowledgeLevel === 'advanced' ? 0.72 : 0.5,
    actualMastery: profile.knowledgeLevel === 'beginner' ? 0.2 : profile.knowledgeLevel === 'advanced' ? 0.75 : 0.48,
    memoryStrength: p.memoryRepairPattern ? 0.42 : 0.5,
    remainingUnknowns: currentStage === 'goal' ? ['真实问题还没有完全说清', '还不确定哪种方式真正适合自己'] : undefined,
    stableErrorStyle: Array.isArray(p.failurePatterns) ? p.failurePatterns.slice(0, 2) : undefined
  };
}

export function mapGoalStageToLearnerPhase(goalStage?: string | null) {
  const normalized = String(goalStage || '').toLowerCase();
  if (normalized === 'proposing' || normalized === 'ready' || normalized === 'completed') {
    return 'proposal_evaluation' as const;
  }
  return 'understanding' as const;
}

export function resolveSimLearnerState(skillOutput: SimulatorSkillOutput, fallback: Record<string, unknown> = {}) {
  const envelope = skillOutput?.runtimeEnvelope as { contextUpdate?: { nextState?: Record<string, unknown> } } | undefined;
  const fromEnvelope = envelope?.contextUpdate?.nextState;
  if (fromEnvelope && typeof fromEnvelope === 'object') return fromEnvelope;
  if (skillOutput?.learnerState && typeof skillOutput.learnerState === 'object') {
    return skillOutput.learnerState;
  }
  return fallback || {};
}

export function buildGoalConcernPool(profile: VirtualLearnerProfile, goalState: SimulationContext['goalState']): GoalConcernPool {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  const hidden = new Set<string>();
  const understanding = goalState?.understanding || {};
  const background = understanding?.background || {};

  primary.add('我真正想解决的问题可能和表面目标不完全一样');

  if (profile.profile?.priorAttempts || understanding?.pain_points) {
    primary.add('我之前试过类似学习，但效果不好，担心这次还是学不会');
  }

  if (profile.profile?.availableTime === 'minimal' || background?.available_time || background?.expected_time) {
    secondary.add('我的时间可能不稳定，担心学不完或者坚持不下去');
  }

  if (profile.struggleConcepts?.length) {
    primary.add(`我对某些关键点长期卡住，比如：${profile.struggleConcepts.slice(0, 2).join('、')}`);
  }

  if (profile.knowledgeLevel === 'beginner') {
    secondary.add('我担心自己基础不够，容易跟不上');
  }

  if (profile.personalityTraits?.questionStyle === 'none') {
    hidden.add('即使我没完全懂，也可能不会第一时间主动问出来');
  }

  if (profile.personalityTraits?.patience === 'low') {
    hidden.add('如果过程太绕或太长，我可能会失去耐心');
  }

  if (profile.profile?.motivationType === 'career' || profile.profile?.motivationType === 'necessity') {
    secondary.add('我希望学习结果尽快能用，不太想学很多暂时用不上的内容');
  }

  if (profile.profile?.emotionalBaseline) {
    hidden.add(`这件事会牵动我的情绪底色：${profile.profile.emotionalBaseline}`);
  }

  if (Array.isArray(profile.profile?.emotionalTriggers) && profile.profile.emotionalTriggers.length) {
    hidden.add(`有些情境会明显放大我的压力，比如：${profile.profile.emotionalTriggers.slice(0, 2).join('、')}`);
  }

  if (profile.profile?.helpSeekingPattern) {
    hidden.add(`我在求助上有固定习惯：${profile.profile.helpSeekingPattern}`);
  }

  if (profile.profile?.adversarialPattern) {
    secondary.add(`如果建议不贴近现实，我可能会先保留或质疑：${profile.profile.adversarialPattern}`);
  }

  if (profile.profile?.cognitiveLoadTolerance) {
    secondary.add(`我的信息承载方式有边界：${profile.profile.cognitiveLoadTolerance}`);
  }

  if (profile.profile?.metacognitiveProfile) {
    hidden.add(`我未必能马上准确说清卡点根因：${profile.profile.metacognitiveProfile}`);
  }

  if (profile.profile?.memoryRepairPattern) {
    hidden.add(`即使我忘了或没真懂，也可能先按自己的习惯处理：${profile.profile.memoryRepairPattern}`);
  }

  return {
    primary: Array.from(primary),
    secondary: Array.from(secondary),
    hidden: Array.from(hidden)
  };
}

export function flattenGoalConcernPool(concernPool: GoalConcernPool): string[] {
  return [...(concernPool.primary || []), ...(concernPool.secondary || []), ...(concernPool.hidden || [])];
}

export function parseStageResultsPayload(raw: string | null | undefined): StageResults {
  try {
    return (JSON.parse(raw || '{}') || {}) as StageResults
  } catch {
    return {}
  }
}

export function parseStoryContextFromStageResults(stageResults: StageResults): SimulationContext['storyContext'] {
  return (stageResults?.story || null) as SimulationContext['storyContext'];
}

/**
 * 课时闸门：同一 task 的回合数硬上限。取三者的最大值——
 * - LEARN_TASK_TURN_BUDGET（默认 40）：未配置时的兜底，防手动单步无限拖堂
 * - authorizedTurns（executeAutoLearning 的 maxTurns）：驾驶舱「回合上限」本次输入
 * - 会话生效回合上限（autopilot.maxTurns ?? simulationConfig.turnCapPerLesson）：画像偏好/自动驾驶透传
 * 任一来源调高即放宽，避免「配置 60 却在第 41 回合被默认闸门提前终态化」。
 */
export function resolveLearnTurnBudget(stageResults: StageResults, authorizedTurns?: number): number {
  const simConfig = (stageResults.simulationConfig || {}) as Record<string, unknown>;
  const autopilotState = (stageResults.autopilot || {}) as Record<string, unknown>;
  const candidates = [LEARN_TASK_TURN_BUDGET];
  const authorized = Number(authorizedTurns);
  if (Number.isFinite(authorized) && authorized > 0) candidates.push(Math.min(100, Math.round(authorized)));
  const sessionCap = Number(autopilotState.maxTurns ?? simConfig.turnCapPerLesson);
  if (Number.isFinite(sessionCap) && sessionCap > 0) candidates.push(Math.min(100, Math.round(sessionCap)));
  return Math.max(...candidates);
}

export function sanitizeVisibleContextMessage(message: { content?: unknown }, role: 'learner' | 'goal_agent') {
  const content = sanitizeVisibleDialogue(typeof message?.content === 'string' ? message.content : '');
  if (!content) return null;
  return { role, content };
}

export function trimLearningConversationHistory(history: Array<{ role: string; content: string }> = []): ConversationHistoryItem[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.slice(-6).map((item): ConversationHistoryItem => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: sanitizeVisibleDialogue(typeof item?.content === 'string' ? item.content : '')
  })).filter((item) => item.content);
}

/**
 * phaseFocus 以模拟器（LLM 基于对话+看板）判断为主，编排器只做钳制：
 * 1. 模拟器上次输出的 phaseFocus 若合法且非孤立 ready_to_close（需 readyForNextTask=true），直接沿用；
 * 2. 否则回退阈值机推断（首轮/缺失/非法/自相矛盾时兜底）。
 */
export function resolveLearnerPhase(learnerState: LearnerLatentState | null | undefined): 'trying' | 'blocked' | 'verifying' | 'ready_to_close' {
  const state = learnerState || {};
  const current = state.phaseFocus;
  const VALID_PHASES: Array<'trying' | 'blocked' | 'verifying' | 'ready_to_close'> = ['trying', 'blocked', 'verifying', 'ready_to_close'];
  if (VALID_PHASES.includes(current as (typeof VALID_PHASES)[number])) {
    if (current === 'ready_to_close' && state.readyForNextTask !== true) {
      return inferLearningPhase(state);
    }
    return current as (typeof VALID_PHASES)[number];
  }
  return inferLearningPhase(state);
}

export function mergeLearnerState(
  profile: VirtualLearnerProfile,
  learnerState: Partial<LearnerLatentState> | undefined,
  currentStage: 'goal' | 'path' | 'teaching',
  storyContext?: SimulationContext['storyContext']
): LearnerLatentState {
  const merged = {
    ...buildDefaultLearnerState(profile, currentStage),
    ...buildStoryBehaviorBias(storyContext),
    ...(learnerState || {})
  };

  if (currentStage === 'goal') {
    if (typeof merged.goalReadiness !== 'number' || !Number.isFinite(merged.goalReadiness)) {
      merged.goalReadiness = buildDefaultLearnerState(profile, currentStage).goalReadiness;
    }

    if (merged.goalReadiness >= 0.78 && merged.wantsClarification === false && merged.readyToAdvance !== false) {
      merged.readyToAdvance = true;
    }

    if (merged.goalReadiness < 0.55) {
      merged.readyToAdvance = false;
    }
  }

  if (currentStage === 'teaching') {
    if (typeof merged.taskUnderstanding !== 'number' || !Number.isFinite(merged.taskUnderstanding)) {
      merged.taskUnderstanding = merged.understandingLevel;
    }

    if (typeof merged.helpSeekingReadiness !== 'number' || !Number.isFinite(merged.helpSeekingReadiness)) {
      merged.helpSeekingReadiness = merged.wantsClarification ? 0.7 : 0.35;
    }

    if (typeof merged.readyForNextTask !== 'boolean') {
      merged.readyForNextTask = !!(merged.taskUnderstanding !== undefined && merged.taskUnderstanding >= 0.72 && merged.misconceptionRisk !== undefined && merged.misconceptionRisk < 0.45);
    }
  }

  return merged;
}

export function buildGoalVisibleContext(history: Array<{ role: 'user' | 'assistant'; content: string }>, lastAssistantMessage: string) {
  const visibleHistory = history.flatMap((item) => {
    if (item.role === 'user') {
      const learner = sanitizeVisibleContextMessage(item, 'learner');
      return learner ? [learner] : [];
    }
    const goalAgent = sanitizeVisibleContextMessage(item, 'goal_agent');
    return goalAgent ? [goalAgent] : [];
  });

  return {
    history: visibleHistory,
    lastGoalAgentMessage: sanitizeVisibleDialogue(lastAssistantMessage || visibleHistory.filter((item) => item.role === 'goal_agent').slice(-1)[0]?.content || '')
  };
}

export function buildSimulationContext(
  profile: VirtualLearnerProfile,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  lastAssistantMessage: string,
  currentStage: 'goal' | 'path' | 'teaching',
  storyContext?: SimulationContext['storyContext'],
  goalState?: SimulationContext['goalState'],
  learnerState?: Partial<LearnerLatentState>,
  knowledgeState?: KnowledgePointState[],
  learningState?: SimulationContext['learningState']
): SimulationContext {
  return {
    profile,
    conversationHistory,
    currentStage,
    lastAssistantMessage,
    storyContext,
    goalState,
    learnerState: mergeLearnerState(profile, learnerState, currentStage, storyContext),
    knowledgeState,
    learningState
  };
}

export function finalizeGoalLearnerState(
  profile: VirtualLearnerProfile,
  learnerState: Partial<LearnerLatentState>,
  storyContext?: SimulationContext['storyContext'],
  finalStage?: string | null
): LearnerLatentState {
  const merged = mergeLearnerState(profile, learnerState, 'goal', storyContext);

  if (finalStage === 'ready' || finalStage === 'completed') {
    return {
      ...merged,
      goalReadiness: Math.max(typeof merged.goalReadiness === 'number' ? merged.goalReadiness : 0.28, 0.86),
      wantsClarification: false,
      readyToAdvance: true,
      remainingUnknowns: []
    };
  }

  return merged;
}

export function inferDisclosedGoalConcerns(reply: string, concernPool: GoalConcernPool, disclosed: string[]): string[] {
  const next = new Set(disclosed);
  const text = (reply || '').toLowerCase();

  const flatPool = flattenGoalConcernPool(concernPool);

  const concernKeywords = flatPool.map(item => ({
    item,
    keywords: item
      .replace(/[，。；：,.:]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 2)
  }));

  for (const { item, keywords } of concernKeywords) {
    if (keywords.some(keyword => text.includes(keyword.toLowerCase()))) {
      next.add(item);
    }
  }

  return Array.from(next);
}

export function buildLearningProgressSnapshot(milestones: SimulationMilestone[], milestoneIdx: number, taskIdx: number) {
  const milestone = milestones[milestoneIdx];
  const tasks = getRunnableTasks(milestone?.subtasks || []);
  const task = tasks[taskIdx] || null;

  return {
    currentMilestone: milestoneIdx,
    currentMilestoneTitle: milestone?.title || null,
    currentTaskIdx: task ? taskIdx : 0,
    currentTaskId: task?.id || null,
    currentTaskTitle: task?.title || null,
    totalMilestones: milestones.length
  };
}

/**
 * 从 session.stageResults.simulationConfig 读取本次会话的 frictionBudget
 * 默认 'normal' (真实人物常态)
 */
export function getSessionFrictionBudget(session: VirtualSessionWithProfile): FrictionBudget {
  const stageResults = parseStageResultsPayload(session?.stageResults)
  return normalizeFrictionBudget(stageResults?.simulationConfig?.frictionBudget)
}

export function getSessionPromptOverrides(session: VirtualSessionWithProfile): { goalAgent?: string; pathAgent?: string } | undefined {
  const overrides = parseStageResultsPayload(session?.stageResults)?.systemPromptOverrides;
  if (!overrides || typeof overrides !== 'object') return undefined;
  const overridesRecord = overrides as Record<string, unknown>;

  const goalAgent = typeof overridesRecord.goalAgent === 'string' ? overridesRecord.goalAgent.trim() : '';
  const pathAgent = typeof overridesRecord.pathAgent === 'string' ? overridesRecord.pathAgent.trim() : '';
  return goalAgent || pathAgent ? { goalAgent: goalAgent || undefined, pathAgent: pathAgent || undefined } : undefined;
}
