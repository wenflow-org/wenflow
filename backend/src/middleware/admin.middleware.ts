// Admin 认证中间件
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { resolveAuthToken } from '../utils/auth-cookie';

// lastSeenAt 更新节流：同 jti 60s 内至多落库一次（fire-and-forget）
const LAST_SEEN_THROTTLE_MS = 60 * 1000;
const LAST_SEEN_CACHE_MAX_ENTRIES = 10000;
const lastSeenCache = new Map<string, number>();

/**
 * 从请求的 admin Token（Authorization Bearer 优先，回退 HttpOnly Cookie）中解出 jti。
 * 仅 decode 不做签名校验——token 已由 adminAuthMiddleware 验证通过。
 * 旧格式（无 jti）Token 返回 null。
 */
export const extractSessionJti = (req: Request): string | null => {
  try {
    const token = resolveAuthToken(req, 'admin');
    if (!token) return null;
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === 'object' && typeof decoded.jti === 'string' && decoded.jti) {
      return decoded.jti;
    }
  } catch {
    // 解析失败（无 headers/cookies 或非法 token）视为无会话
  }
  return null;
};

const touchLastSeen = (jti: string): void => {
  const now = Date.now();
  const last = lastSeenCache.get(jti);
  if (last && now - last < LAST_SEEN_THROTTLE_MS) return;
  if (lastSeenCache.size >= LAST_SEEN_CACHE_MAX_ENTRIES) {
    lastSeenCache.clear();
  }
  lastSeenCache.set(jti, now);
  prisma.admin_sessions.update({
    where: { jti },
    data: { lastSeenAt: new Date(now) },
  }).catch((error: unknown) => {
    logger.warn('管理员会话 lastSeenAt 更新失败:', error);
  });
};

/**
 * Admin 授权中间件。
 *
 * 必须放在 authMiddleware 之后：认证层负责解析身份，这里只接受普通 JWT，
 * 并以数据库中的当前权限为准，避免降权后的旧 Token 继续访问后台。
 */
export const adminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { message: '未提供认证 Token' }
      });
    }

    if (req.user.projection?.active) {
      return res.status(403).json({
        success: false,
        error: { message: '投影视角不允许访问管理员接口' }
      });
    }

    if (!req.user.isAdmin || req.user.sessionType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    // 软删管理员视为权限失效（查询过滤 deletedAt: null）
    const admin = await prisma.users.findFirst({
      where: { id: req.user.userId, deletedAt: null },
      select: { id: true, email: true, isAdmin: true }
    });

    if (!admin?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: { message: '管理员权限已失效' }
      });
    }

    req.user = {
      userId: admin.id,
      email: admin.email,
      isAdmin: true,
      sessionType: 'admin'
    };

    // P2 会话校验：带 jti 的新格式 Token 需命中 admin_sessions 且未吊销未过期。
    // legacy Token（无 jti）放行保持兼容；查表失败（DB 错误）fail-open 放行，避免误伤全部管理员。
    const sessionJti = extractSessionJti(req);
    if (sessionJti) {
      try {
        const session = await prisma.admin_sessions.findUnique({ where: { jti: sessionJti } });
        if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
          return res.status(403).json({
            success: false,
            error: { message: '会话已吊销或过期' }
          });
        }
        touchLastSeen(sessionJti);
      } catch (sessionError) {
        logger.warn('管理员会话校验查询失败（fail-open 放行）:', sessionError);
      }
    }

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { message: 'Token 已过期' }
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: { message: '无效的 Token' }
      });
    }

    logger.error('Admin 认证中间件错误:', error);
    return res.status(500).json({
      success: false,
      error: { message: '认证失败' }
    });
  }
};
