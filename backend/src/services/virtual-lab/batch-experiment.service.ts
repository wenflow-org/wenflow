/**
 * BatchExperimentService —— admin 虚拟学习者页「批量实验」系统级功能
 *
 * 职责：创建多个虚拟学习者 → 各自 Goal → Path → 学完所有任务 → 跨日衰减模拟，
 * 每任务快照 memory_traces / learner_evidence，验证画像系统工作。
 *
 * 数据：batch_experiments + batch_experiment_runs 两张表（schema.prisma）。
 * 驱动：startBatchExperimentScheduler() 定时轮询推进（每 30s 扫 active runs，DB 锁 + 进程内 busy 防重入）。
 *
 * 运营语义（2026-11-21 approved virtual plan §2）：
 * - 实验声明持久化：learningGoal / sampleType / expectedNoPath（不再只存 learnersConfig JSON）；
 * - 初始化进度与预算：setupStage + setupAttempts（重启后从断点继续，超预算 failed）；
 * - 终态分类：completed / no-path / learner-ended / max-observed / failed，
 *   并记录是否命中 expectedNoPath；
 * - 最后一个任务结算后先落 finalSnapshot 再进入留存；
 * - 衰减**非破坏**：learn-done 冻结 decayBaselineAt，3/7/14 天用
 *   用 FSRS 纯函数从同一份冻结记忆计算各时点留存，
 *   只把结果写进 decaySims，不动 memory_traces（旧实现反复 UPDATE lastSeenAt）。
 * - 手动推进带持久化请求回执：同 Idempotency-Key 同请求回放，不重复跑一步；
 *   stale processing 先按 run 阶段产物对账（见 operation-receipt.service）。
 *
 * 创建/身份/故事：统一调用 virtual-lab/learner-provisioning（唯一实现）。
 */
import { randomUUID } from 'node:crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import type { ApplicationLifecycle } from '../application-lifecycle.service';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { createSessionForProfile, getStoryPool } from '../../virtual-lab/session-factory';
import {
  provisionVirtualProfile,
  generateAndApplyPersona,
  generateAndApplyStory,
} from '../../virtual-lab/learner-provisioning';
import { batchExperimentOrigin } from './instance-scope';
import { fsrsRetentionOfTrace } from '../memory/memory-trace.service';
import { runWithContext } from '../../gateway/api-gateway/context';
import {
  completeOperationReceipt,
  failOperationReceipt,
  OperationReceiptInFlightError,
  reserveOperationReceipt,
  takeoverOperationReceipt,
  type OperationReceiptReservation,
} from './operation-receipt.service';

export interface BatchLearnerConfig {
  name: string;
  learningGoal?: string;
  /** 样本类型：'student' 生成传统学生样本（课纲/考试节点/学期节奏/家长同伴环境），'general' 自由生成 */
  sampleType?: string;
  /** 案例预期：平台应判「不排课」（no-path）。用于功能验证的预期终态对照。 */
  expectedNoPath?: boolean;
  frictionBudget?: string;
}

export interface AdvanceRunOptions {
  /** 持久化幂等键（手动推进）；缺省 = 调度器内部推进，不去重放 */
  requestKey?: string;
  /** 客户端请求体（参与 requestHash；缺省用 runId） */
  request?: unknown;
}

/** 错误累计达到该值 → run failed（与旧语义一致） */
const MAX_STALL = 10;
/** 初始化连续无进展达到该值 → run failed（避免 setup 无限空转） */
export const MAX_SETUP_ATTEMPTS = 10;
/** 跨进程推进锁的 stale 上限（单步推进最慢约 15 分钟，超时允许接管） */
const RUN_LOCK_STALE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 只有 3/7/14 天三档留存写进实验结果 */
const DECAY_DAYS = [3, 7, 14] as const;

/** 每 run 的内存防重入标志（进程内；跨进程由 DB advanceLock 负责） */
const busyRuns = new Set<string>();

function safeJson<T = any>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizeSampleType(value: string | null | undefined): 'student' | 'general' | null {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'student' || raw === 'general' ? raw : null;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? 'unknown')).slice(0, 300);
}

async function getRun(runId: string) {
  const run = await prisma.batch_experiment_runs.findUnique({ where: { id: runId } });
  if (!run) throw new Error('实验 run 不存在');
  return run;
}

type BatchRunRow = Awaited<ReturnType<typeof getRun>>;

/* ================= 跨进程 durable busy 锁 ================= */

async function claimAdvanceLock(runId: string, owner: string): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - RUN_LOCK_STALE_MS);
  const claimed = await prisma.batch_experiment_runs.updateMany({
    where: {
      id: runId,
      OR: [
        { advanceLockOwner: null },
        { advanceLockAt: null },
        { advanceLockAt: { lt: staleBefore } },
        { advanceLockOwner: owner },
      ],
    },
    data: { advanceLockOwner: owner, advanceLockAt: now },
  });
  return claimed.count === 1;
}

async function releaseAdvanceLock(runId: string, owner: string): Promise<void> {
  await prisma.batch_experiment_runs.updateMany({
    where: { id: runId, advanceLockOwner: owner },
    data: { advanceLockOwner: null, advanceLockAt: null },
  }).catch((error) => {
    logger.warn('[batch-experiment] release advance lock failed', { runId, error: errorMessage(error) });
  });
}

