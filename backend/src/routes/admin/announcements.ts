import express, { Request, Response } from 'express';
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  findAnnouncementById,
  deleteAnnouncement,
} from '../../services/admin/announcement.repo';
import { authMiddleware } from '../../middleware/auth.middleware';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../../middleware/audit-context';
import { logger } from '../../utils/logger';

/**
 * Admin · 平台公告管理
 * MVP：标题/正文/级别(info|warning|critical) + 草稿/发布/下线
 */
const router = express.Router();
router.use(authMiddleware);

const SEVERITIES = new Set(['info', 'warning', 'critical']);

/**
 * 解析 expiresAt：接受 ISO 8601 带时区时间戳（如 2026-12-31T23:59:59+08:00 / 2026-12-31T15:59:59Z），
 * 统一按 UTC 存储。null/undefined/空串 表示不设置过期时间；无效日期抛错由调用方返回 400。
 */
function parseExpiresAt(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('expiresAt 格式无效，请使用 ISO 8601 时间戳（如 2026-12-31T23:59:59Z，按 UTC 存储）');
  }
  return parsed;
}

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
    const items = await listAnnouncements();
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
    let expiresAtDate: Date | null = null;
    try {
      expiresAtDate = parseExpiresAt(expiresAt);
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message });
    }
    const admin = (req as Request & { user?: { userId?: string; name?: string } }).user;
    const created = await createAnnouncement({
      data: {
        title: String(title).trim(),
        body: String(body).trim(),
        severity,
        expiresAt: expiresAtDate,
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

/** PUT /:id/publish — 发布。状态机守卫（2026-10-10 权限批运行时实锤后补齐，MIMOSA C2）：
    已在发布态 → 409（重复发布此前 200 并刷新 publishedAt，纯审计噪声）。
    草稿与已下线都可再发布（重发是有意流程，前端发布钮在非 published 均可见）。 */
router.put('/:id/publish', async (req: Request, res: Response) => {
  try {
    const existing = await findAnnouncementById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: '公告不存在' });
    if (existing.status === 'published') {
      return res.status(409).json({ success: false, error: '公告已在发布状态，无需重复发布' });
    }
    // 操作审计：发布前快照旧实体
    setAuditAction(res, 'announcement-publish', { targetType: 'announcement', targetId: req.params.id });
    setAuditBefore(res, existing);

    const updated = await updateAnnouncement({
      where: { id: req.params.id },
      data: { status: 'published', publishedAt: new Date() }
    });
    setAuditAfter(res, updated);
    res.json({ success: true, data: shape(updated as unknown as Record<string, unknown>) });
  } catch (error) {
    logger.error('[admin-announcements] publish failed:', error);
    res.status(500).json({ success: false, error: '发布公告失败' });
  }
});

/** PUT /:id/archive — 下线。状态机守卫（2026-10-10，MIMOSA C2）：仅发布中可下线，
    其余（已下线重复操作/草稿）→ 409；前端下线钮本就只在 published 行可见。 */
router.put('/:id/archive', async (req: Request, res: Response) => {
  try {
    const existing = await findAnnouncementById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: '公告不存在' });
    if (existing.status !== 'published') {
      return res.status(409).json({ success: false, error: '仅发布中的公告可下线' });
    }
    // 操作审计：下线前快照旧实体
    setAuditAction(res, 'announcement-archive', { targetType: 'announcement', targetId: req.params.id });
    setAuditBefore(res, existing);

    const updated = await updateAnnouncement({
      where: { id: req.params.id },
      data: { status: 'archived' }
    });
    setAuditAfter(res, updated);
    res.json({ success: true, data: shape(updated as unknown as Record<string, unknown>) });
  } catch (error) {
    logger.error('[admin-announcements] archive failed:', error);
    res.status(500).json({ success: false, error: '下线公告失败' });
  }
});

/** PUT /:id — 编辑（标题/正文/级别/过期；不改变发布状态） */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { title, body, severity, expiresAt } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, error: '标题必填' });
    }
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, error: '正文必填' });
    }
    if (!SEVERITIES.has(severity)) {
      return res.status(400).json({ success: false, error: `severity 只能是 ${[...SEVERITIES].join('/')}` });
    }
    let expiresAtDate: Date | null = null;
    try {
      expiresAtDate = parseExpiresAt(expiresAt);
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message });
    }
    const updated = await updateAnnouncement({
      where: { id: req.params.id },
      data: {
        title: String(title).trim(),
        body: String(body).trim(),
        severity,
        expiresAt: expiresAtDate
      }
    });
    res.json({ success: true, data: shape(updated as unknown as Record<string, unknown>) });
  } catch (error) {
    logger.error('[admin-announcements] update failed:', error);
    res.status(500).json({ success: false, error: '编辑公告失败' });
  }
});

/** DELETE /:id — 删除 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteAnnouncement(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('[admin-announcements] delete failed:', error);
    res.status(500).json({ success: false, error: '删除公告失败' });
  }
});

export default router;
