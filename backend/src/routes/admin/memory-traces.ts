import express from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { fsrsRetrievability, type FsrsMemoryState } from '../../services/memory/fsrs';

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

/**
 * GET /api/admin/memory-traces
 * 记忆痕迹管理：返回 memory_traces 列表，含 FSRS 记忆保持率（retrievability）。
 * 供管理后台观察复习调度状态与记忆保持率分布（retrievability 前端可视化的后台先行）。
 *
 * query:
 * - userId?: 指定学习者（缺省查全部）
 * - limit?: 返回条数（默认 50，上限 200）
 * - includeVirtual?: 'true' 时包含虚拟学习者（默认排除）
 */
router.get('/', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const userId = req.query.userId as string | undefined;
    const rawLimit = req.query.limit ? Number(req.query.limit) : 50;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const includeVirtual = String(req.query.includeVirtual || '') === 'true';

    const traces = await prisma.memory_traces.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(includeVirtual ? {} : { user: { isVirtualLearner: false } }),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        conceptKey: true,
        label: true,
        masteryScore: true,
        stability: true,
        extractionCount: true,
        lastSeenAt: true,
        fsrsStability: true,
        fsrsDifficulty: true,
        ktMasteryEma: true,
        dueAt: true,
        updatedAt: true,
      },
    });

    const now = new Date();
    const rows = traces.map((t) => {
      let retrievability: number | null = null;
      if (t.fsrsStability !== null && t.fsrsStability !== undefined && t.lastSeenAt) {
        const state: FsrsMemoryState = {
          stability: t.fsrsStability,
          difficulty: t.fsrsDifficulty ?? 5,
          reps: t.extractionCount,
          lapses: 0,
          lastReviewAt: t.lastSeenAt,
        };
        retrievability = Math.round(fsrsRetrievability(state, now) * 100) / 100;
      }
      return { ...t, retrievability };
    });

    return res.json({ success: true, data: { total: rows.length, rows } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取记忆痕迹失败' } });
  }
});

export default router;