/* ================= 学习者 / 人设 / 故事 ================= */

/** 创建虚拟学习者（users + profile），返回 profileId */
async function createLearner(run: BatchRunRow, runId: string): Promise<string> {
  const result = await provisionVirtualProfile({
    name: run.learnerName,
    /* 修复：此前 setup 传 undefined，实验声明里的 learningGoal 被静默丢弃 */
    learningGoal: run.learningGoal ?? '',
    /* 实例标记（2026-11-09）：批量实验不经「选角派生」，此前建的账号不写任何来源标记 ⇒
       不进虚拟学习者列表/统计，也进不了清理向导，成为孤儿数据。写 origin（不是 derivedFrom：
       它没有来源卡，冒充「从某张卡派生」会让卡详情页的「派生自」链接指向不存在的卡）。 */
    profile: batchExperimentOrigin(runId),
    tags: ['batch-experiment'],
    notes: '批量实验自动创建',
  });
  return result.profileId;
}

/** 分层采样游标（C3）：同一进程内连续生成按序掷坐标，保证一批样本的边际分布均衡 */
let personaSamplingCursor = 0;

/** 生成人设（LLM）并写回 profile；失败不阻断（用基础档案继续） */
async function draftPersona(profileId: string, sampleType?: string): Promise<void> {
  await generateAndApplyPersona(profileId, {
    // 显式指定 student/general 时强制该类型；未指定则按抽样比例（25% 学生）
    sampleType: sampleType === 'student' ? 'student' : sampleType === 'general' ? 'general' : undefined,
    samplingIndex: personaSamplingCursor++,
    studentHints: sampleType === 'student' ? ['本次明确生成传统学生样本：学段与年级、目标考试或升学节点、学期节奏（课表/晚自习/假期）、成绩自评、家长与老师的外部期望必须全部具体；emotionalTriggers/failurePatterns 写学生真实模式（家长问成绩、排名下滑、考前突击遗忘等）。'] : undefined,
  });
}

/** 生成故事（LLM）并写回 storyPool；失败不阻断（会话启动再报错） */
async function draftStory(profileId: string, sampleType?: string): Promise<void> {
  await generateAndApplyStory(profileId, {
    extraHints: sampleType === 'student' ? ['本次明确生成传统学生样本的故事：sourceType 取 study 或 goalType 取 exam_prep，必须写清考试节点与时间压力、课纲既定的学习内容、老师布置的作业情境、家长与老师的期望、同学比较环境；pressurePoints/behaviorHooks 写学生真实卡点。'] : undefined,
  });
}

/* ================= 快照 ================= */

/** 快照：memory_traces + learner_evidence 摘要 → checkpoints/decaySims 追加 */
async function collectSnapshot(runId: string): Promise<Record<string, unknown>> {
  const run = await getRun(runId);
  const profile = run.profileId
    ? await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } })
    : null;
  const userId = profile?.userId;
  if (!userId) return { traceCount: 0, evidence: [] };
  const traces = await prisma.memory_traces.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      conceptKey: true, label: true, masteryScore: true, stability: true, lastSeenAt: true,
      extractionCount: true, intervalFactor: true, fsrsStability: true, fsrsDifficulty: true, fsrsLapses: true,
    },
  });
  const evidence = await prisma.learner_evidence.groupBy({
    by: ['evidenceKey'],
    where: { userId },
    _count: { _all: true },
  });
  return {
    at: new Date().toISOString(),
    traceCount: traces.length,
    mastered: traces.filter((t) => t.stability === 'stable').length,
    fragile: traces.filter((t) => t.stability === 'fragile').length,
    traces: traces.map((t) => ({
      key: t.conceptKey,
      label: t.label,
      mastery: t.masteryScore,
      stability: t.stability,
      seen: t.lastSeenAt,
      n: t.extractionCount,
      interval: t.intervalFactor,
      fsrsStability: t.fsrsStability,
      fsrsDifficulty: t.fsrsDifficulty,
      fsrsLapses: t.fsrsLapses,
    })),
    evidence: evidence.map((e) => ({ key: e.evidenceKey, count: e._count._all })),
  };
}

/** 最后一个任务结算后的最终快照（必须在进入 decay 前落库） */
async function collectFinalSnapshot(runId: string, lastTask: string | null): Promise<Record<string, unknown>> {
  const snapshot = await collectSnapshot(runId);
  return {
    ...snapshot,
    final: true,
    lastTask,
    settledAt: new Date().toISOString(),
  };
}

/* ================= 状态机 ================= */

/**
 * 推进一个 run（唯一入口）。
 *
 * - `options.requestKey` 给出时走持久化请求回执（手动推进）；
 * - 缺省时由调度器推进：仍受 DB 锁保护，但不记回执（避免无界增长）。
 */
export async function advanceRun(runId: string, options: AdvanceRunOptions = {}): Promise<string> {
  return (await advanceRunWithMeta(runId, options)).phase;
}

