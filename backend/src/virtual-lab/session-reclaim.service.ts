/**
 * 虚拟会话僵尸回收服务（P0-2/R4）
 *
 * running/created 且超过阈值（默认 24h）无任何写入、且无活跃租约的虚拟会话，
 * 自动标记为 abandoned（reason=stale，运维清理不计入系统失败率）并写审计记录。只标记状态、不删除任何数据。
 * - 活跃租约保护：会话仍被 Blackbox/Assisted runner 执行（lease 未过期）时跳过。
 * - 触发时机：周期扫描（默认每 15 分钟），以及管理端点
 *   POST /api/admin/virtual-learners/sessions/reclaim-stale（dryRun 默认 true）。
 */

import prisma from '../config/database';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import type { ApplicationLifecycle } from '../services/application-lifecycle.service';
import { appendSessionLogs, type VirtualSessionLogStoreClient } from '../services/virtual-lab/virtual-session-log-store';
import { backendBootRegistry, heartbeatSafely } from './boot-registry';

export const DEFAULT_STALE_SESSION_HOURS = 24;
/**
 * 「短周期收敛」阈值（分钟）。
 * 进程重启后，留在 `running/created` 但已无任何驱动的虚拟会话，不必等 24h 才收敛——
 * 旧行为下前端最长会看到 24h 的「假运行中」。只作用于虚拟实验室会话（`virtual_sessions`），
 * 不影响真实用户的课堂（`teaching_sessions`）。
 */
export const DEFAULT_FAST_STALE_MINUTES = 30;
export const DEFAULT_RECLAIM_INTERVAL_MS = 15 * 60 * 1000;
export const RECLAIM_BATCH_SIZE = 50;
/** 进程代际心跳的存活窗口：3 个扫描周期（下限 5 分钟）。进程死亡后其登记至多滞后一个窗口失效——
 *  失效前 floor 偏早（保守少收），失效后恢复正常，方向安全。 */
const RECLAIM_LIVENESS_MS = Math.max(3 * resolveReclaimIntervalMs(process.env.VLAB_RECLAIM_INTERVAL_MINUTES), 5 * 60 * 1000);

const MILLIS_PER_HOUR = 60 * 60 * 1000;
const MILLIS_PER_MINUTE = 60 * 1000;

/** 阈值的人类可读化（<1h 用分钟） */
function formatThreshold(thresholdMs: number): string {
  return thresholdMs < MILLIS_PER_HOUR
    ? `${Math.round(thresholdMs / MILLIS_PER_MINUTE)} 分钟`
    : `${Math.round(thresholdMs / MILLIS_PER_HOUR)} 小时`;
}

export interface StaleSessionReclaimEntry {
  id: string;
  status: string;
  currentStage: string;
  staleMs: number;
  updatedAt: string;
}

/** 候选被豁免（本轮不会回收）的原因，与 runReclaimOnce 保护链一一对应 */
export type StaleSessionReclaimSkipReason =
  | 'live-generation'
  | 'active-lease'
  | 'held'
  | 'paused'
  | 'active-autopilot';

export interface StaleSessionReclaimSkippedEntry extends StaleSessionReclaimEntry {
  skipReason: StaleSessionReclaimSkipReason;
}

export interface StaleSessionReclaimResult {
  dryRun: boolean;
  thresholdMs: number;
  scanned: number;
  reclaimed: number;
  skippedActiveLease: number;
  /** 管理员主动暂停（teaching.paused=true）的会话：无写入是预期行为，跳过回收 */
  skippedPaused: number;
  /** 显式 hold（stageResults.hold）的会话：外部驱动申报的「故意停留」，跳过回收 */
  skippedHeld: number;
  /** 仍有在途自动化（autopilot running/queued）的会话：有驱动，跳过 */
  skippedActiveAutopilot: number;
  /** 本进程代际启动后仍有写入的会话：写入时存在活着的进程代际，非孤儿 */
  skippedLiveGeneration: number;
  sessions: StaleSessionReclaimEntry[];
  /** 被豁免候选明细（与 skipped* 计数同源）。干跑清单必须能逐条列出豁免项——
   *  否则页头角标（超阈值候选数）与弹窗清单（仅可回收）会摆出「35 vs 0」两套数字，
   *  运营无法判断到底要不要清理（B8-F4-2）。 */
  skippedSessions: StaleSessionReclaimSkippedEntry[];
  /** 单次扫描上限：scanned 达到它说明还有未扫到的候选（可分批多次执行） */
  batchLimit: number;
}

