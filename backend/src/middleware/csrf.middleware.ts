import { Request, Response, NextFunction } from 'express';

const normalizeOrigin = (value?: string): string => {
  if (!value) {
    return '';
  }

  return value.trim().replace(/\/$/, '');
};

export const generateCsrfToken = (): string => {
  return require('crypto').randomBytes(32).toString('hex');
};

export const csrfMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
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