/** 与 advanceRun 相同，但返回是否命中回执/对账（仅供手动路由透出 `reused`）。 */
export async function advanceRunWithMeta(
  runId: string,
  options: AdvanceRunOptions = {},
): Promise<{ phase: string; reused: boolean }> {
  if (busyRuns.has(runId)) return { phase: 'busy', reused: false };
  busyRuns.add(runId);
  const owner = `adv_${randomUUID()}`;
  try {
    if (!(await claimAdvanceLock(runId, owner))) return { phase: 'busy', reused: false };
    try {
      const requestKey = String(options.requestKey ?? '').trim();
      if (!requestKey) {
        const phase = await runWithContext(
          { sourceEntry: 'simulation', callerAgent: 'batch-experiment' },
          () => advanceRunInner(runId),
        );
        return { phase, reused: false };
      }
      return await advanceRunWithReceipt(runId, requestKey, options.request ?? { runId });
    } finally {
      await releaseAdvanceLock(runId, owner);
    }
  } finally {
    busyRuns.delete(runId);
  }
}

/** 手动推进的持久化回执：同 key 回放；stale 先按阶段产物对账，再决定接管重跑。 */
async function advanceRunWithReceipt(
  runId: string,
  requestKey: string,
  request: unknown,
): Promise<{ phase: string; reused: boolean }> {
  const receiptKey = { scope: 'batch-run', scopeId: runId, kind: 'advance', requestKey };
  const before = await getRun(runId).catch(() => null);
  const context = before ? {
    phase: before.phase,
    status: before.status,
    completedTasks: before.completedTasks ?? 0,
    setupStage: before.setupStage ?? null,
    advanceCalled: before.advanceCalled === true,
    learningStarted: before.learningStarted === true,
    totalTasks: before.totalTasks ?? null,
  } : null;

  let reservation: OperationReceiptReservation = await reserveOperationReceipt({
    ...receiptKey,
    request,
    context,
  });

  if (reservation.kind === 'replay') {
    return { phase: receiptPhase(reservation.result) ?? 'replayed', reused: true };
  }
  if (reservation.kind === 'in_flight') {
    throw new OperationReceiptInFlightError(reservation.startedAt);
  }
  if (reservation.kind === 'stale') {
    const reconciled = await reconcileBatchAdvance(runId, reservation.context);
    if (reconciled) {
      const completed = await completeOperationReceipt({
        ...receiptKey,
        result: { phase: reconciled, reconciled: true },
        allowFailed: true,
        expectedUpdatedAt: reservation.updatedAt,
      });
      if (completed) {
        logger.info('[batch-experiment] stale advance reconciled from run artifacts', { runId, phase: reconciled });
        return { phase: reconciled, reused: true };
      }
    }
    const taken = await takeoverOperationReceipt({
      ...receiptKey,
      previousStatus: reservation.previousStatus,
      expectedUpdatedAt: reservation.updatedAt,
      context,
    });
    if (!taken) {
      // 并发请求刚接管/完成：按同 key 语义再归类一次。
      reservation = await reserveOperationReceipt({ ...receiptKey, request, context });
      if (reservation.kind === 'replay') {
        return { phase: receiptPhase(reservation.result) ?? 'replayed', reused: true };
      }
      if (reservation.kind === 'in_flight') throw new OperationReceiptInFlightError(reservation.startedAt);
    }
  }

  try {
    const phase = await runWithContext(
      { sourceEntry: 'simulation', callerAgent: 'batch-experiment' },
      () => advanceRunInner(runId),
    );
    if (phase === 'failed') {
      // 失败入账：同 key 重试可真正重跑（不把一次性故障回放成永久失败）。
      await failOperationReceipt({ ...receiptKey, error: `推进失败（phase=${phase}）` });
    } else {
      await completeOperationReceipt({ ...receiptKey, result: { phase } });
    }
    return { phase, reused: false };
  } catch (error) {
    await failOperationReceipt({ ...receiptKey, error });
    throw error;
  }
}

function receiptPhase(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const phase = (result as { phase?: unknown }).phase;
  return typeof phase === 'string' ? phase : null;
}

/**
 * stale 处理中回执的对账：只读 run 的阶段产物，判断上一次尝试是否已落库。
 * 已推进 → 直接以当前 phase 收尾（不重跑）；未推进 → 返回 null 交给接管重跑。
 */
async function reconcileBatchAdvance(runId: string, rawContext: unknown): Promise<string | null> {
  const before = (rawContext && typeof rawContext === 'object')
    ? rawContext as Record<string, unknown>
    : null;
  if (!before) return null;
  const run = await prisma.batch_experiment_runs.findUnique({ where: { id: runId } });
  if (!run) return null;
  const phaseChanged = typeof before.phase === 'string' && run.phase !== before.phase;
  const tasksAdvanced = (run.completedTasks ?? 0) > Number(before.completedTasks ?? 0);
  const setupAdvanced = (run.setupStage ?? null) !== (before.setupStage ?? null);
  const flagsAdvanced = run.advanceCalled !== (before.advanceCalled === true)
    || run.learningStarted !== (before.learningStarted === true)
    || (run.totalTasks ?? null) !== (before.totalTasks ?? null);
  const becameTerminal = run.status !== 'active' && run.status !== (before.status ?? 'active');
  if (phaseChanged || tasksAdvanced || setupAdvanced || flagsAdvanced || becameTerminal) {
    return run.phase;
  }
  return null;
}

