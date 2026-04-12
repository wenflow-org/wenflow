// 学习状态追踪系统
// LSS/KTL/LF/LSB 计算和追踪

import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export interface LearningStateMetrics {
  lss: number; // Learning Stress Score (0-100)
  ktl: number; // Knowledge Training Load (0-100, EWMA)
  lf: number;  // Learning Fatigue (0-100, short-term EWMA)
  lsb: number; // Learning State Balance = KTL - LF (-100 to +100)
}

export interface LSSInputs {
  difficulty: number;  // 任务难度 (1-10)
  cognitiveLoad: number; // 认知负荷 (1-10)
  effectiveness: number; // 学习效率 (1-10)
}

export const EWMA_CONFIG = {
  KTL_LAMBDA: 0.95,  // 42天衰减 (0.95^7 ≈ 0.698)
  LF_LAMBDA: 0.70,   // 7天衰减
};

class LearningStateService {
  private hasUsableMetrics(metrics: {
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
   * 计算LSS (Learning Stress Score)
   * LSS = (难度×0.3 + 认知负荷×0.3 + 效率×0.4)
   * 效率的权重更高，因为它是结果导向的指标
   * 用户感觉效率高时，即使任务难，压力也不会太高
   */
  calculateLSS(inputs: LSSInputs): number {
    const baseScore =
      inputs.difficulty * 0.3 +
      inputs.cognitiveLoad * 0.3 +
      inputs.effectiveness * 0.4;

    const lss = baseScore * 10;
    return Math.min(100, Math.max(0, lss)); // 限制在0-100范围内
  }

  /**
   * 获取用户上一个学习状态指标
   * 用于EWMA计算
   */
  async getPreviousMetrics(userId: string): Promise<LearningStateMetrics | null> {
    try {
      const metrics = await prisma.learning_metrics.findFirst({
        where: { userId },
        orderBy: { calculatedAt: 'desc' }
      });

      if (!metrics) {
        return null;
      }

      return {
        lss: metrics.lss ?? 0,
        ktl: metrics.ktl ?? 0,
        lf: metrics.lf ?? 0,
        lsb: metrics.lsb ?? 0,
      };
    } catch (error) {
      logger.error('获取上一个学习指标失败:', error);
      return null;
    }
  }

  /**
   * 计算并更新KTL (Knowledge Training Load)
   * 使用指数加权移动平均 (EWMA)
   * KTL_t = λ × KTL_{t-1} + (1-λ) × LSS_t
   */
  calculateKTL(previousKTL: number, currentLSS: number): number {
    return (
      EWMA_CONFIG.KTL_LAMBDA * previousKTL +
      (1 - EWMA_CONFIG.KTL_LAMBDA) * currentLSS
    );
  }

  /**
   * 计算并更新LF (Learning Fatigue)
   * 使用短期指数加权移动平均
   * LF_t = λ_short × LF_{t-1} + (1-λ_short) × LSS_t
   */
  calculateLF(previousLF: number, currentLSS: number): number {
    return (
      EWMA_CONFIG.LF_LAMBDA * previousLF +
      (1 - EWMA_CONFIG.LF_LAMBDA) * currentLSS
    );
  }

  /**
   * 计算学习会话的完整状态指标
   */
  async calculateSessionMetrics(
    userId: string,
    inputs: LSSInputs
  ): Promise<LearningStateMetrics> {
    try {
      // 1. 计算当前LSS
      const currentLSS = this.calculateLSS(inputs);

      // 2. 获取历史指标
      const previousMetrics = await this.getPreviousMetrics(userId);

      // 3. 计算KTL和LF (如果是第一次，直接使用LSS)
      const previousKTL = previousMetrics?.ktl ?? currentLSS;
      const previousLF = previousMetrics?.lf ?? currentLSS;

      const currentKTL = this.calculateKTL(previousKTL, currentLSS);
      const currentLF = this.calculateLF(previousLF, currentLSS);

      // 4. 计算LSB
      const currentLSB = currentKTL - currentLF;

      const metrics: LearningStateMetrics = {
        lss: currentLSS,
        ktl: currentKTL,
        lf: currentLF,
        lsb: currentLSB,
      };

      // 5. 保存到数据库
      await this.saveMetrics(userId, metrics);

      logger.info('学习状态指标计算完成:', {
        userId,
        lss: currentLSS,
        ktl: currentKTL,
        lf: currentLF,
        lsb: currentLSB,
      });

      return metrics;
    } catch (error) {
      logger.error('计算学习状态指标失败:', error);
      throw error;
    }
  }

  /**
   * 保存学习指标到数据库
   */
  private async saveMetrics(
    userId: string,
    metrics: LearningStateMetrics
  ): Promise<void> {
    try {
await prisma.learning_metrics.create({
        data: {
          id: `lm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId,
          metricType: 'session',
          value: metrics.lss,
          lss: metrics.lss,
          ktl: metrics.ktl,
          lf: metrics.lf,
          lsb: metrics.lsb,
          recordedAt: new Date(),
          calculatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('保存学习指标失败:', error);
      throw error;
    }
  }

  /**
   * 获取当前学习状态
   */
  async getCurrentState(userId: string): Promise<LearningStateMetrics | null> {
    try {
      const metrics = await prisma.learning_metrics.findFirst({
        where: { userId },
        orderBy: { calculatedAt: 'desc' }
      });

      if (!metrics) {
        return null;
      }

      if (!this.hasUsableMetrics(metrics)) {
        return null;
      }

      return {
        lss: metrics.lss ?? 0,
        ktl: metrics.ktl ?? 0,
        lf: metrics.lf ?? 0,
        lsb: metrics.lsb ?? 0,
      };
    } catch (error) {
      logger.error('获取当前学习状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取学习状态趋势
   * 返回最近N天的数据
   */
  async getStateTrends(
    userId: string,
    days: number = 30
  ): Promise<
    Array<{
      date: Date;
      lss: number | null;
      ktl: number | null;
      lf: number | null;
      lsb: number | null;
    }>
  > {
    try {
      const safeDays = Math.max(1, Math.min(365, days));
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - (safeDays - 1));

      const metrics = await prisma.learning_metrics.findMany({
        where: {
          userId,
          calculatedAt: {
            gte: startDate,
          },
        },
        orderBy: { calculatedAt: 'asc' },
      });

      const toDateKey = (date: Date): string => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      };

      const metricsByDay = new Map<string, typeof metrics>();
      for (const metric of metrics) {
        const key = toDateKey(metric.calculatedAt);
        const list = metricsByDay.get(key) || [];
        list.push(metric);
        metricsByDay.set(key, list);
      }

      const trends: Array<{ date: Date; lss: number | null; ktl: number | null; lf: number | null; lsb: number | null }> = [];

      for (let i = 0; i < safeDays; i += 1) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        const key = toDateKey(currentDate);
        const dayMetrics = metricsByDay.get(key) || [];

        if (dayMetrics.length === 0) {
          trends.push({ date: new Date(currentDate), lss: null, ktl: null, lf: null, lsb: null });
          continue;
        }

        const validLss = dayMetrics
          .map((m) => m.lss)
          .filter((value): value is number => typeof value === 'number');
        const avgLss = validLss.length > 0
          ? validLss.reduce((sum, value) => sum + value, 0) / validLss.length
          : null;

        const lastMetric = dayMetrics[dayMetrics.length - 1];
        trends.push({
          date: new Date(currentDate),
          lss: avgLss,
          ktl: lastMetric.ktl ?? null,
          lf: lastMetric.lf ?? null,
          lsb: lastMetric.lsb ?? null,
        });
      }

      return trends;
    } catch (error) {
      logger.error('获取学习趋势失败:', error);
      throw error;
    }
  }

  /**
   * 生成学习建议
   * 基于当前指标生成4类建议：压力建议、状态建议、知识增长建议、时长建议
   */
  generateSuggestion(metrics: LearningStateMetrics): {
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
    // 简化版本：根据KTL值判断
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
   * 检查学习预警
   * 返回预警信息列表
   */
  async checkWarnings(userId: string): Promise<Array<{
    type: 'fatigue' | 'lsb_negative' | 'efficiency_drop' | 'overstudy';
    level: 'critical' | 'warning' | 'info';
    title: string;
    message: string;
    suggestion: string;
  }>> {
    const warnings: Array<{
      type: 'fatigue' | 'lsb_negative' | 'efficiency_drop' | 'overstudy';
      level: 'critical' | 'warning' | 'info';
      title: string;
      message: string;
      suggestion: string;
    }> = [];

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

export default new LearningStateService();
