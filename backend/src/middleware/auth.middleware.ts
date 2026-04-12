// 认证中间件
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

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
    // 从header获取token
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: '未提供认证Token' }
      });
    }

    const token = authHeader.substring(7); // 去掉 "Bearer " 前缀

    // 验证token
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // 将用户信息附加到request
    req.user = {
      userId: decoded.userId,
      email: decoded.email
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { message: 'Token已过期' }
      });
    }

    if (error.name === 'JsonWebTokenError') {
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
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
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