async function advanceRunInner(runId: string): Promise<string> {
  const run = await getRun(runId);
  if (run.status !== 'active') return run.status;

  // ---------- setup ----------
  if (run.phase === 'setup') {
    return advanceSetup(runId, run);
  }

  // ---------- goal ----------
  if (run.phase === 'goal') {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: run.sessionId! } });
    if (!session) {
      await finishRun(runId, 'failed', { outcome: 'failed', lastError: '会话不存在' });
      return 'failed';
    }
    if (session.status === 'failed' || session.status === 'abandoned') {
      await finishRun(runId, 'failed', { outcome: 'failed', lastError: `会话已终止（${session.status}）` });
      return 'failed';
    }
    const stageResults = safeJson<Record<string, any>>(session.stageResults, {});
    const goalState = (stageResults.goal || {}) as Record<string, unknown>;
    // Goal 终局：平台分诊不排课（no-path）/ 学习者离场，都是正常终态，不能继续空转。
    if (goalState.noPath === true || goalState.learnerEnded === true) {
      const outcome = goalState.noPath === true ? 'no-path' : 'learner-ended';
      await finishRun(runId, 'done', {
        outcome,
        outcomeMatched: run.expectedNoPath ? outcome === 'no-path' : null,
      });
      logger.info('[batch-experiment] goal terminal before path', { runId, outcome });
      return 'done';
    }

    let gcId = session.goalConversationId ?? null;
    if (!gcId && run.profileId) {
      const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } });
      if (profile) {
        const gc = await prisma.goal_conversations.findFirst({
          where: { userId: profile.userId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        gcId = gc?.id ?? null;
      }
    }
    if (gcId) {
      const gc = await prisma.goal_conversations.findUnique({ where: { id: gcId }, select: { stage: true, learningPathId: true } });
      if (gc && ['proposing', 'ready', 'completed'].includes(gc.stage)) {
        // goal completed 且明确没有路径：若会话尚未落 noPath（历史数据），按 no-path 收尾。
        if (gc.stage === 'completed' && !gc.learningPathId && goalState.noPath === true) {
          await finishRun(runId, 'done', {
            outcome: 'no-path',
            outcomeMatched: run.expectedNoPath ? true : null,
          });
          return 'done';
        }
        await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { phase: 'path', stallCount: 0 } });
        return 'path';
      }
    }
    try {
      // 纳入会话租约队列：与驾驶舱/其他驱动者互斥，消除 stageResults 并发交错（拍板 2026-08-21 精简方案）
      const step = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () => {
        return simulationCoordinator.executeSingleStep({ sessionId: run.sessionId!, userId: session.userId, mode: 'single-step' });
      });
      // 单步结果直接给出 no-path / learner-ended 时立刻终态化，避免再等一轮。
      if (step?.noPath === true || step?.learnerEnded === true) {
        const outcome = step.noPath === true ? 'no-path' : 'learner-ended';
        await finishRun(runId, 'done', {
          outcome,
          outcomeMatched: run.expectedNoPath ? outcome === 'no-path' : null,
        });
        return 'done';
      }
      if (step?.success === false) {
        await bumpStall(runId, String(step.error || 'goal step failed'));
        return 'goal';
      }
      return 'goal';
    } catch (e) {
      await bumpStall(runId, errorMessage(e));
      return 'goal';
    }
  }

  // ---------- path ----------
  if (run.phase === 'path') {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: run.sessionId! } });
    if (!session) {
      await finishRun(runId, 'failed', { outcome: 'failed', lastError: '会话不存在' });
      return 'failed';
    }
    if (session.status === 'failed' || session.status === 'abandoned') {
      await finishRun(runId, 'failed', { outcome: 'failed', lastError: `会话已终止（${session.status}）` });
      return 'failed';
    }
    const profile = run.profileId ? await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } }) : null;
    // 优先按 userId 查最新 active 路径（goal 自动触发的 path 生成不会写回 virtual_sessions.learningPathId）
    let pathId: string | null = null;
    if (profile) {
      const lp = await prisma.learning_paths.findFirst({
        where: { userId: profile.userId, status: 'active' },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      pathId = lp?.id ?? null;
    }
    if (!pathId) pathId = session.learningPathId ?? null;
    if (pathId) {
      const taskCount = await prisma.subtasks.count({
        where: { milestones: { learningPathId: pathId } },
      });
      if (taskCount > 0) {
        // 绑定到会话（start-learning 依赖该列）
        await prisma.virtual_sessions.update({
          where: { id: run.sessionId! },
          data: { learningPathId: pathId, updatedAt: new Date() },
        });
        await prisma.batch_experiment_runs.update({
          where: { id: runId },
          data: { phase: 'learn', totalTasks: taskCount, stallCount: 0 },
        });
        logger.info('[batch-experiment] path ready', { runId, pathId, tasks: taskCount });
        return 'learn';
      }
    }
    // 会话已 completed 但始终没有路径 → 合法 no-path（历史/开场直答），不是平台失败。
    if (session.status === 'completed') {
      const stageResults = safeJson<Record<string, any>>(session.stageResults, {});
      const noPath = (stageResults.goal || {}).noPath === true;
      await finishRun(runId, 'done', {
        outcome: noPath ? 'no-path' : 'completed',
        outcomeMatched: noPath && run.expectedNoPath ? true : null,
      });
      return 'done';
    }
    if (!run.advanceCalled) {
      try {
        await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () => {
          await simulationCoordinator.advanceToPathGeneration(run.sessionId!);
        });
        await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { advanceCalled: true } });
      } catch (e) {
        await bumpStall(runId, errorMessage(e));
      }
    }
    return 'path';
  }

  // ---------- learn ----------
  if (run.phase === 'learn') {
    return advanceLearn(runId, run);
  }

  // ---------- learn-done → decay（自动 3/7/14 天） ----------
  if (run.phase === 'learn-done') {
    await ensureDecayBaseline(runId, run);
    await prisma.batch_experiment_runs.update({
      where: { id: runId },
      data: { phase: 'decay', stallCount: 0 },
    });
    return 'decay';
  }

  // ---------- decay ----------
  if (run.phase === 'decay') {
    return advanceDecay(runId, run);
  }

  return run.phase;
}

