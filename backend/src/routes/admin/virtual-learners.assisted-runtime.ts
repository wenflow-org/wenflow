/**
 * 自动驾驶运行面：租约 / 黑盒 / 模拟钟 helper + step、auto、blackbox、autopilot、路径与教学驱动、日期推进、回归与批量
 *
 * 由 routes/admin/virtual-learners.ts 于 2026-10-19（issue #76）按声明簇纯搬移拆出（L252–L261、L2375–L2475、L2643–L2694、L3166–L3231、L2210–L2374、L2476–L2641、L2696–L3164、L3233–L4101）。
 * 契约不变：路由路径、注册顺序、中间件与处理器代码逐字未改；本文件只导出注册函数，
 * 由 virtual-learners.ts 在**同一个** router 实例上按原顺序调用（Express 顺序匹配语义与拆分前一致）。
 * 为保持逐行可 diff，搬移文本未重新缩进：register 函数体内的路由仍沿用原文件缩进（column 0）。
 */

import express, { type Router, type Request } from 'express';
import type { Prisma } from '../../services/prisma-client-types';
import { findProfileById, findProfileJsonById } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { findSessionById, findSessionStageFields, findSessionStatus, updateSessionStageResults, overwriteSessionStageResults, findSessionsForTerminate, deleteSessionLeases, markSessionAbandoned, createAdminAuditLog, findSessionsByIdPair } from '../../services/virtual-lab/virtual-session.repo';
import { appendSessionLogs as appendVirtualSessionLogs, hydrateSessionLogsField as hydrateVirtualSessionLogsField } from '../../services/virtual-lab/virtual-session-log-store';
import { logger } from '../../utils/logger';
import { withTransaction } from '../../utils/with-transaction';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import learningService from '../../services/learning/learning.service';
import { assertPathMutationSafe } from '../../services/learning/path-mutation-safety';
import blackboxVirtualLearnerRunner from '../../virtual-lab/blackbox-runner';
import type { LearnerAction } from '../../virtual-lab/contracts';
import { assertAssistedSessionMode } from '../../virtual-lab/session-mode';
import { autopilotService, AutopilotService } from '../../virtual-lab/autopilot.service';
import { virtualSessionReclaimService } from '../../virtual-lab/session-reclaim.service';
import { simulatedDayService, resolveSimulationClock, planClockAdvance, explainPlanFailure, resolveDayWindow, resolutionEnteredLearn, summarizeDayLearning, shouldAdvanceSimulationClock } from '../../services/virtual-lab/simulated-day.service';
import { runWithSimulatedClock } from '../../services/virtual-lab/simulation-clock-context';
import { resolveSessionBudget } from '../../virtual-lab/session-budget';
import { getVirtualLabSettings, DEFAULT_VIRTUAL_LAB_SETTINGS } from '../../services/virtual-lab-settings.service';
import { virtualCleanupService } from '../../services/virtual-lab/virtual-cleanup.service';
import { validateCards as validateCardDocument, importCards as importCardDocument, exportCards as exportCardLibrary, getCardWallIndex, getCardDetail, getCardTaskGroups, cloneCardsToLearners, CLONE_MAX_ITEMS } from '../../services/virtual-lab/card-import.service';
import { asErrorLike } from '../../virtual-lab/vlab-types';
import { sendVirtualSessionError } from './virtual-session-http';
import type { SimulationLogEntry } from '../../coordinators/simulation.types';
import type { LeaseClientLike, StageResults, VirtualSessionRow } from '../../virtual-lab/vlab-types';
import { parseJson, createSessionForProfile, SIMULATION_FRICTION_BUDGETS } from '../../virtual-lab/session-factory';
import { batchJobService } from '../../virtual-lab/batch-job.service';
import { regenerateWrapup } from '../../services/ai-teaching/teaching-wrapup-regen';
import { parseStoryContext, parseLearningProgress, parseStageResults } from './virtual-learners.projections';

