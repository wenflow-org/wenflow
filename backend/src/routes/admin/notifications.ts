// 站内通知管理路由（admin 后台：全员/定向推送）
// 挂载: /api/admin/notifications
import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../../middleware/audit-context';
import { randomUUID as uuidv4 } from 'crypto';
import { logger } from '../../utils/logger';
import { REAL_USER_WHERE } from '../../utils/test-account';

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

/** 通知列表（分页；userId 筛选；includeTest=1 含虚拟/测试） */
router.get('/', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const userId = typeof req.query.userId === 'string' && req.query.userId.trim() ? String(req.query.userId).trim() : undefined;
    const kind = typeof req.query.kind === 'string' && req.query.kind.trim() ? String(req.query.kind).trim() : undefined;
    const unreadOnly = String(req.query.unreadOnly || '') === 'true';

    const where: any = {};
    if (userId) where.userId = userId;
    if (kind) where.kind = kind;
    if (unreadOnly) where.isRead = false;

    const [items, total, unreadTotal] = await Promise.all([
      prisma.notifications.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { users: { select: { id: true, name: true, email: true } } },
      }),
      prisma.notifications.count({ where }),
      prisma.notifications.count({ where: { ...where, isRead: false } }),
    ]);

    res.json({
      success: true,
      data: {
        items: items.map((n) => ({
          id: n.id,
          userId: n.userId,
          title: n.title,
          body: n.body,
          kind: n.kind,
          link: n.link,
          isRead: n.isRead,
          readAt: n.readAt,
          createdAt: n.createdAt,
          user: n.users ? { id: n.users.id, name: n.users.name, email: n.users.email } : null,
        })),
        pagination: { total, page, limit },
        unreadTotal,
      },
    });
  } catch (error: any) {
    logger.error('[admin-notifications] 获取通知列表失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '获取通知列表失败', status: 500 } });
  }
});

/** 发送通知（scope=all 全员 | scope=user 定向 userId） */
router.post('/', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const { title, body, scope, userId, kind, link } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: { message: 'title 必填' } });
    }
    if (scope !== 'all' && scope !== 'user') {
      return res.status(400).json({ success: false, error: { message: 'scope 必须是 all 或 user' } });
    }
    if (scope === 'user' && (!userId || typeof userId !== 'string')) {
      return res.status(400).json({ success: false, error: { message: '定向发送需要 userId' } });
    }

    const targetIds: string[] = [];
    if (scope === 'user') {
      const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return res.status(404).json({ success: false, error: { message: '用户不存在' } });
      targetIds.push(user.id);
    } else {
      // 全员 = 所有真实用户（排除虚拟学习者与测试账号）
      const users = await prisma.users.findMany({ where: REAL_USER_WHERE, select: { id: true } });
      targetIds.push(...users.map((u) => u.id));
    }

    const createdAt = new Date();
    await prisma.notifications.createMany({
      data: targetIds.map((id) => ({
        id: uuidv4(),
        userId: id,
        title: String(title).slice(0, 200),
        body: body ? String(body).slice(0, 2000) : null,
        kind: ['system', 'announcement', 'achievement'].includes(kind) ? kind : 'system',
        link: link ? String(link).slice(0, 500) : null,
        createdBy: req.user?.userId || null,
        createdAt,
      })),
    });

    setAuditAction(res, 'notification.send', { targetType: 'notification' });
    setAuditBefore(res, null);
    setAuditAfter(res, { title, scope, targetCount: targetIds.length, userId: scope === 'user' ? userId : undefined });

    logger.info('[admin-notifications] 发送通知', { adminId: req.user?.userId, scope, targetCount: targetIds.length });
    res.json({ success: true, data: { sent: targetIds.length } });
  } catch (error: any) {
    logger.error('[admin-notifications] 发送通知失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '发送通知失败', status: 500 } });
  }
});

/** 删除通知 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });

    const item = await prisma.notifications.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ success: false, error: { message: '通知不存在' } });

    setAuditAction(res, 'notification.delete', { targetType: 'notification', targetId: item.id });
    setAuditBefore(res, { title: item.title, userId: item.userId });
    setAuditAfter(res, null);

    await prisma.notifications.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[admin-notifications] 删除通知失败', { error });
    res.status(500).json({ success: false, error: { message: error.message || '删除通知失败', status: 500 } });
  }
});

export default router;
