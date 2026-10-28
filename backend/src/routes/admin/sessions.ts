// 管理员会话管理路由（P2 方案 B：轻量完整会话表）
// 挂载在 adminRouteMiddleware 链内（adminAuthMiddleware + adminMiddleware + 审计），
// 此处仅处理会话业务；当前会话 jti 通过 extractSessionJti 从请求 Token 解出。
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { extractSessionJti } from '../../middleware/admin.middleware';
import {
  listAdminSessions,
  countAdminSessionsByAdmin,
  findAdminSessionById,
  revokeAdminSession,
  revokeAdminSessions,
  deleteEndedAdminSessions,
  pruneAdminSessionsIfDue,
  resolveAdminNames,
} from '../../services/admin-session.service';

const router = Router();

const listQuerySchema = z.object({
  adminId: z.string().trim().min(1).optional(),
  status: z.enum(['active', 'revoked', 'expired']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const revokeAllBodySchema = z.object({
  adminId: z.string().trim().min(1).optional(),
  excludeCurrent: z.boolean().optional(),
}).strict();

const cleanupBodySchema = z.object({
  adminId: z.string().trim().min(1).optional(),
}).strict();

// 会话列表：adminId / status（active=未吊销且未过期，revoked=已吊销，expired=未吊销但过期）过滤
// 行窗口（limit）与统计口径分离：counts/adminCounts 恒为作用域（adminId）全量，
// 不受 status 过滤与 limit 裁剪；window 描述本次行窗口，供前端显式标注「仅显示最近 N 条」。
router.get('/', async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const now = new Date();
    // 历史行惰性清理（每小时最多一次）：管理员每次登录写一行，若不清理会无限累积。
    // 失败不影响列表读取。
    try {
      await pruneAdminSessionsIfDue();
    } catch (pruneError) {
      logger.warn('管理员会话历史清理失败（不阻塞列表）:', pruneError);
    }
    // 请求者自身会话的 jti：前端据此精确打「当前」标记，不再按「最新创建」推断
    //（多标签/多设备/脚本登录时，最新创建的那行未必是当前标签页——2026-10-15 走查 #28）。
    const currentJti = extractSessionJti(req);

    const scopeWhere: Record<string, unknown> = {};
    if (query.adminId) {
      scopeWhere.adminId = query.adminId;
    }

    const where: Record<string, unknown> = { ...scopeWhere };
    if (query.status === 'active') {
      where.revokedAt = null;
      where.expiresAt = { gt: now };
    } else if (query.status === 'revoked') {
      where.revokedAt = { not: null };
    } else if (query.status === 'expired') {
      where.revokedAt = null;
      where.expiresAt = { lte: now };
    }

    const [sessions, countsByAdmin] = await Promise.all([
      listAdminSessions(where, query.limit),
      countAdminSessionsByAdmin(scopeWhere, now),
    ]);

    const adminNames = await resolveAdminNames([...new Set(sessions.map(session => session.adminId))]);
    const data = sessions.map(session => ({
      ...session,
      isCurrent: currentJti !== null && session.jti === currentJti,
      adminName: adminNames.get(session.adminId)?.name ?? null,
      adminEmail: adminNames.get(session.adminId)?.email ?? null,
    }));

    const adminCounts = [...countsByAdmin.entries()]
      .map(([adminId, counts]) => ({ adminId, ...counts }))
      .sort((a, b) => a.adminId.localeCompare(b.adminId));
    const counts = adminCounts.reduce(
      (acc, c) => ({
        total: acc.total + c.total,
        active: acc.active + c.active,
        expired: acc.expired + c.expired,
        revoked: acc.revoked + c.revoked,
      }),
      { total: 0, active: 0, expired: 0, revoked: 0 },
    );

    res.json({
      success: true,
      data: {
        sessions: data,
        counts,
        adminCounts,
        window: { limit: query.limit, returned: data.length },
      },
    });
  } catch (error) {
    next(error);
  }
});

// 强制下线指定会话（禁止下线自己的当前会话 → 409）
router.delete('/:id', async (req, res, next) => {
  try {
    const currentJti = extractSessionJti(req);

    const session = await findAdminSessionById(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在', status: 404 },
      });
    }

    if (currentJti && session.jti === currentJti) {
      return res.status(409).json({
        success: false,
        error: { message: '不能下线自己的当前会话', status: 409 },
      });
    }

    await revokeAdminSession(session.id);

    res.json({ success: true, data: { message: '会话已下线' } });
  } catch (error) {
    next(error);
  }
});

// 清理已结束会话（已吊销 / 已过期）：只删历史行，登录事件保留在 login_attempts
router.post('/cleanup', async (req, res, next) => {
  try {
    const body = cleanupBodySchema.parse(req.body ?? {});
    const where: Record<string, unknown> = {};
    if (body.adminId) {
      where.adminId = body.adminId;
    }

    const result = await deleteEndedAdminSessions(where, new Date());

    logger.info('管理员会话历史清理', {
      adminId: body.adminId ?? 'all',
      count: result.count,
      operatorId: req.user?.userId,
    });

    res.json({ success: true, data: { count: result.count } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: { message: '请求参数不合法', status: 400 },
      });
    }
    next(error);
  }
});

// 批量吊销：指定 adminId（缺省为全部管理员）的活跃会话；excludeCurrent=true 时保留请求者当前会话。
// 已过期会话不再重复标记（它们已无法通过鉴权），历史清理由 /cleanup 负责。
router.post('/revoke-all', async (req, res, next) => {
  try {
    const body = revokeAllBodySchema.parse(req.body ?? {});
    const currentJti = extractSessionJti(req);

    const where: Record<string, unknown> = { revokedAt: null, expiresAt: { gt: new Date() } };
    if (body.adminId) {
      where.adminId = body.adminId;
    }
    if (body.excludeCurrent && currentJti) {
      where.jti = { not: currentJti };
    }

    const result = await revokeAdminSessions(where);

    logger.info('管理员会话批量吊销', {
      adminId: body.adminId ?? 'all',
      excludeCurrent: body.excludeCurrent,
      count: result.count,
      operatorId: req.user?.userId,
    });

    res.json({ success: true, data: { count: result.count } });
  } catch (error) {
    next(error);
  }
});

export default router;
