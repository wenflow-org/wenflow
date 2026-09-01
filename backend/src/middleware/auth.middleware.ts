// 认证中间件
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { ProjectionGrantSource, SyntheticCapability, verifyProjectionToken } from '../utils/projection-token';
import { enforceSyntheticProjectionAccess } from './synthetic-projection.middleware';
import {
  SessionTokenType,
  verifySessionToken,
  verifyAccessToken,
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
} from '../utils/session-token';
import {
  resolveAuthToken,
  resolveRefreshToken,
  setAuthCookie,
  setRefreshCookie,
} from '../utils/auth-cookie';

interface JwtPayload {
  userId: string;
  email: string;
  tokenVersion?: number;
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

/**
 * Validate user record (exists, not deleted, tokenVersion match).
 * Returns the user record or null if invalid (res already sent).
 */
const validateUserRecord = async (
  userId: string,
  tokenVersion?: number
): Promise<{ deletedAt: Date | null; tokenVersion: number | null } | null> => {
  const userRecord = await prisma.users.findUnique({
    where: { id: userId },
    select: { deletedAt: true, tokenVersion: true }
  });

  if (!userRecord || userRecord.deletedAt) {
    return null;
  }

  // 兼容存量旧 token（payload 无 tokenVersion 时不做版本校验，随过期自然失效）
  if (typeof tokenVersion === 'number'
    && (userRecord.tokenVersion ?? 0) !== tokenVersion) {
    return null;
  }

  return userRecord;
};

/**
 * Issue a new token pair and set cookies for a user during silent refresh.
 */
const issueAndSetTokens = (
  res: Response,
  userId: string,
  name: string,
  tokenVersion: number
): void => {
  const accessToken = signAccessToken(userId, name, tokenVersion);
  const refreshToken = signRefreshToken(userId, tokenVersion);
  setAuthCookie(res, accessToken, 'user');
  setRefreshCookie(res, refreshToken);
};

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

    // ──── Admin path: single-token, no refresh needed ────
    if (expectedType === 'admin') {
      const token = resolveAuthToken(req, expectedType);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: { message: '未提供认证Token' }
        });
      }

      const decoded = verifySessionToken(token, expectedType) as JwtPayload;
      req.user = {
        userId: decoded.userId,
        email: decoded.email || '',
        isAdmin: true,
        sessionType: 'admin'
      };
      next();
      return;
    }

    // ──── User path: dual-token with silent refresh ────

    // 1. Try access token first
    const accessToken = resolveAuthToken(req, 'user');
    if (accessToken) {
      try {
        const decoded = verifyAccessToken(accessToken) as JwtPayload;
        const userRecord = await validateUserRecord(decoded.userId, decoded.tokenVersion);
        if (!userRecord) {
          return res.status(401).json({
            success: false,
            error: { message: '会话已失效，请重新登录' }
          });
        }

        req.user = {
          userId: decoded.userId,
          email: decoded.email || '',
          isAdmin: false,
          sessionType: 'user'
        };
        next();
        return;
      } catch (atError: any) {
        // Access token invalid/expired — fall through to try refresh token
        if (atError.name !== 'TokenExpiredError' && atError.name !== 'JsonWebTokenError') {
          throw atError;
        }
        // If access token expired, try silent refresh
        if (atError.name !== 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            error: { message: '无效的Token' }
          });
        }
      }
    }

    // 2. Access token missing/expired — try refresh token from cookie
    const refreshTokenCookie = resolveRefreshToken(req);
    if (!refreshTokenCookie) {
      return res.status(401).json({
        success: false,
        error: { message: '未提供认证Token' }
      });
    }

    try {
      const refreshPayload = verifyRefreshToken(refreshTokenCookie);
      const userRecord = await validateUserRecord(
        refreshPayload.userId,
        refreshPayload.tokenVersion
      );

      if (!userRecord) {
        return res.status(401).json({
          success: false,
          error: { message: '会话已失效，请重新登录' }
        });
      }

      // Silent refresh: issue new access + refresh token pair, set cookies
      issueAndSetTokens(
        res,
        refreshPayload.userId,
        refreshPayload.name || '',
        refreshPayload.tokenVersion ?? 0
      );

      // Attach user to request
      req.user = {
        userId: refreshPayload.userId,
        email: refreshPayload.email || '',
        isAdmin: false,
        sessionType: 'user'
      };

      next();
      return;
    } catch (rtError: any) {
      return res.status(401).json({
        success: false,
        error: { message: '会话已过期，请重新登录' }
      });
    }
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
    // Try access token first
    const accessToken = resolveAuthToken(req, 'user');

    if (accessToken) {
      try {
        const decoded = verifyAccessToken(accessToken) as JwtPayload;
        req.user = {
          userId: decoded.userId,
          email: decoded.email || '',
          isAdmin: false,
          sessionType: 'user'
        };
        next();
        return;
      } catch {
        // Token invalid/expired — try refresh silently
      }
    }

    // Try refresh token for silent recovery
    const refreshTokenCookie = resolveRefreshToken(req);
    if (refreshTokenCookie) {
      try {
        const refreshPayload = verifyRefreshToken(refreshTokenCookie);
        const userRecord = await validateUserRecord(
          refreshPayload.userId,
          refreshPayload.tokenVersion
        );

        if (userRecord) {
          issueAndSetTokens(
            res,
            refreshPayload.userId,
            refreshPayload.name || '',
            refreshPayload.tokenVersion ?? 0
          );

          req.user = {
            userId: refreshPayload.userId,
            email: refreshPayload.email || '',
            isAdmin: false,
            sessionType: 'user'
          };
        }
      } catch {
        // Refresh invalid — ignore
      }
    }

    next();
  } catch (error) {
    // 忽略错误，继续处理请求
    next();
  }
};
