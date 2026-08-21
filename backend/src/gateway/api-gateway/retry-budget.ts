import { randomUUID } from 'crypto';

export interface RetryBudget {
  id: string;
  limits: {
    maxUpstreamAttempts: number;
    maxTransportRetries: number;
    maxLogicalRetries: number;
  };
  used: {
    upstreamAttempts: number;
    transportRetries: number;
    logicalRetries: number;
  };
  policy: {
    defaultRequestTimeoutMs: number;
    retryBaseDelayMs: number;
    maxRetryAfterMs: number;
    jitterEnabled: boolean;
  };
  exhaustedBy?: 'upstream-attempts' | 'transport-retries' | 'logical-retries';
}

export interface RetryBudgetOptions {
  maxUpstreamAttempts?: number;
  maxTransportRetries?: number;
  maxLogicalRetries?: number;
  defaultRequestTimeoutMs?: number;
  retryBaseDelayMs?: number;
  maxRetryAfterMs?: number;
  jitterEnabled?: boolean;
}

export const RETRY_BUDGET_HARD_LIMITS = {
  maxUpstreamAttempts: 10,
  maxTransportRetries: 5,
  maxLogicalRetries: 5,
  minRequestTimeoutMs: 10_000,
  maxRequestTimeoutMs: 300_000,
  minRetryBaseDelayMs: 100,
  maxRetryBaseDelayMs: 5_000,
  maxRetryAfterMs: 10_000
} as const;

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.min(max, Math.max(min, Math.round(Number(value))));
}

export function createRetryBudget(options: RetryBudgetOptions = {}): RetryBudget {
  return {
    id: `rb_${randomUUID()}`,
    limits: {
      maxUpstreamAttempts: clampInteger(
        options.maxUpstreamAttempts,
        5,
        1,
        RETRY_BUDGET_HARD_LIMITS.maxUpstreamAttempts
      ),
      maxTransportRetries: clampInteger(
        options.maxTransportRetries,
        3,
        0,
        RETRY_BUDGET_HARD_LIMITS.maxTransportRetries
      ),
      maxLogicalRetries: clampInteger(
        options.maxLogicalRetries,
        3,
        0,
        RETRY_BUDGET_HARD_LIMITS.maxLogicalRetries
      )
    },
    used: {
      upstreamAttempts: 0,
      transportRetries: 0,
      logicalRetries: 0
    },
    policy: {
      defaultRequestTimeoutMs: clampInteger(
        options.defaultRequestTimeoutMs,
        300_000,
        RETRY_BUDGET_HARD_LIMITS.minRequestTimeoutMs,
        RETRY_BUDGET_HARD_LIMITS.maxRequestTimeoutMs
      ),
      retryBaseDelayMs: clampInteger(
        options.retryBaseDelayMs,
        1_000,
        RETRY_BUDGET_HARD_LIMITS.minRetryBaseDelayMs,
        RETRY_BUDGET_HARD_LIMITS.maxRetryBaseDelayMs
      ),
      maxRetryAfterMs: clampInteger(
        options.maxRetryAfterMs,
        10_000,
        0,
        RETRY_BUDGET_HARD_LIMITS.maxRetryAfterMs
      ),
      jitterEnabled: options.jitterEnabled !== false
    }
  };
}

export function consumeUpstreamAttempt(budget: RetryBudget, transportRetry: boolean): boolean {
  if (budget.used.upstreamAttempts >= budget.limits.maxUpstreamAttempts) {
    budget.exhaustedBy = 'upstream-attempts';
    return false;
  }
  if (transportRetry && budget.used.transportRetries >= budget.limits.maxTransportRetries) {
    budget.exhaustedBy = 'transport-retries';
    return false;
  }
  budget.used.upstreamAttempts += 1;
  if (transportRetry) budget.used.transportRetries += 1;
  return true;
}

export function consumeLogicalRetry(budget: RetryBudget): boolean {
  if (budget.used.logicalRetries >= budget.limits.maxLogicalRetries) {
    budget.exhaustedBy = 'logical-retries';
    return false;
  }
  budget.used.logicalRetries += 1;
  return true;
}
