/**
 * 把两条 RPM 配置应用到出站限流器：
 *  - 平台全局：reliability 设置（platformRpmLimit）
 *  - 虚拟学习者专属：virtualLab 设置（virtualLearnerRpmLimit）
 *
 * 启动时应用一次；此后每 30s 重新对齐（覆盖多实例 / 外部改动）；
 * 设置更新接口在写入后再即时应用，避免等待下一个周期。
 */
import {
  platformRpmLimiter,
  virtualLearnerRpmLimiter,
  type RpmLimiterStats
} from '../gateway/api-gateway/rpm-limiter';
import { getRuntimeReliabilitySettings } from './reliability-settings.service';
import { getRuntimeVirtualLabSettings } from './virtual-lab-settings.service';
import { logger } from '../utils/logger';

export const RPM_LIMIT_SYNC_INTERVAL_MS = 30_000;

export async function applyRpmLimitsFromSettings(): Promise<{ platformRpm: number; virtualLearnerRpm: number }> {
  const [reliability, virtualLab] = await Promise.all([
    getRuntimeReliabilitySettings().catch(() => null),
    getRuntimeVirtualLabSettings().catch(() => null)
  ]);
  if (reliability) platformRpmLimiter.setRpm(reliability.platformRpmLimit);
  if (virtualLab) virtualLearnerRpmLimiter.setRpm(virtualLab.virtualLearnerRpmLimit);
  return {
    platformRpm: platformRpmLimiter.getRpm(),
    virtualLearnerRpm: virtualLearnerRpmLimiter.getRpm()
  };
}

export function getRpmLimitStats(): { platform: RpmLimiterStats; virtualLearner: RpmLimiterStats } {
  return {
    platform: platformRpmLimiter.stats(),
    virtualLearner: virtualLearnerRpmLimiter.stats()
  };
}

let syncTimer: NodeJS.Timeout | null = null;

/** 启动周期对齐（幂等；unref 不阻塞进程退出） */
export function startRpmLimitSync(): void {
  if (syncTimer) return;
  void applyRpmLimitsFromSettings().catch((error) => {
    logger.warn('[rpm-limit] 初始应用失败（不阻断启动）', {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  syncTimer = setInterval(() => {
    void applyRpmLimitsFromSettings().catch((error) => {
      logger.warn('[rpm-limit] 周期对齐失败', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, RPM_LIMIT_SYNC_INTERVAL_MS);
  if (typeof syncTimer.unref === 'function') syncTimer.unref();
}
