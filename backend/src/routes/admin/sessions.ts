// 管理员会话管理路由（P2 方案 B：轻量完整会话表）
// 挂载在 adminRouteMiddleware 链内（adminAuthMiddleware + adminMiddleware + 审计），
// 此处仅处理会话业务；当前会话 jti 通过 extractSessionJti 从请求 Token 解出。
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { extractSessionJti } from '../../middleware/admin.middleware';

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

/** 批量取管理员名称（admin_sessions 与 admin_audit_logs 同约定：adminId 为纯列） */
async function resolveAdminNames(adminIds: string[]): Promise<Map<string, { name: string; email: string }>> {
  if (adminIds.length === 0) return new Map();
  const admins = await prisma.users.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, name: true, email: true },
  });
  return new Map(admins.map(admin => [admin.id, { name: admin.name, email: admin.email }]));
}

// 会话列表：adminId / status（active=未吊销且未过期，revoked=已吊销，expired=未吊销但过期）过滤
router.get('/', async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const now = new Date();

    const where: Record<string, unknown> = {};
    if (query.adminId) {
      where.adminId = query.adminId;
    }
    if (query.status === 'active') {
      where.revokedAt = null;
      where.expiresAt = { gt: now };
    } else if (query.status === 'revoked') {
      where.revokedAt = { not: null };
    } else if (query.status === 'expired') {
      where.revokedAt = null;
      where.expiresAt = { lte: now };
    }

    const sessions = await prisma.admin_sessions.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    const adminNames = await resolveAdminNames([...new Set(sessions.map(session => session.adminId))]);
    const data = sessions.map(session => ({
      ...session,
      adminName: adminNames.get(session.adminId)?.name ?? null,
      adminEmail: adminNames.get(session.adminId)?.email ?? null,
    }));

    res.json({ success: true, data: { sessions: data } });
  } catch (error) {
    next(error);
  }
});

// 强制下线指定会话（禁止下线自己的当前会话 → 409）
router.delete('/:id', async (req, res, next) => {
  try {
    const currentJti = extractSessionJti(req);

    const session = await prisma.admin_sessions.findUnique({
      where: { id: req.params.id },
    });

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

    await prisma.admin_sessions.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    res.json({ success: true, data: { message: '会话已下线' } });
  } catch (error) {
    next(error);
  }
});

// 批量吊销：指定 adminId（缺省为全部管理员）的未吊销会话；excludeCurrent=true 时保留请求者当前会话
router.post('/revoke-all', async (req, res, next) => {
  try {
    const body = revokeAllBodySchema.parse(req.body ?? {});
    const currentJti = extractSessionJti(req);

    const where: Record<string, unknown> = { revokedAt: null };
    if (body.adminId) {
      where.adminId = body.adminId;
    }
    if (body.excludeCurrent && currentJti) {
      where.jti = { not: currentJti };
    }

    const result = await prisma.admin_sessions.updateMany({
      where,
      data: { revokedAt: new Date() },
    });

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
