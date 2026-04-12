import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { z } from 'zod';

const router = express.Router();

// 管理员登录验证 Schema
const loginSchema = z.object({
  name: z.string().min(1, '用户名不能为空'),
  password: z.string().min(6, '密码长度至少 6 位'),
});

// 管理员登录
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { name, password } = loginSchema.parse(req.body);

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

    if (!admin) {
      return res.status(401).json({
        success: false,
        error: {
          message: '管理员账号不存在',
          status: 401,
        },
      });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: {
          message: '密码错误',
          status: 401,
        },
      });
    }

    // 生成 JWT Token（管理员专用）
    const token = jwt.sign(
      {
        userId: admin.id,
        name: admin.name,
        isAdmin: true,
      },
      process.env.JWT_SECRET || 'admin-secret-key',
      {
        expiresIn: '7d',
      }
    );

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

    console.error('管理员登录失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '登录失败',
        status: 500,
      },
    });
  }
});

// 获取当前管理员信息
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          message: '未提供认证令牌',
          status: 401,
        },
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'admin-secret-key');

    if (!decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          message: '需要管理员权限',
          status: 403,
        },
      });
    }

    const admin = await prisma.users.findUnique({
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

    if (!admin) {
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
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          message: '无效的认证令牌',
          status: 401,
        },
      });
    }

    console.error('获取管理员信息失败:', error);
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
