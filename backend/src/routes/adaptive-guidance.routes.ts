import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { dashboardGuidanceSnapshotService } from '../services/learner/DashboardGuidanceSnapshotService';
import { learningStateGuidanceService } from '../services/learner/LearningStateGuidanceService';
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

    const view = typeof req.query.view === 'string' ? req.query.view : 'dashboard';
    const sourceEntry = typeof req.headers['x-source-entry'] === 'string' ? req.headers['x-source-entry'] : '';
    const debugOperatorId = req.user?.projection?.issuedByAdminId || userId;
    const debugOperator = sourceEntry === 'test' && debugOperatorId
      ? await prisma.users.findUnique({
          where: { id: debugOperatorId },
          select: { isAdmin: true }
        }).catch(() => null)
      : null;
    const canIncludeDebug = sourceEntry === 'test' && (req.user?.isAdmin === true || debugOperator?.isAdmin === true);

    // adaptive-guidance-copy 现在只作为 dashboard snapshot 对外提供。
    // 支持 dashboard（快照）与 learning-state（按需生成 + 内存缓存）两种视图
    if (view === 'learning-state') {
      const forceRefresh = req.query.refresh === '1';
      const payload = await learningStateGuidanceService.get(userId, { forceRefresh });
      return res.json({
        success: true,
        data: payload
          ? {
              copy: payload.copy,
              summary: payload.summary,
              decisions: payload.decisions || [],
              source: payload.source,
              generatedAt: payload.generatedAt,
              ...(canIncludeDebug && payload.debug ? { debug: payload.debug } : {}),
            }
          : null,
      });
    }

    if (view !== 'dashboard') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'adaptive-guidance/copy 目前仅支持 dashboard 与 learning-state 视图',
        },
      });
    }

    const snapshot = await dashboardGuidanceSnapshotService.get(userId);
    return res.json({
      success: true,
      data: snapshot
        ? {
            copy: snapshot.copy,
            summary: snapshot.summary,
            ...(canIncludeDebug && snapshot.debug ? { debug: snapshot.debug } : {}),
          }
        : null,
    });
  } catch (error: any) {
    logger.error('[adaptive-guidance] copy failed', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || '生成引导文案失败' });
  }
});

export default router;
