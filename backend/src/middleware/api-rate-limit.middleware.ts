import rateLimit from 'express-rate-limit';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message?: string;
};

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
  windowMs: 15 * 60 * 1000,
  max: 1200,
  message: buildRateLimitMessage('请求过于频繁，请稍后重试'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/admin/'),
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
