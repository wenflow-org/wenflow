/**
 * 批量实验路由（admin 虚拟学习者页）
 * 挂载: /api/admin/batch-experiments
 */
import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import {
  createExperiment,
  advanceRunWithMeta,
  manualDecay,
  manualSnapshot,
  startBatchExperimentScheduler,
  listExperiments,
  getExperimentDetail,
  stopExperiment,
  type BatchLearnerConfig,
} from '../../services/virtual-lab/batch-experiment.service';

const router = Router();

/** 批量推进的幂等键：沿用 blackbox / assisted 的 Idempotency-Key 约定。 */
function getBatchCommandId(req: Request): string {
  const header = typeof req.get === 'function' ? req.get('Idempotency-Key') : undefined;
  const bodyValue = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  return String(header || bodyValue || '').trim();
}

/** 列表 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const experiments = await listExperiments();
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
      sampleType: ['student', 'general'].includes(String(l?.sampleType))
        ? String(l.sampleType)
        : undefined,
      expectedNoPath: l?.expectedNoPath === true ? true : undefined,
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
    const experiment = await getExperimentDetail(req.params.id);
    if (!experiment) return res.status(404).json({ success: false, error: '实验不存在' });
    res.json({ success: true, data: experiment });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 停止实验 */
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    await stopExperiment(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as Error).message || error) });
  }
});

/** 手动推进一个 run（可选 Idempotency-Key：同键同请求回放，不重复推进一步） */
router.post('/:id/runs/:runId/advance', async (req: Request, res: Response) => {
  try {
    const commandId = getBatchCommandId(req);
    const outcome = await advanceRunWithMeta(req.params.runId, {
      requestKey: commandId,
      request: { runId: req.params.runId, experimentId: req.params.id },
    });
    res.json({
      success: true,
      data: { phase: outcome.phase },
      ...(commandId ? { reused: outcome.reused } : {}),
    });
  } catch (error) {
    logger.error('[batch-experiment] advance failed', { error: String((error as Error).message || error) });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    res.status(status).json({
      success: false,
      error: String((error as Error).message || error),
      ...((error as { code?: string }).code ? { code: (error as { code: string }).code } : {}),
    });
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
