// 认证路由
import express from 'express';
import { z } from 'zod';
import authService, { InvalidCredentialsError } from '../services/auth/auth.service';
import { getPlatformSettings } from '../services/platform-settings.service';
import { loginRateLimitMiddleware, recordLoginAttempt } from '../middleware/login-rate-limit.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { setAuthCookie, clearAuthCookie } from '../utils/auth-cookie';
import { aiCapabilityHealthService } from '../services/ai-capability-health.service';

const router = express.Router();

// 注册状态（公开）
router.get('/registration-status', async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    const coreLearningBlocked = aiCapabilityHealthService.isCapabilityBlocked('goal-conversation');
    res.status(200).json({
      success: true,
      data: {
        registrationEnabled: settings.registrationEnabled && !coreLearningBlocked,
        configuredRegistrationEnabled: settings.registrationEnabled,
        temporaryUnavailable: settings.registrationEnabled && coreLearningBlocked
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
    const coreLearningBlocked = aiCapabilityHealthService.isCapabilityBlocked('goal-conversation');
    if (!settings.registrationEnabled || coreLearningBlocked) {
      const temporaryUnavailable = settings.registrationEnabled && coreLearningBlocked;
      return res.status(temporaryUnavailable ? 503 : 403).json({
        success: false,
        error: {
          message: temporaryUnavailable
            ? '核心学习服务正在恢复，暂时无法创建账号'
            : '平台注册已关闭，请联系管理员',
          code: temporaryUnavailable ? 'REGISTRATION_TEMPORARILY_UNAVAILABLE' : 'REGISTRATION_DISABLED',
          status: temporaryUnavailable ? 503 : 403
        }
      });
    }

    // 验证请求数据
    const data = registerSchema.parse(req.body) as { name: string; password: string };

    // 调用服务
    const result = await authService.register(data);

    // 同步写入 HttpOnly Cookie（前端不再需要将 token 存入 localStorage）
    setAuthCookie(res, result.token, 'user');

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
  let loginName: string | undefined;

  try {
    // 验证请求数据
    const data = loginSchema.parse(req.body) as { name: string; password: string };
    loginName = data.name;
    const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    // 调用服务
    const result = await authService.login(data);

    recordLoginAttempt(data.name, clientIP.toString(), true);

    // 同步写入 HttpOnly Cookie（前端不再需要将 token 存入 localStorage）
    setAuthCookie(res, result.token, 'user');

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

    if (error instanceof InvalidCredentialsError && loginName) {
      const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      recordLoginAttempt(loginName, clientIP.toString(), false);
      return res.status(401).json({
        success: false,
        error: {
          message: '用户名或密码错误',
          code: error.code,
          status: error.status
        }
      });
    }

    next(error);
  }
});

// 登出：清除 HttpOnly 认证 Cookie
router.post('/logout', (req, res) => {
  clearAuthCookie(res, 'user');
  res.status(200).json({
    success: true,
    data: { message: '已退出登录' }
  });
});

// 修改密码（登录态，需验证当前密码）
const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: z.string()
    .min(8, '新密码至少 8 位')
    .regex(/[a-zA-Z]/, '新密码必须包含字母')
    .regex(/[0-9]/, '新密码必须包含数字'),
});

router.post('/change-password', authMiddleware, async (req: any, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: '未登录' } });
    }

    const data = changePasswordSchema.parse(req.body);
    await authService.changePassword(userId, data.oldPassword, data.newPassword);

    res.status(200).json({
      success: true,
      data: { message: '密码已更新' }
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
    if (error instanceof InvalidCredentialsError) {
      // 注意：这里不能返回 401——前端拦截器会把任何 401 当作会话失效强制登出。
      // 当前密码错误是业务校验失败，用 400 表达。
      return res.status(400).json({
        success: false,
        error: {
          message: '当前密码不正确',
          code: 'PASSWORD_MISMATCH',
          status: 400
        }
      });
    }
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
