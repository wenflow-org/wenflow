/**
 * Learning State 类型与纯函数层（2026-10-24 架构优化批 1：learning-state.service.ts 拆分）。
 *
 * 这里只放「与 DB 无关」的共享资产：接口/品牌类型/EWMA 与自然衰减常量/刻度转换函数。
 * 服务实现拆为：
 * - learning-state.service.ts      —— 类外壳：提交管线 + 原始读取 + 门面委托（保住既有 spy 面）
 * - learning-state-reads.ts        —— PMC 派生 / 趋势窗口 / 展示层 / 预警（读侧）
 * - learning-state-history.ts      —— 已提交行查询条件与快照复原助手
 * - learning-state-advisor.ts      —— 对话认知层级分析与建议（旧展示 API）
 * 本文件的导出由 learning-state.service.ts `export *` 兜底再导出，既有导入方不受拆分影响。
 */
import { logger } from '../../utils/logger';

// EWMA 配置（半衰期按日更新折算：h = ln(0.5)/ln(λ)）
export const EWMA_CONFIG = {
  KTL_LAMBDA: 0.95,  // 半衰期 ≈ 13.5 天（周衰减 0.95^7 ≈ 0.70）
  LF_LAMBDA: 0.70,   // 半衰期 ≈ 1.9 天
};

export const NATURAL_DECAY = {
  LSS_DAILY_FACTOR: 0.82,
  KTL_DAILY_FACTOR: 0.99,
  LF_DAILY_FACTOR: 0.74,
  LF_BASELINE: 1.2,
};

/**
 * ── 量纲品牌类型（把"刻度"从注释变成类型） ─────────────────────────────
 * 历史事故（2026-09-16 修复）：同一个 `lss` 在落库侧是 0-10、在回调契约里是 0-100，
 * 而两者都是 `number` —— 于是"多除一个 10"能一路静默通过测试与审阅，线上值被压成 0.4。
 * 现在：转换函数的输出带品牌，**普通 number 无法直接塞进 display 契约**，
 * 必须显式经过 `internalTenToDisplay` / `asDisplayHundred`（各自的刻度假设写在函数名与注释里）。
 */
export type InternalTen = number & { readonly __scale: 'internal-10' };
export type InternalBalance = number & { readonly __scale: 'internal-balance' };
export type DisplayHundred = number & { readonly __scale: 'display-100' };
export type DisplayBalance = number & { readonly __scale: 'display-balance' };

// LSS 输入参数
export interface LSSInputs {
  difficulty: number;      // 任务难度 1-10
  cognitiveLoad: number;   // 认知负荷 1-10
  efficiency: number;      // 学习效率 0-1
  timeSpent: number;       // 实际用时(分钟)
  expectedTime: number;    // 预期用时(分钟)
  completionRate: number;  // 完成率 0-1
  taskType: 'reading' | 'practice' | 'project' | 'quiz';
}

// 学习状态指标
export interface LearningStateMetrics {
  lss: InternalTen;      // Learning Stress Score（0-10，品牌类型防止与 display 混淆）
  ktl: InternalTen;      // Knowledge Training Load（0-10）
  lf: InternalTen;       // Learning Fatigue（0-10）
  lsb: InternalBalance;  // Learning State Balance（-10..+10）
  timestamp: Date;
}

/** display 刻度指标（0-100 / -100..100）：与内部刻度**不同类型**，杜绝两者互相赋值 */
export interface DisplayMetrics {
  lss: DisplayHundred;
  ktl: DisplayHundred;
  lf: DisplayHundred;
  lsb: DisplayBalance;
  timestamp: Date;
}

// 显示层指标（0-100 刻度，前端展示用；原 state-tracking.service 类型，2026-08 合并入本服务）
export interface LearningStateDisplayMetrics {
  lss: number; // Learning Stress Score (0-100)
  ktl: number; // Knowledge Training Load (0-100, EWMA)
  lf: number;  // Learning Fatigue (0-100, short-term EWMA)
  lsb: number; // Learning State Balance = KTL - LF (-100 to +100)
  updatedAt?: string;
  /**
   * 适应基座是否成熟（PMC 口径下 KTL 达相对量判据下限）。
   * 未成熟时 form<0 是冷启动爬升的正常现象，**不能**按「严重疲劳」展示/建议——
   * 前端与建议引擎据此把绝对 LSB 分档降级为「积累中」。
   */
  mature?: boolean;
  /** 相对量负荷判据（与 /state/warnings 同源），供消费方避免各自写绝对阈值 */
  verdict?: {
    form: number;
    acwr: number | null;
    fatigueRisk: 'low' | 'medium' | 'high';
    pacing: 'slow' | 'moderate' | 'fast';
    imbalanced: boolean;
    mature: boolean;
  };
}

