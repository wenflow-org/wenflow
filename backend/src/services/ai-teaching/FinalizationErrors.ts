import { FinalizationOperationError, TeachingSessionConflictError } from './TeachingSessionRepository';

export interface FinalizationErrorInfo {
  code: string;
  status: number;
  retryable: boolean;
  category: 'validation' | 'conflict' | 'lease' | 'upstream' | 'persistence';
}

export function classifyFinalizationError(error: unknown): FinalizationErrorInfo {
  if (error instanceof FinalizationOperationError) {
    return {
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      category: error.category
    };
  }
  if (error instanceof TeachingSessionConflictError) {
    return {
      code: error.code,
      status: error.status,
      retryable: true,
      category: 'conflict'
    };
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  const code = typeof (error as { code?: unknown } | null)?.code === 'string'
    ? String((error as { code: string }).code)
    : '';
  const status = Number((error as { status?: unknown; statusCode?: unknown } | null)?.status
    || (error as { statusCode?: unknown } | null)?.statusCode
    || 0);

  if (code === 'FINALIZATION_LEASE_LOST') {
    return { code, status: 409, retryable: true, category: 'lease' };
  }
  if (status === 409 && code.startsWith('PATH_')) {
    return {
      code,
      status: 409,
      retryable: code === 'PATH_TASK_STATE_CHANGED',
      category: 'conflict'
    };
  }
  if (code.includes('TIMEOUT') || message.includes('timeout') || message.includes('超时')) {
    return { code: 'FINALIZATION_PROVIDER_TIMEOUT', status: 504, retryable: true, category: 'upstream' };
  }
  if (status === 429 || message.includes('rate limit') || message.includes('限流')) {
    return { code: 'FINALIZATION_PROVIDER_RATE_LIMITED', status: 503, retryable: true, category: 'upstream' };
  }
  if (status === 401 || status === 403 || message.includes('api key') || message.includes('认证')) {
    return { code: 'FINALIZATION_PROVIDER_AUTH_INVALID', status: 503, retryable: false, category: 'upstream' };
  }
  if (status >= 500 || message.includes('unavailable') || message.includes('不可用')) {
    return { code: 'FINALIZATION_PROVIDER_UNAVAILABLE', status: 503, retryable: true, category: 'upstream' };
  }
  return { code: 'FINALIZATION_PERSISTENCE_FAILED', status: 500, retryable: true, category: 'persistence' };
}
