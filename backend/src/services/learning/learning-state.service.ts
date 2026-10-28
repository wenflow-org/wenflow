/**
 * Learning State Service - AI 原生授课模式核心服务
 * 负责三层状态追踪：LSS/KTL/LF/LSB 计算和数据采集
 *
 * 核心公式：
 * - LSS (Learning Stress Score): 学习压力评分
 * - KTL (Knowledge Training Load): 知识训练负荷 (EWMA, λ=0.95, 半衰期 ≈ 13.5 天)
 * - LF (Learning Fatigue): 学习疲劳度 (EWMA, λ=0.70, 半衰期 ≈ 1.9 天)
 * - LSB (Learning State Balance) = KTL - LF: 学习状态平衡值
 *
 * 2026-10-24 架构优化批 1 拆分：本文件是**服务壳**——提交管线（乐观锁写路径）+
 * 原始已提交行读取 + 对读侧/纯逻辑的门面委托。拆出的模块：
 * - learning-state-types.ts    类型 / 常量 / 刻度品牌函数（无 DB）
 * - learning-state-history.ts  已提交行查询条件与快照复原助手（纯函数）
 * - learning-state-reads.ts    PMC 派生 / 趋势窗口 / 展示层 / 预警（读侧类）
 * - learning-state-advisor.ts  对话认知层级分析与建议（纯逻辑）
 * 委托方法保留原签名：测试对实例方法的 spy（listCommittedSnapshots、提交管线一组）不受影响。
 */

// 兼容性再导出：既有 30+ 导入方继续从本文件取类型/常量/错误类，不受拆分影响
export * from './learning-state-types';
export * from './learning-state-advisor';

import prisma from '../../config/database';
import { withTransaction } from '../../utils/with-transaction';
import { logger } from '../../utils/logger';
// 时钟域：状态写入侧早已用模拟时刻（simulatedNowOr），读取侧的自然衰减必须同口径——
// 否则跨日模拟里"隔了一个模拟日"的疲劳恢复会按真实墙钟差（≈0 或夸张天数）计算。
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
// 日界单一真理源（应用时区本地日）——所有"按天归组/比较"必须走这里
import { dayDiffInDays } from '../time/day-boundary';
import {
  type DisplayMetrics,
  type InternalBalance,
  type InternalTen,
  type LearningStateCommittedSnapshot,
  type LearningStateDisplayMetrics,
  type LearningStateMetricPersistOptions,
  type LearningStateMetrics,
  type LSSInputs,
  type PmcPreloadedMetricRow,
  type PreparedLearningStateMetricCommit,
  type DisplayMetricCommitInput,
  type SessionScoreInput,
  LearningStateRevisionConflictError,
  EWMA_CONFIG,
  NATURAL_DECAY,
  asDisplayBalance,
  asDisplayHundred,
  guardInternalScale,
  toInternalBalance,
  toInternalTenScale,
} from './learning-state-types';
import {
  COMMITTED_METRIC_VERSION,
  committedMetricWhere,
  coerceMetricsInternal,
  displayBalanceScaleToInternal,
  displayTenScaleToInternal,
  metricRecordToSnapshot,
  wrapupSessionToSnapshot,
} from './learning-state-history';
import { LearningStateReadService } from './learning-state-reads';
import { analyzeCognitiveLevel, generateSuggestion } from './learning-state-advisor';
import { buildDisplaySuggestion, type LearningStateDisplaySuggestion } from './learning-state-suggestion';

export class LearningStateService {
  private readonly committedMetricVersion = COMMITTED_METRIC_VERSION;

  /** 读侧实例：依赖经闭包注入（调用时解析 this.xxx，保住本类方法上的 spy 可见性） */
  private readonly reads = new LearningStateReadService({
    listCommittedSnapshots: (...args) => this.listCommittedSnapshots(...args),
    restoreMetrics: (input, asOf) => this.restoreMetrics(input, asOf),
    toDisplayMetrics: (metrics) => this.toDisplayMetrics(metrics),
    getPreviousMetrics: (userId, options) => this.getPreviousMetrics(userId, options),
    getLatestCommittedMetricBefore: (userId, before) => this.getLatestCommittedMetricBefore(userId, before),
    getCurrentState: (userId, options, preloadedPmcRows) => this.getCurrentState(userId, options, preloadedPmcRows),
    getTrendsSince: (userId, since) => this.getTrendsSince(userId, since),
    getStateTrends: (userId, days) => this.getStateTrends(userId, days),
  });

