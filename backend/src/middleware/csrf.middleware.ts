import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

const normalizeOrigin = (value?: string): string => {
  if (!value) {
    return '';
  }

  return value.trim().replace(/\/$/, '');
};

export const generateCsrfToken = (): string => {
  return randomBytes(32).toString('hex');
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
  const allowedOrigins = (process.env.CORS_ORIGIN?.split(',') ||
    ['http://localhost:5173', 'http://localhost:3000'])
    .map(o => normalizeOrigin(o))
    .filter(Boolean);
  
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    if (!origin && !referer) {
      return res.status(403).json({
        success: false,
        error: { message: '缺少请求来源信息' }
      });
    }

    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({
        success: false,
        error: { message: '请求来源不被允许' }
      });
    }
    
    if (referer) {
      try {
        const refererOrigin = normalizeOrigin(new URL(referer).origin);
        if (!allowedOrigins.includes(refererOrigin)) {
          return res.status(403).json({
            success: false,
            error: { message: '请求来源不被允许' }
          });
        }
      } catch {
        return res.status(403).json({
          success: false,
          error: { message: '无效的请求来源' }
        });
      }
    }
  }
  
  next();
};
