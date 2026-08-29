// 成就管理路由（admin 后台：成就定义 / 解锁记录 / 手动发放与撤回）
// 挂载: /api/admin/achievements
import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../../middleware/audit-context';
import { logger } from '../../utils/logger';
import { REAL_USER_WHERE } from '../../utils/test-account';
import { ACHIEVEMENTS } from '../../services/achievements/achievement-system';
import achievementService from '../../services/achievements/achievement.service';

const router = express.Router();

router.use(authMiddleware);

const ensureAdmin = async (userId?: string) => {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return !!operator?.isAdmin;
};

/** 成就定义列表（成就系统的静态定义 + 每个定义已被解锁的用户数） */
router.get('/definitions', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const unlockCounts = await prisma.achievements.groupBy({
      by: ['type', 'title'],
      _count: { _all: true },
    });
    const countMap = new Map<string, number>();
    for (const g of unlockCounts) {
      countMap.set(`${g.type}-${g.title}`, g._count._all);
    }

    res.json({
      success: true,
      data: ACHIEVEMENTS.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        description: a.description,
        icon: a.icon || '🏆',
        xpReward: a.xpReward,
        requirement: a.requirement,
        unlockCount: countMap.get(`${a.type}-${a.name}`) || 0,
      })),
    });
  } catch (error: any) {
    logger.error('[admin-achievements] 获取成就定义失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '获取成就定义失败', status: 500 } });
  }
});

/** 解锁记录列表（分页；userId 可选筛选；includeTest=1 时含虚拟/测试账号） */
router.get('/records', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const userId = typeof req.query.userId === 'string' && req.query.userId.trim() ? String(req.query.userId).trim() : undefined;
    const includeTest = String(req.query.includeTest || '') === 'true';

    const where: any = {};
    if (userId) where.userId = userId;
    if (!includeTest) where.users = REAL_USER_WHERE;

    const [records, total] = await Promise.all([
      prisma.achievements.findMany({
        where,
        orderBy: { earnedAt: 'desc' },
        skip,
        take: limit,
        include: {
          users: {
            select: { id: true, name: true, email: true, isVirtualLearner: true },
          },
        },
      }),
      prisma.achievements.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        records: records.map((r) => ({
          id: r.id,
          userId: r.userId,
          type: r.type,
          title: r.title,
          description: r.description,
          iconUrl: r.iconUrl,
          xpReward: r.xpReward,
          completed: r.completed,
          earnedAt: r.earnedAt || r.unlockedAt,
          createdAt: r.createdAt,
          user: r.users
            ? { id: r.users.id, name: r.users.name, email: r.users.email, isVirtualLearner: r.users.isVirtualLearner }
            : null,
        })),
        pagination: { total, page, limit },
      },
    });
  } catch (error: any) {
    logger.error('[admin-achievements] 获取解锁记录失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '获取解锁记录失败', status: 500 } });
  }
});

/** 手动发放成就（给指定用户补发：解锁 + XP） */
router.post('/grant', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const { userId, achievementId } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'userId 必填' } });
    }
    const def = ACHIEVEMENTS.find((a) => a.id === achievementId);
    if (!def) {
      return res.status(400).json({ success: false, error: { message: `成就定义不存在: ${achievementId}` } });
    }

    const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, isVirtualLearner: true } });
    if (!user) return res.status(404).json({ success: false, error: { message: '用户不存在' } });

    const existing = await prisma.achievements.findFirst({
      where: { userId, type: def.type, title: def.name },
    });
    if (existing) {
      return res.status(409).json({ success: false, error: { message: `该用户已解锁「${def.name}」` } });
    }

    const unlockedAt = new Date();
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.achievements.create({
        data: {
          id: `ach_${userId}_${def.id}`,
          userId,
          type: def.type,
          title: def.name,
          description: def.description,
          iconUrl: def.icon,
          completed: true,
          xpReward: def.xpReward,
          unlockedAt,
          earnedAt: unlockedAt,
        },
      });
      await achievementService.addXp(userId, def.xpReward, tx);
      return created;
    });

    setAuditAction(res, 'achievement.grant', { targetType: 'user', targetId: userId });
    setAuditBefore(res, null);
    setAuditAfter(res, { userId, achievementId: def.id, title: def.name, xpReward: def.xpReward, recordId: record.id });

    logger.info('[admin-achievements] 管理员手动发放成就', { adminId: req.user?.userId, userId, achievementId: def.id });
    res.json({ success: true, data: { id: record.id, title: def.name, xpReward: def.xpReward } });
  } catch (error: any) {
    logger.error('[admin-achievements] 发放成就失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '发放成就失败', status: 500 } });
  }
});

/** 撤回成就（撤销解锁记录并扣回 XP；不扣为负） */
router.post('/revoke', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const { recordId } = req.body || {};
    if (!recordId || typeof recordId !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'recordId 必填' } });
    }

    const record = await prisma.achievements.findUnique({ where: { id: recordId } });
    if (!record) return res.status(404).json({ success: false, error: { message: '解锁记录不存在' } });

    await prisma.$transaction([
      prisma.achievements.delete({ where: { id: recordId } }),
      prisma.users.update({
        where: { id: record.userId },
        data: { xp: { decrement: Math.max(0, record.xpReward || 0) } },
      }),
    ]);

    setAuditAction(res, 'achievement.revoke', { targetType: 'user', targetId: record.userId });
    setAuditBefore(res, { userId: record.userId, title: record.title, xpReward: record.xpReward });
    setAuditAfter(res, null);

    logger.info('[admin-achievements] 管理员撤回成就', { adminId: req.user?.userId, recordId, userId: record.userId });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[admin-achievements] 撤回成就失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '撤回成就失败', status: 500 } });
  }
});

/** 为指定用户立即重跑成就检查（补漏解锁） */
router.post('/recheck', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const { userId } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'userId 必填' } });
    }
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return res.status(404).json({ success: false, error: { message: '用户不存在' } });

    const unlocked = await achievementService.checkAndUnlockAchievements(userId);

    setAuditAction(res, 'achievement.recheck', { targetType: 'user', targetId: userId });
    setAuditAfter(res, { userId, unlocked: unlocked.map((a) => a.id) });

    res.json({ success: true, data: { unlocked: unlocked.map((a) => ({ id: a.id, name: a.name, xpReward: a.xpReward })) } });
  } catch (error: any) {
    logger.error('[admin-achievements] 重跑成就检查失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '重跑成就检查失败', status: 500 } });
  }
});

export default router;
