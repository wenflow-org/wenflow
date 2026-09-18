import { createHash, randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import prisma from '../../config/database';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
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
import { applyWarmupExtractionForSession } from './warmup-writeback';
import { knowledgeStateService, COMPLETION_TARGET_PROGRESS_FLOOR } from './KnowledgeStateService';
import { peerTriggerService } from './PeerTriggerService';
import { teachingContextCompressionService } from './TeachingContextCompressionService';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { learnerSnapshotService } from '../learner/LearnerSnapshotService';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import { learnerStateReviewService } from '../learner/LearnerStateReviewService';
import { conceptConsolidatorService } from '../learner/ConceptConsolidatorService';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { recordTaskDifficultyAdjustment } from '../learner/TaskDifficultyAdjustmentLedger';
import { assembleTeachingTurnChannels } from '../field-dispatcher';
import { createDomainEvent } from '../../events/contracts';
import { replanAdvisoryService, toAttributionRecall, type ReplanAdvisory } from './ReplanAdvisoryService';
import { runWithTeachingSession } from './teaching-session-context';
import { replanAttributionService, isCalibratableDirection, type ReplanAttributionEvidence } from './ReplanAttributionService';
import { insightCalibrationService } from '../learner/insight-calibration.service';
import { hasReliableSessionEvaluation, mergeFinalTeachingState } from './SessionFinalizationPolicy';
import { classifyFinalizationError } from './FinalizationErrors';
import { FinalizationLeaseGuard } from './FinalizationLeaseGuard';
import { TeachingOperationLeaseGuard } from './TeachingOperationLeaseGuard';
import { learnerExitService } from '../learner/LearnerExitService';
import { memoryTraceService, normalizeConceptKey } from '../memory/memory-trace.service';
import { conceptLoadService } from '../memory/concept-load.service';
import { reviewQuotaService } from '../memory/review-quota.service';
import reviewPlanService, { type ReviewPlan, type ReviewPlanItem } from '../memory/review-plan.service';
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
  /** 答案键（服务端保存，**不下发给学生**）：选择题的正确选项 id */
  correctOptionIds?: string[];
  /** 答案键：简答题的必备要点（代码按包含判定） */
  expectedKeywords?: string[];
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
  /** 检查点的**代码裁决**结果（提交侧按答案键算出；缺省 = 无答案键，退回模型派生判定） */
  checkpointJudgement?: CheckpointCodeJudgement | null;
  /** 原始作答（供检查点结果留痕；不含答案键） */
  checkpointSubmission?: { selectedOptionIds?: string[]; answerText?: string };
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

/** 检查点最小间隔（条消息）：与 `processStudentMessage` 事后门保持一致 */
const CHECKPOINT_MIN_TURNS = 4;
/** 触发检查点所需"上一轮确有进展"的理解度门槛 */
const CHECKPOINT_TRIGGER_MIN_UNDERSTANDING = 0.6;

/**
 * 检查点**触发**（2026-09-17）：由**代码**决定"何时探测"，模型只负责"探测什么"（出题 + 答案键）。
 *
 * 背景：此前触发完全由模型自决（提示词写"满足全部条件才输出"），实测最近 60 个会话**零检查点**
 * ⇒ 独立传感器没有样本 ⇒ 成功率带永远打不开（§7 P1-1 的前置）。触发条件都是可复算的，本就该由代码给。
 *
 * 条件（全部满足）：① 没有待处理检查点（不堆题）；② 距上次检查点 ≥ `CHECKPOINT_MIN_TURNS` 条消息；
 * ③ 不在收尾阶段；④ 上一轮确有进展（最近一条带 analysis 的助手回合 understanding ≥ 门槛）。
 */
export function shouldEmitCheckpoint(
  session: { messages: Array<{ role: string; analysis?: any }> },
  teachingState: Record<string, any> | null | undefined,
): boolean {
  if (getPendingCheckpoint(teachingState)) return false;
  const lastTurn = Number(teachingState?.lastCheckpointTurn);
  if (Number.isFinite(lastTurn) && session.messages.length - lastTurn < CHECKPOINT_MIN_TURNS) return false;
  const stage = String(teachingState?.classroomContext?.stage?.current ?? '');
  if (stage === 'ready_to_close' || stage === 'wrapup') return false;
  const lastAnalysis = [...session.messages].reverse().find((message) => message?.analysis)?.analysis;
  const understanding = Number(lastAnalysis?.understanding);
  return Number.isFinite(understanding) && understanding >= CHECKPOINT_TRIGGER_MIN_UNDERSTANDING;
}

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

/**
 * 归因证据（有界、带稳定 id 供模型引用）：本课复盘要点 + 状态信号 + 不稳定概念名单。
 * 只给"事实"，不给结论——结论是归因层要产出的东西。
 */
export function buildReplanAttributionEvidence(input: {
  wrapup: SessionWrapupArtifact;
  learnerReplanProjection: any;
  nextMilestoneTitle?: string | null;
}): ReplanAttributionEvidence[] {
  const { wrapup, learnerReplanProjection, nextMilestoneTitle } = input;
  const evidence: ReplanAttributionEvidence[] = [];
  const push = (id: string, kind: string, text: string) => {
    const trimmed = String(text || '').trim();
    if (trimmed) evidence.push({ id, kind, text: trimmed.slice(0, 120) });
  };

  const topicSummary = (wrapup as any)?.summary?.topicSummary ?? (wrapup as any)?.topicSummary;
  push('wrapup:summary', 'session_summary', String(topicSummary || ''));
  const unresolved = Array.isArray((wrapup as any)?.progress?.stillLearning)
    ? (wrapup as any).progress.stillLearning
    : [];
  push('wrapup:still-learning', 'still_learning', unresolved.slice(0, 4).join('、'));
  const confusions = Array.isArray((wrapup as any)?.evidence?.topConfusionPoints)
    ? (wrapup as any).evidence.topConfusionPoints
    : [];
  push('wrapup:confusions', 'confusions', confusions.slice(0, 4).join('、'));
  const movedToReview = Array.isArray((wrapup as any)?.progress?.movedToReview)
    ? (wrapup as any).progress.movedToReview
    : [];
  push('wrapup:moved-to-review', 'moved_to_review', movedToReview.slice(0, 4).join('、'));

  const evaluation = (wrapup as any)?.evaluation;
  if (evaluation) {
    push('signal:metrics', 'session_metrics',
      `sessionKtl=${evaluation.sessionKtl ?? '—'} sessionLss=${evaluation.sessionLss ?? '—'} sessionLf=${evaluation.sessionLf ?? '—'}`);
  }
  push('signal:trend', 'recent_trend', String(learnerReplanProjection?.dynamicState?.recentTrend || ''));
  push('signal:fragile', 'fragile_concepts',
    (learnerReplanProjection?.mastery?.fragileConcepts ?? []).slice(0, 6).join('、'));
  push('signal:struggling', 'struggling_concepts',
    (learnerReplanProjection?.mastery?.strugglingConcepts ?? []).slice(0, 6).join('、'));
  push('signal:gaps', 'prerequisite_gaps',
    (learnerReplanProjection?.risk?.prerequisiteGaps ?? []).slice(0, 4).map((gap: any) => `${gap.label}( ${gap.severity} )`).join('、'));
  push('path:next-milestone', 'next_milestone', String(nextMilestoneTitle || ''));
  return evidence;
}

/** 课内温故：模型用「原名字」报告回捞结果，比对走归一化（模型可能换写法） */
function warmupKeyOf(name: string): string {
  return normalizeConceptKey(name);
}

/**
 * 能代表「当场回捞出了结果」的看板状态。
 * 提示词要求回捞成功才把温故点推进为 learning / mastered；模型有时会把它标成 'review'
 * （= 已提问、待作答）或 'pending'（= 尚未处理）——这两种只说明"问过了"，不是作答表现，
 * 因此**不收录为结果**（否则收束时会按"没答出"落成 again，污染记忆状态与间隔）。
 */
const WARMUP_RESULT_STATUSES = new Set(['mastered', 'learning']);

/**
 * 结构化召回等级 → 看板状态/进度（2026-09-17）。
 * 与 `mapReviewStatusToRating` 的口径对齐：unaided→easy(0.9)、with-hint→hard(0.5)、failed→again(0.5)。
 * "给了多少帮助才想起来"是 desirable difficulty 的直接观测量，比"是否答出"二分更有信息量。
 */
const WARMUP_RECALL_TO_STATUS: Record<'unaided' | 'with-hint' | 'failed', { status: string; progress: number }> = {
  unaided: { status: 'mastered', progress: 100 },
  'with-hint': { status: 'learning', progress: 50 },
  failed: { status: 'not-recalled', progress: 0 },
};

/** 保守包含匹配的长度门槛（归一化后字符数）：短名包含关系太容易误伤，宁可不匹配 */
export const WARMUP_FUZZY_MIN_LENGTH = 8;

/** 字符重合率下限（以较短名为分母）：低于它就不再视为同一概念 */
export const WARMUP_FUZZY_OVERLAP_MIN = 0.8;

/**
 * 把「模型回写的点位名」对到计划项上（保守匹配）。
 *
 * 为什么需要退一步：实测两次全流程验证，一次摘到、一次没摘到——模型用**近义/截断**说法
 * 回写点位（提示词要求"用计划里的原名字"，但不总是遵守），结果**随机丢样本**，
 * 而样本正是动态预算与保持曲线的输入。
 *
 * 为什么必须保守：温故点会被**从本节看板摘除**（回归 2e3ca16），一旦误判，
 * 本节知识点会被当成温故点摘掉。因此：
 * 1) 先精确（归一化后相等）；计划内自身歧义 → 放弃；
 * 2) 再退一步做包含匹配，但要求**双方长度 ≥ 门槛**且**唯一命中**；否则放弃（宁缺勿错）。
 */
export function matchWarmupItem(
  plan: ReviewPlan | null | undefined,
  name: string,
): ReviewPlanItem | null {
  const items = (plan?.items || []).filter((item) => item && (item.label || item.conceptKey));
  if (items.length === 0) return null;
  const target = warmupKeyOf(String(name || ''));
  if (!target) return null;

  const exact = items.filter((item) => warmupKeyOf(item.label || item.conceptKey) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const contained = items.filter((item) => {
    const key = warmupKeyOf(item.label || item.conceptKey);
    if (key.length < WARMUP_FUZZY_MIN_LENGTH || target.length < WARMUP_FUZZY_MIN_LENGTH) return false;
    return key.includes(target) || target.includes(key);
  });
  if (contained.length === 1) return contained[0];
  if (contained.length > 1) return null;

  // 3) 同字异序：模型常把中文概念名调序（实测 "整合输出8月龄食物质地安全判据" → 写回 "
  //    食物质地安全判据整合"）。字符多重集完全相同的两个名字几乎不可能指不同概念 → 唯一命中就认。
  const sameChars = items.filter((item) => {
    const key = warmupKeyOf(item.label || item.conceptKey);
    if (key.length !== target.length || key.length < WARMUP_FUZZY_MIN_LENGTH) return false;
    return [...key].sort().join('') === [...target].sort().join('');
  });
  if (sameChars.length === 1) return sameChars[0];
  if (sameChars.length > 1) return null;

  // 4) 最后退一步：**调序 + 截断**同时出现（实测那次就是丢了"输出/8月龄"）。按字符重合率（不看顺序），
  //    以较短名为分母要求 ≥ 0.8，双方均 ≥ 8 字，且唯一命中。
  //    再松就会开始误伤本节知识点（误判会把知识点从看板摘掉）——宁可漏摘。
  const similar = items.filter((item) => {
    const key = warmupKeyOf(item.label || item.conceptKey);
    if (key.length < WARMUP_FUZZY_MIN_LENGTH || target.length < WARMUP_FUZZY_MIN_LENGTH) return false;
    const shortName = key.length <= target.length ? key : target;
    const pool = [...(key.length <= target.length ? target : key)];
    let hit = 0;
    for (const char of shortName) {
      const index = pool.indexOf(char);
      if (index >= 0) {
        pool.splice(index, 1);
        hit += 1;
      }
    }
    return hit / shortName.length >= WARMUP_FUZZY_OVERLAP_MIN;
  });
  return similar.length === 1 ? similar[0] : null;
}

/**
 * 交给模型的本节温故视图：**只保留尚未回捞的点**。
 * - 已在本节报告过结果的点不再重复问（也避免后续回合覆盖已记录的结果）；
 * - 全部完成 → 返回 null，提示词走"本节不温故"分支；
 * - 注意：`stripWarmupPoints` / `extractWarmupOutcomes` 仍须用**完整计划**（它们负责"温故点永不进
 *   本节看板"），否则模型若在后续回合才报出结果，就会漏摘并串进看板（回归 2e3ca16）。
 */
export function pendingWarmupForModel(plan: ReviewPlan | null | undefined): ReviewPlan | null {
  if (!plan || !Array.isArray(plan.items)) return null;
  const pending = plan.items.filter((item) => !item?.outcome?.status);
  if (pending.length === 0) return null;
  return {
    ...plan,
    items: pending,
    // 与 items 保持一致的视图：只算还没回捞的负担
    usedLoad: pending.reduce((sum, item) => sum + (Number(item.load) || 0), 0),
  };
}

/**
 * 每回合重建 context 后回填温故计划。
 * 断点回归（2026-09-16 调查）：计划只在 `startSession` 里赋给 context，而回合侧每回合重建 context，
 * 于是 `scenario.memoryWarmup` 恒为 null——提示词的温故规则成了死代码，结果也永远摘不到。
 * 计划持久化在 `sessionArtifacts.memoryWarmup`（开课建立、随回合合并结果），这里必须回填。
 */
export function resolveTurnMemoryWarmup(
  sessionArtifacts: Record<string, any> | null | undefined,
): ReviewPlan | null {
  const persisted = sessionArtifacts?.memoryWarmup;
  return persisted && Array.isArray(persisted.items) && persisted.items.length > 0 ? persisted : null;
}

/**
 * 从教学回合的输出里摘出「课内温故」的结果。
 *
 * **两条通道，结构化优先（2026-09-17，审计 §3.6 问题④的另一半）**：
 * ① `control.warmupOutcomes`（首选）：模型直接报"给了多少帮助才想起来"（unaided / with-hint / failed），
 *    代码据此落结果——**不做名字匹配**，因此不再依赖"模型必须把温故点按原名回写进 knowledge.points"。
 *    实测背景：靠回写 + 名字匹配时，两次全流程验证一次摘到一次没摘到（本轮从零回归里温故点在消息中
 *    出现 5 次、却没进 knowledge.points ⇒ 摘取饿死、outcome 恒 null）。
 * ② `knowledge.points` 名字匹配（兼容）：老行为，结构化缺失时兜底。
 *
 * 到期旧知必须与本节点看板**物理分离**——历史事故 2e3ca16：日常课把跨 path 到期点注入
 * seededKnowledgeState，结果串进「本节知识点」且被前端 isCurrent 误显示为「进行中 · x%」，
 * 于是整个课内复习机制被下线。这里仍走独立通道（只取结果，不进看板）。
 */
export function extractWarmupOutcomes(
  plan: ReviewPlan | null | undefined,
  points: Array<{ name: string; status: string; progress: number }> | null | undefined,
  structured?: Array<{ conceptKey?: string; itemIndex?: number; recall: 'unaided' | 'with-hint' | 'failed'; evidence?: string }> | null,
): Array<{ conceptKey: string; status: string; progress: number }> {
  if (!plan) return [];
  const outcomes: Array<{ conceptKey: string; status: string; progress: number }> = [];
  const pushOnce = (item: ReviewPlanItem, status: string, progress: number) => {
    const key = warmupKeyOf(item.conceptKey);
    if (outcomes.some((existing) => warmupKeyOf(existing.conceptKey) === key)) return;
    // 用**计划项的规范键**（而非模型当时的写法）：记忆引擎按它定位 memory_traces
    outcomes.push({ conceptKey: item.conceptKey, status, progress });
  };

  // ① 结构化通道：itemIndex 相对的是**模型看到的待回捞视图**（pendingWarmupForModel），不是完整计划
  const pendingView = pendingWarmupForModel(plan)?.items ?? [];
  for (const entry of structured || []) {
    if (!entry) continue;
    const index = Number.isInteger(entry.itemIndex) ? Number(entry.itemIndex) : -1;
    const byIndex = index >= 0 && index < pendingView.length ? pendingView[index] : null;
    const item = byIndex ?? matchWarmupItem(plan, String(entry.conceptKey || ''));
    if (!item) continue;
    const mapped = WARMUP_RECALL_TO_STATUS[entry.recall];
    if (!mapped) continue;
    pushOnce(item, mapped.status, mapped.progress);
  }

  // ② 兼容通道：模型把温故点按原名写回 knowledge.points（仅在结构化没给这个点时生效）
  if (Array.isArray(points)) {
    for (const point of points) {
      const name = String(point?.name || '').trim();
      if (!name) continue;
      const matched = matchWarmupItem(plan, name);
      if (!matched) continue;
      const status = String(point.status || '') || 'learning';
      // 只有「当场回捞出了结果」的状态才算结果：模型把温故点写回来只为提问（'review'）时，
      // 它不代表任何作答表现——若当成结果收录，收束时会按"没答出"落成 again，污染记忆状态。
      if (!WARMUP_RESULT_STATUSES.has(status)) continue;
      pushOnce(matched, status, Number(point.progress) || 0);
    }
  }
  return outcomes;
}

/** 从本节看板点里剔除温故点（保证到期旧知不污染本节知识点清单） */
export function stripWarmupPoints<T extends { name: string }>(
  plan: ReviewPlan | null | undefined,
  points: T[],
): T[] {
  if (!plan || !Array.isArray(points)) return points;
  return points.filter((point) => !matchWarmupItem(plan, String(point?.name || '')));
}

/**
 * 标记「模型真的把这个温故点问出来了」（首次）。
 *
 * 与 `mergeWarmupOutcomes`（记录**结果**）分开：模型常把温故点以 `review`/`pending` 写回
 * （= 我已经问了/正要问），这不是作答表现，但它证明**确实发生了这次回捞**。
 * 结算时凭它把"问过、但始终没推进"判定为**没答出**——否则失败永不入库：
 * 成功率与保持曲线只剩上界，leech（连续答不出）与队列自净也永远不会触发。
 */
export function markWarmupAsked(
  plan: ReviewPlan | null | undefined,
  points: Array<{ name: string }> | null | undefined,
  askedAt: string,
): ReviewPlan | null {
  if (!plan || !Array.isArray(plan.items) || !Array.isArray(points)) return plan ?? null;
  const matched = new Set<string>();
  for (const point of points) {
    const item = matchWarmupItem(plan, String(point?.name || ''));
    if (item) matched.add(item.conceptKey);
  }
  if (matched.size === 0) return plan;
  return {
    ...plan,
    items: plan.items.map((item) =>
      matched.has(item.conceptKey) && !item.askedAt ? { ...item, askedAt } : item,
    ),
  };
}

/** 把温故结果并进持久化计划项（按归一化键匹配） */
export function mergeWarmupOutcomes(
  plan: ReviewPlan | null | undefined,
  updates: Array<{ conceptKey: string; status: string; progress: number }>,
  reviewedAt: string,
): ReviewPlan | null {
  if (!plan || updates.length === 0) return plan ?? null;
  const byKey = new Map(updates.map((item) => [warmupKeyOf(item.conceptKey), item]));
  return {
    ...plan,
    items: plan.items.map((item) => {
      const update = byKey.get(warmupKeyOf(item.label || item.conceptKey));
      if (!update) return item;
      return { ...item, outcome: { status: update.status, progress: update.progress, reviewedAt } };
    }),
  };
}

function getPendingCheckpoint(teachingState: Record<string, any> | null | undefined): TeachingCheckpoint | null {
  return teachingState?.pendingCheckpoint
    || parseSessionArtifacts(teachingState).pendingCheckpoint
    || null;
}

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
type LearnStage = 'opening' | 'teaching' | 'intervention' | 'checkpoint' | 'ready_to_close' | 'wrapup';

/** 新课堂初始阶段恒为 `opening`（开场定位）。旧实现写作 `openingMode ? 'opening' : 'opening'`（恒真三目），已收敛。 */
function initialClassroomStage(): LearnStage {
  return 'opening';
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
    occurredAt: simulatedNowOr().toISOString(),
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

/**
 * 阶段推进的**唯一来源**。产出仅 `{opening, teaching, intervention, ready_to_close}`——
 * 不产出 `checkpoint`/`wrapup`（见 `LearnStage` 注释：检查点是回合内控制对象，wrapup 是收尾语义）。
 */
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

  const rawDuration = Math.max(1, Math.round((simulatedNowOr().getTime() - session.startTime.getTime() - pausedDurationMs) / 60000));

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

/**
 * 开场交互块生成的超时（C7 修复，2026-09-15）。
 * 实测 148 次**成功**调用的时延：p50=3.9s / p90=8.2s / **p95=11.2s / max=14.1s**；
 * 而原 15s 恰好切在 p95~max 之间 → 慢的合法调用被 abort（59 次失败全部停在 **15.0–15.8s**，`CALLER_ABORTED`）。
 * 抬到 30s（>2× 实测 max）并支持 env 覆盖。开场每节课只生成一次，最坏只多等一次；
 * 真失败仍有确定性开场兜底（`buildDeterministicOpening`）。
 */
const OPENING_GENERATION_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.OPENING_GENERATION_TIMEOUT_MS) || 30_000,
);
/** 收束兜底：回合数达到该值且目标集均分达标、无 pending 时放行，保证课堂不会「永不收敛」 */
const COMPLETION_TURNS_BACKSTOP = 8;

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

/**
 * 伴学策略（peer-reinforcement 规则的"手法"）由**代码**按认知层级选定。
 *
 * 断链修复（审计 §3.19 P0②）：此前两处调用都硬编码 `strategy: 'feynman'`，
 * 使 skill 规则 38「understand→类比 / apply→反例边界 / analyze+→辩论费曼」永不触发。
 * 分工与全仓一致：代码给档位/枚举，prompt 负责"怎么说"。
 */
export function pickPeerStrategy(
  cognitiveLevel: unknown,
): 'analogy' | 'counterexample' | 'debate' {
  const level = String(cognitiveLevel || '').trim().toLowerCase();
  if (level === 'analyze' || level === 'evaluate' || level === 'create') return 'debate';
  if (level === 'apply') return 'counterexample';
  return 'analogy'; // remember / understand / 未知：先用类比搭桥
}

/** 导出以便回归测试（§3.19 P0③：wrapup 声明了 loadIndex 均值/峰值，必须真的给） */
export function computeSessionEvidence(session: TeachingSessionRecord) {  // 排除检查点合成消息（非真实学生话语），避免污染理解/参与度统计
  const analyzedMessages = session.messages.filter((message) => !!message.analysis && !message.checkpoint);
  const avg = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const understandingScores = analyzedMessages
    .map((message) => Number(message.analysis?.understanding))
    .filter((value) => Number.isFinite(value));
  const engagementScores = analyzedMessages
    .map((message) => Number(message.analysis?.engagement))
    .filter((value) => Number.isFinite(value));
  // 认知负荷：session-wrapup 的规则声明了"loadIndex 均值与峰值"，但此前从未提供（审计 §3.19 P0③）
  const loadIndexScores = analyzedMessages
    .map((message) => Number(message.analysis?.loadIndex))
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

  // 解法尝试台账（2026-09-17 起被消费；此前 teaching-turn 每轮产出 rsmAttempts 却没人读，审计 §5.2 P2 尾巴）。
  // 只取最近 5 条，交给 wrapup 做"方法层面"的整合（哪种方法有效、为什么）。
  const rsmAttempts = analyzedMessages
    .flatMap((message) => Array.isArray(message.analysis?.rsmAttempts) ? message.analysis!.rsmAttempts : [])
    .filter((attempt: any) => attempt && typeof attempt.method === 'string' && attempt.method.trim())
    .slice(-5)
    .map((attempt: any) => ({
      method: String(attempt.method).trim().slice(0, 200),
      outcome: typeof attempt.outcome === 'string' ? attempt.outcome.trim().slice(0, 200) : '',
      evidence: typeof attempt.evidence === 'string' ? attempt.evidence.trim().slice(0, 200) : '',
    }));

  return {
    turnCount: session.messages.filter((message) => message.role === 'user').length,
    avgUnderstanding: avg(understandingScores),
    avgEngagement: avg(engagementScores),
    dominantCognitiveLevel,
    lastCognitiveLevel,
    topConfusionPoints,
    emotionalSignals,
    completionCandidateSeen,
    avgLoadIndex: avg(loadIndexScores) === null ? null : Math.round((avg(loadIndexScores) as number) * 1000) / 1000,
    maxLoadIndex: loadIndexScores.length > 0 ? Math.round(Math.max(...loadIndexScores) * 1000) / 1000 : null,
    ...(rsmAttempts.length > 0 ? { rsmAttempts } : {}),
  };
}

/**
 * 检查点历史摘要（2026-09-17 起**被消费**；此前 `checkpointHistory` 只写不读，审计 §5.2 P2）。
 *
 * 只给模型"最近发生了什么、哪些没通过"，用于**换表征再确认**——不铺原始 20 条（噪声）。
 * 返回 null = 本节课还没有检查点记录（模型据此不改变默认行为）。
 */
export function summarizeCheckpointHistory(raw: unknown): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  recent: Array<{ title: string; passed: boolean; skipped?: boolean; understanding?: number }>;
} | null {
  const rows = Array.isArray(raw) ? raw : [];
  if (rows.length === 0) return null;
  const passed = rows.filter((row) => row?.passed === true).length;
  const skipped = rows.filter((row) => row?.skipped === true).length;
  return {
    total: rows.length,
    passed,
    failed: rows.length - passed - skipped,
    skipped,
    recent: rows.slice(-5).map((row) => ({
      title: String(row?.title ?? row?.checkpointId ?? ''),
      passed: row?.passed === true,
      ...(row?.skipped === true ? { skipped: true } : {}),
      ...(typeof row?.understanding === 'number' ? { understanding: row.understanding } : {}),
    })),
  };
}

