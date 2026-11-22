/* eslint-disable @typescript-eslint/no-explicit-any -- 边界解析 LLM/JSON 动态载荷，形状由上游契约与运行时校验兜底 */
/**
 * 延迟保持探针（2026-11-19）
 *
 * 目的：课末契约/终检证明的是「当下能独立做对」；24–72 小时后还能不能提取出来，
 * 是另一件事。本服务在正课收束后，为核心 KC 排一个**窗口内**的单点探针：
 *   - 排期：课后 24–72h 之间（按 session+concept 确定性散开，避免全堆在同一时刻）；
 *   - 出题：到期时用 aux skill `teaching-retention-probe` 生成一道新情境单点题；
 *   - 判分：服务端答案键 + `judgeCheckpointAnswer` 确定性裁决（不把答案键下发）；
 *   - 失败：走与复习事件同一条 canonical 口径降级 `memory_traces`
 *     （rating=again → mastery 0.35 / stability=fragile / FSRS 稳定性塌缩 / 到期提前），
 *     并写 `retention:probe:result` 证据；通过只记证据，不额外抬掌握度。
 *
 * 持久化复用 `learner_projections`（scope='retention-probe'），不新增表：
 * 探针是「课后派生的待办状态」，不是新的领域实体；答案键只存在服务端 payload 里。
 */
import crypto from 'node:crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { getSimulatedAsOf, simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { resolveUserSimulatedNow } from '../virtual-lab/simulation-clock-resolver';
import { executeSkill, auxSkillDefinitionMap } from '../../skills';
import { normalizeConceptKey } from '../memory/memory-trace.service';
import type { LessonReport } from '../ai-teaching/lesson-contract';
import { parseExitTicketSubmission } from '../ai-teaching/lesson-contract';
import { isDuplicateCheckpointQuestion, judgeCheckpointAnswer } from '../ai-teaching/teaching-checkpoint';
import { parseAssessmentQuestion, type AssessmentQuestion } from '../../utils/assessment-question';
import { reviewCompletedConsumer, type ReviewApplySummary } from './ReviewCompletedConsumer';
import type { DurableDomainEvent } from '../../events/contracts';

export const RETENTION_PROBE_MIN_HOURS = 24;
export const RETENTION_PROBE_MAX_HOURS = 72;
export const RETENTION_PROBE_MAX_PER_LESSON = 3;
export const RETENTION_PROBE_SCOPE = 'retention-probe';
/** 未通过时按「复习未答出」的 canonical 掌握度（与 mapKnowledgeStatusToMastery('review',0) 同值） */
export const RETENTION_PROBE_FAILED_MASTERY = 0.35;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PLACEHOLDER_RE = /^concept-\d+$/i;

export interface RetentionProbeQuestion extends AssessmentQuestion {
  conceptName: string;
}

export interface RetentionProbeResult {
  passed: boolean;
  judgedBy: string;
  detail: string;
  answerExcerpt: string;
  answeredAt: string;
}

export interface RetentionProbeRecord {
  id: string;
  userId: string;
  conceptKey: string;
  label: string;
  pathId?: string | null;
  taskId?: string | null;
  sessionId: string;
  subject?: string;
  topic?: string;
  taskTitle?: string;
  /** 原课收束时刻（窗口起点 = +24h，终点 = +72h） */
  lessonAt: string;
  scheduledAt: string;
  windowEndsAt: string;
  status: 'pending' | 'passed' | 'failed' | 'expired';
  question?: RetentionProbeQuestion | null;
  askedAt?: string | null;
  answeredAt?: string | null;
  attempts: number;
  result?: RetentionProbeResult | null;
  createdAt: string;
  updatedAt: string;
}

/** 对外视图：绝不下发答案键 */
export interface RetentionProbePublicView {
  id: string;
  conceptKey: string;
  label: string;
  scheduledAt: string;
  windowEndsAt: string;
  attempts: number;
  question: {
    question: string;
    type: RetentionProbeQuestion['type'];
    options?: Array<{ id: string; text: string }>;
  };
}

