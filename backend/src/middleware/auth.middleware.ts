// 认证中间件
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { ProjectionGrantSource, SyntheticCapability, verifyProjectionToken } from '../utils/projection-token';
import { enforceSyntheticProjectionAccess } from './synthetic-projection.middleware';
import { SessionTokenType, verifySessionToken } from '../utils/session-token';
import { resolveAuthToken } from '../utils/auth-cookie';

interface JwtPayload {
  userId: string;
  email: string;
}

// 扩展Request类型
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        isAdmin?: boolean;
        sessionType?: SessionTokenType;
        projection?: {
          active: boolean;
          targetUserId: string;
          sourceProfileId?: string | null;
          issuedByAdminId: string;
          grantSource?: ProjectionGrantSource;
          grantId?: string | null;
          storyId?: string | null;
          virtualSessionId?: string | null;
          scope?: string;
          scopeDefinition?: string | null;
          capabilities?: SyntheticCapability[];
          experimentId?: string | null;
          runId?: string | null;
        };
      };
    }
  }
}

const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
  expectedType: SessionTokenType,
  allowProjection: boolean
) => {
  try {
    if (req.user) {
      const alreadyAuthenticated = expectedType === 'admin'
        ? req.user.sessionType === 'admin'
        : req.user.sessionType === 'user'
          || req.user.sessionType === 'admin'
          || (allowProjection && req.user.projection?.active);
      if (alreadyAuthenticated) {
        next();
        return;
      }
      return res.status(403).json({
        success: false,
        error: { message: '认证会话类型不匹配' }
      });
    }

    const projectionToken = typeof req.headers['x-projection-token'] === 'string'
      ? req.headers['x-projection-token']
      : undefined;

    if (projectionToken && allowProjection) {
      const projection = verifyProjectionToken(projectionToken);

      if ((projection.grantSource || 'virtual-learner') === 'access-grant') {
        const grant = await prisma.projection_access_grants.findUnique({
          where: { id: projection.grantId }
        });

        if (!grant || grant.userId !== projection.targetUserId || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) {
          return res.status(401).json({
            success: false,
            error: { message: '投影授权已失效' }
          });
        }

        await prisma.projection_access_grants.update({
          where: { id: grant.id },
          data: {
            lastUsedAt: new Date(),
            lastUsedByAdminId: projection.issuedByAdminId,
            useCount: { increment: 1 }
          }
        });
      }

      req.user = {
        userId: projection.targetUserId,
        email: `${projection.targetUserId}@projection.local`,
        projection: {
          active: true,
          targetUserId: projection.targetUserId,
          sourceProfileId: projection.sourceProfileId || null,
          issuedByAdminId: projection.issuedByAdminId,
          grantSource: projection.grantSource || 'virtual-learner',
          grantId: projection.grantId || null,
          storyId: projection.storyId || null,
          virtualSessionId: projection.virtualSessionId || null,
          scope: projection.scope,
          scopeDefinition: projection.scopeDefinition || null,
          capabilities: projection.capabilities || [],
          experimentId: projection.experimentId || null,
          runId: projection.runId || null,
        }
      };
      enforceSyntheticProjectionAccess(req, res, next);
      return;
    }

    // 解析 token：优先 Authorization Header，回退 HttpOnly Cookie
    const token = resolveAuthToken(req, expectedType);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { message: '未提供认证Token' }
      });
    }

    // 验证token（显式指定允许的算法）
    const decoded = verifySessionToken(token, expectedType) as JwtPayload;

    // 将用户信息附加到request
    req.user = {
      userId: decoded.userId,
      email: decoded.email || '',
      isAdmin: expectedType === 'admin',
      sessionType: expectedType
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { message: 'Token已过期' }
      });
    }

    if (error.name === 'JsonWebTokenError' || String(error.message || '').includes('token') || String(error.message || '').includes('capability')) {
      return res.status(401).json({
        success: false,
        error: { message: '无效的Token' }
      });
    }

    logger.error('认证中间件错误:', error);
    return res.status(500).json({
      success: false,
      error: { message: '认证失败' }
    });
  }
};

/** 普通用户认证，同时允许显式的 Projection Header。 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  return authenticate(req, res, next, 'user', true);
};

/** Admin Bearer Token 认证，不接受普通用户或 Projection Token。 */
export const adminAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  return authenticate(req, res, next, 'admin', false);
};

/**
 * 可选认证中间件 - 不强制要求Token
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = resolveAuthToken(req, 'user');

    if (token) {
      const decoded = verifySessionToken(token, 'user') as JwtPayload;
      req.user = {
        userId: decoded.userId,
        email: decoded.email || '',
        isAdmin: false,
        sessionType: 'user'
      };
    }

    next();
  } catch (error) {
    // 忽略错误，继续处理请求
    next();
  }
};
