import { Request, Response, NextFunction } from 'express';

export const adminAccessRestrictMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const clientIP = req.ip || 
                   (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
                   req.connection.remoteAddress;
  
  const allowedIPs = [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'localhost'
  ];
  
  const isAllowed = allowedIPs.includes(clientIP?.toString() || '');
  
  if (!isAllowed) {
    console.warn(`[Admin访问拦截] IP: ${clientIP} 尝试访问管理后台被拒绝`);
    return res.status(403).json({
      success: false,
      error: {
        message: '管理员登录仅限本地访问',
        code: 'ADMIN_LOCALHOST_ONLY'
      }
    });
  }
  
  next();
};