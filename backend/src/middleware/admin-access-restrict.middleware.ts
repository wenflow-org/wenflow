import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { isAlwaysBlockedAddress, isLocalOrPrivateAddress } from '../utils/safe-http';
import { getRuntimeNetworkPolicy } from '../services/runtime-network-policy.service';

function normalizeClientIp(value: string): string {
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  const mapped = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  return mapped || trimmed;
}

export const adminAccessRestrictMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const policy = getRuntimeNetworkPolicy();
  const accessMode = policy.adminAccessMode;
  if (accessMode === 'any') {
    return next();
  }

  // Express 会根据 app.set('trust proxy') 计算 req.ip；这里不直接信任客户端 Header。
  const clientIP = normalizeClientIp(req.ip || req.socket?.remoteAddress || req.connection.remoteAddress || '');
  const explicitlyAllowed = new Set(policy.adminAllowedIps.map(normalizeClientIp)).has(clientIP);
  const isLoopback = clientIP === '127.0.0.1' || clientIP === '::1';
  const isPrivate = isLocalOrPrivateAddress(clientIP) && !isAlwaysBlockedAddress(clientIP);
  const isAllowed = explicitlyAllowed
    || (accessMode === 'loopback' ? isLoopback : isPrivate);
  
  if (!isAllowed) {
    logger.warn(`[Admin访问拦截] IP: ${clientIP} 尝试访问管理后台被拒绝 (mode=${accessMode})`);
    return res.status(403).json({
      success: false,
      error: {
        message: accessMode === 'loopback'
          ? '管理员接口仅允许本机访问'
          : '管理员接口仅允许本机或局域网访问',
        code: 'ADMIN_NETWORK_RESTRICTED'
      }
    });
  }
  
  next();
};
