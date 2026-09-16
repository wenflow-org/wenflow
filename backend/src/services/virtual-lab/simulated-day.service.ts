/**
 * SimulatedDayService —— 虚拟学习者"日期模拟"只读聚合（P1）
 *
 * 设计：doc/local/VIRTUAL_LEARNER_SIMULATED_DAY_DRAFT.md §C2/§C4/§8.8。
 * 机制：**不 mock 时钟**，把"第 dayIndex 天"映射为日历 `baseDate + dayIndex`（UTC 日界，与
 * `getAggregatedState.dayLoad` / `ReviewQuotaService` 同口径），再以该日 **asOf** 读回——
 * 聚合、配额、记忆保留率、难度调整留痕全部来自已落地读写缝，**不新增实体、不自造口径**。
 *
 * 只读：本模块不写任何业务表；推进（写）属 P2，由系统层负责。
 */
import prisma from '../../config/database';
import { safeJsonParse } from '../../utils/safe-json';
import learningStateService, { type AggregatedLearningState } from '../learning/learning-state.service';
import { derivePacing } from '../learner/LearnerSnapshotService';
import {
  reviewQuotaService,
  type ReviewDailyState,
} from '../memory/review-quota.service';
import { memoryTraceService } from '../memory/memory-trace.service';
import {
  ADJUSTMENT_EVIDENCE_TYPE,
  parseAdjustment,
} from '../learner/TaskDifficultyAdjustmentLedger';
import {
  DEFAULT_VIRTUAL_LAB_SETTINGS,
  getVirtualLabSettings,
  type VirtualLabDateSimulationSettings,
} from '../virtual-lab-settings.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export type Pacing = 'slow' | 'moderate' | 'fast';

export interface SimulationClockView {
  enabled: boolean;
  status: 'disabled' | 'ready' | 'in_progress';
  timezone: string;
  baseDate: string;        // 'YYYY-MM-DD'
  dayIndex: number;        // 1-based 语义：已推进的天数（0=尚未推进）
  /** 自 baseDate 起已过的自然日天数（派生，用于"进度"展示；夹紧到 [0, maxSimulatedDays]） */
  elapsedDays: number;
  simulatedNow: string;    // ISO
  /** 护栏：单会话最多模拟天数（来自设置） */
  maxSimulatedDays: number;
}

export interface SimulatedDayTask {
  taskId: string;
  title: string;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  cognitiveLoad: string | null;
  completedAt: string | null;
}

export interface SimulatedDayAdjustment {
  taskId: string;
  baseline: number;
  adjusted: number;
  direction: string;
  reasons: string[];
  applied: boolean;
  at: string;
}

export interface SimulatedDayEntry {
  dayIndex: number;
  simulatedDay: string;
  asOf: string;
  dayLoad: { lessons: number; minutes: number; fatigueBonus: number } | null;
  metrics: { lss: number; ktl: number; lf: number; lsb: number } | null;
  pacing: Pacing | null;
  perPath: Array<{ pathId: string; lss: number; ktl: number; lf: number; lsb: number }>;
  signals: string[];
  tasks: SimulatedDayTask[];
  difficultyAdjustments: SimulatedDayAdjustment[];
  reviewQuota: { limitLoad: number; usedLoad: number; remainingLoad: number; usedCount: number };
  memory: { traceCount: number; dueCount: number; fragileCount: number; stableCount: number; avgRetention: number | null };
}

export interface DayTimeline {
  baseDate: string;
  fromDay: number;
  toDay: number;
  days: SimulatedDayEntry[];
}

export interface SimulatedDayDeps {
  getAggregatedState: (userId: string, options: { asOf: Date }) => Promise<AggregatedLearningState | null>;
  getDailyQuota: (userId: string, options: { now: Date }) => Promise<ReviewDailyState>;
  getDueTraces: (userId: string, options: { now: Date; limit: number }) => Promise<Array<{ conceptKey: string }>>;
  getRetentionSnapshot: (userId: string, now: Date) => Promise<Array<{ stability: string; retention: number; lastSeenAt: Date | null }>>;
  findTasks: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  findSessions: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  findEvidence: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
}

