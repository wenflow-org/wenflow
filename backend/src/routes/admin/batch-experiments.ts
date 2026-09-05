/**
 * 批量实验路由（admin 虚拟学习者页）
 * 挂载: /api/admin/batch-experiments
 */
import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import {
  createExperiment,
  advanceRun,
  manualDecay,
  manualSnapshot,
  startBatchExperimentScheduler,
  BatchLearnerConfig,
} from '../../services/virtual-lab/batch-experiment.service';

const router = Router();

/** 列表 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const experiments = await prisma.batch_experiments.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        runs: {
          select: {
            id: true,
            learnerName: true,
            frictionBudget: true,
            phase: true,
            status: true,
            completedTasks: true,
            totalTasks: true,
            updatedAt: true,
          },
        },
      },
    });
    res.json({ success: true, data: experiments });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 创建实验 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, learners } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: '实验名称不能为空' });
    }
    if (!Array.isArray(learners) || learners.length === 0) {
      return res.status(400).json({ success: false, error: '至少需要一个学习者配置' });
    }
    if (learners.length > 20) {
      return res.status(400).json({ success: false, error: '学习者数量上限 20' });
    }
    const normalized: BatchLearnerConfig[] = learners.map((l: any) => ({
      name: String(l?.name || '').slice(0, 64),
      learningGoal: l?.learningGoal ? String(l.learningGoal).slice(0, 200) : undefined,
      frictionBudget: ['none', 'low', 'normal', 'high', 'stress_test'].includes(l?.frictionBudget)
        ? l.frictionBudget
        : 'normal',
    }));
    if (normalized.some((l) => !l.name)) {
      return res.status(400).json({ success: false, error: '学习者名称不能为空' });
    }
    const experiment = await createExperiment(req.user!.userId, {
      name: String(name).slice(0, 100),
      description: description ? String(description).slice(0, 500) : undefined,
      learners: normalized,
    });
    // 确保调度器已启动
    startBatchExperimentScheduler();
    res.json({ success: true, data: experiment });
  } catch (error) {
    logger.error('[batch-experiment] create failed', { error: String((error as Error).message || error) });
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 详情 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const experiment = await prisma.batch_experiments.findUnique({
      where: { id: req.params.id },
      include: { runs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!experiment) return res.status(404).json({ success: false, error: '实验不存在' });
    res.json({ success: true, data: experiment });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 停止实验 */
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    await prisma.batch_experiments.update({
      where: { id: req.params.id },
      data: { status: 'stopped', updatedAt: new Date() },
    });
    await prisma.batch_experiment_runs.updateMany({
      where: { experimentId: req.params.id, status: 'active' },
      data: { status: 'failed', lastError: '实验已手动停止', updatedAt: new Date() },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 手动推进一个 run */
router.post('/:id/runs/:runId/advance', async (req: Request, res: Response) => {
  try {
    const phase = await advanceRun(req.params.runId);
    res.json({ success: true, data: { phase } });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 跨日衰减模拟（手动触发，每次推进一档：3/7/14 天） */
router.post('/:id/runs/:runId/decay', async (req: Request, res: Response) => {
  try {
    const result = await manualDecay(req.params.runId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 手动快照 */
router.post('/:id/runs/:runId/snapshot', async (req: Request, res: Response) => {
  try {
    const snap = await manualSnapshot(req.params.runId);
    res.json({ success: true, data: snap });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

export default router;