export function resolveStaleSessionThresholdMs(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_STALE_SESSION_HOURS * MILLIS_PER_HOUR;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(`[session-reclaim] VLAB_STALE_SESSION_HOURS 无效（${value}），使用默认 ${DEFAULT_STALE_SESSION_HOURS} 小时`);
    return DEFAULT_STALE_SESSION_HOURS * MILLIS_PER_HOUR;
  }
  return parsed * MILLIS_PER_HOUR;
}

export function resolveFastStaleThresholdMs(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_FAST_STALE_MINUTES * MILLIS_PER_MINUTE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(`[session-reclaim] VLAB_STALE_SESSION_FAST_MINUTES 无效（${value}），使用默认 ${DEFAULT_FAST_STALE_MINUTES} 分钟`);
    return DEFAULT_FAST_STALE_MINUTES * MILLIS_PER_MINUTE;
  }
  return parsed * MILLIS_PER_MINUTE;
}

export function resolveReclaimIntervalMs(value: string | undefined): number {
  if (!value || value.trim() === '') return DEFAULT_RECLAIM_INTERVAL_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(`[session-reclaim] VLAB_RECLAIM_INTERVAL_MINUTES 无效（${value}），使用默认 ${DEFAULT_RECLAIM_INTERVAL_MS / 60000} 分钟`);
    return DEFAULT_RECLAIM_INTERVAL_MS;
  }
  return parsed * 60 * 1000;
}

type ReclaimDatabase = Pick<
  PrismaClient,
  'virtual_sessions' | 'virtual_experiment_leases' | 'admin_audit_logs' | 'learning_paths'
>;

interface SessionRow {
  id: string;
  status: string;
  currentStage: string | null;
  learningPathId: string | null;
  updatedAt: Date;
  stageResults: string | null;
  logs: string | null;
}

/**
 * 卡在「path-accepted」的会话自愈尝试（返回 true = 已复活，跳过回收）。
 * 会话停在 path-accepted = 路径已生成并接受、但驱动器没有触发 startLearning
 * （2026-10-02 小陈案例：path 68 任务全部生成成功却卡死 2h 被回收）。
 * 回收前先试一次推进，救活优先于判死。
 */
export type ReviveStuckSession = (sessionId: string) => Promise<boolean>;

export class VirtualSessionReclaimService {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private readonly database: ReclaimDatabase;
  private readonly thresholdMs: number;
  private readonly fastThresholdMs: number;
  private readonly intervalMs: number;
  private readonly reviveStuckSession: ReviveStuckSession | null;
  private readonly resolveActiveBootFloor: ((now: Date) => Promise<Date | null>) | null;
  private readonly bootHeartbeat: ((now: Date) => Promise<boolean>) | null;
  private lifecycle: Pick<ApplicationLifecycle, 'isDraining'> | null;

  constructor(options: {
    database?: ReclaimDatabase;
    thresholdMs?: number;
    fastThresholdMs?: number;
    intervalMs?: number;
    reviveStuckSession?: ReviveStuckSession | null;
    lifecycle?: Pick<ApplicationLifecycle, 'isDraining'> | null;
    /** 快档「确证孤儿」判据：返回所有存活后端进程中最早的启动时间；null=无存活登记（快档本轮跳过）。
     *  未注入（测试/旧调用方）时快档退化为纯阈值语义，保持向后兼容。 */
    resolveActiveBootFloor?: ((now: Date) => Promise<Date | null>) | null;
    bootHeartbeat?: ((now: Date) => Promise<boolean>) | null;
  } = {}) {
    this.database = options.database ?? prisma;
    this.thresholdMs = options.thresholdMs ?? resolveStaleSessionThresholdMs(process.env.VLAB_STALE_SESSION_HOURS);
    this.fastThresholdMs = options.fastThresholdMs ?? resolveFastStaleThresholdMs(process.env.VLAB_STALE_SESSION_FAST_MINUTES);
    this.intervalMs = options.intervalMs ?? resolveReclaimIntervalMs(process.env.VLAB_RECLAIM_INTERVAL_MINUTES);
    this.reviveStuckSession = options.reviveStuckSession ?? null;
    this.resolveActiveBootFloor = options.resolveActiveBootFloor ?? null;
    this.bootHeartbeat = options.bootHeartbeat ?? null;
    this.lifecycle = options.lifecycle ?? null;
  }

  getThresholdMs(): number {
    return this.thresholdMs;
  }

