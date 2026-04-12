// API 配置服务
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export interface APIConfig {
  baseURL: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
  defaultReasoningModel: string;
  defaultJudgeModel: string;
}

export const apiConfigAPI = {
  /**
   * 获取当前配置
   */
  getConfig: async () => {
    const response = await axios.get<APIConfig>(`${API_BASE}/api/prompts/config`);
    return response.data;
  },

  /**
   * 更新配置
   */
  updateConfig: async (config: Partial<APIConfig>) => {
    const response = await axios.put<APIConfig>(`${API_BASE}/api/prompts/config`, config);
    return response.data;
  },

  /**
   * 测试连接
   */
  testConnection: async () => {
    const response = await axios.post<{ success: boolean; message: string }>(`${API_BASE}/api/prompts/config/test`);
    return response.data;
  },
};
