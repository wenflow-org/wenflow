import { logger } from '../../utils/logger';
import {
  FINALIZATION_LEASE_RENEW_MS,
  teachingSessionRepository
} from './TeachingSessionRepository';

export class FinalizationLeaseGuard {
  private timer: NodeJS.Timeout | null = null;
  private renewal: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  constructor(
    private readonly sessionId: string,
    private readonly idempotencyKey: string,
    private readonly leaseOwner: string
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.assertOwned().catch(() => undefined);
    }, FINALIZATION_LEASE_RENEW_MS);
    this.timer.unref?.();
  }

  async assertOwned(): Promise<void> {
    const renewal = this.renewal.then(async () => {
      if (this.failure) throw this.failure;
      try {
        await teachingSessionRepository.renewFinalizationLease(
          this.sessionId,
          this.idempotencyKey,
          this.leaseOwner
        );
      } catch (error) {
        this.failure = error;
        throw error;
      }
    });
    this.renewal = renewal.catch(error => {
      this.failure = error;
      throw error;
    });
    await this.renewal;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await this.renewal;
    } catch (error) {
      logger.warn('[Finalization] 租约续期已失败', {
        sessionId: this.sessionId,
        operationId: this.idempotencyKey,
        leaseOwner: this.leaseOwner,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
