// 站内通知用户端路由（登录用户拉取/已读）
// 挂载: /api/notifications
import express, { Request, Response } from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

router.use(authMiddleware);

/** 我的通知列表（分页 + 未读数） */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total, unread] = await Promise.all([
      prisma.notifications.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notifications.count({ where: { userId } }),
      prisma.notifications.count({ where: { userId, isRead: false } }),
    ]);

    res.json({
      success: true,
      data: {
        items: items.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          kind: n.kind,
          link: n.link,
          isRead: n.isRead,
          createdAt: n.createdAt,
        })),
        pagination: { total, page, limit },
        unread,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '获取通知失败', status: 500 } });
  }
});

/** 标记单条已读 */
router.post('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const item = await prisma.notifications.findFirst({ where: { id: req.params.id, userId } });
    if (!item) return res.status(404).json({ success: false, error: { message: '通知不存在' } });

    await prisma.notifications.update({
      where: { id: item.id },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '标记失败', status: 500 } });
  }
});

/** 全部标记已读 */
router.post('/read-all', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    await prisma.notifications.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '标记失败', status: 500 } });
  }
});

export default router;
