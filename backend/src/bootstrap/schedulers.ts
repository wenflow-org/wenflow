/**
 * 后台调度器与启动恢复装配（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：
 * - 维护型调度器（日志保留 / 审计清理 / 会话回收 / 批量实验 / 日期模拟）；
 * - 虚拟实验室启动恢复（自动驾驶僵尸态对账、短周期收敛、RPM 限流对齐）；
 * - outbox 事件消费（durable consumer 注册 + worker 启动）；
 * - 学习侧启动恢复与周期重试（generating 路径回收、失败准备重试轮询、首页引导回填）。
 */
import { logger } from '../utils/logger';
import learningService from '../services/learning/learning.service';
import { reconcileTaskCompletionMetric } from '../services/metrics/LearningMetricService';
import { startRpmLimitSync } from '../services/rpm-limit-config.service';
import { dashboardGuidanceSnapshotService } from '../services/learner/DashboardGuidanceSnapshotService';
import { DurableEventConsumerRegistry } from '../events/consumer-registry';
import { DurableOutboxWorker } from '../events/outbox.worker';
import { handleLearnerEvent, LEARNER_EVENT_TYPES } from '../events/learner-event-consumer';
import { reviewCompletedConsumer } from '../services/learner/ReviewCompletedConsumer';
import { quickLearnService } from '../virtual-lab/quick-learn/quick-learn.service';
import { autopilotService } from '../virtual-lab/autopilot.service';
import { startBatchExperimentScheduler } from '../services/virtual-lab/batch-experiment.service';
import { startSimulatedDayScheduler } from '../services/virtual-lab/simulated-day-scheduler';
import { auditCleanupService } from '../services/audit-cleanup.service';
import { logRetentionService } from '../services/log-retention.service';
import { virtualSessionReclaimService } from '../virtual-lab/session-reclaim.service';
import { backgroundTaskTracker, runBackgroundTask } from '../services/background-task-tracker.service';
import type { ApplicationLifecycle } from '../services/application-lifecycle.service';
import type { AssertActive } from './seeds';

const ENRICHMENT_RETRY_POLL_INTERVAL_MS = 60 * 1000;

/** 维护型调度器：日志保留、审计清理、会话回收、批量实验、日期模拟自动推进 */
export function startMaintenanceSchedulers(lifecycle: ApplicationLifecycle): void {
  logRetentionService.start(lifecycle);
  auditCleanupService.start(lifecycle);
  virtualSessionReclaimService.start(lifecycle);
  startBatchExperimentScheduler();
  // 日期模拟自动推进（默认关；仅对 simulationClock.autoAdvance=true 的非终态会话生效）
  startSimulatedDayScheduler();
}

/**
 * 虚拟实验室启动恢复：
 * - 进程重启后内存自动驾驶循环已清空：复位 DB 中残留的 running/queued 僵尸态，避免永久阻塞重启；
 * - 运行期状态错位（如会话已终态但 autopilot 仍 running）也靠同一实现周期收敛；
 * - 重启后立即做一次「短周期收敛」：把重启前在跑、重启后已无驱动的虚拟会话从「假运行中」
 *   收敛掉（阈值默认 30min；硬阈值 24h 回收继续兜底）。仅虚拟实验室会话，不影响真实用户课堂；
 * - 出站 RPM 限流配置对齐（平台全局 + 虚拟学习者专属两条通道）。
 */
