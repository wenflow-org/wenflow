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

    // 默认排除虚拟学习者与测试/审计账号（风险队列只给真实用户看）；
    // includeTest=true 时显式包含（管理需要可查虚拟数据，只改默认视图不删数据）
    const includeTest = String(req.query.includeTest || '') === 'true';
    const excludeTest = includeTest ? false : String(req.query.excludeTest || '') !== 'false';

    const data = await learnerSnapshotRefreshService.listForAdmin({
      userId: req.query.userId as string | undefined,
      pathId: req.query.pathId as string | undefined,
      staleOnly: req.query.staleOnly === 'true',
      riskOnly: req.query.riskOnly === 'true',
      excludeTest,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习者模型列表失败' } });
  }
});

/** 详情/证据默认视图：虚拟学习者需显式 includeTest=true 才可查（默认 404，不删数据只改默认视图） */
async function ensureVirtualVisible(userId: string, includeTest: boolean): Promise<boolean> {
  if (includeTest) return true;
  const target = await prisma.users.findUnique({
    where: { id: userId },
    select: { isVirtualLearner: true },
  });
  return target ? !target.isVirtualLearner : true;
}

router.get('/:userId', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const includeTest = String(req.query.includeTest || '') === 'true';
    if (!(await ensureVirtualVisible(req.params.userId, includeTest))) {
      return res.status(404).json({
        success: false,
        error: { message: '虚拟学习者数据需显式包含（includeTest=true 可查）' },
      });
    }

    const pathId = req.query.pathId as string | undefined;
    const snapshot = await learnerSnapshotRefreshService.getLatest({
      userId: req.params.userId,
      pathId,
      scope: pathId ? 'path' : (req.query.mode as 'global' | 'path' | 'teaching' | undefined) || 'global',
    });

    const currentPath = snapshot.knowledgeMemory.currentPath;
    const pathProgress = currentPath?.progress;
    const globalSignals = snapshot.knowledgeMemory.globalSignals;

    return res.json({
      success: true,
      data: {
        ...snapshot,
        progress: pathProgress?.totalTasks
          ? Number(((pathProgress.completedTasks / pathProgress.totalTasks) * 100).toFixed(1))
          : 0,
        concepts: {
          mastered: globalSignals.masteredConcepts,
          struggling: globalSignals.strugglingConcepts,
          fragile: globalSignals.fragileConcepts,
        },
        pathTitle: currentPath?.pathTitle || null,
      },
    });
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

    const pathId = (req.body?.pathId as string | undefined) || (req.query.pathId as string | undefined);
    const snapshot = await learnerSnapshotRefreshService.refresh({
      userId: req.params.userId,
      pathId,
      scope: pathId ? 'path' : req.body?.scope || 'global',
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

    const includeTest = String(req.query.includeTest || '') === 'true';
    if (!(await ensureVirtualVisible(req.params.userId, includeTest))) {
      return res.status(404).json({
        success: false,
        error: { message: '虚拟学习者数据需显式包含（includeTest=true 可查）' },
      });
    }

    const snapshot = await learnerSnapshotRefreshService.getLatest({
      userId: req.params.userId,
      pathId: req.query.pathId as string | undefined,
      scope: 'path',
    });

    return res.json({
      success: true,
      data: {
        items: snapshot.knowledgeMemory.currentPath?.recentEvidence || [],
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习证据失败' } });
  }
});

export default router;
