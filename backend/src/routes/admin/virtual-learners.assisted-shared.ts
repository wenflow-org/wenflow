/**
 * 自动驾驶运行面 · 共享 helper（2026-10-24 架构优化批 1：assisted-runtime.ts 再拆分迁出）。
 *
 * 租约互斥 / 模拟钟包装 / 黑盒动作解析 / 批量终止 / 原子 stageResults 合并 / 当天学习执行。
 * 原实现逐字迁自 virtual-learners.assisted-runtime.ts（issue #76 拆分链的第二次拆分）。
 */
import express from 'express';
import type { LearnerAction } from '../../virtual-lab/contracts';
import { logger } from '../../utils/logger';
import { withTransaction } from '../../utils/with-transaction';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { findSessionById, findSessionStageFields, findSessionStatus, deleteSessionLeases, markSessionAbandoned, createAdminAuditLog, findLiveSessionsByProfiles } from '../../services/virtual-lab/virtual-session.repo';
import { autopilotService } from '../../virtual-lab/autopilot.service';
import { appendSessionLogs as appendVirtualSessionLogs } from '../../services/virtual-lab/virtual-session-log-store';
import { assertAssistedSessionMode } from '../../virtual-lab/session-mode';
import { runWithSimulatedClock } from '../../services/virtual-lab/simulation-clock-context';
import { getVirtualLabSettings, DEFAULT_VIRTUAL_LAB_SETTINGS } from '../../services/virtual-lab-settings.service';
import { resolveSessionBudget } from '../../virtual-lab/session-budget';
import { parseJson } from '../../virtual-lab/session-factory';
import { asErrorLike } from '../../virtual-lab/vlab-types';
import type { LeaseClientLike, StageResults, VirtualSessionRow } from '../../virtual-lab/vlab-types';
import { resolveSimulationClock, resolutionEnteredLearn, summarizeDayLearning } from '../../services/virtual-lab/simulated-day.service';
import { findProfileJsonById } from '../../services/virtual-lab/virtual-learner-profile.repo';

// ===== 原 virtual-learners.ts L252–L261 =====
export function parseSimulationLimit(value: unknown, fallback: number, max: number, field: string) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > max) {
    throw Object.assign(new Error(`${field} 必须是 1 到 ${max} 之间的整数`), {
      code: 'INVALID_SIMULATION_LIMIT',
      statusCode: 400
    });
  }
  return Number(limit);
}

// ===== 原 virtual-learners.ts L2375–L2475 =====
export function parseBlackboxAction(body: Record<string, unknown>): LearnerAction {
  const type = typeof body?.type === 'string' ? body.type : '';
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const answer = typeof body?.answer === 'string' ? body.answer : '';
  const code = typeof body?.code === 'string' ? body.code : '';

  if (type === 'chat' || type === 'request_hint' || type === 'request_example' || type === 'confirm_proposal') {
    if (!text) throw new Error(`${type} 动作缺少 text`);
    return { type, text } as LearnerAction;
  }
  if (type === 'submit_answer') {
    if (!answer.trim()) throw new Error('submit_answer 动作缺少 answer');
    return { type, answer };
  }
  if (type === 'submit_code') {
    if (!code.trim()) throw new Error('submit_code 动作缺少 code');
    return { type, code };
  }
  if (type === 'abandon' || type === 'skip') {
    if (!reason) throw new Error(`${type} 动作缺少 reason`);
    return { type, reason } as LearnerAction;
  }
  if (type === 'start_learning') {
    return { type, taskId: typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : undefined };
  }
  if (type === 'confirm_complete') return { type };
  throw new Error('不支持的黑盒学习者动作');
}

export async function requireAssistedSession(sessionId: string) {
  const session = await findSessionById(sessionId);
  if (!session) throw new Error('模拟会话不存在');
  assertAssistedSessionMode(parseJson<StageResults>(session.stageResults, {}));
  return session;
}

