/**
 * Express 应用骨架装配（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：创建 app、安全中间件（helmet CSP / 自定义安全头 / CORS / CSRF / 双通道限流）、
 * 请求解析与日志、健康检查端点（/health /livez /readyz）。
 * 路由与错误处理分别由 routers.ts / registerErrorHandlers 注册。
 */
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { logger } from '../utils/logger';
import { resolveTrustProxySetting } from '../utils/trust-proxy';
import { adminApiLimiter, globalApiLimiter } from '../middleware/api-rate-limit.middleware';
import { csrfMiddleware } from '../middleware/csrf.middleware';
import type { ApplicationLifecycle } from '../services/application-lifecycle.service';
import type { ReadinessService } from '../services/readiness.service';

/** Express 错误处理中间件收到的错误形状（next(err) 传入，通常为 Error 带可选 status/code） */
interface RequestError {
  message?: string;
  stack?: string;
  status?: number;
  code?: string;
}

export interface HttpAppDeps {
  lifecycle: ApplicationLifecycle;
  readinessService: ReadinessService;
}

export function createHttpApp({ lifecycle, readinessService }: HttpAppDeps): express.Express {
  const app = express();

  app.set('trust proxy', resolveTrustProxySetting(process.env.TRUST_PROXY, process.env.NODE_ENV));

  // 中间件
  app.use(helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      // 安全审计批次6：AI_API_URL 是后端服务端调用的上游地址，浏览器从不直连——
      // 写进 connect-src 既无作用又向浏览器侧泄漏上游端点，移除
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
    },
  }));

  // 额外安全头
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // CORS 安全配置
  if (!process.env.CORS_ORIGIN && process.env.NODE_ENV === 'production') {
    // 生产漏配 CORS_ORIGIN 时静默回退 localhost 开发白名单：浏览器端跨源请求会被全部拒绝，
    // 属配置漂移信号——显式告警提醒补配，而不是默默用开发值
    logger.warn('[http-app] 生产环境未配置 CORS_ORIGIN，CORS/CSRF 白名单回退到 localhost 开发值，请尽快补配');
  }
  const corsOptions = {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
      : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
  };
  app.use(cors(corsOptions));

  // 请求体上限:默认 100kb 会把长文本导入/批量接口/大 prompt 编辑等正常 JSON 拒之门外(413);
  // 与 nginx 层 client_max_body_size 2m 对齐
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  // HTTP 请求日志（dev 调试用，debug 级别；不记录 body，仅 method/path/status/耗时）
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/', (req, res, next) => {
      if (req.path === '/health' || req.path === '/livez' || req.path === '/readyz') return next();
      const startedAt = Date.now();
      res.on('finish', () => {
        logger.debug(`[http] ${req.method} ${req.originalUrl} → ${res.statusCode} ${Date.now() - startedAt}ms`, {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - startedAt
        });
      });
      next();
    });
  }

  // 应用全局限流到 API 路由（admin 路径由 globalApiLimiter 跳过，走 adminApiLimiter 专属额度）
  app.use('/api/', globalApiLimiter);
  app.use('/api/admin/', adminApiLimiter);

  // 应用 CSRF 保护
  app.use('/api/', csrfMiddleware);

  // 确保 API 响应使用 UTF-8 编码
  app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });

  // /health 保留兼容并明确作为 liveness。
  const livezHandler = (req: express.Request, res: express.Response) => {
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  };
  app.get('/health', livezHandler);
  app.get('/livez', livezHandler);
  app.get('/readyz', async (req, res) => {
    if (lifecycle.isDraining()) {
      return res.status(503).json({
        status: 'not_ready',
        reason: 'draining',
        timestamp: new Date().toISOString()
      });
    }
    const result = await readinessService.check();
    res.status(result.ready ? 200 : 503).json({
      status: result.ready ? 'ready' : 'not_ready',
      checks: result.checks,
      timestamp: new Date().toISOString()
    });
  });

  return app;
}

/**
 * 错误处理与 404 兜底。
 * Express 语义要求：必须在所有路由之后注册，否则会抢先拦截请求。
 */
export function registerErrorHandlers(app: express.Express): void {
  // 错误处理中间件（next 仅用于声明 4 参错误处理器签名，不显式调用）
  app.use((err: RequestError, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // 记录错误日志（包含完整堆栈）
    logger.error('Request error:', {
      message: err.message,
      stack: err.stack,
      status: err.status,
      path: req.path,
      method: req.method
    });

    const isProduction = process.env.NODE_ENV === 'production';

    // 生产环境隐藏敏感信息
    if (isProduction) {
      res.status(err.status || 500).json({
        success: false,
        error: {
          message: '服务器错误，请稍后重试',
          code: err.code || 'INTERNAL_ERROR',
          status: err.status || 500
        }
      });
    } else {
      // 开发环境返回详细错误
      res.status(err.status || 500).json({
        success: false,
        error: {
          message: err.message || 'Internal Server Error',
          code: err.code || 'INTERNAL_ERROR',
          status: err.status || 500,
          stack: err.stack
        }
      });
    }
  });

  // 404处理
  app.use((req, res) => {
    res.status(404).json({
      error: {
        message: 'Not Found',
        status: 404
      }
    });
  });
}
