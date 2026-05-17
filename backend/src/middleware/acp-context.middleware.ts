import { Request, Response, NextFunction } from 'express';
import { RequestContext, SourceEntry, requestContextStorage } from '../gateway/api-gateway/context';

/**
 * ACP (Agent Call Protocol) 上下文中间件
 * 
 * 为每个请求设置溯源上下文，支持：
 * - sourceEntry: 请求来源（user/test/admin/platform）
 * - traceId: 追踪ID
 * - X-Source-Entry header: 强制指定来源
 * 
 * 使用方式：
 * - 默认：app.use('/api/learning', authMiddleware, acpContextMiddleware('platform'), routes)
 * - 测试站点：请求携带 Header `X-Source-Entry: test`
 * - Admin后台：路由使用 acpContextMiddleware('admin')
 * 
 * 分类说明：
 * - user: 用户侧调用（用户界面发起）
 * - test: 测试站点调用（admin/test 路由或 X-Source-Entry header）
 * - admin: Admin 后台调用
 * - platform: 平台内部服务调用
 */
export const acpContextMiddleware = (defaultSourceEntry: SourceEntry) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const headerSourceEntry = req.headers['x-source-entry'] as string;
    let sourceEntry: SourceEntry = defaultSourceEntry;
    
    if (headerSourceEntry === 'user' || headerSourceEntry === 'test' || headerSourceEntry === 'admin' || headerSourceEntry === 'platform') {
      sourceEntry = headerSourceEntry;
    }
    
    const context: RequestContext = {
      userId: (req as any).user?.userId,
      agentId: (req as any).agentId,
      action: (req as any).action,
      sourceEntry,
      traceId: req.headers['x-trace-id'] as string || generateTraceId(),
      callerAgent: req.headers['x-caller-agent'] as string,
      userRole: (req as any).user?.role || 'user',
    };
    
    requestContextStorage.run(context, () => {
      next();
    });
  };
};

function generateTraceId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