export async function runAssistedSessionMutation<T>(
  sessionId: string,
  work: (session: VirtualSessionRow, assertLeaseOwned: (leaseClient?: LeaseClientLike) => Promise<void>) => Promise<T>
) {
  await requireAssistedSession(sessionId);
  return simulationCoordinator.runLeasedExclusive(sessionId, async assertLeaseOwned => {
    const session = await requireAssistedSession(sessionId);
    await assertLeaseOwned();
    const result = await work(session, assertLeaseOwned);
    await assertLeaseOwned();
    return result;
  });
}

/**
 * 已有会话的「模拟钟」包装（对齐本文件 advance-day 分支的现成模式：
 * resolveSimulationClock 解析会话钟 + runWithSimulatedClock 包住执行）：
 * 在该会话当前模拟时刻（clock.simulatedNow）的上下文内执行 work —— 使学习执行链内的
 * 「今天/now」（温故计划 buildReviewPlan、温故额度记账 daily.date 等）与写入侧同钟
 * （FIX-REPORT-2026-10-06 §5-2 / ROUND2-REVIEW-2026-10-06.md:202）。
 * 时钟来源 = resolveSimulationClock 的完整口径（session 级 clock > profile 级 > 全局 settings），
 * 与 advance-day / simulated-day.service 完全一致；无任何来源启用时原样直调、不建上下文
 * （现网行为零变化）。
 *
 * `work` 收到同一 session 行（调用方需要 userId 等字段，且避免二次读库）。
 * 适用入口：凡会进入学习执行链（开课 / 教学回合 / 自动循环 / 全流程 / 复活 / wrapup）的
 * 已有会话端点；新建会话（regression-run）无存量会话钟，保持直调。
 */
export async function runAssistedSessionMutationWithSimClock<T>(
  sessionId: string,
  work: (session: VirtualSessionRow, assertLeaseOwned: (leaseClient?: LeaseClientLike) => Promise<void>) => Promise<T>
) {
  return runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
    const stageResults = parseJson<StageResults>(session.stageResults, {});
    const settings = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
    const profile = await findProfileJsonById(session.virtualProfileId).catch(() => null);
    const profileData = parseJson<Record<string, unknown>>(profile?.profile, {});
    const clock = resolveSimulationClock({
      stageResultsClock: (stageResults as any).simulationClock ?? null,
      profileClock: (profileData as any)?.simulationClock ?? null,
      settings: settings.dateSimulation,
      sessionCreatedAt: session.createdAt,
    });
    if (!clock.enabled) return work(session, assertLeaseOwned);
    const asOf = new Date(clock.simulatedNow);
    if (Number.isNaN(asOf.getTime())) return work(session, assertLeaseOwned);
    return runWithSimulatedClock(asOf, () => work(session, assertLeaseOwned));
  });
}

export function getBlackboxCommandId(req: express.Request) {
  const header = req.get('Idempotency-Key');
  const bodyValue = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  return String(header || bodyValue || '').trim();
}

/**
 * 自动驾驶（assisted）入口的幂等键：沿用黑盒（`getBlackboxCommandId`）同一约定——
 * 优先读 `Idempotency-Key` 头，回退读 `body.commandId`，trim 后返回。空串表示「未带幂等键」。
 *
 * 与黑盒不同：assisted 侧**不强制**带键（老前端/脚本可能不发）——缺省按「不幂等」直通，
 * 保持既有行为零变化；只有显式带键的调用（网关超时重试）才走幂等回放。
 */
export function getAssistedCommandId(req: express.Request): string {
  const header = typeof req?.get === 'function' ? req.get('Idempotency-Key') : undefined;
  const bodyValue = typeof req?.body?.commandId === 'string' ? req.body.commandId : '';
  return String(header || bodyValue || '').trim();
}

export class AssistedIdempotencyKeyTooLongError extends Error {
  readonly code = 'ASSISTED_IDEMPOTENCY_KEY_TOO_LONG';
  readonly statusCode = 400;

  constructor(keyLength: number) {
    super(`幂等键过长（${keyLength} > 128）`);
    this.name = 'AssistedIdempotencyKeyTooLongError';
  }
}

export class AssistedIdempotencyKeyReusedError extends Error {
  readonly code = 'ASSISTED_IDEMPOTENCY_KEY_REUSED';
  readonly statusCode = 409;

  constructor() {
    super('同一 Idempotency-Key 被用于不同请求体，请换一个新的幂等键');
    this.name = 'AssistedIdempotencyKeyReusedError';
  }
}

