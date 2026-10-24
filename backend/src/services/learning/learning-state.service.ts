/**
 * Learning State Service - AI 原生授课模式核心服务
 * 负责三层状态追踪：LSS/KTL/LF/LSB 计算和数据采集
 * 
 * 核心公式：
 * - LSS (Learning Stress Score): 学习压力评分
 * - KTL (Knowledge Training Load): 知识训练负荷 (EWMA, λ=0.95, 半衰期 ≈ 13.5 天)
 * - LF (Learning Fatigue): 学习疲劳度 (EWMA, λ=0.70, 半衰期 ≈ 1.9 天)
 * - LSB (Learning State Balance) = KTL - LF: 学习状态平衡值
 */

import prisma from '../../config/database';
import { withTransaction } from '../../utils/with-transaction';
import { logger } from '../../utils/logger';
// 时钟域：状态写入侧早已用模拟时刻（simulatedNowOr），读取侧的自然衰减必须同口径——
// 否则跨日模拟里"隔了一个模拟日"的疲劳恢复会按真实墙钟差（≈0 或夸张天数）计算。
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
// 日界单一真理源（应用时区本地日）——所有"按天归组/比较"必须走这里
import { dayKeyOf, startOfDay, dayDiffInDays, addDaysToDayKey, DAY_BOUNDARY_DAY_MS } from '../time/day-boundary';
// PMC/TSB 式负荷模型（纯函数 + 行重放）：KTL/LF/LSB 由「逐日负荷之和 + 按天 EWMA」派生，
// 取代旧「按课 EWMA」。读侧权威：每行 learning_metrics 的 lss 列是**该节瞬时压力**（内容驱动、
// 非 EWMA），按日求和即可重放。详见 learning-load.pmc.ts。
import { replayDailyPmc } from './learning-load-pmc.service';
import { classifyLoad } from './learning-load-verdict';
import { buildDisplaySuggestion, type LearningStateDisplaySuggestion } from './learning-state-suggestion';

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

interface LearningStateMetricPersistOptions {
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
interface PmcPreloadedMetricRow {
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

interface LearningStateCommittedSnapshot {
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

// 认知层级
export enum CognitiveLevel {
  REMEMBER = 'remember',      // 记忆
  UNDERSTAND = 'understand',  // 理解
  APPLY = 'apply',            // 应用
  ANALYZE = 'analyze',        // 分析
  EVALUATE = 'evaluate',      // 评估
  CREATE = 'create',          // 创造
}

// 对话分析结果
export interface DialogueAnalysis {
  cognitiveLevel: CognitiveLevel;
  understanding: number;       // 理解度 0-1
  confusionPoints: string[];   // 困惑点
  engagement: number;          // 参与度 0-1
  emotionalState: 'positive' | 'neutral' | 'frustrated' | 'confused';
}

// 干预类型
export type InterventionType = 
  | 'hint'           // 提示
  | 'explanation'    // 解释
  | 'example'        // 示例
  | 'simplification' // 简化
  | 'challenge'      // 挑战
  | 'break'          // 休息建议
  | 'encouragement'; // 鼓励

// 干预决策
export interface InterventionDecision {
  type: InterventionType;
  priority: number;        // 优先级 1-10
  content: string;         // 干预内容
  reasoning: string;       // 决策理由
}

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

export class LearningStateService {
  private readonly committedMetricVersion = 'state-v2';

  /**
   * 自然衰减用的"过了几天"。
   *
   * 历史（2026-09-16）：衰减此前用本地日，与每日温故配额、当日课量、日期模拟的 UTC 日口径
   * 不一致——UTC+8 下"用规范 asOf（UTC 日末）读当天的课"会白多衰减一天。
   * 现状：日界统一走 day-boundary（应用时区本地日），四个口径一致（下方 :384 注释为现行口径）。
   */
  private getNaturalDayDiff(from: Date, to: Date): number {
    // 日界统一走 day-boundary（应用时区本地日）：与当日课量 / 温故配额 / 日期模拟 / 趋势分桶同口径
    return dayDiffInDays(from, to);
  }

  /** 单一归一入口的别名（历史上这里有一份重复实现，导致"两套刻度"并存） */
  private normalizeTenScale(value: number | null | undefined): InternalTen {
    return toInternalTenScale(value);
  }

  /**
   * 公开的 0-10 归一（供其它写入点复用，避免各自拍量纲）。
   * 规则：>10 视为 0-100 刻度除以 10，否则按 0-10 原样 clamp。
   */
  toInternalTenScale(value: number | null | undefined): number {
    return toInternalTenScale(value);
  }

  private normalizeBalanceScale(value: number | null | undefined): InternalBalance {
    return toInternalBalance(value);
  }

  private displayTenScaleToInternal(value: number | null | undefined): InternalTen {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return (Math.max(0, Math.min(100, numeric)) / 10) as InternalTen;
  }

  private displayBalanceScaleToInternal(value: number | null | undefined): InternalBalance {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return (Math.max(-100, Math.min(100, numeric)) / 10) as InternalBalance;
  }

  private parseMetricMetadata(raw: string | null | undefined): Record<string, any> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * 已提交指标的读取条件。
   * `pathId` 是**可选维度**：不传 = 该学习者的全局序列（历史行为，跨路径合并）；
   * 传 pathId = 只读该路径的序列（路径级判断用，避免"路径 A 的困难改写路径 B 的自适应"）。
   */
  private buildCommittedMetricWhere(
    userId: string,
    since?: Date,
    excludedSourceKey?: string,
    asOf?: Date,
    pathId?: string | null,
    /**
     * 是否计入合成占位行（metadata.synthetic=true）。默认排除（#71 P-46）：占位值不能参与
     * 当前状态 / 趋势 / EWMA 前值；只有 PMC 重放需要包含（否则只有占位行的冷启动用户会读成
     * 「无状态」），且 PMC 内部另有 dedupeLessonRows 把「同课真实行 + 占位行」配对折叠。
     */
    includeSynthetic = false
  ) {
    return {
      userId,
      metricType: 'learning_state',
      // pathId === undefined → 不加维度（维持旧的全局读取）；null → 显式只读"无路径归属"的行
      ...(pathId === undefined ? {} : { pathId }),
      ...(excludedSourceKey ? { sourceKey: { not: excludedSourceKey } } : {}),
      AND: [
        { metadata: { contains: `"version":"${this.committedMetricVersion}"` } },
        { metadata: { contains: '"committed":true' } },
        ...(includeSynthetic ? [] : [{ NOT: { metadata: { contains: '"synthetic":true' } } }]),
      ],
      ...(since || asOf ? {
        calculatedAt: {
          ...(since ? { gte: since } : {}),
          ...(asOf ? { lte: asOf } : {}),
        }
      } : {}),
    };
  }

  private extractSnapshotTimestamp(value: unknown, fallback: Date): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return fallback;
  }

  coerceMetrics(input: any, fallbackTimestamp: Date = simulatedNowOr()): LearningStateMetrics | null {
    if (!input || typeof input !== 'object') return null;

    const rawLss = typeof input.lss === 'number' ? input.lss : null;
    const rawKtl = typeof input.ktl === 'number' ? input.ktl : null;
    const rawLf = typeof input.lf === 'number' ? input.lf : null;
    const rawLsb = typeof input.lsb === 'number' ? input.lsb : null;

    if (rawLss === null || rawKtl === null || rawLf === null || rawLsb === null) {
      return null;
    }

    return {
      lss: this.normalizeTenScale(rawLss),
      ktl: this.normalizeTenScale(rawKtl),
      lf: this.normalizeTenScale(rawLf),
      lsb: this.normalizeBalanceScale(rawLsb),
      timestamp: this.extractSnapshotTimestamp(input.timestamp, fallbackTimestamp),
    };
  }

  /**
   * 投影下一份状态。
   * 注意：`ktlInput` / `lfInput` 缺省时都回落到 `lss`——调用方若想要**独立**的负荷/疲劳观测量，
   * 必须显式传入（结课路径即如此，审计 §3.2）。
   */
  private projectState(
    previousMetrics: LearningStateMetrics | null,
    input: {
      lss: number;
      ktlInput?: number;
      lfInput?: number;
    },
    timestamp: Date = simulatedNowOr()
  ): LearningStateMetrics {
    const effectiveKtlInput = this.normalizeTenScale(input.ktlInput ?? input.lss);
    const effectiveLfInput = this.normalizeTenScale(input.lfInput ?? input.lss);

    const previousKTL = previousMetrics?.ktl ?? effectiveKtlInput;
    const previousLF = previousMetrics?.lf ?? effectiveLfInput;

    const currentKTL = this.calculateKTL(previousKTL, effectiveKtlInput);
    const currentLF = this.calculateLF(previousLF, effectiveLfInput);
    const currentLSB = this.calculateLSB(currentKTL, currentLF);

    return {
      lss: this.normalizeTenScale(input.lss),
      ktl: toInternalTenScale(currentKTL),
      lf: toInternalTenScale(currentLF),
      lsb: toInternalBalance(currentLSB),
      timestamp,
    };
  }

