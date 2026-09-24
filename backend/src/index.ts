/**
 * WenFlow 后端进程入口（架构审计 §5 行动 #3：index.ts 拆分后的编排层）
 *
 * 职责仅剩：环境装配 → 应用骨架 → 路由注册 → startServer 按阶段编排
 * （数据库连接 / 调度器 / 安全策略 / seed / Gateway / outbox / 恢复 / 监听）→ 优雅关闭。
 * 各阶段实现见 src/bootstrap/。
 */
import type { Server } from 'http';
import prisma from './config/database';
import systemPrisma from './config/system-database';
import { logger } from './utils/logger';
import { isBenignConnectionError } from './utils/connection-errors';
import { ReadinessService } from './services/readiness.service';
import { ApplicationLifecycle, resolveShutdownDeadlineMs } from './services/application-lifecycle.service';
import { aiTeachingOrchestrator } from './services/ai-teaching/AITeachingCoordinator';
import { aiCapabilityHealthService } from './services/ai-capability-health.service';
import { backgroundTaskTracker } from './services/background-task-tracker.service';
import { telemetryWriter } from './services/telemetry-writer.service';
import { logRetentionService } from './services/log-retention.service';
import { auditCleanupService } from './services/audit-cleanup.service';
import { refreshAppTimeZoneFromSettings } from './services/time/day-boundary';
import { autopilotService } from './virtual-lab/autopilot.service';
import { virtualSessionReclaimService } from './virtual-lab/session-reclaim.service';
import { bootstrapEnvironment } from './bootstrap/env';
import { createHttpApp, registerErrorHandlers } from './bootstrap/http-app';
import { registerRoutes } from './bootstrap/routers';
import { initializeGateway, purgeRetiredSkills, syncCapabilityProbeSettings } from './bootstrap/gateway';
import {
  runPromptFileSeed,
  runFieldRoutingSeed,
  runAdminSeed,
  runBuiltinVirtualLearnersSeed,
  runSkillModelConfigSeed,
} from './bootstrap/seeds';
import { auditSensitiveStoragePermissions, refreshNetworkPolicyBootstrap } from './bootstrap/runtime-policy';
import {
  startMaintenanceSchedulers,
  runVirtualLabStartupRecovery,
  startOutboxWorker,
  runLearningStartupRecovery,
  startEnrichmentRetryLoop,
  runDashboardGuidanceBackfill,
} from './bootstrap/schedulers';
import type { EduClawGateway } from './gateway';
import type { DurableOutboxWorker } from './events/outbox.worker';

// 环境与安全配置装配（保持原 import 期 fail-fast 语义：缺少/弱 JWT_SECRET 直接终止进程）
bootstrapEnvironment();

const PORT = process.env.PORT || 3001;

const lifecycle = new ApplicationLifecycle();
const readinessService = new ReadinessService(prisma, systemPrisma, 2000, () => lifecycle.isDraining());
const shutdownDeadlineMs = resolveShutdownDeadlineMs(process.env.SHUTDOWN_DEADLINE_MS);

const app = createHttpApp({ lifecycle, readinessService });
registerRoutes(app);
registerErrorHandlers(app);

let outboxWorker: DurableOutboxWorker | null = null;
let httpServer: Server | null = null;
let gateway: EduClawGateway | null = null;
let stopEnrichmentRetry: (() => void) | null = null;

function assertStartupActive() {
  if (lifecycle.isDraining()) throw new Error('服务已进入关闭流程，终止后续启动');
}

