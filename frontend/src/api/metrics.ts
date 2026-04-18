// 学习指标API
import api from '../utils/api';

export interface LearningMetrics {
  lssCurrent: number;
  ktlCurrent: number;
  lfCurrent: number;
  lsbCurrent: number;
  advice?: string[];
}

export interface CurrentState {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
  updatedAt?: string;
  advice?: string[];
  suggestion?: {
    level?: string;
    message?: string;
    action?: string;
  };
}

export interface TrendDataPoint {
  date: string;
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
}

export interface TrendData {
  days: number;
  data: TrendDataPoint[];
}

export const metricsAPI = {
  async getCurrentState(): Promise<CurrentState | null> {
    try {
      const response = await api.get('/state/current');
      return (response as any)?.data || null;
    } catch (error: any) {
      console.error('获取学习状态失败:', error);
      return null;
    }
  },

  async getTrends(days: number = 30): Promise<TrendData> {
    try {
      const response = await api.get(`/state/trends?days=${days}`);
      return (response as any)?.data || { days, data: [] };
    } catch (error: any) {
      console.error('获取趋势数据失败:', error);
      return { days, data: [] };
    }
  },

  async getCurrent(): Promise<LearningMetrics | null> {
    try {
      const response = await api.get('/metrics/current');
      return (response as any)?.data || null;
    } catch (error: any) {
      console.error('获取学习指标失败:', error);
      return null;
    }
  },

  async getHistory(): Promise<{ lssHistory: Array<{ date: string; score: number }>; sessionHistory: Array<{ date: string; taskId?: string; durationMinutes: number; lssScore: number; completed: boolean }> }> {
    try {
      const response = await api.get('/metrics/history');
      return (response as any)?.data || { lssHistory: [], sessionHistory: [] };
    } catch (error: any) {
      console.error('获取学习历史失败:', error);
      return { lssHistory: [], sessionHistory: [] };
    }
  },

  async getAdvice(): Promise<string[]> {
    try {
      const response = await api.get('/metrics/advice');
      return (response as any)?.data || [];
    } catch (error: any) {
      console.error('获取学习建议失败:', error);
      return [];
    }
  }
};