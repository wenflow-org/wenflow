import { Request, Response, NextFunction } from 'express';
import { RequestContext, requestContextStorage } from '../gateway/openai-client';

/**
 * ACP (Agent Call Protocol) 上下文中间件
 * 
 * 为每个请求设置溯源上下文，支持：
 * - sourceEntry: 请求来源（lab/platform/arena/test）
 * - traceId: 追踪ID
 * - X-Test-Mode header: 测试模式标记
 * 
 * 使用方式：
 * - 默认：app.use('/api/learning', authMiddleware, acpContextMiddleware('platform'), routes)
 * - Arena 测试模式：请求携带 Header `X-Test-Mode: arena`
 */
export const acpContextMiddleware = (defaultSourceEntry: 'lab' | 'platform' | 'arena' | 'test') => {
  return (req: Request, res: Response, next: NextFunction) => {
    // 检测 X-Test-Mode header，优先使用它作为 sourceEntry
    const testMode = req.headers['x-test-mode'] as string;
    let sourceEntry: 'lab' | 'platform' | 'arena' | 'test' = defaultSourceEntry;
    
    if (testMode === 'arena') {
      sourceEntry = 'arena';
    } else if (testMode === 'lab') {
      sourceEntry = 'lab';
    } else if (testMode === 'test') {
      sourceEntry = 'test';
    } else if (testMode === 'platform') {
      sourceEntry = 'platform';
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
    
    // 使用 AsyncLocalStorage 存储上下文
    requestContextStorage.run(context, () => {
      next();
    });
  };
};

function generateTraceId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
