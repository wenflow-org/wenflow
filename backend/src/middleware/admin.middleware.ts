// Admin 认证中间件
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

interface JwtPayload {
  userId: string;
  email: string;
}

// 注意：Request.user类型已在auth.middleware.ts中定义

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

/**
 * Admin 认证中间件 - 验证 JWT Token 并检查 admin 权限
 */
export const adminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // 从 header 获取 token
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: '未提供认证 Token' }
      });
    }

    const token = authHeader.substring(7);

    // 验证 token
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload & { isAdmin?: boolean };

    // 检查是否为 admin
    if (!decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    // 将用户信息附加到 request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      isAdmin: true
    };

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

/**
 * 可选 Admin 中间件 - 不强制要求 admin 权限
 */
export const optionalAdminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload & { isAdmin?: boolean };
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        isAdmin: decoded.isAdmin || false
      };
    } else {
      req.user = undefined;
    }

    next();
  } catch (error) {
    // 忽略错误，继续处理请求
    next();
  }
};