// ===== 原 virtual-learners.ts L252–L261 =====
function parseSimulationLimit(value: unknown, fallback: number, max: number, field: string) {
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
function parseBlackboxAction(body: Record<string, unknown>): LearnerAction {
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

async function requireAssistedSession(sessionId: string) {
  const session = await findSessionById(sessionId);
  if (!session) throw new Error('模拟会话不存在');
  assertAssistedSessionMode(parseJson<StageResults>(session.stageResults, {}));
  return session;
}

async function runAssistedSessionMutation<T>(
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
async function runAssistedSessionMutationWithSimClock<T>(
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

function getBlackboxCommandId(req: express.Request) {
  const header = req.get('Idempotency-Key');
  const bodyValue = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  return String(header || bodyValue || '').trim();
}

function getExpectedBlackboxTraceCount(req: express.Request) {
  const header = req.get('X-Expected-Trace-Count');
  const bodyValue = req.body?.expectedTraceCount;
  const value = header ?? bodyValue;
  const parsed = typeof value === 'number' ? value : Number(value);
  return parsed;
}

// ===== 原 virtual-learners.ts L2643–L2694 =====
/** 单个会话终态化（operator 批量终止）：与 reclaim 同模式——只标记 abandoned，不删除任何数据 */
async function terminateSession(session: Pick<VirtualSessionRow, 'id' | 'status' | 'currentStage' | 'stageResults' | 'updatedAt'>, operator: { userId?: string | null; name?: string | null }) {
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
 * 在模拟时钟上下文里跑"当天"的学习：path→teaching（必要时），按课表每天最多 lessonsPerDay 节。
 * 调用方已在会话租约内（runAssistedSessionMutation），故此处不再自持租约，避免自锁。
 */
/**
 * 原子合并 stageResults 顶层键（读-改-写同一事务）。
 *
 * 为什么必须原子（虚拟学习者跑数观察 #1 的根因）：`advance-day` 若用**请求开始时的快照**整列回写，
 * 会覆盖当天学习过程中写入的 `path_review` / `runtimeStats` / `teaching` 等键。实测：回滚分支把
 * 当天写好的 `path_review`（含 `status:'accepted'`）抹掉 → 第二天 `runDayLearning` 见不到"已接受"
 * → **重新跑一次评审 LLM**、反复触顶 replan 上限。
 */
async function mergeSessionStageResults(sessionId: string, patch: Record<string, unknown>): Promise<void> {
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

async function runDayLearning(
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

export function registerAssistedRuntimeRoutes(router: Router): void {
// ===== 原 virtual-learners.ts L2210–L2374 =====
/**
 * 获取模拟会话上下文
 * GET /api/admin/virtual-learners/sessions/:sessionId/context 已删
 * （SessionCockpit 用 session 详情 + logs + path-status + teaching-detail 四请求替代）
 */

/**
 * 单步模拟（手动模式）
 * POST /api/admin/virtual-sessions/:sessionId/step
 */
router.post('/sessions/:sessionId/step', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutationWithSimClock(sessionId, session =>
      simulationCoordinator.executeSingleStep({
        sessionId,
        userId: session.userId,
        mode: 'single-step'
      })
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('单步模拟失败:', error);
    sendVirtualSessionError(res, error, '单步模拟失败');
  }
});

/**
 * 自动循环模拟
 * POST /api/admin/virtual-sessions/:sessionId/auto
 */
router.post('/sessions/:sessionId/auto', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const maxRounds = parseSimulationLimit(req.body?.maxRounds, 20, 50, 'maxRounds');
    
    const results = await runAssistedSessionMutationWithSimClock(sessionId, session =>
      simulationCoordinator.executeAutoLoop(
        {
          sessionId,
          userId: session.userId,
          mode: 'auto-loop'
        },
        { maxRounds }
      )
    );
    
    res.json({
      success: true,
      data: {
        results,
        totalRounds: results.length,
        lastResult: results[results.length - 1]
      }
    });
  } catch (error) {
    logger.error('自动循环模拟失败:', error);
    sendVirtualSessionError(res, error, '自动循环模拟失败');
  }
});

/**
 * 兜底重试：推进到路径生成阶段
 * 仅在 goalConversationService 自动触发的 path 生成失败时由前端调用
 * POST /api/admin/virtual-sessions/:sessionId/advance-path
 */
router.post('/sessions/:sessionId/advance-path', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.advanceToPathGeneration(sessionId)
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('推进路径生成失败:', error);
    sendVirtualSessionError(res, error, '推进路径生成失败');
  }
});

router.post('/:id/start-blackbox-session', async (req: Request, res) => {
  try {
    const { storyId, storyIndex, frictionBudget } = req.body || {};
    if (frictionBudget && !SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    const session = await createSessionForProfile(req.params.id, {
      storyId,
      storyIndex,
      frictionBudget,
      blackboxOperatorId: req.user.userId
    });
    if (!session) return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    res.json({ success: true, data: session });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logger.error('启动黑盒模拟会话失败:', error);
    res.status(status).json({
      success: false,
      error: error.message || '启动黑盒模拟会话失败',
      ...(error?.code ? { code: error.code } : {})
    });
  }
});

router.post('/sessions/:sessionId/blackbox-rerun', async (req: Request, res) => {
  try {
    const source = await findSessionById(req.params.sessionId);
    if (!source) return res.status(404).json({ success: false, error: '模拟会话不存在' });
    if (!['completed', 'failed', 'abandoned'].includes(source.status)) {
      return res.status(409).json({ success: false, error: '只有终态黑盒实验可以按原输入重跑' });
    }
    const sourceState = parseJson<StageResults>(source.stageResults, {});
    if (sourceState.experiment?.mode !== 'blackbox-api') {
      return res.status(409).json({ success: false, error: '当前会话不是 blackbox-api 实验' });
    }
    const snapshot = sourceState.experimentSnapshot;
    const simulatorSnapshots = [snapshot?.simulators?.goal, snapshot?.simulators?.teaching];
    const hasCompleteRuntimeSnapshot = snapshot?.actorProfile
      && snapshot?.frictionBudget
      && typeof snapshot?.simulatorPrompts?.goal === 'string'
      && typeof snapshot?.simulatorPrompts?.teaching === 'string'
      && simulatorSnapshots.every((item) => item?.route?.providerId
        && item?.route?.credentialFingerprint
        && item?.route?.endpoint
        && item?.route?.model
        && Number.isFinite(item?.temperature)
        && Number.isFinite(item?.maxTokens));
    if (!hasCompleteRuntimeSnapshot) {
      return res.status(409).json({ success: false, error: '旧实验缺少完整运行时快照，不能保证同配置重跑' });
    }
    if (!sourceState.experiment?.experimentId || !sourceState.experiment?.runId) {
      return res.status(409).json({ success: false, error: '旧实验缺少 lineage 标识，不能保证同实验重跑' });
    }
    const frictionBudget = (snapshot.frictionBudget || 'normal') as (typeof SIMULATION_FRICTION_BUDGETS)[number];
    if (!SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    const rerun = await createSessionForProfile(source.virtualProfileId, {
      frictionBudget,
      blackboxOperatorId: req.user.userId,
      experimentId: sourceState.experiment.experimentId,
      parentRunId: sourceState.experiment.runId,
      actorProfileOverride: snapshot.actorProfile,
      storyContextOverride: snapshot.story ?? null,
      hasStoryContextOverride: true,
      experimentSnapshotOverride: snapshot
    });
    if (!rerun) return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    res.json({ success: true, data: rerun });
  } catch (error) {
    logger.error('按原输入重跑黑盒实验失败:', error);
    sendVirtualSessionError(res, error, '按原输入重跑黑盒实验失败');
  }
});

// ===== 原 virtual-learners.ts L2476–L2641 =====
router.post('/sessions/:sessionId/blackbox-action', async (req: Request, res) => {
  try {
    const action = parseBlackboxAction(req.body);
    const command = await blackboxVirtualLearnerRunner.runCommand({
      sessionId: req.params.sessionId,
      operatorId: req.user.userId,
      commandId: getBlackboxCommandId(req),
      kind: 'action',
      request: action,
      expectedTraceCount: getExpectedBlackboxTraceCount(req)
    }, () => blackboxVirtualLearnerRunner.act(req.params.sessionId, req.user.userId, action));
    res.json({ success: true, data: command.result, reused: command.reused });
  } catch (error) {
    logger.error('执行黑盒学习者动作失败:', error);
    sendVirtualSessionError(res, error, '执行黑盒学习者动作失败');
  }
});

router.post('/sessions/:sessionId/blackbox-step', async (req: Request, res) => {
  try {
    const command = await blackboxVirtualLearnerRunner.runCommand({
      sessionId: req.params.sessionId,
      operatorId: req.user.userId,
      commandId: getBlackboxCommandId(req),
      kind: 'step',
      request: {},
      expectedTraceCount: getExpectedBlackboxTraceCount(req)
    }, () => blackboxVirtualLearnerRunner.autoStep(req.params.sessionId, req.user.userId));
    res.json({ success: true, data: command.result, reused: command.reused });
  } catch (error) {
    logger.error('执行黑盒自动步骤失败:', error);
    sendVirtualSessionError(res, error, '执行黑盒自动步骤失败');
  }
});

router.post('/sessions/:sessionId/blackbox-observe', async (req: Request, res) => {
  try {
    const command = await blackboxVirtualLearnerRunner.runCommand({
      sessionId: req.params.sessionId,
      operatorId: req.user.userId,
      commandId: getBlackboxCommandId(req),
      kind: 'observe',
      request: {},
      expectedTraceCount: getExpectedBlackboxTraceCount(req)
    }, () => blackboxVirtualLearnerRunner.observe(req.params.sessionId, req.user.userId));
    res.json({ success: true, data: command.result, reused: command.reused });
  } catch (error) {
    logger.error('刷新黑盒平台观察失败:', error);
    sendVirtualSessionError(res, error, '刷新黑盒平台观察失败');
  }
});

// 裁判/审计评估端点已迁出：POST /api/admin/session-audits/sessions/:id/evaluations
// （2026-09-27 拍板裁判独立面，见 routes/admin/session-audits.ts；VL 路由不再暴露评审入口）

/**
 * 全自动模式：以「最终目标（Path 全部任务完成）」为唯一终点的无人值守运行。
 * 后台异步执行（脱离 HTTP 连接），可随时 stop。
 * POST /api/admin/virtual-learners/sessions/:sessionId/autopilot/start
 * POST /api/admin/virtual-learners/sessions/:sessionId/autopilot/stop
 * GET  /api/admin/virtual-learners/sessions/:sessionId/autopilot
 */
router.post('/sessions/:sessionId/autopilot/start', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const session = await findSessionById(sessionId);
    if (!session) return res.status(404).json({ success: false, error: '模拟会话不存在' });
    const target = String(req.body?.target || 'final') === 'stage' ? 'stage' : 'final';
    // 每课回合上限透传（驾驶舱「回合上限」），未传则沿用状态内上次值/默认 50
    const rawTurns = Number(req.body?.maxTurns);
    const maxTurns = Number.isInteger(rawTurns) ? Math.min(100, Math.max(1, rawTurns)) : undefined;
    const result = await autopilotService.start(sessionId, { target, ...(maxTurns !== undefined ? { maxTurns } : {}) });
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('启动全自动模式失败:', error);
    sendVirtualSessionError(res, error, '启动全自动模式失败');
  }
});

router.post('/sessions/:sessionId/autopilot/stop', async (req: Request, res) => {
  try {
    const result = await autopilotService.stop(req.params.sessionId);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('停止全自动模式失败:', error);
    sendVirtualSessionError(res, error, '停止全自动模式失败');
  }
});

router.get('/sessions/:sessionId/autopilot', async (req: Request, res) => {
  try {
    const session = await findSessionById(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: '模拟会话不存在' });
    res.json({ success: true, data: AutopilotService.readState(session) });
  } catch (error) {
    logger.error('读取全自动状态失败:', error);
    res.status(500).json({ success: false, error: error.message || '读取全自动状态失败' });
  }
});

/**
 * 僵尸虚拟会话回收（P0-2/R4）：running/created 超阈值（默认 24h）无写入且无活跃租约
 * 的会话标记 failed 并写审计记录。只标记状态、不删除任何数据。
 * dryRun 默认 true：只报告符合回收条件的会话（干跑确认清单），dryRun=false 才落地标记。
 * POST /api/admin/virtual-learners/sessions/reclaim-stale  body: { dryRun?: boolean }
 */
router.post('/sessions/reclaim-stale', async (req: Request, res) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    const profileIds = Array.isArray(req.body?.profileIds) ? req.body.profileIds.map(String).filter(Boolean) : undefined;
    const result = await virtualSessionReclaimService.runReclaimOnce({ dryRun, ...(profileIds?.length ? { profileIds } : {}) });
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('僵尸虚拟会话回收失败:', error);
    res.status(500).json({ success: false, error: error?.message || '僵尸虚拟会话回收失败' });
  }
});