export class AssistedOperationInFlightError extends Error {
  readonly code = 'ASSISTED_OPERATION_IN_FLIGHT';
  readonly statusCode = 409;

  constructor() {
    super('该操作仍在处理中，请等待完成后重试同一 Idempotency-Key');
    this.name = 'AssistedOperationInFlightError';
  }
}

/**
 * 自动驾驶推进操作的进程内幂等账本（#173-3，方案 B）。
 *
 * 为什么进程内：与黑盒 `virtual_experiment_commands` 不同，这里**不新增 DB 表**（schema.prisma
 * 本轮未改）；同实例内的网关超时重试可达回放。跨实例不共享（多副本部署需换 DB 表，注释在此，不在本轮范围）。
 *
 * 设计：以 `(sessionId, kind, key)` 为键——kind 区分 step/teaching-step/auto-learning，同一把键
 * 在不同推进入口间**互不相通**（各自独立账目，不会误回放）。
 * 命中且请求体一致 → 回放上次结果（不重跑模型/不重推回合）；命中但**请求体不一致**
 * → 409 `ASSISTED_IDEMPOTENCY_KEY_REUSED`（同一把键用于不同请求，必须换新键）。
 * （复核更正：此前注释写「命中但 kind 不一致 → 409」，但 kind 已是复合键的一部分、该分支不可达；
 * 真正触发 409 的是 requestHash 不等。）
 *
 * 记录必须设 **TTL + 容量上限**（避免重演无界增长）：
 *  - TTL：完成态 30 分钟内可回放，过期后同键再次进入会重新执行（与黑盒「失败/过期可重试」同口径）；
 *  - 容量：最多 1000 条，超出按插入顺序 FIFO 淘汰最旧（Map 保留插入序）。
 */
const ASSISTED_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;
const ASSISTED_IDEMPOTENCY_MAX_ENTRIES = 1000;

interface AssistedIdempotencyEntry {
  sessionId: string;
  kind: string;
  requestHash: string;
  completedAt: number;
  result: unknown;
}

const assistedIdempotencyStore = new Map<string, AssistedIdempotencyEntry>();

function assistedIdempotencyCompositeKey(sessionId: string, kind: string, key: string): string {
  return `${sessionId}\u0000${kind}\u0000${key}`;
}

function assistedRequestHash(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? null);
  } catch {
    return String(payload ?? null);
  }
}

/** 清理过期条目；容量超限按插入序淘汰最旧（Map 的键迭代顺序 = 插入/刷新顺序）。 */
function pruneAssistedIdempotency(now: number): void {
  for (const [compositeKey, entry] of assistedIdempotencyStore) {
    if (now - entry.completedAt > ASSISTED_IDEMPOTENCY_TTL_MS) {
      assistedIdempotencyStore.delete(compositeKey);
    }
  }
  while (assistedIdempotencyStore.size > ASSISTED_IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = assistedIdempotencyStore.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    assistedIdempotencyStore.delete(oldest);
  }
}

/** 测试/复用入口：清空账本（幂等记录是进程级单例，测试间需要隔离）。 */
export function resetAssistedIdempotencyStore(): void {
  assistedIdempotencyStore.clear();
}

/**
 * 在会话租约锁内执行一次自动驾驶推进操作，并按 `(sessionId, kind, key)` 做幂等回放。
 *
 * 调用方必须把本函数放在 `runAssistedSessionMutationWithSimClock` 的 work 回调里——即**锁内**，
 * 这样并发的同键请求会被租约串行化：第二个请求进锁时第一个已完成并落账，直接回放；第一个失败时
 * 没有落账，第二个会真正重跑（失败允许同键重试）。
 *
 * 返回 `{ result, reused }`：`reused=true` 表示命中回放（未重跑）。`key` 为空串时直接执行、不记账、
 * 不回放（`reused=false`），保持老客户端零变化。
 */