export interface ScheduleRetentionProbesInput {
  userId: string;
  sessionId: string;
  pathId?: string | null;
  taskId?: string | null;
  subject?: string;
  topic?: string;
  taskTitle?: string;
  lessonReport?: LessonReport | null;
  knowledgeState?: Array<{ name?: unknown; status?: unknown; progress?: unknown }> | null;
  /** 测试/补排用：窗口从该时刻起算（缺省 = 模拟时钟 now） */
  lessonAt?: Date;
}

export interface ScheduleRetentionProbesResult {
  scheduled: number;
  skipped: number;
}

export interface RetentionProbeDeps {
  findProjection: (projectionKey: string, userId: string) => Promise<{ projectionKey: string; payload: string } | null>;
  listProjections: (userId: string) => Promise<Array<{ projectionKey: string; payload: string }>>;
  createProjection: (row: { projectionKey: string; userId: string; pathId: string | null; payload: string }) => Promise<void>;
  updateProjection: (projectionKey: string, payload: string) => Promise<void>;
  loadLessonQuestions: (sessionId: string, userId: string) => Promise<string[] | null>;
  generateQuestion: (input: {
    subject: string;
    topic: string;
    taskTitle: string;
    conceptName: string;
    priorQuestions: string[];
  }) => Promise<RetentionProbeQuestion | null>;
  writeEvidence: (input: {
    probe: RetentionProbeRecord;
    passed: boolean;
    judgedBy: string;
    detail: string;
    occurredAt: Date;
  }) => Promise<void>;
  /** 探针作答走 review:completed 事件驱动记忆台账；返回应用摘要供状态口径区分「真应用」与「被去重」 */
  applyFailedProbe: (probe: RetentionProbeRecord, occurredAt: Date) => Promise<ReviewApplySummary>;
  /** 通过时也推进 FSRS（成功提取应延长间隔、更新 lastSeenAt），但不额外抬高掌握度 */
  applyPassedProbe: (probe: RetentionProbeRecord, occurredAt: Date) => Promise<ReviewApplySummary>;
  now: () => Date;
}

function stableHash(input: string): number {
  // FNV-1a 32-bit：确定性、无依赖；只用于把探针散到窗口内。
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 探针排期小时数：24–72（含 24，不含 72），同 session+concept 恒定。 */
export function retentionProbeDelayHours(sessionId: string, conceptKey: string): number {
  const span = RETENTION_PROBE_MAX_HOURS - RETENTION_PROBE_MIN_HOURS;
  return RETENTION_PROBE_MIN_HOURS + (stableHash(`${sessionId}|${normalizeConceptKey(conceptKey)}`) % span);
}

/** 探针 id：同一节课同一概念只排一次（幂等）。 */
export function retentionProbeIdFor(sessionId: string, conceptKey: string): string {
  const digest = crypto.createHash('sha1')
    .update(`${sessionId}|${normalizeConceptKey(conceptKey)}`)
    .digest('hex')
    .slice(0, 16);
  return `rp_${digest}`;
}

function isRealConceptName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  return !PLACEHOLDER_RE.test(trimmed);
}

/**
 * 从课堂契约与知识看板挑探针目标（纯函数）。
 * 优先级：已有独立证据的核心 KC → 看板 mastered → 高进度 learning；上限 3 个。
 * 未覆盖/无可回捞证据的点不做延迟探针（那是复习计划的职责，不是保持测量）。
 */
export function selectRetentionProbeConcepts(input: {
  lessonReport?: LessonReport | null;
  knowledgeState?: Array<{ name?: unknown; status?: unknown; progress?: unknown }> | null;
}): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  const push = (name: unknown) => {
    if (!isRealConceptName(name)) return;
    const key = normalizeConceptKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    picked.push(name.trim());
  };
  const report = input.lessonReport || null;
  for (const name of report?.independentKcs || []) push(name);
  const board = Array.isArray(input.knowledgeState) ? input.knowledgeState : [];
  for (const item of board) {
    if (String(item?.status || '') !== 'mastered') continue;
    push(item?.name);
  }
  for (const item of board) {
    const status = String(item?.status || '');
    const progress = Number(item?.progress);
    if (status !== 'learning' || !Number.isFinite(progress) || progress < 60) continue;
    push(item?.name);
  }
  return picked.slice(0, RETENTION_PROBE_MAX_PER_LESSON);
}