export async function runVirtualLabStartupRecovery(): Promise<void> {
  await autopilotService.reconcileStaleRuns().catch((err) => {
    logger.warn('[startup] 自动驾驶僵尸状态对账失败（不阻断启动）', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  autopilotService.startReconcileScheduler();
  await virtualSessionReclaimService.runFastReclaimOnce().catch((err) => {
    logger.warn('[startup] 虚拟会话短周期收敛失败（不阻断启动）', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  startRpmLimitSync();
}

/** outbox 事件消费：注册 durable consumers 并启动 worker */
export function startOutboxWorker(): DurableOutboxWorker {
  const durableConsumers = new DurableEventConsumerRegistry();
  durableConsumers.register(['task:completed'], reconcileTaskCompletionMetric);
  // 断链修复 P0-1：复习结果事件消费者（写 learner_evidence + memory_traces，幂等）
  durableConsumers.register(['review:completed'], async (event) => {
    await reviewCompletedConsumer.handle(event);
  });
  durableConsumers.register(LEARNER_EVENT_TYPES, handleLearnerEvent);
  const worker = new DurableOutboxWorker(durableConsumers);
  worker.start();
  return worker;
}

/** 学习侧启动恢复：回收 generating 路径、标记中断的虚拟账号自动学习运行（V1 不续跑） */
export async function runLearningStartupRecovery(assertActive: AssertActive): Promise<void> {
  // 回收因进程中断等原因遗留的 generating 路径
  await learningService.recoverStaleGeneratingPaths();
  assertActive();

  // 标记因进程中断而遗留的虚拟账号自动学习运行（V1 不续跑）
  await quickLearnService.recoverInterruptedRuns();
  assertActive();
}

/**
 * 持续自动重试仍在阶段任务生成失败中的路径。
 * 返回停止函数（清掉定时器），供优雅关闭时调用。
 */
export function startEnrichmentRetryLoop(): () => void {
  let enrichmentRetryInFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (enrichmentRetryInFlight) return;
    const run = backgroundTaskTracker.track('learning.path.recovery-poll', async () => {
      // 两阶段互相隔离（全量测试报告 #52）：实测租约恢复的 P1008（SQLite 查询超时）会把
      // .then 链整段打断，同一 tick 的自动重试因此一次都没跑——而 DB 一忙正是最需要自愈时。
      await learningService.recoverStaleGeneratingPaths().catch((error) => {
        logger.warn('路径生成租约恢复失败（不阻断自动重试轮询）', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
      await learningService.retryEligibleFailedPathPreparations().catch((error) => {
        logger.warn('路径阶段任务自动重试轮询失败', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    })
      .catch((error) => {
        logger.warn('路径生成租约恢复与自动重试轮询失败', {
          error: error instanceof Error ? error.message : String(error)
        });
      }).then(() => undefined).finally(() => {
        if (enrichmentRetryInFlight === run) enrichmentRetryInFlight = null;
      });
    enrichmentRetryInFlight = run;
    void run;
  }, ENRICHMENT_RETRY_POLL_INTERVAL_MS);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    enrichmentRetryInFlight = null;
  };
}

/** 首页引导快照回填（后台任务，不阻塞启动） */
export function runDashboardGuidanceBackfill(): void {
  runBackgroundTask('dashboard-guidance.startup-backfill', async () => {
    const result = await dashboardGuidanceSnapshotService.backfillMissingForActiveUsers(200);
    logger.info('首页引导快照回填完成', result);
  });
}

/**
 * Token 成本缓存预热 + 周期刷新（2026-10-04 页面加载性能批）：延迟 20s 算一次默认口径进 5min TTL 缓存，
 * 此后每 4 分钟后台刷新（< 5min TTL）→ 成本分析页恒命中缓存，消除 TTL 边界上的重算停顿（实测冷算 9.7s）；
 * 失败静默（用户访问成本分析页时自然重算，口径/新鲜度约束不变）。
 */
export function runTokenCostCacheWarmup(): void {
  const refresh = (logFirst = false) => {
    runBackgroundTask('token-cost.cache-warmup', async () => {
      const { warmTokenCostCache } = await import('../routes/admin/token-cost');
      const data = await warmTokenCostCache();
      if (logFirst) logger.info('Token 成本缓存预热完成', { days: 7, tokens: data.totals.tokens });
    });
  };
  const timer = setTimeout(() => refresh(true), 20_000);
  timer.unref?.();
  const interval = setInterval(() => refresh(false), 4 * 60 * 1000);
  interval.unref?.();
}

/**
 * 总览统计缓存预热 + 周期刷新（2026-10-04 页面加载性能批）：
 * 延迟 25s 首次预热（避开启动高峰与日志保留清理的 IO 争抢），此后每 4 分钟后台刷新一次
 * （< 5min 主 TTL）→ 管理端每次进页/切页都命中缓存，重算成本移出用户请求路径；
 * 失败静默（后台任务记账），请求路径仍会按需重算，无功能依赖。
 */
export function runOverviewStatsCacheWarmup(): void {
  const refresh = () => {
    runBackgroundTask('overview.stats.cache-refresh', async () => {
      const { warmOverviewStatsCache } = await import('../routes/admin/platform');
      await warmOverviewStatsCache();
    });
  };
  const timer = setTimeout(refresh, 25_000);
  timer.unref?.();
  const interval = setInterval(refresh, 4 * 60 * 1000);
  interval.unref?.();
}

/**
 * 管理端页面冷读预热（一次性，延迟 30s 避开启动高峰）：
 * - 技能目录页统计（默认 7d + 可选 all）填进路由 5min 缓存；
 * - 执行日志页默认周窗筛选空跑一次（纯页缓存/索引页焐热，无缓存语义）；
 * - 学习状态页列表投影：按页面默认参数（limit 500 / 排除测试）走一次，
 *   把 60 分钟新鲜度窗内到期的 281 人投影分批重建挪到后台（冷首触实测 ~2s）。
 */
export function runAdminPageColdWarmup(): void {
  const timer = setTimeout(() => {
    runBackgroundTask('admin.pages.cold-warmup', async () => {
      const [{ warmSkillListStatsCache }, { warmExecLogsStatsCache }, { learnerSnapshotRefreshService }] = await Promise.all([
        import('../routes/admin/skills'),
        import('../routes/admin/platform'),
        import('../services/learner/LearnerSnapshotRefreshService'),
      ]);
      await warmSkillListStatsCache();
      await warmExecLogsStatsCache();
      await learnerSnapshotRefreshService.listForAdmin({ excludeTest: true, limit: 500 });
      logger.info('管理端页面冷读预热完成');
    });
  }, 30_000);
  timer.unref?.();
}
