/**
 * Retry Mechanism
 *
 * 指数退避重试、超时处理、断路器模式
 */

import { logger } from './logger';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  timeoutMs: number;
  retryableErrors?: string[];
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  openDurationMs: number;
  halfOpenMaxCalls: number;
}

interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  lastStateChangeTime?: Date;
  halfOpenCalls: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
  timeoutMs: 60000,
  retryableErrors: [
    'network',
    'timeout',
    'rate-limit',
    'server-error',
    '503',
    '502',
    '504',
    'ECONNRESET',
    'ETIMEDOUT'
  ]
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  openDurationMs: 30000,
  halfOpenMaxCalls: 3
};

export class RetryExecutor {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  async execute<T>(
    fn: () => Promise<T>,
    context?: { operationName?: string; metadata?: any }
  ): Promise<T> {
    const operationName = context?.operationName || 'unknown';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(fn);
        if (attempt > 0) {
          logger.info(`[RetryExecutor] ${operationName} succeeded after ${attempt} retries`);
        }
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRetryable(lastError)) {
          logger.error(`[RetryExecutor] ${operationName} failed with non-retryable error:`, lastError.message);
          throw lastError;
        }

        if (attempt < this.config.maxRetries) {
          const delay = this.calculateDelay(attempt);
          logger.warn(
            `[RetryExecutor] ${operationName} failed (attempt ${attempt + 1}/${this.config.maxRetries + 1}), ` +
            `retrying in ${delay}ms: ${lastError.message}`
          );

          await this.sleep(delay);
        }
      }
    }

    logger.error(`[RetryExecutor] ${operationName} failed after ${this.config.maxRetries + 1} attempts`);
    throw lastError || new Error('Max retries exceeded');
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    if (this.config.timeoutMs <= 0) {
      return fn();
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      fn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, attempt);
    const jitter = this.config.jitterFactor * exponentialDelay * Math.random();
    const delay = exponentialDelay + jitter;
    return Math.min(delay, this.config.maxDelayMs);
  }

  private isRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();

    return this.config.retryableErrors!.some(retryable =>
      message.includes(retryable.toLowerCase())
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState;
  private name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.state = {
      status: 'closed',
      failureCount: 0,
      successCount: 0,
      halfOpenCalls: 0,
      lastStateChangeTime: new Date()
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.updateState();

    if (this.state.status === 'open') {
      throw new Error(`Circuit breaker "${this.name}" is open`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private updateState(): void {
    const now = new Date();

    if (this.state.status === 'open') {
      const elapsed = now.getTime() - (this.state.lastFailureTime?.getTime() || 0);

      if (elapsed >= this.config.openDurationMs) {
        this.transitionTo('half-open');
        logger.info(`[CircuitBreaker] "${this.name}" transitioned to half-open`);
      }
    }
  }

  private onSuccess(): void {
    this.state.failureCount = 0;

    if (this.state.status === 'half-open') {
      this.state.successCount++;
      this.state.halfOpenCalls++;

      if (this.state.successCount >= this.config.successThreshold) {
        this.transitionTo('closed');
        logger.info(`[CircuitBreaker] "${this.name}" transitioned to closed (success threshold reached)`);
      }
    }
  }

  private onFailure(): void {
    this.state.failureCount++;
    this.state.lastFailureTime = new Date();

    if (this.state.status === 'half-open') {
      this.state.halfOpenCalls++;

      if (this.state.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        this.transitionTo('open');
        logger.warn(`[CircuitBreaker] "${this.name}" transitioned to open (half-open failures)`);
      }
    } else if (this.state.status === 'closed') {
      if (this.state.failureCount >= this.config.failureThreshold) {
        this.transitionTo('open');
        logger.warn(`[CircuitBreaker] "${this.name}" transitioned to open (failure threshold reached)`);
      }
    }
  }

  private transitionTo(status: 'closed' | 'open' | 'half-open'): void {
    this.state.status = status;
    this.state.lastStateChangeTime = new Date();

    if (status === 'closed') {
      this.state.failureCount = 0;
      this.state.successCount = 0;
    } else if (status === 'half-open') {
      this.state.successCount = 0;
      this.state.halfOpenCalls = 0;
    }
  }

  getStatus(): {
    name: string;
    status: 'closed' | 'open' | 'half-open';
    failureCount: number;
    successCount: number;
  } {
    return {
      name: this.name,
      status: this.state.status,
      failureCount: this.state.failureCount,
      successCount: this.state.successCount
    };
  }

  reset(): void {
    this.transitionTo('closed');
    logger.info(`[CircuitBreaker] "${this.name}" manually reset to closed`);
  }
}

export class ResilientExecutor {
  private retryExecutor: RetryExecutor;
  private circuitBreaker: CircuitBreaker;
  private fallbackFn?: () => Promise<any>;

  constructor(
    name: string,
    retryConfig: Partial<RetryConfig> = {},
    circuitBreakerConfig: Partial<CircuitBreakerConfig> = {},
    fallbackFn?: () => Promise<any>
  ) {
    this.retryExecutor = new RetryExecutor(retryConfig);
    this.circuitBreaker = new CircuitBreaker(name, circuitBreakerConfig);
    this.fallbackFn = fallbackFn;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.circuitBreaker.execute(() =>
        this.retryExecutor.execute(fn, { operationName: this.circuitBreaker.getStatus().name })
      );
    } catch (error) {
      if (this.fallbackFn) {
        logger.warn(`[ResilientExecutor] Using fallback for "${this.circuitBreaker.getStatus().name}"`);
        return this.fallbackFn() as Promise<T>;
      }
      throw error;
    }
  }

  getStatus() {
    return this.circuitBreaker.getStatus();
  }

  reset() {
    this.circuitBreaker.reset();
  }
}

export function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const executor = new RetryExecutor(config);
  return executor.execute(fn);
}

export function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

export function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  config?: Partial<CircuitBreakerConfig>
): Promise<T> {
  const breaker = new CircuitBreaker(name, config);
  return breaker.execute(fn);
}

export const retry = {
  RetryExecutor,
  CircuitBreaker,
  ResilientExecutor,
  withRetry,
  withTimeout,
  withCircuitBreaker,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG
};

export default retry;