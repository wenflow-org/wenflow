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
import { recordDegradation, degradationCause, type DegradationTelemetry } from '../../skills/degradation-telemetry';

const DAY_MS = 24 * 60 * 60 * 1000;

export type Pacing = 'slow' | 'moderate' | 'fast';

export interface SimulationClockView {
  enabled: boolean;
  status: 'disabled' | 'ready' | 'in_progress';
  timezone: string;
  baseDate: string;        // 'YYYY-MM-DD'
  dayIndex: number;        // 1-based 语义：已推进的天数（0=尚未推进）
  simulatedNow: string;    // ISO
  /** 护栏：单会话最多模拟天数（来自设置） */
  maxSimulatedDays: number;
  /** 会话级自动推进开关（落在 stageResults.simulationClock.autoAdvance） */
  autoAdvance: boolean;
  /** 课表：一周中上课的星期（0=周日 … 6=周六） */
  courseWeekdays: number[];
  /** 课表：每天安排几节 */
  lessonsPerDay: number;
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
  /** 非空表示本日聚合是**降级产物**（某路读取失败→保底值） */
  degraded?: DegradationTelemetry[];
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
    autoAdvance?: boolean | null;
    enabled?: boolean | null;
  } | null;
  profileClock?: { enabled?: boolean | null; startDate?: string | null } | null;
  settings: VirtualLabDateSimulationSettings;
  sessionCreatedAt: Date;
  sessionStatus?: string | null;
  currentStage?: string | null;
}

/** 解析会话的模拟时钟（session > profile > global 优先级；默认关）。 */
export function resolveSimulationClock(input: SimulationClockInput): SimulationClockView {
  const enabled = input.stageResultsClock?.enabled ?? input.profileClock?.enabled ?? input.settings.enabled;
  // baseDate 与 enabled 同口径：session > profile > 会话创建日。
  // （18 号报告观察项：此前写成 profile 优先，与注释相反 → 画像一旦配了 startDate，
  //   管理端在会话上设的 baseDate 会被静默忽略。）
  const baseDateRaw = input.stageResultsClock?.baseDate
    || input.profileClock?.startDate
    || toDateOnly(input.sessionCreatedAt);
  const baseDate = toDateOnly(parseDateOnly(baseDateRaw));
  const dayIndex = Math.max(0, Math.trunc(Number(input.stageResultsClock?.dayIndex) || 0));
  const window = resolveDayWindow(baseDate, dayIndex);
  const timezone = input.stageResultsClock?.timezone || input.settings.timezone;
  const simulatedNow = input.stageResultsClock?.simulatedNow || window.asOf.toISOString();

  return {
    enabled,
    status: !enabled ? 'disabled' : dayIndex > 0 ? 'in_progress' : 'ready',
    timezone,
    baseDate,
    dayIndex,
    simulatedNow,
    maxSimulatedDays: input.settings.maxSimulatedDays,
    autoAdvance: input.stageResultsClock?.autoAdvance === true,
    courseWeekdays: [...input.settings.courseWeekdays],
    lessonsPerDay: input.settings.lessonsPerDay,
  };
}

/** 是否为课表内的上课日（0=周日 … 6=周六，UTC 日界） */
export function isCourseDay(baseDate: string | Date, dayIndex: number, courseWeekdays: number[]): boolean {
  const weekdays = courseWeekdays.length ? courseWeekdays : [1, 2, 3, 4, 5];
  const day = new Date(parseDateOnly(baseDate).getTime() + Math.max(0, Math.trunc(dayIndex)) * DAY_MS);
  return weekdays.includes(day.getUTCDay());
}

/**
 * 距"上一次学习"的自然日数（课表口径）：当前 dayIndex 与最近一个上课日 dayIndex 的差。
 * - `dayIndex<=0`（尚未推进）→ null：没有"上一次学习"。
 * - 往前找最近的**上课日**（含起点日 0，因为起点日也可能是上课日）；本次推进之前若没有任何
 *   上课日 → null。
 * 说明：虚拟会话逐日推进，实际学习发生在课表内的上课日；跨周末会自然得到 2~3 天。
 */