const defaultDeps: SimulatedDayDeps = {
  getAggregatedState: (userId, options) => learningStateService.getAggregatedState(userId, options),
  getDailyQuota: (userId, options) => reviewQuotaService.getDailyState(userId, options),
  getDueTraces: (userId, options) => memoryTraceService.getDueTraces(userId, options) as any,
  getRetentionSnapshot: (userId, now) => memoryTraceService.getRetentionSnapshot(userId, now) as any,
  findTasks: (args) => prisma.subtasks.findMany(args as any) as any,
  findSessions: (args) => prisma.teaching_sessions.findMany(args as any) as any,
  findEvidence: (args) => prisma.learner_evidence.findMany(args as any) as any,
};

/* ============ 纯函数（可单测） ============ */

/** 解析 'YYYY-MM-DD' 或 ISO → 该日历日的 UTC 零点 */
export function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!match) return new Date(Date.UTC(1970, 0, 1));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * 第 dayIndex 天的窗口（UTC 日界，与 getAggregatedState.dayLoad / ReviewQuotaService 同口径）。
 * asOf 取当天 23:59:59.999，使 `[dayStart, asOf]` 覆盖整日。
 */
export function resolveDayWindow(baseDate: string | Date, dayIndex: number): {
  dayStart: Date;
  dayEnd: Date;
  asOf: Date;
  simulatedDay: string;
} {
  const base = parseDateOnly(baseDate);
  const dayStart = new Date(base.getTime() + Math.max(0, Math.trunc(dayIndex)) * DAY_MS);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS - 1);
  return { dayStart, dayEnd, asOf: dayEnd, simulatedDay: toDateOnly(dayStart) };
}

export interface SimulationClockInput {
  stageResultsClock?: {
    baseDate?: string | null;
    simulatedNow?: string | null;
    dayIndex?: number | null;
    timezone?: string | null;
  } | null;
  profileClock?: { enabled?: boolean | null; startDate?: string | null } | null;
  settings: VirtualLabDateSimulationSettings;
  sessionCreatedAt: Date;
  sessionStatus?: string | null;
  currentStage?: string | null;
  /** 计算 elapsedDays 的"现在"（缺省真墙钟；测试可注入） */
  now?: Date;
}

/** 解析会话的模拟时钟（session > profile > global 优先级；默认关）。 */
export function resolveSimulationClock(input: SimulationClockInput): SimulationClockView {
  const enabled = input.profileClock?.enabled ?? input.settings.enabled;
  const baseDateRaw = input.profileClock?.startDate
    || input.stageResultsClock?.baseDate
    || toDateOnly(input.sessionCreatedAt);
  const baseDate = toDateOnly(parseDateOnly(baseDateRaw));
  const dayIndex = Math.max(0, Math.trunc(Number(input.stageResultsClock?.dayIndex) || 0));
  const window = resolveDayWindow(baseDate, dayIndex);
  const timezone = input.stageResultsClock?.timezone || input.settings.timezone;
  const simulatedNow = input.stageResultsClock?.simulatedNow || window.asOf.toISOString();
  const now = input.now ?? new Date();
  const elapsedDays = Math.min(
    input.settings.maxSimulatedDays,
    Math.max(0, Math.floor((now.getTime() - parseDateOnly(baseDate).getTime()) / DAY_MS)),
  );

  return {
    enabled,
    status: !enabled ? 'disabled' : dayIndex > 0 ? 'in_progress' : 'ready',
    timezone,
    baseDate,
    dayIndex,
    elapsedDays,
    simulatedNow,
    maxSimulatedDays: input.settings.maxSimulatedDays,
  };
}

