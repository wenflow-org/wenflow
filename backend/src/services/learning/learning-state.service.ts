/**
 * Learning State Service - AI 原生授课模式核心服务
 * 负责三层状态追踪：LSS/KTL/LF/LSB 计算和数据采集
 * 
 * 核心公式：
 * - LSS (Learning Stress Score): 学习压力评分
 * - KTL (Knowledge Training Load): 知识训练负荷 (EWMA, λ=0.95, 42天半衰期)
 * - LF (Learning Fatigue): 学习疲劳度 (EWMA, λ=0.70, 7天半衰期)
 * - LSB (Learning State Balance) = KTL - LF: 学习状态平衡值
 */

import prisma from '../../config/database';
import { logger } from '../../utils/logger';

// EWMA 配置
const EWMA_CONFIG = {
  KTL_LAMBDA: 0.95,  // 42天衰减 (0.95^7 ≈ 0.698)
  LF_LAMBDA: 0.70,   // 7天衰减
};

const NATURAL_DECAY = {
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
  lss: number;  // Learning Stress Score (0-10)
  ktl: number;  // Knowledge Training Load (0-10)
  lf: number;   // Learning Fatigue (0-10)
  lsb: number;  // Learning State Balance (-10 to +10)
  timestamp: Date;
}

// 显示层指标（0-100 刻度，前端展示用；原 state-tracking.service 类型，2026-08 合并入本服务）
export interface LearningStateDisplayMetrics {
  lss: number; // Learning Stress Score (0-100)
  ktl: number; // Knowledge Training Load (0-100, EWMA)
  lf: number;  // Learning Fatigue (0-100, short-term EWMA)
  lsb: number; // Learning State Balance = KTL - LF (-100 to +100)
  updatedAt?: string;
}

export interface LearningStateTrendPoint {
  date: Date;
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
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
}

export interface DisplayMetricCommitInput {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  expectedRevision: number;
  sourceKey?: string;
  timestamp?: Date;
  source?: string;
  pathId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
  primaryMetric?: 'lss' | 'lsb';
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

export class LearningStateService {
  private readonly committedMetricVersion = 'state-v2';

  private getNaturalDayDiff(from: Date, to: Date): number {
    const start = new Date(from);
    const end = new Date(to);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diff = end.getTime() - start.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  }

  private normalizeTenScale(value: number | null | undefined): number {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    if (numeric > 10) {
      return Math.min(10, Math.max(0, numeric / 10));
    }
    return Math.min(10, Math.max(0, numeric));
  }

  private normalizeBalanceScale(value: number | null | undefined): number {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    if (numeric > 10 || numeric < -10) {
      return Math.max(-10, Math.min(10, numeric / 10));
    }
    return Math.max(-10, Math.min(10, numeric));
  }

  private displayTenScaleToInternal(value: number | null | undefined): number {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(0, Math.min(100, numeric)) / 10;
  }

