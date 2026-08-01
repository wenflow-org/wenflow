import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { logger } from '../../utils/logger';

/**
 * Admin · 平台公告管理
 * MVP：标题/正文/级别(info|warning|critical) + 草稿/发布/下线
 */
const router = express.Router();
router.use(authMiddleware);

const SEVERITIES = new Set(['info', 'warning', 'critical']);

function shape(a: Record<string, unknown>) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    severity: a.severity,
    status: a.status,
    publishedAt: a.publishedAt,
    expiresAt: a.expiresAt,
    createdBy: a.createdBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  };
}

/** GET / — 全部公告（新→旧） */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await prisma.announcements.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json({ success: true, data: { items: items.map((a) => shape(a as unknown as Record<string, unknown>)) } });
  } catch (error) {
    logger.error('[admin-announcements] list failed:', error);
    res.status(500).json({ success: false, error: '获取公告列表失败' });
  }
});

/** POST / — 新建（默认草稿；publishNow=true 直接发布） */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, body, severity = 'info', expiresAt = null, publishNow = false } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, error: '标题必填' });
    }
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, error: '正文必填' });
    }
    if (!SEVERITIES.has(severity)) {
      return res.status(400).json({ success: false, error: `severity 只能是 ${[...SEVERITIES].join('/')}` });
    }
    const admin = (req as Request & { user?: { userId?: string; name?: string } }).user;
    const created = await prisma.announcements.create({
      data: {
        title: String(title).trim(),
        body: String(body).trim(),
        severity,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        status: publishNow ? 'published' : 'draft',
        publishedAt: publishNow ? new Date() : null,
        createdBy: admin?.name || admin?.userId || null
      }
    });
    res.json({ success: true, data: shape(created as unknown as Record<string, unknown>) });
  } catch (error) {
    logger.error('[admin-announcements] create failed:', error);
    res.status(500).json({ success: false, error: '创建公告失败' });
  }
});

/** PUT /:id/publish — 发布 */
router.put('/:id/publish', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.announcements.update({
      where: { id: req.params.id },
      data: { status: 'published', publishedAt: new Date() }
    });
    res.json({ success: true, data: shape(updated as unknown as Record<string, unknown>) });
  } catch (error) {
    logger.error('[admin-announcements] publish failed:', error);
    res.status(500).json({ success: false, error: '发布公告失败' });
  }
});

/** PUT /:id/archive — 下线 */
router.put('/:id/archive', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.announcements.update({
      where: { id: req.params.id },
      data: { status: 'archived' }
    });
    res.json({ success: true, data: shape(updated as unknown as Record<string, unknown>) });
  } catch (error) {
    logger.error('[admin-announcements] archive failed:', error);
    res.status(500).json({ success: false, error: '下线公告失败' });
  }
});

/** DELETE /:id — 删除 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.announcements.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    logger.error('[admin-announcements] delete failed:', error);
    res.status(500).json({ success: false, error: '删除公告失败' });
  }
});

export default router;