/* ================= setup ================= */

async function advanceSetup(runId: string, run: BatchRunRow): Promise<string> {
  if ((run.setupAttempts ?? 0) >= MAX_SETUP_ATTEMPTS) {
    await finishRun(runId, 'failed', {
      outcome: 'failed',
      lastError: `初始化超过 ${MAX_SETUP_ATTEMPTS} 次仍未完成（stage=${run.setupStage ?? 'created'}）`,
    });
    return 'failed';
  }

  // 1) 建号
  if (!run.profileId) {
    try {
      const profileId = await createLearner(run, runId);
      await prisma.batch_experiment_runs.update({
        where: { id: runId },
        data: { profileId, setupStage: 'persona', setupAttempts: 0, lastError: null },
      });
      logger.info('[batch-experiment] learner created', { runId, profileId, learningGoal: run.learningGoal ?? null });
      return 'setup';
    } catch (e) {
      await bumpSetup(runId, 'created', e);
      return 'setup';
    }
  }

  const sampleType = normalizeSampleType(run.sampleType) ?? undefined;

  // 2) 人设（阶段持久化：重启后不会重复生成已完成的人设）
  if (run.setupStage !== 'story' && run.setupStage !== 'session') {
    try {
      await draftPersona(run.profileId, sampleType);
      await prisma.batch_experiment_runs.update({
        where: { id: runId },
        data: { setupStage: 'story', setupAttempts: 0, lastError: null },
      });
      return 'setup';
    } catch (e) {
      await bumpSetup(runId, 'persona', e);
      return 'setup';
    }
  }

  // 3) 故事
  if (run.setupStage !== 'session') {
    try {
      await draftStory(run.profileId, sampleType);
      await prisma.batch_experiment_runs.update({
        where: { id: runId },
        data: { setupStage: 'session', setupAttempts: 0, lastError: null },
      });
      return 'setup';
    } catch (e) {
      await bumpSetup(runId, 'story', e);
      return 'setup';
    }
  }

  // 4) 会话
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } });
    if (!profile) {
      await bumpSetup(runId, 'session', '学习者不存在');
      return 'setup';
    }
    const storyList = getStoryPool(profile);
    const story = storyList[0];
    if (!story) {
      await bumpSetup(runId, 'session', '故事池为空，等待故事生成');
      return 'setup';
    }
    const session = await createSessionForProfile(run.profileId, {
      storyId: story.id || story.storyId,
      frictionBudget: run.frictionBudget as any,
    });
    if (!session?.id) {
      await bumpSetup(runId, 'session', '会话创建未返回 id');
      return 'setup';
    }
    await prisma.batch_experiment_runs.update({
      where: { id: runId },
      data: { sessionId: session.id, phase: 'goal', setupStage: 'session', setupAttempts: 0, stallCount: 0 },
    });
    logger.info('[batch-experiment] session started', { runId, sessionId: session.id });
    return 'goal';
  } catch (e) {
    await bumpSetup(runId, 'session', e);
    return 'setup';
  }
}

async function bumpSetup(runId: string, stage: string, error: unknown) {
  const run = await getRun(runId);
  const attempts = (run.setupAttempts ?? 0) + 1;
  logger.warn('[batch-experiment] setup attempt failed', { runId, stage, attempts, error: errorMessage(error) });
  if (attempts >= MAX_SETUP_ATTEMPTS) {
    await prisma.batch_experiment_runs.update({
      where: { id: runId },
      data: { setupStage: stage, setupAttempts: attempts, lastError: errorMessage(error), updatedAt: new Date() },
    });
    await finishRun(runId, 'failed', {
      outcome: 'failed',
      lastError: `初始化超过 ${MAX_SETUP_ATTEMPTS} 次仍未完成（stage=${stage}）：${errorMessage(error)}`,
    });
    return;
  }
  await prisma.batch_experiment_runs.update({
    where: { id: runId },
    data: {
      setupStage: stage,
      setupAttempts: attempts,
      lastError: errorMessage(error),
      stallCount: (run.stallCount ?? 0) + 1,
      updatedAt: new Date(),
    },
  });
}

/* ================= learn ================= */

