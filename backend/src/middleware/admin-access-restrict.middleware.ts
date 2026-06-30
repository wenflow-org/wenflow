import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const adminAccessRestrictMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // 读取环境变量配置，默认为 true（仅本地访问）
  const localhostOnly = process.env.ADMIN_LOCALHOST_ONLY !== 'false';
  
  // 如果未启用本地限制，直接放行
  if (!localhostOnly) {
    logger.info('[Admin访问控制] 已关闭本地访问限制');
    return next();
  }
  
  // 获取客户端 IP
  // 如果启用了 trust proxy，优先使用 X-Forwarded-For
  const trustProxy = process.env.TRUST_PROXY === '1';
  let clientIP: string;
  
  if (trustProxy && req.headers['x-forwarded-for']) {
    // 从 X-Forwarded-For 获取真实 IP（取第一个）
    clientIP = (req.headers['x-forwarded-for'] as string).split(',')[0].trim();
  } else {
    // 使用 Express 的 req.ip
    clientIP = req.ip || req.connection.remoteAddress || '';
  }
  
  // 本地 IP 白名单
  const allowedIPs = [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'localhost'
  ];
  
  const isAllowed = allowedIPs.includes(clientIP);
  
  if (!isAllowed) {
    logger.warn(`[Admin访问拦截] IP: ${clientIP} 尝试访问管理后台被拒绝 (trust_proxy=${trustProxy})`);
    return res.status(403).json({
      success: false,
      error: {
        message: '管理员登录仅限本地访问，如需远程访问请在服务器 .env 文件中设置 ADMIN_LOCALHOST_ONLY=false',
        code: 'ADMIN_LOCALHOST_ONLY'
      }
    });
  }
  
  next();
};