/**
 * 批量终止虚拟会话（A1）：非终态会话（running/created/learning 等）统一标记 abandoned，
 * 与 reclaim 同源做法：只改状态 + 追加 stageResults/logs + 写审计，不删除任何数据。
 * 支持按 sessionIds 或按 profileIds（后者 = 该虚拟人全部非终态会话）。
 * dryRun 默认 true：只报告将终止的会话，dryRun=false 才落地标记。
 * POST /api/admin/virtual-learners/sessions/terminate  body: { sessionIds?, profileIds?, dryRun? }
 */
router.post('/sessions/terminate', async (req: Request, res) => {
  try {
    const body = req.body ?? {};
    const dryRun = body.dryRun !== false;
    const sessionIds: string[] = Array.isArray(body.sessionIds) ? (body.sessionIds as unknown[]).map(String).filter(Boolean) : [];
    const profileIds: string[] = Array.isArray(body.profileIds) ? (body.profileIds as unknown[]).map(String).filter(Boolean) : [];
    if (!sessionIds.length && !profileIds.length) {
      return res.status(400).json({ success: false, error: 'sessionIds 与 profileIds 至少提供一个' });
    }
    const ids: string[] = [...new Set(sessionIds)];
    const sessions = await findSessionsForTerminate(ids, profileIds);

    const result = {
      dryRun,
      requested: sessions.length,
      skippedTerminal: 0,
      terminated: 0,
      sessions: [] as Array<{ id: string; virtualProfileId: string; status: string; currentStage: string }>
    };
    for (const session of sessions) {
      if (['completed', 'failed', 'abandoned'].includes(session.status)) {
        result.skippedTerminal += 1;
        continue;
      }
      result.sessions.push({
        id: session.id,
        virtualProfileId: session.virtualProfileId,
        status: session.status,
        currentStage: session.currentStage
      });
      if (!dryRun) {
        await terminateSession(session, req.user);
      }
      result.terminated += 1;
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('批量终止虚拟会话失败:', error);
    res.status(500).json({ success: false, error: error?.message || '批量终止虚拟会话失败' });
  }
});

// ===== 原 virtual-learners.ts L2696–L3164 =====
router.post('/sessions/:sessionId/review-path', async (req: Request, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.reviewPathProposal(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('Path 评审失败:', error);
    sendVirtualSessionError(res, error, 'Path 评审失败');
  }
});

/**
 * 人工确认接受评审结论（decision=accept 且评审对应当前 Path）。只改评审状态，不启动 Learn。
 * POST /api/admin/virtual-learners/sessions/:sessionId/accept-path
 */
router.post('/sessions/:sessionId/accept-path', async (req: Request, res) => {
  try {
    // force=true：运维强制接受当前 Path（评审为旁路，modify/reject 时不得堵死后续学习）
    const force = req.body?.force === true;
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.acceptPathReview(req.params.sessionId, { force })
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('接受 Path 失败:', error);
    sendVirtualSessionError(res, error, '接受 Path 失败');
  }
});

/**
 * 人工触发：按评审意见重规划 Path（评审保持 pending 直到人工决定）。
 * POST /api/admin/virtual-learners/sessions/:sessionId/replan-path
 */
router.post('/sessions/:sessionId/replan-path', async (req: Request, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.replanPathFromReview(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('重规划 Path 失败:', error);
    sendVirtualSessionError(res, error, '重规划 Path 失败');
  }
});

/**
 * 查询路径生成状态（前端轮询用）
 * GET /api/admin/virtual-sessions/:sessionId/path-status
 */
router.get('/sessions/:sessionId/path-status', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await findSessionById(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    if (!session.learningPathId) {
      return res.json({
        success: true,
        data: {
          status: session.currentStage === 'path' ? 'generating' : 'not_started',
          learningPathId: null,
          path: null,
          pathContext: null
        }
      });
    }
    
    const learningPath = await learningService.getLearningPath(session.learningPathId);
    
    if (!learningPath) {
      return res.json({
        success: true,
        data: {
          status: 'not_found',
          learningPathId: session.learningPathId,
          path: null,
          pathContext: null
        }
      });
    }

    const storyContext = parseStoryContext(session);
    const learningProgress = parseLearningProgress(session);
    const firstMilestone = learningPath.milestones?.[0] || null;
    const firstTask = firstMilestone?.subtasks?.[0] || null;
    const activeTask = learningPath.milestones
      ?.flatMap((milestone, milestoneIndex: number) => (milestone.subtasks || []).map((task, taskIndex: number) => ({
        ...task,
        milestone,
        milestoneIndex,
        taskIndex
      })))
      ?.find((task) => task.id === learningProgress.currentTaskId)
      || null;
    const contextTask = activeTask || firstTask;
    const contextMilestone = activeTask?.milestone || firstMilestone;
    const pathContext = {
      storyContext,
      pathTitle: learningPath.title,
      pathSummary: learningPath.summary || learningPath.description || learningPath.aiPromptTemplate || null,
      subject: learningPath.subject || null,
      currentStageNumber: learningProgress.currentMilestone !== undefined && learningProgress.currentMilestone !== null
        ? Number(learningProgress.currentMilestone) + 1
        : (contextMilestone?.stageNumber || 1),
      currentTaskOrder: learningProgress.currentTaskIdx !== undefined && learningProgress.currentTaskIdx !== null
        ? Number(learningProgress.currentTaskIdx) + 1
        : (contextTask?.order || 1),
      taskProfile: contextTask ? {
        knowledgeType: contextTask.knowledgeType || null,
        cognitiveLevel: contextTask.cognitiveLevel || null,
        displayLabel: contextTask.displayLabel || null,
        coreConcept: contextTask.coreConcept || null,
        learningObjectives: Array.isArray(contextTask.learningObjectives)
          ? contextTask.learningObjectives
          : typeof contextTask.learningObjectives === 'string' && contextTask.learningObjectives.trim()
            ? contextTask.learningObjectives.split(/[,，\n]/).map((item: string) => item.trim()).filter(Boolean)
            : [],
        linkedConceptName: contextTask.linkedConceptName || contextTask.coreConcept || null,
      } : null,
      currentMilestoneTitle: contextMilestone?.title || null,
      currentTaskTitle: contextTask?.title || null,
      taskKnowledgeScope: null,
      cognitiveFrame: null,
      teachingStrategyGuidance: null
    };

    // 路径生成重试信号（新发现问题 #2）：让跑数 harness 能把「生成失败」与「还没好」区分开，
    // 失败时立即止损而不是空等 readyTimeoutMs，并在允许时触发有界自愈重试。
    // 与用户侧 PATCH /paths/:pathId/retry 同源（learningService.getPathGenerationRetry）。
    let pathGeneration: {
      pathId: string;
      status: string;
      retryAllowed: boolean;
      retryType: 'core' | 'stageDesign' | null;
      reason: string;
    } | null = null;
    try {
      const retry = await learningService.getPathGenerationRetry(learningPath.id, session.userId);
      pathGeneration = {
        pathId: learningPath.id,
        status: learningPath.status,
        retryAllowed: retry.allowed,
        retryType: retry.retryType,
        reason: retry.reason
      };
    } catch (retryError) {
      logger.warn('[virtual-learners] path-status 读取生成重试状态失败', {
        sessionId,
        learningPathId: learningPath.id,
        error: (retryError as Error).message
      });
    }

    res.json({
      success: true,
      data: {
        status: learningPath.status,
        learningPathId: learningPath.id,
        path: {
          id: learningPath.id,
          title: learningPath.title,
          name: learningPath.name,
          summary: learningPath.summary || null,
          description: learningPath.description,
          subject: learningPath.subject,
          difficulty: learningPath.difficulty,
          estimatedHours: learningPath.estimatedHours,
          totalMilestones: learningPath.totalMilestones,
          completedMilestones: learningPath.completedMilestones,
          status: learningPath.status,
          aiGenerated: learningPath.aiGenerated,
          generationStatus: learningPath.generationStatus || null,
          sceneSummary: learningPath.sceneSummary || null,
          cognitiveDesign: learningPath.cognitiveDesign || null,
          adjustmentPolicy: learningPath.adjustmentPolicy || null,
          adjustmentEvidence: learningPath.adjustmentEvidence || null,
          canStartLearning: learningPath.canStartLearning,
          learningBlockedReason: learningPath.learningBlockedReason || null,
          replanLineage: learningPath.replanLineage || null,
          createdAt: learningPath.createdAt,
          updatedAt: learningPath.updatedAt,
          milestones: learningPath.milestones,
          stages: learningPath.stages || learningPath.milestones,
          totalStages: learningPath.totalStages || learningPath.totalMilestones,
          // 路径体量（goal 层 scope_size 决定）：供前端展示体量徽章 + 里程碑/子任务目标
          planningHints: (learningPath as any).processDetail?.framing?.normalizedInput?.planningHints ?? null
        },
        pathGeneration,
        pathContext
      }
    });
  } catch (error) {
    logger.error('查询路径状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '查询路径状态失败'
    });
  }
});