export async function runAssistedIdempotentMutation<T>(
  sessionId: string,
  key: string,
  kind: string,
  request: unknown,
  work: () => Promise<T>,
): Promise<{ result: T; reused: boolean }> {
  if (key.length > 128) {
    throw new AssistedIdempotencyKeyTooLongError(key.length);
  }
  // 缺省（未带键）：不幂等，直通。
  if (!key) {
    const result = await work();
    return { result, reused: false };
  }
  const now = Date.now();
  pruneAssistedIdempotency(now);
  const requestHash = assistedRequestHash(request);
  const compositeKey = assistedIdempotencyCompositeKey(sessionId, kind, key);
  const existing = assistedIdempotencyStore.get(compositeKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AssistedIdempotencyKeyReusedError();
    }
    // 在途（同进程内极小概率：锁外并发同键）：直接 409，不要回放 undefined。
    if (existing.completedAt === Number.NEGATIVE_INFINITY) {
      throw new AssistedOperationInFlightError();
    }
    return { result: existing.result as T, reused: true };
  }
  // 标记在途：同进程内并发同键（锁外极小概率）进锁前看到 in-flight 直接 409。
  assistedIdempotencyStore.set(compositeKey, {
    sessionId,
    kind,
    requestHash,
    completedAt: Number.NEGATIVE_INFINITY,
    result: undefined,
  });
  try {
    const result = await work();
    // 只记成功结果：失败（success=false 或抛错）不入账，允许同键按业务重试。
    const succeeded = !(result && typeof result === 'object' && (result as { success?: unknown }).success === false);
    if (succeeded) {
      assistedIdempotencyStore.set(compositeKey, {
        sessionId,
        kind,
        requestHash,
        completedAt: Date.now(),
        result,
      });
    } else {
      assistedIdempotencyStore.delete(compositeKey);
    }
    return { result, reused: false };
  } catch (error) {
    // 失败不入账：同键重试会真正重跑，而不是回放一个失败结果。
    assistedIdempotencyStore.delete(compositeKey);
    throw error;
  }
}

export function getExpectedBlackboxTraceCount(req: express.Request) {
  const header = req.get('X-Expected-Trace-Count');
  const bodyValue = req.body?.expectedTraceCount;
  const value = header ?? bodyValue;
  const parsed = typeof value === 'number' ? value : Number(value);
  return parsed;
}

/**
 * 删除虚拟学习者前叫停其活跃运行（2026-11-09 运营流程核查）。
 *
 * 单行删除（DELETE /:id → cascadeDeleteProfile）原来直接删行：内存里的自动驾驶循环与
 * 排队项没人通知，删完仍占着并发额度、继续调模型，直到下一次写库才发现会话已不存在；
 * 持租约的 runner 也可能边删边写。这里按「先撤租约、再停自动驾驶」两步收口：
 * - 撤租约：持租约者下次续租/写库抛 LeaseLost 中止（与批量终止同一约定）；
 * - 停自动驾驶：排队中的直接出队，运行中的置 stopRequested，循环下一轮自行收口
 *   （多进程下由持锁进程消费该标志）。
 * 返回被叫停的会话数，供路由写审计/日志。
 */
