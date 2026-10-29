/**
 * WenFlow 后端进程入口（架构审计 §5 行动 #3：index.ts 拆分后的编排层）
 *
 * 职责仅剩：环境装配 → 应用骨架 → 路由注册 → startServer 按阶段编排 → 优雅关闭。
 * 启动序列（单实例锁 → 连库 → **先绑端口** → seeds/初始化 → markReady）见 bootstrap/startup-sequence.ts
 * （#143：端口不可用时零写库副作用退出；初始化完成前 /readyz 报 not_ready）。
 */
import type { Server } from 'http';
import prisma from './config/database';
import systemPrisma from './config/system-database';
import { logger } from './utils/logger';
import { isBenignConnectionError } from './utils/connection-errors';
import { ReadinessService } from './services/readiness.service';
import { ApplicationLifecycle, resolveShutdownDeadlineMs } from './services/application-lifecycle.service';
import { applyServerTimeouts } from './config/server-timeouts';
import { aiTeachingOrchestrator } from './services/ai-teaching/AITeachingCoordinator';
import { backgroundTaskTracker } from './services/background-task-tracker.service';
import { telemetryWriter } from './services/telemetry-writer.service';
import { logRetentionService } from './services/log-retention.service';
import { auditCleanupService } from './services/audit-cleanup.service';
import { refreshAppTimeZoneFromSettings } from './services/time/day-boundary';
import { autopilotService } from './virtual-lab/autopilot.service';
import { virtualSessionReclaimService } from './virtual-lab/session-reclaim.service';
import { stopBatchExperimentScheduler } from './services/virtual-lab/batch-experiment.service';
import { bootstrapEnvironment } from './bootstrap/env';
import { acquireInstanceLock, InstanceConflictError } from './utils/instance-lock';
import { createHttpApp, registerErrorHandlers } from './bootstrap/http-app';
import { registerRoutes } from './bootstrap/routers';
import { initializeGateway, purgeRetiredSkills } from './bootstrap/gateway';
import {
  runStartupSequence,
  type StartupHandles,
} from './bootstrap/startup-sequence';
import {
  runPromptFileSeed,
  runFieldRoutingSeed,
  runAdminSeed,
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
  runOverviewStatsCacheWarmup,
  runAdminPageColdWarmup,
  runTokenCostCacheWarmup,
} from './bootstrap/schedulers';

// 环境与安全配置装配（保持原 import 期 fail-fast 语义：缺少/弱 JWT_SECRET 直接终止进程）
bootstrapEnvironment();

const PORT = process.env.PORT || 3001;

const lifecycle = new ApplicationLifecycle();
const readinessService = new ReadinessService(prisma, systemPrisma, 2000, () => lifecycle.isDraining());
const shutdownDeadlineMs = resolveShutdownDeadlineMs(process.env.SHUTDOWN_DEADLINE_MS);

const app = createHttpApp({ lifecycle, readinessService });
registerRoutes(app);
registerErrorHandlers(app);

// 运行期句柄（#143 后由 bootstrap/startup-sequence 按进度写入，shutdown 据此清理已启动的部分）
const handles: StartupHandles = {
  outboxWorker: null,
  httpServer: null,
  gateway: null,
  stopEnrichmentRetry: null,
  instanceLock: null,
};

function assertStartupActive() {
  if (lifecycle.isDraining()) throw new Error('服务已进入关闭流程，终止后续启动');
}

/** 建 HTTP server 并 listen；成功 resolve 已绑定端口的服务器，失败（EADDRINUSE 等）reject。 */
function bindHttpServer(): Promise<Server> {
  return new Promise<Server>((resolveServer, reject) => {
    const onError = (error: Error) => reject(error);
    const server = app.listen(PORT, () => {
      server.off('error', onError);
      resolveServer(server);
    });
    // 长程同步请求（/auto 多轮、教学回合最长 300s）需要比 Node 默认 5 分钟更宽的服务端超时，
    // 否则合法长请求会被拦腰截断（报告 #59：304s 时 http=0，在途教学轮被取消）
    applyServerTimeouts(server);
    handles.httpServer = server;
    server.once('error', onError);
  });
}

// 启动服务器
export async function startServer() {
  try {
    // #143：启动序列抽到 bootstrap/startup-sequence（可单测）——
    // 顺序：单实例锁 → 连库 → 绑定端口 → seeds/初始化（失败则关服退出）→ markReady。
    // 端口不可用时在零写库副作用的时点失败；初始化完成前 /readyz 报 not_ready。
    await runStartupSequence({
      assertStartupActive,
      acquireLock: () => acquireInstanceLock(process.env.DATABASE_URL || '', { port: PORT }),
      connectDatabases: async () => {
        await Promise.all([prisma.$connect(), systemPrisma.$connect()]);
      },
      bindHttpServer,
      startMaintenanceSchedulers: () => startMaintenanceSchedulers(lifecycle),
      runVirtualLabStartupRecovery,
      refreshAppTimeZone: () => refreshAppTimeZoneFromSettings(),
      auditSensitiveStoragePermissions: () => auditSensitiveStoragePermissions(assertStartupActive),
      refreshNetworkPolicyBootstrap,
      runPromptFileSeed: () => runPromptFileSeed(assertStartupActive),
      runFieldRoutingSeed: () => runFieldRoutingSeed(assertStartupActive),
      runAdminSeed: () => runAdminSeed(assertStartupActive),
      purgeRetiredSkills,
      runSkillModelConfigSeed,
      initializeGateway,
      startOutboxWorker,
      runLearningStartupRecovery: () => runLearningStartupRecovery(assertStartupActive),
      startEnrichmentRetryLoop,
      runDashboardGuidanceBackfill,
      runTokenCostCacheWarmup,
      runOverviewStatsCacheWarmup,
      runAdminPageColdWarmup,
      markReady: () => lifecycle.markReady(),
    }, handles);
    logger.info(`🚀 Server is running on port ${PORT}`);
    logger.info(`📚 API Documentation: http://localhost:${PORT}/api`);
    logger.info(`🤖 EduClaw Gateway: Agent-Driven Architecture`);
  } catch (error) {
    if (error instanceof InstanceConflictError) {
      // 单实例冲突：直接失败退出，不走 shutdown（未持有任何运行时资源；锁也不在本进程手里）
      logger.error('❌ 单实例断言失败，拒绝启动', { conflict: error.conflict, message: error.message });
      process.exitCode = 1;
      throw error;
    }
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
    httpServer: handles.httpServer,
    stopSchedulers: async () => {
      if (handles.stopEnrichmentRetry) handles.stopEnrichmentRetry();
      handles.stopEnrichmentRetry = null;
      await logRetentionService.stop();
      await auditCleanupService.stop();
      await virtualSessionReclaimService.stop();
      stopBatchExperimentScheduler();
      autopilotService.stopReconcileScheduler();
    },
    teaching: aiTeachingOrchestrator,
    backgroundTaskTracker,
    outbox: handles.outboxWorker,
    gateway: handles.gateway,
    databases: [systemPrisma, prisma]
  }, shutdownDeadlineMs);
  handles.instanceLock?.release();
  handles.instanceLock = null;
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
