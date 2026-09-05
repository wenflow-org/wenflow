import express from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';

const router = express.Router();
const DEFAULT_GRANT_TTL_MINUTES = 24 * 60;
// S2：自建 access grant 有效期上限（30 天 = 43200 分钟），防止长期有效的过高权限凭据
const MAX_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// S2：scopeDefinition 序列化后大小上限（2KB）
const MAX_SCOPE_DEFINITION_BYTES = 2048;
// S2：purpose 长度上限（200 字符）
const MAX_PURPOSE_CHARS = 200;

function normalizeProjectionScope(value: any): 'dashboard' | 'full' {
  // 安全加固：用户自建 grant 仅允许 dashboard 范围；full 仅管理员可授予
  return value === 'full' ? 'full' : 'dashboard';
}

function rejectFullScope(value: any): string | null {
  if (value === 'full') {
    return 'full 范围仅支持管理员授予，请使用仅学习台（dashboard）范围';
  }
  return null;
}

function serializeScopeDefinition(value: any): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  return JSON.stringify(value);
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

function parseExpiresAt(body: any) {
  if (typeof body?.expiresAt === 'string' && body.expiresAt.trim()) {
    const parsed = new Date(body.expiresAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    return null;
  }

  if (body?.expiresInMinutes !== undefined) {
    const expiresInMinutes = Number(body.expiresInMinutes);
    if (!Number.isFinite(expiresInMinutes) || expiresInMinutes <= 0) {
      return null;
    }

    return new Date(Date.now() + expiresInMinutes * 60 * 1000);
  }

  return new Date(Date.now() + DEFAULT_GRANT_TTL_MINUTES * 60 * 1000);
}

function ensureDirectUserSession(req: any, res: any) {
  if (req.user?.projection?.active) {
    res.status(403).json({
      success: false,
      error: { message: '投影视角下不允许管理 access grant' }
    });
    return false;
  }

  return true;
}

router.get('/access-grants', async (req: any, res) => {
  try {
    if (!ensureDirectUserSession(req, res)) {
      return;
    }

    const userId = req.user?.userId;
    const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
    const now = new Date();
    const where: any = { userId };

    if (status === 'active') {
      where.revokedAt = null;
      where.expiresAt = { gt: now };
    } else if (status === 'revoked') {
      where.revokedAt = { not: null };
    } else if (status === 'expired') {
      where.revokedAt = null;
      where.expiresAt = { lte: now };
    }

    const grants = await prisma.projection_access_grants.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: {
        grants: grants.map(formatGrant)
      }
    });
  } catch (error: any) {
    logger.error('[user-developer] 查询 access grant 失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '查询 access grant 失败，请稍后重试' }
    });
  }
});

router.post('/access-grants', async (req: any, res) => {
  try {
    if (!ensureDirectUserSession(req, res)) {
      return;
    }

    const userId = req.user?.userId;
    const expiresAt = parseExpiresAt(req.body);
    if (!expiresAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'expiresAt 格式无效' }
      });
    }

    if (expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        error: { message: 'expiresAt 必须晚于当前时间' }
      });
    }

    // S2：TTL 上限——自建 grant 不允许设置超长有效期（expiresInMinutes 或 expiresAt 超出 30 天均拒绝）
    if (expiresAt.getTime() - Date.now() > MAX_GRANT_TTL_MS) {
      return res.status(400).json({
        success: false,
        error: { message: '授权有效期不能超过 30 天' }
      });
    }

    // S2：scopeDefinition 大小上限（序列化后 ≤2KB）
    let scopeDefinition: string | null;
    try {
      scopeDefinition = serializeScopeDefinition(req.body?.scopeDefinition);
    } catch {
      return res.status(400).json({
        success: false,
        error: { message: 'scopeDefinition 格式无效' }
      });
    }
    if (scopeDefinition && Buffer.byteLength(scopeDefinition, 'utf8') > MAX_SCOPE_DEFINITION_BYTES) {
      return res.status(400).json({
        success: false,
        error: { message: 'scopeDefinition 过大（序列化后不能超过 2KB）' }
      });
    }

    // S2：purpose 长度上限
    const purpose = typeof req.body?.purpose === 'string' && req.body.purpose.trim()
      ? req.body.purpose.trim()
      : null;
    if (purpose && purpose.length > MAX_PURPOSE_CHARS) {
      return res.status(400).json({
        success: false,
        error: { message: 'purpose 过长（最多 200 字符）' }
      });
    }

    // 安全加固：full 范围仅管理员可授予（防止用户自授过高权限投影许可）
    const fullScopeError = rejectFullScope(req.body?.scope);
    if (fullScopeError) {
      return res.status(400).json({
        success: false,
        error: { message: fullScopeError }
      });
    }

    const now = new Date();
    const grant = await prisma.$transaction(async (tx) => {
      await tx.projection_access_grants.updateMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now }
        },
        data: { revokedAt: now }
      });

      return tx.projection_access_grants.create({
        data: {
          userId,
          scope: normalizeProjectionScope(req.body?.scope),
          scopeDefinition,
          purpose,
          expiresAt
        }
      });
    });

    res.status(201).json({
      success: true,
      data: formatGrant(grant)
    });
  } catch (error: any) {
    logger.error('[user-developer] 创建 access grant 失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '创建 access grant 失败，请稍后重试' }
    });
  }
});

router.post('/access-grants/:grantId/revoke', async (req: any, res) => {
  try {
    if (!ensureDirectUserSession(req, res)) {
      return;
    }

    const userId = req.user?.userId;
    const grantId = req.params.grantId;

    const existing = await prisma.projection_access_grants.findFirst({
      where: {
        id: grantId,
        userId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'access grant 不存在' }
      });
    }

    const now = new Date();
    // 修复：revoke 只撤销目标 grant（此前缺 id 条件会连带撤销该用户全部活跃 grant）
    await prisma.projection_access_grants.updateMany({
      where: {
        id: grantId,
        userId,
        revokedAt: null,
        expiresAt: { gt: now }
      },
      data: { revokedAt: now }
    });

    const grant = existing.revokedAt
      ? existing
      : { ...existing, revokedAt: now, updatedAt: now };

    res.json({
      success: true,
      data: formatGrant(grant)
    });
  } catch (error: any) {
    logger.error('[user-developer] 撤销 access grant 失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '撤销 access grant 失败，请稍后重试' }
    });
  }
});

export default router;
