import express, { Request, Response } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';

/**
 * 用户端 · 当前生效公告
 * 返回 published 且未过期的公告（新→旧，最多 3 条）
 */
const router = express.Router();

router.get('/active', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const items = await prisma.announcements.findMany({
      where: {
        status: 'published',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      },
      orderBy: { publishedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        title: true,
        body: true,
        severity: true,
        publishedAt: true,
        expiresAt: true
      }
    });
    res.json({ success: true, data: { items } });
  } catch (error) {
    logger.error('[announcements] active failed:', error);
    res.status(500).json({ success: false, error: '获取公告失败' });
  }
});

export default router;
