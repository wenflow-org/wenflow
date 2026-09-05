/**
 * Admin Virtual Quick Learn API
 *
 * 账号自动学习：开发者选定虚拟学习者账号名下的任务，系统沿真实生产链
 * 驱动该账号学完一节课，并生成学习传播报告（前后快照对比 + 下游影响）。
 *
 * 设计要点：沿生产链驱动账号学完一节课（含传播报告），详见本文件实现与
 * 虚拟学习者链路（doc/VIRTUAL_LEARNER_CHAIN.md）。
 */

import express from 'express';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { pathFixtureService } from '../../services/learning/path-fixture.service';
import { quickLearnService } from '../../virtual-lab/quick-learn/quick-learn.service';

const router = express.Router();

function sendError(res: express.Response, error: any, fallbackMessage: string, fallbackStatus = 500) {
  const message = String(error?.message || fallbackMessage);
  let status = fallbackStatus;
  if (message.includes('不存在')) status = 404;
  else if (error?.code === 'QUICK_LEARN_RUN_CONFLICT') status = 409;
  else if (
    error?.code === 'QUICK_LEARN_TASK_OWNERSHIP_MISMATCH' ||
    error?.code === 'QUICK_LEARN_TASK_ALREADY_COMPLETED' ||
    error?.code === 'QUICK_LEARN_MILESTONE_LOCKED' ||
    message.includes('不合法') ||
    message.includes('缺少') ||
    message.includes('不能')
  ) status = 400;
  return res.status(status).json({
    success: false,
    error: message,
    ...(error?.code ? { code: error.code } : {}),
  });
}

/**
 * POST /:id/quick-learn/fixtures
 * 把任意已有学习路径克隆为该虚拟学习者名下的测试夹具
 * body: { sourcePathId: string, titlePrefix?: string }
 */
router.post('/:id/quick-learn/fixtures', async (req: any, res) => {
  try {
    const { sourcePathId, titlePrefix } = req.body || {};
    if (typeof sourcePathId !== 'string' || !sourcePathId.trim()) {
      return res.status(400).json({ success: false, error: '缺少 sourcePathId' });
    }
    if (titlePrefix !== undefined && (typeof titlePrefix !== 'string' || titlePrefix.length > 40)) {
      return res.status(400).json({ success: false, error: 'titlePrefix 不合法' });
    }

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: req.params.id } });
    if (!profile) return res.status(404).json({ success: false, error: '虚拟学习者不存在' });

    const result = await pathFixtureService.clonePathToUser(sourcePathId.trim(), profile.userId, {
      ...(typeof titlePrefix === 'string' ? { titlePrefix } : {}),
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('克隆学习路径夹具失败:', error);
    sendError(res, error, '克隆学习路径夹具失败');
  }
});

/**
 * GET /:id/quick-learn/tasks
 * 列出该虚拟学习者绑定账号名下的可学任务树（path → milestones → subtasks）
 */
router.get('/:id/quick-learn/tasks', async (req: any, res) => {
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: req.params.id } });
    if (!profile) return res.status(404).json({ success: false, error: '虚拟学习者不存在' });

    const paths = await prisma.learning_paths.findMany({
      where: { userId: profile.userId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        milestones: {
          orderBy: { order: 'asc' },
          include: { subtasks: { orderBy: { order: 'asc' } } },
        },
      },
    });

    const data = paths.map((path) => ({
      pathId: path.id,
      title: path.title,
      isFixture: !!path.sourcePathId,
      fixtureOfPathId: path.sourcePathId || null,
      milestones: path.milestones.map((milestone) => ({
        milestoneId: milestone.id,
        stageNumber: milestone.stageNumber,
        title: milestone.title,
        status: milestone.status,
        tasks: milestone.subtasks.map((task) => ({
          taskId: task.id,
          title: task.title,
          status: task.status,
          taskType: task.taskType,
          learnable: task.status !== 'completed' && milestone.status !== 'locked',
        })),
      })),
    }));

    res.json({ success: true, data });
  } catch (error: any) {
    logger.error('获取自动学习任务列表失败:', error);
    sendError(res, error, '获取自动学习任务列表失败');
  }
});

/**
 * POST /:id/quick-learn/runs
 * 启动一次账号自动学习（后台异步执行）
 * body: { taskId: string, maxTurns?: number }
 */
router.post('/:id/quick-learn/runs', async (req: any, res) => {
  try {
    const { taskId, maxTurns, storyId, frictionBudget } = req.body || {};
    if (typeof taskId !== 'string' || !taskId.trim()) {
      return res.status(400).json({ success: false, error: '缺少 taskId' });
    }
    if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 40)) {
      return res.status(400).json({ success: false, error: 'maxTurns 必须是 1-40 的整数' });
    }
    if (frictionBudget !== undefined
      && !['none', 'low', 'normal', 'high', 'stress_test'].includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 必须是 none|low|normal|high|stress_test' });
    }
    const result = await quickLearnService.startRun({
      profileId: req.params.id,
      taskId: taskId.trim(),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(typeof storyId === 'string' && storyId.trim() ? { storyId: storyId.trim() } : {}),
      ...(typeof frictionBudget === 'string' && frictionBudget ? { frictionBudget } : {}),
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('启动自动学习运行失败:', error);
    sendError(res, error, '启动自动学习运行失败');
  }
});

/**
 * GET /:id/quick-learn/runs?page=&pageSize=
 * 该虚拟学习者的历史自动学习运行
 */
router.get('/:id/quick-learn/runs', async (req: any, res) => {
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: req.params.id } });
    if (!profile) return res.status(404).json({ success: false, error: '虚拟学习者不存在' });
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20;
    const result = await quickLearnService.listRuns(profile.id, { page, pageSize });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('获取自动学习运行列表失败:', error);
    sendError(res, error, '获取自动学习运行列表失败');
  }
});

/**
 * GET /quick-learn/runs/:runId
 * 单次运行状态 + 进度 + 传播报告
 */
router.get('/quick-learn/runs/:runId', async (req: any, res) => {
  try {
    const result = await quickLearnService.getRun(req.params.runId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('获取自动学习运行详情失败:', error);
    sendError(res, error, '获取自动学习运行详情失败');
  }
});

/**
 * POST /quick-learn/runs/:runId/abort
 * 请求中止运行
 */
router.post('/quick-learn/runs/:runId/abort', async (req: any, res) => {
  try {
    const result = await quickLearnService.requestAbort(req.params.runId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('中止自动学习运行失败:', error);
    sendError(res, error, '中止自动学习运行失败');
  }
});

export default router;