function parsePayload(payload: string): RetentionProbeRecord | null {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string' || typeof parsed.conceptKey !== 'string') return null;
    return parsed as RetentionProbeRecord;
  } catch {
    return null;
  }
}

function projectionKeyFor(probeId: string): string {
  return `${RETENTION_PROBE_SCOPE}:${probeId}`;
}

/** 该探针是否已进入可作答窗口（到期且未过 72h 上限）。 */
export function isRetentionProbeDue(probe: Pick<RetentionProbeRecord, 'status' | 'scheduledAt' | 'windowEndsAt'>, now: Date): boolean {
  if (probe.status !== 'pending') return false;
  const scheduledAt = new Date(probe.scheduledAt).getTime();
  const windowEndsAt = new Date(probe.windowEndsAt).getTime();
  const at = now.getTime();
  return Number.isFinite(scheduledAt) && Number.isFinite(windowEndsAt)
    && at >= scheduledAt && at <= windowEndsAt;
}

export function isRetentionProbeExpired(probe: Pick<RetentionProbeRecord, 'status' | 'windowEndsAt'>, now: Date): boolean {
  if (probe.status !== 'pending') return false;
  const windowEndsAt = new Date(probe.windowEndsAt).getTime();
  return Number.isFinite(windowEndsAt) && now.getTime() > windowEndsAt;
}

/** 对外视图（剥掉答案键）。 */
export function toRetentionProbePublicView(probe: RetentionProbeRecord): RetentionProbePublicView {
  const question = probe.question as RetentionProbeQuestion;
  return {
    id: probe.id,
    conceptKey: probe.conceptKey,
    label: probe.label,
    scheduledAt: probe.scheduledAt,
    windowEndsAt: probe.windowEndsAt,
    attempts: probe.attempts,
    question: {
      question: question.question,
      type: question.type,
      ...(question.type !== 'short_answer' && Array.isArray(question.options)
        ? { options: question.options.map((option) => ({ id: option.id, text: option.text })) }
        : {}),
    },
  };
}

function coerceQuestion(raw: any, conceptName: string): RetentionProbeQuestion | null {
  const out = raw?.output ?? raw;
  const question = parseAssessmentQuestion(out);
  if (!question || normalizeConceptKey(out.conceptName) !== normalizeConceptKey(conceptName)) return null;
  return { ...question, conceptName };
}

/** null 表示无法核对原题。有效的课堂状态可以没有出过题。 */
export function readLessonQuestions(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const state = JSON.parse(value);
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
    const artifacts = state.sessionArtifacts;
    const checkpoints = state.checkpointHistory ?? [];
    const tickets = artifacts?.exitTicketHistory ?? [];
    if (!Array.isArray(checkpoints) || !Array.isArray(tickets)) return null;
    const rows = [...checkpoints, ...tickets, state.pendingCheckpoint, artifacts?.pendingCheckpoint, artifacts?.exitTicket]
      .filter((row, index) => index < checkpoints.length + tickets.length || row != null);
    const questions = rows.map((row) => typeof row?.question === 'string' ? row.question.trim() : '');
    if (questions.some((question) => !question)) return null;
    return [...new Set(questions)];
  } catch {
    return null;
  }
}

function isRepeatedLessonQuestion(priorQuestions: string[], question: AssessmentQuestion): boolean {
  return isDuplicateCheckpointQuestion(priorQuestions.map((prior) => ({ question: prior })), question.question);
}