  private metricRecordToSnapshot(record: {
    lss: number | null;
    ktl: number | null;
    lf: number | null;
    lsb: number | null;
    calculatedAt: Date;
    pathId?: string | null;
  }): LearningStateCommittedSnapshot | null {
    // 读取侧自检要在**归一之前**：归一会把 40 悄悄变成 4，脏数据就此隐形。
    // 这里只告警不改行为（值仍由 coerceMetrics 归一），把"列里存了越界/异刻度值"暴露出来。
    this.reportRawScaleAnomaly(record, 'read:committed-metric-raw');
    const metrics = this.coerceMetrics({
      lss: record.lss,
      ktl: record.ktl,
      lf: record.lf,
      lsb: record.lsb,
      timestamp: record.calculatedAt,
    }, record.calculatedAt);

    if (!metrics) return null;
    return {
      metrics,
      calculatedAt: record.calculatedAt,
      pathId: record.pathId ?? null,
    };
  }

  /** 读取侧：列里出现越界值（>10 / <-10 / 非有限数）→ 告警（异刻度或脏写入的可见化） */
  private reportRawScaleAnomaly(
    record: { lss: number | null; ktl: number | null; lf: number | null; lsb: number | null },
    context: string
  ): void {
    const inRange = (value: number | null, min: number, max: number) =>
      value == null || (Number.isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9);
    const anomalies = [
      inRange(record.lss, 0, 10) ? null : 'lss',
      inRange(record.ktl, 0, 10) ? null : 'ktl',
      inRange(record.lf, 0, 10) ? null : 'lf',
      inRange(record.lsb, -10, 10) ? null : 'lsb',
    ].filter(Boolean) as string[];
    if (anomalies.length === 0) return;
    logger.warn('[scale-guard] 读取到越界的已提交指标（可能存了 0-100/0-1 等异刻度值）', {
      context,
      fields: anomalies,
      raw: { lss: record.lss, ktl: record.ktl, lf: record.lf, lsb: record.lsb },
    });
  }

  private wrapupSessionToSnapshot(session: {
    wrapup: string | null;
    startTime: Date;
    endTime: Date | null;
  }): LearningStateCommittedSnapshot | null {
    if (!session.wrapup) return null;

    try {
      const wrapup = JSON.parse(session.wrapup);
      const rawState = wrapup?.stateUpdate;
      const fallbackTimestamp = session.endTime || session.startTime;
      const metrics = this.coerceMetrics(rawState, fallbackTimestamp);
      if (!metrics) return null;

      return {
        metrics,
        calculatedAt: metrics.timestamp,
      };
    } catch {
      return null;
    }
  }

  private async listCommittedSnapshots(
    userId: string,
    since?: Date,
    excludedSourceKey?: string,
    asOf?: Date,
    pathId?: string | null
  ): Promise<LearningStateCommittedSnapshot[]> {
    const committedRows = await prisma.learning_metrics.findMany({
      where: this.buildCommittedMetricWhere(userId, since, excludedSourceKey, asOf, pathId),
      orderBy: { calculatedAt: 'asc' },
      select: {
        lss: true,
        ktl: true,
        lf: true,
        lsb: true,
        calculatedAt: true,
        pathId: true,
      },
    });

    const committedSnapshots = committedRows
      .map((row) => this.metricRecordToSnapshot(row))
      .filter((row): row is LearningStateCommittedSnapshot => Boolean(row));

    if (committedSnapshots.length > 0) {
      return committedSnapshots;
    }

    const sessionWhere: Record<string, any> = {
      userId,
      status: 'completed',
      wrapup: { not: null },
    };
    if (excludedSourceKey?.startsWith('session-wrapup:')) {
      sessionWhere.id = { not: excludedSourceKey.slice('session-wrapup:'.length) };
    }

    if (since) {
      sessionWhere.OR = [
        { endTime: { gte: since } },
        { startTime: { gte: since } },
      ];
    }
    if (asOf) {
      sessionWhere.endTime = { lte: asOf };
    }

    const sessions = await prisma.teaching_sessions.findMany({
      where: sessionWhere,
      orderBy: { endTime: 'asc' },
      select: {
        wrapup: true,
        startTime: true,
        endTime: true,
      },
    });

    return sessions
      .map((session) => this.wrapupSessionToSnapshot(session))
      .filter((row): row is LearningStateCommittedSnapshot => Boolean(row))
      .filter((row) => !asOf || row.calculatedAt <= asOf);
  }

  async getLatestCommittedStateAt(userId: string): Promise<Date | null> {
    const latestCommittedRow = await prisma.learning_metrics.findFirst({
      where: this.buildCommittedMetricWhere(userId),
      orderBy: { calculatedAt: 'desc' },
      select: { calculatedAt: true },
    });

    if (latestCommittedRow?.calculatedAt) {
      return latestCommittedRow.calculatedAt;
    }

    const latestCompletedSession = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { endTime: 'desc' },
      select: {
        wrapup: true,
        startTime: true,
        endTime: true,
      },
    });

    return latestCompletedSession
      ? this.wrapupSessionToSnapshot(latestCompletedSession)?.calculatedAt || null
      : null;
  }

  toDisplayMetrics(metrics: LearningStateMetrics): DisplayMetrics {
    return {
      ...metrics,
      lss: asDisplayHundred(Number((metrics.lss * 10).toFixed(2))),
      ktl: asDisplayHundred(Number((metrics.ktl * 10).toFixed(2))),
      lf: asDisplayHundred(Number((metrics.lf * 10).toFixed(2))),
      lsb: asDisplayBalance(Number((metrics.lsb * 10).toFixed(2))),
    };
  }

  restoreMetrics(input: {
    lss: number | null | undefined;
    ktl: number | null | undefined;
    lf: number | null | undefined;
    lsb: number | null | undefined;
    timestamp: Date;
  }, asOf: Date = simulatedNowOr()): LearningStateMetrics {
    const normalized: LearningStateMetrics = {
      lss: this.normalizeTenScale(input.lss),
      ktl: this.normalizeTenScale(input.ktl),
      lf: this.normalizeTenScale(input.lf),
      lsb: this.normalizeBalanceScale(input.lsb),
      timestamp: input.timestamp,
    };

    const dayDiff = this.getNaturalDayDiff(input.timestamp, asOf);
    if (dayDiff <= 0) {
      return normalized;
    }

    const decayedLss = normalized.lss * Math.pow(NATURAL_DECAY.LSS_DAILY_FACTOR, dayDiff);
    const decayedKtl = normalized.ktl * Math.pow(NATURAL_DECAY.KTL_DAILY_FACTOR, dayDiff);
    const decayedLf = NATURAL_DECAY.LF_BASELINE
      + (normalized.lf - NATURAL_DECAY.LF_BASELINE) * Math.pow(NATURAL_DECAY.LF_DAILY_FACTOR, dayDiff);
    const decayedLsb = this.calculateLSB(decayedKtl, decayedLf);

    return {
      lss: this.normalizeTenScale(decayedLss),
      ktl: this.normalizeTenScale(decayedKtl),
      lf: this.normalizeTenScale(decayedLf),
      lsb: toInternalBalance(decayedLsb),
      timestamp: asOf,
    };
  }

  /**
   * 计算 LSS (Learning Stress Score)
   * 公式：LSS = (难度×0.3 + 认知负荷×0.3 + 效率惩罚×0.4) × 时间因子
   */
  calculateLSS(inputs: LSSInputs): number {
    const { difficulty, cognitiveLoad, efficiency, timeSpent, expectedTime, completionRate, taskType } = inputs;

    // 基础压力 = 难度×0.3 + 认知负荷×0.3
    let baseStress = difficulty * 0.3 + cognitiveLoad * 0.3;

    // 效率惩罚 (效率越低，压力越大)
    const efficiencyPenalty = (1 - efficiency) * 4; // 0-4
    baseStress += efficiencyPenalty;

    // 时间因子
    const timeRatio = expectedTime > 0 ? timeSpent / expectedTime : 1;
    let timeFactor = 1;
    if (timeRatio > 1.5) {
      timeFactor = 1.3; // 超时严重
    } else if (timeRatio > 1.2) {
      timeFactor = 1.1; // 轻微超时
    } else if (timeRatio < 0.5) {
      timeFactor = 0.9; // 完成太快
    }

    // 完成率调整
    const completionFactor = 0.7 + completionRate * 0.3; // 0.7-1.0

    // 任务类型调整
    const typeFactors: Record<string, number> = {
      reading: 0.9,
      practice: 1.0,
      project: 1.2,
      quiz: 1.1,
    };
    const typeFactor = typeFactors[taskType] || 1.0;

    // 最终 LSS
    const lss = baseStress * timeFactor * completionFactor * typeFactor;

    return Math.min(10, Math.max(0, lss)); // 限制在 0-10
  }

