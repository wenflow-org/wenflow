import request from '@/utils/request';

export interface SubmitFeedbackParams {
  sessionId: string;
  taskId: string;
  rating: number;
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

export interface FeedbackItem {
  id: string;
  userId: string;
  sessionId: string;
  taskId: string;
  agentId: string;
  rating: number;
  helpfulness: number | null;
  clarity: number | null;
  difficulty: number | null;
  comment: string | null;
  suggestions: string | null;
  confusionPoint: string | null;
  strategy: string | null;
  uiType: string | null;
  roundNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackStats {
  _avg: {
    rating: number;
    helpfulness: number;
    clarity: number;
    difficulty: number;
  };
  _count: number;
}

export interface FeedbackTrendItem {
  date: string;
  avgRating: number;
  count: number;
}

/**
 * 提交反馈
 */
export async function submitFeedback(params: SubmitFeedbackParams) {
  return request({
    url: '/api/feedback/submit',
    method: 'post',
    data: params
  });
}

/**
 * 获取我的反馈历史
 */
export async function getMyFeedback(limit: number = 50, page: number = 1) {
  return request({
    url: '/api/feedback/my-feedback',
    method: 'get',
    params: { limit, page }
  });
}

/**
 * 获取任务反馈统计（管理员）
 */
export async function getTaskFeedbackStats(taskId: string) {
  return request({
    url: `/api/feedback/task/${taskId}/stats`,
    method: 'get'
  });
}

/**
 * 获取策略反馈统计（管理员）
 */
export async function getStrategyFeedbackStats() {
  return request({
    url: '/api/feedback/strategy/stats',
    method: 'get'
  });
}

/**
 * 获取 UI 类型反馈统计（管理员）
 */
export async function getUITypeFeedbackStats() {
  return request({
    url: '/api/feedback/uitype/stats',
    method: 'get'
  });
}

/**
 * 获取低分反馈（管理员）
 */
export async function getLowRatingFeedback(threshold: number = 3, limit: number = 100) {
  return request({
    url: '/api/feedback/low-ratings',
    method: 'get',
    params: { threshold, limit }
  });
}

/**
 * 获取反馈趋势（管理员）
 */
export async function getFeedbackTrend(days: number = 30) {
  return request({
    url: '/api/feedback/trend',
    method: 'get',
    params: { days }
  });
}

/**
 * 获取时间段反馈统计（管理员）
 */
export async function getTimeRangeFeedbackStats(startDate: string, endDate: string) {
  return request({
    url: '/api/feedback/time-range/stats',
    method: 'get',
    params: { startDate, endDate }
  });
}

// 导出为 feedbackApi 对象（兼容旧代码）
export const feedbackApi = {
  submit: submitFeedback,
  getMyFeedback,
  getTaskFeedbackStats,
  getStrategyFeedbackStats,
  getUITypeFeedbackStats,
  getLowRatingFeedback,
  getFeedbackTrend,
  getTimeRangeFeedbackStats
};
