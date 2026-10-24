import rateLimit from 'express-rate-limit';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message?: string;
};

type RateLimitRequestLike = { method: string; path: string };

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const OPERATIONAL_PATHS = new Set(['/health', '/livez', '/readyz']);

/** 读请求与写请求分开计额度：读接口打满时不能顺手把发言/提交也锁死。 */
export function isWriteRequest(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

export function shouldSkipGlobalApiLimit(req: RateLimitRequestLike): boolean {
  return (
    req.method.toUpperCase() === 'OPTIONS'
    || isWriteRequest(req.method)
    || req.path.startsWith('/admin/')
    || OPERATIONAL_PATHS.has(req.path)
  );
}

export function shouldSkipWriteApiLimit(req: RateLimitRequestLike): boolean {
  return (
    req.method.toUpperCase() === 'OPTIONS'
    || !isWriteRequest(req.method)
    || req.path.startsWith('/admin/')
    || OPERATIONAL_PATHS.has(req.path)
  );
}

/**
 * 读额度：15 分钟 6000 次（旧全局限流 1200 次的 5 倍）。
 * 单页首屏约 7-20 个只读请求，6000 足够覆盖正常浏览与课堂恢复；
 * 写请求不占这份额度（见 writeApiLimiter）。
 */
export const GLOBAL_API_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 6000,
} as const;

/** 写额度：15 分钟 1200 次，与旧全局上限持平，但不再被读请求消耗。 */
export const WRITE_API_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 1200,
} as const;

function buildRateLimitMessage(message?: string) {
  return {
    success: false,
    error: {
      message: message || '请求过于频繁，请稍后重试'
    }
  };
}

export function createApiRateLimiter(options: RateLimitOptions) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: buildRateLimitMessage(options.message),
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * 全局限流（用户端 /api/*，不含 /api/admin/*）：
 * admin 控制台单页加载会批量发起 10-20 个只读请求（列表/统计/状态/徽章），
 * 与用户端请求共享同一 IP 额度时，管理员高频操作或回归测试容易撞满 1200 上限，
 * 导致整页「控制台数据加载失败」。admin API 由 adminApiLimiter 单独管理。
 */
export const globalApiLimiter = rateLimit({
  ...GLOBAL_API_RATE_LIMIT,
  message: buildRateLimitMessage('请求过于频繁，请稍后重试'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipGlobalApiLimit,
});

/**
 * 写请求专属限流：与读额度分离，避免学习台/课堂恢复的只读流量把发言、提交、
 * 结束课堂等写操作一起打满。admin 与健康检查同样不占用户写额度。
 */
export const writeApiLimiter = rateLimit({
  ...WRITE_API_RATE_LIMIT,
  message: buildRateLimitMessage('操作过于频繁，请稍后重试'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipWriteApiLimit,
});

/**
 * admin API 专属限流：额度为全局限流的 5 倍，容纳管理台密集的页面级只读请求。
 * 位于 auth 中间件之前（拿不到 req.user），按 IP 维度计数；
 * 单个管理员的日常高频操作与全站爬虫/滥用流量解耦。
 */
export const adminApiLimiter = createApiRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 6000,
  message: '请求过于频繁，请稍后重试'
});

export const learningPathsPollingLimiter = createApiRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3600,
  message: '学习路径状态请求过于频繁，请稍后重试'
});
