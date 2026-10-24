/**
 * 自动驾驶运行面 · 黑盒实验 / 全自动（autopilot）/ 僵尸回收 / 批量终止
 * （2026-10-24 架构优化批 1：assisted-runtime.ts 再拆分迁出，处理器逐字未改）。
 * 由 assisted-runtime.ts 在同一个 router 实例上按原顺序调用注册。
 */
import type { Router, Request } from 'express';
import { logger } from '../../utils/logger';
import blackboxVirtualLearnerRunner from '../../virtual-lab/blackbox-runner';
import { autopilotService, AutopilotService } from '../../virtual-lab/autopilot.service';
import { virtualSessionReclaimService } from '../../virtual-lab/session-reclaim.service';
import { findSessionById, findSessionsForTerminate } from '../../services/virtual-lab/virtual-session.repo';
import { createSessionForProfile, SIMULATION_FRICTION_BUDGETS, parseJson } from '../../virtual-lab/session-factory';
import type { StageResults } from '../../virtual-lab/vlab-types';
import { sendVirtualSessionError } from './virtual-session-http';
import {
  getBlackboxCommandId,
  getExpectedBlackboxTraceCount,
  parseBlackboxAction,
  terminateSession,
} from './virtual-learners.assisted-shared';

export function registerAssistedBlackboxRoutes(router: Router): void {
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
}