  /**
   * 计算 KTL (Knowledge Training Load)
   * 公式：KTL_t = λ × KTL_{t-1} + (1-λ) × LSS_t
   * λ = 0.95 (半衰期 = ln(0.5)/ln(0.95) ≈ 13.5 天)
   */
  calculateKTL(previousKTL: number, currentLSS: number): number {
    const ktl = 
      EWMA_CONFIG.KTL_LAMBDA * previousKTL +
      (1 - EWMA_CONFIG.KTL_LAMBDA) * currentLSS;
    return Math.min(10, Math.max(0, ktl));
  }

  /**
   * 计算 LF (Learning Fatigue)
   * 公式：LF_t = λ_short × LF_{t-1} + (1-λ_short) × LSS_t
   * λ = 0.70 (半衰期 = ln(0.5)/ln(0.70) ≈ 1.9 天)
   */
  calculateLF(previousLF: number, currentLSS: number): number {
    const lf = 
      EWMA_CONFIG.LF_LAMBDA * previousLF +
      (1 - EWMA_CONFIG.LF_LAMBDA) * currentLSS;
    return Math.min(10, Math.max(0, lf));
  }

  /**
   * 计算 LSB (Learning State Balance)
   * 公式：LSB = KTL - LF
   */
  calculateLSB(ktl: number, lf: number): number {
    const lsb = ktl - lf;
    return Math.max(-10, Math.min(10, lsb)); // 限制在 -10 到 +10
  }

  /** devtools 时间推进：取用户最近一条原生 learning_metrics 行（不折算、不提交） */
  async getLatestMetricRecord(userId: string) {
    return prisma.learning_metrics.findFirst({
      // 只看学习状态行，且跳过合成占位行（#71：占位值是默认难度套公式的产物，不是测量）
      where: {
        userId,
        metricType: 'learning_state',
        NOT: { metadata: { contains: '"synthetic":true' } },
      },
      orderBy: { calculatedAt: 'desc' },
      select: { lss: true, ktl: true, lf: true, lsb: true, calculatedAt: true },
    });
  }

