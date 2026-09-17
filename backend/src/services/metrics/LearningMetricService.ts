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
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import learningStateService, {
  toInternalTenScale,
  internalTenToDisplay,
  asDisplayHundred,
  asDisplayBalance,
} from '../learning/learning-state.service';
import { predictionCalibrationService } from '../learner/PredictionCalibrationService';
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
  /**
   * 所属路径（可选维度）。**必须带上**：学习者可能同时学多条路径/多门课，
   * 不带路径身份的状态会退化成"无维度全局标量"，导致路径 A 的困难改写路径 B 的自适应
   * （事件 `task:completed` 里本来就有 pathId，见 learning.service 的 completTask 事件体）。
   */
  pathId?: string | null;
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
 * **定位（2026-09-17 显式化，审计 §4.3）**：这是**任务完成口径的显示层近似**（0-100），
 * 输入只有"完成与否 / 主观难度 / 时长 / 任务类型"（`task:completed` 事件能拿到的那些）。
 * 它**不是**系统状态里的 LSS 真源：真源是 `learning-state.service.calculateLSS(inputs)`（0-10，
 * 带认知负荷/效率/时间比/完成率/类型五因子），会话结算走那条路。
 * 二者经由 `toInternalTenScale`（>10 即 /10）在同一刻度上汇合，因此这里必须保持 0-100 口径。
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
 * KTL/LF 的 EWMA 系数（与 learning-state.service 的 λ 法则**同一条**，且必须归一化：α + (1−α) = 1）。
 *
 * 历史缺陷（2026-09-17 修，审计 §4.3）：LF 曾是 `prev*0.70 + current*0.15`（**系数和 0.85**）。
 * 后果不是"衰减更快"，而是**稳态被系统性压到一半**：对恒定输入 c，稳态 = 0.15c/(1−0.70) = 0.5c。
 * 于是消费侧疲劳阈值（`lf ≥ 6` 判疲劳）实际要求真实疲劳达到 ~12（量程外）——疲劳保护近乎失效。
 * 归一化后两侧同源：λ = 前值权重，半衰期 = ln(0.5)/ln(λ)（KTL ≈ 13.5 天、LF ≈ 1.9 天）
 * —— 这正是消费侧阈值（lf≥6 判疲劳）所假设的刻度与速度。
 */
const KTL_EWMA_LAMBDA = 0.95;
const LF_EWMA_LAMBDA = 0.70;

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
    const asOf = input.timestamp || simulatedNowOr();
    const committedMetrics = await learningStateService.commitDerivedDisplayMetrics(input.userId, async previousMetrics => {
      // 量纲修复（2026-09-16）：这个回调的输出契约是 **display 刻度**（commitDisplayMetrics 会
      // 用 displayTenScaleToInternal 除以 10 落库）。此前这里同时混了两套刻度：
      //   ① `lss10 = lssScore / 10`（0-100 私有公式时代的遗留除法，而 calculateLSS 已 clamp 0-10）
      //   ② `prev = toDisplayMetrics(previousMetrics)`（0-100）却与 0-1 的 lss10 一起做 EWMA
      // 结果线上出现 lss=0.4 / ktl≈1 / lf≈1 / lsb≈0 的"毫无压力"状态，而消费侧阈值按 0-10 写
      // （lf≥6 判疲劳、ktl≥6 判可加速），导致 20 人中 17 人的难度/节奏自适应静默失效
      // （审计：src/scripts/audit-learning-metrics-scale.ts）。
      // 现在：入参用 toInternalTenScale 收敛到 0-10（兼容 0-10 / 0-100 两种 caller 口径），
      // 再 ×10 进入 display 契约；EWMA 全程在 display 刻度上做。
      const lss10 = toInternalTenScale(lssScore);
      // 刻度转换只能走这两个命名函数（品牌类型保证：普通 number 塞不进 display 契约）
      const lssDisplay = internalTenToDisplay(lss10);
      const prev = previousMetrics ? learningStateService.toDisplayMetrics(previousMetrics) : null;
      const ktl = asDisplayHundred(prev?.ktl != null ? prev.ktl * KTL_EWMA_LAMBDA + lssDisplay * (1 - KTL_EWMA_LAMBDA) : lssDisplay * 0.5);
      const lf = asDisplayHundred(prev?.lf != null ? prev.lf * LF_EWMA_LAMBDA + lssDisplay * (1 - LF_EWMA_LAMBDA) : lssDisplay * 0.3);
      return {
        lss: lssDisplay,
        ktl,
        lf,
        lsb: asDisplayBalance(ktl - lf),
        timestamp: asOf,
        source: 'task-completion',
        taskId: input.taskId || null,
        // 路径身份透传（落库列 + metadata）：否则多路径学习者的状态无法按路径读取
        pathId: input.pathId ?? null,
        primaryMetric: 'lsb',
      };
    }, {
      sourceKey,
      reuseExisting: !!sourceKey,
      ...(input.timestamp ? { asOf: input.timestamp } : {}),
      // 前值也按路径取（有值才传）：路径内延续自己的 EWMA，路径之间不互相污染；
      // 该路径尚无历史时由服务层回退到全局最新状态（冷启动继承）。
      ...(typeof input.pathId === 'string' && input.pathId.length > 0 ? { pathId: input.pathId } : {})
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
    // 事件体自带 pathId（learning.service 的 task:completed）；缺失保持 null，不阻断
    pathId: typeof data.pathId === 'string' ? data.pathId : null,
    durationMinutes: typeof data.actualMinutes === 'number' ? data.actualMinutes : 30,
    subjectiveDifficulty: typeof data.subjectiveDifficulty === 'number'
      ? data.subjectiveDifficulty
      : undefined,
    completed: true,
    timestamp: event.occurredAt
  });

  // 校准闭环回写（fire-and-forget）：任务完成后对照预测器的历史预测，统计实证命中率
  void predictionCalibrationService.resolveFromTaskCompletion(event.userId, taskId)
    .catch((error) => {
      logger.debug('[LearningMetrics] 预测校准回写失败（不影响主流程）', {
        userId: event.userId, taskId,
        error: error instanceof Error ? error.message : String(error),
      });
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
