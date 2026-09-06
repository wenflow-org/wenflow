import { createHash, randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import prisma from '../../config/database';
import learningStateService, { LearningStateMetrics } from '../learning/learning-state.service';
import type { SessionWrapupArtifact, SessionWrapupSummary } from '../../skills/session-wrapup';
import { teachingTurnAgentDefinition, type TeachingTurnInput, type TeachingTurnOutput } from '../../skills/teaching-turn';
import { executeSkill, executeSkillWithResult, auxSkillDefinitionMap, sessionWrapupAgentDefinition, peerAgentDefinition } from '../../skills';
import { buildTeachingScenarioContext, type TeachingScenarioContext, type InteractionMetaRecord } from './TeachingContextBuilder';
import { fsrsRetrievability, type FsrsMemoryState } from '../memory/fsrs';
import {
  teachingSessionRepository,
  TeachingSessionConflictError,
  type TeachingKnowledgePointState,
  type TeachingSessionMessage,
  type TeachingSessionOperationClaim,
  type TeachingSessionRecord,
} from './TeachingSessionRepository';
import { knowledgeStateService } from './KnowledgeStateService';
import { peerTriggerService } from './PeerTriggerService';
import { teachingContextCompressionService } from './TeachingContextCompressionService';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { learnerSnapshotService } from '../learner/LearnerSnapshotService';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { assembleTeachingTurnChannels } from '../field-dispatcher';
import { createDomainEvent } from '../../events/contracts';
import { replanAdvisoryService, type ReplanAdvisory } from './ReplanAdvisoryService';
import { hasReliableSessionEvaluation, mergeFinalTeachingState } from './SessionFinalizationPolicy';
import { classifyFinalizationError } from './FinalizationErrors';
import { FinalizationLeaseGuard } from './FinalizationLeaseGuard';
import { learnerExitService } from '../learner/LearnerExitService';
import { memoryTraceService } from '../memory/memory-trace.service';
import { recordMisconceptions } from '../learner/misconception-ledger.service';

export type TeachingMode = 'tutor' | 'peer' | 'debate';
const AI_TEACHING_AGENT_ID = 'teaching-agent';

export interface KnowledgePointStatus {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export interface TeachingCheckpoint {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'short_answer';
  title: string;
  question: string;
  options?: Array<{ id: string; text: string }>;
  allowSkip?: boolean;
  contextHint?: string;
}

export interface CheckpointSubmitPayload {
  selectedOptionIds?: string[];
  answerText?: string;
  /** 跳过检查点：清除待处理检查点并记录历史，不触发教学回合 */
  skip?: boolean;
}

export interface CheckpointSubmitResult {
  passed: boolean;
  feedback: string;
  hint?: string;
  nextAction: 'continue' | 'review' | 'retry';
  revision: number;
}

export interface TeachingSessionStartInput {
  userId: string;
  taskId: string;
  /** 会话模式：tutor（默认教学）/ review（复习课，knowledgeState 注入到期复习点） */
  mode?: 'tutor' | 'review';
}

export interface TeachingOpening {
  message: string;
  question: string;
  quickReplies: Array<{ text: string }>;
  mode: 'self-assess' | 'predict' | 'example-first';
}

type SessionResumeMode = 'new' | 'resumed';

/** 开场景卡片元数据（供前端开场 UI 结构化渲染，区分首课/续课/重学/恢复/复习） */
export interface SessionOpeningScene {
  kind: 'first' | 'continuation' | 'relearn' | 'resume' | 'review';
  /** 卡片主标题（面向学习者的人话，如「这节课是 X 的延续」） */
  title: string;
  /** 衔接素材：上一课的摘要 / 卡点（有则展示在卡片上） */
  recap?: {
    topic: string | null;
    summary: string | null;
    retrievalCue: string | null;
    unresolved: string[];
    /** 位置关系：same-milestone-prev-task / prev-milestone / same-task / last-any */
    relation?: string | null;
    sourceStage?: number | null;
    sourceTitle?: string | null;
  } | null;
  /** 同任务重学次数（≥2 表示这是重学） */
  attempt?: number;
  /** 前序阶段掌握度（供"基础稳不稳"提示） */
  mastery?: Array<{ stage: number; title: string; state: 'unknown' | 'partial' | 'stable' | 'at-risk' }>;
}

/** 依据会话场景与上下文推导开场卡（纯函数，便于测试） */
export function buildSessionOpeningScene(opts: {
  mode: SessionResumeMode;
  review?: boolean;
  context: TeachingScenarioContext;
  sameTaskAttempt?: number;
}): SessionOpeningScene {
  const { mode, review, context, sameTaskAttempt } = opts;
  const prior = context.priorLearningContext;
  const recap = context.lastLessonRecap;
  if (review) {
    return {
      kind: 'review',
      title: '今日复习 · 回捞快忘的知识点',
      recap: recap ? {
        topic: recap.sourceTopic,
        summary: recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: recap.sourceTaskTitle ?? recap.sourceMilestoneTitle ?? null,
      } : null,
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  if (mode === 'resumed') {
    return {
      kind: 'resume',
      title: '继续这节课 · 从上次离开的地方接着学',
      recap: recap ? {
        topic: recap.sourceTopic,
        summary: recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: recap.sourceTaskTitle ?? recap.sourceMilestoneTitle ?? null,
      } : null,
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  // mode === 'new'：区分首课 / 同任务重学 / 第二课接续
  if (sameTaskAttempt && sameTaskAttempt >= 2) {
    return {
      kind: 'relearn',
      title: '重新学这一课 · 上次没完全掌握的这次补上',
      recap: recap && recap.relation === 'same-task' ? {
        topic: recap.sourceTopic,
        summary: recap.sameTaskHistory?.lastSummary || recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: context.taskTitle,
      } : null,
      attempt: sameTaskAttempt,
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  const hasAdjacent = recap && (recap.relation === 'same-milestone-prev-task' || recap.relation === 'prev-milestone');
  if (hasAdjacent) {
    return {
      kind: 'continuation',
      title: '接着上一课往下学',
      recap: {
        topic: recap.sourceTopic,
        summary: recap.topicSummary,
        retrievalCue: recap.retrievalCue,
        unresolved: recap.unresolvedPoints,
        relation: recap.relation,
        sourceStage: recap.sourceStageNumber ?? null,
        sourceTitle: recap.sourceTaskTitle ?? recap.sourceMilestoneTitle ?? null,
      },
      mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [],
    };
  }
  return { kind: 'first', title: '开始这节课', mastery: prior?.priorMilestoneMastery?.map((m) => ({ stage: m.stageNumber, title: m.title, state: m.masteryState })) || [] };
}

interface ProcessStudentMessageOptions {
  operationClaim?: TeachingSessionOperationClaim;
  checkpointId?: string;
  expectedRevision?: number;
  /** 前端交互特征（认知负荷量测 · 前端情报层）：随学生消息落库并注入教学上下文 */
  interactionMeta?: InteractionMetaRecord | null;
  /**
   * 回合类型：默认 message（学生真实输入）；'resume-continue' = 断线恢复后的纯续讲回合——
   * 无学生新输入，不落库伪 user 消息，teaching-turn 仅凭历史 + session-resumed 事件自然接续。
   */
  kind?: 'message' | 'resume-continue';
}

const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;

function buildSessionId(userId: string) {
  return `teaching_${userId}_${randomUUID()}`;
}

function requireTeachingRevision(revision: number | undefined): number {
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new TeachingSessionConflictError('缺少有效的课堂 revision', 'TEACHING_REVISION_REQUIRED');
  }
  return Number(revision);
}

function buildEndSessionRequestIdentity(endReason: string) {
  const requestJson = JSON.stringify({ action: 'end_only', endReason });
  return {
    requestJson,
    requestHash: createHash('sha256').update(requestJson).digest('hex')
  };
}

function toMessageRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'assistant' || role === 'system') return role;
  return 'user';
}

function appendTimestamp(messages: Array<{ role: string; content: string; timestamp?: string; analysis?: any; checkpoint?: boolean; meta?: Record<string, number> | null }>): TeachingSessionMessage[] {
  return messages.map((message) => ({
    role: toMessageRole(message.role),
    content: message.content,
    timestamp: message.timestamp || new Date().toISOString(),
    ...(message.analysis ? { analysis: message.analysis } : {}),
    ...(message.checkpoint ? { checkpoint: true } : {}),
    ...(message.meta && Object.keys(message.meta).length > 0 ? { meta: message.meta } : {})
  }));
}

function normalizeKnowledgePoints(points: TeachingKnowledgePointState[]): KnowledgePointStatus[] {
  return points.map((point) => ({
    name: point.name,
    status: point.status,
    progress: point.progress,
  }));
}

function parseSessionArtifacts(teachingState: Record<string, any> | null | undefined) {
  return teachingState?.sessionArtifacts || {};
}

function getPendingCheckpoint(teachingState: Record<string, any> | null | undefined): TeachingCheckpoint | null {
  return teachingState?.pendingCheckpoint
    || parseSessionArtifacts(teachingState).pendingCheckpoint
    || null;
}

type LearnStage = 'opening' | 'teaching' | 'intervention' | 'checkpoint' | 'ready_to_close' | 'wrapup';

function mapOpeningModeToStage(openingMode: string | null | undefined): LearnStage {
  return openingMode ? 'opening' : 'opening';
}

function dedupeStringList(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean)));
}

function getLatestUserMessage(messages: TeachingSessionMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user' && message.content?.trim())?.content || '';
}

function buildPathBackgroundContext(context: TeachingScenarioContext) {
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

function buildLearnerStateContext(
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

function extractTeachingStateMetrics(teachingState: Record<string, any> | null | undefined): LearningStateMetrics | null {
  return learningStateService.coerceMetrics(teachingState);
}

function deriveTeachingRuntimeSignals(context: TeachingScenarioContext) {
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

function buildTeachingControlContext(
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

function buildClassroomEvent(
  type: string,
  summary: string,
  payload: Record<string, any> = {},
) {
  return {
    type,
    summary,
    occurredAt: new Date().toISOString(),
    payload,
  };
}

function detectEndIntent(message: string) {
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

function determineNextStage(params: {
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

function buildClassroomContext(params: {
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

function buildTeachingStateWithArtifacts(
  teachingState: Record<string, any> | null | undefined,
  sessionArtifacts: Record<string, any>
) {
  return {
    ...(teachingState || {}),
    sessionArtifacts,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
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
async function withTimeoutSignal<T>(
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

function computeEffectiveDurationMinutes(session: TeachingSessionRecord) {
  const sessionArtifacts = parseSessionArtifacts(session.teachingState);
  let pausedDurationMs = Number(sessionArtifacts.pausedDurationMs || 0);
  if (!Number.isFinite(pausedDurationMs) || pausedDurationMs < 0) pausedDurationMs = 0;

  // 暂停中直接收束：当前暂停段（pausedAt → now）一并计入暂停，避免把切走时间算入
  if (session.status === 'paused' && typeof sessionArtifacts.pausedAt === 'string') {
    const pausedAtMs = new Date(sessionArtifacts.pausedAt).getTime();
    if (Number.isFinite(pausedAtMs)) {
      pausedDurationMs += Math.max(0, Date.now() - pausedAtMs);
    }
  }

  const rawDuration = Math.max(1, Math.round((Date.now() - session.startTime.getTime() - pausedDurationMs) / 60000));

  // idle 封顶：按消息时间戳间隔估算活跃时长（间隔 > 30 分钟视为暂停，与 timeout-fallback 规则一致），
  // 防止合盖睡眠/进程被杀等无 pagehide 场景把 idle 时间算入学习时长
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const times = messages
    .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length > 0) {
    let activeMinutes = 0;
    for (let i = 1; i < times.length; i++) {
      activeMinutes += Math.min((times[i] - times[i - 1]) / 60000, 30);
    }
    // 首条消息前引导段 + 最后活动后的收尾窗各按最多 30 分钟计
    const capped = Math.round(activeMinutes + 60);
    return Math.max(1, Math.min(rawDuration, capped));
  }

  return rawDuration;
}

function buildRecoveredOpening(session: TeachingSessionRecord): TeachingOpening {
  return {
    message: `已为你恢复这节关于 **${session.topic}** 的课程进度，我们从你上次离开的地方继续。`,
    question: '准备好了的话，我们继续刚才的内容。',
    quickReplies: [{ text: '继续上次进度' }, { text: '先回顾一下' }, { text: '从当前焦点继续' }],
    mode: 'self-assess',
  };
}

/**
 * 确定性开场兜底：generateOpening（LLM）失败/无有效结构时使用，
 * 保证开课链路在模型不可用时仍可用（此前直接抛错导致开课整体不可用）。
 * 结构对齐 TeachingOpening 契约（message/question/quickReplies/mode）。
 */
function buildDeterministicOpening(context: TeachingScenarioContext): TeachingOpening {
  return {
    message: `我们先从 **${context.topic || context.taskTitle}** 开始这节课。目标是把关键知识点讲清楚，并在过程中检查你的掌握情况。`,
    question: '准备好了的话，我们直接开始。',
    quickReplies: [{ text: '准备好了，开始' }, { text: '先讲讲目标' }, { text: '换种方式讲解' }],
    mode: 'example-first',
  };
}

function cloneKnowledgePoints(points: TeachingKnowledgePointState[] | null | undefined): TeachingKnowledgePointState[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => point && typeof point.name === 'string' && point.name.trim())
    .map((point) => ({
      name: point.name.trim(),
      status: point.status,
      progress: Number.isFinite(point.progress) ? Number(point.progress) : 0,
    }));
}

/**
 * M1 兜底：正式课后产出（executeSkill）抛错 / 返回 success:false 时构造的
 * summary-only wrapup（不调 LLM），结构对齐 applyTimeoutWrapupFallback，
 * 保证 endSession 收束流程继续，不落入 finalization_failed。
 */
function buildEndWrapupFallback(session: TeachingSessionRecord, durationMinutes: number): {
  result: any;
  artifact: any;
} {
  const knowledgePoints = cloneKnowledgePoints(session.knowledgeState);
  const mastered = knowledgePoints.filter((p) => p.status === 'mastered').map((p) => p.name);
  const learning = knowledgePoints.filter((p) => p.status === 'learning').map((p) => p.name);
  const summary = {
    topicSummary: '本次学习记录生成遇到问题，为你保留了基础总结。',
    knowledgeSummary: mastered.length > 0 ? `已掌握：${mastered.join('、')}。` : '暂未确认掌握的知识点。',
    practiceAdvice: '重新完成一次完整的学习后，这里会给出完整建议。',
    learningEvaluation: '未生成学习评价。',
    knowledgeItems: knowledgePoints.map((p) => ({
      name: p.name,
      status: p.status,
      progress: p.progress,
      evidence: p.status === 'mastered' ? '会话中确认掌握' : '会话中未完成确认',
    })),
    keyTakeaways: [] as string[],
    actionPlan: [] as string[],
    evaluationHighlights: { strengths: [] as string[], improvements: [] as string[] },
    metricInterpretation: {
      session: '未生成本节课堂表现。',
      longTerm: '未生成长期状态评估。',
    },
    summaryVersion: 'v2',
  };
  const progress = {
    newlyMastered: mastered,
    movedToReview: [] as string[],
    stillLearning: learning,
    unchangedMastered: [] as string[],
  };
  const evidence = {
    turnCount: Array.isArray(session.messages) ? session.messages.length : 0,
    avgUnderstanding: null,
    avgEngagement: null,
    dominantCognitiveLevel: null,
    lastCognitiveLevel: null,
    topConfusionPoints: [] as string[],
    emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
    completionCandidateSeen: false,
  };
  return {
    result: {
      summary,
      evaluation: null,
      summarySource: 'fallback' as const,
      evaluationSource: 'failed' as const,
      runtimeEnvelope: null,
    },
    artifact: {
      status: 'summary-only' as const,
      sources: { summary: 'end-fallback' as const, evaluation: 'failed' as const },
      summary,
      evaluation: null,
      progress,
      evidence,
      duration: durationMinutes,
    },
  };
}

/** 合并后知识点的总数上限（防止模型每轮新增点导致无限膨胀） */
const MAX_KNOWLEDGE_POINTS = 12;

function normalizeFrozenKnowledgeState(
  frozenPoints: TeachingKnowledgePointState[] | null | undefined,
  currentPoints: TeachingKnowledgePointState[] | null | undefined,
): TeachingKnowledgePointState[] {
  const frozen = cloneKnowledgePoints(frozenPoints);
  const current = cloneKnowledgePoints(currentPoints);
  if (frozen.length === 0) {
    return current.slice(0, MAX_KNOWLEDGE_POINTS);
  }

  const frozenMap = new Map(
    frozen.map((point) => [point.name.trim().toLowerCase(), point])
  );
  const currentMap = new Map(
    current.map((point) => [point.name.trim().toLowerCase(), point])
  );

  const merged = frozen.map((point, index) => {
    const currentPoint = currentMap.get(point.name.trim().toLowerCase());
    return {
      name: point.name,
      status: currentPoint?.status || point.status || (index === 0 ? 'learning' : 'pending'),
      progress: currentPoint ? Math.max(point.progress || 0, currentPoint.progress || 0) : (point.progress || 0),
    };
  });

  // 保留模型/合并中新出现的点（不在种子集合里）：追加到末尾，避免新发现被静默丢弃
  for (const currentPoint of current) {
    if (!frozenMap.has(currentPoint.name.trim().toLowerCase())) {
      merged.push({ ...currentPoint });
    }
    if (merged.length >= MAX_KNOWLEDGE_POINTS) break;
  }
  return merged;
}

function isKnowledgeStateComplete(points: TeachingKnowledgePointState[] | null | undefined): boolean {
  return Array.isArray(points)
    && points.length > 0
    && points.every((point) => point.status === 'mastered');
}

function hasPrematureNextStepLanguage(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  const text = reply.trim();
  if (!text) return false;

  const patterns = [
    /进入下一环节/,
    /进入下一个环节/,
    /进入下一步任务/,
    /进入下一个任务/,
    /接下来.*下一环节/,
    /接下来.*下一个任务/,
    /后续.*下一个任务/,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function computeKnowledgeDelta(
  initialPoints: TeachingKnowledgePointState[],
  finalPoints: TeachingKnowledgePointState[]
) {
  const initialMap = new Map(initialPoints.map((point) => [point.name, point]));
  const finalMap = new Map(finalPoints.map((point) => [point.name, point]));
  const names = Array.from(new Set([...initialMap.keys(), ...finalMap.keys()]));

  const newlyMastered: string[] = [];
  const movedToReview: string[] = [];
  const stillLearning: string[] = [];
  const unchangedMastered: string[] = [];

  for (const name of names) {
    const before = initialMap.get(name);
    const after = finalMap.get(name);
    if (!after) continue;

    if (after.status === 'mastered') {
      if (!before || before.status !== 'mastered') {
        newlyMastered.push(name);
      } else {
        unchangedMastered.push(name);
      }
      continue;
    }

    if (after.status === 'review' && before?.status !== 'review') {
      movedToReview.push(name);
      continue;
    }

    if (after.status === 'learning' || after.status === 'pending') {
      stillLearning.push(name);
    }
  }

  return {
    newlyMastered,
    movedToReview,
    stillLearning,
    unchangedMastered,
  };
}

/**
 * session_load 聚合（loadIndex 聚合消费）：从会话消息的 analysis.loadIndex 聚合
 * 均值/峰值/loadBasis 分布，以 metricType='session_load' 幂等写入 learning_metrics
 * （sourceKey=session-load:{sessionId}）。无 loadIndex 证据时跳过。
 */
async function commitSessionLoadMetric(session: TeachingSessionRecord): Promise<void> {
  const loadIndexes: number[] = [];
  const basisCounter = new Map<string, number>();
  for (const message of session.messages) {
    const load = Number(message.analysis?.loadIndex);
    if (Number.isFinite(load)) loadIndexes.push(load);
    const basis = message.analysis?.loadBasis;
    if (typeof basis === 'string' && basis) {
      basisCounter.set(basis, (basisCounter.get(basis) || 0) + 1);
    }
  }
  if (loadIndexes.length === 0) return;
  const avg = loadIndexes.reduce((sum, value) => sum + value, 0) / loadIndexes.length;
  const max = Math.max(...loadIndexes);
  const basisDist: Record<string, number> = {};
  for (const [key, count] of basisCounter) basisDist[key] = count;

  await prisma.learning_metrics.upsert({
    where: {
      sourceKey: `session-load:${session.id}`,
    },
    update: {},
    create: {
      id: `sl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      sourceKey: `session-load:${session.id}`,
      userId: session.userId,
      pathId: session.learningPathId || null,
      taskId: session.taskId,
      metricType: 'session_load',
      value: Number(avg.toFixed(3)),
      metadata: JSON.stringify({
        max: Number(max.toFixed(3)),
        basisDist,
        perTurnCount: loadIndexes.length,
        scale: '0-1',
      }),
    },
  });
}

function computeSessionEvidence(session: TeachingSessionRecord) {  // 排除检查点合成消息（非真实学生话语），避免污染理解/参与度统计
  const analyzedMessages = session.messages.filter((message) => !!message.analysis && !message.checkpoint);
  const avg = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const understandingScores = analyzedMessages
    .map((message) => Number(message.analysis?.understanding))
    .filter((value) => Number.isFinite(value));
  const engagementScores = analyzedMessages
    .map((message) => Number(message.analysis?.engagement))
    .filter((value) => Number.isFinite(value));

  const confusionCounter = new Map<string, number>();
  const cognitiveCounter = new Map<string, number>();
  const emotionalSignals = {
    positive: 0,
    neutral: 0,
    frustrated: 0,
    confused: 0,
  };

  for (const message of analyzedMessages) {
    const confusionPoints = Array.isArray(message.analysis?.confusionPoints)
      ? message.analysis?.confusionPoints
      : [];
    for (const point of confusionPoints) {
      if (!point || typeof point !== 'string') continue;
      confusionCounter.set(point, (confusionCounter.get(point) || 0) + 1);
    }

    const level = typeof message.analysis?.cognitiveLevel === 'string'
      ? message.analysis.cognitiveLevel
      : null;
    if (level) {
      cognitiveCounter.set(level, (cognitiveCounter.get(level) || 0) + 1);
    }

    const emotion = typeof message.analysis?.emotionalState === 'string'
      ? message.analysis.emotionalState
      : null;
    if (emotion === 'positive' || emotion === 'neutral' || emotion === 'frustrated' || emotion === 'confused') {
      emotionalSignals[emotion] += 1;
    }
  }

  const dominantCognitiveLevel = Array.from(cognitiveCounter.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const lastCognitiveLevel = [...analyzedMessages].reverse().find((message) => !!message.analysis?.cognitiveLevel)?.analysis?.cognitiveLevel || null;
  const topConfusionPoints = Array.from(confusionCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label]) => label);
  const completionCandidateSeen = !!session.messages.find((message) => message.analysis?.completionCandidate === true)
    || !!(session.teachingState as any)?.completionCandidate;

  return {
    turnCount: session.messages.filter((message) => message.role === 'user').length,
    avgUnderstanding: avg(understandingScores),
    avgEngagement: avg(engagementScores),
    dominantCognitiveLevel,
    lastCognitiveLevel,
    topConfusionPoints,
    emotionalSignals,
    completionCandidateSeen,
  };
}

async function buildTeachingTurnInput(
  session: TeachingSessionRecord,
  context: TeachingScenarioContext
): Promise<TeachingTurnInput> {
  const compression = teachingContextCompressionService.compress(session.messages);
  const teachingState = session.teachingState || {};
  const classroomContext = teachingState.classroomContext || {};
  const learnerStateContext = teachingState.learnerStateContext || buildLearnerStateContext(context, teachingState);
  const teachingControlContext = teachingState.teachingControlContext || buildTeachingControlContext(
    (classroomContext?.stage?.current as LearnStage) || 'opening',
    context,
    learnerStateContext,
    parseSessionArtifacts(teachingState),
  );
  const classroomEventContext = {
    recentEvents: Array.isArray(teachingState.classroomEventHistory)
      ? teachingState.classroomEventHistory.slice(-5)
      : [],
  };

  const scenario: TeachingTurnInput['scenario'] = {
    subject: context.subject,
    topic: context.topic,
    taskTitle: context.taskTitle,
    taskDescription: context.taskDescription,
    taskType: context.taskType,
    taskProfile: context.taskProfile,
    currentTaskContext: context.currentTaskContext,
    cognitiveFrame: context.cognitiveFrame,
    teachingStrategyGuidance: context.teachingStrategyGuidance,
    pathTitle: context.pathProgress.pathTitle,
    pathSummary: context.pathProgress.pathSummary,
    currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
    currentStageNumber: context.pathProgress.currentStageNumber,
    currentTaskOrder: context.pathProgress.currentTaskOrder,
    totalTasksInMilestone: context.pathProgress.totalTasksInMilestone,
    taskKnowledgeScope: context.taskKnowledgeScope,
    pathBackgroundContext: buildPathBackgroundContext(context),
    learningSignal: context.learningSignal,
    lastLessonRecap: context.lastLessonRecap,
    priorLearningContext: context.priorLearningContext,
    learnerPrediction: context.learnerPrediction
      ? {
          stallRisk: context.learnerPrediction.stallRisk,
          predictedTone: context.learnerPrediction.predictedTone,
          suggestedDepth: context.learnerPrediction.suggestedDepth,
          focusConcepts: context.learnerPrediction.focusConcepts,
          rationale: context.learnerPrediction.rationale,
          reliability: context.learnerPrediction.reliability,
        }
      : undefined,
    interactionProfile: context.interactionProfile
      ? {
          current: (context.interactionProfile.current ?? null) as Record<string, number> | null,
          history: (context.interactionProfile.history ?? []).map((h) => ({
            role: h.role,
            timestamp: h.timestamp,
            meta: (h.meta ?? null) as Record<string, number> | null,
            textLength: h.textLength,
          })),
          absent: context.interactionProfile.absent,
        }
      : undefined,
    contextCompression: compression.compressed ? {
      enabled: true,
      estimatedTokens: compression.estimatedTokens,
      triggerTokens: compression.triggerTokens,
      recap: compression.recap,
    } : undefined,
    taskMode: context.taskMode,
    priorMisconceptions: context.priorMisconceptions,
    behavioralProfile: context.behavioralProfile,
  };

  // L2 声明化装配（只读对账）：状态池形状由 sandbox-resolver 的 teaching provider 声明，
  // 本链只提供原始 context。缺键打 warn，不阻断。
  try {
    const { checkAgentSandboxRefsFromContext } = await import('../sandbox-resolver.service');
    await checkAgentSandboxRefsFromContext(
      'teaching-turn',
      'teaching',
      {
        sessionMessages: session.messages.map((item) => ({ role: item.role, content: item.content })),
        sessionId: session.id,
        mode: session.mode,
        topic: context.topic,
        learnerProjection: context.learnerProjection,
        knowledgeState: session.knowledgeState,
        classroomContext,
        teachingControlContext,
        scenario: scenario as Record<string, unknown>,
        interactionProfile: (context as any).interactionProfile,
      },
      { warnContext: { sessionId: session.id } }
    );
  } catch {
    // 对账失败不影响主流程
  }

  // 配置式输入通道（P2 声明 + 本链运行时消费）：routings 表 teaching-agent 通道行抽值优先，
  // 缺失回退既有组装；visibleDialogueContext 保持 {role, content} 映射语义
  const { channels } = await assembleTeachingTurnChannels({ session, teachingState, context }).catch(() => ({ channels: {}, skipped: [] }));
  const configuredVisible = Array.isArray(channels['visibleDialogueContext'])
    ? channels['visibleDialogueContext']
        .filter((item: any) => item && (typeof item.role === 'string' || typeof item.role === 'number'))
        .map((item: any) => ({ role: item.role, content: typeof item.content === 'string' ? item.content : '' }))
    : null;

  return {
    messages: compression.messages,
    learner: channels['learner.learnerProjection'] || context.learnerProjection,
    scenario,
    classroomContext: channels['classroomContext'] || classroomContext,
    classroomEventContext,
    // visibleDialogueContext 压缩修复（KV 前缀优化）：压缩后只带最近 N 条（recap 由
    // scenario.contextCompression 承担），避免全量历史绕过压缩导致 user payload 无界增长
    visibleDialogueContext: configuredVisible || (() => {
      if (compression.compressed) {
        return compression.messages
          .filter((item) => item.role !== 'system')
          .map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content }));
      }
      return session.messages.map((item) => ({
        role: item.role,
        content: item.content,
      }));
    })(),
    knowledge: {
      points: (channels['knowledge.state'] && Array.isArray(channels['knowledge.state'])
        ? channels['knowledge.state']
        : session.knowledgeState),
    },
    controls: {
      mode: session.mode as TeachingMode,
      teachingControlContext: channels['controls.teachingControlContext'] || teachingControlContext,
    }
  };
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function pruneOverlyBroadCoreConceptPoints(
  points: TeachingKnowledgePointState[],
  coreConcept: string | null,
): TeachingKnowledgePointState[] {
  const normalizedCoreConcept = normalizeConcept(coreConcept);
  const normalizedPoints = points.filter((point) => normalizeConcept(point.name));

  if (!normalizedCoreConcept) {
    return normalizedPoints;
  }

  const hasFinerPoint = normalizedPoints.some((point) => normalizeConcept(point.name) !== normalizedCoreConcept);
  if (!hasFinerPoint) {
    return normalizedPoints;
  }

  const filtered = normalizedPoints.filter((point) => normalizeConcept(point.name) !== normalizedCoreConcept);
  return filtered.length > 0 ? filtered : normalizedPoints;
}

function reconcileTeachingKnowledgeState(
  context: TeachingScenarioContext,
  output: TeachingTurnOutput,
  existingPoints: TeachingKnowledgePointState[]
) {
  const coreConcept = context.taskProfile.coreConcept || context.taskProfile.linkedConceptName || null;
  const filteredOutputPoints = pruneOverlyBroadCoreConceptPoints(output.knowledge.points, coreConcept).slice(0, 5);
  const filteredExistingPoints = pruneOverlyBroadCoreConceptPoints(existingPoints, coreConcept);
  const normalizedCurrentPoint = normalizeConcept(output.knowledge.currentPoint || null);
  const currentPointExists = !!normalizedCurrentPoint && [
    ...filteredOutputPoints,
    ...filteredExistingPoints,
  ].some((point) => normalizeConcept(point.name) === normalizedCurrentPoint);

  const currentPoint = currentPointExists
    ? output.knowledge.currentPoint
    : filteredOutputPoints[0]?.name || filteredExistingPoints[0]?.name || null;

  return {
    teachingOutput: {
      ...output,
      knowledge: {
        ...output.knowledge,
        currentPoint,
        points: filteredOutputPoints,
      }
    } as TeachingTurnOutput,
    existingPoints: filteredExistingPoints,
  };
}

function extractTeachingOutput(agentOutput: any): TeachingTurnOutput {
  return (
    agentOutput?.internal?.ext?.teachingTurnOutcome?.artifact
    || agentOutput?.internal?.ext?.teaching
  ) as TeachingTurnOutput;
}

function extractPeerDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.peer || null;
}

function extractTeachingPromptDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.promptDebug || null;
}

export class AITeachingOrchestrator {
  private idleTimeoutMs = 120 * 60 * 1000;
  /** 长时间未恢复的 paused 会话视为放弃：超过该阈值按超时兜底处理（用户可随时通过下一轮教学回合恢复） */
  private pausedSessionTimeoutMs = 24 * 60 * 60 * 1000;
  /** 终态脏数据保留期：failed/superseded/discarded 行超过该时长后由 idle 巡检清理 */
  private terminalSessionRetentionMs = 30 * 24 * 60 * 60 * 1000;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleCheckInFlight: Promise<void> | null = null;
  private stopping = false;

  constructor() {
    this.start();
  }

  start(): void {
    if (this.idleTimer) return;
    this.stopping = false;
    this.idleTimer = setInterval(() => {
      if (this.stopping || this.idleCheckInFlight) return;
      const run = this.checkIdleSessions();
      this.idleCheckInFlight = run;
      void run.catch(error => {
        logger.warn('[AITeaching] idle session scan failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }).finally(() => {
        if (this.idleCheckInFlight === run) this.idleCheckInFlight = null;
      });
    }, 60 * 1000);
    this.idleTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    await this.idleCheckInFlight;
  }

  async startSession(input: TeachingSessionStartInput): Promise<{
    sessionId: string;
    subject: string;
    topic: string;
    startTime: Date;
    welcomeMessage: string;
    opening: TeachingOpening;
    knowledgePoints: KnowledgePointStatus[];
    mode: SessionResumeMode;
    revision: number;
    scene?: SessionOpeningScene;
  }> {
    const context = await buildTeachingScenarioContext(input.userId, input.taskId, null);
    // 当前任务的历史完结次数（判断「同任务重学」，供开场卡 scene.kind = relearn）
    let sameTaskAttempt = 0;
    try {
      sameTaskAttempt = await prisma.teaching_sessions.count({
        where: {
          userId: input.userId,
          taskId: input.taskId,
          status: { in: ['completed', 'discarded'] },
        },
      });
    } catch { /* 统计失败不阻断 */ }
    const seededKnowledgeState = cloneKnowledgePoints(context.taskKnowledgeSeeds);
    // 复习课模式：knowledgeState 种子 = 任务种子 + 到期复习点（全部注入，非 limit 2）
    if (input.mode === 'review') {
      try {
        const dueTraces = await learnerExitService.getDueReview(input.userId, 20);
        const existingKeys = new Set(seededKnowledgeState.map((point) => point.name));
        for (const trace of dueTraces) {
          if (existingKeys.has(trace.conceptKey)) continue;
          seededKnowledgeState.push({
            name: trace.conceptKey,
            status: 'review',
            progress: Math.round(trace.retention * 100),
          });
          existingKeys.add(trace.conceptKey);
        }
      } catch (error) {
        logger.warn('[AITeaching] 复习课到期点注入失败，使用任务种子', {
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // 记忆引擎 M2：经 learn agent 出口惰性检查到期复习点，作为 review 状态注入本节课知识看板
    // （旧知唤醒，best-effort：查询失败不阻断开课；出口=LearnerExitService.getDueReview）
    try {
      const dueTraces = await learnerExitService.getDueReview(input.userId, 2);
      if (dueTraces.length > 0) {
        const existingKeys = new Set(seededKnowledgeState.map((point) => point.name));
        for (const trace of dueTraces) {
          if (existingKeys.has(trace.conceptKey)) continue;
          seededKnowledgeState.push({
            name: trace.conceptKey,
            status: 'review',
            progress: Math.round(trace.retention * 100),
          });
          existingKeys.add(trace.conceptKey);
          logger.info('[AITeaching] 到期旧知唤醒注入看板', {
            userId: input.userId,
            taskId: input.taskId,
            conceptKey: trace.conceptKey,
            retention: trace.retention,
          });
        }
      }
    } catch (error) {
      logger.warn('[AITeaching] 到期复习点查询失败，跳过注入', {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const sessionId = buildSessionId(input.userId);
    const reservation = await teachingSessionRepository.reserve({
      id: sessionId,
      userId: input.userId,
      taskId: context.taskId,
      learningPathId: context.learningPathId,
      milestoneId: context.milestoneId,
      subject: context.subject,
      topic: context.topic,
      taskType: context.taskType,
      mode: input.mode || 'tutor',
      messages: [],
      knowledgeState: seededKnowledgeState,
      teachingState: null,
    }, RECOVERY_WINDOW_MS);

    if (!reservation.created) {
      if (reservation.session.status === 'initializing' || reservation.session.status === 'finalizing') {
        throw new TeachingSessionConflictError('课堂正在启动或结束，请稍后重试', 'TEACHING_SESSION_BUSY');
      }

      const claim = await teachingSessionRepository.claimOperation(
        reservation.session.id,
        'resume',
        ['active', 'paused', 'timeout']
      );
      let committed = false;
      try {
        const previousSession = claim.session;
        const sessionArtifacts = parseSessionArtifacts(previousSession.teachingState);
        const resumedContext = await buildTeachingScenarioContext(input.userId, input.taskId, previousSession);
        const effectiveInitialKnowledgeState = cloneKnowledgePoints(
          Array.isArray(sessionArtifacts.initialKnowledgeState) && sessionArtifacts.initialKnowledgeState.length > 0
            ? sessionArtifacts.initialKnowledgeState
            : resumedContext.taskKnowledgeSeeds
        );
        const resumedKnowledgeState = normalizeFrozenKnowledgeState(
          effectiveInitialKnowledgeState,
          previousSession.knowledgeState,
        );
        const wasPausedAt = typeof sessionArtifacts.pausedAt === 'string'
          ? new Date(sessionArtifacts.pausedAt).getTime()
          : null;
        const additionalPausedMs = wasPausedAt ? Math.max(0, Date.now() - wasPausedAt) : 0;
        const resumedTeachingState = buildTeachingStateWithArtifacts(previousSession.teachingState, {
          ...sessionArtifacts,
          initialKnowledgeState: effectiveInitialKnowledgeState,
          pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(resumedContext),
          pausedAt: null,
          pauseReason: null,
          pausedDurationMs: Math.max(0, Number(sessionArtifacts.pausedDurationMs || 0)) + additionalPausedMs,
          resumedAt: new Date().toISOString(),
        });

        await teachingSessionRepository.commitTurnState(previousSession.id, claim.operationId, {
          messages: previousSession.messages,
          knowledgeState: resumedKnowledgeState,
          teachingState: resumedTeachingState,
          allowedStatuses: ['active', 'paused', 'timeout']
        });
        committed = true;

        const opening = buildRecoveredOpening(previousSession);
        return {
          sessionId: previousSession.id,
          subject: previousSession.subject,
          topic: previousSession.topic,
          startTime: previousSession.startTime,
          welcomeMessage: previousSession.messages[0]?.content || `${opening.message}\n\n${opening.question}`,
          opening,
          knowledgePoints: normalizeKnowledgePoints(resumedKnowledgeState),
          mode: 'resumed',
          revision: previousSession.revision + 1,
          scene: buildSessionOpeningScene({ mode: 'resumed', context: resumedContext, sameTaskAttempt }),
        };
      } finally {
        if (!committed) {
          await teachingSessionRepository.releaseOperation(claim.session.id, claim.operationId);
        }
      }
    }

    const operationId = reservation.operationId as string;
    try {
      const opening = await this.generateOpening(context);
      const welcomeMessage = `${opening.message}\n\n${opening.question}`;
      const messages: TeachingSessionMessage[] = [
        {
          role: 'assistant',
          content: welcomeMessage,
          timestamp: new Date().toISOString(),
          analysis: {
            openingMode: opening.mode,
            quickReplies: opening.quickReplies,
          }
        }
      ];
      const teachingState = {
        ...(context.learningState || {}),
        learnerStateContext: buildLearnerStateContext(context, null, {
          cognitiveLevel: null,
          understanding: null,
          confusionPoints: [],
          emotionalState: null,
          engagement: null,
        }),
        classroomContext: {
          stage: {
            current: mapOpeningModeToStage(opening.mode),
            goal: '完成本节课切入点定位',
            reason: '新课堂启动，进入开场定位',
          },
          focus: {
            currentKnowledgePoint: null,
            linkedTaskGoal: context.cognitiveFrame.targetRelation,
            latestLearnerMessage: '',
          },
          progress: {
            progressedKnowledgePoints: [],
            pendingKnowledgePoints: [],
            recoveringKnowledgePoints: [],
            initiallyMasteredKnowledgePoints: [],
          },
          risk: {
            confusionPoints: [],
            emotionalState: null,
            engagement: null,
            struggleDetected: false,
            peerSupportActive: false,
          },
          nextStep: {
            suggestedAction: '通过开场交互确认学生切入点',
          },
        },
        classroomEventHistory: [
          buildClassroomEvent('session-started', '课堂已开始，进入开场定位', {
            openingMode: opening.mode,
            taskTitle: context.taskTitle,
          }),
        ],
        stageHistory: [
          {
            stage: mapOpeningModeToStage(opening.mode),
            reason: '新课堂启动，进入开场定位',
            enteredAt: new Date().toISOString(),
          },
        ],
        teachingControlContext: buildTeachingControlContext(
          mapOpeningModeToStage(opening.mode),
          context,
          buildLearnerStateContext(context, null),
          {},
        ),
        sessionArtifacts: {
          initialKnowledgeState: seededKnowledgeState,
          pathBackgroundContext: buildPathBackgroundContext(context),
          endReason: null,
        },
      };
      const session = await teachingSessionRepository.completeInitialization(sessionId, operationId, {
        messages,
        knowledgeState: seededKnowledgeState,
        teachingState
      });

      logger.info('[AITeaching] 新教学会话已创建', {
        sessionId: session.id,
        userId: input.userId,
        taskId: input.taskId,
      });

      return {
        sessionId: session.id,
        subject: session.subject,
        topic: session.topic,
        startTime: session.startTime,
        welcomeMessage,
        opening,
        knowledgePoints: normalizeKnowledgePoints(seededKnowledgeState),
        mode: 'new',
        revision: session.revision,
        scene: buildSessionOpeningScene({
          mode: 'new',
          context,
          sameTaskAttempt,
          ...(input.mode === 'review' ? { review: true } : {}),
        }),
      };
    } catch (error) {
      await teachingSessionRepository.failInitialization(sessionId, operationId);
      throw error;
    }
  }

  private async generateOpening(context: TeachingScenarioContext): Promise<TeachingOpening> {
    const runtimeSignals = deriveTeachingRuntimeSignals(context);
    const openingMode: TeachingOpening['mode'] = context.taskType === 'project'
      || context.taskType === 'practice'
      || runtimeSignals.confidenceLevel === 'anxious'
      ? 'example-first'
      : runtimeSignals.recentTrend === 'improving'
        && runtimeSignals.recommendedPacing !== 'slow'
        ? 'predict'
        : 'self-assess';
    let parsed: any = null;
    try {
      const result = await withTimeoutSignal(
        (signal) => executeSkillWithResult(auxSkillDefinitionMap['teaching-opening-generator'], {
          subject: context.subject,
          topic: context.topic,
          taskTitle: context.taskTitle,
          taskDescription: context.taskDescription,
          taskType: context.taskType,
          pathSummary: context.pathProgress.pathSummary,
          currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
          learner: {
            confidenceLevel: runtimeSignals.confidenceLevel,
            recentTrend: runtimeSignals.recentTrend,
            recommendedPacing: runtimeSignals.recommendedPacing,
          },
          openingMode,
          ...(context.learningSignal ? { learningSignal: context.learningSignal } : {}),
          ...(context.lastLessonRecap ? { lastLessonRecap: context.lastLessonRecap } : {}),
          ...(context.priorLearningContext ? { priorLearningContext: context.priorLearningContext } : {}),
          __prompt: {
            userId: context.userId,
            taskId: context.taskId,
            requestPath: '/services/ai-teaching/generate-opening',
            callerAgentId: AI_TEACHING_AGENT_ID,
          },
        }, { abortSignal: signal }),
        15000,
        'OPENING_GENERATION_TIMEOUT'
      );
      parsed = result.success && result.output ? result.output : null;
    } catch (error) {
      // 开场生成失败：降级为确定性开场兜底，保证开课链路在模型不可用时仍可用。
      logger.warn('[AITeaching] 开场交互块生成失败，降级为确定性开场', {
        error: error instanceof Error ? error.message : String(error),
        userId: context.userId,
        taskId: context.taskId,
        topic: context.topic,
      });
      return buildDeterministicOpening(context);
    }

    if (parsed) {
      return parsed as TeachingOpening;
    }

    logger.warn('[AITeaching] 开场交互块缺少有效结构，降级为确定性开场', {
      userId: context.userId,
      taskId: context.taskId,
      topic: context.topic,
    });
    return buildDeterministicOpening(context);
  }

  async processStudentMessage(
    sessionId: string,
    message: string,
    options: ProcessStudentMessageOptions = {},
  ): Promise<{
    analysis: TeachingTurnOutput['analysis'];
    aiResponse: string;
    strategies: string[];
    knowledgePoint: string | null;
    knowledgePoints: KnowledgePointStatus[];
    isCompletion: boolean;
    currentState: LearningStateMetrics;
    peerTriggered: boolean;
    peerMessage?: string;
    promptDebug?: any;
    peerDebug?: any;
    shouldConfirmEnd?: boolean;
    endReason?: 'completion-candidate' | 'learner-requested-end' | null;
    autoEnded?: boolean;
    recovered?: boolean;
    checkpoint?: TeachingCheckpoint | null;
    wrapup?: SessionWrapupArtifact & {
      stateUpdate: LearningStateMetrics | null;
      duration: number;
      summarySource: 'model' | 'fallback';
      evaluationSource: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
    };
    advisory?: ReplanAdvisory;
    revision: number;
    checkpointResolution?: {
      passed: boolean;
      understanding: number;
    };
  }> {
    const operationClaim = options.operationClaim || await teachingSessionRepository.claimOperation(
      sessionId,
      options.checkpointId ? `checkpoint:${options.checkpointId}` : 'message',
      ['active', 'timeout'],
      requireTeachingRevision(options.expectedRevision)
    );
    let committed = false;

    try {
      const session = operationClaim.session;
      const recovered = session.status === 'timeout';
      if (recovered) {
        logger.info('[AITeaching] 会话超时，本轮提交时自动恢复为活跃状态', { sessionId });
      }

      const submittedCheckpoint = options.checkpointId
        ? getPendingCheckpoint(session.teachingState)
        : null;
      if (options.checkpointId && (!submittedCheckpoint || submittedCheckpoint.id !== options.checkpointId)) {
        throw new Error('理解检查不存在或已处理');
      }

      const context = await buildTeachingScenarioContext(session.userId, session.taskId, session, options.interactionMeta);
      const endIntent = detectEndIntent(message);

    // 恢复续讲回合（resume-continue）：无学生新输入——不落库伪 user 消息，
    // 对话历史/LLM 可见输入保持纯历史，仅靠下方注入的 session-resumed 课堂事件驱动自然接续
    const isResumeContinue = options.kind === 'resume-continue';
    const updatedMessages = isResumeContinue
      ? appendTimestamp([...session.messages])
      : appendTimestamp([
          ...session.messages,
          {
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
            // 检查点合成消息打标记：进入教学上下文供模型分析答案，但不参与学生行为证据统计
            ...(options.checkpointId ? { checkpoint: true } : {}),
            // 前端交互特征（认知负荷量测 · 前端情报层）：随消息落库，供后续轮次对比
            ...(options.interactionMeta && Object.keys(options.interactionMeta).length > 0
              ? { meta: options.interactionMeta as Record<string, number> }
              : {}),
          }
        ]);

    const previousTeachingState = session.teachingState || {};
    const sessionArtifacts = parseSessionArtifacts(previousTeachingState);
    const effectiveInitialKnowledgeState = cloneKnowledgePoints(
      Array.isArray(sessionArtifacts.initialKnowledgeState) && sessionArtifacts.initialKnowledgeState.length > 0
        ? sessionArtifacts.initialKnowledgeState
        : context.taskKnowledgeSeeds
    );
    const frozenKnowledgeState = normalizeFrozenKnowledgeState(
      effectiveInitialKnowledgeState,
      session.knowledgeState,
    );

    const turnInput = await buildTeachingTurnInput({
      ...session,
      messages: updatedMessages,
      knowledgeState: frozenKnowledgeState,
    }, context);
    // 教学回合 wall-clock 超时兜底：LLM 挂起时避免操作租约（30min）被占导致会话内所有操作 409 BUSY；
    // 超时走 releaseOperation + 客户端重试路径（revision 未递增，重试安全）。
    // 阈值对齐 platform_settings.aiReliability.defaultRequestTimeoutMs（300s）：
    // 旧值 90s 会误杀正常回合——教学回合含 2 次 LLM 调用（模拟器 + teaching-turn），上游慢时单次即可超 90s。
    const turnResult = await withTimeout(
      executeSkill(teachingTurnAgentDefinition, turnInput, {
        contextEnvelope: {
          schemaVersion: 'context-envelope/v1',
          principal: { userId: session.userId },
          session: { sessionId: session.id, taskId: session.taskId },
        },
      }),
      300_000,
      'TEACHING_TURN_TIMEOUT: 教学回合执行超过 300 秒'
    );
    if (!turnResult.success) {
      throw new Error(typeof turnResult.error === 'string' ? turnResult.error : turnResult.error?.message || 'TEACHING_TURN_FAILED');
    }

    const turnRuntimeEnvelope = turnResult?.runtimeEnvelope || null;
    const rawTeachingOutput = extractTeachingOutput(turnResult);
    const promptDebug = extractTeachingPromptDebug(turnResult);
    const { teachingOutput, existingPoints } = reconcileTeachingKnowledgeState(context, rawTeachingOutput, frozenKnowledgeState);
    const mergedKnowledge = normalizeFrozenKnowledgeState(
      effectiveInitialKnowledgeState,
      knowledgeStateService.merge(
        existingPoints,
        teachingOutput.knowledge.points,
        session.mode === 'review' // 复习课允许 mastered 降级：复习失败在掌握度数据上真实可见
      )
    );
    // 知识完成度仍是 completion 的唯一硬门禁；envelope phase 仅作观测 soft 信号
    const completionReady = isKnowledgeStateComplete(mergedKnowledge);
    const envelopeCompletionSignal =
      turnRuntimeEnvelope?.businessState?.phase === 'completion-candidate'
      || turnRuntimeEnvelope?.businessState?.isTerminal === true;
    // soft-AND：双方都同意完成时记 alignment=agree；仅 envelope 喊完成时 disagree（不改变硬门禁）
    const completionAlignment: 'agree' | 'envelope-only' | 'knowledge-only' | 'neither' =
      completionReady && envelopeCompletionSignal
        ? 'agree'
        : !completionReady && envelopeCompletionSignal
          ? 'envelope-only'
          : completionReady && !envelopeCompletionSignal
            ? 'knowledge-only'
            : 'neither';
    if (completionAlignment === 'envelope-only' || completionAlignment === 'knowledge-only') {
      logger.debug('[AITeaching] completion soft-AND 分歧', {
        sessionId: session.id,
        completionAlignment,
        knowledgeComplete: completionReady,
        envelopePhase: turnRuntimeEnvelope?.businessState?.phase || null,
        envelopeTerminal: turnRuntimeEnvelope?.businessState?.isTerminal === true,
      });
    }
    const effectiveTeachingOutput: TeachingTurnOutput = {
      ...teachingOutput,
      control: {
        ...teachingOutput.control,
        isCompletionCandidate: completionReady,
      },
    };
    const previousClassroomStage = (previousTeachingState.classroomContext?.stage?.current as LearnStage) || 'opening';
    // 恢复续讲首回合不触发伴学（无学生新输入，伴学模拟"同学插话"无意义）
    const peerTriggered = !isResumeContinue && peerTriggerService.shouldTrigger(session, teachingOutput, message);
    // 恢复续讲无学生输入：后续所有 learnerMessage 语义统一为空，避免 teaching-turn 把伪输入当本轮反馈
    const effectiveLearnerMessage = isResumeContinue ? '' : message;
    let peerMessage: string | undefined;
    let peerStrategy: string | null = null;
    let peerFollowUpQuestions: string[] = [];
    let peerDebug: any = null;
    let peerRuntimeEnvelope: any = null;

    if (peerTriggered) {
      const peerInput = {
        topic: session.topic,
        strategy: 'feynman' as const,
        studentMessage: message,
        tutorContext: updatedMessages.slice(-6).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        cognitiveLevel: teachingOutput.analysis.cognitiveLevel,
        understanding: teachingOutput.analysis.understanding,
      };
      try {
        const peerResult = await executeSkill(peerAgentDefinition, {
          input: peerInput,
          context: {
            userId: session.userId,
            sessionId: session.id,
          },
        }, {
          contextEnvelope: {
            schemaVersion: 'context-envelope/v1',
            principal: { userId: session.userId },
            session: { sessionId: session.id, taskId: session.taskId },
          },
        });
        peerMessage = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
        // 伴学策略与后续追问一并透传（供前端展示「正在用什么学法」与快选追问）
        const peerExt = peerResult.internal?.ext?.peer || null;
        peerStrategy = peerExt?.strategy || null;
        peerFollowUpQuestions = Array.isArray(peerExt?.followUpQuestions)
          ? peerExt.followUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim())
          : [];
        peerDebug = extractPeerDebug(peerResult);
        peerRuntimeEnvelope = peerResult?.runtimeEnvelope
          || peerResult?.internal?.ext?.peer?.runtimeEnvelope
          || null;
      } catch (e: any) {
        logger.warn('[AITeachingCoordinator] peer-reinforcement 失败', { error: e?.message || String(e) });
      }
    }

    const nextStageDecision = determineNextStage({
      currentStage: previousClassroomStage,
      teachingOutput: effectiveTeachingOutput,
      peerTriggered,
      learnerMessage: effectiveLearnerMessage,
      taskMode: context.taskMode,
      frustratedStreak: previousTeachingState?.learnerStateContext?.frustratedStreak ?? 0,
    });
    const learnerStateContext = buildLearnerStateContext(context, previousTeachingState, {
      ...teachingOutput.analysis,
      struggleDetected: nextStageDecision.stage === 'intervention',
    });
    learnerStateContext.struggleDetected = nextStageDecision.stage === 'intervention';

    const classroomContext = buildClassroomContext({
      previousState: previousTeachingState,
      stage: nextStageDecision.stage,
      stageReason: nextStageDecision.reason,
      teachingOutput: effectiveTeachingOutput,
      learnerMessage: effectiveLearnerMessage,
      context,
      knowledgeState: mergedKnowledge,
      learnerStateContext,
      peerTriggered,
      peerMessage,
    });

    const classroomEvents = Array.isArray(previousTeachingState.classroomEventHistory)
      ? [...previousTeachingState.classroomEventHistory]
      : [];

    classroomEvents.push(buildClassroomEvent('teaching-turn', nextStageDecision.reason, {
      stage: nextStageDecision.stage,
      focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
      learnerMessage: effectiveLearnerMessage,
      confusionPoints: learnerStateContext.currentConfusionPoints || [],
      peerTriggered,
      endIntent: endIntent.isEndIntent,
    }));

    if (endIntent.isEndIntent) {
      classroomEvents.push(buildClassroomEvent('end-intent', endIntent.reason, {
        learnerMessage: effectiveLearnerMessage,
      }));
    }

    if (peerTriggered) {
      classroomEvents.push(buildClassroomEvent('peer-support', '本轮触发伴学支持', {
        peerMessage: peerMessage || null,
      }));
    }

    if (completionReady) {
      classroomEvents.push(buildClassroomEvent('completion-candidate', '本轮出现课堂完成候选信号', {
        focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
      }));
    }

    // 恢复续讲信号：teaching-turn 看到该事件即知本轮无学生新输入，需自然接续上一轮推进
    if (isResumeContinue) {
      classroomEvents.push(buildClassroomEvent('session-resumed', '学生刚刚恢复本课堂会话，无新输入', {
        instruction: '自然地接续上一轮的教学推进：先一句话承接上次进度，再继续当前焦点知识点。不要询问"你想做什么/从哪继续"，不要重新自我介绍或重复开场。',
      }));
    }

    const stageHistory = Array.isArray(previousTeachingState.stageHistory)
      ? [...previousTeachingState.stageHistory]
      : [];
    const lastStage = stageHistory[stageHistory.length - 1];
    if (!lastStage || lastStage.stage !== nextStageDecision.stage) {
      stageHistory.push({
        stage: nextStageDecision.stage,
        reason: nextStageDecision.reason,
        enteredAt: new Date().toISOString(),
      });
    }

    const teachingControlContext = buildTeachingControlContext(
      nextStageDecision.stage,
      context,
      learnerStateContext,
      {
        ...sessionArtifacts,
        endReason: endIntent.isEndIntent
          ? 'learner-requested-end'
          : completionReady
            ? 'completion-candidate'
            : sessionArtifacts.endReason,
      },
    );

    const learnDebug = {
      input: {
        pathBackgroundContext: buildPathBackgroundContext(context),
        classroomContext,
        learnerStateContext,
        classroomEventContext: {
          recentEvents: classroomEvents.slice(-5),
        },
        visibleDialogueContext: session.messages.map((item) => ({
          role: item.role,
          content: item.content,
        })).concat(isResumeContinue ? [] : [{ role: 'user', content: message }]),
        teachingControlContext,
      },
      output: {
        stageDecision: nextStageDecision,
        classroomContext,
        learnerStateContext,
        knowledgeState: normalizeKnowledgePoints(mergedKnowledge),
        auxiliaryActions: {
          peerTriggered,
          completionCandidate: completionReady,
          autoEndRequested: endIntent.isEndIntent,
        },
        completionCandidateEvidence: teachingOutput.control.completionCandidateEvidence || null,
      },
    };

    if (promptDebug && typeof promptDebug === 'object') {
      promptDebug.learnDebug = learnDebug;
    }

    const assistantMessage: TeachingSessionMessage = {
      role: 'assistant',
      content: teachingOutput.reply,
      timestamp: new Date().toISOString(),
      analysis: teachingOutput.analysis,
      strategies: teachingOutput.pedagogy.strategies,
      knowledgePoint: teachingOutput.knowledge.currentPoint,
      knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
      promptDebug,
      peerTriggered,
      peerMessage: peerMessage || null,
      peerStrategy,
      peerFollowUpQuestions,
      peerDebug,
    };

    if (!completionReady && hasPrematureNextStepLanguage(assistantMessage.content)) {
      logger.warn('[AITeaching] 教学回复越界，尚未满足结束条件却提到下一环节', {
        sessionId,
        taskId: session.taskId,
        reply: assistantMessage.content,
      });
    }

    const persistedMessages = [...updatedMessages, assistantMessage];
    const previousMetrics = extractTeachingStateMetrics(previousTeachingState)
      || learningStateService.coerceMetrics(context.learningState)
      || null;
    
    // 将扩展的 taskType 映射到基础的 4 种类型
    const normalizedTaskType = normalizeTaskTypeForMetrics(context.taskType);
    
    const currentState = learningStateService.calculateRuntimeState(previousMetrics, {
      difficulty: Math.max(1, Math.min(10, teachingOutput.analysis.levelScore + 2)),
      cognitiveLoad: Math.max(1, Math.min(10, (1 - teachingOutput.analysis.understanding + 0.3) * 8)),
      efficiency: teachingOutput.analysis.engagement,
      timeSpent: 1,
      expectedTime: 15,
      completionRate: 1,
      taskType: normalizedTaskType,
    });

      const teachingState: Record<string, any> = {
      ...currentState,
      analysis: effectiveTeachingOutput.analysis,
      strategies: effectiveTeachingOutput.pedagogy.strategies,
      completionCandidate: completionReady,
      peerTriggered,
      learnerStateContext,
      classroomContext,
      classroomEventHistory: classroomEvents.slice(-40),
      stageHistory,
      teachingControlContext,
      lastRuntimeEnvelope: turnRuntimeEnvelope,
      lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
      envelopeCompletionSignal: !!envelopeCompletionSignal,
      completionAlignment,
      lastPeerRuntimeEnvelope: peerRuntimeEnvelope,
      sessionArtifacts: {
        ...parseSessionArtifacts(session.teachingState),
        initialKnowledgeState: effectiveInitialKnowledgeState,
        pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(context),
        endReason: endIntent.isEndIntent
          ? 'learner-requested-end'
          : completionReady
            ? 'completion-candidate'
            : parseSessionArtifacts(session.teachingState).endReason,
      },
      };

      // 检查点产生：teaching-turn 可选输出 control.checkpoint，按规则落库为 pendingCheckpoint
      const checkpointCandidate = teachingOutput.control.checkpoint;
      if (
        !submittedCheckpoint
        && !completionReady
        && !endIntent.isEndIntent
        && checkpointCandidate
        && !previousTeachingState.pendingCheckpoint
        && (previousTeachingState.lastCheckpointTurn === undefined
          || updatedMessages.length - previousTeachingState.lastCheckpointTurn >= 4)
      ) {
        const checkpointTitle = checkpointCandidate.question.length > 20
          ? `${checkpointCandidate.question.slice(0, 20)}…`
          : checkpointCandidate.question;
        teachingState.pendingCheckpoint = {
          id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: checkpointCandidate.type,
          title: checkpointTitle,
          question: checkpointCandidate.question,
          ...(checkpointCandidate.options ? { options: checkpointCandidate.options } : {}),
          allowSkip: true,
          ...(checkpointCandidate.hint ? { contextHint: checkpointCandidate.hint } : {}),
        };
        teachingState.lastCheckpointTurn = updatedMessages.length;
      }

      let checkpointResolution: { passed: boolean; understanding: number } | undefined;
      if (submittedCheckpoint) {
        const understanding = Number(teachingOutput.analysis?.understanding ?? 0);
        const currentPoint = effectiveTeachingOutput.knowledge.currentPoint?.trim().toLowerCase();
        const passed = completionReady || !!currentPoint && mergedKnowledge.some(
          (point) => point.name.trim().toLowerCase() === currentPoint && point.status === 'mastered'
        );
        const checkpointHistory = Array.isArray(teachingState.checkpointHistory)
          ? [...teachingState.checkpointHistory]
          : [];
        checkpointHistory.push({
          checkpointId: submittedCheckpoint.id,
          submittedAt: new Date().toISOString(),
          passed,
          understanding,
        });

        // 仅答对时消费检查点；答错保留 pendingCheckpoint（同一 cpId 可重答，
        // 前端答错反馈后再次提交不会落入「理解检查不存在或已处理」）
        if (passed) {
          delete teachingState.pendingCheckpoint;
          const nextSessionArtifacts = { ...parseSessionArtifacts(teachingState) };
          delete nextSessionArtifacts.pendingCheckpoint;
          teachingState.sessionArtifacts = nextSessionArtifacts;
        }
        teachingState.checkpointHistory = checkpointHistory.slice(-20);
        checkpointResolution = { passed, understanding };
      }

      await teachingSessionRepository.commitTurnState(sessionId, operationClaim.operationId, {
        messages: persistedMessages,
        knowledgeState: mergedKnowledge,
        teachingState,
        taskId: session.taskId,
        userId: session.userId,
        markTaskInProgress: true,
      });
      committed = true;

      // 误解台账（G-R-R Phase 2）：异步记录本轮结构化误解，best-effort 不阻断回合
      const misconceptions = teachingOutput.analysis?.misconceptions;
      if (Array.isArray(misconceptions) && misconceptions.length > 0) {
        void recordMisconceptions(session.userId, sessionId, misconceptions.map((m) => ({
          conceptKey: m.conceptKey || '',
          hypothesis: m.hypothesis,
          canonicalLabel: m.canonicalLabel ?? null,
          confidence: m.confidence,
          evidence: m.evidence,
          status: m.status,
        })).filter((m) => m.conceptKey && m.hypothesis));
      }

      // θ−d EMA：ktEstimate 跨会话滑动平均（α=0.2），best-effort 不阻断回合
      const ktConceptMastery = teachingOutput.analysis?.ktEstimate?.conceptMastery;
      if (Array.isArray(ktConceptMastery) && ktConceptMastery.length > 0) {
        void memoryTraceService.applyKtEstimate(session.userId, ktConceptMastery.map((c) => ({
          conceptKey: c.conceptKey,
          mastery: c.mastery,
        }))).catch((error) => {
          logger.warn('[AITeachingCoordinator] ktEstimate EMA 回写失败', { error: error instanceof Error ? error.message : String(error) });
        });
      }

      const baseResult = {
      analysis: teachingOutput.analysis,
      aiResponse: teachingOutput.reply,
      strategies: effectiveTeachingOutput.pedagogy.strategies,
      knowledgePoint: effectiveTeachingOutput.knowledge.currentPoint,
      ...(effectiveTeachingOutput.knowledge.confirmCheck
        ? { confirmCheck: effectiveTeachingOutput.knowledge.confirmCheck }
        : {}),
      knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
      isCompletion: completionReady,
      currentState,
      peerTriggered,
      peerMessage,
      peerStrategy,
      peerFollowUpQuestions,
      promptDebug,
      peerDebug,
      // 统一运行契约观测（不改变 isCompletion 硬门禁）
      runtimeEnvelope: turnRuntimeEnvelope,
      completionAlignment,
      envelopeCompletionSignal: !!envelopeCompletionSignal,
      lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
      shouldConfirmEnd: completionReady || endIntent.isEndIntent,
      endReason: endIntent.isEndIntent
        ? 'learner-requested-end' as const
        : completionReady
          ? 'completion-candidate' as const
          : null,
      recovered,
        checkpoint: getPendingCheckpoint(teachingState),
        checkpointResolution,
        revision: session.revision + 1,
      };

      return baseResult;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  async endSession(
    sessionId: string,
    endReason = 'manual-end',
    expectedRevision?: number,
    requestedOperationId: string = randomUUID(),
    requestedRequestHash?: string,
    requestedRequestJson?: string
  ): Promise<{
    status: 'completed' | 'processing';
    operationId: string;
    wrapup?: SessionWrapupArtifact & {
      stateUpdate: LearningStateMetrics | null;
      duration: number;
      summarySource: 'model' | 'fallback';
      evaluationSource: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
    };
    advisory?: ReplanAdvisory;
    revision: number;
  }> {
    const fallbackIdentity = buildEndSessionRequestIdentity(endReason);
    const requestHash = requestedRequestHash || fallbackIdentity.requestHash;
    const requestJson = requestedRequestJson || fallbackIdentity.requestJson;
    const finalization = await teachingSessionRepository.claimFinalization(
      sessionId,
      'end_only',
      requestedOperationId,
      requestHash,
      requestJson,
      requireTeachingRevision(expectedRevision)
    );
    if (finalization.status === 'completed') {
      return {
        status: 'completed',
        operationId: finalization.operationId,
        wrapup: finalization.session.wrapup as any,
        advisory: finalization.session.advisory as ReplanAdvisory,
        revision: finalization.session.revision,
      };
    }
    if (finalization.status === 'processing') {
      return {
        status: 'processing',
        operationId: finalization.operationId,
        revision: finalization.session.revision
      };
    }
    const { session, operationId, leaseOwner } = finalization;
    const leaseGuard = new FinalizationLeaseGuard(sessionId, operationId, leaseOwner);
    leaseGuard.start();
    try {
    const durationMinutes = computeEffectiveDurationMinutes(session);
    const sessionArtifacts = {
      ...parseSessionArtifacts(session.teachingState),
      endReason,
    };
    const classroomEventHistory = Array.isArray(session.teachingState?.classroomEventHistory)
      ? session.teachingState?.classroomEventHistory
      : [];
    const finalClassroomContext = session.teachingState?.classroomContext || null;
    const stageHistory = Array.isArray(session.teachingState?.stageHistory)
      ? session.teachingState?.stageHistory
      : [];
    const initialKnowledgeState = Array.isArray(sessionArtifacts.initialKnowledgeState)
      ? sessionArtifacts.initialKnowledgeState
      : [];
    const knowledgeDelta = computeKnowledgeDelta(initialKnowledgeState, session.knowledgeState);
    const sessionEvidence = computeSessionEvidence(session);
    const context = await buildTeachingScenarioContext(session.userId, session.taskId, session);
    const reviewHints = await this.loadRetrievabilityHints(session.userId);

    let wrapupOutput: any = null;
    try {
      wrapupOutput = await executeSkill(sessionWrapupAgentDefinition, {
      input: {
        messages: session.messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: new Date(message.timestamp),
          analysis: message.analysis,
        })),
        knowledgePoints: session.knowledgeState,
        sessionInfo: {
          subject: session.subject,
          topic: session.topic,
          durationMinutes,
          userMessageCount: session.messages.filter((message) => message.role === 'user').length,
          assistantMessageCount: session.messages.filter((message) => message.role === 'assistant').length,
          taskType: session.taskType,
          taskTitle: context.taskTitle,
          taskDescription: context.taskDescription,
          pathTitle: context.pathContext.pathTitle || null,
          pathSummary: context.pathContext.pathSummary || null,
        },
        learningState: context.learningState ? {
          ...context.learningState,
          ...deriveTeachingRuntimeSignals(context),
        } : undefined,
        knowledgeContext: {
          initialPoints: initialKnowledgeState,
          delta: knowledgeDelta,
          reviewHints,
        },
        sessionEvidence,
        sessionStructure: {
          pathBackground: sessionArtifacts.pathBackgroundContext || null,
          finalClassroomContext,
          classroomEventHistory,
          stageHistory,
          endReason: sessionArtifacts.endReason || endReason,
        },
      },
      context: {
        userId: session.userId,
        sessionId,
      },
    }, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        session: { sessionId: session.id, taskId: session.taskId },
      },
    });
    } catch (error) {
      logger.warn('[AITeaching] 课后产出生成异常，改用 summary-only 兜底继续收束', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // M1 兜底：executeSkill 抛错或返回 success:false（internal.ext.sessionWrapup 缺失）时，
    // 用 summary-only 对象顶替，保证收束流程继续，避免整次收束失败为 finalization_failed。
    const endWrapupFallback = buildEndWrapupFallback(session, durationMinutes);
    const sessionWrapupExt = wrapupOutput?.internal?.ext?.sessionWrapup;
    const wrapupResult = sessionWrapupExt?.result || endWrapupFallback.result;
    const wrapupArtifact = sessionWrapupExt?.artifact || endWrapupFallback.artifact;
    const wrapupRuntimeEnvelope = wrapupOutput?.runtimeEnvelope
      || wrapupResult?.runtimeEnvelope
      || null;

    const evaluationResult = hasReliableSessionEvaluation(
      wrapupResult.evaluation,
      wrapupResult.evaluationSource
    )
      ? {
          source: wrapupResult.evaluationSource,
          evaluation: wrapupResult.evaluation!,
        }
      : null;

    const lastAnalyzedMessage = [...session.messages].reverse().find((message) => !!message.analysis);
    const scoreInput = evaluationResult ? {
      sessionLss: evaluationResult.evaluation.sessionLss,
      sessionKtl: evaluationResult.evaluation.sessionKtl,
      sessionLf: evaluationResult.evaluation.sessionLf,
      durationMinutes,
      confidence: evaluationResult.evaluation.confidence,
      pathId: session.learningPathId || null,
      taskId: session.taskId,
      sessionId,
    } : null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const metricCommit = scoreInput
        ? await learningStateService.prepareSessionScoreCommit(session.userId, scoreInput)
        : null;
      const finalState = metricCommit?.metrics || null;
      const persistedEvaluation = {
        ...(evaluationResult ? evaluationResult.evaluation : {}),
        lss: finalState?.lss ?? 0,
        ktl: finalState?.ktl ?? 0,
        lf: finalState?.lf ?? 0,
        lsb: finalState?.lsb ?? 0,
        evaluationSource: (evaluationResult?.source || 'unavailable') as 'model' | 'ai-fallback' | 'failed' | 'unavailable',
        messageCount: session.messages.filter((message) => message.role === 'user').length,
        avgUnderstanding: sessionEvidence.avgUnderstanding ?? 0,
        avgCognitiveLevel: lastAnalyzedMessage?.analysis?.cognitiveLevel || 'understand',
        duration: durationMinutes,
      };
      const persistedWrapup = {
        ...wrapupArtifact,
        duration: durationMinutes,
        stateUpdate: finalState,
        summarySource: wrapupResult.summarySource,
        evaluationSource: wrapupResult.evaluationSource,
        runtimeEnvelope: wrapupRuntimeEnvelope,
      };
      const snapshotInput = {
        userId: session.userId,
        learningPathId: session.learningPathId || undefined,
        milestoneId: session.milestoneId || undefined,
        taskId: session.taskId,
        mode: 'teaching' as const,
      };
      const learnerSnapshot = finalState
        ? await learnerSnapshotService.previewSnapshotFromMetrics({
            ...snapshotInput,
            metrics: finalState,
            generatedAt: finalState.timestamp,
          })
        : await learnerSnapshotService.getSnapshot(snapshotInput);
      const learnerReplanProjection = learnerProjectionService.toReplanProjection(learnerSnapshot);
      const currentPath = learnerSnapshot.knowledgeMemory.currentPath;
      const currentStageNumber = currentPath?.currentPosition.stageNumber || 1;
      const nextMilestone = currentPath?.milestoneProgress.find((item) => item.stageNumber === currentStageNumber + 1) || null;
      const advisory = replanAdvisoryService.build({
        wrapup: persistedWrapup,
        learnerReplanProjection,
        nextMilestone: nextMilestone ? {
          milestoneId: nextMilestone.milestoneId,
          title: nextMilestone.title,
          goal: nextMilestone.goal,
          totalTasks: nextMilestone.totalTasks,
        } : null,
      });
      const finalWrapup = {
        ...persistedWrapup,
        learner: {
          recentTrend: learnerSnapshot.dynamicState.recentTrend,
          fatigueRisk: learnerSnapshot.dynamicState.fatigueRisk,
          recommendedPacing: learnerSnapshot.dynamicState.recommendedPacing,
        },
      };
      const lessonEvent = createDomainEvent({
        id: `evt_lesson_completed_${session.id}`,
        type: 'lesson:completed',
        aggregateType: 'lesson',
        aggregateId: session.id,
        userId: session.userId,
        source: AI_TEACHING_AGENT_ID,
        data: {
          lessonId: session.id,
          sessionId: session.id,
          taskId: session.taskId,
          pathId: session.learningPathId,
          milestoneId: session.milestoneId,
          duration: durationMinutes,
          // 断链修复 P0-5：任务的可迁移目标（task.transferable 派生），供课后知识增强
          // （lesson-knowledge-enricher）判断"迁移意图是否达成"，闭环 transferGoal 信号
          transferGoal: context?.cognitiveFrame?.transferGoal || null,
          performance: evaluationResult ? persistedEvaluation : null,
          knowledgeState: session.knowledgeState,
          visibleDialogueContext: session.messages.slice(-16).map((message) => ({
            role: message.role,
            content: message.content,
            analysis: message.analysis || null,
          })),
          classroomEventHistory,
          wrapup: finalWrapup,
          advisory
        }
      });

      await commitSessionLoadMetric(session).catch((error) => {
        logger.warn('[AITeaching] session_load 指标写入失败（不影响收束）', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      try {
        await leaseGuard.assertOwned();
        await teachingSessionRepository.completeWithEvent(sessionId, operationId, leaseOwner, {
          messages: session.messages,
          knowledgeState: session.knowledgeState,
          teachingState: mergeFinalTeachingState(session.teachingState, finalState, sessionArtifacts),
          wrapup: finalWrapup,
          advisory,
          duration: durationMinutes
        }, lessonEvent, metricCommit ? {
          userId: metricCommit.userId,
          expectedRevision: metricCommit.expectedRevision,
          sourceKey: metricCommit.sourceKey,
          data: metricCommit.data,
        } : null);
      } catch (error) {
        if (
          error instanceof TeachingSessionConflictError
          && error.code === 'TEACHING_LEARNING_STATE_STALE'
          && attempt < 4
        ) {
          continue;
        }
        throw error;
      }

      dashboardGuidanceSnapshotService.refreshInBackground(session.userId, 'lesson-wrapup');
      // 记忆引擎 M2：课后按知识看板状态确定性回写内化强度（best-effort，失败不阻断课堂完成）
      const calibrationBias = learnerSnapshot?.profile?.cognitive?.selfAssessmentAccuracy ?? 'accurate';
      memoryTraceService.recordSessionOutcome(session.userId, session.knowledgeState, 'derived', calibrationBias).catch((error) => {
        logger.warn('[AITeaching] 记忆痕迹回写失败', {
          sessionId,
          userId: session.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return {
        status: 'completed',
        operationId,
        wrapup: finalWrapup,
        advisory,
        revision: session.revision + 1,
      };
    }

    throw new TeachingSessionConflictError('学习状态持续变化，请稍后重试', 'TEACHING_LEARNING_STATE_STALE');
    } catch (error) {
      const info = classifyFinalizationError(error);
      try {
        await teachingSessionRepository.failFinalization(
          sessionId,
          operationId,
          leaseOwner,
          'end_only',
          info.code === 'FINALIZATION_PERSISTENCE_FAILED' ? 'SESSION_FINALIZATION_FAILED' : info.code,
          info.retryable
        );
      } catch (markError) {
        logger.error('[AITeaching] 课堂结束失败状态持久化失败', {
          sessionId,
          operationId,
          error: markError instanceof Error ? markError.message : String(markError)
        });
      }
      throw error;
    } finally {
      await leaseGuard.stop();
    }
  }

  async getSessionHistory(userId: string): Promise<Array<{
    id: string;
    subject: string;
    topic: string;
    taskId: string | null;
    startTime: Date;
    endTime: Date | null;
    duration: number | null;
    status: string;
    messageCount: number;
  }>> {
    const sessions = await teachingSessionRepository.listByUser(userId);
    return sessions.map((session) => ({
      id: session.id,
      subject: session.subject,
      topic: session.topic,
      taskId: session.taskId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      status: session.status,
      messageCount: session.messages.length,
    }));
  }

  async getSessionDetail(sessionId: string, userId: string): Promise<{
    id: string;
    subject: string;
    topic: string;
    taskId: string | null;
    startTime: Date;
    endTime: Date | null;
    duration: number | null;
    status: string;
    messages: Array<{ role: string; content: string; timestamp: string; analysis?: any }>;
    state: any;
    knowledgePoints?: any[];
    wrapup?: any | null;
    advisory?: ReplanAdvisory | null;
    pendingCheckpoint?: TeachingCheckpoint | null;
    revision: number;
  } | null> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }

    return {
      id: session.id,
      subject: session.subject,
      topic: session.topic,
      taskId: session.taskId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      status: session.status,
      messages: session.messages,
      state: session.teachingState || {},
      knowledgePoints: session.knowledgeState,
      wrapup: session.wrapup,
      advisory: (session.advisory as ReplanAdvisory | null) || null,
      pendingCheckpoint: getPendingCheckpoint(session.teachingState),
      revision: session.revision,
    };
  }

  async submitCheckpoint(
    sessionId: string,
    checkpointId: string,
    payload: CheckpointSubmitPayload,
    expectedRevision?: number,
  ): Promise<CheckpointSubmitResult> {
    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      `checkpoint:${checkpointId}`,
      ['active', 'timeout'],
      requireTeachingRevision(expectedRevision)
    );
    const session = operationClaim.session;

    const checkpoint = getPendingCheckpoint(session.teachingState);
    if (!checkpoint || checkpoint.id !== checkpointId) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      throw new Error('理解检查不存在或已处理');
    }

    try {
      // 跳过检查点：清除待处理检查点（记录历史，允许后续生成新检查点），不触发教学回合
      if (payload?.skip === true) {
        const teachingState: Record<string, any> = { ...(session.teachingState || {}) };
        delete teachingState.pendingCheckpoint;
        const nextArtifacts = { ...parseSessionArtifacts(teachingState) };
        delete nextArtifacts.pendingCheckpoint;
        teachingState.sessionArtifacts = nextArtifacts;
        const history = Array.isArray(teachingState.checkpointHistory)
          ? [...teachingState.checkpointHistory]
          : [];
        history.push({
          checkpointId,
          submittedAt: new Date().toISOString(),
          passed: false,
          skipped: true,
        });
        teachingState.checkpointHistory = history.slice(-20);
        await teachingSessionRepository.commitTurnState(sessionId, operationClaim.operationId, {
          messages: session.messages,
          knowledgeState: session.knowledgeState,
          teachingState,
          taskId: session.taskId,
          userId: session.userId,
        });
        return {
          passed: false,
          feedback: '已跳过这个检查点，我们继续。',
          nextAction: 'continue',
          revision: (operationClaim.session.revision ?? 0) + 1,
        };
      }

      let answer: string;
      if (checkpoint.type === 'short_answer') {
        answer = payload.answerText?.trim() || '';
        if (!answer) {
          throw new Error('缺少作答内容');
        }
      } else {
        const selectedOptionIds = Array.from(new Set(payload.selectedOptionIds || []));
        const options = Array.isArray(checkpoint.options) ? checkpoint.options : [];
        const selectedOptions = selectedOptionIds.map((optionId) => options.find((option) => option.id === optionId));
        if (selectedOptions.length === 0 || selectedOptions.some((option) => !option)) {
          throw new Error('提交的选项无效');
        }
        if (checkpoint.type === 'single_choice' && selectedOptions.length !== 1) {
          throw new Error('单选题只能提交一个选项');
        }
        answer = selectedOptions.map((option) => `${option!.id}. ${option!.text}`).join('；');
      }

      const turn = await this.processStudentMessage(
        sessionId,
        `理解检查：${checkpoint.question}\n我的答案：${answer}`,
        { operationClaim, checkpointId }
      );
      const passed = turn.checkpointResolution?.passed === true;
      const hint = !passed && turn.analysis?.confusionPoints?.length
        ? `建议先回顾：${turn.analysis.confusionPoints.join('、')}`
        : undefined;
      return {
        passed,
        feedback: turn.aiResponse,
        ...(hint ? { hint } : {}),
        nextAction: passed ? 'continue' : 'review',
        revision: turn.revision,
      };
    } catch (error) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      throw error;
    }
  }

  async pauseSession(
    sessionId: string,
    userId: string,
    reason: 'manual' | 'pagehide' | 'hidden' = 'manual',
    expectedRevision?: number
  ): Promise<number> {
    requireTeachingRevision(expectedRevision);
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (['completed', 'discarded', 'superseded'].includes(session.status)) {
      throw new Error('已结束的会话无法暂停');
    }

    const sessionArtifacts = parseSessionArtifacts(session.teachingState);
    if (session.status === 'paused' && sessionArtifacts.pausedAt) {
      return session.revision;
    }

    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      `pause:${reason}`,
      ['active', 'timeout'],
      expectedRevision
    );
    let committed = false;
    try {
      const currentArtifacts = parseSessionArtifacts(operationClaim.session.teachingState);
      await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
        status: 'paused',
        endTime: null,
        duration: null,
        teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
          ...currentArtifacts,
          pausedAt: new Date().toISOString(),
          pauseReason: reason,
        }),
      });
      committed = true;
      return operationClaim.session.revision + 1;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  /**
   * 恢复暂停的授课会话：把暂停时长累加进 pausedDurationMs，状态回到 active。
   * 用于页面切回标签页/窗口恢复可见时，避免把切走的时间计入学习时长。
   */
  async resumeSession(
    sessionId: string,
    userId: string,
    expectedRevision?: number
  ): Promise<number> {
    requireTeachingRevision(expectedRevision);
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (session.status !== 'paused') {
      return session.revision;
    }

    const sessionArtifacts = parseSessionArtifacts(session.teachingState);
    const wasPausedAt = typeof sessionArtifacts.pausedAt === 'string'
      ? new Date(sessionArtifacts.pausedAt).getTime()
      : null;
    if (!wasPausedAt || Number.isNaN(wasPausedAt)) {
      return session.revision;
    }
    const pausedDurationMs = Math.max(0, Date.now() - wasPausedAt)
      + Math.max(0, Number(sessionArtifacts.pausedDurationMs || 0));

    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      'resume',
      ['paused'],
      expectedRevision
    );
    let committed = false;
    try {
      await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
        status: 'active',
        endTime: null,
        duration: null,
        teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
          ...sessionArtifacts,
          pausedAt: null,
          pauseReason: null,
          pausedDurationMs,
          resumedAt: new Date().toISOString(),
        }),
      });
      committed = true;
      return operationClaim.session.revision + 1;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  async resetSession(sessionId: string, userId: string, expectedRevision?: number): Promise<number> {
    requireTeachingRevision(expectedRevision);
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (session.status === 'discarded') {
      return session.revision;
    }
    if (['completed', 'superseded'].includes(session.status)) {
      throw new Error('已结束的会话无法重置');
    }

    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      'reset',
      ['active', 'paused', 'timeout'],
      expectedRevision
    );
    let committed = false;
    try {
      await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
        status: 'discarded',
        endTime: new Date(),
        duration: computeEffectiveDurationMinutes(operationClaim.session),
        clearOpenKey: true,
        teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
          ...parseSessionArtifacts(operationClaim.session.teachingState),
          resetAt: new Date().toISOString(),
        }),
      });
      committed = true;
      return operationClaim.session.revision + 1;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  /**
   * 记忆保持率提示（retrievability 学生端可视化）：查该用户低保持率的记忆点，注入 wrapup 供叙事引用。
   * 数值由 FSRS 公式确定性计算（零 LLM），wrapup 只做自然语言引用，禁止编造。
   */
  private async loadRetrievabilityHints(userId: string): Promise<Array<{ concept: string; retrievability: number }>> {
    try {
      const traces = await prisma.memory_traces.findMany({
        where: { userId, fsrsStability: { not: null }, lastSeenAt: { not: null } },
        orderBy: { dueAt: 'asc' },
        take: 20,
        select: {
          label: true,
          conceptKey: true,
          fsrsStability: true,
          fsrsDifficulty: true,
          extractionCount: true,
          lastSeenAt: true,
        },
      });
      const now = new Date();
      return traces
        .map((t) => {
          const state: FsrsMemoryState = {
            stability: t.fsrsStability as number,
            difficulty: t.fsrsDifficulty ?? 5,
            reps: t.extractionCount,
            lapses: 0,
            lastReviewAt: t.lastSeenAt as Date,
          };
          return {
            concept: t.label || t.conceptKey,
            retrievability: Math.round(fsrsRetrievability(state, now) * 100) / 100,
          };
        })
        .filter((h) => h.retrievability < 0.8)
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  private async syncVirtualSessionTimeout(sessionId: string): Promise<void> {
    const sessions = await prisma.virtual_sessions.findMany({
      where: { currentStage: 'teaching' },
      select: {
        id: true,
        status: true,
        stageResults: true,
        logs: true,
      }
    });

    for (const session of sessions) {
      let stageResults: Record<string, any> = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}') || {};
      } catch {
        stageResults = {};
      }

      const learningState = stageResults.teaching || {};
      if (learningState?.teachingSessionId !== sessionId) continue;

      const nextLearningState = {
        ...learningState,
        // 注意：不写 manualStop —— 这是系统自动超时而非人工停止，
        // 写 manualStop 会让前端显示「已手动停止」并污染停止口径（数据取证证实
        // failed 会话中大量 manualStop=true 实为超时连锁）。原因由 stoppedReason 表达。
        stoppedAt: new Date().toISOString(),
        stoppedReason: 'teaching-session-timeout',
        taskRuntime: {
          ...(learningState.taskRuntime || {}),
          status: 'timeout',
          error: '授课会话已超时，请重新开始 Learn',
          updatedAt: new Date().toISOString()
        }
      };

      let logs: any[] = [];
      try {
        logs = JSON.parse(session.logs || '[]');
      } catch {
        logs = [];
      }

      const hasTimeoutLog = logs.some((entry: any) => entry?.phase === 'error' && entry?.details?.error === 'TEACHING_SESSION_TIMEOUT');
      const nextLogs = hasTimeoutLog
        ? logs
        : [
            ...logs,
            {
              timestamp: new Date().toISOString(),
              phase: 'error',
              details: {
                error: 'TEACHING_SESSION_TIMEOUT',
                output: {
                  action: 'teaching-step-stopped',
                  teachingSessionId: sessionId
                }
              }
            }
          ];

      await prisma.virtual_sessions.update({
        where: { id: session.id },
        data: {
          status: 'failed',
          stageResults: JSON.stringify({
            ...stageResults,
            learning: nextLearningState
          }),
          logs: JSON.stringify(nextLogs),
          updatedAt: new Date()
        }
      });
    }
  }

  async getLatestTaskEvaluation(taskId: string, userId: string): Promise<{
    sessionId: string;
    subject: string;
    topic: string;
    startTime: Date;
    endTime: Date | null;
    duration: number;
    messageCount: number;
    knowledgePoints: any[];
    wrapup: any;
    advisory?: ReplanAdvisory | null;
  } | null> {
    const sessions = await teachingSessionRepository.listByUser(userId);
    const target = sessions
      .filter((session) => session.taskId === taskId && session.status === 'completed' && session.wrapup)
      .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))[0];

    if (!target || !target.wrapup) {
      return null;
    }

    return {
      sessionId: target.id,
      subject: target.subject,
      topic: target.topic,
      startTime: target.startTime,
      endTime: target.endTime,
      duration: target.duration || 0,
      messageCount: target.messages.filter((message) => message.role === 'user').length,
      knowledgePoints: target.knowledgeState,
      wrapup: target.wrapup,
      advisory: (target.advisory as ReplanAdvisory | null) || null,
    };
  }

  private async checkIdleSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - this.idleTimeoutMs);
    const sessions = await prisma.teaching_sessions.findMany({
      where: {
        status: 'active',
        updatedAt: { lte: cutoff }
      },
      select: {
        id: true,
        revision: true,
      }
    });

    for (const session of sessions) {
      const timedOut = await teachingSessionRepository.timeoutIfIdle(session.id, session.revision, cutoff);
      if (timedOut) {
        await this.syncVirtualSessionTimeout(session.id);
        await this.applyTimeoutWrapupFallback(session.id);
      }
    }

    // M4 兜底：paused 是客户端主动暂停，不短时打断；但 pausedAt 超过阈值（如 24h）视为放弃，
    // 走与 active 超时相同的兜底路径（状态转 timeout + summary-only wrapup）。
    // 用户之后可通过下一轮教学回合恢复（active/paused/timeout 均可），正常收束会覆盖兜底 wrapup。
    const pausedCutoff = new Date(Date.now() - this.pausedSessionTimeoutMs);
    const pausedSessions = await prisma.teaching_sessions.findMany({
      where: { status: 'paused' },
      select: {
        id: true,
        revision: true,
        teachingState: true,
      }
    });

    for (const session of pausedSessions) {
      let teachingState: Record<string, any> | null = null;
      try {
        teachingState = JSON.parse(session.teachingState || '{}');
      } catch {
        teachingState = null;
      }
      const artifacts = parseSessionArtifacts(teachingState);
      const pausedAt = typeof artifacts.pausedAt === 'string'
        ? new Date(artifacts.pausedAt).getTime()
        : NaN;
      if (!Number.isFinite(pausedAt) || pausedAt > pausedCutoff.getTime()) continue;
      const timedOut = await teachingSessionRepository.timeoutIfPaused(session.id, session.revision, pausedCutoff);
      if (timedOut) {
        logger.info('[AITeaching] 长时间未恢复的暂停会话按超时兜底处理', {
          sessionId: session.id,
          pausedAt: new Date(pausedAt).toISOString(),
        });
        await this.syncVirtualSessionTimeout(session.id);
        await this.applyTimeoutWrapupFallback(session.id);
      }
    }

    // 终态脏数据治理：failed/superseded/discarded 行无业务价值（开课失败已改为复用 openKey），
    // 超过保留期后删除，避免会话表无限累积
    try {
      const terminalCutoff = new Date(Date.now() - this.terminalSessionRetentionMs);
      const cleaned = await prisma.teaching_sessions.deleteMany({
        where: {
          status: { in: ['failed', 'superseded', 'discarded'] },
          updatedAt: { lte: terminalCutoff }
        }
      });
      if (cleaned.count > 0) {
        logger.info('[AITeaching] 清理过期终态会话行', {
          count: cleaned.count,
          cutoff: terminalCutoff.toISOString(),
        });
      }
    } catch (error) {
      logger.warn('[AITeaching] 终态会话清理失败（不影响巡检）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 超时会话兜底：写入轻量学习记录（不调 LLM），避免评估页出现
   * 「总结全空 + 用时 0 分钟」；用户之后恢复继续学习并正常结束时会被正式 wrapup 覆盖。
   */
  private async applyTimeoutWrapupFallback(sessionId: string): Promise<void> {
    try {
      const session = await teachingSessionRepository.getById(sessionId);
      if (!session || session.status !== 'timeout' || session.wrapup) return;

      // 活跃时长：按消息时间戳估算（间隔 > 30 分钟视为暂停），避免把 idle 时间算入
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const times = messages
        .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b);
      let activeMinutes = 0;
      for (let i = 1; i < times.length; i++) {
        activeMinutes += Math.min((times[i] - times[i - 1]) / 60000, 30);
      }
      const durationMinutes = Math.max(1, Math.round(activeMinutes));

      const knowledgePoints = cloneKnowledgePoints(session.knowledgeState);
      const mastered = knowledgePoints.filter((p) => p.status === 'mastered').map((p) => p.name);
      const learning = knowledgePoints.filter((p) => p.status === 'learning').map((p) => p.name);

      const wrapup = {
        status: 'summary-only' as const,
        sources: { summary: 'timeout-fallback' as const, evaluation: 'failed' as const },
        duration: durationMinutes,
        summary: {
          topicSummary: '本次会话未正常结束，为你保留了基础学习记录。',
          knowledgeSummary: mastered.length > 0 ? `已掌握：${mastered.join('、')}。` : '暂未确认掌握的知识点。',
          practiceAdvice: '重新开始本节，完成一次完整的学习后这里会给出完整建议。',
          learningEvaluation: '未生成学习评价。',
          knowledgeItems: knowledgePoints.map((p) => ({
            name: p.name,
            status: p.status,
            evidence: p.status === 'mastered' ? '会话中确认掌握' : '会话中未完成确认',
          })),
          keyTakeaways: [] as string[],
          actionPlan: [] as string[],
          evaluationHighlights: null,
          metricInterpretation: {
            session: '未生成本节课堂表现。',
            longTerm: '未生成长期状态评估。',
          },
          summaryVersion: 'v2',
        },
        evaluation: null,
        progress: {
          newlyMastered: mastered,
          movedToReview: [] as string[],
          stillLearning: learning,
          unchangedMastered: [] as string[],
        },
        evidence: {
          turnCount: messages.length,
          avgUnderstanding: null,
          avgEngagement: null,
          dominantCognitiveLevel: null,
          lastCognitiveLevel: null,
          topConfusionPoints: [] as string[],
          emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
          completionCandidateSeen: false,
        },
      };

      const guarded = await prisma.teaching_sessions.updateMany({
        where: { id: sessionId, status: 'timeout', wrapup: null },
        data: {
          wrapup: JSON.stringify(wrapup),
          ...(() => {
            // 终态清理：移除待处理检查点，避免详情接口残留
            const state = session.teachingState && typeof session.teachingState === 'object'
              ? { ...session.teachingState }
              : {};
            delete (state as Record<string, any>).pendingCheckpoint;
            const artifacts = state.sessionArtifacts && typeof state.sessionArtifacts === 'object'
              ? { ...state.sessionArtifacts }
              : {};
            delete (artifacts as Record<string, any>).pendingCheckpoint;
            state.sessionArtifacts = artifacts;
            return { teachingState: JSON.stringify(state) };
          })()
        }
      });
      if (guarded.count !== 1) {
        logger.info('[AITeaching] 兜底 wrapup 被跳过（会话已离开 timeout 或已有正式总结）', { sessionId });
        return;
      }
      logger.info('[AITeaching] 超时会话已写入兜底学习记录', { sessionId, durationMinutes });
    } catch (error) {
      logger.warn('[AITeaching] 超时会话兜底记录写入失败', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async processPeerMessage(
    sessionId: string,
    message: string
  ): Promise<{
    peerResponse: string;
    strategy: string | null;
    followUpQuestions: string[];
  }> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session) {
      throw new Error('会话不存在或已结束');
    }
    if (session.status !== 'active' && session.status !== 'timeout') {
      throw new TeachingSessionConflictError('课堂已结束，无法继续伴学对话', 'TEACHING_SESSION_STATE_CHANGED');
    }

    // 伴学历史从已落库消息中恢复（peer 标记），不再依赖进程内 Map
    const peerHistory = session.messages
      .filter((item: any) => item.peer === true)
      .map((item: any) => ({ role: item.role, content: item.content }));

    const peerResult = await executeSkill(peerAgentDefinition, {
      input: {
        topic: session.topic,
        strategy: 'feynman',
        studentMessage: message,
        tutorContext: session.messages.slice(-6).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        cognitiveLevel: (session.teachingState as any)?.analysis?.cognitiveLevel,
        understanding: (session.teachingState as any)?.analysis?.understanding,
        peerHistory,
      },
      context: {
        userId: session.userId,
        sessionId: session.id,
      },
    }, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        session: { sessionId: session.id, taskId: session.taskId },
      },
    });

    const peerResponse = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
    const peerExt = peerResult.internal?.ext?.peer || null;
    const strategy = peerExt?.strategy || null;
    const followUpQuestions = Array.isArray(peerExt?.followUpQuestions)
      ? peerExt.followUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim())
      : [];
    // 伴学对话落库（带 peer 标记），页面刷新后不丢失
    const now = new Date().toISOString();
    await teachingSessionRepository.appendPeerMessages(sessionId, [
      { role: 'user', content: message, timestamp: now, peer: true },
      { role: 'assistant', content: peerResponse, timestamp: now, peer: true },
    ]);
    return { peerResponse, strategy, followUpQuestions };
  }
}

// 辅助函数：将扩展的 taskType 映射到基础的 4 种类型（用于学习状态指标计算）
function normalizeTaskTypeForMetrics(
  taskType: 'reading' | 'practice' | 'project' | 'quiz' | 'acquire' | 'deconstruct' | 'model' | 'execute' | 'diagnose' | 'refine' | 'consolidate'
): 'reading' | 'practice' | 'project' | 'quiz' {
  switch (taskType) {
    // 直接映射
    case 'reading':
    case 'practice':
    case 'project':
    case 'quiz':
      return taskType;
    
    // 认知处理类 → reading（偏理解和分析）
    case 'acquire':      // 获取材料
    case 'deconstruct':  // 解构分析
    case 'consolidate':  // 巩固整理
      return 'reading';
    
    // 执行和建模类 → practice（偏动手操作）
    case 'execute':      // 执行操作
    case 'model':        // 建模构建
      return 'practice';
    
    // 诊断和改进类 → project（偏综合应用）
    case 'diagnose':     // 诊断问题
    case 'refine':       // 改进优化
      return 'project';
  }
}

export const aiTeachingOrchestrator = new AITeachingOrchestrator();
export default aiTeachingOrchestrator;
