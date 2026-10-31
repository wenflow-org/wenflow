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
import { findSessionById, findSessionStageFields, findSessionStatus, deleteSessionLeases, markSessionAbandoned, createAdminAuditLog } from '../../services/virtual-lab/virtual-session.repo';
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

export function getExpectedBlackboxTraceCount(req: express.Request) {
  const header = req.get('X-Expected-Trace-Count');
  const bodyValue = req.body?.expectedTraceCount;
  const value = header ?? bodyValue;
  const parsed = typeof value === 'number' ? value : Number(value);
  return parsed;
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
      const r = await simulationCoordinator.executeAutoLearning(sessionId, { maxMilestones: 1, maxTurns });
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