  /**
   * 自然衰减用的"过了几天"。
   *
   * 历史（2026-09-16）：衰减此前用本地日，与每日温故配额、当日课量、日期模拟的 UTC 日口径
   * 不一致——UTC+8 下"用规范 asOf（UTC 日末）读当天的课"会白多衰减一天。
   * 现状：日界统一走 day-boundary（应用时区本地日），四个口径一致。
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
    return displayTenScaleToInternal(value);
  }

  private displayBalanceScaleToInternal(value: number | null | undefined): InternalBalance {
    return displayBalanceScaleToInternal(value);
  }

  private buildCommittedMetricWhere(
    userId: string,
    since?: Date,
    excludedSourceKey?: string,
    asOf?: Date,
    pathId?: string | null,
    includeSynthetic = false
  ) {
    return committedMetricWhere(userId, since, excludedSourceKey, asOf, pathId, includeSynthetic);
  }

  coerceMetrics(input: any, fallbackTimestamp: Date = simulatedNowOr()): LearningStateMetrics | null {
    return coerceMetricsInternal(input, fallbackTimestamp);
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
      .map((row) => metricRecordToSnapshot(row))
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
      .map((session) => wrapupSessionToSnapshot(session))
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
      ? wrapupSessionToSnapshot(latestCompletedSession)?.calculatedAt || null
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
        synthetic: false,
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
      const snapshot = metricRecordToSnapshot(rows[0]);
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
    const snapshot = record ? metricRecordToSnapshot(record) : null;
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
    // 2026-10-24 架构优化批 2c：停写 lssHistory。该列唯一真实消费者就是这里的继承链本身
    // （每写一行都 findFirst 上一行、解 JSON、push/slice 再存回），而读侧 getLearningHistory
    // 早已改为从已提交行按 getTrendsSince 现算——继承链只贡献写放大与 O(1) 查询成本。
    // 列保留（历史行的旧值不动），新行写 null。

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
      lssHistory: null,
      metadata,
      // 2026-10-24 架构优化批 2a：标志拆列（与 metadata 内的同名键同源写入，读路径走列）
      committed: options.committed === true,
      synthetic: options.synthetic === true,
      metricVersion: options.version || null,
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

  // ============================================================
  // 读侧门面委托（实现见 learning-state-reads.ts；签名与拆分前逐一对应）
  // ============================================================

  async getCurrentState(
    userId: string,
    options: { pathId?: string | null; asOf?: Date } = {},
    preloadedPmcRows?: PmcPreloadedMetricRow[]
  ): Promise<LearningStateMetrics | null> {
    return this.reads.getCurrentState(userId, options, preloadedPmcRows);
  }

  /** 供测试与内部直连的 PMC 派生入口（checkpoint 集成见 learning-state-reads.ts） */
  private async derivePmcState(
    userId: string,
    options: { pathId?: string | null; asOf?: Date } = {},
    preloadedPmcRows?: PmcPreloadedMetricRow[]
  ): Promise<LearningStateMetrics | null> {
    return this.reads.derivePmcState(userId, options, preloadedPmcRows);
  }

  async getAggregatedState(
    userId: string,
    options: { asOf?: Date } = {}
  ) {
    return this.reads.getAggregatedState(userId, options);
  }

  async getTrendsSince(userId: string, since: Date): Promise<LearningStateMetrics[]> {
    return this.reads.getTrendsSince(userId, since);
  }

  async getSessionStateTimeline(userId: string, sessionIds: string[]) {
    return this.reads.getSessionStateTimeline(userId, sessionIds);
  }

  async getTrends(userId: string, days: number = 7): Promise<LearningStateMetrics[]> {
    return this.reads.getTrends(userId, days);
  }

  async getCurrentStateDisplay(userId: string): Promise<LearningStateDisplayMetrics | null> {
    return this.reads.getCurrentStateDisplay(userId);
  }

  async getStateTrends(userId: string, days: number = 30) {
    return this.reads.getStateTrends(userId, days);
  }

  async getStateTrendWindow(userId: string, options?: { days?: number; mode?: 'recent' | 'all' }) {
    return this.reads.getStateTrendWindow(userId, options);
  }

  async checkWarnings(userId: string) {
    return this.reads.checkWarnings(userId);
  }

  // ============================================================
  // 纯逻辑门面委托（实现见 learning-state-advisor.ts）
  // ============================================================

  analyzeCognitiveLevel(studentMessage: string, contextMessage?: string) {
    return analyzeCognitiveLevel(studentMessage, contextMessage);
  }

  generateSuggestion(metrics: LearningStateMetrics) {
    return generateSuggestion(metrics);
  }

  /**
   * 生成学习建议（显示层 4 分类：压力/状态/知识增长/时长）
   * 纯逻辑已抽到 learning-state-suggestion.ts（服务文件受 layering 棘轮约束）。
   */
  generateDisplaySuggestion(metrics: LearningStateDisplayMetrics): LearningStateDisplaySuggestion {
    return buildDisplaySuggestion(metrics);
  }
}

// 导出单例
export const learningStateService = new LearningStateService();
export default learningStateService;