async function advanceLearn(runId: string, run: BatchRunRow): Promise<string> {
  const session = await prisma.virtual_sessions.findUnique({ where: { id: run.sessionId! } });
  if (!session) {
    await finishRun(runId, 'failed', { outcome: 'failed', lastError: '会话不存在' });
    return 'failed';
  }
  if (session.status === 'failed' || session.status === 'abandoned') {
    await finishRun(runId, 'failed', { outcome: 'failed', lastError: `会话已终止（${session.status}）` });
    return 'failed';
  }
  if (!run.learningStarted) {
    try {
      const sl = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
        simulationCoordinator.startLearningPhase(run.sessionId!, {})
      );
      if (sl?.success && sl.teachingSessionId) {
        await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: true } });
        return 'learn';
      }
      // 会话失败 → restart-learning 恢复（保留任务）
      const rl = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
        simulationCoordinator.restartLearningPhase(run.sessionId!, {})
      );
      if (rl?.success && rl.teachingSessionId) {
        await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: true } });
        return 'learn';
      }
      await bumpStall(runId, rl?.error || 'start-learning failed');
      return 'learn';
    } catch (e) {
      const msg = errorMessage(e);
      if (/学习会话已停止|学习已停止|重新开始学习/i.test(msg)) {
        try {
          const rl = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
            simulationCoordinator.restartLearningPhase(run.sessionId!, {})
          );
          if (rl?.success && rl.teachingSessionId) {
            await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: true, stallCount: 0 } });
            return 'learn';
          }
          await bumpStall(runId, rl?.error || 'restart-learning failed');
        } catch (e2) {
          await bumpStall(runId, errorMessage(e2));
        }
      } else {
        await bumpStall(runId, msg);
      }
      return 'learn';
    }
  }

  // 教学一步（纳入租约：管理员驾驶舱操作将在此排队而非交错写入）
  let step: Awaited<ReturnType<typeof simulationCoordinator.executeLearningStep>>;
  try {
    step = await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () =>
      simulationCoordinator.executeLearningStep(run.sessionId!)
    );
  } catch (error) {
    await bumpStall(runId, errorMessage(error));
    return 'learn';
  }
  if (step?.error) {
    if (/学习已停止|没有绑定教学会话|学习会话已停止/.test(String(step.error))) {
      await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { learningStarted: false } });
    }
    await bumpStall(runId, String(step.error));
    return 'learn';
  }

  const nextTask = step.milestoneProgress?.currentTask != null
    ? String(step.milestoneProgress.currentTask)
    : (run.currentTask ?? null);
  const checkpoints = safeJson<Record<string, unknown>[]>(run.checkpoints, []);
  let completedTasks = run.completedTasks ?? 0;

  // 先结算任务（含「最后一个任务 + 路径完成」同回合的情况），再决定是否进入留存。
  if (step?.taskCompleted) {
    completedTasks += 1;
    const snap = await collectSnapshot(runId);
    checkpoints.push({
      at: new Date().toISOString(),
      task: step.milestoneProgress?.currentTask ?? null,
      milestone: step.milestoneProgress?.currentMilestone ?? null,
      totalMilestones: step.milestoneProgress?.totalMilestones ?? null,
      ...snap,
    });
    logger.info('[batch-experiment] task completed', { runId, completed: completedTasks });
  }

  if (step?.isPathCompleted) {
    // 最后一个任务在进入留存前必须结算：completedTasks 对齐 totalTasks，并落 finalSnapshot。
    const totalTasks = Math.max(run.totalTasks ?? 0, completedTasks);
    completedTasks = totalTasks;
    const finalSnapshot = await collectFinalSnapshot(runId, nextTask);
    checkpoints.push({ ...finalSnapshot, task: nextTask, milestone: step.milestoneProgress?.currentMilestone ?? null });
    await prisma.batch_experiment_runs.update({
      where: { id: runId },
      data: {
        completedTasks,
        totalTasks,
        currentTask: nextTask ?? run.currentTask ?? null,
        checkpoints: JSON.stringify(checkpoints),
        finalSnapshot: JSON.stringify(finalSnapshot),
        phase: 'learn-done',
        stallCount: 0,
      },
    });
    logger.info('[batch-experiment] ALL TASKS COMPLETED', { runId, completedTasks });
    try {
      await simulationCoordinator.runLeasedExclusive(run.sessionId!, async () => {
        await simulationCoordinator.generateWrapupForSession(run.sessionId!);
      });
    } catch { /* wrapup optional */ }
    return 'learn-done';
  }

  if (step?.taskCompleted) {
    await prisma.batch_experiment_runs.update({
      where: { id: runId },
      data: {
        completedTasks,
        currentTask: nextTask ?? '',
        checkpoints: JSON.stringify(checkpoints),
        stallCount: 0,
      },
    });
    return 'learn';
  }

  if (nextTask && nextTask !== run.currentTask) {
    await prisma.batch_experiment_runs.update({
      where: { id: runId },
      data: { currentTask: nextTask, stallCount: 0 },
    });
    return 'learn';
  }

  await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { stallCount: 0 } });
  return 'learn';
}

/* ================= decay（非破坏，固定 3/7/14） ================= */

/**
 * 冻结衰减基线：只记录时刻与记忆摘要，不改 memory_traces。
 * 若 run 已有基线（重入/重启），保持第一次的基线，保证 3/7/14 同源可比。
 */