const defaultDeps: RetentionProbeDeps = {
  findProjection: async (projectionKey, userId) => prisma.learner_projections.findFirst({
    where: { projectionKey, userId },
    select: { projectionKey: true, payload: true },
  }),
  listProjections: async (userId) => prisma.learner_projections.findMany({
    where: { userId, scope: RETENTION_PROBE_SCOPE },
    select: { projectionKey: true, payload: true },
  }),
  createProjection: async (row) => {
    await prisma.learner_projections.create({
      data: {
        id: `lp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        projectionKey: row.projectionKey,
        userId: row.userId,
        scope: RETENTION_PROBE_SCOPE,
        pathId: row.pathId,
        payload: row.payload,
      },
    });
  },
  updateProjection: async (projectionKey, payload) => {
    await prisma.learner_projections.update({
      where: { projectionKey },
      data: { payload, version: { increment: 1 } },
    });
  },
  loadLessonQuestions: async (sessionId, userId) => {
    const lesson = await prisma.teaching_sessions.findFirst({ where: { id: sessionId, userId }, select: { teachingState: true } });
    return readLessonQuestions(lesson?.teachingState ?? null);
  },
  generateQuestion: async (input) => {
    const definition = auxSkillDefinitionMap['teaching-retention-probe'];
    if (!definition) return null;
    const result: any = await executeSkill(definition, {
      subject: input.subject,
      topic: input.topic,
      taskTitle: input.taskTitle,
      coreKcs: [{ name: input.conceptName, hasIndependentEvidence: true }],
      recentDialogue: input.priorQuestions.slice(-8).map((content) => ({ role: 'assistant', content })),
    } as any);
    if (result?.success === false) {
      throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'RETENTION_PROBE_FAILED');
    }
    return coerceQuestion(result, input.conceptName);
  },
  writeEvidence: async ({ probe, passed, judgedBy, detail, occurredAt }) => {
    const eventId = `retention-probe:${probe.id}`;
    await prisma.learner_evidence.upsert({
      where: { eventId_evidenceKey: { eventId, evidenceKey: 'retention:probe:result' } },
      create: {
        id: `ev_rp_${probe.id}`,
        eventId,
        evidenceKey: 'retention:probe:result',
        userId: probe.userId,
        pathId: probe.pathId ?? null,
        taskId: probe.taskId ?? null,
        sessionId: probe.sessionId,
        evidenceType: 'retention:probe:result',
        payload: JSON.stringify({
          probeId: probe.id,
          conceptKey: probe.conceptKey,
          label: probe.label,
          passed,
          judgedBy,
          detail,
          scheduledAt: probe.scheduledAt,
          windowEndsAt: probe.windowEndsAt,
          lessonAt: probe.lessonAt,
          answeredAt: occurredAt.toISOString(),
          attempts: probe.attempts,
        }),
        confidence: passed ? 0.9 : 0.6,
        occurredAt,
      },
      update: {
        payload: JSON.stringify({
          probeId: probe.id,
          conceptKey: probe.conceptKey,
          label: probe.label,
          passed,
          judgedBy,
          detail,
          scheduledAt: probe.scheduledAt,
          windowEndsAt: probe.windowEndsAt,
          lessonAt: probe.lessonAt,
          answeredAt: occurredAt.toISOString(),
          attempts: probe.attempts,
        }),
        confidence: passed ? 0.9 : 0.6,
        occurredAt,
      },
    });
  },
  /**
   * 失败降级走复习事件的同一条 canonical 口径：rating=again / status=review / progress=0
   * → mastery 0.35、stability=fragile、FSRS 稳定性塌缩、dueAt 提前、lapses+1。
   * 同时写入 review:completed 证据（与真实复习一致，便于复用审计/成功率统计）。
   */
  applyPassedProbe: async (probe, occurredAt) => {
    // 通过 = 一次成功提取：按既有掌握度（不低于 0.7）记 Good，推进 FSRS 间隔；
    // 不把「24–72h 还记得」误写成「掌握度直接拉满」。
    const trace = await prisma.memory_traces.findUnique({
      where: { userId_conceptKey: { userId: probe.userId, conceptKey: probe.conceptKey } },
      select: { masteryScore: true },
    });
    const masteryScore = Math.max(0.7, Number(trace?.masteryScore) || 0);
    const progress = Math.max(0, Math.min(100, Math.round(((masteryScore - 0.3) / 0.55) * 100)));
    const event: DurableDomainEvent = {
      id: `retention-probe:${probe.id}`,
      type: 'review:completed',
      schemaVersion: 1,
      aggregateType: 'review',
      aggregateId: probe.id,
      userId: probe.userId,
      source: 'retention-probe',
      occurredAt,
      data: {
        sessionId: probe.sessionId,
        mode: 'retention-probe',
        pathId: probe.pathId ?? null,
        // 独立作答身份（外部评审 P1.1）：探针事件仍带原课堂 sessionId，但必须凭此字段
        // 绕开「同会话同概念只记一次」的课堂温故稳定键，独立驱动 FSRS/记忆台账。
        reviewAttemptId: probe.id,
        reviewItems: [{
          conceptKey: probe.conceptKey,
          label: probe.label,
          status: 'learning',
          progress,
          masteryScore,
          rating: 'good',
        }],
      },
    };
    return await reviewCompletedConsumer.applyReview(event);
  },
  applyFailedProbe: async (probe, occurredAt) => {
    const event: DurableDomainEvent = {
      id: `retention-probe:${probe.id}`,
      type: 'review:completed',
      schemaVersion: 1,
      aggregateType: 'review',
      aggregateId: probe.id,
      userId: probe.userId,
      source: 'retention-probe',
      occurredAt,
      data: {
        sessionId: probe.sessionId,
        mode: 'retention-probe',
        pathId: probe.pathId ?? null,
        // 同 applyPassedProbe：独立作答身份，绕开课堂温故稳定键（外部评审 P1.1）
        reviewAttemptId: probe.id,
        reviewItems: [{
          conceptKey: probe.conceptKey,
          label: probe.label,
          status: 'review',
          progress: 0,
          masteryScore: RETENTION_PROBE_FAILED_MASTERY,
          rating: 'again',
        }],
      },
    };
    return await reviewCompletedConsumer.applyReview(event);
  },
  now: () => simulatedNowOr(),
};

export class RetentionProbeService {
  constructor(private readonly overrides: Partial<RetentionProbeDeps> = {}) {}

  private get deps(): RetentionProbeDeps {
    return { ...defaultDeps, ...this.overrides };
  }

  /**
   * 读侧时间口径：到期/过期必须跟学习者自己的时钟走。
   * 仿真学习者在本进程外的 HTTP 请求里没有模拟钟 ALS；只读墙钟会把「模拟日 2 天后」
   * 的探针直接判成过期（实测 clean 跑批：10-09 排的探针在 11-19 墙钟下全部过期）。
   * 因此优先 ALS，其次解析该用户持久化的模拟时刻，最后才回落墙钟。
   */
  private async resolveNow(userId: string): Promise<Date> {
    if (getSimulatedAsOf()) return simulatedNowOr();
    const asOf = await resolveUserSimulatedNow(userId).catch(() => null);
    return asOf ?? simulatedNowOr();
  }

  /**
   * 课后排探针（幂等）：同一 session+concept 只排一次；已过期/已作答的旧探针不复活。
   * best-effort：单条失败只跳过，不影响其它探针与课堂收束。
   */
  async scheduleForSession(input: ScheduleRetentionProbesInput): Promise<ScheduleRetentionProbesResult> {
    const now = input.lessonAt ?? this.deps.now();
    const concepts = selectRetentionProbeConcepts({
      lessonReport: input.lessonReport || null,
      knowledgeState: input.knowledgeState || null,
    });
    let scheduled = 0;
    let skipped = 0;
    for (const label of concepts) {
      const conceptKey = normalizeConceptKey(label);
      const probeId = retentionProbeIdFor(input.sessionId, conceptKey);
      const projectionKey = projectionKeyFor(probeId);
      try {
        const existing = await this.deps.findProjection(projectionKey, input.userId);
        if (existing) {
          skipped += 1;
          continue;
        }
        const delayHours = retentionProbeDelayHours(input.sessionId, conceptKey);
        const createdAt = now.toISOString();
        const probe: RetentionProbeRecord = {
          id: probeId,
          userId: input.userId,
          conceptKey,
          label,
          pathId: input.pathId ?? null,
          taskId: input.taskId ?? null,
          sessionId: input.sessionId,
          subject: input.subject,
          topic: input.topic,
          taskTitle: input.taskTitle,
          lessonAt: createdAt,
          scheduledAt: new Date(now.getTime() + delayHours * HOUR_MS).toISOString(),
          windowEndsAt: new Date(now.getTime() + RETENTION_PROBE_MAX_HOURS * HOUR_MS).toISOString(),
          status: 'pending',
          question: null,
          askedAt: null,
          answeredAt: null,
          attempts: 0,
          result: null,
          createdAt,
          updatedAt: createdAt,
        };
        await this.deps.createProjection({
          projectionKey,
          userId: input.userId,
          pathId: input.pathId ?? null,
          payload: JSON.stringify(probe),
        });
        scheduled += 1;
      } catch (error) {
        skipped += 1;
        logger.warn('[retention-probe] 排期失败（跳过该概念）', {
          sessionId: input.sessionId,
          conceptKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (scheduled > 0) {
      logger.info('[retention-probe] 已排延迟保持探针', {
        sessionId: input.sessionId,
        scheduled,
        skipped,
        concepts,
      });
    }
    return { scheduled, skipped };
  }

  /** 到期探针：懒过期（>72h 标 expired，不算失败）；缺题时现生成并缓存。 */
  async listDue(userId: string, options: { now?: Date; limit?: number } = {}): Promise<RetentionProbePublicView[]> {
    const now = options.now ?? await this.resolveNow(userId);
    const limit = Math.max(1, options.limit ?? RETENTION_PROBE_MAX_PER_LESSON);
    const rows = await this.deps.listProjections(userId);
    const due: RetentionProbeRecord[] = [];
    for (const row of rows) {
      const probe = parsePayload(row.payload);
      if (!probe) continue;
      if (isRetentionProbeExpired(probe, now)) {
        const expired: RetentionProbeRecord = { ...probe, status: 'expired', updatedAt: now.toISOString() };
        await this.deps.updateProjection(row.projectionKey, JSON.stringify(expired)).catch(() => undefined);
        continue;
      }
      if (isRetentionProbeDue(probe, now)) due.push(probe);
    }
    due.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    const views: RetentionProbePublicView[] = [];
    for (const probe of due.slice(0, limit)) {
      const ready = await this.ensureQuestion(probe, now);
      if (ready) views.push(toRetentionProbePublicView(ready));
    }
    return views;
  }

  /** 懒生成题目：失败返回 null（不阻断其它探针）；成功即落库，后续读取不再重复调 LLM。 */
  private async ensureQuestion(probe: RetentionProbeRecord, now: Date): Promise<RetentionProbeRecord | null> {
    try {
      const priorQuestions = await this.deps.loadLessonQuestions(probe.sessionId, probe.userId);
      if (priorQuestions === null) return null;
      if (probe.question) {
        const question = coerceQuestion(probe.question, probe.label);
        // A question already shown to the learner cannot be replaced while grading their answer.
        return question && !isRepeatedLessonQuestion(priorQuestions, question) ? { ...probe, question } : null;
      }
      const draft = await this.deps.generateQuestion({
        subject: probe.subject || '通用',
        topic: probe.topic || probe.label,
        taskTitle: probe.taskTitle || probe.label,
        conceptName: probe.label,
        priorQuestions,
      });
      const question = coerceQuestion(draft, probe.label);
      if (!question || isRepeatedLessonQuestion(priorQuestions, question)) return null;
      const updated: RetentionProbeRecord = {
        ...probe,
        question,
        askedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await this.deps.updateProjection(projectionKeyFor(probe.id), JSON.stringify(updated));
      return updated;
    } catch (error) {
      logger.warn('[retention-probe] 出题失败（下次到期重试）', {
        probeId: probe.id,
        conceptKey: probe.conceptKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 作答与判分：服务端答案键裁决。
   * 通过 → 只记证据；未通过 → 证据 + canonical 复习降级（掌握度/稳定性/FSRS 到期）。
   */
  async answer(
    userId: string,
    probeId: string,
    rawAnswer: string,
    options: { now?: Date } = {},
  ): Promise<{
    probe: RetentionProbeRecord;
    passed: boolean;
    judgedBy: string;
    detail: string;
    downgraded: boolean;
  }> {
    const now = options.now ?? await this.resolveNow(userId);
    const projectionKey = projectionKeyFor(probeId);
    const row = await this.deps.findProjection(projectionKey, userId);
    if (!row) throw new Error('RETENTION_PROBE_NOT_FOUND');
    const probe = parsePayload(row.payload);
    if (!probe) throw new Error('RETENTION_PROBE_CORRUPT');
    if (probe.status !== 'pending') throw new Error('RETENTION_PROBE_NOT_PENDING');
    // 不到 24h 窗口不得提前作答：延迟保持测的是「隔一段时间后还能不能提取」。
    if (now.getTime() < new Date(probe.scheduledAt).getTime()) {
      throw new Error('RETENTION_PROBE_NOT_DUE');
    }
    if (isRetentionProbeExpired(probe, now)) {
      const expired: RetentionProbeRecord = { ...probe, status: 'expired', updatedAt: now.toISOString() };
      await this.deps.updateProjection(projectionKey, JSON.stringify(expired)).catch(() => undefined);
      throw new Error('RETENTION_PROBE_EXPIRED');
    }
    const ready = await this.ensureQuestion(probe, now);
    if (!ready?.question) throw new Error('RETENTION_PROBE_QUESTION_NOT_READY');
    const submission = parseExitTicketSubmission(
      { type: ready.question.type, options: ready.question.options },
      rawAnswer,
    );
    const judgement = judgeCheckpointAnswer(ready.question, submission);
    if (!judgement) throw new Error('RETENTION_PROBE_NOT_JUDGEABLE');
    const attempts = ready.attempts + 1;
    const answeredAt = now.toISOString();
    const answered: RetentionProbeRecord = {
      ...ready,
      status: judgement.passed ? 'passed' : 'failed',
      attempts,
      answeredAt,
      result: {
        passed: judgement.passed,
        judgedBy: judgement.judgedBy,
        detail: judgement.detail,
        answerExcerpt: String(rawAnswer || '').slice(0, 200),
        answeredAt,
      },
      updatedAt: answeredAt,
    };
    await this.deps.writeEvidence({
      probe: answered,
      passed: judgement.passed,
      judgedBy: judgement.judgedBy,
      detail: judgement.detail,
      occurredAt: now,
    });
    let downgraded = false;
    if (!judgement.passed) {
      try {
        const summary = await this.deps.applyFailedProbe(answered, now);
        // 状态口径（外部评审 P1.1）：事件被课堂稳定键去重或无条目 ≠ 已降级。
        // 只有真的驱动了记忆台账（appliedItems>0）才报 downgraded=true；
        // 证据行总是已留痕（writeEvidence），这里只如实反映记忆侧是否被改写。
        downgraded = summary.appliedItems > 0;
        if (!downgraded) {
          logger.warn('[retention-probe] 未通过但降级未应用任何记忆条目（被去重或为空）', {
            probeId: answered.id,
            conceptKey: answered.conceptKey,
            appliedItems: summary.appliedItems,
            skippedDuplicateItems: summary.skippedDuplicateItems,
            skippedNegativeInterval: summary.skippedNegativeInterval,
          });
        }
      } catch (error) {
        logger.warn('[retention-probe] 未通过但降级写回失败（证据已留痕）', {
          probeId: answered.id,
          conceptKey: answered.conceptKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      // 通过同样要推进记忆调度，否则探针到期状态会一直挂着、反复被取出来问。
      const summary = await this.deps.applyPassedProbe(answered, now).catch((error: unknown) => {
        logger.warn('[retention-probe] 通过后推进 FSRS 失败（证据已留痕）', {
          probeId: answered.id,
          conceptKey: answered.conceptKey,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (summary && summary.appliedItems === 0) {
        logger.warn('[retention-probe] 通过但 FSRS 推进未应用任何条目（被去重或为空）', {
          probeId: answered.id,
          conceptKey: answered.conceptKey,
          skippedDuplicateItems: summary.skippedDuplicateItems,
        });
      }
    }
    await this.deps.updateProjection(projectionKey, JSON.stringify(answered));
    logger.info('[retention-probe] 探针已作答', {
      probeId: answered.id,
      conceptKey: answered.conceptKey,
      passed: judgement.passed,
      judgedBy: judgement.judgedBy,
      downgraded,
    });
    return {
      probe: answered,
      passed: judgement.passed,
      judgedBy: judgement.judgedBy,
      detail: judgement.detail,
      downgraded,
    };
  }
}

export const retentionProbeService = new RetentionProbeService();
