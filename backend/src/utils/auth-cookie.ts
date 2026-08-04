// 认证 Cookie 工具：将 JWT 放入 HttpOnly Cookie，避免前端 JS 可读
import { Request, Response } from 'express';
import { SessionTokenType } from './session-token';

export const USER_AUTH_COOKIE = 'wenflow_token';
export const ADMIN_AUTH_COOKIE = 'wenflow_admin_token';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const isSecureContext = () => process.env.NODE_ENV === 'production';

export const getAuthCookieName = (type: SessionTokenType): string =>
  type === 'admin' ? ADMIN_AUTH_COOKIE : USER_AUTH_COOKIE;

/**
 * 写入认证 Cookie。
 * @param maxAgeMs 传入 null 表示会话 Cookie（浏览器关闭即失效，用于"不记住登录"场景）
 */
export function setAuthCookie(
  res: Response,
  token: string,
  type: SessionTokenType,
  maxAgeMs: number | null = SEVEN_DAYS_MS
): void {
  res.cookie(getAuthCookieName(type), token, {
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: 'strict',
    path: '/',
    ...(maxAgeMs === null ? {} : { maxAge: maxAgeMs })
  });
}

export function clearAuthCookie(res: Response, type: SessionTokenType): void {
  res.clearCookie(getAuthCookieName(type), {
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: 'strict',
    path: '/'
  });
}

/** 从请求中解析认证 Token：优先 Authorization Bearer，回退 HttpOnly Cookie */
export function resolveAuthToken(req: Request, type: SessionTokenType): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  const cookieToken = req.cookies?.[getAuthCookieName(type)];
  return typeof cookieToken === 'string' && cookieToken ? cookieToken : undefined;
}