async function ensureDecayBaseline(runId: string, run: BatchRunRow): Promise<void> {
  const saved = safeJson<{ traces?: unknown[] } | null>(run.decayBaseline, null);
  if (run.decayBaselineAt && Array.isArray(saved?.traces)) return;

  const baseline = await collectSnapshot(runId);
  const baselineAt = new Date();
  await prisma.batch_experiment_runs.update({
    where: { id: runId },
    data: {
      decayBaselineAt: baselineAt,
      decayBaseline: JSON.stringify({ ...baseline, at: baselineAt.toISOString(), traces: baseline.traces ?? [] }),
      // 旧投影可能改过记忆时间，不能接在新冻结基线上比较。
      decaySims: null,
    },
  });
}

async function advanceDecay(runId: string, run: BatchRunRow): Promise<string> {
  const profile = run.profileId ? await prisma.virtual_learner_profiles.findUnique({ where: { id: run.profileId } }) : null;
  if (!profile) {
    await finishRun(runId, 'failed', { outcome: 'failed', lastError: '学习者不存在' });
    return 'failed';
  }
  await ensureDecayBaseline(runId, run);
  // 重新读取：ensureDecayBaseline 可能刚写入基线。
  const fresh = await getRun(runId);
  const baselineAt = fresh.decayBaselineAt ?? new Date();
  const decaySims = safeJson<Record<string, unknown>[]>(fresh.decaySims, []);
  if (decaySims.length >= DECAY_DAYS.length) {
    await finishRun(runId, 'done', {
      outcome: 'max-observed',
      outcomeMatched: fresh.expectedNoPath ? false : null,
      stallCount: 0,
    });
    return 'done';
  }

  const days = DECAY_DAYS[decaySims.length];
  const asOf = new Date(baselineAt.getTime() + days * DAY_MS);
  const baseline = safeJson<{ traces?: Array<{
    key: string; label: string | null; mastery: number; stability: string; seen: string | null; n: number;
    fsrsStability?: number | null; fsrsDifficulty?: number | null; fsrsLapses?: number | null;
  }> }>(fresh.decayBaseline, {});
  // 所有时点用同一份观察输入，之后的学习或复习不改变实验基线。
  const retention = (baseline.traces ?? []).filter((trace) => trace.seen).map((trace) => ({
    conceptKey: trace.key,
    label: trace.label,
    stability: trace.stability,
    masteryScore: trace.mastery,
    retention: fsrsRetentionOfTrace({
      masteryScore: trace.mastery,
      lastSeenAt: new Date(trace.seen!),
      extractionCount: trace.n,
      fsrsStability: trace.fsrsStability ?? null,
      fsrsDifficulty: trace.fsrsDifficulty ?? null,
      fsrsLapses: trace.fsrsLapses ?? null,
    }, asOf),
  }));
  const avgRetention = retention.length > 0
    ? Math.round((retention.reduce((sum, row) => sum + row.retention, 0) / retention.length) * 1000) / 1000
    : null;
  decaySims.push({
    days,
    at: new Date().toISOString(),
    asOf: asOf.toISOString(),
    baselineAt: baselineAt.toISOString(),
    traceCount: retention.length,
    avgRetention,
    mastered: retention.filter((r) => r.stability === 'stable').length,
    fragile: retention.filter((r) => r.stability === 'fragile').length,
    retained: retention.map((r) => ({
      key: r.conceptKey,
      label: r.label,
      retention: Math.round(r.retention * 1000) / 1000,
      mastery: r.masteryScore,
      stability: r.stability,
    })),
  });
  await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { decaySims: JSON.stringify(decaySims) } });
  logger.info('[batch-experiment] decay simulated', { runId, days, asOf: asOf.toISOString(), traces: retention.length });
  return 'decay';
}

/* ================= 状态收尾 ================= */

async function bumpStall(runId: string, error: string) {
  const run = await getRun(runId);
  const stall = (run.stallCount ?? 0) + 1;
  const data: Record<string, unknown> = { stallCount: stall, lastError: String(error).slice(0, 300), updatedAt: new Date() };
  if (stall >= MAX_STALL) {
    logger.warn('[batch-experiment] run stalled', { runId, error: String(error).slice(0, 200) });
    data.status = 'failed';
    data.phase = 'failed';
    data.outcome = 'failed';
  }
  await prisma.batch_experiment_runs.update({ where: { id: runId }, data });
  if (stall >= MAX_STALL) await settleExperimentIfFinished(runId);
}

async function finishRun(runId: string, status: string, extra: Record<string, unknown> = {}) {
  const run = await getRun(runId);
  if (run.status !== 'active') return;
  const phase = status === 'done' ? 'done' : 'failed';
  await prisma.batch_experiment_runs.update({
    where: { id: runId },
    data: {
      status,
      phase,
      outcome: (extra.outcome as string | undefined) ?? (status === 'done' ? 'completed' : 'failed'),
      ...(extra.outcomeMatched === undefined ? {} : { outcomeMatched: extra.outcomeMatched as boolean | null }),
      ...(extra.lastError === undefined ? {} : { lastError: extra.lastError as string | null }),
      ...(extra.stallCount === undefined ? {} : { stallCount: extra.stallCount as number }),
      updatedAt: new Date(),
    },
  });
  await settleExperimentIfFinished(runId);
}