/** 单日聚合（注入 deps，便于单测）。 */
export async function buildDayEntry(
  userId: string,
  baseDate: string,
  dayIndex: number,
  deps: SimulatedDayDeps = defaultDeps,
): Promise<SimulatedDayEntry> {
  const win = resolveDayWindow(baseDate, dayIndex);
  const [state, quota, dueTraces, retention, tasks, sessions, evidence] = await Promise.all([
    deps.getAggregatedState(userId, { asOf: win.asOf }).catch(() => null),
    deps.getDailyQuota(userId, { now: win.asOf }).catch(() => ({
      date: win.simulatedDay, limitLoad: 0, usedLoad: 0, usedCount: 0, remainingLoad: 0, reservedKeys: [],
    } as ReviewDailyState)),
    deps.getDueTraces(userId, { now: win.asOf, limit: 50 }).catch(() => []),
    deps.getRetentionSnapshot(userId, win.asOf).catch(() => []),
    deps.findTasks({
      where: { userId, status: 'completed', completedAt: { gte: win.dayStart, lte: win.dayEnd } },
      select: { id: true, title: true, estimatedMinutes: true, cognitiveLoad: true, completedAt: true },
    }).catch(() => []),
    deps.findSessions({
      where: { userId, startTime: { gte: win.dayStart, lte: win.dayEnd } },
      select: { taskId: true, duration: true },
    }).catch(() => []),
    deps.findEvidence({
      where: { userId, evidenceType: ADJUSTMENT_EVIDENCE_TYPE, occurredAt: { gte: win.dayStart, lte: win.dayEnd } },
      select: { taskId: true, payload: true, occurredAt: true },
    }).catch(() => []),
  ]);

  const minutesByTask = new Map<string, number>();
  for (const session of sessions) {
    const taskId = typeof session.taskId === 'string' ? session.taskId : '';
    const duration = Number(session.duration);
    if (!taskId || !Number.isFinite(duration)) continue;
    minutesByTask.set(taskId, (minutesByTask.get(taskId) || 0) + duration);
  }

  const metrics = state?.metrics
    ? { lss: state.metrics.lss, ktl: state.metrics.ktl, lf: state.metrics.lf, lsb: state.metrics.lsb }
    : null;

  const signals: string[] = [];
  if (metrics) {
    if (metrics.lf >= 6) signals.push('fatigue_high');
    if (metrics.lsb < 0) signals.push('lsb_negative');
  }

  const adjustments: SimulatedDayAdjustment[] = [];
  for (const row of evidence) {
    const parsed = parseAdjustment(typeof row.payload === 'string' ? row.payload : row.payload ? JSON.stringify(row.payload) : null);
    if (!parsed) continue;
    adjustments.push({
      taskId: String(row.taskId || ''),
      baseline: parsed.baseline,
      adjusted: parsed.adjusted,
      direction: parsed.direction,
      reasons: parsed.reasons,
      applied: parsed.applied,
      at: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt || ''),
    });
  }

  // 记忆：仅统计"该模拟日当天已存在"的痕迹（lastSeenAt <= asOf），避免未来痕迹倒灌
  const inWindowTraces = retention.filter((trace) => !trace.lastSeenAt || trace.lastSeenAt.getTime() <= win.asOf.getTime());
  const avgRetention = inWindowTraces.length > 0
    ? Math.round((inWindowTraces.reduce((sum, trace) => sum + trace.retention, 0) / inWindowTraces.length) * 1000) / 1000
    : null;

  return {
    dayIndex,
    simulatedDay: win.simulatedDay,
    asOf: win.asOf.toISOString(),
    dayLoad: state?.dayLoad ?? null,
    metrics,
    pacing: metrics ? derivePacing(metrics.lf, metrics.ktl) : null,
    perPath: (state?.perPath ?? []).map((entry) => ({
      pathId: entry.pathId,
      lss: entry.metrics.lss,
      ktl: entry.metrics.ktl,
      lf: entry.metrics.lf,
      lsb: entry.metrics.lsb,
    })),
    signals,
    tasks: tasks.map((task) => ({
      taskId: String(task.id || ''),
      title: String(task.title || ''),
      estimatedMinutes: Number.isFinite(Number(task.estimatedMinutes)) ? Number(task.estimatedMinutes) : null,
      actualMinutes: minutesByTask.get(String(task.id || '')) ?? null,
      cognitiveLoad: typeof task.cognitiveLoad === 'string' ? task.cognitiveLoad : null,
      completedAt: task.completedAt instanceof Date ? task.completedAt.toISOString() : (task.completedAt ? String(task.completedAt) : null),
    })),
    difficultyAdjustments: adjustments,
    reviewQuota: {
      limitLoad: quota.limitLoad,
      usedLoad: quota.usedLoad,
      remainingLoad: quota.remainingLoad,
      usedCount: quota.usedCount,
    },
    memory: {
      traceCount: inWindowTraces.length,
      dueCount: dueTraces.length,
      fragileCount: inWindowTraces.filter((trace) => trace.stability === 'fragile').length,
      stableCount: inWindowTraces.filter((trace) => trace.stability === 'stable').length,
      avgRetention,
    },
  };
}