export function previousCourseDayGap(baseDate: string, dayIndex: number, courseWeekdays: number[]): number | null {
  const day = Math.max(0, Math.trunc(dayIndex));
  if (day <= 0) return null;
  for (let cursor = day - 1; cursor >= 0; cursor -= 1) {
    if (isCourseDay(baseDate, cursor, courseWeekdays)) return day - cursor;
  }
  return null;
}

/**
 * 从 fromDayIndex 之后，收集 count 个"上课日"的 dayIndex（按课表跳过非上课日）。
 * 用于手动/自动推进：推进 N 个上课日，而不是 N 个自然日。
 */
export function collectCourseDayIndexes(
  baseDate: string | Date,
  fromDayIndex: number,
  courseWeekdays: number[],
  count: number,
): number[] {
  const total = Math.max(0, Math.trunc(count));
  const result: number[] = [];
  let cursor = Math.max(0, Math.trunc(fromDayIndex));
  // 最多向后找 total*7 + 7 天，防止课表为空时死循环
  const hardLimit = cursor + total * 7 + 7;
  while (result.length < total && cursor < hardLimit) {
    cursor += 1;
    if (isCourseDay(baseDate, cursor, courseWeekdays)) result.push(cursor);
  }
  return result;
}

export interface TemporalContext {
  simulatedNow: string;
  simulatedDay: string;
  dayIndex: number;
  timezone: string;
  /** 距上一次学习几天（可选；缺省不注入，由调用方补） */
  sinceLastSessionDays?: number | null;
}

/** 仅为"已开启日期模拟"的会话产出 temporalContext；否则返回 null（输入里省略该键 = 现网不变）。 */
export function temporalContextFromClock(clock: SimulationClockView | null | undefined): TemporalContext | null {
  if (!clock || !clock.enabled) return null;
  const window = resolveDayWindow(clock.baseDate, clock.dayIndex);
  const sinceLastSessionDays = previousCourseDayGap(clock.baseDate, clock.dayIndex, clock.courseWeekdays);
  return {
    simulatedNow: clock.simulatedNow,
    simulatedDay: window.simulatedDay,
    dayIndex: clock.dayIndex,
    timezone: clock.timezone,
    // 无"上一次学习"时**省略该键**（而不是给 null）：prompt 规则以"键缺失=不得提及时间跨度"为准
    ...(sinceLastSessionDays !== null ? { sinceLastSessionDays } : {}),
  };
}

