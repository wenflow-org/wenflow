// Admin 认证中间件
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';

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

    const admin = await prisma.users.findUnique({
      where: { id: req.user.userId },
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
