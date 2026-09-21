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

export interface StaleSessionReclaimResult {
  dryRun: boolean;
  thresholdMs: number;
  scanned: number;
  reclaimed: number;
  skippedActiveLease: number;
  /** 管理员主动暂停（teaching.paused=true）的会话：无写入是预期行为，跳过回收 */
  skippedPaused: number;
  /** 仍有在途自动化（autopilot running/queued）的会话：有驱动，跳过 */
  skippedActiveAutopilot: number;
  sessions: StaleSessionReclaimEntry[];
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
  'virtual_sessions' | 'virtual_experiment_leases' | 'admin_audit_logs'
>;

interface SessionRow {
  id: string;
  status: string;
  currentStage: string | null;
  updatedAt: Date;
  stageResults: string | null;
  logs: string | null;
}

export class VirtualSessionReclaimService {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private readonly database: ReclaimDatabase;
  private readonly thresholdMs: number;
  private readonly fastThresholdMs: number;
  private readonly intervalMs: number;
  private lifecycle: Pick<ApplicationLifecycle, 'isDraining'> | null;

  constructor(options: { database?: ReclaimDatabase; thresholdMs?: number; fastThresholdMs?: number; intervalMs?: number; lifecycle?: Pick<ApplicationLifecycle, 'isDraining'> | null } = {}) {
    this.database = options.database ?? prisma;
    this.thresholdMs = options.thresholdMs ?? resolveStaleSessionThresholdMs(process.env.VLAB_STALE_SESSION_HOURS);
    this.fastThresholdMs = options.fastThresholdMs ?? resolveFastStaleThresholdMs(process.env.VLAB_STALE_SESSION_FAST_MINUTES);
    this.intervalMs = options.intervalMs ?? resolveReclaimIntervalMs(process.env.VLAB_RECLAIM_INTERVAL_MINUTES);
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
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = true;
      void (async () => {
        // ① 硬阈值（默认 24h）：保留原语义与审计 reason
        await this.runReclaimOnce();
        // ② 短周期收敛（默认 30min）：把「重启后无驱动却仍显示运行中」的窗口从 24h 缩到分钟级
        await this.runFastReclaimOnce();
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
   *  options.profileIds 提供时只扫描指定虚拟人的会话（管理面「批量清理卡死」按选中行过滤）。 */
  async runReclaimOnce(options: {
    dryRun?: boolean;
    now?: Date;
    profileIds?: string[];
    /** 覆盖阈值（短周期收敛用）；缺省 = 硬阈值（默认 24h） */
    thresholdMs?: number;
    /** 留痕用的原因码；缺省 = 'stale-session-timeout' */
    reason?: string;
  } = {}): Promise<StaleSessionReclaimResult> {
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? new Date();
    const thresholdMs = options.thresholdMs ?? this.thresholdMs;
    const reason = options.reason ?? 'stale-session-timeout';
    const threshold = new Date(now.getTime() - thresholdMs);
    const profileIds = Array.isArray(options.profileIds) && options.profileIds.length ? options.profileIds : null;
    const sessions = await this.database.virtual_sessions.findMany({
      where: {
        status: { in: ['running', 'created'] },
        updatedAt: { lt: threshold },
        ...(profileIds ? { virtualProfileId: { in: profileIds } } : {})
      },
      orderBy: { updatedAt: 'asc' },
      take: RECLAIM_BATCH_SIZE,
      select: { id: true, status: true, currentStage: true, updatedAt: true, stageResults: true, logs: true }
    }) as unknown as SessionRow[];

    const result: StaleSessionReclaimResult = {
      dryRun,
      thresholdMs,
      scanned: sessions.length,
      reclaimed: 0,
      skippedActiveLease: 0,
      skippedPaused: 0,
      skippedActiveAutopilot: 0,
      sessions: []
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
      const activeLease = await this.database.virtual_experiment_leases.findFirst({
        where: { sessionId: session.id, expiresAt: { gt: now } },
        select: { sessionId: true }
      });
      if (activeLease) {
        result.skippedActiveLease += 1;
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
        continue;
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
   * 短周期收敛一轮：阈值取 `fastThresholdMs`（默认 30 分钟），其余保护（活跃租约 /
   * teaching.paused / 在途 autopilot）与硬阈值一致。用于把「进程重启后无驱动却仍显示运行中」
   * 的窗口从 24h 缩到分钟级；硬阈值回收仍继续兜底。
   */
  async runFastReclaimOnce(options: { dryRun?: boolean; now?: Date; profileIds?: string[] } = {}): Promise<StaleSessionReclaimResult> {
    return this.runReclaimOnce({
      ...options,
      thresholdMs: this.fastThresholdMs,
      reason: 'stale-session-short'
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

export const virtualSessionReclaimService = new VirtualSessionReclaimService();