export interface CheckpointCodeJudgement {
  /** code = 代码按答案键裁决（独立传感器）；model-reference = 无答案键，退回模型/完成度派生（同步标记，不冒充独立） */
  judgedBy: 'code' | 'model-reference';
  passed: boolean;
  detail: string;
}

/** 归一化选项 id 集合（大小写/空白容错） */
function normalizeIdSet(ids: unknown): Set<string> {
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean));
}

/** 归一化待比对文本：小写、去空白与常见标点（简答要点的保守包含判定） */
function normalizeForMatch(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?（）()【】[\]"'“”‘’—-]/g, '');
}

/**
 * **代码裁决**检查点作答（2026-09-17，审计 §7 P1-1「独立传感器」）。
 *
 * 原理：此前 `passed` 由 `completionReady || 当前点已被判 mastered` 反推——**答案是模型自己的判断**，
 * 于是"检查点通过率"与"模型认为学习者懂不懂"是同一条序列（自证回路，§5.3）。
 * 有了答案键（`control.checkpoint.correctOptionIds` / `expectedKeywords`），对错可以由代码判定，
 * 这才是可用于闭环控制的、独立于 LLM 自评的观测量。
 *
 * 边界（诚实标注，不假装独立）：
 * - 没有答案键 → 返回 `null`，调用方退回旧的模型派生判定，并在证据里标 `judgedBy='model-reference'`；
 * - 简答按"要点是否出现"保守判定：宁可**漏判通过**，不误判通过（避免鼓励背关键词）；
 * - 这仍是**弱独立**：题目与答案键都由 LLM 产出，独立的是"评判学习者"这一步。
 */
