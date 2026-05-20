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

export const globalApiLimiter = createApiRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  message: '请求过于频繁，请稍后重试'
});

export const learningPathsPollingLimiter = createApiRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3600,
  message: '学习路径状态请求过于频繁，请稍后重试'
});
