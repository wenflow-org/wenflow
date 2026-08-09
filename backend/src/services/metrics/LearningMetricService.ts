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
      // KTL/LF 收敛（2026-08）：统一走 learning-state 的 0-10 EWMA 语义（主状态机），
      // 不再使用本文件第三套 0-100 私有公式（此前 0-100 值写入 internal-10 字段属语义不一致）
      const lss10 = Math.max(0, Math.min(10, lssScore / 10));
      const prev = previousMetrics ? learningStateService.toDisplayMetrics(previousMetrics) : null;
      const ktl = prev?.ktl != null
        ? Math.max(0, Math.min(10, prev.ktl * 0.95 + lss10 * 0.05))
        : Math.max(0, Math.min(10, lss10 * 0.5));
      const lf = prev?.lf != null
        ? Math.max(0, Math.min(10, prev.lf * 0.7 + lss10 * 0.15))
        : Math.max(0, Math.min(10, lss10 * 0.3));
      return {
        lss: lss10,
        ktl,
        lf,
        lsb: Math.max(-10, Math.min(10, ktl - lf)),
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
