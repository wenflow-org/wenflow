/**
 * Learning Metric Service
 *
 * 核心状态追踪系统：LSS/KTL/LF/LSB
 *
 * 理论基础：
 * - LSS (Learning Stress Score): 学习压力评分，基于难度、认知负荷、有效性
 * - KTL (Knowledge Training Load): 知识训练负荷，使用EWMA算法计算
 * - LF (Learning Fatigue): 学习疲劳度，7天衰减
 * - LSB (Learning State Balance) = KTL - LF: 学习状态平衡值
 */

import prisma from '../../config/database';
import learningStateService from '../learning/learning-state.service';
import { logger } from '../../utils/logger';
import type { DurableDomainEvent } from '../../events/contracts';

export interface LearningStateMetrics {
  lss: number;           // 学习压力评分 (0-100)
  ktl: number;           // 知识训练负荷 (0-100)
  lf: number;            // 学习疲劳度 (0-100)
  lsb: number;           // 学习状态平衡值 (-100 to 100)
}

export interface SessionMetricsInput {
  userId: string;
  taskId?: string;
  durationMinutes: number;
  lssScore?: number;            // 可选：主观LSS评分
  subjectiveDifficulty?: number; // 1-10 主观难度
  completed: boolean;           // 是否完成任务
  notes?: string;
  timestamp?: Date;
}

/**
 * 计算学习压力评分 (LSS - Learning Stress Score)
 *
 * LSS 综合考虑：
 * 1. 任务完成率（完成任务压力大，未完成任务压力更大）
 * 2. 主观难度（1-10）
 * 3. 学习时长（过长可能压力大）
 * 4. 认知负荷推断（基于任务类型和难度）
 */
export function calculateLSS(
  completed: boolean,
  subjectiveDifficulty?: number,
  durationMinutes?: number,
  taskType?: string
): number {
  let lss = 0;

  // 1. 基础压力
  const baseDifficulty = subjectiveDifficulty || 5; // 默认中等难度
  lss += baseDifficulty * 10; // 1-10 映射到 10-100

  // 2. 完成状态影响
  if (completed) {
    lss *= 0.8; // 完成任务减轻压力
  } else {
    lss *= 1.2; // 未完成任务增加压力
  }

  // 3. 学习时长影响（超过2小时增加压力）
  if (durationMinutes && durationMinutes > 120) {
    const excess = durationMinutes - 120;
    lss += excess * 0.3; // 每超过1分钟增加0.3压力
  }

  // 4. 任务类型影响
  if (taskType === 'project' || taskType === 'quiz') {
    lss *= 1.1; // 项目/测验增加10%压力
  } else if (taskType === 'reading') {
    lss *= 0.9; // 阅读减少10%压力
  }

  // 限制在0-100范围内
  return Math.max(0, Math.min(100, Math.round(lss)));
}

/**
 * EWMA (Exponentially Weighted Moving Average) 算法
 *
 * 计算指数加权移动平均，用于平滑KTL的变化
 *
 * KTL_new = α * KTL_current + (1 - α) * KTL_previous
 *
 * α (alpha): 平滑因子 (0-1)
 * - 较小的α: 更平滑，反应慢
 * - 较大的α: 反应快，但波动大
 */
export function calculateEWMA(
  current: number,
  previous: number,
  alpha: number = 0.3
): number {
  return alpha * current + (1 - alpha) * previous;
}

/**
 * 计算知识训练负荷 (KTL - Knowledge Training Load)
 *
 * KTL 基于学习历史的综合评估：
 * - 完成的任务数量
 * - 任务难度和类型
 * - 学习时长
 * - 使用EWMA平滑短期波动
 */
