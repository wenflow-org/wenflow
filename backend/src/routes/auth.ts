// 认证路由
import express from 'express';
import { z } from 'zod';
import authService, { InvalidCredentialsError, ResetTokenInvalidError, UsernameTakenError } from '../services/auth/auth.service';
import { getPlatformSettings } from '../services/platform-settings.service';
import { loginRateLimitMiddleware, recordLoginAttempt } from '../middleware/login-rate-limit.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { setAuthCookie, clearAuthCookie } from '../utils/auth-cookie';
import { aiCapabilityHealthService } from '../services/ai-capability-health.service';
import { logger } from '../utils/logger';

const router = express.Router();

// ---- 注册限速（G1）：注册为公开端点，按 IP 维度限速，缓解用户名枚举扫描与批量注册 ----
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 10;
const registerAttemptsByIp: Map<string, Date[]> = new Map();

const isRegisterRateLimited = (ip: string): number => {
  const now = Date.now();
  const attempts = (registerAttemptsByIp.get(ip) || []).filter(
    (timestamp) => now - timestamp.getTime() < REGISTER_WINDOW_MS
  );
  registerAttemptsByIp.set(ip, attempts);

  if (attempts.length >= REGISTER_MAX_ATTEMPTS) {
    const last = attempts[attempts.length - 1];
    return Math.max(1, Math.ceil((REGISTER_WINDOW_MS - (now - last.getTime())) / 1000));
  }

  return 0;
};

const recordRegisterAttempt = (ip: string, success: boolean) => {
  if (success) {
    registerAttemptsByIp.delete(ip);
    return;
  }

  const attempts = registerAttemptsByIp.get(ip) || [];
  attempts.push(new Date());
  registerAttemptsByIp.set(ip, attempts);
};

// ---- 通用端点限速（按 IP）：change-password / verify 等敏感端点防暴力与滥用 ----
function createIpLimiter(maxAttempts: number, windowMs: number) {
  const attemptsByIp = new Map<string, Date[]>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();
    const now = Date.now();
    const attempts = (attemptsByIp.get(ip) || []).filter(
      (timestamp) => now - timestamp.getTime() < windowMs
    );
    attemptsByIp.set(ip, attempts);

    if (attempts.length >= maxAttempts) {
      const last = attempts[attempts.length - 1];
      const remainingSeconds = Math.max(1, Math.ceil((windowMs - (now - last.getTime())) / 1000));
      return res.status(429).json({
        success: false,
        error: {
          message: `操作过于频繁，请 ${remainingSeconds} 秒后重试`,
          code: 'RATE_LIMITED',
          status: 429
        }
      });
    }

    attempts.push(new Date());
    attemptsByIp.set(ip, attempts);
    next();
  };
}

// 改密 30 次/小时/IP；verify 120 次/小时/IP
const changePasswordLimiter = createIpLimiter(30, 60 * 60 * 1000);
const verifyLimiter = createIpLimiter(120, 60 * 60 * 1000);
// 忘记密码 10 次/小时/IP（防枚举扫描）；重置 20 次/小时/IP
const forgotPasswordLimiter = createIpLimiter(10, 60 * 60 * 1000);
const resetPasswordLimiter = createIpLimiter(20, 60 * 60 * 1000);

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
// 用户名白名单：Unicode 字母/数字/下划线/连字符（禁止控制字符与 HTML 注入面）
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;
const registerSchema = z.object({
  name: z.string()
    .min(2, '用户名至少 2 位')
    .max(64, '用户名最长 64 位')
    .regex(USERNAME_PATTERN, '用户名仅支持字母、数字、下划线和连字符'),
  password: z.string()
    .min(8, '密码至少 8 位')
    .max(1024, '密码最长 1024 位')
    .regex(/[a-zA-Z]/, '密码必须包含字母')
    .regex(/[0-9]/, '密码必须包含数字'),
});

const loginSchema = z.object({
  name: z.string().min(1, '用户名不能为空').max(64, '用户名最长 64 位'),
  password: z.string().min(1, '密码不能为空').max(1024, '密码最长 1024 位')
});

// 注册
router.post('/register', async (req, res, next) => {
  let clientIP = 'unknown';

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

    // 注册限速：防止用户名枚举与批量注册（G1）
    clientIP = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();
    const remainingSeconds = isRegisterRateLimited(clientIP);
    if (remainingSeconds > 0) {
      return res.status(429).json({
        success: false,
        error: {
          message: `注册尝试过于频繁，请 ${remainingSeconds} 秒后重试`,
          code: 'REGISTER_RATE_LIMITED',
          status: 429
        }
      });
    }

    // 验证请求数据
    const data = registerSchema.parse(req.body) as { name: string; password: string };

    // 调用服务
    const result = await authService.register(data);

    recordRegisterAttempt(clientIP, true);

    // 同步写入 HttpOnly Cookie（前端不再需要将 token 存入 localStorage）
    // 安全加固：token 仅经 Cookie 下发，响应体不再返回（消除 JS 内存可窃取面）
    const { token, ...safeResult } = result;
    setAuthCookie(res, token, 'user');

    res.status(201).json({
      success: true,
      data: safeResult
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

    // 用户名冲突以 409 返回（统一业务错误码，消除 500/201 的枚举差异）
    if (error instanceof UsernameTakenError) {
      return res.status(409).json({
        success: false,
        error: {
          message: error.message,
          code: error.code,
          status: error.status
        }
      });
    }

    recordRegisterAttempt(clientIP, false);
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

    // 同步写入 HttpOnly Cookie；token 仅经 Cookie 下发，响应体不再返回
    const { token, ...safeResult } = result;
    setAuthCookie(res, token, 'user');

    res.status(200).json({
      success: true,
      data: safeResult
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

router.post('/change-password', authMiddleware, changePasswordLimiter, async (req: any, res, next) => {
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
router.post('/verify', verifyLimiter, async (req, res, next) => {
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

// 忘记密码：提交用户名，若存在则生成重置令牌并发送（统一响应防枚举）
router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 64) {
      return res.status(400).json({
        success: false,
        error: { message: '请输入正确的用户名' }
      });
    }

    await authService.requestPasswordReset(name);

    res.status(200).json({
      success: true,
      data: {
        message: '如果该用户名存在，重置链接已发送（当前开发环境请在后端日志中查看）'
      }
    });
  } catch (error: any) {
    logger.error('申请密码重置失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '申请密码重置失败，请稍后重试' }
    });
  }
});

// 重置密码：携带一次性令牌 + 新密码
router.post('/reset-password', resetPasswordLimiter, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      return res.status(400).json({
        success: false,
        error: { message: '重置令牌不能为空' }
      });
    }

    const data = changePasswordSchema.pick({ newPassword: true }).parse(req.body);
    await authService.resetPassword(token, data.newPassword);

    res.status(200).json({
      success: true,
      data: { message: '密码已重置，请使用新密码登录' }
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }
    if (error instanceof ResetTokenInvalidError) {
      return res.status(400).json({
        success: false,
        error: { message: error.message, code: error.code, status: error.status }
      });
    }
    logger.error('重置密码失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '重置密码失败，请稍后重试' }
    });
  }
});

export default router;
