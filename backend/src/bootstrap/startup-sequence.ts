/**
 * 启动序列编排（#143）：把「绑定端口」提到一切**写库副作用**（seed / recovery / backfill /
 * 初始化管理员）之前——端口不可用（EADDRINUSE）是最早可知的失败，必须在数据库零写入下退出。
 *
 * 顺序（与 index.ts 的 startServer 一一对应，步骤全部可注入以便单测）：
 *   单实例锁 → 连接双库（$connect 不产生数据写入）→ **绑定 HTTP 端口** → 初始化（schedulers /
 *   恢复 / 时区 / 审计 / 策略 / seeds / 网关 / outbox / 学习恢复 / 预热）→ markReady。
 *
 * 失败语义（由调用方 index.ts 的 catch 兜底）：
 * - 绑定失败：此时只持锁、未写库 → 调用方 shutdown 释放锁退出（零写库副作用）；
 * - 初始化失败（绑定成功后）：调用方 shutdown 关服退出，端口随 httpServer.close 释放；
 * - 单实例锁冲突（InstanceConflictError）：调用方直接失败退出，不走 shutdown。
 *
 * /readyz 门控：markReady 之前 lifecycle 处于 starting，http-app 的 /readyz 据此报 503
 * not_ready（重启旧库时 readyz 的 DB 巡检可能全绿，不能只靠 DB 状态判断初始化是否完成）。
 *
 * 单实例锁保持「先锁后听」：锁冲突与端口占用是两类冲突，先锁能在不绑定端口的
 * 前提下拒起（无新竞态——端口绑定本身互斥，两个进程至多一个 listen 成功）。
 */
import type { Server } from 'http';
import { logger } from '../utils/logger';
import type { InstanceLockHandle } from '../utils/instance-lock';
import type { EduClawGateway } from '../gateway';
import type { DurableOutboxWorker } from '../events/outbox.worker';

/** index.ts 持有的运行期句柄；序列按进度写入，任一步失败时已写入的部分供 shutdown 清理。 */
export interface StartupHandles {
  instanceLock: InstanceLockHandle | null;
  httpServer: Server | null;
  gateway: EduClawGateway | null;
  outboxWorker: DurableOutboxWorker | null;
  stopEnrichmentRetry: (() => void) | null;
}

export interface StartupSequenceDeps {
  /** 关闭流程已触发时抛错终止后续步骤（透传给 seed/recovery 的 guard 回调） */
  assertStartupActive(): void;
  acquireLock(): InstanceLockHandle;
  connectDatabases(): Promise<void>;
  /** 建 HTTP server 并 listen；成功 resolve 已绑定的 server，失败（EADDRINUSE 等）reject */
  bindHttpServer(): Promise<Server>;
  startMaintenanceSchedulers(): void;
  runVirtualLabStartupRecovery(): Promise<void>;
  refreshAppTimeZone(): Promise<string>;
  auditSensitiveStoragePermissions(): Promise<void>;
  refreshNetworkPolicyBootstrap(): Promise<void>;
  runPromptFileSeed(): Promise<void>;
  runFieldRoutingSeed(): Promise<void>;
  runAdminSeed(): Promise<void>;
  purgeRetiredSkills(): Promise<void>;
  runSkillModelConfigSeed(): Promise<void>;
  initializeGateway(): Promise<EduClawGateway>;
  startOutboxWorker(): DurableOutboxWorker;
  runLearningStartupRecovery(): Promise<void>;
  startEnrichmentRetryLoop(): () => void;
  runDashboardGuidanceBackfill(): void;
  runTokenCostCacheWarmup(): void;
  runOverviewStatsCacheWarmup(): void;
  runAdminPageColdWarmup(): void;
  markReady(): void;
}

export async function runStartupSequence(
  deps: StartupSequenceDeps,
  handles: StartupHandles,
): Promise<void> {
  deps.assertStartupActive();
  // 单实例断言（架构优化批 #3）：以主库路径为键持锁拒起；先锁后听，锁冲突不占端口。
  handles.instanceLock = deps.acquireLock();
  logger.info('Connecting to main and System databases...');
  await deps.connectDatabases();
  deps.assertStartupActive();
  logger.info('✅ Main and System databases connected successfully');

  // #143：先绑定端口，再做一切会产生数据库写入的初始化——
  // 端口不可用这一最早可知的失败，必须发生在零写库副作用的时点。
  handles.httpServer = await deps.bindHttpServer();
  deps.assertStartupActive();

  deps.startMaintenanceSchedulers();
  await deps.runVirtualLabStartupRecovery();
  deps.assertStartupActive();
  // 应用日界口径（所有"按天归组/比较"）：从平台设置加载时区，失败保持默认 Asia/Shanghai
  const appTz = await deps.refreshAppTimeZone();
  logger.info(`[startup] 应用日界时区 = ${appTz}`);

  await deps.auditSensitiveStoragePermissions();
  deps.assertStartupActive();
  await deps.refreshNetworkPolicyBootstrap();
  deps.assertStartupActive();

  await deps.runPromptFileSeed();
  await deps.runFieldRoutingSeed();
  await deps.runAdminSeed();
  // 预制 VL 启动播种已退役（2026-10-09 架构改版：卡库选角，空白项目零 VL 起步；
  // 需要时显式调 runBuiltinVirtualLearnersSeed，见 bootstrap/seeds.ts）

  await deps.purgeRetiredSkills();
  await deps.runSkillModelConfigSeed();
  handles.gateway = await deps.initializeGateway();
  deps.assertStartupActive();

  handles.outboxWorker = deps.startOutboxWorker();

  await deps.runLearningStartupRecovery();
  handles.stopEnrichmentRetry = deps.startEnrichmentRetryLoop();
  deps.runDashboardGuidanceBackfill();
  deps.runTokenCostCacheWarmup();
  deps.runOverviewStatsCacheWarmup();
  deps.runAdminPageColdWarmup();

  deps.markReady();
}