/**
 * 触发失败的路径生成重试（虚拟实验室自愈入口）。
 * POST /api/admin/virtual-learners/sessions/:sessionId/retry-path-generation
 *
 * 平台既有用户侧重试（PATCH /paths/:pathId/retry）要求 path 属主本人令牌；harness 持管理员
 * 会话，故此处用**模拟会话自身的 userId** 复用同一 learningService 重试逻辑（core / stageDesign）。
 * 有界次数由调用方（harness）控制；单次是否可重试仍由 getPathGenerationRetry 守卫。
 */
router.post('/sessions/:sessionId/retry-path-generation', async (req: Request, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.retryPathGeneration(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error) {
    logger.error('重试路径生成失败:', error);
    sendVirtualSessionError(res, error, '重试路径生成失败');
  }
});

/**
 * 开始 Learning 阶段
 * POST /api/admin/virtual-sessions/:sessionId/start-learning
 * body: { taskId?: string, mode?: 'tutor' | 'review' }
 * mode=review：开复习课（到期复习点注入），用于 #104 校准取样；收束走 complete_review 且不结算任务。
 */
router.post('/sessions/:sessionId/start-learning', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const { taskId, mode } = req.body || {};
    if (mode !== undefined && mode !== null && !['tutor', 'review'].includes(String(mode))) {
      return res.status(400).json({ success: false, error: 'mode 只能是 tutor/review' });
    }
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.startLearningPhase(sessionId, {
        taskId,
        ...(mode === 'review' ? { mode: 'review' as const } : {}),
      })
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('开始学习阶段失败:', error);
    sendVirtualSessionError(res, error, '开始学习阶段失败');
  }
});

/**
 * 执行单步学习
 * POST /api/admin/virtual-sessions/:sessionId/teaching-step
 */
router.post('/sessions/:sessionId/teaching-step', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.executeLearningStep(sessionId)
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('执行学习步骤失败:', error);
    sendVirtualSessionError(res, error, '执行学习步骤失败');
  }
});

/**
 * 自动学习（完成整个路径或指定里程碑数）
 * POST /api/admin/virtual-sessions/:sessionId/auto-learning
 */
router.post('/sessions/:sessionId/auto-learning', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const maxMilestones = parseSimulationLimit(req.body?.maxMilestones, 10, 20, 'maxMilestones');
    // 回合上限前端可配（默认 LEARN_AUTO_TURN_CAP=40）：不同课的收束节奏差异很大
    const maxTurns = parseSimulationLimit(req.body?.maxTurns, 40, 100, 'maxTurns');
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.executeAutoLearning(sessionId, { maxMilestones, maxTurns })
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('自动学习失败:', error);
    sendVirtualSessionError(res, error, '自动学习失败');
  }
});

/**
 * 一键全自动: Goal -> Path -> Learn 全流程
 * POST /api/admin/virtual-sessions/:sessionId/run-full
 * body: { maxRounds?, maxMilestones?, continueOnTaskComplete?, autoAdvanceToPath?, autoAdvanceToLearning? }
 */
router.post('/sessions/:sessionId/run-full', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const {
      maxRounds: requestedMaxRounds,
      maxMilestones: requestedMaxMilestones,
      continueOnTaskComplete = true,
      autoAdvanceToPath = true,
      autoAdvanceToLearning = true
    } = req.body || {};
    const maxRounds = parseSimulationLimit(requestedMaxRounds, 20, 50, 'maxRounds');
    const maxMilestones = parseSimulationLimit(requestedMaxMilestones, 10, 20, 'maxMilestones');

    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.executeFullSession(sessionId, {
        maxRounds,
        maxMilestones,
        continueOnTaskComplete,
        autoAdvanceToPath,
        autoAdvanceToLearning
      })
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('一键全流程失败:', error);
    sendVirtualSessionError(res, error, '一键全流程失败');
  }
});

/**
 * 手动触发 wrapup 学习总结
 * POST /api/admin/virtual-sessions/:sessionId/wrapup
 */
router.post('/sessions/:sessionId/wrapup', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.generateWrapupForSession(sessionId)
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('生成 wrapup 失败:', error);
    sendVirtualSessionError(res, error, '生成 wrapup 失败');
  }
});

/**
 * 更新 session 的模拟配置 (目前主要是 frictionBudget)
 * PUT /api/admin/virtual-learners/sessions/:sessionId/simulation-config
 * body: { frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test', experimentArm?: 'A' | 'B' | null,
 *         extensionProbe?: boolean, advisoryResponse?: 'keep' | 'later' | 'preview' | 'adopt' | null }
 * experimentArm：冻结考卷双臂协议（#85）的会话级臂标签。A = 护栏前口径（关闭 #84 后续回合
 * 肯定语护栏），B/缺省 = 现行口径；null 清除标签。仅用于对照实验，不改变默认行为。
 * extensionProbe：延伸学探针（2026-10-21）——每会话一次，在正课收束时强制开一节延伸课，
 * 用于验证 #124 链路；null 关闭。advisoryResponse：收束带回重排建议时记账的处置动作（只留痕，不执行重排）。
 */
router.put('/sessions/:sessionId/simulation-config', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const { frictionBudget, model, simulationClock, experimentArm, extensionProbe, advisoryResponse } = req.body || {};

    if (frictionBudget && !SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    if (model !== undefined && model !== null && typeof model !== 'string') {
      return res.status(400).json({ success: false, error: 'model 必须是字符串' });
    }
    if (experimentArm !== undefined && experimentArm !== null
      && !['A', 'B'].includes(String(experimentArm).toUpperCase())) {
      return res.status(400).json({ success: false, error: 'experimentArm 只能是 A/B 或 null' });
    }
    if (extensionProbe !== undefined && extensionProbe !== null && typeof extensionProbe !== 'boolean') {
      return res.status(400).json({ success: false, error: 'extensionProbe 必须是布尔值' });
    }
    if (advisoryResponse !== undefined && advisoryResponse !== null
      && !['keep', 'later', 'preview', 'adopt'].includes(String(advisoryResponse))) {
      return res.status(400).json({ success: false, error: 'advisoryResponse 只能是 keep/later/preview/adopt 或 null' });
    }
    // 日期模拟时钟（配置项）：baseDate=起点（YYYY-MM-DD）、enabled=会话级开关覆盖。
    // dayIndex/history 属推进进度，由 advance-day 写，不在此接受。
    if (simulationClock !== undefined) {
      if (!simulationClock || typeof simulationClock !== 'object') {
        return res.status(400).json({ success: false, error: 'simulationClock 必须是对象' });
      }
      if (simulationClock.baseDate !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(String(simulationClock.baseDate))) {
        return res.status(400).json({ success: false, error: 'simulationClock.baseDate 必须是 YYYY-MM-DD' });
      }
      if (simulationClock.enabled !== undefined && typeof simulationClock.enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'simulationClock.enabled 必须是布尔值' });
      }
      if (simulationClock.autoAdvance !== undefined && typeof simulationClock.autoAdvance !== 'boolean') {
        return res.status(400).json({ success: false, error: 'simulationClock.autoAdvance 必须是布尔值' });
      }
    }

    const result = await runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
      const stageResults = parseJson<StageResults>(session.stageResults, {});
      const nextStageResults = {
        ...stageResults,
        simulationConfig: {
          ...(stageResults.simulationConfig || {}),
          ...(frictionBudget ? { frictionBudget } : {}),
          ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
          // experimentArm：null = 清除标签（JSON.stringify 时 undefined 键被丢弃）
          ...(experimentArm !== undefined
            ? {
                experimentArm: experimentArm === null
                  ? undefined
                  : String(experimentArm).trim().toUpperCase(),
              }
            : {}),
          // 延伸学探针 / 建议处置（2026-10-21）：null 清除；布尔/枚举写入
          ...(extensionProbe !== undefined
            ? { extensionProbe: extensionProbe === null ? undefined : extensionProbe }
            : {}),
          ...(advisoryResponse !== undefined
            ? { advisoryResponse: advisoryResponse === null ? undefined : String(advisoryResponse) }
            : {}),
        },
        ...(simulationClock ? {
          simulationClock: {
            ...((stageResults as any).simulationClock || {}),
            ...(simulationClock.baseDate ? { baseDate: String(simulationClock.baseDate).slice(0, 10) } : {}),
            ...(typeof simulationClock.enabled === 'boolean' ? { enabled: simulationClock.enabled } : {}),
            ...(typeof simulationClock.autoAdvance === 'boolean' ? { autoAdvance: simulationClock.autoAdvance } : {}),
          }
        } : {})
      };

      await assertLeaseOwned();
      await updateSessionStageResults(sessionId, JSON.stringify(nextStageResults));

      await assertLeaseOwned();
      return nextStageResults;
    });

    res.json({
      success: true,
      data: {
        simulationConfig: result.simulationConfig,
        simulationClock: (result as any).simulationClock ?? null,
      }
    });
  } catch (error) {
    logger.error('更新 simulation-config 失败:', error);
    sendVirtualSessionError(res, error, '更新 simulation-config 失败');
  }
});

