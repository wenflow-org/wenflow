import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import learningStateService from '../../services/learning/learning-state.service';
import { learnerSnapshotService } from '../../services/learner/LearnerSnapshotService';
import { requeueDeadOutboxEvents } from '../../events/outbox.worker';

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

// ===== 持久事件 outbox 死信运维 =====
// dead 是无出口终态：worker 不再拾取，此前没有任何管理手段。运维修复根因后
// 先 GET 查看死信清单，确认后 POST 重置回 pending 由 worker 重放。

router.get('/devtools/outbox/dead', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const deadCount = await prisma.domain_event_outbox.count({ where: { status: 'dead' } });
    const items = await prisma.domain_event_outbox.findMany({
      where: { status: 'dead' },
      orderBy: [{ occurredAt: 'asc' }],
      take: 50,
      select: {
        id: true,
        eventType: true,
        userId: true,
        aggregateId: true,
        attemptCount: true,
        lastError: true,
        occurredAt: true
      }
    });

    return res.json({
      success: true,
      data: { deadCount, items }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: { message: error.message || '查询死信失败' }
    });
  }
});

router.post('/devtools/outbox/requeue-dead', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const body = (req.body || {}) as { eventType?: string };
    const eventType = typeof body.eventType === 'string' && body.eventType.trim() ? body.eventType.trim() : undefined;

    const requeued = await requeueDeadOutboxEvents(eventType);
    return res.json({
      success: true,
      data: { requeued, eventType: eventType || 'all' }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: { message: error.message || '死信重置失败' }
    });
  }
});

export default router;