  private displayBalanceScaleToInternal(value: number | null | undefined): number {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(-100, Math.min(100, numeric)) / 10;
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

  private buildCommittedMetricWhere(
    userId: string,
    since?: Date,
    excludedSourceKey?: string,
    asOf?: Date
  ) {
    return {
      userId,
      metricType: 'learning_state',
      ...(excludedSourceKey ? { sourceKey: { not: excludedSourceKey } } : {}),
      AND: [
        { metadata: { contains: `"version":"${this.committedMetricVersion}"` } },
        { metadata: { contains: '"committed":true' } },
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

  coerceMetrics(input: any, fallbackTimestamp: Date = new Date()): LearningStateMetrics | null {
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

  private projectState(
    previousMetrics: LearningStateMetrics | null,
    input: {
      lss: number;
      ktlInput?: number;
      lfInput?: number;
    },
    timestamp: Date = new Date()
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
      ktl: currentKTL,
      lf: currentLF,
      lsb: currentLSB,
      timestamp,
    };
  }

  private metricRecordToSnapshot(record: {
    lss: number | null;
    ktl: number | null;
    lf: number | null;
    lsb: number | null;
    calculatedAt: Date;
  }): LearningStateCommittedSnapshot | null {
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
    };
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
    asOf?: Date
  ): Promise<LearningStateCommittedSnapshot[]> {
    const committedRows = await prisma.learning_metrics.findMany({
      where: this.buildCommittedMetricWhere(userId, since, excludedSourceKey, asOf),
      orderBy: { calculatedAt: 'asc' },
      select: {
        lss: true,
        ktl: true,
        lf: true,
        lsb: true,
        calculatedAt: true,
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

  toDisplayMetrics(metrics: LearningStateMetrics): LearningStateMetrics {
    return {
      ...metrics,
      lss: Number((metrics.lss * 10).toFixed(2)),
      ktl: Number((metrics.ktl * 10).toFixed(2)),
      lf: Number((metrics.lf * 10).toFixed(2)),
      lsb: Number((metrics.lsb * 10).toFixed(2)),
    };
  }

  restoreMetrics(input: {
    lss: number | null | undefined;
    ktl: number | null | undefined;
    lf: number | null | undefined;
    lsb: number | null | undefined;
    timestamp: Date;
  }, asOf: Date = new Date()): LearningStateMetrics {
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
      lsb: decayedLsb,
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
   * λ = 0.95 (42天半衰期)
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
   * λ = 0.70 (7天半衰期)
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

  async getLatestCommittedMetricBefore(userId: string, before: Date): Promise<LearningStateMetrics | null> {
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
  async getPreviousMetrics(userId: string): Promise<LearningStateMetrics | null> {
    const snapshots = await this.listCommittedSnapshots(userId);
    const latestSnapshot = snapshots[snapshots.length - 1] || null;

    if (!latestSnapshot) return null;

    return this.restoreMetrics(latestSnapshot.metrics);
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
    options: { sourceKey?: string; asOf?: Date } = {}
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
      options.asOf
    );
    const latestSnapshot = snapshots[snapshots.length - 1] || null;
    return {
      revision: user.learningStateRevision,
      metrics: latestSnapshot
        ? this.restoreMetrics(latestSnapshot.metrics, options.asOf || new Date())
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
      timestamp: input.timestamp || new Date(),
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
    options: { sourceKey?: string; reuseExisting?: boolean; asOf?: Date } = {}
  ): Promise<LearningStateMetrics> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (options.sourceKey && options.reuseExisting) {
        const existing = await this.getCommittedMetricBySourceKey(userId, options.sourceKey);
        if (existing) return existing;
      }
      const snapshot = await this.getCurrentStateSnapshot(userId, {
        sourceKey: options.sourceKey,
        asOf: options.asOf
      });
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
      where: { userId },
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
      date: new Date().toISOString(),
      score: Math.round(metrics.lss * 10), // 转换为 0-100
    });

    // 只保留最近 30 条
    if (lssHistory.length > 30) {
      lssHistory = lssHistory.slice(-30);
    }

    const metadata = (options.version || options.committed || options.source || options.pathId || options.taskId || options.sessionId)
      ? JSON.stringify({
          version: options.version || undefined,
          committed: options.committed === true,
          source: options.source || undefined,
          scale: 'internal-10',
          pathId: options.pathId || undefined,
          taskId: options.taskId || undefined,
          sessionId: options.sessionId || undefined,
        })
      : null;

    return {
      id: `lm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      sourceKey: options.sourceKey || null,
      userId,
      pathId: options.pathId || null,
      taskId: options.taskId || null,
      metricType: 'learning_state',
      value: options.primaryMetric === 'lsb' ? metrics.lsb : metrics.lss,
      lss: metrics.lss,
      ktl: metrics.ktl,
      lf: metrics.lf,
      lsb: metrics.lsb,
      lssCurrent: metrics.lss,
      ktlCurrent: metrics.ktl,
      lfCurrent: metrics.lf,
      lsbCurrent: metrics.lsb,
      lssHistory: JSON.stringify(lssHistory),
      metadata,
      calculatedAt: metrics.timestamp,
    };
  }

  private async commitPreparedMetric(prepared: PreparedLearningStateMetricCommit): Promise<void> {
    await prisma.$transaction(async (tx) => {
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
    });
  }

  /**
   * 获取当前状态
   */
  async getCurrentState(userId: string): Promise<LearningStateMetrics | null> {
    return this.getPreviousMetrics(userId);
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
        OR: sessions.map((session) => ({
          metadata: { contains: `"sessionId":"${session.id}"` },
        })),
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
    const since = new Date();
    since.setDate(since.getDate() - days);

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
   * 生成干预决策
   */
  generateIntervention(
    metrics: LearningStateMetrics,
    dialogueAnalysis: DialogueAnalysis,
    consecutiveErrors: number = 0
  ): InterventionDecision | null {
    const { lss, lsb, lf } = metrics;
    const { understanding, emotionalState, confusionPoints } = dialogueAnalysis;

    // 决策逻辑
    let intervention: InterventionDecision | null = null;

    // 高压力 + 负面情绪 → 简化内容
    if (lss > 7 && emotionalState === 'frustrated') {
      intervention = {
        type: 'simplification',
        priority: 9,
        content: '看起来这个内容对你有点难，让我们换一个更简单的角度来理解...',
        reasoning: '高压力且沮丧，需要降低难度',
      };
    }
    // 理解度低 → 解释
    else if (understanding < 0.4) {
      intervention = {
        type: 'explanation',
        priority: 8,
        content: '让我用另一种方式来解释这个概念...',
        reasoning: '理解度低，需要重新解释',
      };
    }
    // 困惑点 → 示例
    else if (confusionPoints.length > 0) {
      intervention = {
        type: 'example',
        priority: 7,
        content: `关于${confusionPoints[0]}，让我们看一个具体的例子...`,
        reasoning: '学生有具体困惑点',
      };
    }
    // 连续错误 → 提示
    else if (consecutiveErrors >= 2) {
      intervention = {
        type: 'hint',
        priority: 6,
        content: '这里有个小提示：注意观察...',
        reasoning: '连续错误，需要引导',
      };
    }
    // 高疲劳 → 休息建议
    else if (lf > 7) {
      intervention = {
        type: 'break',
        priority: 8,
        content: '你已经学习了很久，建议休息一下再继续...',
        reasoning: '疲劳度高，需要休息',
      };
    }
    // 状态好 + 理解度高 → 挑战
    else if (lsb > 3 && understanding > 0.8) {
      intervention = {
        type: 'challenge',
        priority: 5,
        content: '很好！让我们尝试一个更有挑战性的问题...',
        reasoning: '状态好，可以挑战',
      };
    }
    // 正面情绪 → 鼓励
    else if (emotionalState === 'positive') {
      intervention = {
        type: 'encouragement',
        priority: 3,
        content: '做得不错！继续保持...',
        reasoning: '正面反馈，巩固信心',
      };
    }

    return intervention;
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
      return {
        lss: displayMetrics.lss,
        ktl: displayMetrics.ktl,
        lf: displayMetrics.lf,
        lsb: displayMetrics.lsb,
        updatedAt: metrics.timestamp.toISOString(),
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

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const registeredAt = user?.createdAt ? new Date(user.createdAt) : new Date(today);
      registeredAt.setHours(0, 0, 0, 0);

      const requestedStartDate = new Date(today);
      requestedStartDate.setDate(today.getDate() - (requestedDays - 1));

      const startDate = mode === 'all'
        ? new Date(registeredAt)
        : new Date(Math.max(requestedStartDate.getTime(), registeredAt.getTime()));

      const actualDays = Math.max(1, Math.floor((today.getTime() - startDate.getTime()) / 86400000) + 1);
      const metrics = await this.getTrendsSince(userId, startDate);
      const currentState = await this.getCurrentState(userId);
      const latestMetricBeforeWindow = await this.getLatestCommittedMetricBefore(userId, startDate);

      const toDateKey = (date: Date): string => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      };

      const metricsByDay = new Map<string, typeof metrics>();
      for (const metric of metrics) {
        const key = toDateKey(metric.timestamp);
        const list = metricsByDay.get(key) || [];
        list.push(metric);
        metricsByDay.set(key, list);
      }

      const trends: LearningStateTrendPoint[] = [];
      let lastKnownMetric = latestMetricBeforeWindow;
      const todayKey = toDateKey(new Date());

      for (let i = 0; i < actualDays; i += 1) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        currentDate.setHours(12, 0, 0, 0);
        const key = toDateKey(currentDate);
        const dayMetrics = metricsByDay.get(key) || [];

        if (dayMetrics.length === 0) {
          if (!lastKnownMetric) {
            trends.push({ date: new Date(currentDate), lss: null, ktl: null, lf: null, lsb: null });
            continue;
          }

          const restoredMetric = key === todayKey && currentState
            ? currentState
            : this.restoreMetrics(lastKnownMetric, currentDate);
          const displayMetric = this.toDisplayMetrics(restoredMetric);
          trends.push({
            date: new Date(currentDate),
            lss: displayMetric.lss,
            ktl: displayMetric.ktl,
            lf: displayMetric.lf,
            lsb: displayMetric.lsb,
          });
          continue;
        }

        const displayDayMetrics = dayMetrics.map((m) => this.toDisplayMetrics(m));
        const validLss = displayDayMetrics
          .map((m) => m.lss)
          .filter((value): value is number => typeof value === 'number');
        const avgLss = validLss.length > 0
          ? validLss.reduce((sum, value) => sum + value, 0) / validLss.length
          : null;

        const lastMetric = displayDayMetrics[displayDayMetrics.length - 1];
        lastKnownMetric = dayMetrics[dayMetrics.length - 1];
        trends.push({
          date: new Date(currentDate),
          lss: avgLss,
          ktl: lastMetric?.ktl ?? null,
          lf: lastMetric?.lf ?? null,
          lsb: lastMetric?.lsb ?? null,
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
          endDate: new Date(today).toISOString(),
        },
      };
    } catch (error) {
      logger.error('获取学习趋势失败:', error);
      throw error;
    }
  }

  /**
   * 生成学习建议（显示层 4 分类：压力/状态/知识增长/时长）
   */
  generateDisplaySuggestion(metrics: LearningStateDisplayMetrics): {
    level: 'critical' | 'warning' | 'normal' | 'optimal';
    message: string;
    action: string;
    categories: {
      pressure: { status: string; message: string };
      state: { status: string; message: string };
      growth: { status: string; message: string };
      duration: { status: string; message: string };
    };
  } {
    const { lsb, lss, ktl, lf } = metrics;

    // 1. 压力建议（基于LSS）
    let pressureAdvice: { status: string; message: string };
    if (lss > 80) {
      pressureAdvice = {
        status: 'danger',
        message: '压力极大，建议暂停学习，休息放松'
      };
    } else if (lss > 70) {
      pressureAdvice = {
        status: 'warning',
        message: '压力较大，明天降低难度或减少学习时间'
      };
    } else if (lss >= 50) {
      pressureAdvice = {
        status: 'normal',
        message: '压力正常，继续保持'
      };
    } else if (lss >= 30) {
      pressureAdvice = {
        status: 'info',
        message: '压力较小，可适当增加挑战'
      };
    } else {
      pressureAdvice = {
        status: 'success',
        message: '强度太低，建议增加学习任务量'
      };
    }

    // 2. 状态建议（基于LSB）
    let stateAdvice: { status: string; message: string };
    let level: 'critical' | 'warning' | 'normal' | 'optimal';
    let mainMessage: string;
    let mainAction: string;

    if (lsb < 0) {
      level = 'critical';
      stateAdvice = {
        status: 'danger',
        message: '疲劳状态，建议强制休息1-2天'
      };
      mainMessage = '过度疲劳，建议强制休息';
      mainAction = '停止所有新任务，复习旧知识或休息1-2天';
    } else if (lsb < 20) {
      level = 'warning';
      stateAdvice = {
        status: 'warning',
        message: '状态一般，注意休息，可做轻松复习'
      };
      mainMessage = '疲劳较高，建议降低难度';
      mainAction = '选择简单任务，观看视频教程，避免高强度学习';
    } else if (lsb < 40) {
      level = 'normal';
      stateAdvice = {
        status: 'normal',
        message: '正常学习状态，继续当前节奏'
      };
      mainMessage = '正常学习状态';
      mainAction = '继续当前学习节奏，保持稳定';
    } else {
      level = 'optimal';
      stateAdvice = {
        status: 'success',
        message: '高效状态，可挑战高难度任务'
      };
      mainMessage = '学习状态极佳';
      mainAction = '尝试项目实践，深入研究，挑战自己';
    }

    // 3. 知识增长建议（基于KTL）
    let growthAdvice: { status: string; message: string };
    if (ktl >= 70) {
      growthAdvice = {
        status: 'success',
        message: '知识掌握优秀，继续保持'
      };
    } else if (ktl >= 50) {
      growthAdvice = {
        status: 'normal',
        message: '知识正常增长，持续学习'
      };
    } else if (ktl >= 30) {
      growthAdvice = {
        status: 'info',
        message: '知识增长缓慢，需要加强复习和实践'
      };
    } else {
      growthAdvice = {
        status: 'warning',
        message: '知识积累较少，建议增加学习投入'
      };
    }

    // 4. 时长建议（基于LF，LF高说明近期学习多）
    let durationAdvice: { status: string; message: string };
    if (lf > 70) {
      durationAdvice = {
        status: 'warning',
        message: '近期学习强度高，注意劳逸结合'
      };
    } else if (lf >= 40) {
      durationAdvice = {
        status: 'normal',
        message: '学习时长合理，注意适当休息'
      };
    } else {
      durationAdvice = {
        status: 'success',
        message: '精力充沛，可以适当增加学习时间'
      };
    }

    return {
      level,
      message: mainMessage,
      action: mainAction,
      categories: {
        pressure: pressureAdvice,
        state: stateAdvice,
        growth: growthAdvice,
        duration: durationAdvice
      }
    };
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

      // 1. 检查连续高疲劳（LF > 70 连续3天）
      const recentLF = validTrends.slice(-3);
      if (recentLF.length >= 3 && recentLF.every(t => t.lf > 70)) {
        warnings.push({
          type: 'fatigue',
          level: 'critical',
          title: '⚠️ 学习疲劳预警',
          message: `你的疲劳度（LF）已连续 ${recentLF.length} 天超过 70。这表明你可能过度学习。`,
          suggestion: '建议暂停学习1-2天，做一些轻松的事情恢复精力，后续降低学习强度。'
        });
      }

      // 2. 检查LSB持续为负
      const recentLSB = validTrends.slice(-3);
      if (recentLSB.length >= 2 && recentLSB.every(t => t.lsb < 0)) {
        warnings.push({
          type: 'lsb_negative',
          level: 'warning',
          title: '📉 学习状态预警',
          message: `你的学习状态值（LSB）已连续 ${recentLSB.length} 次为负，说明疲劳已超过知识积累能力。`,
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
            title: '📊 学习效率预警',
            message: `你最近的学习压力评分明显上升（从 ${avgLSSBefore.toFixed(1)} 到 ${avgLSSRecent.toFixed(1)}）。`,
            suggestion: '可能是任务难度过高或疲劳累积，建议回顾学习方法或适当休息。'
          });
        }
      }

      // 4. 检查过度学习（KTL很高但LSB很低）
      const current = validTrends[validTrends.length - 1];
      if (current && current.ktl > 60 && current.lsb < 10) {
        warnings.push({
          type: 'overstudy',
          level: 'info',
          title: '💡 学习平衡提醒',
          message: `你已掌握较多知识（KTL = ${current.ktl.toFixed(1)}），但当前状态不佳（LSB = ${current.lsb.toFixed(1)}）。`,
          suggestion: '知识积累很好，但疲劳度较高。建议今天做轻松的复习，不要学习新内容。'
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
