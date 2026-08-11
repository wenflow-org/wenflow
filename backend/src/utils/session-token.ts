import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';

export type SessionTokenType = 'user' | 'admin';

export const SESSION_TOKEN_ISSUER = 'wenflow';
export const USER_TOKEN_AUDIENCE = 'wenflow:user';
export const ADMIN_TOKEN_AUDIENCE = 'wenflow:admin';

export interface SessionTokenPayload extends JwtPayload {
  userId: string;
  name?: string;
  email?: string;
  isAdmin?: boolean;
  type?: SessionTokenType;
  // P2 会话管理：签发时由调用方传入随机 UUID，用于 admin_sessions 表关联与吊销
  jti?: string;
  // 用户域令牌吊销版本：改密/管理员重置密码时递增，旧 token 校验不通过
  tokenVersion?: number;
}

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET 环境变量未配置');
  }
  return secret;
};

const getAudience = (type: SessionTokenType) => (
  type === 'admin' ? ADMIN_TOKEN_AUDIENCE : USER_TOKEN_AUDIENCE
);

export const signSessionToken = (
  payload: Omit<SessionTokenPayload, 'type'>,
  type: SessionTokenType,
  expiresIn: SignOptions['expiresIn']
): string => jwt.sign(
  { ...payload, type },
  getJwtSecret(),
  {
    algorithm: 'HS256',
    expiresIn,
    issuer: SESSION_TOKEN_ISSUER,
    audience: getAudience(type)
  }
);

const validateTokenDomain = (
  payload: SessionTokenPayload,
  expectedType: SessionTokenType,
  legacy: boolean
): SessionTokenPayload => {
  if (!payload.userId) {
    throw new jwt.JsonWebTokenError('JWT 缺少用户身份');
  }

  if (legacy) {
    const isLegacyAdmin = payload.isAdmin === true;
    if ((expectedType === 'admin') !== isLegacyAdmin) {
      throw new jwt.JsonWebTokenError('JWT 会话域不匹配');
    }
    return payload;
  }

  if (payload.type !== expectedType) {
    throw new jwt.JsonWebTokenError('JWT 会话域不匹配');
  }
  if (expectedType === 'admin' && payload.isAdmin !== true) {
    throw new jwt.JsonWebTokenError('JWT 管理员声明无效');
  }
  if (expectedType === 'user' && payload.isAdmin === true) {
    throw new jwt.JsonWebTokenError('JWT 用户声明无效');
  }

  return payload;
};

export const verifySessionToken = (
  token: string,
  expectedType: SessionTokenType
): SessionTokenPayload => {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: SESSION_TOKEN_ISSUER,
      audience: getAudience(expectedType)
    }) as SessionTokenPayload;
    return validateTokenDomain(payload, expectedType, false);
  } catch (strictError) {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256']
    }) as SessionTokenPayload;

    // 新格式 Token 不能通过旧格式兼容路径绕过 issuer/audience/type 校验。
    if (payload.type !== undefined || payload.iss !== undefined || payload.aud !== undefined) {
      throw strictError;
    }

    return validateTokenDomain(payload, expectedType, true);
  }
};
