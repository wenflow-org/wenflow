import { Request, Response, NextFunction } from 'express';

export const generateCsrfToken = (): string => {
  return require('crypto').randomBytes(32).toString('hex');
};

export const csrfMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map(o => o.trim()) || 
    ['http://localhost:5173', 'http://localhost:3000'];
  
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({
        success: false,
        error: { message: '请求来源不被允许' }
      });
    }
    
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
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