export async function stopLiveRunsForProfile(profileId: string): Promise<number> {
  const live = await findLiveSessionsByProfiles([profileId]);
  for (const session of live) {
    await deleteSessionLeases(session.id).catch((error) => {
      logger.warn('[virtual-learners] 删除前撤租约失败', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    await autopilotService.stop(session.id).catch((error) => {
      logger.warn('[virtual-learners] 删除前停自动驾驶失败', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }
  return live.length;
}

// ===== 原 virtual-learners.ts L2643–L2694 =====
/** 单个会话终态化（operator 批量终止）：与 reclaim 同模式——只标记 abandoned，不删除任何数据 */
export async function terminateSession(session: Pick<VirtualSessionRow, 'id' | 'status' | 'currentStage' | 'stageResults' | 'updatedAt'>, operator: { userId?: string | null; name?: string | null }) {
  const terminatedAt = new Date();
  const reason = 'operator_batch_terminate';
  const stageResults = parseJson<StageResults>(session.stageResults, {});
  stageResults.termination = {
    reason,
    terminatedAt: terminatedAt.toISOString(),
    previousStatus: session.status,
    previousStage: session.currentStage,
    operatorId: operator?.userId ?? null
  };
  // autopilot 状态同步收口：避免「会话已终止」但 stageResults 仍显示「自动运行中」的矛盾
  if (stageResults.autopilot && typeof stageResults.autopilot === 'object') {
    (stageResults.autopilot as Record<string, unknown>).status = 'stopped';
    (stageResults.autopilot as Record<string, unknown>).completedAt = terminatedAt.toISOString();
    (stageResults.autopilot as Record<string, unknown>).lastError = '管理员批量终止';
  }
  const before = { status: session.status, currentStage: session.currentStage, updatedAt: session.updatedAt?.toISOString?.() ?? null };
  // 先撤销活跃租约：正在执行的 Blackbox/Assisted runner 若持租约，会在下次续租/写库前
  // 抛 LeaseLost 中止（runLeasedExclusive 的 assertLeaseOwned），避免「终止后 session 被复活成 running」
  await deleteSessionLeases(session.id).catch(() => {});
  await markSessionAbandoned(session.id, terminatedAt, JSON.stringify(stageResults));
  // 终止轨迹进日志子表（首写惰性播种旧列，O(新增) 代替整包写回）
  await appendVirtualSessionLogs(session.id, [{
    timestamp: terminatedAt.toISOString(),
    phase: 'error',
    details: { error: `管理员批量终止会话（${session.status} → abandoned）`, output: { action: 'batch-terminate', previousStatus: session.status } }
  }]);
  await createAdminAuditLog({
    data: {
      adminId: operator?.userId ?? null,
      adminName: operator?.name ?? (operator?.userId ? 'admin' : 'system'),
      action: 'virtual-session-batch-terminate',
      targetType: 'virtual-session',
      targetId: session.id,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify({ status: 'abandoned', reason, terminatedAt: terminatedAt.toISOString() }),
      method: 'POST',
      path: '/admin/virtual-learners/sessions/terminate',
      statusCode: 200,
      success: true,
      durationMs: 0
    }
  });
  logger.warn('[virtual-learners] 批量终止虚拟会话', {
    sessionId: session.id,
    previousStatus: session.status,
    operatorId: operator?.userId ?? null
  });
}

// ===== 原 virtual-learners.ts L3166–L3231 =====
/**
 * 原子合并 stageResults 顶层键（读-改-写同一事务）。
 *
 * 为什么必须原子（虚拟学习者跑数观察 #1 的根因）：`advance-day` 若用**请求开始时的快照**整列回写，
 * 会覆盖当天学习过程中写入的 `path_review` / `runtimeStats` / `teaching` 等键。实测：回滚分支把
 * 当天写好的 `path_review`（含 `status:'accepted'`）抹掉 → 第二天 `runDayLearning` 见不到"已接受"
 * → **重新跑一次评审 LLM**、反复触顶 replan 上限。
 */
export async function mergeSessionStageResults(sessionId: string, patch: Record<string, unknown>): Promise<void> {
  await withTransaction(async (tx) => {
    const current = await tx.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { stageResults: true },
    });
    const stageResults = parseJson<Record<string, unknown>>(current?.stageResults, {});
    await tx.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify({ ...stageResults, ...patch }), updatedAt: new Date() },
    });
  }, { label: 'virtual-learners.mergeSessionStageResults' });
}

/** 原子删除 stageResults 顶层键（unhold 等控制面用；同样避免旧快照整列回写）。 */
export async function clearSessionStageResultsKey(sessionId: string, key: string): Promise<void> {
  await withTransaction(async (tx) => {
    const current = await tx.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { stageResults: true },
    });
    const stageResults = parseJson<Record<string, unknown>>(current?.stageResults, {});
    delete stageResults[key];
    await tx.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(stageResults), updatedAt: new Date() },
    });
  }, { label: 'virtual-learners.clearSessionStageResultsKey' });
}

/**
 * 原子合并 stageResults.teaching 内的若干标志（读-改-写同一事务）。
 *
 * pause/resume/hold 这类"随时可点"的控制面不能拿请求开始时的快照整列回写：
 * 教学回合正在写 conversationHistory / pendingCheckpoint / lessonKnowledgePoints 时，
 * 整列回写会把整节课的最新状态回滚成用户点按钮那一刻的旧值（独立评审 P1）。
 */
