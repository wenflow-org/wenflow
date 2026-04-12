// 学习报告服务
// Learning Report Service - Generate weekly/monthly reports

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import stateTrackingService from '../learning/state-tracking.service';

interface ReportData {
  user: {
    name: string;
    email: string;
    level: string;
    xp: number;
  };
  period: {
    startDate: Date;
    endDate: Date;
    type: 'weekly' | 'monthly';
  };
  learning: {
    totalSessions: number;
    totalTimeMinutes: number;
    completedTasks: number;
    completedPaths: number;
  };
  metrics: {
    avgLSS: number;
    avgKTL: number;
    avgLF: number;
    avgLSB: number;
    ktlGrowth: number;
  };
  achievements: {
    unlocked: number;
    newUnlocked: number;
    topAchievements: Array<{
      title: string;
      earnedAt: Date;
    }>;
  };
  trends: {
    dailyStats: Array<{
      date: Date;
      sessions: number;
      timeMinutes: number;
      lss: number;
      ktl: number;
    }>;
  };
  recommendations: string[];
}

class ReportService {
  /**
   * 生成学习报告 (周报/月报)
   */
  async generateReport(
    userId: string,
    type: 'weekly' | 'monthly',
    date?: string
  ): Promise<ReportData> {
    try {
      // 计算报告时间范围
      const { startDate, endDate } = this.calculatePeriod(type, date);

      // 获取用户信息
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          currentLevel: true,
          xp: true
        }
      });

      // 转换 currentLevel 为 level 供报告使用
      const reportUser = user ? {
        name: user.name,
        email: user.email,
        level: user.currentLevel as string,
        xp: user.xp
      } : null;

      if (!user) {
        throw new Error('用户不存在');
      }

      // 获取学习统计
      const learning = await this.getLearningStats(userId, startDate, endDate);

      // 获取学习指标
      const metrics = await this.getMetrics(userId, startDate, endDate);

      // 获取成就统计
      const achievements = await this.getAchievementStats(userId, startDate, endDate);

      // 获取趋势数据
      const trends = await this.getTrends(userId, startDate, endDate);

      // 生成建议
      const recommendations = this.generateRecommendations(metrics, learning);

      return {
        user: reportUser,
        period: { startDate, endDate, type },
        learning,
        metrics,
        achievements,
        trends,
        recommendations
      };
    } catch (error) {
      logger.error('生成学习报告失败:', error);
      throw error;
    }
  }

  /**
   * 获取报告列表 (历史报告)
   */
  async getReportHistory(userId: string): Promise<
    Array<{
      date: Date;
      type: 'weekly' | 'monthly';
      completedTasks: number;
      totalTimeHours: number;
      ktlGrowth: number;
    }>
  > {
    try {
      const periods = this.getAvailablePeriods();

      const reports = [];

      for (const period of periods) {
        const { startDate, endDate, type } = period;

        const learning = await this.getLearningStats(userId, startDate, endDate);

        // 只包含有学习记录的周期
        if (learning.completedTasks > 0 || learning.totalTimeMinutes > 0) {
          const metrics = await this.getMetrics(userId, startDate, endDate);

          reports.push({
            date: startDate,
            type,
            completedTasks: learning.completedTasks,
            totalTimeHours: Number((learning.totalTimeMinutes / 60).toFixed(1)),
            ktlGrowth: metrics.ktlGrowth
          });
        }
      }

      return reports;
    } catch (error) {
      logger.error('获取报告历史失败:', error);
      throw error;
    }
  }

  /**
   * 计算时间范围
   */
  private calculatePeriod(type: 'weekly' | 'monthly', date?: string) {
    const baseDate = date ? new Date(date) : new Date();

    let startDate: Date;
    let endDate: Date;

    if (type === 'weekly') {
      // 周报：上周一到上周日
      const dayOfWeek = baseDate.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 周一为0

      endDate = new Date(baseDate);
      endDate.setDate(endDate.getDate() - diff - 1);
      endDate.setHours(23, 59, 59, 999);

      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    } else {
      // 月报：上个月第一天到最后一天
      endDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 0);
      endDate.setHours(23, 59, 59, 999);

      startDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1);
      startDate.setHours(0, 0, 0, 0);
    }

    return { startDate, endDate };
  }

  /**
   * 获取学习统计
   */
  private async getLearningStats(
    userId: string,
    startDate: Date,
    endDate: Date
  ) {
    const sessions = await prisma.learning_sessions.findMany({
      where: {
        userId,
        startTime: { gte: startDate, lte: endDate },
        endTime: { not: null } as any
      }
    });

    let totalTimeMinutes = 0;
    const sessionIds = new Set<string>();

    for (const session of sessions) {
      if (session.endTime) {
        const duration = session.endTime.getTime() - session.startTime.getTime();
        totalTimeMinutes += duration / (1000 * 60);
        sessionIds.add(session.id);
      }
    }

    const completedTasksCount = await prisma.subtasks.count({
      where: {
        userId,
        status: 'completed',
        updatedAt: { gte: startDate, lte: endDate }
      }
    });

    const completedPathsCount = await prisma.learning_paths.count({
      where: {
        userId,
        milestones: {
          some: {
            subtasks: {
              some: {
                status: 'completed',
                updatedAt: { gte: startDate, lte: endDate }
              }
            }
          }
        }
      }
    });

    return {
      totalSessions: sessions.length,
      totalTimeMinutes: Math.round(totalTimeMinutes),
      completedTasks: completedTasksCount,
      completedPaths: completedPathsCount
    };
  }

  /**
   * 获取学习指标
   */
  private async getMetrics(
    userId: string,
    startDate: Date,
    endDate: Date
  ) {
    const metrics = await prisma.learning_metrics.findMany({
      where: {
        userId,
        calculatedAt: { gte: startDate, lte: endDate }
      },
      orderBy: { calculatedAt: 'asc' }
    });

    if (metrics.length === 0) {
      return {
        avgLSS: 0,
        avgKTL: 0,
        avgLF: 0,
        avgLSB: 0,
        ktlGrowth: 0
      };
    }

    const avgLSS = metrics.reduce((sum, m) => sum + (m.lss || 0), 0) / metrics.length;
    const avgKTL = metrics.reduce((sum, m) => sum + (m.ktl || 0), 0) / metrics.length;
    const avgLF = metrics.reduce((sum, m) => sum + (m.lf || 0), 0) / metrics.length;
    const avgLSB = avgKTL - avgLF;

    // KTL增长
    const firstKTL = metrics[0].ktl || 0;
    const lastKTL = metrics[metrics.length - 1].ktl || 0;
    const ktlGrowth = lastKTL - firstKTL;

    return {
      avgLSS: Number(avgLSS.toFixed(2)),
      avgKTL: Number(avgKTL.toFixed(2)),
      avgLF: Number(avgLF.toFixed(2)),
      avgLSB: Number(avgLSB.toFixed(2)),
      ktlGrowth: Number(ktlGrowth.toFixed(2))
    };
  }

  /**
   * 获取成就统计
   */
  private async getAchievementStats(
    userId: string,
    startDate: Date,
    endDate: Date
  ) {
    const allAchievements = await prisma.achievements.findMany({
      where: { userId },
      orderBy: { unlockedAt: 'desc' },
      take: 5
    });

    const newAchievements = await prisma.achievements.findMany({
      where: {
        userId,
        unlockedAt: { gte: startDate, lte: endDate }
      }
    });

    return {
      unlocked: allAchievements.length,
      newUnlocked: newAchievements.length,
      topAchievements: allAchievements.slice(0, 3).map(a => ({
        title: a.title,
        earnedAt: a.unlockedAt!
      }))
    };
  }

  /**
   * 获取趋势数据
   */
  private async getTrends(
    userId: string,
    startDate: Date,
    endDate: Date
  ) {
    const metrics = await prisma.learning_metrics.findMany({
      where: {
        userId,
        calculatedAt: { gte: startDate, lte: endDate }
      },
      orderBy: { calculatedAt: 'asc' }
    });

    // 按日期聚合
    const dailyMap = new Map<string, any>();

    for (const metric of metrics) {
      const dateKey = metric.calculatedAt.toISOString().split('T')[0];

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: metric.calculatedAt,
          sessions: 0,
          timeMinutes: 0,
          lss: metric.lss || 0,
          ktl: metric.ktl || 0
        });
      }
    }

    // 统计每日会话数和时间
    const sessions = await prisma.learning_sessions.findMany({
      where: {
        userId,
        startTime: { gte: startDate, lte: endDate },
        endTime: { not: null } as any
      }
    });

    for (const session of sessions) {
      if (session.endTime) {
        const dateKey = session.startTime.toISOString().split('T')[0];
        const entry = dailyMap.get(dateKey);

        if (entry) {
          entry.sessions++;
          entry.timeMinutes +=
            (session.endTime.getTime() - session.startTime.getTime()) /
            (1000 * 60);
        }
      }
    }

    return {
      dailyStats: Array.from(dailyMap.values()).map(d => ({
        date: d.date,
        sessions: d.sessions,
        timeMinutes: Math.round(d.timeMinutes),
        lss: d.lss,
        ktl: d.ktl
      }))
    };
  }

  /**
   * 生成建议
   */
  private generateRecommendations(metrics: any, learning: any): string[] {
    const recommendations: string[] = [];

    // LSS分析
    if (metrics.avgLSS > 7) {
      recommendations.push('学习压力较大，建议适当降低任务难度或增加休息时间');
    } else if (metrics.avgLSS < 3) {
      recommendations.push('学习强度较低，建议适当增加任务挑战性');
    }

    // LSB分析
    if (metrics.avgLSB < 0) {
      recommendations.push('学习状态疲劳，建议暂停1-2天进行休息');
    } else if (metrics.avgLSB < 2) {
      recommendations.push('学习状态一般，建议注意劳逸结合');
    }

    // KTL增长
    if (metrics.ktlGrowth > 0.5) {
      recommendations.push(`知识掌握度提升了 ${metrics.ktlGrowth.toFixed(2)}，表现优秀！`);
    } else if (metrics.ktlGrowth < 0.1) {
      recommendations.push('知识掌握度提升较少，建议加强复习和实践');
    }

    // 学习时间
    const avgDailyMinutes = learning.totalTimeMinutes / 7;
    if (avgDailyMinutes < 30) {
      recommendations.push('平均每日学习时间不足30分钟，建议增加学习投入');
    } else if (avgDailyMinutes > 180) {
      recommendations.push('平均每日学习时间超过3小时，注意保持学习效率');
    }

    return recommendations;
  }

  /**
   * 获取可用的历史周期
   */
  private getAvailablePeriods() {
    const periods = [];

    // 周报：最近12周
    for (let i = 0; i < 12; i++) {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - i * 7);

      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);

      periods.push({
        startDate,
        endDate,
        type: 'weekly' as const
      });
    }

    // 月报：最近6个月
    for (let i = 0; i < 6; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);

      const endDate = new Date(date.getFullYear(), date.getMonth(), 0);
      const monthStartDate = new Date(date.getFullYear(), date.getMonth() - 1, 1);

      periods.push({
        startDate: monthStartDate,
        endDate,
        type: 'monthly' as const
      });
    }

    return periods;
  }
}

export default new ReportService();