/**
 * POST /api/admin/virtual-learners/sessions/:sessionId/simulation-clock/reset
 * 重置日期模拟进度（dayIndex=0、清空 history；可选重设 baseDate）。只对虚拟学习者。
 */
router.post('/sessions/:sessionId/simulation-clock/reset', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const nextBaseDate = req.body?.baseDate;
    if (nextBaseDate !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(String(nextBaseDate))) {
      return res.status(400).json({ success: false, error: 'baseDate 必须是 YYYY-MM-DD' });
    }

    await runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
      const stageResults = parseJson<StageResults>(session.stageResults, {});
      const prevClock = ((stageResults as any).simulationClock || {}) as Record<string, unknown>;
      const nextClock: Record<string, unknown> = {
        ...prevClock,
        dayIndex: 0,
        simulatedNow: null,
        advancedTimes: 0,
        history: [],
      };
      if (nextBaseDate) nextClock.baseDate = String(nextBaseDate).slice(0, 10);
      const nextStageResults = { ...stageResults, simulationClock: nextClock };

      await assertLeaseOwned();
      await updateSessionStageResults(sessionId, JSON.stringify(nextStageResults));
      await assertLeaseOwned();
      return nextClock;
    });

    const clock = await simulatedDayService.getSimulationClock(sessionId);
    res.json({ success: true, data: clock });
  } catch (error) {
    logger.error('重置模拟时钟失败:', error);
    sendVirtualSessionError(res, error, '重置模拟时钟失败');
  }
});

// ===== 原 virtual-learners.ts L3233–L4101 =====
/**
 * POST /api/admin/virtual-learners/sessions/:sessionId/advance-day
 * 推进日期模拟：按课表向前推进 days 个"上课日"（跳过非上课日）。
 * runTasks=true 时，在**模拟时钟上下文**内真实跑当天的学习（每天最多 lessonsPerDay 节），
 * 课堂/记忆/指标的业务时间戳落在模拟日（无上下文时等价于真墙钟 → 现网不变）。
 */
router.post('/sessions/:sessionId/advance-day', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const days = req.body?.days === undefined ? 1 : Number(req.body.days);
    const runTasks = req.body?.runTasks === true;
    if (!Number.isFinite(days) || days < 1 || days > 60) {
      return res.status(400).json({ success: false, error: 'days 必须是 1..60 的数字' });
    }
    // 跑课只针对"某一天"：days>1 时只会用最后一天的窗口跑课，中间模拟日被静默跳过
    // （18 号报告观察项）。显式拒绝，多天推进请用 runTasks=false（纯记账）。
    if (runTasks && days > 1) {
      return res.status(400).json({
        success: false,
        error: 'runTasks 模式一次只能推进 1 天；如需一次推进多天请用 runTasks=false（仅推进时钟）',
      });
    }

    const result = await runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
      const settings = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
      const stageResults = parseJson<StageResults>(session.stageResults, {});
      const rawClock = (stageResults as any).simulationClock || {};
      const profile = await findProfileJsonById(session.virtualProfileId)
        .catch(() => null);
      const profileData = parseJson<Record<string, unknown>>(profile?.profile, {});
      const clock = resolveSimulationClock({
        stageResultsClock: rawClock,
        profileClock: (profileData as any)?.simulationClock ?? null,
        settings: settings.dateSimulation,
        sessionCreatedAt: session.createdAt,
      });
      if (!clock.enabled) {
        const err: any = new Error('日期模拟未开启，请先在「日期模拟」设置中开启');
        err.statusCode = 409;
        throw err;
      }
      const plan = planClockAdvance(clock, rawClock, days);
      if (!plan) {
        const why = explainPlanFailure(clock, days);
        const err: any = new Error(why.message);
        err.statusCode = 409;
        err.code = `SIM_DAY_${why.reason.toUpperCase()}`;
        throw err;
      }
      const lastIndex = plan.indexes[plan.indexes.length - 1];
      const dayWindow = resolveDayWindow(clock.baseDate, lastIndex, clock.timezone);
      const nextClock = { ...(rawClock || {}), enabled: true, ...plan.nextClock };
      const nextStageResults = { ...stageResults, simulationClock: nextClock };

      let learning: { started: boolean; chunks: number; error?: string } | null = null;
      if (runTasks) {
        // 模拟日窗口内跑当天学习：写入点（课堂/记忆/指标）用该 asOf，落在模拟日
        learning = await runWithSimulatedClock(dayWindow.asOf, () =>
          runDayLearning(sessionId, {
            lessonsPerDay: clock.lessonsPerDay,
            stageResults: nextStageResults as unknown as Record<string, unknown>,
            profileData: profileData as Record<string, unknown>,
          }),
        );
      }
      // 只有当天确实上了课（或纯记账 runTasks=false）才推进模拟时钟；未推进 = 该模拟日不被消耗、可重试。
      // 不再"先推进再回滚"（跑数观察 #4：回滚只回滚时钟、回滚不了当天已写入的课堂/记忆/锚点）。
      if (!shouldAdvanceSimulationClock({ runTasks, learning })) {
        return { advancedDayIndexes: [], simulatedDay: dayWindow.simulatedDay, learning, reverted: true };
      }
      await assertLeaseOwned();
      // 只有当天确实上了课（或纯记账 runTasks=false）才推进模拟时钟；原子合并，不整列覆盖。
      await mergeSessionStageResults(sessionId, { simulationClock: nextClock });
      await assertLeaseOwned();
      return { advancedDayIndexes: plan.indexes, simulatedDay: dayWindow.simulatedDay, learning };
    });

    const clock = await simulatedDayService.getSimulationClock(sessionId);
    res.json({ success: true, data: { ...result, clock } });
  } catch (error) {
    logger.error('推进日期模拟失败:', error);
    sendVirtualSessionError(res, error, '推进日期模拟失败');
  }
});

router.post('/sessions/:sessionId/restart-path', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.restartPathPhase(sessionId)
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('重新开始路径失败:', error);
    sendVirtualSessionError(res, error, '重新开始路径失败');
  }
});

router.post('/sessions/:sessionId/restart-learning', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const { taskId } = req.body || {};
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.restartLearningPhase(sessionId, { taskId })
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('重新开始学习失败:', error);
    sendVirtualSessionError(res, error, '重新开始学习失败');
  }
});

router.post('/sessions/:sessionId/stop-learning', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    // 旁路停止：不经租约队列——auto-learning 整循环持一次租约，排队会让「紧急」停止
    // 挂起到循环自然结束。requestStopLearning 先落 manualStop 标志让循环自行退出，
    // 仅在无活跃循环时才就地终态化。
    const result = await simulationCoordinator.requestStopLearning(sessionId, 'admin-emergency-stop');

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('紧急停止学习失败:', error);
    sendVirtualSessionError(res, error, '紧急停止学习失败');
  }
});

/**
 * 暂停会话（温和暂停，非紧急停止）
 * 设 paused: true，自动循环检测到后停止；可 resume 恢复
 * POST /api/admin/virtual-learners/sessions/:sessionId/pause
 */