export async function calculateKTL(
  userId: string,
  lssScore: number,
  previousKTL: number = 0,
  asOf: Date = new Date()
): Promise<number> {
  const sevenDaysAgo = new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000);

  const sessions = await prisma.teaching_sessions.findMany({
    where: {
      userId,
      status: 'completed',
      wrapup: { not: null },
      startTime: { gte: sevenDaysAgo, lte: asOf },
      endTime: { lte: asOf },
    },
    orderBy: { startTime: 'desc' },
  });

  if (sessions.length === 0) {
    // 没有历史记录，基于当前LSS初始化KTL
    return lssScore * 0.5;
  }

  // 计算总学习时长和平均难度
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const avgDifficulty = 5;

  // KTL考虑因素：
  // 1. 学习量因子：总学习时长 / 7天
  const learningVolume = Math.min(totalMinutes / (7 * 60), 4); // 最多4小时/天 -> 4

  // 2. 难度因子：平均难度 / 2
  const difficultyFactor = avgDifficulty / 2;

  // 3. 当前LSS影响
  const lssFactor = lssScore / 100;

  // 4. 任务完成率
  const completedSessions = sessions.filter((s) => s.taskId).length;
  const completionRate = sessions.length > 0 ? completedSessions / sessions.length : 0;

  // 计算基础KTL
  const ktlCurrent = (learningVolume + difficultyFactor) * (1 + lssFactor) * (0.5 + 0.5 * completionRate) * 20;

  // 使用EWMA平滑
  let ktlFinal = calculateEWMA(ktlCurrent, previousKTL, 0.4);

  // 限制在0-100
  ktlFinal = Math.max(0, Math.min(100, Math.round(ktlFinal)));

  return ktlFinal;
}

/**
 * 计算学习疲劳度 (LF - Learning Fatigue)
 *
 * LF 基于学习历史的衰减因子：
 * - 学习时长累积
 * - 连续学习天数
 * - 7天衰减模型（每过一天衰减一部分）
 */
export async function calculateLF(userId: string, asOf: Date = new Date()): Promise<number> {
  // 获取过去7天的学习数据
  const sevenDaysAgo = new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000);

  const sessions = await prisma.teaching_sessions.findMany({
    where: {
      userId,
      status: 'completed',
      wrapup: { not: null },
      startTime: { gte: sevenDaysAgo, lte: asOf },
      endTime: { lte: asOf },
    },
    orderBy: { startTime: 'desc' },
  });

  if (sessions.length === 0) {
    return 0;
  }

  // 按天聚合学习时长
  const dailyLearning = new Map<string, number>();

  sessions.forEach((session) => {
    const date = session.startTime.toISOString().split('T')[0];
    const duration = session.duration || 0;
    dailyLearning.set(date, (dailyLearning.get(date) || 0) + duration);
  });

  // 计算疲劳度
  let lfCurrent = 0;

  // 遍历过去7天
  for (let i = 0; i < 7; i++) {
    const date = new Date(asOf.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const minutes = dailyLearning.get(dateStr) || 0;

    // 衰减因子：越近的数据影响越大
    // 第0天（今天）权重1，第6天权重0.5
    const decayFactor = 1 - (i / 7) * 0.5;

    // 学习疲劳因子：单日学习超过2小时累积疲劳
    const dailyFatigue = Math.max(0, minutes - 120) / 60; // 超过2小时的每1小时增加1点疲劳

    lfCurrent += dailyFatigue * decayFactor;
  }

  // 转换为0-100范围
  lfCurrent = Math.min(100, Math.round(lfCurrent * 10));

  return lfCurrent;
}

/**
 * 计算学习状态平衡值 (LSB - Learning State Balance)
 *
 * LSB = KTL - LF
 *
 * 正值表示学习状态良好，负值表示状态不佳
 */
export function calculateLSB(ktl: number, lf: number): number {
  const lsb = ktl - lf;
  return Math.max(-100, Math.min(100, Math.round(lsb)));
}

/**
 * 更新学习指标
 *
 * 核心函数：在每次学习会话结束时调用
 */