async function settleExperimentIfFinished(runId: string) {
  const run = await getRun(runId);
  const others = await prisma.batch_experiment_runs.findMany({
    where: { experimentId: run.experimentId, status: 'active' },
    select: { id: true },
  });
  if (others.length === 0) {
    await prisma.batch_experiments.update({
      where: { id: run.experimentId },
      data: { status: 'done', updatedAt: new Date() },
    });
  }
}

/* ================= 实验 CRUD ================= */

/** 创建实验 */
export async function createExperiment(
  adminId: string,
  input: { name: string; description?: string; learners: BatchLearnerConfig[] },
) {
  const experiment = await prisma.batch_experiments.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      createdBy: adminId,
      learnersConfig: JSON.stringify(input.learners),
    },
  });
  for (const l of input.learners) {
    await prisma.batch_experiment_runs.create({
      data: {
        experimentId: experiment.id,
        learnerName: l.name,
        learningGoal: l.learningGoal ?? null,
        sampleType: normalizeSampleType(l.sampleType),
        expectedNoPath: l.expectedNoPath === true,
        frictionBudget: l.frictionBudget ?? 'normal',
        phase: 'setup',
      },
    });
  }
  logger.info('[batch-experiment] experiment created', { experimentId: experiment.id, learners: input.learners.length });
  return experiment;
}

/** 列表：最近 50 个实验（含 run 进度摘要） */
export function listExperiments() {
  return prisma.batch_experiments.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      runs: {
        select: {
          id: true,
          learnerName: true,
          learningGoal: true,
          sampleType: true,
          expectedNoPath: true,
          frictionBudget: true,
          phase: true,
          status: true,
          setupStage: true,
          setupAttempts: true,
          completedTasks: true,
          totalTasks: true,
          outcome: true,
          outcomeMatched: true,
          updatedAt: true,
        },
      },
    },
  });
}

/** 详情：单实验 + 全量 runs（按 createdAt 升序） */
export function getExperimentDetail(id: string) {
  return prisma.batch_experiments.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: 'asc' } } },
  });
}

/** 停止实验：实验置 stopped，未完成 runs 置 failed */
export async function stopExperiment(id: string): Promise<void> {
  await prisma.batch_experiments.update({
    where: { id },
    data: { status: 'stopped', updatedAt: new Date() },
  });
  await prisma.batch_experiment_runs.updateMany({
    where: { experimentId: id, status: 'active' },
    data: { status: 'failed', phase: 'failed', outcome: 'failed', lastError: '实验已手动停止', updatedAt: new Date() },
  });
}

/** 手动推进一个 run（供页面调试；可选幂等键） */
export async function manualAdvance(runId: string, options: AdvanceRunOptions = {}) {
  return advanceRun(runId, options);
}

/** 手动执行跨日衰减模拟（已 decay 的档位跳过，从下一档继续；非破坏） */
export async function manualDecay(runId: string): Promise<{ simulated: boolean; phase: string }> {
  const run = await getRun(runId);
  if (!['learn-done', 'decay'].includes(run.phase)) {
    return { simulated: false, phase: run.phase };
  }
  if (run.phase === 'learn-done') {
    await ensureDecayBaseline(runId, run);
    await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { phase: 'decay' } });
  }
  const phase = await advanceRun(runId);
  return { simulated: phase === 'decay' || phase === 'done', phase };
}

/** 手动快照 */
export async function manualSnapshot(runId: string) {
  const snap = await collectSnapshot(runId);
  const run = await getRun(runId);
  const checkpoints = safeJson<Record<string, unknown>[]>(run.checkpoints, []);
  checkpoints.push({ at: new Date().toISOString(), manual: true, ...snap });
  await prisma.batch_experiment_runs.update({ where: { id: runId }, data: { checkpoints: JSON.stringify(checkpoints) } });
  return snap;
}

/**
 * 定时推进调度器（启动时注册）：每 30s 扫 active runs 推进。
 * 挂 application-lifecycle（同 log-retention 等维护调度器）：draining 期跳过 tick、
 * 优雅关闭时 clearInterval；lifecycle 引用可选——页面/脚本直连 start() 不传参也照常可用。
 */
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerLifecycle: Pick<ApplicationLifecycle, 'isDraining'> | null = null;

export function startBatchExperimentScheduler(lifecycle?: Pick<ApplicationLifecycle, 'isDraining'>): void {
  // 幂等：已在跑时仅补充 lifecycle 引用（路由兜底启动不带参，不覆盖已注册引用）
  if (lifecycle) schedulerLifecycle = lifecycle;
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    if (schedulerLifecycle?.isDraining()) return;
    try {
      const runs = await prisma.batch_experiment_runs.findMany({
        where: { status: 'active' },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      });
      for (const run of runs) {
        try {
          await advanceRun(run.id);
        } catch (e) {
          logger.warn('[batch-experiment] scheduler advance failed', { runId: run.id, error: errorMessage(e) });
        }
      }
    } catch (e) {
      logger.warn('[batch-experiment] scheduler tick failed', { error: errorMessage(e) });
    }
  }, 30_000);
  schedulerTimer.unref?.();
  logger.info('[batch-experiment] scheduler started (30s interval)');
}

/** 优雅关闭：清掉定时器（在途 tick 由 prisma $disconnect 兜底） */
export function stopBatchExperimentScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerLifecycle = null;
}
