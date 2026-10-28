/**
 * Learning State 读侧（2026-10-24 架构优化批 1：learning-state.service.ts 拆分）。
 *
 * 迁入：PMC 派生（derivePmcState/derivePmcDailySeries，含 2b 滚动 checkpoint）、
 * 学习者级聚合、趋势窗口（PMC 逐日）、展示层换算入口、预警。
 *
 * 与服务壳（learning-state.service.ts）的边界：本类**不 import 服务壳**（避免环），
 * 需要壳上的方法时经构造注入闭包（deps）——闭包在调用时解析 `this.xxx`，
 * 因此测试对壳实例方法的 spy（如 listCommittedSnapshots）依旧生效。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
// 时钟域：读取侧的自然衰减必须与写入侧同用模拟时刻（见服务壳顶部"时钟域"注释）
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
// 日界单一真理源（应用时区本地日）——所有"按天归组/比较"必须走这里
import { dayKeyOf, startOfDay, dayDiffInDays, DAY_BOUNDARY_DAY_MS } from '../time/day-boundary';
import { replayDailyPmc } from './learning-load-pmc.service';
import { loadLatestCheckpoint, maybeWriteCheckpoint } from './learning-pmc-checkpoint';
import { classifyLoad } from './learning-load-verdict';
import {
  AGGREGATION_ACTIVE_WINDOW_DAYS,
  type AggregatedLearningState,
  type DisplayMetrics,
  type LearningStateCommittedSnapshot,
  type LearningStateDisplayMetrics,
  type LearningStateMetrics,
  type LearningStateSessionTimelineEntry,
  type LearningStateTrendPoint,
  type LearningStateTrendWindow,
  type LearningStateWarning,
  type PmcPreloadedMetricRow,
  NATURAL_DECAY,
  toInternalTenScale,
} from './learning-state-types';
import {
  committedMetricWhere,
  metricRecordToSnapshot,
  parseMetricMetadata,
  wrapupSessionToSnapshot,
} from './learning-state-history';

/** 服务壳注入的依赖（调用时解析，保住壳实例上的 spy 可见性——内部跨方法调用必须走这里） */
export interface LearningStateReadDeps {
  listCommittedSnapshots: (
    userId: string,
    since?: Date,
    excludedSourceKey?: string,
    asOf?: Date,
    pathId?: string | null
  ) => Promise<LearningStateCommittedSnapshot[]>;
  restoreMetrics: (
    input: {
      lss: number | null | undefined;
      ktl: number | null | undefined;
      lf: number | null | undefined;
      lsb: number | null | undefined;
      timestamp: Date;
    },
    asOf?: Date
  ) => LearningStateMetrics;
  toDisplayMetrics: (metrics: LearningStateMetrics) => DisplayMetrics;
  getPreviousMetrics: (
    userId: string,
    options?: { pathId?: string | null; asOf?: Date }
  ) => Promise<LearningStateMetrics | null>;
  getLatestCommittedMetricBefore: (userId: string, before: Date) => Promise<LearningStateMetrics | null>;
  getCurrentState: (
    userId: string,
    options?: { pathId?: string | null; asOf?: Date },
    preloadedPmcRows?: PmcPreloadedMetricRow[]
  ) => Promise<LearningStateMetrics | null>;
  getTrendsSince: (userId: string, since: Date) => Promise<LearningStateMetrics[]>;
  getStateTrends: (userId: string, days?: number) => Promise<LearningStateTrendPoint[]>;
}