router.post('/sessions/:sessionId/pause', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const session = await findSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: { message: '会话不存在' } });
    }
    if (session.status !== 'running') {
      return res.status(409).json({ success: false, error: { message: `会话状态为 ${session.status}，仅运行中可暂停` } });
    }
    // paused 标志只有 learn 自动循环会检查；goal/path 阶段写入是静默 no-op，
    // 且后续 startLearningPhase 会整体覆写 teaching 键把标志抹掉——明确拒绝而非假装成功
    if (session.currentStage !== 'teaching') {
      return res.status(409).json({ success: false, error: { message: `当前阶段为 ${session.currentStage}，仅教学（teaching）阶段支持暂停` } });
    }
    const stageResults = typeof session.stageResults === 'string'
      ? JSON.parse(session.stageResults || '{}')
      : (session.stageResults || {});
    if (stageResults.teaching && typeof stageResults.teaching === 'object') {
      stageResults.teaching.paused = true;
    } else {
      stageResults.teaching = { ...(stageResults.teaching || {}), paused: true };
    }

    await updateSessionStageResults(sessionId, JSON.stringify(stageResults));

    logger.info('[admin] 会话已暂停', { sessionId });
    res.json({ success: true, data: { sessionId, status: 'running', paused: true } });
  } catch (error) {
    logger.error('暂停会话失败:', error);
    sendVirtualSessionError(res, error, '暂停会话失败');
  }
});

/**
 * 恢复暂停的会话
 * 清 paused 标志，可继续从当前任务执行
 * POST /api/admin/virtual-learners/sessions/:sessionId/resume
 */
router.post('/sessions/:sessionId/resume', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const session = await findSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: { message: '会话不存在' } });
    }
    if (session.status !== 'running') {
      return res.status(409).json({ success: false, error: { message: `会话状态为 ${session.status}，仅运行中可恢复` } });
    }

    // 清 paused 标志
    const stageResults = typeof session.stageResults === 'string'
      ? JSON.parse(session.stageResults || '{}')
      : (session.stageResults || {});
    if (stageResults.teaching && typeof stageResults.teaching === 'object') {
      stageResults.teaching.paused = false;
    }

    await updateSessionStageResults(sessionId, JSON.stringify(stageResults));

    logger.info('[admin] 会话已恢复', { sessionId });
    res.json({ success: true, data: { sessionId, status: 'running', paused: false } });
  } catch (error) {
    logger.error('恢复会话失败:', error);
    sendVirtualSessionError(res, error, '恢复会话失败');
  }
});

/**
 * 声明 hold（外部驱动/运维的「故意停留」申报）
 * 与 pause 的区别：pause 是 teaching 阶段的教学暂停（自动循环识别）；
 * hold 是阶段无关的回收豁免申报——僵尸回收器跳过带 hold 的会话，防「故意停留」被误判真死。
 * body: { reason?: string, until?: string（ISO 时间，缺省=无限期） }
 * POST /api/admin/virtual-learners/sessions/:sessionId/hold
 */
router.post('/sessions/:sessionId/hold', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : 'external-driver-hold';
    const until = typeof req.body?.until === 'string' && !Number.isNaN(new Date(req.body.until).getTime())
      ? new Date(req.body.until).toISOString()
      : undefined;
    const session = await findSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: { message: '会话不存在' } });
    }
    if (session.status !== 'running' && session.status !== 'created') {
      return res.status(409).json({ success: false, error: { message: `会话状态为 ${session.status}，仅运行中/创建中可 hold` } });
    }
    const stageResults = typeof session.stageResults === 'string'
      ? JSON.parse(session.stageResults || '{}')
      : (session.stageResults || {});
    stageResults.hold = { by: 'admin', reason, ...(until ? { until } : {}), at: new Date().toISOString() };

    await updateSessionStageResults(sessionId, JSON.stringify(stageResults));

    logger.info('[admin] 会话已声明 hold', { sessionId, reason, until: until || null });
    res.json({ success: true, data: { sessionId, status: session.status, hold: stageResults.hold } });
  } catch (error) {
    logger.error('声明 hold 失败:', error);
    sendVirtualSessionError(res, error, '声明 hold 失败');
  }
});

/**
 * 解除 hold
 * POST /api/admin/virtual-learners/sessions/:sessionId/unhold
 */
router.post('/sessions/:sessionId/unhold', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const session = await findSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: { message: '会话不存在' } });
    }
    const stageResults = typeof session.stageResults === 'string'
      ? JSON.parse(session.stageResults || '{}')
      : (session.stageResults || {});
    delete stageResults.hold;

    await updateSessionStageResults(sessionId, JSON.stringify(stageResults));

    logger.info('[admin] 会话已解除 hold', { sessionId });
    res.json({ success: true, data: { sessionId, hold: null } });
  } catch (error) {
    logger.error('解除 hold 失败:', error);
    sendVirtualSessionError(res, error, '解除 hold 失败');
  }
});

/**
 * 获取模拟会话日志
 * GET /api/admin/virtual-sessions/:sessionId/logs
 */
router.get('/sessions/:sessionId/logs', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await findSessionById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    // 日志子表水合（侧表权威则覆写内存 logs 字段）
    await hydrateVirtualSessionLogsField(session);

    let logs: SimulationLogEntry[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {
      // ignore malformed logs payload
    }
    
    res.json({
      success: true,
      data: {
        logs,
        totalLogs: logs.length
      }
    });
  } catch (error) {
    logger.error('获取模拟会话日志失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话日志失败'
    });
  }
});

/**
 * 删除模拟会话
 * DELETE /api/admin/virtual-sessions/:sessionId
 */
router.delete('/sessions/:sessionId', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;

    const existingSession = await findSessionById(sessionId);

    if (!existingSession) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    const session = await simulationCoordinator.runLeasedExclusive(sessionId, async assertLeaseOwned => {
      const leasedSession = await findSessionById(sessionId);
      if (!leasedSession) throw new Error('模拟会话不存在');

      let deletedTeachingCount = 0;
      let deletedEvidenceCount = 0;
      let deletedPredictionCount = 0;
      const teachingSessionIds: string[] = [];
      await assertLeaseOwned();
      await withTransaction(async tx => {
        await assertLeaseOwned(tx);
        const teachingSessionScopes: Prisma.teaching_sessionsWhereInput[] = [];
        const teachingSessionId = parseLearningProgress(leasedSession).teachingSessionId;
        if (teachingSessionId) teachingSessionScopes.push({ id: String(teachingSessionId) });

        if (leasedSession.learningPathId) {
          const learningPath = await tx.learning_paths.findFirst({
            where: {
              id: leasedSession.learningPathId,
              userId: leasedSession.userId
            },
            select: { id: true }
          });
          if (!learningPath) {
            throw Object.assign(new Error('学习路径不属于当前虚拟学习者'), {
              code: 'VIRTUAL_SESSION_PATH_OWNERSHIP_MISMATCH',
              statusCode: 409
            });
          }

          await assertPathMutationSafe(tx, learningPath.id, 'delete-path');

          const pathTasks = await tx.subtasks.findMany({
            where: { milestones: { learningPathId: learningPath.id } },
            select: { id: true }
          });
          const taskIds = pathTasks.map((task: { id: string }) => task.id);
          teachingSessionScopes.push(
            { learningPathId: learningPath.id },
            ...(taskIds.length > 0 ? [{ taskId: { in: taskIds } }] : [])
          );
        }

        if (teachingSessionScopes.length > 0) {
          const associatedTeachingSessions = await tx.teaching_sessions.findMany({
            where: { OR: teachingSessionScopes },
            select: { id: true }
          });
          // F22：教学会话 id 留给下面的会话级残留级联（learner_evidence/prediction_records）
          teachingSessionIds.push(...associatedTeachingSessions.map((s: { id: string }) => s.id));
          if (associatedTeachingSessions.length > 0) {
            // R3 级联：虚拟学习者会话允许级联删除关联教学记录（虚拟数据可再生成）；
            // 真实用户会话仍保持原 409 保护，不触碰真实教学数据。
            const owner = await tx.users.findUnique({
              where: { id: leasedSession.userId },
              select: { isVirtualLearner: true }
            });
            if (!owner?.isVirtualLearner) {
              throw Object.assign(new Error('模拟会话仍有关联课堂记录，不能删除'), {
                code: 'VIRTUAL_SESSION_HAS_TEACHING_RECORDS',
                statusCode: 409
              });
            }
            deletedTeachingCount = (await tx.teaching_sessions.deleteMany({
              where: { OR: teachingSessionScopes }
            })).count;
          }
        }

        if (leasedSession.goalConversationId) {
          await tx.goal_conversations.deleteMany({
            where: {
              id: leasedSession.goalConversationId,
              userId: leasedSession.userId
            }
          });
        }
        if (leasedSession.learningPathId) {
          await tx.learning_paths.deleteMany({
            where: {
              id: leasedSession.learningPathId,
              userId: leasedSession.userId
            }
          });
        }
        /* F22 级联收口（2026-10-15）：会话键的会话级残留随删——证据流与预测记录。
           两表的 sessionId 两套 id 空间都出现过（教学会话 id：teaching-checkpoint 等写入；
           虚拟会话 UUID：churn/投影等按虚拟会话记），一并删除。
           agent_call_logs 是成本/调用遥测（排查上游超时/失败的唯一回看面），保留不删；
           memory_traces/learner_projections/misconception_ledger 按 userId 键控，
           是画像跨会话资产，不随单个会话删除（确认框文案写明保留范围）。 */
        const evidenceSessionIds = [...teachingSessionIds, sessionId];
        deletedEvidenceCount = (await tx.learner_evidence.deleteMany({ where: { sessionId: { in: evidenceSessionIds } } })).count;
        deletedPredictionCount = (await tx.prediction_records.deleteMany({ where: { sessionId: { in: evidenceSessionIds } } })).count;
        await tx.virtual_sessions.delete({
          where: { id: sessionId }
        });
      }, { label: 'virtual-learners.cascadeDeleteSession' });

      return { session: leasedSession, deletedTeachingCount, deletedEvidenceCount, deletedPredictionCount };
    }, { skipFinalLeaseCheck: true });

    if (session.deletedTeachingCount > 0 || session.deletedEvidenceCount > 0 || session.deletedPredictionCount > 0) {
      try {
        await createAdminAuditLog({
          data: {
            adminId: req.user?.userId ?? null,
            adminName: req.user?.email ?? null,
            action: 'virtual-cascade-delete',
            targetType: 'virtual-session',
            targetId: sessionId,
            beforeJson: JSON.stringify({ userId: session.session.userId }),
            afterJson: JSON.stringify({
              deletedTeachingSessions: session.deletedTeachingCount,
              deletedEvidence: session.deletedEvidenceCount,
              deletedPredictions: session.deletedPredictionCount
            }),
            method: 'DELETE',
            path: `/admin/virtual-learners/sessions/${sessionId}`,
            statusCode: 200,
            success: true,
            durationMs: 0
          }
        }).catch((error: Error) => {
          logger.warn('[virtual-learners] 会话级联删除审计写入失败', {
            error: error?.message || String(error),
            sessionId
          });
        });
      } catch (error) {
        logger.warn('[virtual-learners] 会话级联删除审计写入失败', {
          error: error?.message || String(error),
          sessionId
        });
      }
    }

    logger.info('删除模拟会话成功', {
      sessionId,
      userId: session.session.userId,
      deletedTeachingCount: session.deletedTeachingCount,
      deletedEvidenceCount: session.deletedEvidenceCount,
      deletedPredictionCount: session.deletedPredictionCount
    });

    res.json({
      success: true,
      message: '模拟会话已删除',
      ...(session.deletedTeachingCount > 0 || session.deletedEvidenceCount > 0 || session.deletedPredictionCount > 0
        ? {
            data: {
              cleanup: {
                deletedTeachingSessions: session.deletedTeachingCount,
                deletedEvidence: session.deletedEvidenceCount,
                deletedPredictions: session.deletedPredictionCount
              }
            }
          }
        : {})
    });
  } catch (error) {
    logger.error('删除模拟会话失败:', error);
    sendVirtualSessionError(res, error, '删除模拟会话失败');
  }
});