export async function buildDayTimeline(
  input: { userId: string; baseDate: string; fromDay?: number; toDay: number; maxDays?: number },
  deps: SimulatedDayDeps = defaultDeps,
): Promise<DayTimeline> {
  const maxDays = Math.max(0, Math.trunc(input.maxDays ?? 365));
  const fromDay = Math.max(0, Math.trunc(input.fromDay ?? 0));
  const toDay = Math.min(maxDays, Math.max(fromDay, Math.trunc(input.toDay)));
  const days: SimulatedDayEntry[] = [];
  for (let dayIndex = fromDay; dayIndex <= toDay; dayIndex += 1) {
    days.push(await buildDayEntry(input.userId, input.baseDate, dayIndex, deps));
  }
  return { baseDate: toDateOnly(parseDateOnly(input.baseDate)), fromDay, toDay, days };
}

/* ============ DB 绑定入口 ============ */

class SimulatedDayService {
  /** 会话模拟时钟（默认关；未配置时以会话创建日为 baseDate、dayIndex=0）。 */
  async getSimulationClock(sessionId: string): Promise<SimulationClockView | null> {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: {
        id: true, userId: true, status: true, currentStage: true,
        stageResults: true, createdAt: true, virtualProfileId: true,
      },
    });
    if (!session) return null;
    const [settings, profile] = await Promise.all([
      getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS })),
      prisma.virtual_learner_profiles.findUnique({
        where: { id: session.virtualProfileId },
        select: { profile: true },
      }).catch(() => null),
    ]);
    const stageResults = safeJsonParse<Record<string, any>>(session.stageResults, {});
    const profileData = safeJsonParse<Record<string, any>>(profile?.profile, {});
    return resolveSimulationClock({
      stageResultsClock: stageResults?.simulationClock ?? null,
      profileClock: profileData?.simulationClock ?? null,
      settings: settings.dateSimulation,
      sessionCreatedAt: session.createdAt,
      sessionStatus: session.status,
      currentStage: session.currentStage,
    });
  }

  /** 会话按天时间线（只读）。baseDate 缺省取时钟；范围用设置护栏夹紧。 */
  async getDayTimeline(input: {
    sessionId: string;
    baseDate?: string;
    fromDay?: number;
    toDay?: number;
  }): Promise<DayTimeline | null> {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: input.sessionId },
      select: { id: true, userId: true, createdAt: true },
    });
    if (!session) return null;
    const clock = await this.getSimulationClock(input.sessionId);
    const baseDate = input.baseDate || clock?.baseDate || toDateOnly(session.createdAt);
    const maxDays = clock?.maxSimulatedDays ?? DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation.maxSimulatedDays;
    const fromDay = input.fromDay ?? 0;
    const toDay = input.toDay ?? Math.min(maxDays, Math.max(fromDay, clock?.dayIndex ?? 0));
    return buildDayTimeline({ userId: session.userId, baseDate, fromDay, toDay, maxDays });
  }
}

export const simulatedDayService = new SimulatedDayService();
export default simulatedDayService;
