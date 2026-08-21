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

export const DEFAULT_STALE_SESSION_HOURS = 24;
export const DEFAULT_RECLAIM_INTERVAL_MS = 15 * 60 * 1000;
export const RECLAIM_BATCH_SIZE = 50;

const MILLIS_PER_HOUR = 60 * 60 * 1000;

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
  private readonly intervalMs: number;
  private lifecycle: Pick<ApplicationLifecycle, 'isDraining'> | null;

  constructor(options: { database?: ReclaimDatabase; thresholdMs?: number; intervalMs?: number; lifecycle?: Pick<ApplicationLifecycle, 'isDraining'> | null } = {}) {
    this.database = options.database ?? prisma;
    this.thresholdMs = options.thresholdMs ?? resolveStaleSessionThresholdMs(process.env.VLAB_STALE_SESSION_HOURS);
    this.intervalMs = options.intervalMs ?? resolveReclaimIntervalMs(process.env.VLAB_RECLAIM_INTERVAL_MINUTES);
    this.lifecycle = options.lifecycle ?? null;
  }

  getThresholdMs(): number {
    return this.thresholdMs;
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
      void this.runReclaimOnce().catch((error) => {
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
  async runReclaimOnce(options: { dryRun?: boolean; now?: Date; profileIds?: string[] } = {}): Promise<StaleSessionReclaimResult> {
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? new Date();
    const threshold = new Date(now.getTime() - this.thresholdMs);
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
      thresholdMs: this.thresholdMs,
      scanned: sessions.length,
      reclaimed: 0,
      skippedActiveLease: 0,
      skippedPaused: 0,
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
      result.sessions.push(entry);
      if (!dryRun) {
        await this.reclaimSession(session, staleMs, now);
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

  /** 标记单个僵尸会话为 failed：只改状态 + 审计，不删除任何数据 */
  private async reclaimSession(session: SessionRow, staleMs: number, now: Date) {
    const reclaimedAt = now.toISOString();
    let stageResults: any = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}');
    } catch {
      stageResults = {};
    }
    stageResults.staleReclaim = {
      reason: 'stale-session-timeout',
      reclaimedAt,
      staleMs,
      thresholdMs: this.thresholdMs,
      previousStatus: session.status
    };

    let logs: any[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {
      logs = [];
    }
    logs.push({
      timestamp: reclaimedAt,
      phase: 'error',
      details: {
        error: `僵尸会话自动回收：${session.status} 超过 ${Math.round(this.thresholdMs / MILLIS_PER_HOUR)} 小时无写入`,
        output: { action: 'stale-session-reclaim', previousStatus: session.status, staleMs }
      }
    });

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
        logs: JSON.stringify(logs),
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
        afterJson: JSON.stringify({ status: 'abandoned', reclaimedAt }),
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
      staleMs
    });
  }
}

export const virtualSessionReclaimService = new VirtualSessionReclaimService();
