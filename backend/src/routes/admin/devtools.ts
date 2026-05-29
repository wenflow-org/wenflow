import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import learningStateService from '../../services/learning/learning-state.service';
import { learnerSnapshotService } from '../../services/learner/LearnerSnapshotService';

const router = express.Router();

async function ensureAdmin(userId?: string) {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return !!operator?.isAdmin;
}

router.post('/devtools/advance-time', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const body = (req.body || {}) as { userId?: string; days?: number; pathId?: string };
    const targetUserId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : req.user?.userId;
    const days = Number.isFinite(Number(body.days)) ? Math.max(1, Math.min(365, Math.round(Number(body.days)))) : 1;
    const pathId = typeof body.pathId === 'string' && body.pathId.trim() ? body.pathId.trim() : undefined;

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 userId' }
      });
    }

    const latestMetric = await prisma.learning_metrics.findFirst({
      where: { userId: targetUserId },
      orderBy: { calculatedAt: 'desc' },
      select: {
        lss: true,
        ktl: true,
        lf: true,
        lsb: true,
        calculatedAt: true,
      }
    });

    const before = await learnerSnapshotService.getSnapshot({
      userId: targetUserId,
      learningPathId: pathId,
      mode: pathId ? 'path' : 'global',
    });

    const simulatedAsOf = new Date();
    simulatedAsOf.setDate(simulatedAsOf.getDate() + days);

    if (!latestMetric) {
      return res.json({
        success: true,
        data: {
          dayDiff: days,
          simulatedAsOf: simulatedAsOf.toISOString(),
          hasMetricRecord: false,
          before,
          after: null,
        }
      });
    }

    const restoredMetrics = learningStateService.restoreMetrics({
      lss: latestMetric.lss,
      ktl: latestMetric.ktl,
      lf: latestMetric.lf,
      lsb: latestMetric.lsb,
      timestamp: latestMetric.calculatedAt,
    }, simulatedAsOf);

    const after = await learnerSnapshotService.previewSnapshotFromMetrics({
      userId: targetUserId,
      learningPathId: pathId,
      mode: pathId ? 'path' : 'global',
      metrics: restoredMetrics,
      generatedAt: simulatedAsOf,
    });

    return res.json({
      success: true,
      data: {
        dayDiff: days,
        simulatedAsOf: simulatedAsOf.toISOString(),
        latestMetricAt: latestMetric.calculatedAt.toISOString(),
        hasMetricRecord: true,
        before,
        after,
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: { message: error.message || '模拟自然天推进失败' }
    });
  }
});

export default router;
