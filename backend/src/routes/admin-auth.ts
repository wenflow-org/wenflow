import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../config/database';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { adminAuthMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { adminLoginRateLimitMiddleware, recordLoginAttempt } from '../middleware/login-rate-limit.middleware';
import { signSessionToken } from '../utils/session-token';
import { setAuthCookie, clearAuthCookie } from '../utils/auth-cookie';

const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const router = express.Router();

const INVALID_LOGIN_PASSWORD_HASH = '$2b$10$OAioDMuBkv4OiDj1OPaJse/r3xbZoGaxLWtBNBD6VSlBa5T4nwkdG';

// 管理员登录验证 Schema
const loginSchema = z.object({
  name: z.string().min(1, '用户名不能为空'),
  password: z.string().min(6, '密码长度至少 6 位'),
  remember: z.boolean().optional(),
});

// 管理员登录
router.post('/login', adminLoginRateLimitMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, password, remember } = loginSchema.parse(req.body);
    const clientIP = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();

    // 查找管理员用户（支持用户名或邮箱登录）
    const admin = await prisma.users.findFirst({
      where: {
        OR: [
          { name: name },
          { email: name }
        ],
        isAdmin: true,
      },
    });

    // 未命中时也执行同等成本的密码校验，避免通过响应时序探测管理员账号。
    const isValidPassword = await bcrypt.compare(
      password,
      admin?.password || INVALID_LOGIN_PASSWORD_HASH
    );

    if (!admin || !isValidPassword) {
      recordLoginAttempt(name, clientIP, false, 'admin');
      return res.status(401).json({
        success: false,
        error: {
          message: '用户名或密码错误',
          code: 'INVALID_CREDENTIALS',
          status: 401,
        },
      });
    }

    // 生成 JWT Token（管理员专用）
    const token = signSessionToken(
      {
        userId: admin.id,
        email: admin.email,
        name: admin.name,
        isAdmin: true,
      },
      'admin',
      '7d'
    );

    recordLoginAttempt(name, clientIP, true, 'admin');

    // 写入 HttpOnly Cookie：勾选"记住登录"给 7 天有效期，否则为会话 Cookie
    setAuthCookie(res, token, 'admin', remember ? ADMIN_SESSION_MAX_AGE_MS : null);

    // 返回用户信息（不包含密码）
    const { password: _, ...userWithoutPassword } = admin;

    res.json({
      success: true,
      data: {
        token,
        user: userWithoutPassword,
      },
      message: '登录成功',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          message: error.errors[0].message,
          status: 400,
        },
      });
    }

    logger.error('管理员登录失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '登录失败',
        status: 500,
      },
    });
  }
});

// 管理员登出：清除 HttpOnly 认证 Cookie
router.post('/logout', (req: Request, res: Response) => {
  clearAuthCookie(res, 'admin');
  res.json({
    success: true,
    data: { message: '已退出登录' },
  });
});

// 获取当前管理员信息
router.get('/me', adminAuthMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const admin = await prisma.users.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isAdmin: true,
        xp: true,
        currentLevel: true,
        createdAt: true,
      },
    });

    if (!admin?.isAdmin) {
      return res.status(404).json({
        success: false,
        error: {
          message: '用户不存在',
          status: 404,
        },
      });
    }

    res.json({
      success: true,
      data: admin,
    });
  } catch (error: any) {
    logger.error('获取管理员信息失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '服务器错误',
        status: 500,
      },
    });
  }
});

export default router;
