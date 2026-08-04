import { Request, Response, NextFunction } from 'express';

interface LoginAttempt {
  timestamp: Date;
}

export type LoginRateLimitScope = 'user' | 'admin';

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_ATTEMPTS = parsePositiveInteger(process.env.LOGIN_MAX_ATTEMPTS, 5);
const configuredLockDurationSeconds = process.env.LOGIN_LOCK_DURATION_SECONDS;
const legacyLockDuration = process.env.LOGIN_LOCK_DURATION;
const parsedLegacyLockDuration = parsePositiveInteger(legacyLockDuration, 0);
const LOCK_DURATION_SECONDS = configuredLockDurationSeconds
  ? parsePositiveInteger(configuredLockDurationSeconds, 900)
  : parsedLegacyLockDuration > 0
    ? (parsedLegacyLockDuration > 86_400 ? Math.ceil(parsedLegacyLockDuration / 1000) : parsedLegacyLockDuration)
    : 900;
const LOCK_DURATION_MS = LOCK_DURATION_SECONDS * 1000;
const MAX_RECORDED_ATTEMPTS = Math.max(20, MAX_ATTEMPTS);

const loginAttempts: Map<string, LoginAttempt[]> = new Map();

const buildLoginAttemptKey = (scope: LoginRateLimitScope, username: string, ip: string): string =>
  `${scope}:${username}:${ip}`;

const createLoginRateLimitMiddleware = (scope: LoginRateLimitScope) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const clientIP = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();
  const key = buildLoginAttemptKey(scope, name, clientIP);
  
  const attempts = loginAttempts.get(key) || [];
  const recentFailures = attempts.filter(
    attempt => Date.now() - attempt.timestamp.getTime() < LOCK_DURATION_MS
  );
  
  if (recentFailures.length >= MAX_ATTEMPTS) {
    const lastAttempt = recentFailures[recentFailures.length - 1];
    const remainingTime = Math.ceil(
      (LOCK_DURATION_MS - (Date.now() - lastAttempt.timestamp.getTime())) / 1000
    );
    
    return res.status(429).json({
      success: false,
      error: {
        message: `登录失败次数过多，请 ${remainingTime} 秒后重试`,
        code: 'ACCOUNT_LOCKED',
        remainingTime
      }
    });
  }
  
  next();
};

export const loginRateLimitMiddleware = createLoginRateLimitMiddleware('user');
export const adminLoginRateLimitMiddleware = createLoginRateLimitMiddleware('admin');

export const recordLoginAttempt = (
  username: string,
  ip: string,
  success: boolean,
  scope: LoginRateLimitScope = 'user'
) => {
  const key = buildLoginAttemptKey(scope, username, ip);

  if (success) {
    loginAttempts.delete(key);
    return;
  }

  const attempts = loginAttempts.get(key) || [];
  
  attempts.push({
    timestamp: new Date()
  });
  
  if (attempts.length > MAX_RECORDED_ATTEMPTS) {
    attempts.splice(0, attempts.length - MAX_RECORDED_ATTEMPTS);
  }
  
  loginAttempts.set(key, attempts);
};

export const resetLoginAttemptsForTests = () => {
  loginAttempts.clear();
};