export class LearningStateReadService {
  constructor(private readonly deps: LearningStateReadDeps) {}

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
    return this.deps.getPreviousMetrics(userId, options);
  }

  /** PMC 派生当前状态（公开供服务壳委托与测试直连；checkpoint 集成在内） */
  async derivePmcState(
    userId: string,
    options: { pathId?: string | null; asOf?: Date } = {},
    preloadedPmcRows?: PmcPreloadedMetricRow[]
  ): Promise<LearningStateMetrics | null> {
    // 行过滤与 until 必须**同一时间基准**（2026-10-17 修）：此前行查询用原始 options.asOf（可能
    // undefined ⇒ 不过滤），而 until 用 `options.asOf ?? simulatedNowOr()`，于是 calculatedAt 落在
    // 未来的残留行会**进序列**（贡献当日负荷）却不受 until 影响 —— 实测把一户 LSS 抬到 8.57（真值 1.97）。
    // 写侧早已统一 simulatedNowOr（见服务壳顶部"时钟域"注释），读侧同口径。
    const asOf = options.asOf ?? simulatedNowOr();
    // PMC 滚动 checkpoint（架构优化批 2b）：全局序列、且调用方未预取全量行时，
    // 从最新 checkpoint 续放——只拉 checkpoint 日之后的行（30 天一段，读取成本封顶）。
    // 预取路径（趋势窗口/聚合）拿的是全量行，跳过种子但仍可全量重放，行为不变。
    const useCheckpoint = options.pathId === undefined && !preloadedPmcRows;
    const checkpoint = useCheckpoint ? await loadLatestCheckpoint(userId, asOf) : null;
    // replayDailyPmc 不自行剔除晚于 until 的行（它们的日键会把序列延伸到未来），预取行必须在此分区
    const rows = preloadedPmcRows
      ? preloadedPmcRows.filter((row) =>
          row.calculatedAt.getTime() <= asOf.getTime()
          && (options.pathId === undefined || row.pathId === options.pathId))
      : await prisma.learning_metrics.findMany({
          where: committedMetricWhere(
            userId,
            checkpoint ? checkpoint.rowsSince : undefined,
            undefined,
            asOf,
            options.pathId,
            true,
          ),
          select: { lss: true, ktl: true, lf: true, calculatedAt: true, sourceKey: true, taskId: true },
          orderBy: { calculatedAt: 'asc' },
        });
    if (rows.length === 0 && !checkpoint) return null;
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
      lss = toInternalTenScale(lss);
      // sourceKey/taskId 透传给 replayDailyPmc 做跨家族去重：一节课可能同时有
      // session-wrapup（真实 LSS）与 task-completion（合成占位 lss=4）两行，不去重会翻倍。
      return { calculatedAt: r.calculatedAt, lss, ktl: r.ktl, lf: r.lf, sourceKey: r.sourceKey, taskId: r.taskId };
    });
    // until=asOf：把"最后一节课之后到今天"的空闲日补进序列，KTL/LF 才会按 λ^d 回落
    const series = replayDailyPmc(
      normalizedRows,
      { until: asOf, ...(checkpoint ? { seed: checkpoint.seed } : {}) },
    );
    if (!series.latest) return null;
    // 2b：重放完成后按 30 天节奏滚动写回 checkpoint（maybeWriteCheckpoint 内部 best-effort，
    // 失败只 warn 不影响读取；daily 为空——纯种子无新课时——自然跳过）
    if (useCheckpoint) {
      await maybeWriteCheckpoint(userId, series, checkpoint?.dayKey ?? null);
    }
    const round = (value: number) => Math.round(value * 1000) / 1000;
    // LSS 是**单节瞬时压力**（非累加量）：仍按自然衰减折算到 asOf——否则"5 天前那节难课"
    // 会永远读成"现在压力大"。KTL/LF/LSB 由 PMC 重放（空闲日以 0 参与，已自带回落），不再叠加。
    const lessonAt = series.latestLessonAt ?? simulatedNowOr();
    const lssDayDiff = this.getNaturalDayDiff(lessonAt, options.asOf ?? simulatedNowOr());
    const lss = toInternalTenScale(
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
   * 与 `derivePmcState` 共用 `committedMetricWhere(..., includeSynthetic=true)`：
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
          where: committedMetricWhere(userId, undefined, undefined, asOf, undefined, true),
          select: { lss: true, ktl: true, lf: true, calculatedAt: true, sourceKey: true, taskId: true },
          orderBy: { calculatedAt: 'asc' },
        })) ?? [];
    if (rows.length === 0) return new Map();

    const series = replayDailyPmc(
      rows.map((r) => ({
        calculatedAt: r.calculatedAt,
        lss: toInternalTenScale(r.lss),
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
   * 自然衰减用的"过了几天"。日界统一走 day-boundary（应用时区本地日）：
   * 与当日课量 / 温故配额 / 日期模拟 / 趋势分桶同口径（历史事故见服务壳同名方法注释）。
   */
  private getNaturalDayDiff(from: Date, to: Date): number {
    return dayDiffInDays(from, to);
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
    const snapshots = await this.deps.listCommittedSnapshots(userId, undefined, undefined, asOf);
    if (snapshots.length === 0) return null;

    // PMC 源行一次取回（含合成占位行），全局与每条路径的 derivePmcState 共用：
    // 旧口径是 2+P 次独立全量 findMany + P 次完整重放（P = 路径数），预取后只剩内存分区。
    const pmcRows = await prisma.learning_metrics.findMany({
      where: committedMetricWhere(userId, undefined, undefined, asOf, undefined, true),
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
    const snapshots = await this.deps.listCommittedSnapshots(userId, since);

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
        ...committedMetricWhere(userId),
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
      const sessionId = parseMetricMetadata(row.metadata)?.sessionId;
      if (typeof sessionId === 'string' && ownedSessionIds.has(sessionId)) {
        committedBySession.set(sessionId, row);
      }
    }

    return sessions.map((session) => {
      const committedRow = committedBySession.get(session.id) || null;
      const committedSnapshot = committedRow ? metricRecordToSnapshot(committedRow) : null;
      const wrapupSnapshot = committedSnapshot ? null : wrapupSessionToSnapshot(session);
      const snapshot = committedSnapshot || wrapupSnapshot;
      const wrapup = parseMetricMetadata(session.wrapup);
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

    return this.deps.getTrendsSince(userId, since);
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
      const metrics = await this.deps.getCurrentState(userId);
      if (!metrics) return null;
      const displayMetrics = this.deps.toDisplayMetrics(metrics);
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

      const metrics = await this.deps.getTrendsSince(userId, startDate);
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
        where: committedMetricWhere(
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
      const currentState = await this.deps.getCurrentState(userId, {}, preloadedPmcRows);
      const latestMetricBeforeWindow = await this.deps.getLatestCommittedMetricBefore(userId, startDate);
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
            : this.deps.restoreMetrics(lastKnownMetric, currentDate);
          const displayMetric = this.deps.toDisplayMetrics(restoredMetric);
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

        const displayDayMetrics = dayMetrics.map((m) => this.deps.toDisplayMetrics(m));
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
   * 检查学习预警（显示层；数据不足不产生预警）
   */
  async checkWarnings(userId: string): Promise<LearningStateWarning[]> {
    const warnings: LearningStateWarning[] = [];

    try {
      // 获取最近7天的数据（经 deps 路由回壳：壳实例上的 spy/替换必须被尊重）
      const trends = await this.deps.getStateTrends(userId, 7);
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