// 启动服务器
export async function startServer() {
  try {
    assertStartupActive();
    logger.info('Connecting to main and System databases...');
    await Promise.all([prisma.$connect(), systemPrisma.$connect()]);
    assertStartupActive();
    logger.info('✅ Main and System databases connected successfully');
    startMaintenanceSchedulers(lifecycle);
    await runVirtualLabStartupRecovery();
    assertStartupActive();
    // 应用日界口径（所有"按天归组/比较"）：从平台设置加载时区，失败保持默认 Asia/Shanghai
    const appTz = await refreshAppTimeZoneFromSettings();
    logger.info(`[startup] 应用日界时区 = ${appTz}`);

    await auditSensitiveStoragePermissions(assertStartupActive);
    assertStartupActive();
    await refreshNetworkPolicyBootstrap();
    assertStartupActive();

    await runPromptFileSeed(assertStartupActive);
    await runFieldRoutingSeed(assertStartupActive);
    await runAdminSeed(assertStartupActive);
    await runBuiltinVirtualLearnersSeed(assertStartupActive);

    await purgeRetiredSkills();
    await runSkillModelConfigSeed();
    gateway = await initializeGateway();
    assertStartupActive();
    await syncCapabilityProbeSettings();
    assertStartupActive();

    outboxWorker = startOutboxWorker();

    await runLearningStartupRecovery(assertStartupActive);
    stopEnrichmentRetry = startEnrichmentRetryLoop();
    runDashboardGuidanceBackfill();

    assertStartupActive();
    await new Promise<void>((resolveServer, reject) => {
      const onError = (error: Error) => reject(error);
      const server = app.listen(PORT, () => {
        server.off('error', onError);
        resolveServer();
      });
      httpServer = server;
      server.once('error', onError);
    });
    assertStartupActive();
    lifecycle.markReady();
    logger.info(`🚀 Server is running on port ${PORT}`);
    logger.info(`📚 API Documentation: http://localhost:${PORT}/api`);
    logger.info(`🤖 EduClaw Gateway: Agent-Driven Architecture`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    await shutdown('startup_failure');
    throw error;
  }
}

// 优雅关闭
export async function shutdown(signal: string) {
  logger.info(`${signal} received. Draining server...`, { shutdownDeadlineMs });
  // 遥测写已后台化（不再阻塞请求路径），关闭时统一等待在途写入落盘，
  // 避免与下方 prisma $disconnect 竞争产生无谓的写入失败告警
  await telemetryWriter.flush().catch(() => {});
  const report = await lifecycle.shutdown(signal, {
    httpServer,
    stopSchedulers: async () => {
      if (stopEnrichmentRetry) stopEnrichmentRetry();
      stopEnrichmentRetry = null;
      await logRetentionService.stop();
      await auditCleanupService.stop();
      await virtualSessionReclaimService.stop();
      autopilotService.stopReconcileScheduler();
      await aiCapabilityHealthService.stop();
    },
    teaching: aiTeachingOrchestrator,
    backgroundTaskTracker,
    outbox: outboxWorker,
    gateway,
    databases: [systemPrisma, prisma]
  }, shutdownDeadlineMs);
  logger.info('Server shutdown completed', report);
  return report;
}

if (require.main === module) {
  const handleSignal = (signal: string) => {
    void shutdown(signal).then(report => {
      process.exit(report.timedOut || report.errors.length > 0 ? 1 : 0);
    }).catch(error => {
      logger.error('Server shutdown failed', { error });
      process.exit(1);
    });
  };
  /**
   * 客户端在服务端仍写响应时断开（EPIPE/ECONNRESET 等）会抛出传输层错误。
   * 这类错误是连接噪声而非程序缺陷，不应触发进程级受控关闭 —— 否则一次浏览器
   * 切页/中止请求即可让整个后端退出，并中断所有运行中的虚拟实验会话（QA ISSUE-006）。
   * 判定逻辑抽到 utils/connection-errors 以便单测。
   */
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('uncaughtException', error => {
    if (isBenignConnectionError(error)) {
      logger.warn('Ignored benign connection error (client disconnected?)', { error });
      return;
    }
    logger.error('Uncaught exception, starting controlled shutdown', { error });
    void shutdown('uncaughtException').finally(() => process.exit(1));
  });
  process.on('unhandledRejection', reason => {
    if (isBenignConnectionError(reason)) {
      logger.warn('Ignored benign connection rejection (client disconnected?)', { reason });
      return;
    }
    logger.error('Unhandled rejection, starting controlled shutdown', { reason });
    void shutdown('unhandledRejection').finally(() => process.exit(1));
  });
  void startServer().catch(() => process.exit(1));
}

export default app;