export interface LearningStateTrendPoint {
  date: Date;
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
  /** 该日 PMC 基座是否成熟（与 current 的 mature 同判据） */
  mature?: boolean;
}

export interface LearningStateTrendWindow {
  trends: LearningStateTrendPoint[];
  range: {
    mode: 'recent' | 'all';
    requestedDays: number | 'all';
    actualDays: number;
    registeredAt: string;
    startDate: string;
    endDate: string;
  };
}

export type LearningStateWarning = {
  type: 'fatigue' | 'lsb_negative' | 'efficiency_drop' | 'overstudy';
  level: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  suggestion: string;
};

export interface SessionScoreInput {
  sessionLss: number;
  sessionKtl?: number;
  sessionLf?: number;
  durationMinutes: number;
  confidence?: number;
  pathId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
}

export interface LearningStateMetricPersistOptions {
  sourceKey?: string | null;
  version?: string;
  committed?: boolean;
  source?: string;
  pathId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
  primaryMetric?: 'lss' | 'lsb';
  synthetic?: boolean;
}

/**
 * PMC 读侧预取行（includeSynthetic=true 口径，即 derivePmcState / derivePmcDailySeries 的取数口径）。
 * 供 getStateTrendWindow / getAggregatedState 一次取回后多路复用，替代同数据的多次全量 findMany。
 */
export interface PmcPreloadedMetricRow {
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  calculatedAt: Date;
  sourceKey: string | null;
  taskId: string | null;
  pathId: string | null;
}

export interface DisplayMetricCommitInput {
  /** display 刻度（0-100）：必须由 internalTenToDisplay / asDisplayHundred 产出。
   *  品牌类型会让"直接把 0-10 值或未经归一的原始值塞进来"在编译期失败——
   *  历史事故正是这样发生的（lss=0-10 被当成 0-100，落库时又多除一个 10）。 */
  lss: DisplayHundred;
  ktl: DisplayHundred;
  lf: DisplayHundred;
  lsb: DisplayBalance;
  expectedRevision: number;
  sourceKey?: string;
  timestamp?: Date;
  source?: string;
  pathId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
  primaryMetric?: 'lss' | 'lsb';
  /**
   * 本行 LSS 是「占位值」而非实测量（如 task-completion 在无主观难度时按默认难度 5 套公式）。
   * 落 metadata.synthetic=true，供聚合侧显式区分；与 session-wrapup 的同课真实行并存时
   * 由 dedupeLessonRows 优先保留真实行。
   */
  synthetic?: boolean;
}

export interface PreparedLearningStateMetricCommit {
  userId: string;
  expectedRevision: number;
  sourceKey: string;
  metrics: LearningStateMetrics;
  data: Record<string, any>;
}

export class LearningStateRevisionConflictError extends Error {
  constructor() {
    super('学习状态已变化，请重试');
    this.name = 'LearningStateRevisionConflictError';
  }
}

export interface LearningStateSessionTimelineEntry {
  teachingSessionId: string;
  taskId: string | null;
  pathId: string | null;
  status: string;
  metrics: LearningStateMetrics | null;
  calculatedAt: Date;
  source: 'committed-metric' | 'teaching-wrapup' | 'missing';
  summarySource: string | null;
  evaluationSource: string | null;
  degraded: boolean;
}

export interface LearningStateCommittedSnapshot {
  metrics: LearningStateMetrics;
  calculatedAt: Date;
  pathId?: string | null;
}

/**
 * 学习者级（全局）状态：**按路径保守聚合 + 当日课量累积项**。
 *
 * 为什么不是"最近一条行"：学习者可能同时学多条路径，最近一条行只代表"最后写的那条路径"，
 * 于是"今天上了一门难课"会被当成"这周很累"（单课判断污染总负担），而且随时是哪条路径最后写
 * 就会跳变。这里改为：每条路径取各自最新状态，再对**负荷类**指标取 max（保守：任一路径的
 * 高负荷都算数），并叠加**当日课量**的疲劳累积项（课时数 / 时长）。
 * 单课难易仍由路径级状态负责（见 LearnerSnapshotService 的课内控制状态）。
 */
export interface AggregatedLearningState {
  /** 聚合后的学习者级状态（供全局节奏 / 疲劳 / 重排信号使用） */
  metrics: LearningStateMetrics;
  /** 各路径的最新状态（供路径级判断使用，如课内难度与支架） */
  perPath: Array<{ pathId: string; metrics: LearningStateMetrics; calculatedAt: Date }>;
  /** 实际参与聚合的路径（= 活跃窗口内的路径；为空时回退到最近一条路径） */
  activePathIds: string[];
  /** 当日课量及其疲劳加成（可观测，便于对账与调参） */
  dayLoad: { lessons: number; minutes: number; fatigueBonus: number };
  /** 最近一条状态行的时间（新鲜度，不参与聚合） */
  latestAt: Date | null;
}