export async function mergeSessionTeachingFlags(
  sessionId: string,
  flags: Record<string, unknown>
): Promise<void> {
  await withTransaction(async (tx) => {
    const current = await tx.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { stageResults: true },
    });
    const stageResults = parseJson<Record<string, unknown>>(current?.stageResults, {});
    const teaching = stageResults.teaching && typeof stageResults.teaching === 'object'
      ? stageResults.teaching as Record<string, unknown>
      : {};
    await tx.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        stageResults: JSON.stringify({ ...stageResults, teaching: { ...teaching, ...flags } }),
        updatedAt: new Date(),
      },
    });
  }, { label: 'virtual-learners.mergeSessionTeachingFlags' });
}

/**
 * 在模拟时钟上下文里跑"当天"的学习：path→teaching（必要时），按课表每天最多 lessonsPerDay 节。
 * 调用方已在会话租约内（runAssistedSessionMutation），故此处不再自持租约，避免自锁。
 */
export async function runDayLearning(
  sessionId: string,
  input: { lessonsPerDay: number; stageResults: Record<string, unknown>; profileData: Record<string, unknown> },
): Promise<{ started: boolean; chunks: number; error?: string }> {
  try {
    const current = await findSessionStageFields(sessionId);
    if (!current) return { started: false, chunks: 0, error: '会话不存在' };
    if (!['teaching', 'learn'].includes(String(current.currentStage))) {
      const review = await simulationCoordinator.resolvePathReview(sessionId, { startLearning: true });
      if (!review.success) return { started: false, chunks: 0, error: review.error || 'Path 评审/启动 Learn 失败' };
      // 评审可能"成功"但并未进入 Learn（decision=modify→重规划，currentStage 仍为 path）：
      // 当天并未上课，必须回滚（不能推进成功却烧掉一天）。
      if (!resolutionEnteredLearn(review)) {
        return {
          started: false,
          chunks: 0,
          error: `Path 评审未进入 Learn（decision=${review.decision || 'unknown'}，stage=${review.currentStage || 'unknown'}）`,
        };
      }
    }
    const budget = resolveSessionBudget({
      stageResults: input.stageResults as any,
      profileData: input.profileData as any,
    });
    const maxTurns = Math.max(1, budget.turnChunkPerLesson);
    const lessons = Math.max(1, Math.min(10, input.lessonsPerDay));
    const attempts: Array<{ success?: boolean; error?: string }> = [];
    for (let i = 0; i < lessons; i += 1) {
      let r = await simulationCoordinator.executeAutoLearning(sessionId, { maxMilestones: 1, maxTurns });
      // #154：课堂被解绑（卡死收课残留 / 并发收课）不是「当天没课」，而是「这门课需要重开」。
      // 旧实现见 !success 直接 break → summarizeDayLearning started:false → 时钟回滚、逐日空转。
      // 与 batch 驱动（batch-experiment.service）统一：识别 LEARN_CLASSROOM_UNBOUND 后重开本课再试一次。
      if (r && r.success !== true && /learn_classroom_unbound/i.test(String(r.error || ''))) {
        try {
          // 调用方已持有会话租约（runAssistedSessionMutation），此处直接重开，不再包 runLeasedExclusive（会自锁）。
          const resumed = await simulationCoordinator.restartLearningPhase(sessionId);
          if (resumed?.success) {
            r = await simulationCoordinator.executeAutoLearning(sessionId, { maxMilestones: 1, maxTurns });
          }
        } catch (recoverError: unknown) {
          logger.warn('[assisted] 解绑课堂自动续课失败，回滚当天（不白烧一天）', {
            sessionId,
            error: asErrorLike(recoverError).message
          });
        }
      }
      attempts.push({ success: r?.success === true, error: r?.error });
      if (!r?.success) break;
      const after = await findSessionStatus(sessionId);
      if (after?.status === 'completed') break;
    }
    // 零节成功（如会话已 failed/停止、上游抖动）→ started:false，路由回滚时钟，不白烧一天。
    return summarizeDayLearning(attempts);
  } catch (error) {
    return { started: false, chunks: 0, error: asErrorLike(error).message };
  }
}