  getFastThresholdMs(): number {
    return this.fastThresholdMs;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  start(lifecycle?: Pick<ApplicationLifecycle, 'isDraining'>): void {
    if (this.lifecycle) this.lifecycle = lifecycle ?? this.lifecycle;
    if (this.timer) return;
    // 启动即登记（不等首个 tick）：让本进程代际尽快进入 floor 计算，也压缩「重启→首轮扫描」的误收窗口
    void this.bootHeartbeat?.(new Date());
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = true;
      void (async () => {
        // ⓪ 进程代际心跳：登记表失败只降级（本轮快档跳过），不阻断硬档
        const heartbeatOk = this.bootHeartbeat ? await this.bootHeartbeat(new Date()) : true;
        // ① 硬阈值（默认 24h）：保留原语义与审计 reason
        await this.runReclaimOnce();
        // ② 短周期收敛：确证孤儿 = 超快阈值 且 最后写入早于所有存活后端的最早启动时间
        await this.runFastReclaimOnce({ activeBootFloor: heartbeatOk ? undefined : null });
      })().catch((error) => {
        logger.warn('[session-reclaim] 周期回收失败', {
          error: error instanceof Error ? error.message : String(error)
        });
      }).finally(() => {
        this.inFlight = false;
      });
    }, this.intervalMs);
    this.timer.unref?.();
    logger.info('[session-reclaim] 虚拟会话僵尸回收定时任务已启动', {
      thresholdMs: this.thresholdMs,
      fastThresholdMs: this.fastThresholdMs,
      intervalMs: this.intervalMs
    });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (let waited = 0; this.inFlight && waited < 100; waited += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /** 执行一轮回收：running/created 超阈值且无活跃租约 → 标记 failed + 审计。dryRun 只报告不改状态。
   *  options.profileIds 提供时只扫描指定虚拟人的会话（管理面「批量清理卡死」按选中行过滤）。
   *  options.enforceBootFloor：快档专用。Date=「早于它的写入视为上一代孤儿」；null=无存活代际信息（本轮全跳过）；
   *  undefined=不启用代际判据（硬档与旧调用方，纯阈值语义）。 */
  async runReclaimOnce(options: {
    dryRun?: boolean;
    now?: Date;
    profileIds?: string[];
    /** 覆盖阈值（短周期收敛用）；缺省 = 硬阈值（默认 24h） */
    thresholdMs?: number;
    /** 留痕用的原因码；缺省 = 'stale-session-timeout' */
    reason?: string;
    enforceBootFloor?: Date | null;
  } = {}): Promise<StaleSessionReclaimResult> {
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? new Date();
    const thresholdMs = options.thresholdMs ?? this.thresholdMs;
    const reason = options.reason ?? 'stale-session-timeout';
    const bootFloor = options.enforceBootFloor;
    const threshold = new Date(now.getTime() - thresholdMs);
    const profileIds = Array.isArray(options.profileIds) && options.profileIds.length ? options.profileIds : null;
    const emptySessions: StaleSessionReclaimEntry[] = [];
    const skippedSessions: StaleSessionReclaimSkippedEntry[] = [];
    // 无存活进程代际登记：无法区分「上一代孤儿」和「别处的活工作」→ 本轮全跳过（硬档 24h 仍会兜底）
    if (bootFloor === null) {
      logger.info('[session-reclaim] 无存活进程代际登记，快档本轮跳过', { thresholdMs });
      return {
        dryRun, thresholdMs, scanned: 0, reclaimed: 0,
        skippedActiveLease: 0, skippedPaused: 0, skippedHeld: 0, skippedActiveAutopilot: 0, skippedLiveGeneration: 0,
        sessions: emptySessions, skippedSessions, batchLimit: RECLAIM_BATCH_SIZE
      };
    }
    const sessions = await this.database.virtual_sessions.findMany({
      where: {
        status: { in: ['running', 'created'] },
        updatedAt: { lt: threshold },
        ...(profileIds ? { virtualProfileId: { in: profileIds } } : {})
      },
      orderBy: { updatedAt: 'asc' },
      take: RECLAIM_BATCH_SIZE,
      select: { id: true, status: true, currentStage: true, learningPathId: true, updatedAt: true, stageResults: true, logs: true }
    }) as unknown as SessionRow[];

    const result: StaleSessionReclaimResult = {
      dryRun,
      thresholdMs,
      scanned: sessions.length,
      reclaimed: 0,
      skippedActiveLease: 0,
      skippedPaused: 0,
      skippedHeld: 0,
      skippedActiveAutopilot: 0,
      skippedLiveGeneration: 0,
      sessions: emptySessions,
      skippedSessions,
      batchLimit: RECLAIM_BATCH_SIZE
    };

    for (const session of sessions) {
      if (this.lifecycle?.isDraining?.()) break;
      const staleMs = Math.max(0, now.getTime() - new Date(session.updatedAt).getTime());
      const entry: StaleSessionReclaimEntry = {
        id: session.id,
        status: session.status,
        currentStage: session.currentStage || 'unknown',
        staleMs,
        updatedAt: session.updatedAt.toISOString()
      };
      // 确证孤儿判据（快档）：写入发生在「所有存活后端代际启动」之后 → 有活代际可能是它的作者，非孤儿
      if (bootFloor instanceof Date && session.updatedAt.getTime() >= bootFloor.getTime()) {
        result.skippedLiveGeneration += 1;
        skippedSessions.push({ ...entry, skipReason: 'live-generation' });
        continue;
      }
      const activeLease = await this.database.virtual_experiment_leases.findFirst({
        where: { sessionId: session.id, expiresAt: { gt: now } },
        select: { sessionId: true }
      });
      if (activeLease) {
        result.skippedActiveLease += 1;
        skippedSessions.push({ ...entry, skipReason: 'active-lease' });
        continue;
      }
      // 显式 hold（外部驱动申报的「故意停留」）：与暂停同等豁免；带 until 且已到期则不再豁免
      let holdActive = false;
      try {
        const hold = JSON.parse(session.stageResults || '{}')?.hold;
        if (hold && typeof hold === 'object') {
          holdActive = !(typeof hold.until === 'string' && new Date(hold.until).getTime() <= now.getTime());
        } else {
          holdActive = hold != null; // 兼容裸 true / 字符串等简写
        }
      } catch {
        holdActive = false;
      }
      if (holdActive) {
        result.skippedHeld += 1;
        skippedSessions.push({ ...entry, skipReason: 'held' });
        continue;
      }
      // 管理员主动暂停的会话没有写入是预期行为，不应被当作僵尸回收
      // （否则暂停超阈值后被置 failed，resume 永远 409）。跳过并计入 skippedPaused。
      let teachingPaused = false;
      try {
        teachingPaused = (JSON.parse(session.stageResults || '{}')?.teaching?.paused) === true;
      } catch {
        teachingPaused = false;
      }
      if (teachingPaused) {
        result.skippedPaused += 1;
        skippedSessions.push({ ...entry, skipReason: 'paused' });
        continue;
      }
      // 仍有在途自动化（autopilot running/queued）→ 有驱动，跳过（短周期收敛尤其需要这层保护）
      let autopilotActive = false;
      try {
        const autopilot = JSON.parse(session.stageResults || '{}')?.autopilot;
        autopilotActive = autopilot?.status === 'running' || autopilot?.status === 'queued';
      } catch {
        autopilotActive = false;
      }
      if (autopilotActive) {
        result.skippedActiveAutopilot += 1;
        skippedSessions.push({ ...entry, skipReason: 'active-autopilot' });
        continue;
      }
      // path-accepted 卡死自愈：路径已接受但没人触发 startLearning —— 回收前先推进一次，
      // 救活优先于判死（复活成功则本轮跳过；仍在下一轮扫描时按正常保护链判定）
      if ((session.currentStage || '') === 'path-accepted' && !dryRun && this.reviveStuckSession) {
        try {
          const revived = await this.reviveStuckSession(session.id);
          if (revived) {
            logger.info('[session-reclaim] path-accepted 卡死会话已自愈复活，跳过回收', {
              sessionId: session.id,
              staleMs
            });
            continue;
          }
        } catch (error) {
          logger.warn('[session-reclaim] path-accepted 自愈尝试失败，继续回收', {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      result.sessions.push(entry);
      if (!dryRun) {
        await this.reclaimSession(session, staleMs, now, thresholdMs, reason);
      }
      result.reclaimed += 1;
    }

    if (result.reclaimed > 0 || result.skippedActiveLease > 0) {
      logger.info('[session-reclaim] 僵尸会话扫描完成', {
        dryRun,
        scanned: result.scanned,
        reclaimed: result.reclaimed,
        skippedActiveLease: result.skippedActiveLease
      });
    }
    return result;
  }

  /**
   * 短周期收敛一轮：确证孤儿 = 超 fastThreshold 且 最后写入早于所有存活后端代际的最早启动时间
   * （bootFloor）。租约 / hold / teaching.paused / 在途 autopilot 保护与硬阈值一致。
   * 注入 resolveActiveBootFloor 时启用代际判据；未注入（旧调用方/测试）退化为纯阈值语义。
   */
  async runFastReclaimOnce(options: { dryRun?: boolean; now?: Date; profileIds?: string[]; activeBootFloor?: Date | null } = {}): Promise<StaleSessionReclaimResult> {
    let bootFloor: Date | null | undefined;
    if (options.activeBootFloor !== undefined) {
      bootFloor = options.activeBootFloor;
    } else if (this.resolveActiveBootFloor) {
      bootFloor = await this.resolveActiveBootFloor(options.now ?? new Date()).catch((error) => {
        logger.warn('[session-reclaim] 代际 floor 解析失败，本轮快档跳过', {
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      });
    } else {
      bootFloor = undefined;
    }
    return this.runReclaimOnce({
      ...options,
      thresholdMs: this.fastThresholdMs,
      reason: 'stale-session-short',
      enforceBootFloor: bootFloor
    });
  }

  /** 标记单个僵尸会话为 failed：只改状态 + 审计，不删除任何数据 */
  private async reclaimSession(session: SessionRow, staleMs: number, now: Date, thresholdMs: number, reason: string) {
    const reclaimedAt = now.toISOString();
    let stageResults: any = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}');
    } catch {
      stageResults = {};
    }
    stageResults.staleReclaim = {
      reason,
      reclaimedAt,
      staleMs,
      thresholdMs,
      previousStatus: session.status
    };
    // autopilot 状态同步收口（与批量终止同款）：避免「已回收」但仍显示「自动运行中」
    if (stageResults.autopilot && typeof stageResults.autopilot === 'object') {
      stageResults.autopilot.status = 'stopped';
      stageResults.autopilot.completedAt = reclaimedAt;
      stageResults.autopilot.lastError = '僵尸会话自动回收';
    }

    // 回收轨迹进日志子表（首写惰性播种旧列；不再读改写 logs 大列）
    await appendSessionLogs(session.id, [{
      timestamp: reclaimedAt,
      phase: 'error',
      details: {
        error: `僵尸会话自动回收：${session.status} 超过 ${formatThreshold(thresholdMs)}无写入`,
        output: { action: 'stale-session-reclaim', reason, thresholdMs, previousStatus: session.status, staleMs }
      }
    }], { db: this.database as unknown as VirtualSessionLogStoreClient });

    const before = { status: session.status, currentStage: session.currentStage, updatedAt: session.updatedAt.toISOString(), staleMs };
    // 终态记 abandoned（拍板 2026-08-21）：僵尸回收是运维清理而非系统失败，
    // 不应污染 failed 口径。reason=stale 仍记录在 stageResults.staleReclaim
    await this.database.virtual_sessions.update({
      where: { id: session.id },
      data: {
        status: 'abandoned',
        currentStage: session.currentStage || 'goal',
        completedAt: now,
        stageResults: JSON.stringify(stageResults),
        updatedAt: now
      }
    });
    // 级联归档该会话的路径（2026-10-02 小陈案例 P1-2）：会话废弃后 path 若保持 active，
    // 会与重开会话新生成的 path 并存，学习者侧出现两条可用路径且投影取哪条未定义。
    // 只归档仍在 active 的（completed/archived 等终态不动）。
    if (session.learningPathId) {
      try {
        await this.database.learning_paths.updateMany({
          where: { id: session.learningPathId, status: 'active' },
          data: { status: 'archived', updatedAt: now }
        });
      } catch (error) {
        logger.warn('[session-reclaim] 级联归档路径失败（不影响回收）', {
          sessionId: session.id,
          learningPathId: session.learningPathId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    await this.database.admin_audit_logs.create({
      data: {
        adminId: null,
        adminName: 'system',
        action: 'virtual-session-stale-reclaim',
        targetType: 'virtual-session',
        targetId: session.id,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify({ status: 'abandoned', reclaimedAt, reason, thresholdMs }),
        method: 'SYSTEM',
        path: '/system/virtual-session-reclaim',
        statusCode: 200,
        success: true,
        durationMs: 0
      }
    });
    logger.warn('[session-reclaim] 僵尸虚拟会话已标记 abandoned', {
      sessionId: session.id,
      previousStatus: session.status,
      reason,
      thresholdMs,
      staleMs
    });
  }
}

export const virtualSessionReclaimService = new VirtualSessionReclaimService({
  reviveStuckSession: async (sessionId) => {
    // 懒加载避免模块加载期拉起 coordinator 全链；startLearning:true 与 autopilot/一键全流程同口径
    const { default: simulationCoordinator } = await import('../coordinators/simulation.coordinator');
    const review = await simulationCoordinator.resolvePathReview(sessionId, { startLearning: true });
    return review.success === true;
  },
  // 进程代际活性：登记表是「确证孤儿」判据的底座。登记失败 → floor=null → 快档本轮跳过（宁可漏收）
  resolveActiveBootFloor: (now) => backendBootRegistry.oldestLiveBoot(now, RECLAIM_LIVENESS_MS),
  bootHeartbeat: (now) => heartbeatSafely(now)
});
