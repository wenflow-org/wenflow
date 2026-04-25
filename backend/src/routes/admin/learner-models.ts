import express from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { learnerSnapshotRefreshService } from '../../services/learner/LearnerSnapshotRefreshService';

const router = express.Router();
router.use(authMiddleware);

async function ensureAdmin(userId?: string) {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return !!operator?.isAdmin;
}

router.get('/', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const data = await learnerSnapshotRefreshService.listForAdmin({
      userId: req.query.userId as string | undefined,
      pathId: req.query.pathId as string | undefined,
      staleOnly: req.query.staleOnly === 'true',
      riskOnly: req.query.riskOnly === 'true',
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习者模型列表失败' } });
  }
});

router.get('/:userId', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const snapshot = await learnerSnapshotRefreshService.getLatest({
      userId: req.params.userId,
      pathId: req.query.pathId as string | undefined,
      scope: (req.query.mode as 'global' | 'path' | 'teaching' | undefined) || 'global',
    });

    return res.json({ success: true, data: snapshot });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习者模型详情失败' } });
  }
});

router.post('/:userId/recompute', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const snapshot = await learnerSnapshotRefreshService.refresh({
      userId: req.params.userId,
      pathId: req.body?.pathId,
      scope: req.body?.scope || 'global',
    });

    return res.json({ success: true, data: snapshot, message: '学习者模型已重算' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '重算学习者模型失败' } });
  }
});

router.get('/:userId/evidence', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const snapshot = await learnerSnapshotRefreshService.getLatest({
      userId: req.params.userId,
      pathId: req.query.pathId as string | undefined,
      scope: 'path',
    });

    return res.json({
      success: true,
      data: snapshot.knowledgeMemory.currentPath?.recentEvidence || [],
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习证据失败' } });
  }
});

export default router;
