// 认证路由
import express from 'express';
import { z } from 'zod';
import authService from '../services/auth/auth.service';
import { getPlatformSettings } from '../services/platform-settings.service';
import { loginRateLimitMiddleware, recordLoginAttempt } from '../middleware/login-rate-limit.middleware';

const router = express.Router();

// 注册状态（公开）
router.get('/registration-status', async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    res.status(200).json({
      success: true,
      data: {
        registrationEnabled: settings.registrationEnabled
      }
    });
  } catch (error: any) {
    next(error);
  }
});

// 验证 schema
const registerSchema = z.object({
  name: z.string().min(2, '用户名至少 2 位'),
  password: z.string()
    .min(8, '密码至少 8 位')
    .regex(/[a-zA-Z]/, '密码必须包含字母')
    .regex(/[0-9]/, '密码必须包含数字'),
});

const loginSchema = z.object({
  name: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空')
});

// 注册
router.post('/register', async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    if (!settings.registrationEnabled) {
      return res.status(403).json({
        success: false,
        error: {
          message: '平台注册已关闭，请联系管理员',
          status: 403
        }
      });
    }

    // 验证请求数据
    const data = registerSchema.parse(req.body) as { name: string; password: string };

    // 调用服务
    const result = await authService.register(data);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          message: '数据验证失败',
          details: error.errors
        }
      });
    }

    next(error);
  }
});

// 登录
router.post('/login', loginRateLimitMiddleware, async (req, res, next) => {
  try {
    // 验证请求数据
    const data = loginSchema.parse(req.body) as { name: string; password: string };
    const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    // 调用服务
    const result = await authService.login(data);
    
    recordLoginAttempt(data.name, clientIP.toString(), true);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          message: '数据验证失败',
          details: error.errors
        }
      });
    }
    
    const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    recordLoginAttempt(req.body.name, clientIP.toString(), false);

    next(error);
  }
});

// 验证 Token (protected endpoint)
router.post('/verify', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: { message: 'Token 不能为空' }
      });
    }

    const user = await authService.verifyToken(token);

    res.status(200).json({
      success: true,
      data: { user }
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;