/**
 * 回归测试: 跑一个完整的 Goal→Path 流程, 可指定 prompt 版本 override
 * POST /api/admin/virtual-learners/:profileId/regression-run
 */
router.post('/:profileId/regression-run', async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { profileId } = req.params;
    const { storyId, storyIndex, maxGoalRounds: requestedMaxGoalRounds, systemPromptOverrides } = req.body || {};
    const maxGoalRounds = parseSimulationLimit(requestedMaxGoalRounds, 20, 50, 'maxGoalRounds');

    const profile = await findProfileById(profileId);
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    // 1. 创建新 session
    const session = await createSessionForProfile(profileId, { storyId, storyIndex });
    if (!session) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在或故事池为空' });
    }
    const sessionId = session.id;

    // 2. 执行全自动 (Goal→Path→Learn 一条龙, 受 maxGoalRounds 限制)
    const result = await runAssistedSessionMutation(sessionId, async (leasedSession, assertLeaseOwned) => {
      if (systemPromptOverrides && typeof systemPromptOverrides === 'object') {
        const goalAgent = typeof systemPromptOverrides.goalAgent === 'string' ? systemPromptOverrides.goalAgent.trim() : '';
        const pathAgent = typeof systemPromptOverrides.pathAgent === 'string' ? systemPromptOverrides.pathAgent.trim() : '';
        if (goalAgent || pathAgent) {
          await assertLeaseOwned();
          await overwriteSessionStageResults(sessionId, JSON.stringify({
            ...parseJson(leasedSession.stageResults, {}),
            systemPromptOverrides: { goalAgent: goalAgent || undefined, pathAgent: pathAgent || undefined }
          }));
          await assertLeaseOwned();
        }
      }

      return simulationCoordinator.executeFullSession(sessionId, {
        maxRounds: maxGoalRounds,
        maxMilestones: 5,
        continueOnTaskComplete: false, // 回归测试只跑首个 task
        autoAdvanceToPath: true,
        autoAdvanceToLearning: false  // 回归测试主要看 Goal+Path, 不跑完整 Learn
      });
    });

    res.json({
      success: result.success,
      data: {
        sessionId,
        ...result,
      },
      error: result.error
    });
  } catch (error) {
    logger.error('回归测试失败:', error);
    sendVirtualSessionError(res, error, '回归测试失败');
  }
});

/**
 * 回归对比: 对比两个 session 的关键运行结果
 * GET /api/admin/virtual-learners/regression/compare-sessions?sessionA=&sessionB=
 */
router.get('/regression/compare-sessions', async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const sessionA = String(req.query.sessionA || '');
    const sessionB = String(req.query.sessionB || '');
    if (!sessionA || !sessionB) {
      return res.status(400).json({ success: false, error: '需要提供 sessionA 与 sessionB' });
    }

    const [a, b] = await findSessionsByIdPair(sessionA, sessionB);

    if (!a || !b) {
      return res.status(404).json({
        success: false,
        error: '至少一个 session 不存在'
      });
    }

    const summarize = (s: VirtualSessionRow) => {
      const stageResults = parseStageResults(s);
      return {
        id: s.id,
        status: s.status,
        currentStage: s.currentStage,
        goalConversationId: s.goalConversationId,
        learningPathId: s.learningPathId,
        currentTaskId: s.currentTaskId,
        completedTasks: s.completedTasks,
        totalTasks: s.totalTasks,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        goalStage: stageResults?.goal?.finalStage || stageResults?.goal?.stage || null,
        pathReady: !!stageResults?.path?.success,
        learnerStateSnapshot: stageResults?.teaching?.learnerState || stageResults?.goal?.learnerState || null,
        wrapup: stageResults?.teaching?.wrapup || null,
        rounds: {
          goal: Array.isArray(stageResults?.goal?.conversationHistory) ? stageResults.goal.conversationHistory.length : 0,
          learning: Array.isArray(stageResults?.teaching?.conversationHistory) ? stageResults.teaching.conversationHistory.length : 0,
        }
      };
    };

    res.json({
      success: true,
      data: {
        sessionA: summarize(a),
        sessionB: summarize(b),
      }
    });
  } catch (error) {
    logger.error('对比 session 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '对比 session 失败'
    });
  }
});

/**
 * 降级 wrapup 重生成（2026-10-11 补轮）：仅完结且 wrapup 退化为 summary-only 的会话可重跑
 * wrapup 技能并回写产物 + 补写 learning_metrics。POST /api/admin/virtual-learners/sessions/:sessionId/regenerate-wrapup
 */
