/**
 * 记忆痕迹服务（记忆引擎 M2）
 *
 * 持久化层：memory_traces 表（userId × conceptKey 唯一）承载 ACT-R 幂律衰减模型。
 * - recordExtraction：每次提取/复习/课后评估更新痕迹（extractionCount+1、lastSeenAt、masteryScore）
 * - recordSessionOutcome：endSession 后按知识看板状态确定性回写内化强度（零 LLM）
 * - getDueTraces：惰性检查到期复习点（保留率阈值 / 计划间隔）
 * - getRetentionSnapshot：读取时计算保留率快照
 */
import prisma from '../../config/database';
import {
  calculateRetention,
  isReviewDue,
  clamp01,
  DEFAULT_DECAY_FACTOR,
  DEFAULT_RETENTION_THRESHOLD,
} from './actr';

export type MemoryStability = 'unknown' | 'fragile' | 'developing' | 'stable';

const ALLOWED_STABILITY: MemoryStability[] = ['unknown', 'fragile', 'developing', 'stable'];

export interface MemoryTraceInput {
  userId: string;
  conceptKey: string;
  label?: string | null;
  masteryScore: number;
  stability?: MemoryStability;
  source?: string;
}

export interface SessionKnowledgeOutcome {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

/** knowledgeState 状态 → 内化强度（确定性映射，零 LLM；与 LearnerKnowledgeMemoryService 语义对齐） */
export function mapKnowledgeStatusToMastery(
  status: SessionKnowledgeOutcome['status'],
  progress: number,
): { masteryScore: number; stability: MemoryStability } {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  switch (status) {
    case 'mastered':
      return { masteryScore: p >= 100 ? 0.9 : 0.85, stability: 'stable' };
    case 'review':
      return { masteryScore: 0.5, stability: 'fragile' };
    case 'learning':
      return { masteryScore: 0.35, stability: 'developing' };
    case 'pending':
      return { masteryScore: 0.2, stability: 'unknown' };
    default:
      return { masteryScore: 0.3, stability: 'developing' };
  }
}

class MemoryTraceService {
  /** 记录一次提取/评估：upsert 痕迹并累计提取次数 */
  async recordExtraction(input: MemoryTraceInput): Promise<void> {
    const masteryScore = clamp01(input.masteryScore);
    const stability = ALLOWED_STABILITY.includes(input.stability as MemoryStability)
      ? (input.stability as MemoryStability)
      : 'developing';
    const now = new Date();
    await prisma.memory_traces.upsert({
      where: {
        userId_conceptKey: { userId: input.userId, conceptKey: input.conceptKey },
      },
      create: {
        id: `mt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        userId: input.userId,
        conceptKey: input.conceptKey,
        label: input.label ?? null,
        masteryScore,
        stability,
        lastSeenAt: now,
        extractionCount: 1,
        source: input.source ?? 'derived',
      },
      update: {
        label: input.label ?? undefined,
        masteryScore,
        stability,
        lastSeenAt: now,
        extractionCount: { increment: 1 },
        source: input.source ?? undefined,
      },
    });
  }

  /** endSession 后按知识看板状态确定性回写内化强度 */
  async recordSessionOutcome(
    userId: string,
    items: SessionKnowledgeOutcome[],
    source = 'derived',
  ): Promise<number> {
    let count = 0;
    for (const item of items) {
      if (!item?.name || !String(item.name).trim()) continue;
      const { masteryScore, stability } = mapKnowledgeStatusToMastery(item.status, item.progress);
      await this.recordExtraction({
        userId,
        conceptKey: String(item.name).trim(),
        masteryScore,
        stability,
        source,
      });
      count += 1;
    }
    return count;
  }

  /** 惰性检查：返回当前到期的复习痕迹（保留率升序，最紧急在前） */
  async getDueTraces(
    userId: string,
    options: {
      retentionTargetDays?: number;
      retentionThreshold?: number;
      now?: Date;
      limit?: number;
    } = {},
  ): Promise<Array<{
    conceptKey: string;
    label: string | null;
    masteryScore: number;
    stability: MemoryStability;
    lastSeenAt: Date | null;
    extractionCount: number;
    retention: number;
    intervalDays: number;
    reason: 'below-threshold' | 'interval-elapsed' | 'never-seen' | 'not-due';
  }>> {
    const now = options.now ?? new Date();
    const retentionTargetDays = Number.isFinite(options.retentionTargetDays)
      ? (options.retentionTargetDays as number)
      : DEFAULT_RETENTION_TARGET_DAYS;
    const threshold = Number.isFinite(options.retentionThreshold)
      ? clamp01(options.retentionThreshold!)
      : DEFAULT_RETENTION_THRESHOLD;
    const limit = Number.isInteger(options.limit) && (options.limit as number) > 0 ? options.limit : 20;

    const traces = await prisma.memory_traces.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });

    const due = traces
      .map((trace) => {
        const result = isReviewDue({
          masteryScore: trace.masteryScore,
          lastSeenAt: trace.lastSeenAt,
          retentionTargetDays,
          retentionThreshold: threshold,
          decayFactor: trace.decayFactor ?? DEFAULT_DECAY_FACTOR,
          intervalFactor: trace.intervalFactor ?? 1,
          now,
        });
        return {
          conceptKey: trace.conceptKey,
          label: trace.label,
          masteryScore: trace.masteryScore,
          stability: trace.stability as MemoryStability,
          lastSeenAt: trace.lastSeenAt,
          extractionCount: trace.extractionCount,
          retention: result.retention,
          intervalDays: result.intervalDays,
          reason: result.reason,
          due: result.due,
        };
      })
      .filter((item) => item.due)
      .sort((a, b) => a.retention - b.retention)
      .slice(0, limit);

    return due.map(({ due: _due, ...rest }) => rest);
  }

  /** 保留率快照（读取时计算，不落库） */
  async getRetentionSnapshot(
    userId: string,
    now: Date = new Date(),
  ): Promise<Array<{
    conceptKey: string;
    label: string | null;
    masteryScore: number;
    stability: MemoryStability;
    lastSeenAt: Date | null;
    extractionCount: number;
    retention: number;
  }>> {
    const traces = await prisma.memory_traces.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return traces.map((trace) => ({
      conceptKey: trace.conceptKey,
      label: trace.label,
      masteryScore: trace.masteryScore,
      stability: trace.stability as MemoryStability,
      lastSeenAt: trace.lastSeenAt,
      extractionCount: trace.extractionCount,
      retention: calculateRetention(
        trace.masteryScore,
        trace.lastSeenAt,
        now,
        trace.decayFactor ?? DEFAULT_DECAY_FACTOR,
      ),
    }));
  }

  async getTrace(userId: string, conceptKey: string) {    return prisma.memory_traces.findUnique({
      where: { userId_conceptKey: { userId, conceptKey } },
    });
  }

  /**
   * SM-2 式间隔递增：复习成功后下次间隔 ×2（factor 上限由 actr.MAX_INTERVAL_FACTOR 计算侧 clamp）。
   * 仅当痕迹存在时生效；best-effort。
   */
  async bumpReviewInterval(userId: string, conceptKey: string): Promise<void> {
    await prisma.memory_traces.updateMany({
      where: { userId, conceptKey },
      data: { intervalFactor: { multiply: 2 } },
    });
  }
}

/** 默认复习目标保留时间（天）：路径跨度的保守估计，调用方可按路径时长覆盖 */
export const DEFAULT_RETENTION_TARGET_DAYS = 7;

export const memoryTraceService = new MemoryTraceService();