/**
 * 参与全局聚合的"活跃路径"窗口（天）。
 * 超过该窗口没动静的路径不再参与投票：一条两个月没动的路径，其峰值与衰减基线都会污染
 * "当前总负担"的判断（实证：某学习者的 ktl 4.4 来自 7 月）。窗口内没有活跃路径时回退最近一条路径。
 */
export const AGGREGATION_ACTIVE_WINDOW_DAYS = 14;

/** 当日课量的疲劳加成规则（唯一口径，便于调参/对账） */export const DAY_LOAD_FATIGUE_RULES = {
  /** 每天第 1 节课不额外加成；之后每多一节课的加成 */
  perExtraLesson: 0.5,
  maxLessonBonus: 2.0,
  /** 当日累计学习时长（分钟）超过该值后开始计时长加成 */
  freeMinutes: 90,
  /** 每多 30 分钟的加成 */
  perExtra30Minutes: 0.25,
  maxMinutesBonus: 1.5,
} as const;

/** 当日课量 → 疲劳加成（纯函数，便于测试与对账） */
export function computeDayLoadFatigueBonus(input: { lessons: number; minutes: number }): number {
  const lessonBonus = Math.min(
    DAY_LOAD_FATIGUE_RULES.maxLessonBonus,
    Math.max(0, input.lessons - 1) * DAY_LOAD_FATIGUE_RULES.perExtraLesson
  );
  const minutesBonus = Math.min(
    DAY_LOAD_FATIGUE_RULES.maxMinutesBonus,
    Math.max(0, (input.minutes - DAY_LOAD_FATIGUE_RULES.freeMinutes) / 30) * DAY_LOAD_FATIGUE_RULES.perExtra30Minutes
  );
  return Math.round((lessonBonus + minutesBonus) * 1000) / 1000;
}

/**
 * 0-10 量纲归一（**全库唯一的内部刻度归一入口**）。
 * 规则：>10 视为 0-100 刻度除以 10，否则按 0-10 原样 clamp。
 */
export function toInternalTenScale(value: number | null | undefined): InternalTen {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (numeric > 10) return Math.min(10, Math.max(0, numeric / 10)) as InternalTen;
  return Math.min(10, Math.max(0, numeric)) as InternalTen;
}

/** -10..10 平衡值归一（>10 / <-10 视为 -100..100 刻度） */
export function toInternalBalance(value: number | null | undefined): InternalBalance {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (numeric > 10 || numeric < -10) return Math.max(-10, Math.min(10, numeric / 10)) as InternalBalance;
  return Math.max(-10, Math.min(10, numeric)) as InternalBalance;
}

/** 内部 0-10 → display 0-100（**唯一**的 ×10 出口） */
export function internalTenToDisplay(value: number | null | undefined): DisplayHundred {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return (Math.round(Math.max(0, Math.min(10, numeric)) * 10 * 1000) / 1000) as DisplayHundred;
}

/** 已经是 display 0-100 的原始值 → 品牌化（只 clamp，不再换算；假设写在函数名里） */
export function asDisplayHundred(value: number | null | undefined): DisplayHundred {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, numeric)) as DisplayHundred;
}

/** 已经是 display -100..100 的原始值 → 品牌化 */
export function asDisplayBalance(value: number | null | undefined): DisplayBalance {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(-100, Math.min(100, numeric)) as DisplayBalance;
}

/**
 * 量纲自检（落库/读取双侧）：越界即**告警**（不静默），并 clamp 回权威刻度保证可用性。
 * 说明：这是运行期兜底 —— 编译期由品牌类型拦"刻度混用"，运行期拦"越界脏值"（含历史遗留行）。
 */
export function guardInternalScale(
  input: { lss: number; ktl: number; lf: number; lsb: number },
  context: string
): { lss: number; ktl: number; lf: number; lsb: number } {
  const inRange = (value: number, min: number, max: number) =>
    Number.isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9;
  const violations: string[] = [];
  if (!inRange(input.lss, 0, 10)) violations.push('lss');
  if (!inRange(input.ktl, 0, 10)) violations.push('ktl');
  if (!inRange(input.lf, 0, 10)) violations.push('lf');
  if (!inRange(input.lsb, -10, 10)) violations.push('lsb');

  if (violations.length === 0) return input;

  logger.warn('[scale-guard] 学习状态量纲越界（已 clamp 回 0-10/-10..10）', {
    context,
    fields: violations,
    value: { lss: input.lss, ktl: input.ktl, lf: input.lf, lsb: input.lsb },
  });
  return {
    lss: Number(toInternalTenScale(input.lss)),
    ktl: Number(toInternalTenScale(input.ktl)),
    lf: Number(toInternalTenScale(input.lf)),
    lsb: Number(toInternalBalance(input.lsb)),
  };
}
