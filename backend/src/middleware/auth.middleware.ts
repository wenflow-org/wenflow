// 认证中间件
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { ProjectionGrantSource, SyntheticCapability, verifyProjectionToken } from '../utils/projection-token';
import { enforceSyntheticProjectionAccess } from './synthetic-projection.middleware';

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

// 安全检查：JWT_SECRET 必须从环境变量获取
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET 环境变量未设置！请在 .env 文件中配置 JWT_SECRET');
  }
  return secret;
};

const JWT_SECRET = getJwtSecret();

/**
 * 认证中间件 - 验证JWT Token
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const projectionToken = typeof req.headers['x-projection-token'] === 'string'
      ? req.headers['x-projection-token']
      : undefined;

    if (projectionToken) {
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

    // 从header获取token
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: '未提供认证Token' }
      });
    }

    const token = authHeader.substring(7); // 去掉 "Bearer " 前缀

    // 验证token（显式指定允许的算法）
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256']
    }) as JwtPayload;

    // 将用户信息附加到request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      isAdmin: (decoded as any).isAdmin || false
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

/**
 * 可选认证中间件 - 不强制要求Token
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256']
      }) as JwtPayload;
      req.user = {
        userId: decoded.userId,
        email: decoded.email
      };
    }

    next();
  } catch (error) {
    // 忽略错误，继续处理请求
    next();
  }
};
