import express from 'express';
import prisma from '../config/database';

const router = express.Router();
const DEFAULT_GRANT_TTL_MINUTES = 24 * 60;

function normalizeProjectionScope(value: any): 'dashboard' | 'full' {
  return value === 'full' ? 'full' : 'dashboard';
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

router.get('/overview', async (req, res) => {
  const userId = req.user?.userId || 'unknown';

  res.json({
    success: true,
    data: {
      authMode: 'jwt-bearer',
      userId,
      baseUrl: '/api',
      docsPath: '/docs',
      sdkStatus: 'planned',
      webhookStatus: 'planned',
      pluginMarketplaceStatus: 'planned',
      availableScopes: [
        'goal-conversation:read',
        'goal-conversation:write',
        'agents:invoke',
        'learning-paths:read',
        'learning-paths:write'
      ],
      endpointGroups: [
        {
          name: 'Goal Conversation',
          basePath: '/api/goal-conversation',
          endpoints: ['POST /start', 'POST /:conversationId/reply', 'GET /:conversationId']
        },
        {
          name: 'Learning Paths',
          basePath: '/api/learning/paths',
          endpoints: ['GET /', 'GET /:id', 'POST /create']
        },
        {
          name: 'User Capability',
          basePath: '/api/user',
          endpoints: ['GET /agents', 'GET /skills', 'GET /api-config', 'GET /mcp']
        },
        {
          name: 'Projection Access',
          basePath: '/api/user/developer/access-grants',
          endpoints: ['GET /', 'POST /', 'POST /:grantId/revoke']
        }
      ]
    }
  });
});

router.get('/quickstart', async (req, res) => {
  const quickstart = [
    '# Developer Quickstart',
    '',
    '1. 在个人中心 > 开发者接入中查看可用 API 组。',
    '2. 使用当前登录态 JWT 作为 Bearer Token 调用接口。',
    '3. 先从 Goal Conversation API 完成一次端到端联调。',
    '4. 再接入 Learning Paths API 完成结果落库与回显。',
    '',
    '```bash',
    'curl -X POST "http://localhost:3001/api/goal-conversation/start" \\',
    '  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "{\"goal\":\"我想做一个可复用的问流 AI 学习助手\"}"',
    '```',
    '',
    '> 当前版本说明：SDK、Webhook、Plugin Marketplace 处于规划中；Agent 由平台托管发布，用户侧仅支持选择与启停。'
  ].join('\n');

  res.json({ success: true, data: { quickstart } });
});

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
    res.status(500).json({
      success: false,
      error: { message: error.message || '查询 access grant 失败' }
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

    const grant = await prisma.projection_access_grants.create({
      data: {
        userId,
        scope: normalizeProjectionScope(req.body?.scope),
        scopeDefinition: serializeScopeDefinition(req.body?.scopeDefinition),
        purpose: typeof req.body?.purpose === 'string' && req.body.purpose.trim()
          ? req.body.purpose.trim()
          : null,
        expiresAt
      }
    });

    res.status(201).json({
      success: true,
      data: formatGrant(grant)
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '创建 access grant 失败' }
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

    const grant = existing.revokedAt
      ? existing
      : await prisma.projection_access_grants.update({
          where: { id: grantId },
          data: { revokedAt: new Date() }
        });

    res.json({
      success: true,
      data: formatGrant(grant)
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '撤销 access grant 失败' }
    });
  }
});

export default router;
