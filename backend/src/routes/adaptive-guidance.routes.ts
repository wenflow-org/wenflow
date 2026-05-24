import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { adaptiveGuidanceCopy } from '../skills/adaptive-guidance-copy';
import { learnerSnapshotService } from '../services/learner/LearnerSnapshotService';
import learningService from '../services/learning/learning.service';
import { logger } from '../utils/logger';
import prisma from '../config/database';

const router = Router();

router.use(authMiddleware);

router.get('/copy', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const view = req.query.view === 'path-detail' || req.query.view === 'path-list'
      ? req.query.view
      : 'dashboard';
    const pathId = typeof req.query.pathId === 'string' ? req.query.pathId : undefined;

    const learnerSnapshot = await learnerSnapshotService.getSnapshot({
      userId,
      learningPathId: pathId,
      mode: 'path',
    });

    const learningState = await learningService.getLearningStats(userId).catch(() => null);
    const path = pathId ? await learningService.getLearningPath(pathId).catch(() => null) : null;
    const latestTeachingSession = await prisma.teaching_sessions.findFirst({
      where: { userId, ...(pathId ? { learningPathId: pathId } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: {
        wrapup: true,
        advisory: true,
      },
    });

    const sessionWrapup = latestTeachingSession?.wrapup ? JSON.parse(latestTeachingSession.wrapup) : null;
    const advisory = latestTeachingSession?.advisory ? JSON.parse(latestTeachingSession.advisory) : null;

    const result = await adaptiveGuidanceCopy({
      view,
      learnerSnapshot,
      learningState,
      path,
      sessionWrapup,
      advisory,
    });

    return res.json({ success: true, data: result.output });
  } catch (error: any) {
    logger.error('[adaptive-guidance] copy failed', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || '生成引导文案失败' });
  }
});

export default router;
