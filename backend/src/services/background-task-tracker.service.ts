import { logger } from '../utils/logger';
import { getRequestContext, requestContextStorage } from '../gateway/api-gateway/context';

export class BackgroundTaskRejectedError extends Error {
  readonly code = 'BACKGROUND_TASK_TRACKER_DRAINING';

  constructor(readonly taskName: string) {
    super(`服务正在关闭，拒绝启动后台任务：${taskName}`);
    this.name = 'BackgroundTaskRejectedError';
  }
}

export class BackgroundTaskTracker {
  private accepting = true;
  private inFlight = new Set<Promise<void>>();

  isAccepting(): boolean {
    return this.accepting;
  }

  track<T>(name: string, task: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new BackgroundTaskRejectedError(name));

    let operation: Promise<T>;
    try {
      operation = Promise.resolve(task());
    } catch (error) {
      operation = Promise.reject(error);
    }

    let settlement: Promise<void>;
    settlement = operation.then(() => undefined, () => undefined).finally(() => {
      this.inFlight.delete(settlement);
    });
    this.inFlight.add(settlement);
    return operation;
  }

  async drain(): Promise<void> {
    this.accepting = false;
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }
}

export const backgroundTaskTracker = new BackgroundTaskTracker();

export function runBackgroundTask<T>(
  name: string,
  task: () => Promise<T>,
  context: Record<string, unknown> = {}
): void {
  // 后台任务脱离请求级 abortSignal：acp-context 中间件会在 HTTP 连接关闭时
  // abort 请求上下文，若后台任务继承该信号，连接一关（响应结束、页面跳转）
  // 进行中的 LLM 调用就会被取消（"API request canceled"）。
  // 保留 traceId/userId 等溯源字段，仅移除 abortSignal。
  const { abortSignal: _detachedAbortSignal, ...detachedContext } = getRequestContext();
  void backgroundTaskTracker
    .track(name, () => requestContextStorage.run(detachedContext, task))
    .catch(error => {
      if (error instanceof BackgroundTaskRejectedError) {
        logger.info('[background-task] rejected while draining', { name, ...context });
        return;
      }
      logger.warn('[background-task] failed', {
        name,
        ...context,
        error: error instanceof Error ? error.message : String(error)
      });
    });
}
