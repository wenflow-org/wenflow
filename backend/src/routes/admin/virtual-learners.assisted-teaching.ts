/**
 * 自动驾驶运行面 · 教学驱动与生命周期控制（2026-10-24 架构优化批 1：assisted-runtime.ts
 * 再拆分迁出，处理器逐字未改）。由 assisted-runtime.ts 按原顺序调用注册。
 */
import type { Router, Request } from 'express';
import { logger } from '../../utils/logger';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { findSessionById, updateSessionStageResults } from '../../services/virtual-lab/virtual-session.repo';
import { sendVirtualSessionError } from './virtual-session-http';
import {
  parseSimulationLimit,
  runAssistedSessionMutationWithSimClock,
} from './virtual-learners.assisted-shared';

export function registerAssistedTeachingRoutes(router: Router): void {
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
}
