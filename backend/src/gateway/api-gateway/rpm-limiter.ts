/**
 * 出站 LLM 请求限流（RPM，令牌桶）。
 *
 * 两条独立通道（互不共享额度）：
 *  - platformRpmLimiter：平台全局出站（真实用户 / 平台自身调用）
 *  - virtualLearnerRpmLimiter：虚拟学习者专属（sourceEntry === 'simulation'）
 *
 * 语义：rpm <= 0 表示不限。超过预算时「等待」而非报错，让自动驾驶自然变慢。
 * 突发额度约 1 秒（capacity = ceil(rpm/60)），避免闲置后一次性打出一分钟的请求。
 * 注意：按「逻辑调用」计数，单次调用内部的上游重试不额外计数（重试由网关 retryBudget 约束）。
 */

export interface RpmLimiterStats {
  name: string;
  /** 上限；0 = 不限 */
  rpm: number;
  /** 限额内剩余可立即发起的请求数 */
  available: number;
  /** 当前在途（已 acquire 未 release） */
  inFlight: number;
  /** 排队等待令牌的请求数 */
  queued: number;
}

export class RpmLimiter {
  private rpm: number;
  private tokens: number;
  private lastRefillMs: number;
  private inFlight = 0;
  private waiters: Array<(release: () => void) => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly name: string, rpm = 0) {
    this.rpm = normalizeRpm(rpm);
    this.tokens = this.capacity();
    this.lastRefillMs = Date.now();
  }

  private capacity(): number {
    return this.rpm > 0 ? Math.max(1, Math.ceil(this.rpm / 60)) : 0;
  }

  getRpm(): number {
    return this.rpm;
  }

  setRpm(value: number): void {
    this.rpm = normalizeRpm(value);
    this.tokens = this.capacity();
    this.lastRefillMs = Date.now();
    // 放宽后立刻唤醒排队者
    void this.drain();
  }

  private refill(now: number): void {
    if (this.rpm <= 0) return;
    const cap = this.capacity();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    this.tokens = Math.min(cap, this.tokens + (elapsed * this.rpm) / 60000);
    this.lastRefillMs = now;
  }

  /**
   * 获取一个令牌；返回 release()，调用方必须在请求结束后调用（用于在途计数）。
   * rpm<=0 时立即返回，仅计在途。
   */
  async acquire(): Promise<() => void> {
    if (this.rpm <= 0) {
      this.inFlight += 1;
      return () => { this.inFlight = Math.max(0, this.inFlight - 1); };
    }
    this.refill(Date.now());
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.inFlight += 1;
      return () => { this.inFlight = Math.max(0, this.inFlight - 1); };
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push((release) => resolve(release));
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.timer) return;
    const waitMs = this.rpm > 0 ? Math.max(5, Math.ceil(60000 / this.rpm)) : 25;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, waitMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private drain(): void {
    // 放宽为「不限」：立即放行所有排队者
    if (this.rpm <= 0) {
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift() as (release: () => void) => void;
        this.inFlight += 1;
        waiter(() => { this.inFlight = Math.max(0, this.inFlight - 1); });
      }
      return;
    }
    this.refill(Date.now());
    while (this.tokens >= 1 && this.waiters.length > 0) {
      const waiter = this.waiters.shift() as (release: () => void) => void;
      this.tokens -= 1;
      this.inFlight += 1;
      waiter(() => { this.inFlight = Math.max(0, this.inFlight - 1); });
    }
    if (this.waiters.length > 0) this.schedule();
  }

  stats(): RpmLimiterStats {
    return {
      name: this.name,
      rpm: this.rpm,
      available: this.rpm > 0 ? Math.floor(this.tokens) : -1,
      inFlight: this.inFlight,
      queued: this.waiters.length,
    };
  }
}

function normalizeRpm(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(100_000, Math.max(1, Math.round(num)));
}

/** 平台全局出站限流（真实用户 / 平台自身调用） */
export const platformRpmLimiter = new RpmLimiter('platform', 0);

/** 虚拟学习者专属出站限流（sourceEntry === 'simulation'） */
export const virtualLearnerRpmLimiter = new RpmLimiter('virtual-learner', 0);
