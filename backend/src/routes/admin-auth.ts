import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import prisma from '../config/database';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { adminAuthMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { adminLoginRateLimitMiddleware, recordLoginAttempt } from '../middleware/login-rate-limit.middleware';
import { signSessionToken, verifySessionToken } from '../utils/session-token';
import { setAuthCookie, clearAuthCookie, resolveAuthToken } from '../utils/auth-cookie';

const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_SHORT_MS = 24 * 60 * 60 * 1000;
const IP_MAX_CHARS = 100;
const USER_AGENT_MAX_CHARS = 300;

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

    // 查找管理员用户（支持用户名或邮箱登录）；软删管理员视为不存在
    const admin = await prisma.users.findFirst({
      where: {
        OR: [
          { name: name },
          { email: name }
        ],
        isAdmin: true,
        deletedAt: null,
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

    // 生成 JWT Token（管理员专用）：记住登录签发 7 天，否则签发 24 小时短会话；
    // jti 关联 admin_sessions 表，支持后台会话管理与登出吊销
    const sessionJti = randomUUID();
    const token = signSessionToken(
      {
        userId: admin.id,
        email: admin.email,
        name: admin.name,
        isAdmin: true,
        jti: sessionJti,
      },
      'admin',
      remember ? '7d' : '24h'
    );

    recordLoginAttempt(name, clientIP, true, 'admin');

    // 写入会话表（fail-open：写库失败不阻塞登录，仅告警；登出/吊销能力随之下线）
    try {
      const issuedAt = new Date();
      await prisma.admin_sessions.create({
        data: {
          id: randomUUID(),
          adminId: admin.id,
          jti: sessionJti,
          ip: clientIP.slice(0, IP_MAX_CHARS),
          userAgent: typeof req.headers['user-agent'] === 'string'
            ? req.headers['user-agent'].slice(0, USER_AGENT_MAX_CHARS)
            : null,
          remember: !!remember,
          issuedAt,
          expiresAt: new Date(issuedAt.getTime() + (remember ? ADMIN_SESSION_MAX_AGE_MS : ADMIN_SESSION_SHORT_MS)),
        },
      });
    } catch (sessionError) {
      logger.warn('管理员会话写入失败（不阻塞登录）:', sessionError);
    }

    // 写入 HttpOnly Cookie：勾选"记住登录"给 7 天有效期，否则为会话 Cookie
    setAuthCookie(res, token, 'admin', remember ? ADMIN_SESSION_MAX_AGE_MS : null);

    // 返回用户信息（不包含密码）
    const { password: _, ...userWithoutPassword } = admin;

    res.json({
      success: true,
      data: {
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

// 管理员登出：撤销会话表记录（从 Cookie/Header 解析 token 的 jti）+ 清除 HttpOnly 认证 Cookie。
// 解析/撤销失败仅告警，不阻塞登出（Cookie 必清，保证前端退出成功）。
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const token = resolveAuthToken(req, 'admin');
    if (token) {
      try {
        const payload = verifySessionToken(token, 'admin');
        if (payload.jti) {
          await prisma.admin_sessions.update({
            where: { jti: payload.jti },
            data: { revokedAt: new Date() },
          });
        }
      } catch (tokenError) {
        logger.warn('登出时解析会话 Token 失败（仅清理 Cookie）:', tokenError);
      }
    }
  } catch (sessionError) {
    logger.warn('登出时撤销会话失败（仅清理 Cookie）:', sessionError);
  }

  clearAuthCookie(res, 'admin');
  res.json({
    success: true,
    data: { message: '已退出登录' },
  });
});

// 获取当前管理员信息
router.get('/me', adminAuthMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    // 软删管理员视为不存在（与不存在同样返回 404，不泄露删除状态）
    const admin = await prisma.users.findFirst({
      where: { id: req.user!.userId, deletedAt: null },
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