export async function updateLearningMetrics(
  input: SessionMetricsInput
): Promise<LearningStateMetrics> {
  try {
    const lssScore = input.lssScore ??
      calculateLSS(
        input.completed,
        input.subjectiveDifficulty,
        input.durationMinutes
      );
    const sourceKey = input.taskId ? `task-completion:${input.taskId}` : undefined;
    const asOf = input.timestamp || new Date();
    const committedMetrics = await learningStateService.commitDerivedDisplayMetrics(input.userId, async previousMetrics => {
      const previousDisplayMetrics = previousMetrics
        ? learningStateService.toDisplayMetrics(previousMetrics)
        : null;
      const ktlCurrent = await calculateKTL(input.userId, lssScore, previousDisplayMetrics?.ktl || 0, asOf);
      const lfCurrent = await calculateLF(input.userId, asOf);
      return {
        lss: lssScore,
        ktl: ktlCurrent,
        lf: lfCurrent,
        lsb: calculateLSB(ktlCurrent, lfCurrent),
        timestamp: asOf,
        source: 'task-completion',
        taskId: input.taskId || null,
        primaryMetric: 'lsb',
      };
    }, {
      sourceKey,
      reuseExisting: !!sourceKey,
      ...(input.timestamp ? { asOf: input.timestamp } : {})
    });
    const displayMetrics = learningStateService.toDisplayMetrics(committedMetrics);

    logger.debug(`✅ Updated learning metrics for user ${input.userId}:`, {
      LSS: displayMetrics.lss,
      KTL: displayMetrics.ktl,
      LF: displayMetrics.lf,
      LSB: displayMetrics.lsb,
    });

    return displayMetrics;
  } catch (error) {
    logger.error('Error updating learning metrics:', error);
    throw error;
  }
}

export async function reconcileTaskCompletionMetric(
  event: DurableDomainEvent
): Promise<void> {
  if (event.type !== 'task:completed' || !event.userId) return;
  const data = event.data || {};
  const taskId = typeof data.taskId === 'string' ? data.taskId : event.aggregateId;
  if (!taskId) throw new Error('任务完成事件缺少 taskId');

  await updateLearningMetrics({
    userId: event.userId,
    taskId,
    durationMinutes: typeof data.actualMinutes === 'number' ? data.actualMinutes : 30,
    subjectiveDifficulty: typeof data.subjectiveDifficulty === 'number'
      ? data.subjectiveDifficulty
      : undefined,
    completed: true,
    timestamp: event.occurredAt
  });
}

/**
 * 获取用户学习指标
 */
export async function getLearningMetrics(userId: string): Promise<LearningStateMetrics | null> {
  try {
    const metrics = await learningStateService.getCurrentState(userId);

    if (!metrics) {
      return null;
    }

    const displayMetrics = learningStateService.toDisplayMetrics(metrics);

    return {
      lss: displayMetrics.lss,
      ktl: displayMetrics.ktl,
      lf: displayMetrics.lf,
      lsb: displayMetrics.lsb,
    };
  } catch (error) {
    console.error('Error getting learning metrics:', error);
    return null;
  }
}

/**
 * 获取学习历史数据（用于图表）
 */
export async function getLearningHistory(userId: string) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 99);

    const metrics = await learningStateService.getTrendsSince(userId, since);
    if (metrics.length === 0) {
      return { lssHistory: [], sessionHistory: [] };
    }

    return {
      lssHistory: metrics.map((metric) => ({
        date: metric.timestamp.toISOString(),
        score: Math.round(learningStateService.toDisplayMetrics(metric).lss),
      })),
      sessionHistory: [],
    };
  } catch (error) {
    console.error('Error getting learning history:', error);
    return { lssHistory: [], sessionHistory: [] };
  }
}

/**
 * 生成学习状态建议
 */
export function generateLearningStateAdvice(metrics: LearningStateMetrics): string[] {
  const advice: string[] = [];

  // LSB建议
  if (metrics.lsb < -30) {
    advice.push('⚠️ 学习状态不佳。建议休息1-2天，恢复精力和注意力。');
  } else if (metrics.lsb < 0) {
    advice.push('📉 学习状态偏低。建议减少学习强度，或增加休息时间。');
  } else if (metrics.lsb > 50) {
    advice.push('🚀 学习状态极佳！正是攻克难点的好时机。');
  } else {
    advice.push('✅ 学习状态良好。继续保持当前节奏。');
  }

  // LSS建议
  if (metrics.lss > 75) {
    advice.push('💔 学习压力过大。建议拆分任务，或寻求AI辅导。');
  } else if (metrics.lss > 50) {
    advice.push('⚡ 学习压力适中。注意劳逸结合。');
  }

  // LF建议
  if (metrics.lf > 60) {
    advice.push('😴 疲劳度较高。确保充足睡眠，适当运动。');
  }

  return advice;
}