export function judgeCheckpointAnswer(
  checkpoint: Pick<TeachingCheckpoint, 'type' | 'correctOptionIds' | 'expectedKeywords'>,
  submission: { selectedOptionIds?: string[]; answerText?: string },
): CheckpointCodeJudgement | null {
  if (checkpoint.type === 'single_choice' || checkpoint.type === 'multi_choice') {
    const key = normalizeIdSet(checkpoint.correctOptionIds);
    if (key.size === 0) return null;
    const chosen = normalizeIdSet(submission?.selectedOptionIds);
    const passed = chosen.size === key.size && Array.from(chosen).every((id) => key.has(id));
    // detail 用**原始写法**（便于事后人工复核），比对用归一化集合
    const original = (ids: unknown) => Array.from(new Set((Array.isArray(ids) ? ids : [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean)));
    const keyText = original(checkpoint.correctOptionIds).join('/');
    const chosenText = original(submission?.selectedOptionIds).join('/') || '空';
    return {
      judgedBy: 'code',
      passed,
      detail: passed
        ? `选项集合与答案键一致（${keyText}）`
        : `选项集合不一致（正确 ${keyText}，作答 ${chosenText}）`,
    };
  }

  const keywords = (checkpoint.expectedKeywords || []).map(normalizeForMatch).filter(Boolean);
  if (keywords.length === 0) return null;
  const text = normalizeForMatch(submission?.answerText);
  const missing = keywords.filter((keyword) => !text.includes(keyword));
  return {
    judgedBy: 'code',
    passed: missing.length === 0,
    detail: missing.length === 0 ? '作答包含全部要点' : `缺少要点：${missing.join('/')}`,
  };
}

/**
 * 检查点结果留痕（`learner_evidence` type=`checkpoint:result`）。
 *
 * 为什么单独留痕：这是**独立于 LLM 自评**的第一手观测（`judgedBy='code'` 时）——
 * 第 3 步的"目标成功率带"（§7 P1-1）与效度检验（§8 E5）都以它为输入。
 * 无答案键时也照记，但标 `judgedBy='model-reference'`，**不得**混进独立信号。
 * 置信度按来源给：code=0.95（可复算）、model-reference=0.6（模型派生，含自证风险）。
 */
async function recordCheckpointResultEvidence(
  session: TeachingSessionRecord,
  checkpoint: TeachingCheckpoint,
  result: {
    passed: boolean;
    judgedBy: 'code' | 'model-reference';
    detail: string | null;
    submission: { selectedOptionIds?: string[] };
  },
): Promise<void> {
  try {
    const at = new Date();
    await prisma.learner_evidence.create({
      data: {
        id: `lev_cp_${checkpoint.id}_${at.getTime()}`,
        eventId: `checkpoint:${checkpoint.id}:${at.getTime()}`,
        evidenceKey: `checkpoint:result:${checkpoint.id}`,
        userId: session.userId,
        pathId: session.learningPathId ?? null,
        taskId: session.taskId ?? null,
        sessionId: session.id,
        evidenceType: 'checkpoint:result',
        payload: JSON.stringify({
          checkpointId: checkpoint.id,
          type: checkpoint.type,
          passed: result.passed,
          judgedBy: result.judgedBy,
          detail: result.detail,
          ...(result.submission.selectedOptionIds?.length
            ? { selectedOptionIds: result.submission.selectedOptionIds }
            : {}),
        }),
        confidence: result.judgedBy === 'code' ? 0.95 : 0.6,
        occurredAt: at,
      },
    });
    logger.info('[AITeaching] 检查点结果留痕', {
      sessionId: session.id,
      checkpointId: checkpoint.id,
      passed: result.passed,
      judgedBy: result.judgedBy,
    });
  } catch (error) {
    logger.warn('[AITeaching] 检查点结果留痕失败（不影响判定与课堂）', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 剥离检查点答案键（客户端投影前调用）：答案键只用于服务端代码裁决，**绝不下发**。
 * 覆盖两处暴露面：`pendingCheckpoint` 本身，以及原样返回的 `teachingState`（其中也存了一份）。
 */
/**
 * 消息响应里下发的 `checkpoint`：**必须先剥离答案键**。
 *
 * 为什么单独抽出来（18 号报告 N1）：`/messages`（含 SSE final）此前直接下发
 * `getPendingCheckpoint(teachingState)`，而 `pendingCheckpoint` 里带着 `correctOptionIds` /
 * `expectedKeywords`——答案键一旦下发，"代码裁决独立传感器"的反作弊前提就失效了。
 * `/detail` 早已剥离，这里补齐唯一遗漏的出口。
 */
export function checkpointForMessageResult(
  teachingState: Record<string, any> | null | undefined
): TeachingCheckpoint | null {
  const stripped = stripCheckpointAnswerKeys({ pendingCheckpoint: getPendingCheckpoint(teachingState) });
  return stripped.pendingCheckpoint ?? null;
}

/**
 * 组装本回合 `teachingState`：**先继承上一回合顶层状态，再覆盖本回合字段**。
 *
 * 为什么必须继承（18 号报告 N2）：本函数此前用 `{ ...currentState(运行时指标), ... }` 重建，
 * 而运行时指标里**没有** `pendingCheckpoint` / `lastCheckpointTurn` / `checkpointHistory`——
 * 它们只存在于上一回合的顶层。于是每次重建都把它们丢掉：
 * 答错后 `getPendingCheckpoint` 返回 null → `submitCheckpoint` 报"理解检查不存在或已处理"，
 * `checkpointHistory` 永远为空（DB 实测 220 会话仅 2 条）。
 */
export function inheritTeachingState<T extends Record<string, any>>(
  previousTeachingState: Record<string, any> | null | undefined,
  turnState: T
): T & Record<string, any> {
  return { ...(previousTeachingState || {}), ...turnState };
}

export function stripCheckpointAnswerKeys<T extends Record<string, any> | null | undefined>(teachingState: T): T {
  if (!teachingState || typeof teachingState !== 'object') return teachingState;
  const clone: Record<string, any> = { ...(teachingState as Record<string, any>) };
  const stripOne = (checkpoint: any) => {
    if (!checkpoint || typeof checkpoint !== 'object') return checkpoint;
    const { correctOptionIds, expectedKeywords, ...rest } = checkpoint;
    void correctOptionIds;
    void expectedKeywords;
    return rest;
  };
  if (clone.pendingCheckpoint) clone.pendingCheckpoint = stripOne(clone.pendingCheckpoint);
  if (clone.sessionArtifacts && typeof clone.sessionArtifacts === 'object' && clone.sessionArtifacts.pendingCheckpoint) {
    clone.sessionArtifacts = { ...clone.sessionArtifacts, pendingCheckpoint: stripOne(clone.sessionArtifacts.pendingCheckpoint) };
  }
  return clone as T;
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
    learnerInsights: context.learnerInsights ?? null,
    // 检查点历史（写侧 2026-09-17 起补 title/type）：让模型知道哪些点没通过，换表征再确认
    checkpointHistory: summarizeCheckpointHistory(teachingState.checkpointHistory),
    memoryWarmup: pendingWarmupForModel(context.memoryWarmup),
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
        classroomEventContext,
        scenario: scenario as Record<string, unknown>,
        interactionProfile: (context as any).interactionProfile,
      },
      { warnContext: { sessionId: session.id } }
    );
  } catch {
    // 对账失败不影响主流程
  }

  // 配置式输入通道（P2 声明 + 本链运行时消费）：routings 表 teaching-agent 通道行抽值优先，缺失回退既有组装
  const { channels } = await assembleTeachingTurnChannels({ session, teachingState, context }).catch(() => ({ channels: {}, skipped: [] }));

  return {
    messages: compression.messages,
    learner: channels['learner.learnerProjection'] || context.learnerProjection,
    scenario,
    classroomContext: channels['classroomContext'] || classroomContext,
    classroomEventContext,
    knowledge: {
      points: (channels['knowledge.state'] && Array.isArray(channels['knowledge.state'])
        ? channels['knowledge.state']
        : session.knowledgeState),
    },
    controls: {
      mode: session.mode as TeachingMode,
      teachingControlContext: channels['controls.teachingControlContext'] || teachingControlContext,
      // 出题触发由代码给（2026-09-17）：模型只出题与答案键，不再自行决定"什么时候探测"
      emitCheckpoint: shouldEmitCheckpoint(session, teachingState),
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
        // 防御：巡检失败时日志器本身也可能被替换/不完整（测试替身），日志失败不应拖垮进程
        logger.warn?.('[AITeaching] idle session scan failed', {
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

  /**
   * 难度调整锚点：开课时把本节难度判定留痕，供"这个调整到底有没有用"与下一条同路径状态对账。
   *
   * 为什么放生产：此前 `recordTaskDifficultyAdjustment` 的唯一调用者是模拟脚本，
   * 于是效果度量（`relieved` / `still_triggered`）在真实课上从未运行过——只能看过程，不能审计。
   *
   * 口径（诚实边界，与台账注释一致）：
   * - 只留"有调整理由"的锚点（无理由即无调整，无从度量）；
   * - `applied` = 档位**真的变了**（`adjusted !== baseline`）。生产把档位注入提示词，学生看到的
   *   就是调整后的难度；生产**没有随机对照组**，因此 `applied=false` 的自然对照只来自
   *   "理由触发但被地板/上限吃掉、档位没动"这类情形——它同样进对照统计，不是假对照；
   * - 幂等键 = `taskId`（重复开课/恢复只更新同一条锚点）；
   * - `occurredAt` 用模拟时钟（虚拟实验室回放历史日期时必须与状态写入同一时钟）。
   */
  private async recordTaskDifficultyAnchor(
    context: TeachingScenarioContext,
    sessionId: string,
  ): Promise<void> {
    const decision = context.learnerProjection?.taskDifficulty;
    if (!decision || !Array.isArray(decision.reasons) || decision.reasons.length === 0) return;
    try {
      await recordTaskDifficultyAdjustment({
        userId: context.userId,
        taskId: context.taskId,
        pathId: context.learningPathId ?? null,
        milestoneId: context.milestoneId ?? null,
        sessionId,
        occurredAt: simulatedNowOr(),
        baseline: decision.baseline,
        adjusted: decision.adjusted,
        direction: decision.direction,
        reasons: decision.reasons,
        applied: decision.adjusted !== decision.baseline,
        evidence: {
          ...decision.evidence,
          delta: decision.delta,
          cap: decision.cap,
          capSource: decision.capSource,
          // 投影层不带 capApplied，这里按同一口径复算（是否被上限封住）
          capBound: decision.adjusted === decision.cap,
          deliveryMode: 'prompt-injection',
          hasRandomizedControl: false,
        } as unknown as Record<string, unknown>,
      });
    } catch (error) {
      logger.warn('[AITeaching] 难度锚点留痕失败（不阻断开课）', {
        userId: context.userId,
        taskId: context.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    /** 课内温故计划（记忆层）：日常课开场回捞的到期旧知；无到期点或复习课为 null */
    memoryWarmup?: ReviewPlan | null;
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
    // 分层边界：到期旧知属「记忆层」（用户级、天然跨 path），只在该课复习模式（上方 mode==='review'）
    // 或 GET /ai-teaching/review/due「今日复习」出口呈现；不再注入日常课的「本节知识点」看板，
    // 否则别的 path 的到期点会串进本节清单，并被前端误显示为「进行中 · x%」。
    const sessionId = buildSessionId(input.userId);
    // 课内温故（记忆层 · 认知负担动态调整）：日常课在**本节开头**花 1–2 分钟回捞到期旧知，
    // 而不是让用户额外开一节复习课（依从性：复习不该需要用户做决定）。
    // 配额按负担预算动态裁剪（由课内检索成功率回校准）；复习课模式已在上面走到期点注入，不叠加。
    let memoryWarmup: ReviewPlan | null = null;
    if (input.mode !== 'review') {
      try {
        // 范围口径（只当前路径）：温故只回捞本节所属路径的旧知（历史行无来源路径时仍可复习）
        const plan = await reviewPlanService.buildReviewPlan(input.userId, {
          pathId: context.learningPathId ?? null,
        });
        if (plan.items.length > 0) {
          memoryWarmup = plan;
          context.memoryWarmup = plan;
        }
      } catch (error) {
        logger.warn('[AITeaching] 课内温故计划生成失败，本节不温故（不阻断开课）', {
          userId: input.userId,
          taskId: input.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
        memoryWarmup = null;
      }
    }
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
      teachingState: memoryWarmup ? { sessionArtifacts: { memoryWarmup } } : null,
    }, RECOVERY_WINDOW_MS);

    // 当日温故额度记账（跨会话共享：一天多节课不会把温故量放大；超额部分顺延到明天）。
    // fire-and-forget：记账失败只 warn，不阻断开课。
    if (reservation.created && memoryWarmup && memoryWarmup.items.length > 0) {
      void reviewQuotaService
        .reserveDailyQuota(input.userId, {
          sessionId: reservation.session.id,
          load: memoryWarmup.usedLoad,
          keys: memoryWarmup.items.map((item) => item.conceptKey),
        })
        .catch(() => null);
    }

    if (!reservation.created) {
      if (reservation.session.status === 'initializing' || reservation.session.status === 'finalizing') {
        throw new TeachingSessionConflictError('课堂正在启动或结束，请稍后重试', 'TEACHING_SESSION_BUSY');
      }

      const claim = await teachingSessionRepository.claimOperation(
        reservation.session.id,
        'resume',
        ['active', 'paused', 'timeout']
      );
      // P2：恢复分支同样要跑 LLM 上下文构建，短租期内必须续租
      const resumeLeaseGuard = new TeachingOperationLeaseGuard(reservation.session.id, claim.operationId);
      resumeLeaseGuard.start();
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
          memoryWarmup: (sessionArtifacts.memoryWarmup as ReviewPlan | undefined) ?? null,
          scene: buildSessionOpeningScene({ mode: 'resumed', context: resumedContext, sameTaskAttempt }),
        };
      } finally {
        resumeLeaseGuard.stop();
        if (!committed) {
          await teachingSessionRepository.releaseOperation(claim.session.id, claim.operationId);
        }
      }
    }

    const operationId = reservation.operationId as string;
    // P2：开课初始化含 opening LLM 调用，短租期内必须续租
    const initLeaseGuard = new TeachingOperationLeaseGuard(sessionId, operationId);
    initLeaseGuard.start();
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
            current: initialClassroomStage(),
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
            stage: initialClassroomStage(),
            reason: '新课堂启动，进入开场定位',
            enteredAt: new Date().toISOString(),
          },
        ],
        teachingControlContext: buildTeachingControlContext(
          initialClassroomStage(),
          context,
          buildLearnerStateContext(context, null),
          {},
        ),
        sessionArtifacts: {
          // 计划在 reserve 时建立；这里必须保留（此前整段重写把计划抹掉，导致首个回合就没有温故）
          ...(memoryWarmup ? { memoryWarmup } : {}),
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

      // 难度调整锚点：开课时留痕一次（幂等键 = taskId），使效果度量能在真实课上运行
      await this.recordTaskDifficultyAnchor(context, session.id);

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
        memoryWarmup,
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
    } finally {
      initLeaseGuard.stop();
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
        OPENING_GENERATION_TIMEOUT_MS,
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
    // P2：回合期间心跳续租。操作租约已缩短到 2 分钟，教学回合可能含多次 LLM 调用跑几分钟，
    // 不续租会被并发请求误判为陈旧而抢占（进程崩溃则无人续租，最多 2 分钟自动释放）。
    const operationLeaseGuard = new TeachingOperationLeaseGuard(sessionId, operationClaim.operationId);
    operationLeaseGuard.start();
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
    // 课内温故：计划持久化在 sessionArtifacts（开课时建立、随回合合并结果），
    // 而 context 每回合重建 → 必须回填，否则模型永远拿不到温故计划、结果也摘不到。
    const turnMemoryWarmup = resolveTurnMemoryWarmup(sessionArtifacts);
    if (turnMemoryWarmup) {
      context.memoryWarmup = turnMemoryWarmup;
    }
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
    // 课内温故结果回收：**首选**模型的结构化结果 control.warmupOutcomes（2026-09-17 起），
    // 兼容它仍按「计划里的原名字」写进 knowledge.points 的老行为。
    // 必须在 reconcileTeachingKnowledgeState 的 slice(0,5) 截断**之前**从原始输出里摘——
    // 模型通常把温故点排在本节点之后，先截断会直接丢掉温故结果。
    const rawPoints = Array.isArray(rawTeachingOutput?.knowledge?.points) ? rawTeachingOutput.knowledge.points : [];
    const warmupOutcomes = extractWarmupOutcomes(
      context.memoryWarmup,
      rawPoints,
      rawTeachingOutput?.control?.warmupOutcomes,
    );
    // 待回捞点数（模型看到的那份视图）：用于"该报却没报"的告警口径
    const pendingItems = pendingWarmupForModel(context.memoryWarmup)?.items.length ?? 0;
    const rawBoardOutput = rawPoints.length > 0
      ? {
          ...rawTeachingOutput,
          knowledge: { ...rawTeachingOutput.knowledge, points: stripWarmupPoints(context.memoryWarmup, rawPoints) },
        }
      : rawTeachingOutput;
    const { teachingOutput, existingPoints } = reconcileTeachingKnowledgeState(context, rawBoardOutput, frozenKnowledgeState);
    // 到期旧知与本节看板物理分离（历史事故 2e3ca16：跨 path 到期点串进「本节知识点」被
    // 误显示为「进行中 · x%」，导致课内复习整体下线）：温故点只进 sessionArtifacts.memoryWarmup，
    // 收束时回写记忆引擎（FSRS 重排 dueAt + 落 learner_evidence 供动态预算回校准）。
    const mergedKnowledge = normalizeFrozenKnowledgeState(
      effectiveInitialKnowledgeState,
      knowledgeStateService.merge(
        existingPoints,
        teachingOutput.knowledge.points,
        session.mode === 'review' // 复习课允许 mastered 降级：复习失败在掌握度数据上真实可见
      )
    );
    // 收束判定锚定「冻结目标集」而非每轮合并后的膨胀集合：
    // 目标集在开课（有种子）或首个教学回合冻结，之后模型新增/改名的点不再抬高门槛；
    // 目标点达到 mastered 或进度≥阈值即视为可收束。envelope phase 仍仅作观测 soft 信号。
    const frozenTargetsBefore = parseSessionArtifacts(previousTeachingState).completionTargets;
    const targetsFrozenBefore = Array.isArray(frozenTargetsBefore) && frozenTargetsBefore.length > 0;
    const completionTargets = knowledgeStateService.resolveCompletionTargets(
      frozenTargetsBefore,
      effectiveInitialKnowledgeState,
      mergedKnowledge,
    );
    // 首回合只冻结目标集、不判完成：避免开课注入的到期复习点（retention≥阈值）
    // 在学员尚未参与任何交互时就把课判成「可收束」。
    const targetsConsolidated = targetsFrozenBefore
      && knowledgeStateService.areTargetsConsolidated(completionTargets, mergedKnowledge);
    // 兜底：回合足够多、无 pending、目标集均分达标 → 放行，保证课堂不会「永不收敛」
    const teachingTurns = session.messages.filter((message) => message.role === 'assistant').length;
    const backstopReady = targetsFrozenBefore
      && teachingTurns >= COMPLETION_TURNS_BACKSTOP
      && mergedKnowledge.every((point) => point.status !== 'pending')
      && knowledgeStateService.averageTargetProgress(completionTargets, mergedKnowledge) >= COMPLETION_TARGET_PROGRESS_FLOOR;
    const completionReady = targetsConsolidated || backstopReady;
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
        // 策略由代码按认知层级选定（prompt 规则 38 只负责"怎么说"）：
        // 此前硬编码 'feynman'，使「understand→类比 / apply→反例 / analyze+→辩论」永不触发（§3.19 P0②）。
        strategy: pickPeerStrategy(teachingOutput.analysis.cognitiveLevel),
        studentMessage: message,
        tutorContext: updatedMessages.slice(-6).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        cognitiveLevel: teachingOutput.analysis.cognitiveLevel,
        understanding: teachingOutput.analysis.understanding,
        // 规则 41 的"高负荷/受挫"分支需要这两个字段才可达（此前未提供）
        loadIndex: teachingOutput.analysis.loadIndex ?? null,
        emotionalState: teachingOutput.analysis.emotionalState ?? null,
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

      const turnState: Record<string, any> = {
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
        // 课内温故：① 标记"模型真的问出来了"（含 review/pending——问过 ≠ 有结果）
        // ② 合并实测结果；计划其余部分原样保留（含负担预算与积压计数）
        ...(() => {
          const persistedPlan =
            parseSessionArtifacts(session.teachingState).memoryWarmup || context.memoryWarmup;
          if (!persistedPlan) return {};
          const asked = markWarmupAsked(persistedPlan, rawPoints, new Date().toISOString());
          const merged = warmupOutcomes.length > 0
            ? mergeWarmupOutcomes(asked, warmupOutcomes, new Date().toISOString())
            : asked;
          // 采样率可观测（2026-09-17）：结构化通道是温故结果的唯一可靠来源，
          // 因此"模型报了几条 / 代码落地几条 / 丢弃几条"必须留痕——否则丢样本只能靠事后猜。
          if (Array.isArray(rawTeachingOutput?.control?.warmupOutcomes) && rawTeachingOutput.control.warmupOutcomes.length > 0) {
            const reported = rawTeachingOutput.control.warmupOutcomes.length;
            const settled = (merged?.items || []).filter((item) => item?.outcome?.status).length;
            logger.info('[AITeaching] 温故结构化结果', {
              sessionId,
              reported,
              extracted: warmupOutcomes.length,
              settled,
              dropped: reported - warmupOutcomes.length,
              recalls: rawTeachingOutput.control.warmupOutcomes.map((entry: any) => entry?.recall ?? null),
            });
          } else if (pendingItems > 0) {
            // 有待回捞点却没报结构化结果 → 可能是"这轮刚问、学生还没答"（正常），也可能是真丢样本。
            // 只在**学生确有机会作答**时告警：该点此前已被问过（askedAt）且其后有学生发言。
            const askedEarlier = (persistedPlan.items || []).filter((item) => item?.askedAt && !item?.outcome?.status);
            const hadAnswerChance = askedEarlier.some((item) => (session.messages || []).some((message) => {
              if (message?.role !== 'user') return false;
              const at = Date.parse(String(message.timestamp || ''));
              return Number.isFinite(at) && at > Date.parse(String(item.askedAt));
            }));
            if (hadAnswerChance) {
              logger.warn('[AITeaching] 学生已作答但模型未报 control.warmupOutcomes（温故结果丢失）', {
                sessionId,
                pendingItems,
              });
            }
          }
          return merged ? { memoryWarmup: merged } : {};
        })(),
        // 冻结的收束目标集：只增一次，后续回合沿用（防止目标集随模型新增/改名膨胀）
        completionTargets,
        pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(context),
        endReason: endIntent.isEndIntent
          ? 'learner-requested-end'
          : completionReady
            ? 'completion-candidate'
            : parseSessionArtifacts(session.teachingState).endReason,
      },
      };
      // 继承上一回合顶层状态后再覆盖本回合字段：否则 pendingCheckpoint / lastCheckpointTurn /
      // checkpointHistory 会在每次重建时丢失（18 号报告 N2）。
      const teachingState: Record<string, any> = inheritTeachingState(previousTeachingState, turnState);

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
          // 答案键（服务端保存，客户端投影会剥离）：用于代码裁决，保证"对错"不来自模型自评
          ...(checkpointCandidate.correctOptionIds?.length ? { correctOptionIds: checkpointCandidate.correctOptionIds } : {}),
          ...(checkpointCandidate.expectedKeywords?.length ? { expectedKeywords: checkpointCandidate.expectedKeywords } : {}),
        };
        teachingState.lastCheckpointTurn = updatedMessages.length;
      }

      let checkpointResolution: { passed: boolean; understanding: number; judgedBy: 'code' | 'model-reference' } | undefined;
      if (submittedCheckpoint) {
        const understanding = Number(teachingOutput.analysis?.understanding ?? 0);
        const currentPoint = effectiveTeachingOutput.knowledge.currentPoint?.trim().toLowerCase();
        const modelDerivedPassed = completionReady || !!currentPoint && mergedKnowledge.some(
          (point) => point.name.trim().toLowerCase() === currentPoint && point.status === 'mastered'
        );
        // 独立传感器优先（2026-09-17）：有答案键就按**代码裁决**，否则退回模型派生并如实标注来源
        const codeJudgement = options.checkpointJudgement ?? null;
        const judgedBy: 'code' | 'model-reference' = codeJudgement?.judgedBy === 'code' ? 'code' : 'model-reference';
        const passed = judgedBy === 'code' ? codeJudgement!.passed : modelDerivedPassed;
        const checkpointHistory = Array.isArray(teachingState.checkpointHistory)
          ? [...teachingState.checkpointHistory]
          : [];
        checkpointHistory.push({
          checkpointId: submittedCheckpoint.id,
          // title/type 一并留档（2026-09-17）：此前只记 id/passed，读侧无法知道"没通过的是什么题"
          title: submittedCheckpoint.title,
          type: submittedCheckpoint.type,
          submittedAt: new Date().toISOString(),
          passed,
          judgedBy,
          understanding,
        });

        // 检查点结果留痕（learner_evidence）：独立传感器的原始观测，供 §7 P1-1 的成功率带与控制律消费
        void recordCheckpointResultEvidence(session, submittedCheckpoint, {
          passed,
          judgedBy,
          detail: codeJudgement?.detail ?? null,
          submission: { selectedOptionIds: options.checkpointSubmission?.selectedOptionIds },
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
        checkpointResolution = { passed, understanding, judgedBy };
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
        })), session.learningPathId ?? null).catch((error) => {
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
        checkpoint: checkpointForMessageResult(teachingState),
        checkpointResolution,
        revision: session.revision + 1,
      };

      return baseResult;
    } finally {
      operationLeaseGuard.stop();
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
      const thresholdAdvisory = replanAdvisoryService.build({
        wrapup: persistedWrapup,
        learnerReplanProjection,
        nextMilestone: nextMilestone ? {
          milestoneId: nextMilestone.milestoneId,
          title: nextMilestone.title,
          goal: nextMilestone.goal,
          totalTasks: nextMilestone.totalTasks,
        } : null,
      });
      // 归因层（阈值召回 + LLM 归因）：只在建议已成立时补"为什么"，失败/超时保留阈值版
      let advisory = thresholdAdvisory;
      if (thresholdAdvisory.shouldSuggest) {
        // 会话作用域：让 aux skill 的 LLM 调用带上 sessionId（成本可归到这节课，审计 §5.2 P2）
        const attribution = await runWithTeachingSession(session.id, () => replanAttributionService.attribute({
          // 召回与动作**同源**（都来自最终 advisory）：此前取信号层 signal，与 allowedRecommendations
          // 属两套阈值，会导致"允许的动作没有对应原因码"（§3.19 P1⑦）
          recall: toAttributionRecall(thresholdAdvisory),
          allowedRecommendations: thresholdAdvisory.ui.options
            .map((option) => option.key)
            .filter((key) => ['keep', 'reinforce', 'slow_down', 'resequence', 'accelerate'].includes(key)),
          evidence: buildReplanAttributionEvidence({
            wrapup: persistedWrapup,
            learnerReplanProjection,
            nextMilestoneTitle: nextMilestone?.title ?? null,
          }),
          pathContext: {
            milestoneTitle: learnerReplanProjection?.path?.currentPosition?.milestoneTitle ?? null,
            stageNumber: currentStageNumber,
          },
        }));
        advisory = replanAdvisoryService.applyAttribution(thresholdAdvisory, attribution);
        if (advisory.attribution?.claim && isCalibratableDirection(advisory.recommendation)) {
          // 可证伪断言单独成列（insightType=replan_attribution），不与状态评审的可靠性混算
          await insightCalibrationService.recordInsights(session.userId, session.learningPathId || null, [{
            claim: advisory.attribution.claim,
            insightType: 'replan_attribution',
            conceptKeys: [
              ...(learnerReplanProjection?.mastery?.fragileConcepts ?? []).slice(0, 2),
              ...(learnerReplanProjection?.mastery?.strugglingConcepts ?? []).slice(0, 2),
            ],
            predictedAt: new Date().toISOString(),
          }]).catch(() => []);
        }
      }
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

      // 课后刷新统一包进「当前教学会话」作用域：这些 aux skill 的 LLM 调用据此可归到本节
      // （此前不传 sessionId，成本落在 agent_call_logs 的"(无会话)"栏——审计 §5.2 P2 尾巴）
      runWithTeachingSession(session.id, () => dashboardGuidanceSnapshotService.refreshInBackground(session.userId, 'lesson-wrapup'));
      runWithTeachingSession(session.id, () => learnerStateReviewService.refreshInBackground(session.userId));
      // 概念身份归并（记忆层维护 · 默认观察模式）：课后顺带看一眼是否有同义重复知识点
      runWithTeachingSession(session.id, () => conceptConsolidatorService.refreshInBackground(session.userId));
      // 概念负担档位预热：把 LLM 判定挪出开课关键路径（下节课直接命中缓存）
      runWithTeachingSession(session.id, () => conceptLoadService.warmInBackground(session.userId));
      // 记忆引擎 M2：课后按知识看板状态确定性回写内化强度（best-effort，失败不阻断课堂完成）
      const calibrationBias = learnerSnapshot?.profile?.cognitive?.selfAssessmentAccuracy ?? 'accurate';
      memoryTraceService.recordSessionOutcome(
        session.userId,
        session.knowledgeState,
        'derived',
        calibrationBias,
        // 记忆条目的来源路径：用于温故解释"这是你在《X》里学过的"，以及按路径看待办
        session.learningPathId ?? null,
      ).catch((error) => {
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
      state: stripCheckpointAnswerKeys(session.teachingState || {}),
      knowledgePoints: session.knowledgeState,
      wrapup: session.wrapup,
      advisory: (session.advisory as ReplanAdvisory | null) || null,
      // 答案键剔除后再给客户端：它只用于服务端代码裁决（审计 §7 P1-1）
      pendingCheckpoint: stripCheckpointAnswerKeys({ pendingCheckpoint: getPendingCheckpoint(session.teachingState) }).pendingCheckpoint ?? null,
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
          title: checkpoint.title,
          type: checkpoint.type,
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
        {
          operationClaim,
          checkpointId,
          // 代码裁决（答案键存在时）：把"对错"从模型自评里剥离出来（审计 §7 P1-1）
          checkpointJudgement: judgeCheckpointAnswer(checkpoint, payload),
          checkpointSubmission: {
            selectedOptionIds: payload.selectedOptionIds,
            // 简答不落原文（可能含学生隐私细节），只留长度特征
            ...(payload.answerText ? { answerText: undefined } : {}),
          },
        }
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
        endTime: simulatedNowOr(),
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
          fsrsLapses: true,
          fsrsReps: true,
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
            reps: t.fsrsReps ?? t.extractionCount,
            lapses: t.fsrsLapses ?? 0,
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
      // 兜底收尾也要回写课内温故（18 号报告 N10）：课上作答后直接超时/放弃，
      // 温故结果此前永不落地（正常 end_only / complete_task 路径早已回写）。失败不影响兜底。
      await applyWarmupExtractionForSession(session);
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

    const peerState = (session.teachingState as any)?.analysis ?? {};
    const peerResult = await executeSkill(peerAgentDefinition, {
      input: {
        topic: session.topic,
        strategy: pickPeerStrategy(peerState.cognitiveLevel),
        studentMessage: message,
        tutorContext: session.messages.slice(-6).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        cognitiveLevel: peerState.cognitiveLevel,
        understanding: peerState.understanding,
        loadIndex: peerState.loadIndex ?? null,
        emotionalState: peerState.emotionalState ?? null,
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