  async getLatestCommittedMetricBefore(userId: string, before: Date): Promise<LearningStateMetrics | null> {
    // 快路径（2026-10-24）：DB 级取 before 之前最新一条已提交指标。旧实现无条件
    // listCommittedSnapshots 全量拉取用户历史行，再从尾部（升序列）倒着找第一条，历史越长越贵。
    const rows = await prisma.learning_metrics.findMany({
      where: {
        ...this.buildCommittedMetricWhere(userId),
        calculatedAt: { lt: before },
      },
      orderBy: { calculatedAt: 'desc' },
      take: 1,
      select: { lss: true, ktl: true, lf: true, lsb: true, calculatedAt: true, pathId: true },
    });
    if (rows.length > 0) {
      const snapshot = this.metricRecordToSnapshot(rows[0]);
      if (snapshot) return snapshot.metrics;
    }
    // 快路径未命中（无已提交行 / 最新行读取自检失败）→ 回落旧路径，保留
    // listCommittedSnapshots 的 session-wrapup 兜底（历史未迁移数据）语义
    const snapshots = await this.listCommittedSnapshots(userId);
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index];
      if (snapshot.calculatedAt.getTime() < before.getTime()) {
        return snapshot.metrics;
      }
    }
    return null;
  }

  /**
   * 获取用户历史指标
   */
  /**
   * 前一条已提交状态。
   * `asOf` 传值 = 以该时刻为基准（同时按该时刻过滤历史行、并按该时刻折算自然衰减）；
   * 不传 = 以当前时刻为准（旧行为）。
   */
  async getPreviousMetrics(
    userId: string,
    options: { pathId?: string | null; asOf?: Date } = {}
  ): Promise<LearningStateMetrics | null> {
    const snapshots = await this.listCommittedSnapshots(userId, undefined, undefined, options.asOf, options.pathId);
    const latestSnapshot = snapshots[snapshots.length - 1] || null;

    if (!latestSnapshot) return null;

    return this.restoreMetrics(latestSnapshot.metrics, options.asOf ?? simulatedNowOr());
  }

  async getCommittedMetricBySourceKey(
    userId: string,
    sourceKey: string
  ): Promise<LearningStateMetrics | null> {
    const record = await prisma.learning_metrics.findFirst({
      where: {
        ...this.buildCommittedMetricWhere(userId),
        sourceKey
      },
      select: {
        lss: true,
        ktl: true,
        lf: true,
        lsb: true,
        calculatedAt: true
      }
    });
    const snapshot = record ? this.metricRecordToSnapshot(record) : null;
    return snapshot ? this.restoreMetrics(snapshot.metrics) : null;
  }

  async getCurrentStateSnapshot(
    userId: string,
    options: { sourceKey?: string; asOf?: Date; pathId?: string | null } = {}
  ): Promise<{
    revision: number;
    metrics: LearningStateMetrics | null;
  }> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { learningStateRevision: true }
    });
    if (!user) throw new Error('用户不存在');

    const snapshots = await this.listCommittedSnapshots(
      userId,
      undefined,
      options.sourceKey,
      options.asOf,
      options.pathId
    );
    const latestSnapshot = snapshots[snapshots.length - 1] || null;
    return {
      revision: user.learningStateRevision,
      metrics: latestSnapshot
        ? this.restoreMetrics(latestSnapshot.metrics, options.asOf || simulatedNowOr())
        : null
    };
  }

  /**
   * 计算并更新学习状态
   */
  async calculateAndUpdate(
    userId: string,
    inputs: LSSInputs
  ): Promise<LearningStateMetrics> {
    // 1. 计算当前 LSS
    const currentLSS = this.calculateLSS(inputs);

    // 2. 获取历史指标
    const previousMetrics = await this.getPreviousMetrics(userId);
    const metrics = this.projectState(previousMetrics, { lss: currentLSS });

    // 5. 保存到数据库
    await this.saveMetrics(userId, metrics, inputs);

    logger.debug(`[LearningState] 用户 ${userId}: LSS=${metrics.lss.toFixed(2)}, KTL=${metrics.ktl.toFixed(2)}, LF=${metrics.lf.toFixed(2)}, LSB=${metrics.lsb.toFixed(2)}`);

    return metrics;
  }

  /**
   * 回合内**运行时临时态**（仅供课内展示/节奏提示，**不落库**）。
   *
   * ⚠️ 语义边界（审计 §3.2）：这里只传了 `{ lss }`，`projectState` 会用 `ktlInput ?? lss` /
   * `lfInput ?? lss` 兜底，于是 KTL/LF 退化成「对同一个 LSS 输入的快/慢 EWMA」——
   * 它**不是**独立的负荷/疲劳观测量。权威状态走结课路径 `prepareSessionScoreCommit`，
   * 独立传入 `sessionKtl` / `sessionLf`；需要权威 KTL/LF 时不要读本函数的返回值。
   */
  calculateRuntimeState(previousMetrics: LearningStateMetrics | null, inputs: LSSInputs): LearningStateMetrics {
    const currentLSS = this.calculateLSS(inputs);
    return this.projectState(previousMetrics, { lss: currentLSS });
  }

  /**
   * 使用会话评估分数更新学习状态
   * 场景：单节课由 LLM 给出 sessionLss，跨日期由确定性 EWMA 更新
   */
  async calculateAndUpdateFromSessionScore(
    userId: string,
    input: SessionScoreInput
  ): Promise<LearningStateMetrics> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const prepared = await this.prepareSessionScoreCommit(userId, input);
      try {
        await this.commitPreparedMetric(prepared);
        return prepared.metrics;
      } catch (error) {
        if (!(error instanceof LearningStateRevisionConflictError) || attempt === 4) throw error;
      }
    }

    throw new LearningStateRevisionConflictError();
  }

  async prepareSessionScoreCommit(
    userId: string,
    input: SessionScoreInput
  ): Promise<PreparedLearningStateMetricCommit> {
    if (!input.sessionId) {
      throw new Error('会话学习状态提交缺少 sessionId');
    }

    const sourceKey = `session-wrapup:${input.sessionId}`;
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { learningStateRevision: true }
    });
    if (!user) throw new Error('用户不存在');

    const normalizedLss = Math.min(10, Math.max(0, input.sessionLss));
    const normalizedSessionKtl = Math.min(10, Math.max(0, input.sessionKtl ?? input.sessionLss));
    const normalizedSessionLf = Math.min(10, Math.max(0, input.sessionLf ?? input.sessionLss));
    const confidence = input.confidence === undefined
      ? 0.75
      : Math.min(1, Math.max(0.2, input.confidence));

    // 低置信度自动降权，避免单次评估抖动过大
    const confidenceAdjustedLss = normalizedLss * (0.6 + confidence * 0.4);
    const confidenceAdjustedKtl = normalizedSessionKtl * (0.6 + confidence * 0.4);
    const confidenceAdjustedLf = normalizedSessionLf * (0.6 + confidence * 0.4);

    const previousSnapshots = await this.listCommittedSnapshots(userId, undefined, sourceKey);
    const previousSnapshot = previousSnapshots[previousSnapshots.length - 1] || null;
    const previousMetrics = previousSnapshot ? this.restoreMetrics(previousSnapshot.metrics) : null;
    const metrics = this.projectState(previousMetrics, {
      lss: confidenceAdjustedLss,
      ktlInput: confidenceAdjustedKtl,
      lfInput: confidenceAdjustedLf,
    });

    const inputs: LSSInputs = {
      difficulty: Math.max(1, Math.min(10, confidenceAdjustedLss)),
      cognitiveLoad: Math.max(1, Math.min(10, confidenceAdjustedLss)),
      efficiency: confidence,
      timeSpent: input.durationMinutes,
      expectedTime: 15,
      completionRate: 1,
      taskType: 'practice',
    };
    const options: LearningStateMetricPersistOptions = {
      sourceKey,
      version: this.committedMetricVersion,
      committed: true,
      source: 'session-wrapup',
      pathId: input.pathId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      primaryMetric: 'lsb',
    };
    const data = await this.buildMetricCreateData(userId, metrics, inputs, options);

    logger.info(
      `[LearningState] 会话评分更新: user=${userId}, sessionLss=${normalizedLss.toFixed(2)}, sessionKtl=${normalizedSessionKtl.toFixed(2)}, sessionLf=${normalizedSessionLf.toFixed(2)}, confidence=${confidence.toFixed(2)}, adjustedLss=${confidenceAdjustedLss.toFixed(2)}, adjustedKtl=${confidenceAdjustedKtl.toFixed(2)}, adjustedLf=${confidenceAdjustedLf.toFixed(2)}, LSB=${metrics.lsb.toFixed(2)}`
    );

    return {
      userId,
      expectedRevision: user.learningStateRevision,
      sourceKey,
      metrics,
      data,
    };
  }

  async commitDisplayMetrics(
    userId: string,
    input: DisplayMetricCommitInput
  ): Promise<LearningStateMetrics> {
    const metrics: LearningStateMetrics = {
      lss: this.displayTenScaleToInternal(input.lss),
      ktl: this.displayTenScaleToInternal(input.ktl),
      lf: this.displayTenScaleToInternal(input.lf),
      lsb: this.displayBalanceScaleToInternal(input.lsb),
      timestamp: input.timestamp || simulatedNowOr(),
    };
    const inputs: LSSInputs = {
      difficulty: Math.max(1, Math.min(10, metrics.lss)),
      cognitiveLoad: Math.max(1, Math.min(10, metrics.lss)),
      efficiency: 1,
      timeSpent: 0,
      expectedTime: 0,
      completionRate: 1,
      taskType: 'practice',
    };
    const sourceKey = input.sourceKey || `metric:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`;
    const options: LearningStateMetricPersistOptions = {
      sourceKey,
      version: this.committedMetricVersion,
      committed: true,
      source: input.source || 'display-metric-commit',
      pathId: input.pathId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      primaryMetric: input.primaryMetric || 'lsb',
      synthetic: input.synthetic === true,
    };
    await this.commitPreparedMetric({
      userId,
      expectedRevision: input.expectedRevision,
      sourceKey,
      metrics,
      data: await this.buildMetricCreateData(userId, metrics, inputs, options)
    });

    return metrics;
  }

  async commitDerivedDisplayMetrics(
    userId: string,
    derive: (
      previousMetrics: LearningStateMetrics | null
    ) => Promise<Omit<DisplayMetricCommitInput, 'expectedRevision'>> | Omit<DisplayMetricCommitInput, 'expectedRevision'>,
    options: { sourceKey?: string; reuseExisting?: boolean; asOf?: Date; pathId?: string } = {}
  ): Promise<LearningStateMetrics> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (options.sourceKey && options.reuseExisting) {
        const existing = await this.getCommittedMetricBySourceKey(userId, options.sourceKey);
        if (existing) return existing;
      }
      let snapshot = await this.getCurrentStateSnapshot(userId, {
        sourceKey: options.sourceKey,
        asOf: options.asOf,
        pathId: options.pathId
      });
      // EWMA 链按路径隔离：学习者可能同时学多条路径，若"前值"取全局最新，
      // 路径 A 的一节课会接在路径 B 的状态后面继续演变（跨路径污染）。
      // 冷启动继承：该路径还没有任何历史时，别从"零"开始 —— 回退到学习者全局最新状态，
      // 避免"新路径的第一节课"把已经累了一天的学习者当成满血新人；
      // 一旦该路径有了自己的历史，就只在路径内延续。
      if (options.pathId !== undefined && snapshot.metrics === null) {
        snapshot = await this.getCurrentStateSnapshot(userId, {
          sourceKey: options.sourceKey,
          asOf: options.asOf
        });
      }
      const input = await derive(snapshot.metrics);
      try {
        return await this.commitDisplayMetrics(userId, {
          ...input,
          sourceKey: options.sourceKey || input.sourceKey,
          expectedRevision: snapshot.revision
        });
      } catch (error) {
        if (!(error instanceof LearningStateRevisionConflictError) || attempt === 4) throw error;
      }
    }

    throw new LearningStateRevisionConflictError();
  }

  /**
   * 保存指标到数据库
   */
  private async saveMetrics(
    userId: string,
    metrics: LearningStateMetrics,
    inputs: LSSInputs,
    options: LearningStateMetricPersistOptions = {}
  ): Promise<void> {
    const data = await this.buildMetricCreateData(userId, metrics, inputs, options);
    await prisma.learning_metrics.create({ data: data as any });
  }

  private async buildMetricCreateData(
    userId: string,
    metrics: LearningStateMetrics,
    _inputs: LSSInputs,
    options: LearningStateMetricPersistOptions = {}
  ): Promise<Record<string, any>> {
    // 获取现有的 lssHistory
    const existingRecord = await prisma.learning_metrics.findFirst({
      // 只继承学习状态行，且不把占位行带进历史（#71）
      where: {
        userId,
        metricType: 'learning_state',
        NOT: { metadata: { contains: '"synthetic":true' } },
      },
      orderBy: { calculatedAt: 'desc' },
    });

    let lssHistory: Array<{ date: string; score: number }> = [];
    if (existingRecord?.lssHistory) {
      try {
        lssHistory = JSON.parse(existingRecord.lssHistory);
      } catch {
        lssHistory = [];
      }
    }

    // 添加新记录
    lssHistory.push({
      date: simulatedNowOr().toISOString(),
      score: Math.round(metrics.lss * 10), // 转换为 0-100
    });

    // 只保留最近 30 条
    if (lssHistory.length > 30) {
      lssHistory = lssHistory.slice(-30);
    }

    const metadata = (options.version || options.committed || options.source || options.pathId || options.taskId || options.sessionId || options.synthetic)
      ? JSON.stringify({
          version: options.version || undefined,
          committed: options.committed === true,
          source: options.source || undefined,
          scale: 'internal-10',
          pathId: options.pathId || undefined,
          taskId: options.taskId || undefined,
          sessionId: options.sessionId || undefined,
          synthetic: options.synthetic === true ? true : undefined,
        })
      : null;

    // 落库侧自检：任何生产者绕过转换器塞进来的越界值都会在这里被拦下并告警
    const safeMetrics = guardInternalScale(metrics, 'write:build-metric-create-data');

    return {
      id: `lm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      sourceKey: options.sourceKey || null,
      userId,
      pathId: options.pathId || null,
      taskId: options.taskId || null,
      metricType: 'learning_state',
      value: options.primaryMetric === 'lsb' ? safeMetrics.lsb : safeMetrics.lss,
      lss: safeMetrics.lss,
      ktl: safeMetrics.ktl,
      lf: safeMetrics.lf,
      lsb: safeMetrics.lsb,
      lssCurrent: safeMetrics.lss,
      ktlCurrent: safeMetrics.ktl,
      lfCurrent: safeMetrics.lf,
      lsbCurrent: safeMetrics.lsb,
      lssHistory: JSON.stringify(lssHistory),
      metadata,
      calculatedAt: metrics.timestamp,
    };
  }

  private async commitPreparedMetric(prepared: PreparedLearningStateMetricCommit): Promise<void> {
    await withTransaction(async (tx) => {
      const claimed = await tx.users.updateMany({
        where: {
          id: prepared.userId,
          learningStateRevision: prepared.expectedRevision,
        },
        data: {
          learningStateRevision: { increment: 1 },
        }
      });
      if (claimed.count !== 1) {
        throw new LearningStateRevisionConflictError();
      }
      if (prepared.data.sourceKey) {
        await tx.learning_metrics.deleteMany({ where: { sourceKey: prepared.data.sourceKey } });
      }
      await tx.learning_metrics.create({ data: prepared.data as any });
    }, { label: 'learning-state.commitPreparedMetric' });
  }

  /**
   * 获取当前状态
   */
  /**
   * 当前学习状态。
   * @param options.pathId 传值 = 只读该路径的状态；不传 = 全局（跨路径合并，维持旧行为）
   * @param options.asOf   传值 = 以该时刻为准（历史重放/回溯校验用）；不传 = 当前时刻
   */
  async getCurrentState(
    userId: string,
    options: { pathId?: string | null; asOf?: Date } = {},
    /** 预取的 PMC 源行（getStateTrendWindow / getAggregatedState 一次取回后多路复用；缺省自行查库） */
    preloadedPmcRows?: PmcPreloadedMetricRow[]
  ): Promise<LearningStateMetrics | null> {
    const pmc = await this.derivePmcState(userId, options, preloadedPmcRows);
    if (pmc) return pmc;
    // 无已提交行时的兜底：沿用旧读取（wrapup.stateUpdate），保证冷启动/异常态不倒退
    return this.getPreviousMetrics(userId, options);
  }

  /**
   * PMC 读侧派生（2026-10-15 负荷模型改造）：KTL/LF/LSB 由「逐日负荷之和 + 按天 EWMA」重放。
   *
   * **取代**旧「按课 EWMA（写入侧）+ 自然衰减（读取侧）」两套时钟 —— 权威输入是每行的
   * `lss` 列（**该节瞬时压力**，内容驱动、非 EWMA），按应用时区本地日求和成当日负荷，
   * 再逐日推进 PMC（空闲日以 0 参与 = 自然回落）。详见 learning-load.pmc.ts。
   *
   * 返回值**不套 0-10 clamp**（`toInternalTenScale` 会把 >10 的值 /10，那正是用户纠正的
   * 「0-100 是刻度不是区间」——PMC 日负荷可 >10，是正常的"量"）。仅有 lss 走 0-10 归一
   * （它是单节瞬时压力，本就 0-10）。
   */
  private async derivePmcState(
    userId: string,
    options: { pathId?: string | null; asOf?: Date } = {},
    /** 预取的 PMC 源行；调用方保证覆盖到 asOf，此处按 asOf 与 pathId 在内存分区 */
    preloadedPmcRows?: PmcPreloadedMetricRow[]
  ): Promise<LearningStateMetrics | null> {
    // 行过滤与 until 必须**同一时间基准**（2026-10-17 修）：此前行查询用原始 options.asOf（可能
    // undefined ⇒ 不过滤），而 until 用 `options.asOf ?? simulatedNowOr()`，于是 calculatedAt 落在
    // 未来的残留行会**进序列**（贡献当日负荷）却不受 until 影响 —— 实测把一户 LSS 抬到 8.57（真值 1.97）。
    // 写侧早已统一 simulatedNowOr（见文件顶部"时钟域"注释），读侧同口径。
    const asOf = options.asOf ?? simulatedNowOr();
    // replayDailyPmc 不自行剔除晚于 until 的行（它们的日键会把序列延伸到未来），预取行必须在此分区
    const rows = preloadedPmcRows
      ? preloadedPmcRows.filter((row) =>
          row.calculatedAt.getTime() <= asOf.getTime()
          && (options.pathId === undefined || row.pathId === options.pathId))
      : await prisma.learning_metrics.findMany({
          where: this.buildCommittedMetricWhere(userId, undefined, undefined, asOf, options.pathId, true),
          select: { lss: true, ktl: true, lf: true, calculatedAt: true, sourceKey: true, taskId: true },
          orderBy: { calculatedAt: 'asc' },
        });
    if (rows.length === 0) return null;
    // 读取漏斗（保留量纲防线）：lss 是单节瞬时压力，应 0-10 —— 异刻度脏值**可见化 + 归一**，
    // 不让 0-100 的脏值把当日负荷顶高（ktl/lf/lsb 允许 >10，那是"量"不是"区间"，不告警）。
    const normalizedRows = rows.map((r) => {
      let lss = r.lss;
      if (lss != null && Number.isFinite(lss) && (lss < -1e-9 || lss > 10 + 1e-9)) {
        logger.warn('[scale-guard] 读取到越界的单节 LSS（异刻度脏值，已归一）', {
          context: 'read:pmc-lss',
          raw: { lss: r.lss },
        });
      }
      lss = this.normalizeTenScale(lss);
      // sourceKey/taskId 透传给 replayDailyPmc 做跨家族去重：一节课可能同时有
      // session-wrapup（真实 LSS）与 task-completion（合成占位 lss=4）两行，不去重会翻倍。
      return { calculatedAt: r.calculatedAt, lss, ktl: r.ktl, lf: r.lf, sourceKey: r.sourceKey, taskId: r.taskId };
    });
    // until=asOf：把"最后一节课之后到今天"的空闲日补进序列，KTL/LF 才会按 λ^d 回落
    const series = replayDailyPmc(normalizedRows, { until: asOf });
    if (!series.latest) return null;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    // LSS 是**单节瞬时压力**（非累加量）：仍按自然衰减折算到 asOf——否则"5 天前那节难课"
    // 会永远读成"现在压力大"。KTL/LF/LSB 由 PMC 重放（空闲日以 0 参与，已自带回落），不再叠加。
    const lessonAt = series.latestLessonAt ?? simulatedNowOr();
    const lssDayDiff = this.getNaturalDayDiff(lessonAt, options.asOf ?? simulatedNowOr());
    const lss = this.normalizeTenScale(
      (series.latestLessonLss ?? 0) * Math.pow(NATURAL_DECAY.LSS_DAILY_FACTOR, lssDayDiff),
    );
    return {
      lss,
      ktl: round(series.latest.ktl) as LearningStateMetrics['ktl'],
      lf: round(series.latest.lf) as LearningStateMetrics['lf'],
      lsb: round(series.latest.lsb) as LearningStateMetrics['lsb'],
      timestamp: lessonAt,
    };
  }

  /**
   * PMC 逐日状态（趋势图专用）。
   *
   * `/state/current` 已改为 PMC 派生，但 `/state/trends` 此前仍直接读落库行的
   * ktl/lf/lsb（旧「按课 EWMA」值），于是同一屏出现两套口径（实测 current LSB=-6.12
   * 与趋势点 LSB=63.7 并排）。这里按**同一重放**产出逐日 PMC 值，供趋势图与当前卡对齐。
   *
   * 与 `derivePmcState` 共用 `buildCommittedMetricWhere(..., includeSynthetic=true)`：
   * 合成占位行需要参与（否则只有占位行的冷启动用户会读成「无状态」），
   * 去重交给 `replayDailyPmc` 内的 `dedupeLessonRows`。
   */
  private async derivePmcDailySeries(
    userId: string,
    asOf: Date,
    /** 预取的 PMC 源行（含合成占位行）；按 asOf 在内存分区 */
    preloadedPmcRows?: PmcPreloadedMetricRow[]
  ): Promise<Map<string, { ktl: number; lf: number; lsb: number; mature: boolean }>> {
    const rows = (preloadedPmcRows
      ? preloadedPmcRows.filter((row) => row.calculatedAt.getTime() <= asOf.getTime())
      : await prisma.learning_metrics.findMany({
          where: this.buildCommittedMetricWhere(userId, undefined, undefined, asOf, undefined, true),
          select: { lss: true, ktl: true, lf: true, calculatedAt: true, sourceKey: true, taskId: true },
          orderBy: { calculatedAt: 'asc' },
        })) ?? [];
    if (rows.length === 0) return new Map();

    const series = replayDailyPmc(
      rows.map((r) => ({
        calculatedAt: r.calculatedAt,
        lss: this.normalizeTenScale(r.lss),
        ktl: r.ktl,
        lf: r.lf,
        sourceKey: r.sourceKey,
        taskId: r.taskId,
      })),
      { until: asOf },
    );

    const byDay = new Map<string, { ktl: number; lf: number; lsb: number; mature: boolean }>();
    series.daily.forEach((day, index) => {
      const point = series.pmc[index];
      if (!point) return;
      const round = (value: number) => Math.round(value * 1000) / 1000;
      const ktl = round(point.ktl);
      const lf = round(point.lf);
      const lsb = round(point.lsb);
      byDay.set(day.dayKey, {
        ktl,
        lf,
        lsb,
        mature: classifyLoad({ ktl, lf }).mature,
      });
    });
    return byDay;
  }

  /** 内部 PMC 点 → display 0-100（与 toDisplayMetrics 同换算/同 clamp） */
  private pmcPointToDisplay(point: { ktl: number; lf: number; lsb: number }): {
    ktl: number;
    lf: number;
    lsb: number;
  } {
    const round = (value: number) => Number((value * 10).toFixed(2));
    return {
      ktl: Math.min(100, Math.max(0, round(point.ktl))),
      lf: Math.min(100, Math.max(0, round(point.lf))),
      lsb: Math.min(100, Math.max(-100, round(point.lsb))),
    };
  }

  /**
   * 学习者级状态 = **PMC 日负荷模型**（跨路径统一）。
   *
   * 与旧实现（按路径 max + 当日课量疲劳加成）的区别：PMC 口径下**负荷就是负荷、与路径无关**，
   * 且「同日多课」已由日负荷求和进入 KTL/LF —— 故不再需要跨路径 max，也不再需要外挂的
   * `dayLoad` 疲劳加成（那会与日负荷求和重复计算同一件事）。`perPath` 仍按路径给出 PMC 分解，
   * 供课内/路径级判断使用；`dayLoad` 保留为**原始观测**（课节数/时长），不再叠加进 lf。
   *
   * 没有任何状态行时返回 null（调用方自行决定回退）。
   */
  async getAggregatedState(
    userId: string,
    options: { asOf?: Date } = {}
  ): Promise<AggregatedLearningState | null> {
    const asOf = options.asOf ?? simulatedNowOr();
    const snapshots = await this.listCommittedSnapshots(userId, undefined, undefined, asOf);
    if (snapshots.length === 0) return null;

    // PMC 源行一次取回（含合成占位行），全局与每条路径的 derivePmcState 共用：
    // 旧口径是 2+P 次独立全量 findMany + P 次完整重放（P = 路径数），预取后只剩内存分区。
    const pmcRows = await prisma.learning_metrics.findMany({
      where: this.buildCommittedMetricWhere(userId, undefined, undefined, asOf, undefined, true),
      select: { lss: true, ktl: true, lf: true, calculatedAt: true, sourceKey: true, taskId: true, pathId: true },
      orderBy: { calculatedAt: 'asc' },
    });

    // 全局 PMC（跨全部路径的逐日负荷序列）
    const globalMetrics = (await this.derivePmcState(userId, { asOf }, pmcRows)) ?? null;
    if (!globalMetrics) return null;

    // 每条路径的 PMC 分解（供路径级/课内判断；不再做跨路径 max）
    const pathIds = [...new Set(snapshots.map((s) => s.pathId).filter((id): id is string => !!id))];
    const perPath = (
      await Promise.all(
        pathIds.map(async (pathId) => {
          const m = await this.derivePmcState(userId, { pathId, asOf }, pmcRows);
          if (!m) return null;
          const last = snapshots.filter((s) => s.pathId === pathId).pop();
          return { pathId, metrics: m, calculatedAt: last?.calculatedAt ?? asOf };
        }),
      )
    ).filter((entry): entry is { pathId: string; metrics: LearningStateMetrics; calculatedAt: Date } => !!entry);

    // 活跃窗口：超窗（久未活动）的路径不算"当前总负担"的一部分。perPath 仍完整返回供审计。
    // 旧实现"窗口内为空则回退全部路径"是为了给 max 聚合兜底；PMC 的全局量是跨路径日负荷、
    // 不再依赖 perPath，故按字面给"窗口内路径"（全闲置 = 空，更诚实）。
    // 固定毫秒窗口在应用时区（Asia/Shanghai，固定偏移无 DST）下与日历日窗口逐毫秒等价。
    const windowStart = new Date(asOf.getTime() - AGGREGATION_ACTIVE_WINDOW_DAYS * DAY_BOUNDARY_DAY_MS);
    const activePathIds = perPath
      .filter((entry) => entry.calculatedAt >= windowStart)
      .map((entry) => entry.pathId);

    const dayLoad = await this.resolveDayLoad(userId, asOf);
    // PMC 已把同日多课求和进 lf，不再叠加 fatigueBonus（保留字段为 0，避免消费方误读为"没算"）
    const fatigueBonus = 0;

    return {
      metrics: globalMetrics,
      perPath,
      activePathIds,
      dayLoad: { ...dayLoad, fatigueBonus },
      latestAt: snapshots[snapshots.length - 1].calculatedAt,
    };
  }

  /**
   * 当日课量：完成的课节数 + 累计学习时长。
   * 日界走 day-boundary（应用时区本地日，startOfDay 同源），与每日温故配额 / 自然衰减 /
   * 趋势分桶保持一致口径，避免跨时区口径漂移。
   */
  private async resolveDayLoad(userId: string, asOf: Date): Promise<{ lessons: number; minutes: number }> {
    const dayStart = startOfDay(asOf);
    const [lessons, sessions] = await Promise.all([
      prisma.subtasks.count({
        where: { userId, status: 'completed', completedAt: { gte: dayStart, lte: asOf } },
      }),
      prisma.teaching_sessions.aggregate({
        _sum: { duration: true },
        // 只统计"真实学习时长"：排除被替换/丢弃/失败的会话，否则同一节课会被重复计入
        // （重开一节 → superseded + 新会话），把时长加成顶高 → 全局 lf 虚高 →
        // 误判疲劳减速/降档/重排（18 号报告 N8）。
        where: {
          userId,
          startTime: { gte: dayStart, lte: asOf },
          status: { notIn: ['superseded', 'discarded', 'failed', 'finalization_failed'] },
        },
      }),
    ]);
    return { lessons, minutes: sessions._sum.duration || 0 };
  }

  /**
   * 获取状态趋势（最近 N 天）
   */
  async getTrendsSince(userId: string, since: Date): Promise<LearningStateMetrics[]> {
    const snapshots = await this.listCommittedSnapshots(userId, since);

    return snapshots.map((snapshot) => ({
      ...snapshot.metrics,
      timestamp: snapshot.calculatedAt,
    }));
  }

  async getSessionStateTimeline(
    userId: string,
    sessionIds: string[]
  ): Promise<LearningStateSessionTimelineEntry[]> {
    const requestedIds = Array.from(new Set(
      sessionIds.map((sessionId) => String(sessionId || '').trim()).filter(Boolean)
    )).slice(0, 120);
    if (!requestedIds.length) return [];

    const sessions = await prisma.teaching_sessions.findMany({
      where: {
        userId,
        id: { in: requestedIds },
      },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        taskId: true,
        learningPathId: true,
        status: true,
        wrapup: true,
        startTime: true,
        endTime: true,
      },
    });
    if (!sessions.length) return [];

    const ownedSessionIds = new Set(sessions.map((session) => session.id));
    const committedRows = await prisma.learning_metrics.findMany({
      where: {
        ...this.buildCommittedMetricWhere(userId),
        // 会话已提交指标的 sourceKey 恒为 `session-wrapup:<sessionId>`（prepareSessionScoreCommit
        // 是唯一写入点），走唯一索引精确命中。旧口径对每个会话拼一条 metadata LIKE（≤120 个），
        // SQLite 下对每行做全文子串匹配，索引完全用不上。
        sourceKey: { in: requestedIds.map((sessionId) => `session-wrapup:${sessionId}`) },
      },
      orderBy: { calculatedAt: 'asc' },
      select: {
        pathId: true,
        taskId: true,
        metadata: true,
        lss: true,
        ktl: true,
        lf: true,
        lsb: true,
        calculatedAt: true,
      },
    });

    const committedBySession = new Map<string, typeof committedRows[number]>();
    for (const row of committedRows) {
      const sessionId = this.parseMetricMetadata(row.metadata)?.sessionId;
      if (typeof sessionId === 'string' && ownedSessionIds.has(sessionId)) {
        committedBySession.set(sessionId, row);
      }
    }

    return sessions.map((session) => {
      const committedRow = committedBySession.get(session.id) || null;
      const committedSnapshot = committedRow ? this.metricRecordToSnapshot(committedRow) : null;
      const wrapupSnapshot = committedSnapshot ? null : this.wrapupSessionToSnapshot(session);
      const snapshot = committedSnapshot || wrapupSnapshot;
      const wrapup = this.parseMetricMetadata(session.wrapup);
      const summarySource = typeof wrapup?.summarySource === 'string'
        ? wrapup.summarySource
        : typeof wrapup?.sources?.summary === 'string' ? wrapup.sources.summary : null;
      const evaluationSource = typeof wrapup?.evaluationSource === 'string'
        ? wrapup.evaluationSource
        : typeof wrapup?.sources?.evaluation === 'string' ? wrapup.sources.evaluation : null;
      const source = committedSnapshot
        ? 'committed-metric' as const
        : wrapupSnapshot ? 'teaching-wrapup' as const : 'missing' as const;

      return {
        teachingSessionId: session.id,
        taskId: committedRow?.taskId || session.taskId || null,
        pathId: committedRow?.pathId || session.learningPathId || null,
        status: session.status,
        metrics: snapshot?.metrics || null,
        calculatedAt: snapshot?.calculatedAt || session.endTime || session.startTime,
        source,
        summarySource,
        evaluationSource,
        degraded: evaluationSource
          ? evaluationSource !== 'model'
          : source === 'missing' && session.status !== 'active',
      };
    });
  }

  async getTrends(userId: string, days: number = 7): Promise<LearningStateMetrics[]> {
    const since = new Date(startOfDay(simulatedNowOr()).getTime() - days * DAY_BOUNDARY_DAY_MS);

    return this.getTrendsSince(userId, since);
  }

  /**
   * 分析对话认知层级
   * 基于布鲁姆分类法 (Bloom's Taxonomy)
   */
  analyzeCognitiveLevel(studentMessage: string, contextMessage?: string): DialogueAnalysis {
    const message = studentMessage.toLowerCase();

    // 关键词映射到认知层级
    const levelKeywords: Record<CognitiveLevel, string[]> = {
      [CognitiveLevel.REMEMBER]: ['什么是', '定义', '记住', '列举', '名称', '概念'],
      [CognitiveLevel.UNDERSTAND]: ['为什么', '解释', '理解', '意思', '区别', '比较'],
      [CognitiveLevel.APPLY]: ['怎么用', '应用', '实践', '例子', '如何使用', '实现'],
      [CognitiveLevel.ANALYZE]: ['分析', '分解', '关系', '结构', '原理', '为什么这样'],
      [CognitiveLevel.EVALUATE]: ['评估', '判断', '优劣', '哪个更好', '建议', '推荐'],
      [CognitiveLevel.CREATE]: ['创造', '设计', '构建', '方案', '如果', '改进'],
    };

    // 困惑关键词
    const confusionKeywords = ['不懂', '不明白', '困惑', '疑惑', '为什么', '怎么', '错', '失败'];
    const confusionPoints: string[] = [];

    for (const keyword of confusionKeywords) {
      if (message.includes(keyword)) {
        confusionPoints.push(keyword);
      }
    }

    // 判断认知层级
    let detectedLevel: CognitiveLevel = CognitiveLevel.REMEMBER;
    let maxMatches = 0;

    for (const [level, keywords] of Object.entries(levelKeywords)) {
      const matches = keywords.filter(k => message.includes(k)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedLevel = level as CognitiveLevel;
      }
    }

    // 计算理解度（基于问题复杂度）
    const understanding = maxMatches > 0 ? Math.min(1, 0.3 + maxMatches * 0.2) : 0.5;

    // 计算参与度（基于消息长度和复杂度）
    const engagement = Math.min(1, studentMessage.length / 100);

    // 判断情绪状态
    let emotionalState: DialogueAnalysis['emotionalState'] = 'neutral';
    if (message.includes('谢谢') || message.includes('明白') || message.includes('懂了')) {
      emotionalState = 'positive';
    } else if (message.includes('难') || message.includes('不会') || message.includes('失败')) {
      emotionalState = 'frustrated';
    } else if (confusionPoints.length > 0) {
      emotionalState = 'confused';
    }

    return {
      cognitiveLevel: detectedLevel,
      understanding,
      confusionPoints,
      engagement,
      emotionalState,
    };
  }

  /**
   * 生成学习建议
   */
  generateSuggestion(metrics: LearningStateMetrics): {
    type: 'fatigue' | 'lsb_negative' | 'efficiency_drop' | 'overstudy' | 'good';
    title: string;
    message: string;
  } {
    const { lss, ktl, lf, lsb } = metrics;

    // 高疲劳
    if (lf > 7) {
      return {
        type: 'fatigue',
        title: '需要休息',
        message: '你的学习疲劳度较高，建议休息后再继续。',
      };
    }

    // LSB 为负
    if (lsb < 0) {
      return {
        type: 'lsb_negative',
        title: '状态不佳',
        message: '当前疲劳超过知识积累，建议调整学习节奏。',
      };
    }

    // 过度学习
    if (ktl > 7 && lsb < 2) {
      return {
        type: 'overstudy',
        title: '需要巩固',
        message: '已掌握较多知识，建议通过练习巩固而非继续学习新内容。',
      };
    }

    // 状态良好
    if (lsb > 3 && lss < 5) {
      return {
        type: 'good',
        title: '状态良好',
        message: '你的学习状态很好，继续保持！',
      };
    }

    // 默认
    return {
      type: 'efficiency_drop',
      title: '注意效率',
      message: '当前学习效率一般，建议调整学习方法。',
    };
  }

  // ============================================================
  // 显示层（0-100 刻度）——原 state-tracking.service 并入（2026-08 去重合并）
  // 前端展示、建议与预警统一走这些方法；内部计算仍用 0-10 内部量。
  // ============================================================

  private hasUsableDisplayMetrics(metrics: {
    lss: number | null;
    ktl: number | null;
    lf: number | null;
    lsb: number | null;
  }): boolean {
    const values = [metrics.lss, metrics.ktl, metrics.lf, metrics.lsb];
    const normalized = values.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0));
    return !normalized.every((value) => value === 0);
  }

  /**
   * 获取当前学习状态（显示层 0-100）；无可用数据返回 null
   */
  async getCurrentStateDisplay(userId: string): Promise<LearningStateDisplayMetrics | null> {
    try {
      const metrics = await this.getCurrentState(userId);
      if (!metrics) return null;
      const displayMetrics = this.toDisplayMetrics(metrics);
      if (!this.hasUsableDisplayMetrics(displayMetrics)) return null;
      // 相对量判据与 /state/warnings 同源：未成熟的适应基座不做「严重疲劳」判定。
      const verdict = classifyLoad({ ktl: metrics.ktl, lf: metrics.lf });
      return {
        lss: displayMetrics.lss,
        ktl: displayMetrics.ktl,
        lf: displayMetrics.lf,
        lsb: displayMetrics.lsb,
        updatedAt: metrics.timestamp.toISOString(),
        mature: verdict.mature,
        verdict: {
          form: verdict.form,
          acwr: verdict.acwr,
          fatigueRisk: verdict.fatigueRisk,
          pacing: verdict.pacing,
          imbalanced: verdict.imbalanced,
          mature: verdict.mature,
        },
      };
    } catch (error) {
      logger.error('获取当前学习状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取学习状态趋势（显示层，最近 N 天）
   */
  async getStateTrends(
    userId: string,
    days: number = 30
  ): Promise<LearningStateTrendPoint[]> {
    const result = await this.getStateTrendWindow(userId, { days, mode: 'recent' });
    return result.trends;
  }

  /**
   * 获取学习状态趋势窗口（显示层；recent=最近 N 天，all=自注册日起）
   */
  async getStateTrendWindow(
    userId: string,
    options?: {
      days?: number;
      mode?: 'recent' | 'all';
    }
  ): Promise<LearningStateTrendWindow> {
    try {
      const requestedDays = Math.max(1, Math.min(365, options?.days ?? 30));
      const mode = options?.mode === 'all' ? 'all' : 'recent';
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      });

      // 日界走 day-boundary（应用时区本地日，与自然衰减 / 当日课量 / 温故配额 / 日期模拟同口径）。
      const today = startOfDay(simulatedNowOr());

      const registeredAt = user?.createdAt ? startOfDay(user.createdAt) : new Date(today);

      const requestedStartDate = new Date(today.getTime() - (requestedDays - 1) * DAY_BOUNDARY_DAY_MS);

      const startDate = mode === 'all'
        ? new Date(registeredAt)
        : new Date(Math.max(requestedStartDate.getTime(), registeredAt.getTime()));

      const metrics = await this.getTrendsSince(userId, startDate);
      // 跨日模拟（虚拟学习者）：课的业务时间（calculatedAt → metric.timestamp）可能落在「真实今天」之后
      // ——模拟时间线独立于物理世界。窗口上界不能只看 today，否则这些**已记录**的模拟日会被循环裁掉
      // （admin 证据接口无模拟钟上下文、today=真实今天 时尤其明显：整条压力曲线消失，只剩真实日的点）。
      // 上界取 max(真实今天, 最新指标日)：真实用户不受影响（其指标不会晚于今天）。
      const latestMetricMs = metrics.reduce((mx, m) => {
        const t = m.timestamp instanceof Date ? m.timestamp.getTime() : new Date(m.timestamp as unknown as string).getTime();
        return Number.isFinite(t) && t > mx ? t : mx;
      }, today.getTime());
      const windowEnd = latestMetricMs > today.getTime() ? startOfDay(new Date(latestMetricMs)) : today;
      const actualDays = Math.max(1, Math.floor((windowEnd.getTime() - startDate.getTime()) / DAY_BOUNDARY_DAY_MS) + 1);
      // 热路径合并（2026-10-24）：旧实现在这里对同一份「用户全部已提交指标行」做 3 次独立
      // findMany（getCurrentState 的 derivePmcState、derivePmcDailySeries、以及
      // getLatestCommittedMetricBefore 的全量 listCommittedSnapshots），每次各自全量拉取 +
      // 重放。现在一次取回 ≤ max(windowEnd, now) 的全部行（含合成占位行，与 PMC 读侧口径
      // 一致），在内存按 asOf 分区给「当前状态」与「逐日序列」共用；逐日重放本身 O(天数)，便宜。
      // latestMetricBeforeWindow 走 getLatestCommittedMetricBefore 的 DB 级 take-1 快路径。
      const nowForWindow = simulatedNowOr();
      const preloadedPmcRows = await prisma.learning_metrics.findMany({
        where: this.buildCommittedMetricWhere(
          userId,
          undefined,
          undefined,
          new Date(Math.max(windowEnd.getTime(), nowForWindow.getTime())),
          undefined,
          true,
        ),
        select: { lss: true, ktl: true, lf: true, calculatedAt: true, sourceKey: true, taskId: true, pathId: true },
        orderBy: { calculatedAt: 'asc' },
      });
      const currentState = await this.getCurrentState(userId, {}, preloadedPmcRows);
      const latestMetricBeforeWindow = await this.getLatestCommittedMetricBefore(userId, startDate);
      // 趋势与 /state/current 必须同口径（PMC 逐日重放）。asOf 取窗口末日 **末刻**，
      // 否则 `calculatedAt <= startOfDay` 会把末日当天的课排除在重放之外。
      const pmcByDay = await this.derivePmcDailySeries(
        userId,
        new Date(windowEnd.getTime() + DAY_BOUNDARY_DAY_MS - 1),
        preloadedPmcRows
      );

      const metricsByDay = new Map<string, typeof metrics>();
      for (const metric of metrics) {
        const key = dayKeyOf(metric.timestamp);
        const list = metricsByDay.get(key) || [];
        list.push(metric);
        metricsByDay.set(key, list);
      }

      const trends: LearningStateTrendPoint[] = [];
      let lastKnownMetric = latestMetricBeforeWindow;
      const todayKey = dayKeyOf(simulatedNowOr());

      for (let i = 0; i < actualDays; i += 1) {
        // 每个本地日的展示锚点：本地正午
        const currentDate = new Date(startOfDay(new Date(startDate.getTime() + i * DAY_BOUNDARY_DAY_MS)).getTime() + 12 * 3600 * 1000);
        const key = dayKeyOf(currentDate);
        const dayMetrics = metricsByDay.get(key) || [];
        const pmcPoint = pmcByDay.get(key);
        const pmcDisplay = pmcPoint ? this.pmcPointToDisplay(pmcPoint) : null;

        if (dayMetrics.length === 0) {
          if (!pmcPoint && !lastKnownMetric) {
            trends.push({ date: new Date(currentDate), lss: null, ktl: null, lf: null, lsb: null });
            continue;
          }

          if (!lastKnownMetric) {
            // 窗口前无历史、但 PMC 已从窗口内首日重放出来：仍按 PMC 给值（lss 无当日课，留空）。
            trends.push({
              date: new Date(currentDate),
              lss: null,
              ktl: pmcDisplay?.ktl ?? null,
              lf: pmcDisplay?.lf ?? null,
              lsb: pmcDisplay?.lsb ?? null,
              mature: pmcPoint?.mature,
            });
            continue;
          }

          const restoredMetric = key === todayKey && currentState
            ? currentState
            : this.restoreMetrics(lastKnownMetric, currentDate);
          const displayMetric = this.toDisplayMetrics(restoredMetric);
          // 日负荷/疲劳/平衡统一读 PMC；LSS 保持原「最近一节课自然衰减」语义（瞬时压力的展示值）。
          trends.push({
            date: new Date(currentDate),
            lss: displayMetric.lss,
            ktl: pmcDisplay?.ktl ?? displayMetric.ktl,
            lf: pmcDisplay?.lf ?? displayMetric.lf,
            lsb: pmcDisplay?.lsb ?? displayMetric.lsb,
            mature: pmcPoint?.mature ?? classifyLoad({
              ktl: Number(restoredMetric.ktl),
              lf: Number(restoredMetric.lf),
            }).mature,
          });
          continue;
        }

        const displayDayMetrics = dayMetrics.map((m) => this.toDisplayMetrics(m));
        // display 刻度是品牌类型（number 的子类型）：`typeof === 'number'` 的守卫不再需要，
        // 保留"有效值"过滤只为了剔除 NaN/非有限值。
        const validLss = displayDayMetrics
          .map((m) => Number(m.lss))
          .filter((value) => Number.isFinite(value));
        const avgLss = validLss.length > 0
          ? validLss.reduce((sum, value) => sum + value, 0) / validLss.length
          : null;

        const lastMetric = displayDayMetrics[displayDayMetrics.length - 1];
        lastKnownMetric = dayMetrics[dayMetrics.length - 1];
        trends.push({
          date: new Date(currentDate),
          lss: avgLss,
          ktl: pmcDisplay?.ktl ?? lastMetric?.ktl ?? null,
          lf: pmcDisplay?.lf ?? lastMetric?.lf ?? null,
          lsb: pmcDisplay?.lsb ?? lastMetric?.lsb ?? null,
          mature: pmcPoint?.mature ?? (lastMetric
            ? classifyLoad({ ktl: Number(lastMetric.ktl) / 10, lf: Number(lastMetric.lf) / 10 }).mature
            : undefined),
        });
      }

      return {
        trends,
        range: {
          mode,
          requestedDays: mode === 'all' ? 'all' : requestedDays,
          actualDays,
          registeredAt: registeredAt.toISOString(),
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(windowEnd).toISOString(),
        },
      };
    } catch (error) {
      logger.error('获取学习趋势失败:', error);
      throw error;
    }
  }

  /**
   * 生成学习建议（显示层 4 分类：压力/状态/知识增长/时长）
   * 纯逻辑已抽到 learning-state-suggestion.ts（服务文件受 layering 棘轮约束）。
   */
  generateDisplaySuggestion(metrics: LearningStateDisplayMetrics): LearningStateDisplaySuggestion {
    return buildDisplaySuggestion(metrics);
  }

  /**
   * 检查学习预警（显示层；数据不足不产生预警）
   */
  async checkWarnings(userId: string): Promise<LearningStateWarning[]> {
    const warnings: LearningStateWarning[] = [];

    try {
      // 获取最近7天的数据
      const trends = await this.getStateTrends(userId, 7);
      const validTrends = trends.filter(
        (item): item is { date: Date; lss: number; ktl: number; lf: number; lsb: number } =>
          item.lss !== null && item.ktl !== null && item.lf !== null && item.lsb !== null
      );

      if (validTrends.length < 2) {
        return warnings; // 数据不足，不产生预警
      }

      // 1. 连续高疲劳：用 PMC 相对量（ACWR/form），不再用绝对 LF>70。
      //    绝对阈值在日负荷口径下会把「习惯每天 3 课」的已适应学习者永久误报。
      const recentVerdicts = validTrends.slice(-3).map((t) => classifyLoad({ ktl: t.ktl, lf: t.lf }));
      if (recentVerdicts.length >= 3 && recentVerdicts.every((v) => v.fatigueRisk === 'high')) {
        warnings.push({
          type: 'fatigue',
          level: 'critical',
          title: '学习疲劳预警',
          message: '你最近连续 3 天的急性负荷明显高于适应基座（ACWR ≥ 1.5），疲劳正在累积。',
          suggestion: '建议暂停学习1-2天，做一些轻松的事情恢复精力，后续降低学习强度。'
        });
      }

      // 2. 检查负荷失衡（form<0 且适应基座已成熟；冷启动爬升期不算）——与上一条共用同一组 verdict
      if (recentVerdicts.length >= 2 && recentVerdicts.slice(-2).every((v) => v.imbalanced)) {
        warnings.push({
          type: 'lsb_negative',
          level: 'warning',
          title: '学习状态预警',
          message: '你的疲劳已连续超过知识积累（form = KTL − LF 为负），当前处于负荷失衡。',
          suggestion: '建议调整学习计划，减少每日学习量或选择更简单的任务。'
        });
      }

      // 3. 检查效率下降（通过LSS趋势判断）
      const recentLSS = validTrends.slice(-5);
      if (recentLSS.length >= 3) {
        const avgLSSRecent = recentLSS.slice(-2).reduce((a, b) => a + b.lss, 0) / 2;
        const avgLSSBefore = recentLSS.slice(0, -2).reduce((a, b) => a + b.lss, 0) / (recentLSS.length - 2);

        // 如果最近LSS明显高于之前，说明压力增大（效率可能下降）
        if (avgLSSRecent > avgLSSBefore + 15) {
          warnings.push({
            type: 'efficiency_drop',
            level: 'warning',
            title: '学习效率预警',
            message: `你最近的学习压力评分明显上升（从 ${avgLSSBefore.toFixed(1)} 到 ${avgLSSRecent.toFixed(1)}）。`,
            suggestion: '可能是任务难度过高或疲劳累积，建议回顾学习方法或适当休息。'
          });
        }
      }

      // 4. 负荷爬升提醒（相对量）：ACWR 进入中/高档但尚未连续高疲劳。
      const current = validTrends[validTrends.length - 1];
      const currentVerdict = current ? classifyLoad({ ktl: current.ktl, lf: current.lf }) : null;
      if (currentVerdict && currentVerdict.ramping && currentVerdict.fatigueRisk !== 'high') {
        warnings.push({
          type: 'overstudy',
          level: 'info',
          title: '学习平衡提醒',
          message: `你的急性负荷比（ACWR）为 ${currentVerdict.acwr?.toFixed(2) ?? '—'}，近期负荷涨得比适应基座快。`,
          suggestion: '知识积累仍在继续，但建议先稳住节奏，避免连续加量。'
        });
      }

      return warnings;
    } catch (error) {
      logger.error('检查学习预警失败:', error);
      return warnings;
    }
  }
}

// 导出单例
export const learningStateService = new LearningStateService();
export default learningStateService;
