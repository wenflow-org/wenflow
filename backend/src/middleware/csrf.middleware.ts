import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { parseAllowedOrigins } from '../config/allowed-origins';

const normalizeOrigin = (value?: string): string => {
  if (!value) {
    return '';
  }

  return value.trim().replace(/\/$/, '');
};

export const generateCsrfToken = (): string => {
  return randomBytes(32).toString('hex');
};

/** CSRF 拦截的原因码（对外 message 保持不变，对内日志可归因——2026-10-22 机械过滤审计 A 类） */
const rejectCsrf = (res: Response, req: Request, reason: string, detail: Record<string, unknown> & { message: string }): Response => {
  logger.warn('[csrf] 写请求来源校验拒绝', { reason, path: req.path, ...detail });
  return res.status(403).json({
    success: false,
    error: { message: detail.message }
  });
};

export const csrfMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // 无 Cookie 的写请求（服务端内部自调用，如黑盒仿真平台适配器）不携带会话，
  // 浏览器侧无法凭表单伪造这类请求，天然无 CSRF 风险，跳过来源校验。
  if (!req.headers.cookie) {
    next();
    return;
  }

  const origin = normalizeOrigin(req.headers.origin);
  const referer = req.headers.referer;
  // 2026-10-22 单源化：默认清单与解析逻辑收口 config/allowed-origins（此前与 http-app 的 CORS
  // 默认清单不同步——CORS 放行 127.0.0.1:5173 而 CSRF 拒绝，同一请求预检过、写请求被拦）。
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    if (!origin && !referer) {
      return rejectCsrf(res, req, 'missing_origin_and_referer', { message: '缺少请求来源信息' });
    }

    if (origin && !allowedOrigins.includes(origin)) {
      return rejectCsrf(res, req, 'origin_not_allowed', { message: '请求来源不被允许', origin, allowedOrigins });
    }

    if (referer) {
      try {
        const refererOrigin = normalizeOrigin(new URL(referer).origin);
        if (!allowedOrigins.includes(refererOrigin)) {
          return rejectCsrf(res, req, 'referer_origin_not_allowed', { message: '请求来源不被允许', refererOrigin, allowedOrigins });
        }
      } catch {
        return rejectCsrf(res, req, 'invalid_referer', { message: '无效的请求来源', referer });
      }
    }
  }

  next();
};