router.post('/sessions/:sessionId/regenerate-wrapup', async (req: Request, res) => {
  try {
    const result = await regenerateWrapup(req.params.sessionId, {
      adminId: req.user?.userId ?? null,
      adminName: req.user?.email ?? null
    });
    if (result.error) {
      return res.status(409).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('wrapup 重生成失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || 'wrapup 重生成失败' });
  }
});

/**
 * 批量删除虚拟学习者（A3）：级联删除 profile + user + 全部虚拟数据。
 * 后端已通过 virtualCleanupService.cascadeDeleteProfile 打通 409 死锁。
 * POST /api/admin/virtual-learners/batch-delete  body: { profileIds: string[] }
 */
router.post('/batch-delete', async (req: Request, res) => {
  try {
    const profileIds: string[] = Array.isArray(req.body?.profileIds)
      ? (req.body.profileIds as unknown[]).map(String).filter(Boolean)
      : [];
    if (!profileIds.length) {
      return res.status(400).json({ success: false, error: 'profileIds 至少提供一个' });
    }
    // 每个 id 触发一个大级联事务，串行执行；不设上限的批次会拖垮请求与数据库
    if (profileIds.length > 100) {
      return res.status(400).json({ success: false, error: '单批最多删除 100 个，请分批操作' });
    }

    const deleted: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of profileIds) {
      try {
        await virtualCleanupService.cascadeDeleteProfile(id, {
          adminId: req.user?.userId ?? null,
          adminName: req.user?.email ?? null
        });
        deleted.push(id);
      } catch (error) {
        if (error?.code === 'VIRTUAL_PROFILE_REAL_USER_PROTECTED') {
          skipped.push(id);
        } else if (error?.code === 'VIRTUAL_PROFILE_NOT_FOUND') {
          // 不存在属于「无需处理」而非失败，归入 skipped 保持语义一致
          skipped.push(id);
        } else {
          errors.push({ id, error: error.message || '删除失败' });
        }
      }
    }

    logger.info('批量删除虚拟学习者完成', {
      total: profileIds.length,
      deleted: deleted.length,
      skipped: skipped.length,
      errors: errors.length,
      operatorId: req.user?.userId ?? null
    });

    res.json({
      success: errors.length === 0,
      data: { deleted, skipped, errors }
    });
  } catch (error) {
    logger.error('批量删除虚拟学习者失败:', error);
    res.status(500).json({ success: false, error: error?.message || '批量删除失败' });
  }
});

/**
 * 批量新建虚拟学习者（服务端队列）：
 * 同步创建学习者（秒回 batchId），后台逐个生成身份 + 故事，前端轮询进度。
 * POST /api/admin/virtual-learners/batch-create
 * body: { rows: [{ name, storyCount }], cohort?, note? }
 */
router.post('/batch-create', async (req: Request, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Array<{ name?: string; storyCount?: number }>) : [];
    if (!rows.length) {
      return res.status(400).json({ success: false, error: 'rows 至少提供一行' });
    }
    if (rows.length > 50) {
      return res.status(400).json({ success: false, error: '单批最多 50 人，请分批操作' });
    }
    const result = await batchJobService.submit({
      rows: rows.map((r) => ({ name: String(r?.name || '').trim(), storyCount: Math.round(Number(r?.storyCount)) || 0 })),
      cohort: typeof req.body?.cohort === 'string' ? req.body.cohort : undefined,
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      createdBy: req.user?.userId ?? null,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('批量新建失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '批量新建失败' });
  }
});

/**
 * 批量任务进度
 * GET /api/admin/virtual-learners/batch-create/:batchId
 */
router.get('/batch-create/:batchId', async (req: Request, res) => {
  try {
    const job = await batchJobService.getJob(req.params.batchId);
    if (!job) {
      return res.status(404).json({ success: false, error: '批量任务不存在' });
    }
    res.json({ success: true, data: job });
  } catch (error) {
    logger.error('查询批量任务失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '查询批量任务失败' });
  }
});

/**
 * 批量任务重试失败项
 * POST /api/admin/virtual-learners/batch-create/:batchId/retry
 */
router.post('/batch-create/:batchId/retry', async (req: Request, res) => {
  try {
    const ok = await batchJobService.retry(req.params.batchId);
    if (!ok) {
      return res.status(404).json({ success: false, error: '批量任务不存在或没有失败项' });
    }
    res.json({ success: true, data: { retried: true } });
  } catch (error) {
    logger.error('批量任务重试失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '批量任务重试失败' });
  }
});

/**
 * 学习者卡库：校验（不落库）
 * POST /api/admin/virtual-learners/cards/validate
 * body: { content: string, format?: 'yaml' | 'json' }
 */
router.post('/cards/validate', async (req: Request, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content.trim()) {
      return res.status(400).json({ success: false, error: 'content 不能为空' });
    }
    const format = req.body?.format === 'json' ? 'json' : 'yaml';
    const result = await validateCardDocument(content, format);
    if (result.parseError) {
      return res.status(400).json({ success: false, error: result.parseError });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('学习者卡校验失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '学习者卡校验失败' });
  }
});

/**
 * 学习者卡库：导入（一张卡 = 账号 + 档案 + 故事池，结构化落库，不经编译链）
 * POST /api/admin/virtual-learners/cards/import
 * body: { content: string, format?: 'yaml' | 'json', enrich?: boolean, update?: boolean }
 */
router.post('/cards/import', async (req: Request, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content.trim()) {
      return res.status(400).json({ success: false, error: 'content 不能为空' });
    }
    const format = req.body?.format === 'json' ? 'json' : 'yaml';
    const enrich = req.body?.enrich === true;
    const update = req.body?.update === true;
    const result = await importCardDocument(content, format, { enrich, update });
    if (result.parseError) {
      return res.status(400).json({ success: false, error: result.parseError });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('学习者卡导入失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '学习者卡导入失败' });
  }
});

/**
 * 学习者卡库：导出全部自建卡（yaml 文本）
 * GET /api/admin/virtual-learners/cards/export
 */
router.get('/cards/export', async (_req: Request, res) => {
  try {
    const result = await exportCardLibrary();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('学习者卡导出失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '学习者卡导出失败' });
  }
});

/**
 * 卡墙索引（2026-10-05 卡库改版）：全部卡（预置+自建）的展示摘要。
 * 卡=账号拍板不变；「从卡库选人」= openSubPage('virtual', userId) 直达该学习者画像。
 * GET /api/admin/virtual-learners/cards/index
 */
router.get('/cards/index', async (_req: Request, res) => {
  try {
    const data = await getCardWallIndex();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('卡墙索引失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡墙索引失败' });
  }
});

/**
 * 卡详情（2026-10-05 卡库改版二）：卡墙点卡抽屉的全字段数据源——
 * 人设键值面 / 故事池（开场白+追问+预算）/ 自带资料 / 来源 / 账号 / 标签。
 * GET /api/admin/virtual-learners/cards/:profileId/detail
 */
router.get('/cards/:profileId/detail', async (req: Request, res) => {
  try {
    const detail = await getCardDetail(String(req.params.profileId || ''));
    if (!detail) {
      return res.status(404).json({ success: false, error: '卡不存在' });
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    logger.error('卡详情失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡详情失败' });
  }
});

/**
 * 卡的任务清单（2026-10-16「卡 → 虚拟学习者」创建面板的数据源）：逐卡给故事池任务
 * （id + 标题 + 开场白）。读档案原始 storyPool——卡详情的展示映射会丢 goalSeed /
 * problemKnowledge，照它勾选再克隆，派生实例的任务会残。
 * GET /api/admin/virtual-learners/cards/tasks?ids=<profileId,profileId>
 */
router.get('/cards/tasks', async (req: Request, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) {
      return res.status(400).json({ success: false, error: '缺少 ids（卡 id 列表）' });
    }
    const groups = await getCardTaskGroups(ids);
    res.json({ success: true, data: { groups } });
  } catch (error) {
    logger.error('卡任务清单失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡任务清单失败' });
  }
});

/**
 * 卡 → 虚拟学习者（2026-10-16 用户拍板「卡库是身份池，选卡 + 勾任务 → 创建虚拟学习者」）。
 * 派生语义 = 身份克隆：新账号 + 新档案，人设整体带走，故事池只带勾选的任务，卡号重算。
 * 批量：一次 1..CLONE_MAX_ITEMS 张卡；逐项返回结果（部分失败不整体回滚，投产半成不报成整单失败）。
 * POST /api/admin/virtual-learners/cards/clone
 */
router.post('/cards/clone', async (req: Request, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .map((it: unknown) => {
        const o = (it || {}) as Record<string, unknown>;
        return {
          profileId: String(o.profileId || '').trim(),
          storyIds: Array.isArray(o.storyIds) ? o.storyIds.map(String) : undefined,
        };
      })
      .filter((it: { profileId: string }) => it.profileId);
    if (!items.length) {
      return res.status(400).json({ success: false, error: '请先选择要派生的卡' });
    }
    if (items.length > CLONE_MAX_ITEMS) {
      return res.status(400).json({ success: false, error: `一次最多派生 ${CLONE_MAX_ITEMS} 张卡` });
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : undefined;
    const data = await cloneCardsToLearners(items, note || undefined);
    logger.info('卡派生虚拟学习者', {
      requested: items.length,
      created: data.created.length,
      failed: data.failed.length,
      createdBy: req.user?.userId,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('卡派生失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡派生失败' });
  }
});
}
