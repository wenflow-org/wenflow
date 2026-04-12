import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import { z } from 'zod';

const router = express.Router();

// 环境变量
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const ADMIN_PORT = process.env.ADMIN_PORT || '3002';

// 验证 Schema
const loginSchema = z.object({
  email: z.string().email('无效的邮箱格式'),
  password: z.string().min(6, '密码至少 6 位'),
  remember: z.boolean().optional(),
});

/**
 * 管理员登录
 * POST /api/admin/auth/login
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);

    // 查找用户
    const user = await prisma.users.findUnique({
      where: { email: body.email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        role: true,
        isAdmin: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          message: '邮箱或密码错误',
          status: 401,
        },
      });
      return;
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(body.password, user.password);
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        error: {
          message: '邮箱或密码错误',
          status: 401,
        },
      });
      return;
    }

    // 检查是否是管理员
    if (!user.isAdmin && user.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: {
          message: '权限不足：需要管理员账号',
          status: 403,
        },
      });
      return;
    }

    // 生成 JWT Token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
      },
      JWT_SECRET,
      { expiresIn: body.remember ? '30d' : '7d' }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: {
          message: error.errors[0]?.message || '验证失败',
          status: 400,
        },
      });
      return;
    }

    console.error('管理员登录失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '服务器错误',
        status: 500,
      },
    });
  }
});

/**
 * 获取当前管理员信息
 * GET /api/admin/auth/me
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    // 从请求头获取 token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          message: '未授权',
          status: 401,
        },
      });
      return;
    }

    const token = authHeader.substring(7);
    const decoded: any = jwt.verify(token, JWT_SECRET);

    // 获取用户信息
    const user = await prisma.users.findUnique({
      where: { id: decoded.userId },
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

    if (!user || (!user.isAdmin && user.role !== 'admin')) {
      res.status(403).json({
        success: false,
        error: {
          message: '权限不足',
          status: 403,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    console.error('获取管理员信息失败:', error);
    res.status(401).json({
      success: false,
      error: {
        message: 'Token 无效或已过期',
        status: 401,
      },
    });
  }
});

export default router;
