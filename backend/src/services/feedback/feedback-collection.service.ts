import prisma from '../../config/database';
import { logger } from '../../utils/logger';

interface SubmitFeedbackParams {
  userId: string;
  sessionId: string;
  taskId: string;
  rating: number;  // 1-5
  helpfulness?: number;
  clarity?: number;
  difficulty?: number;
  comment?: string;
  suggestions?: string;
  confusionPoint?: string;
  strategy?: string;
  uiType?: string;
  roundNumber?: number;
}

export class FeedbackCollectionService {
  /**
   * 提交反馈
   */
async submitFeedback(params: SubmitFeedbackParams): Promise<void> {
    await prisma.content_feedback.create({
      data: {
        id: `cf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        ...params,
        updatedAt: new Date()
      }
    });
    
    // 记录日志
    logger.info('[Feedback] 收到用户反馈', {
      userId: params.userId,
      rating: params.rating,
      strategy: params.strategy,
      uiType: params.uiType,
      roundNumber: params.roundNumber
    });
  }
  
  /**
   * 获取用户的反馈历史
   */
  async getUserFeedback(userId: string, limit: number = 50) {
    return await prisma.content_feedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }
  
  /**
   * 获取任务的平均反馈
   */
  async getTaskFeedbackStats(taskId: string) {
    const feedbacks = await (prisma.content_feedback.groupBy as any)({
      by: ['subtaskId'],
      where: { subtaskId: taskId },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: true
    });
    
    return feedbacks[0] || {
      _avg: { rating: 0, helpfulness: 0, clarity: 0, difficulty: 0 },
      _count: 0
    };
  }
  
  /**
   * 获取策略的反馈统计
   */
  async getStrategyFeedbackStats() {
    const stats = await (prisma.content_feedback.groupBy as any)({
      by: ['strategy'],
      where: { strategy: { not: null } },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: true,
      orderBy: { _count: 'desc' }
    });
    
    return stats;
  }
  
  /**
   * 获取 UI 类型的反馈统计
   */
  async getUITypeFeedbackStats() {
    const stats = await (prisma.content_feedback.groupBy as any)({
      by: ['uiType'],
      where: { uiType: { not: null } },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: true,
      orderBy: { _count: 'desc' }
    });
    
    return stats;
  }
  
  /**
   * 获取低分反馈（需要改进）
   */
  async getLowRatingFeedback(threshold: number = 3, limit: number = 100) {
    return await prisma.content_feedback.findMany({
      where: {
        rating: { lte: threshold },
        agentId: 'content-agent-v3'
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        users: {
          select: {
            email: true,
            name: true
          }
        }
      }
    });
  }
  
  /**
   * 获取特定时间段的反馈统计
   */
  async getTimeRangeFeedbackStats(startDate: Date, endDate: Date) {
    const stats = await (prisma.content_feedback.groupBy as any)({
      by: ['strategy', 'uiType'],
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: true
    });
    
    return stats;
  }
  
  /**
   * 获取反馈趋势（按天）
   */
  async getFeedbackTrend(days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const feedbacks = await prisma.content_feedback.findMany({
      where: {
        createdAt: {
          gte: startDate
        }
      },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        rating: true,
        strategy: true,
        uiType: true
      }
    });
    
    // 按天分组
    const trendByDay: Record<string, { total: number; sum: number; count: number }> = {};
    
    feedbacks.forEach(fb => {
      const day = fb.createdAt.toISOString().split('T')[0];
      if (!trendByDay[day]) {
        trendByDay[day] = { total: 0, sum: 0, count: 0 };
      }
      trendByDay[day].sum += fb.rating;
      trendByDay[day].count += 1;
      trendByDay[day].total = trendByDay[day].sum / trendByDay[day].count;
    });
    
    return Object.entries(trendByDay).map(([date, data]) => ({
      date,
      avgRating: data.total,
      count: data.count
    }));
  }
}

export const feedbackCollectionService = new FeedbackCollectionService();
