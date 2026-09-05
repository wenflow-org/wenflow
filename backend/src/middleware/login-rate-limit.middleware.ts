import { Request, Response, NextFunction } from 'express';

// 延迟加载 prisma/logger：config/database 与 utils/logger 在模块求值期会触发 dotenv 加载，
// 若静态导入，dotenv 副作用会先于下方限速配置常量求值，把 .env 中的 LOGIN_* 复活并覆盖
// 测试注入的环境变量（jest.resetModules 后会重新求值）。运行期才加载真实依赖，互不干扰。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadPrisma = () => (require('../config/database') as typeof import('../config/database')).default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadLogger = () => (require('../utils/logger') as typeof import('../utils/logger')).logger;

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

    // 登录审计：锁定拒绝同样落库（success=false, reason=ACCOUNT_LOCKED）
    persistLoginAttempt(name, clientIP, false, scope, 'ACCOUNT_LOCKED');

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

/**
 * 登录审计落库（fire-and-forget）：user/admin 双 scope 全覆盖，调用点零改动。
 * 写库失败仅告警，绝不影响登录主流程与内存限速逻辑。
 */
const persistLoginAttempt = (
  username: string,
  ip: string,
  success: boolean,
  scope: LoginRateLimitScope,
  reason?: string
) => {
  const prisma = loadPrisma();
  const logger = loadLogger();
  // 兼容 mock/无返回值调用场景：确保 .catch 链始终可用
  Promise.resolve(prisma.login_attempts.create({
    data: {
      scope,
      username,
      ip: ip || null,
      success,
      reason: reason ?? null,
      userId: null
    }
  })).catch((error) => {
    logger.warn('[login-audit] 登录审计写入失败', {
      error: error instanceof Error ? error.message : String(error),
      scope,
      username
    });
  });
};

export const recordLoginAttempt = (
  username: string,
  ip: string,
  success: boolean,
  scope: LoginRateLimitScope = 'user',
  reason: string | null = null
) => {
  // G3：用户名作为 Map key 使用，截断超长输入防止内存滥用
  const safeUsername = username.slice(0, 64);

  // 登录审计：成功与失败均落库（schema 层用户名上限 64，与 Map key 截断一致）
  persistLoginAttempt(safeUsername, ip, success, scope, reason ?? undefined);

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
