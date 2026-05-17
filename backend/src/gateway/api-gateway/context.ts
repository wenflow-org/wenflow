import { AsyncLocalStorage } from 'async_hooks';

export type SourceEntry = 'user' | 'test' | 'admin' | 'platform' | 'arena' | 'lab';

export interface RequestContext {
  userId?: string;
  agentId?: string;
  action?: string;
  skillId?: string;
  sourceEntry?: SourceEntry;
  traceId?: string;
  callerAgent?: string;
  userRole?: 'admin' | 'user' | 'tester' | 'viewer';
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function setRequestContext(context: RequestContext): void {
  const store = requestContextStorage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

export function getRequestContext(): RequestContext {
  return requestContextStorage.getStore() || {};
}

export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(context, fn);
}
