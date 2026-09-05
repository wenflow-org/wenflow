import express from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { signProjectionToken } from '../../utils/projection-token';

const router = express.Router();

router.use(authMiddleware);

async function ensureAdmin(userId?: string) {
  if (!userId) {
    return false;
  }

  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  });

  return !!operator?.isAdmin;
}

function parseScopeDefinition(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function resolveGrantStatus(grant: { revokedAt?: Date | null; expiresAt: Date }) {
  if (grant.revokedAt) {
    return 'revoked';
  }

  if (grant.expiresAt.getTime() <= Date.now()) {
    return 'expired';
  }

  return 'active';
}

function formatGrant(grant: any) {
  return {
    id: grant.id,
    userId: grant.userId,
    userName: grant.users?.name || null,
    userEmail: grant.users?.email || null,
    scope: grant.scope,
    scopeDefinition: parseScopeDefinition(grant.scopeDefinition),
    purpose: grant.purpose || null,
    status: resolveGrantStatus(grant),
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt || null,
    lastUsedAt: grant.lastUsedAt || null,
    lastUsedByAdminId: grant.lastUsedByAdminId || null,
    useCount: grant.useCount || 0
  };
}

router.get('/', async (req: any, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
    const search = typeof req.query?.search === 'string' ? req.query.search.trim() : '';
    const userId = typeof req.query?.userId === 'string' ? req.query.userId.trim() : '';
    const now = new Date();
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (status === 'active') {
      where.revokedAt = null;
      where.expiresAt = { gt: now };
    } else if (status === 'revoked') {
      where.revokedAt = { not: null };
    } else if (status === 'expired') {
      where.revokedAt = null;
      where.expiresAt = { lte: now };
    }

    if (search) {
      where.OR = [
        { purpose: { contains: search } },
        { users: { is: { name: { contains: search } } } },
        { users: { is: { email: { contains: search } } } }
      ];
    }

    const grants = await prisma.projection_access_grants.findMany({
      where,
      include: {
        users: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: {
        grants: grants.map(formatGrant)
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '查询 access grant 失败' }
    });
  }
});

router.post('/:grantId/projection-token', async (req: any, res) => {
  try {
    const operatorId = req.user?.userId;
    const allowed = await ensureAdmin(operatorId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const grant = await prisma.projection_access_grants.findUnique({
      where: { id: req.params.grantId },
      include: {
        users: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    if (!grant) {
      return res.status(404).json({
        success: false,
        error: { message: 'access grant 不存在' }
      });
    }

    if (grant.revokedAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'access grant 已撤销，无法生成投影 token' }
      });
    }

    if (grant.expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        error: { message: 'access grant 已过期，无法生成投影 token' }
      });
    }

    const token = signProjectionToken({
      targetUserId: grant.userId,
      issuedByAdminId: operatorId,
      sourceProfileId: null,
      grantSource: 'access-grant',
      grantId: grant.id,
      scope: grant.scope === 'full' ? 'full' : 'dashboard',
      scopeDefinition: grant.scopeDefinition || null,
      type: 'projection'
    });

    res.json({
      success: true,
      data: {
        token,
        grantId: grant.id,
        grantSource: 'access-grant',
        targetUserId: grant.userId,
        userName: grant.users.name,
        email: grant.users.email,
        scope: grant.scope,
        scopeDefinition: parseScopeDefinition(grant.scopeDefinition),
        grantExpiresAt: grant.expiresAt,
        tokenExpiresIn: '30m'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '创建投影 token 失败' }
    });
  }
});

export default router;
