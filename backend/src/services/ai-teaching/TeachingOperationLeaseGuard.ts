import { logger } from '../../utils/logger';
import {
  TEACHING_OPERATION_RENEW_MS,
  teachingSessionRepository
} from './TeachingSessionRepository';

/**
 * 课堂操作租约心跳（P2）。
 *
 * 在途回合可能跑很久（教学回合含多次 LLM 调用，实测可达 5 分钟以上），但操作租约被
 * 缩短到 2 分钟后，必须由持有方定期续租，否则长回合会被并发请求误判为陈旧而抢占。
 * 进程崩溃/重启后无人续租，租约最多 2 分钟自然过期——把原先 30 分钟的锁死窗口降到分钟级。
 *
 * 与 FinalizationLeaseGuard 的差异：续租失败不阻断本次回合（提交时仍有 operationId
 * 条件 CAS 兜底），因此这里只告警 + 停止续租，不抛错。
 */
export class TeachingOperationLeaseGuard {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly operationId: string
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.renew();
    }, TEACHING_OPERATION_RENEW_MS);
    this.timer.unref?.();
  }

  private async renew(): Promise<void> {
    if (!this.timer) return;
    try {
      const stillOwned = await teachingSessionRepository.renewOperationLease(
        this.sessionId,
        this.operationId
      );
      if (!stillOwned) {
        // 租约已被接管/回收：继续续租没有意义，静默停表（提交侧 CAS 会兜底）。
        this.clearTimer();
      }
    } catch (error) {
      logger.warn('[AITeaching] 课堂操作租约续期失败', {
        sessionId: this.sessionId,
        operationId: this.operationId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  stop(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
