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

// 全局每 IP 限速：同一来源 IP 在锁定窗口内的累计失败次数上限（独立于账号维度）
const IP_MAX_ATTEMPTS = parsePositiveInteger(process.env.LOGIN_IP_MAX_ATTEMPTS, 30);
// 账号级累计限速：同一账号跨 IP 在锁定窗口内的累计失败次数上限（独立于来源维度）
const ACCOUNT_MAX_ATTEMPTS = parsePositiveInteger(process.env.LOGIN_ACCOUNT_MAX_ATTEMPTS, 10);
const MAX_RECORDED_IP_ATTEMPTS = Math.max(20, IP_MAX_ATTEMPTS + 10);
const MAX_RECORDED_ACCOUNT_ATTEMPTS = Math.max(20, ACCOUNT_MAX_ATTEMPTS + 10);

const loginAttempts: Map<string, LoginAttempt[]> = new Map();
const ipLoginAttempts: Map<string, LoginAttempt[]> = new Map();
const accountLoginAttempts: Map<string, LoginAttempt[]> = new Map();

let mutationCount = 0;
const SWEEP_INTERVAL = 512;

// 惰性清理：过期条目在读取时过滤，Map 增长到一定规模后整体清扫一次
const sweepExpiredAttempts = () => {
  const now = Date.now();
  for (const map of [loginAttempts, ipLoginAttempts, accountLoginAttempts]) {
    for (const [key, attempts] of map) {
      const active = attempts.filter(attempt => now - attempt.timestamp.getTime() < LOCK_DURATION_MS);
      if (active.length === 0) {
        map.delete(key);
      } else if (active.length !== attempts.length) {
        map.set(key, active);
      }
    }
  }
};

const recordFailure = (map: Map<string, LoginAttempt[]>, key: string, maxRecorded: number) => {
  const attempts = map.get(key) || [];

  attempts.push({
    timestamp: new Date()
  });

  if (attempts.length > maxRecorded) {
    attempts.splice(0, attempts.length - maxRecorded);
  }

  map.set(key, attempts);

  mutationCount += 1;
  if (mutationCount >= SWEEP_INTERVAL) {
    mutationCount = 0;
    sweepExpiredAttempts();
  }
};

const buildLoginAttemptKey = (scope: LoginRateLimitScope, username: string, ip: string): string =>
  `${scope}:${username}:${ip}`;

interface BlockCheck {
  blocked: boolean;
  remainingTime: number;
}

const checkBlock = (attempts: LoginAttempt[], maxAttempts: number): BlockCheck => {
  const recentFailures = attempts.filter(
    attempt => Date.now() - attempt.timestamp.getTime() < LOCK_DURATION_MS
  );

  if (recentFailures.length < maxAttempts) {
    return { blocked: false, remainingTime: 0 };
  }

  const lastAttempt = recentFailures[recentFailures.length - 1];
  const remainingTime = Math.ceil(
    (LOCK_DURATION_MS - (Date.now() - lastAttempt.timestamp.getTime())) / 1000
  );

  return { blocked: true, remainingTime };
};

const createLoginRateLimitMiddleware = (scope: LoginRateLimitScope) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // G3：用户名会作为内存 Map 的 key，截断超长输入防止内存滥用（schema 层另有 max(64) 校验）
  const name = (typeof req.body?.name === 'string' ? req.body.name : '').slice(0, 64);
  const clientIP = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();
  const key = buildLoginAttemptKey(scope, name, clientIP);
  const ipKey = `${scope}:ip:${clientIP}`;
  const accountKey = `${scope}:account:${name}`;

  const blocking = [
    checkBlock(loginAttempts.get(key) || [], MAX_ATTEMPTS),
    checkBlock(ipLoginAttempts.get(ipKey) || [], IP_MAX_ATTEMPTS),
    checkBlock(accountLoginAttempts.get(accountKey) || [], ACCOUNT_MAX_ATTEMPTS),
  ].filter(check => check.blocked);

  if (blocking.length > 0) {
    const remainingTime = Math.max(...blocking.map(check => check.remainingTime));

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
  // G3：用户名作为 Map key 使用，截断超长输入防止内存滥用
  const safeUsername = username.slice(0, 64);
  const key = buildLoginAttemptKey(scope, safeUsername, ip);
  const ipKey = `${scope}:ip:${ip}`;
  const accountKey = `${scope}:account:${safeUsername}`;

  if (success) {
    loginAttempts.delete(key);
    accountLoginAttempts.delete(accountKey);
    return;
  }

  recordFailure(loginAttempts, key, MAX_RECORDED_ATTEMPTS);
  recordFailure(ipLoginAttempts, ipKey, MAX_RECORDED_IP_ATTEMPTS);
  recordFailure(accountLoginAttempts, accountKey, MAX_RECORDED_ACCOUNT_ATTEMPTS);
};

export const resetLoginAttemptsForTests = () => {
  loginAttempts.clear();
  ipLoginAttempts.clear();
  accountLoginAttempts.clear();
};
