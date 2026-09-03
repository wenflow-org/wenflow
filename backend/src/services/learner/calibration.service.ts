/**
 * 元认知校准服务（Learn 层 P1：自我评估准确度动态校准）
 *
 * 当前 selfAssessmentAccuracy 仅由 goal 对话 LLM 理解静态赋值（默认 'accurate'），
 * 且唯一消费方是虚拟学习者模拟器。本服务从 memory_traces 的实际复习结果中计算
 * 数据驱动的校准偏误，供 ProfileAggregator 覆盖该字段。
 *
 * 校准逻辑（无 LLM，确定性）：
 * - 从 memory_traces 读取有 FSRS 状态的最近 N 条痕迹
 * - 比较 masteryScore（系统评估的掌握度）与 FSRS stability/difficulty（复习实际表现）
 * - 高 mastery 低 stability → 高估（overconfident）
 * - 低 mastery 高 stability → 低估（underconfident）
 * - 样本不足（< 5 条）→ 保持默认 'accurate'
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export type CalibrationBias = 'overconfident' | 'accurate' | 'underconfident';

export async function computeCalibrationBias(userId: string): Promise<CalibrationBias> {
  try {
    // 取最近 30 条有 FSRS 状态的痕迹
    const traces = await prisma.memory_traces.findMany({
      where: {
        userId,
        fsrsStability: { not: null },
        extractionCount: { gte: 2 }, // 至少经过 2 次提取，FSRS state 稳定
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 30,
      select: {
        masteryScore: true,
        fsrsStability: true,
        fsrsDifficulty: true,
      },
    });

    if (traces.length < 5) return 'accurate'; // 样本不足

    let overconfidentCount = 0;
    let underconfidentCount = 0;

    for (const trace of traces) {
      const mastery = trace.masteryScore;
      const stability = trace.fsrsStability!;
      const difficulty = trace.fsrsDifficulty ?? 5;

      // 高估信号：系统评高（mastery ≥ 0.7）但实际稳定性低（stability < 3 天）或难度高（difficulty ≥ 7）
      if (mastery >= 0.7 && (stability < 3 || difficulty >= 7)) {
        overconfidentCount++;
      }
      // 低估信号：系统评低（mastery ≤ 0.4）但实际稳定性高（stability ≥ 5 天）或难度低（difficulty ≤ 4）
      if (mastery <= 0.4 && (stability >= 5 || difficulty <= 4)) {
        underconfidentCount++;
      }
    }

    // 隐藏 JOL 辅助信号：查询最近 10 次完结会话的自评信号
    let jolOverconfidentCount = 0;
    let jolUnderconfidentCount = 0;
    try {
      const recentSessions = await prisma.teaching_sessions.findMany({
        where: { userId, status: 'completed', teachingState: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { teachingState: true },
      });
      for (const session of recentSessions) {
        const state = typeof session.teachingState === 'string'
          ? JSON.parse(session.teachingState)
          : session.teachingState;
        const signal = (state as any)?.learnerStateContext?.selfAssessmentSignal;
        if (signal === 'high') jolOverconfidentCount++;
        else if (signal === 'low') jolUnderconfidentCount++;
      }
    } catch {
      // 查询失败不影响 FSRS 主信号
    }

    const total = traces.length;
    const overRatio = (overconfidentCount + jolOverconfidentCount * 0.5) / (total + jolOverconfidentCount * 0.5 + jolUnderconfidentCount * 0.5);
    const underRatio = (underconfidentCount + jolUnderconfidentCount * 0.5) / (total + jolOverconfidentCount * 0.5 + jolUnderconfidentCount * 0.5);

    if (overRatio >= 0.3 && overRatio > underRatio) return 'overconfident';
    if (underRatio >= 0.3 && underRatio > overRatio) return 'underconfident';
    return 'accurate';
  } catch (error) {
    logger.warn('[calibration] 校准偏误计算失败，回退默认', { userId, error: error instanceof Error ? error.message : String(error) });
    return 'accurate';
  }
}