/** 单日聚合（注入 deps，便于单测）。 */
export async function buildDayEntry(
  userId: string,
  baseDate: string,
  dayIndex: number,
  deps: SimulatedDayDeps = defaultDeps,
  now: Date = new Date(),
): Promise<SimulatedDayEntry> {
  const win = resolveDayWindow(baseDate, dayIndex);
  // P0 护栏：模拟读不得越过真实"现在"（防把真实历史卷进聚合）；未来日直接返回空（不读）
  const asOf = new Date(Math.min(win.asOf.getTime(), now.getTime()));
  const isFuture = win.dayStart.getTime() > now.getTime();
  if (isFuture) {
    return {
      dayIndex,
      simulatedDay: win.simulatedDay,
      asOf: asOf.toISOString(),
      dayLoad: null,
      metrics: null,
      pacing: null,
      perPath: [],
      signals: [],
      tasks: [],
      difficultyAdjustments: [],
      reviewQuota: { limitLoad: 0, usedLoad: 0, remainingLoad: 0, usedCount: 0 },
      memory: { traceCount: 0, dueCount: 0, fragileCount: 0, stableCount: 0, avgRetention: null },
    };
  }
  const degraded: DegradationTelemetry[] = [];
  const degradeTo = <T>(dimension: string, fallback: T, mitigation: string) => (error: unknown): T => {
    degraded.push(recordDegradation({
      source: 'virtual-lab/simulated-day',
      faultCategory: 'DB_READ_FAILED',
      severity: 'P2_DEGRADED',
      impactedDimensions: [dimension],
      mitigationApplied: mitigation,
      rootCauseMessage: degradationCause(error),
    }));
    return fallback;
  };
  const [state, quota, dueTraces, retention, tasks, sessions, evidence] = await Promise.all([
    deps.getAggregatedState(userId, { asOf }).catch(degradeTo('dayLoad', null, 'return-null-day-load')),
    deps.getDailyQuota(userId, { now: asOf }).catch(degradeTo('reviewQuota', {
      date: win.simulatedDay, limitLoad: 0, usedLoad: 0, usedCount: 0, remainingLoad: 0, reservedKeys: [],
    } as ReviewDailyState, 'return-zero-quota')),
    deps.getDueTraces(userId, { now: asOf, limit: 50 }).catch(degradeTo('dueTraces', [], 'return-empty-due')),
    deps.getRetentionSnapshot(userId, asOf).catch(degradeTo('retention', [], 'return-empty-retention')),
    deps.findTasks({
      where: { userId, status: 'completed', completedAt: { gte: win.dayStart, lte: asOf } },
      select: { id: true, title: true, estimatedMinutes: true, cognitiveLoad: true, completedAt: true },
    }).catch(degradeTo('tasks', [], 'return-empty-tasks')),
    deps.findSessions({
      where: { userId, startTime: { gte: win.dayStart, lte: asOf } },
      select: { taskId: true, duration: true },
    }).catch(degradeTo('sessions', [], 'return-empty-sessions')),
    deps.findEvidence({
      where: { userId, evidenceType: ADJUSTMENT_EVIDENCE_TYPE, occurredAt: { gte: win.dayStart, lte: asOf } },
      select: { taskId: true, payload: true, occurredAt: true },
    }).catch(degradeTo('difficultyAdjustments', [], 'return-empty-adjustments')),
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
  const inWindowTraces = retention.filter((trace) => !trace.lastSeenAt || trace.lastSeenAt.getTime() <= asOf.getTime());
  const avgRetention = inWindowTraces.length > 0
    ? Math.round((inWindowTraces.reduce((sum, trace) => sum + trace.retention, 0) / inWindowTraces.length) * 1000) / 1000
    : null;

  return {
    dayIndex,
    simulatedDay: win.simulatedDay,
    asOf: asOf.toISOString(),
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
    ...(degraded.length ? { degraded } : {}),
  };
}

export async function buildDayTimeline(
  input: { userId: string; baseDate: string; fromDay?: number; toDay: number; maxDays?: number },
  deps: SimulatedDayDeps = defaultDeps,
  now: Date = new Date(),
): Promise<DayTimeline> {
  const maxDays = Math.max(0, Math.trunc(input.maxDays ?? 365));
  const fromDay = Math.max(0, Math.trunc(input.fromDay ?? 0));
  const toDay = Math.min(maxDays, Math.max(fromDay, Math.trunc(input.toDay)));
  const days: SimulatedDayEntry[] = [];
  for (let dayIndex = fromDay; dayIndex <= toDay; dayIndex += 1) {
    days.push(await buildDayEntry(input.userId, input.baseDate, dayIndex, deps, now));
  }
  return { baseDate: toDateOnly(parseDateOnly(input.baseDate)), fromDay, toDay, days };
}

/* ============ DB 绑定入口 ============ */

/** 纯函数：按课表把时钟推进 days 个"上课日"（返回 null = 已到上限/课表为空）。 */
export function planClockAdvance(
  clock: SimulationClockView,
  rawClock: Record<string, any> | null | undefined,
  days: number,
  now: Date = new Date(),
): { indexes: number[]; nextClock: Record<string, any> } | null {
  const want = Math.max(1, Math.trunc(days) || 1);
  const indexes = collectCourseDayIndexes(clock.baseDate, clock.dayIndex, clock.courseWeekdays, want)
    .filter((index) => index <= clock.maxSimulatedDays)
    // P0 护栏：不推进到"未来日"（避免 asOf 越过真实现在、把真实历史卷进聚合）
    .filter((index) => resolveDayWindow(clock.baseDate, index).dayStart.getTime() <= now.getTime());
  if (!indexes.length) return null;

  const history = Array.isArray(rawClock?.history) ? [...rawClock!.history] : [];
  for (const index of indexes) {
    const win = resolveDayWindow(clock.baseDate, index);
    history.push({
      dayIndex: index,
      simulatedDay: win.simulatedDay,
      advancedAt: now.toISOString(),
      plannedLessons: clock.lessonsPerDay,
    });
  }
  const lastIndex = indexes[indexes.length - 1];
  const lastWindow = resolveDayWindow(clock.baseDate, lastIndex);
  return {
    indexes,
    nextClock: {
      ...(rawClock || {}),
      dayIndex: lastIndex,
      simulatedNow: lastWindow.asOf.toISOString(),
      advancedTimes: (Number(rawClock?.advancedTimes) || 0) + indexes.length,
      history: history.slice(-200),
    },
  };
}

/**
 * 评审结论是否**真正进入了 Learn**（teaching/learn 阶段）。
 *
 * `resolvePathReview({startLearning:true})` 在 `decision=modify` 且重规划成功时返回
 * `success:true` 但 `currentStage` 仍为 `path`——此时当天并没有上课。调用方（推进并上课）
 * 必须据此判定"这一天是否真的用掉了"，否则会 advance 成功却"烧掉"一个模拟日。
 */
export function resolutionEnteredLearn(
  resolution: { success?: boolean; currentStage?: string | null } | null | undefined,
): boolean {
  if (!resolution?.success) return false;
  const stage = String(resolution.currentStage ?? '');
  return stage === 'teaching' || stage === 'learn';
}

/**
 * 「推进并上课」当天成果汇总：**只有至少一节课成功**才算这天被真正用掉。
 *
 * 反例（实测）：会话已 failed/停止时 `executeAutoLearning` 立即返回失败，旧实现仍
 * `started:true, chunks:1` → 时钟照推、当天没有任何教学产物（白烧一个模拟日）。
 */
/**
 * 是否推进模拟时钟（跑数观察 #4）。
 *
 * 规则：`runTasks=false`（纯记账）→ 推进；`runTasks=true` → **只有当天确实上了课（started=true）才推进**。
 * 未推进时该模拟日不被消耗，调用方可重试同一天。
 *
 * 关键：不再"先推进再回滚"——回滚只回滚得了 `simulationClock` 一个字段，回滚不了当天已写入的
 * 课堂/记忆/难度锚点，会造成"日期被回滚、数据却留着"的口径分裂。
 */
export function shouldAdvanceSimulationClock(input: {
  runTasks: boolean;
  learning?: { started?: boolean } | null;
}): boolean {
  if (!input.runTasks) return true;
  return input.learning?.started === true;
}

export function summarizeDayLearning(
  attempts: Array<{ success?: boolean; error?: string | null } | null | undefined>,
): { started: boolean; chunks: number; error?: string } {
  const list = Array.isArray(attempts) ? attempts : [];
  const chunks = list.filter((item) => item?.success === true).length;
  if (chunks > 0) return { started: true, chunks };
  const reason = list.find((item) => item?.error)?.error || null;
  return { started: false, chunks: 0, error: reason || '当天未能完成任何一节课（未推进模拟日）' };
}

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

  /**
   * 从"已加载的会话"派生 temporalContext（免二次查询；供虚拟学习者技能注入"第几天/已过几天"）。
   * 仅当日期模拟开启且被显式启用时返回；否则 null（技能输入里省略该键 = 现网不变）。
   */
  async getTemporalContext(session: {
    stageResults: string | null;
    createdAt: Date;
    virtual_learner_profiles?: { profile?: string | null } | null;
  }): Promise<TemporalContext | null> {
    const settings = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
    const stageResults = safeJsonParse<Record<string, any>>(session.stageResults, {});
    const profileData = safeJsonParse<Record<string, any>>(session.virtual_learner_profiles?.profile, {});
    const clock = resolveSimulationClock({
      stageResultsClock: stageResults?.simulationClock ?? null,
      profileClock: profileData?.simulationClock ?? null,
      settings: settings.dateSimulation,
      sessionCreatedAt: session.createdAt,
    });
    return temporalContextFromClock(clock);
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
