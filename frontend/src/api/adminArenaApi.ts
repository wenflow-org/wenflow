import { adminAxios } from './adminApi';

/**
 * 多智能体演练场 API
 */
export const adminArenaApi = {
  /**
   * 获取演练列表
   */
  getSessions: async (params?: { page?: number; limit?: number }) => {
    return adminAxios.get('/admin/arena/sessions', { params });
  },

  /**
   * 获取演练详情
   */
  getSession: async (id: string) => {
    return adminAxios.get(`/admin/arena/sessions/${id}`);
  },

  /**
   * 创建演练
   */
  createSession: async (data: {
    name?: string;
    description?: string;
    config?: any;
  }) => {
    return adminAxios.post('/admin/arena/sessions', data);
  },

  /**
   * 删除演练
   */
  deleteSession: async (id: string) => {
    return adminAxios.delete(`/admin/arena/sessions/${id}`);
  },

  /**
   * 批量创建演练
   */
  createBatch: async (personas: any[]) => {
    return adminAxios.post('/admin/arena/batch', { personas });
  },

  /**
   * 获取统计
   */
  getStats: async () => {
    return adminAxios.get('/admin/arena/stats');
  },

  /**
   * 手动执行单个 Agent
   */
  runAgent: async (sessionId: string, agentType: string, config?: any, fromRound?: number) => {
    return adminAxios.post(`/admin/arena/sessions/${sessionId}/run-agent`, {
      agentType,
      config,
      fromRound
    });
  },

  /**
   * 停止对话
   */
  stopDialogue: async (sessionId: string) => {
    return adminAxios.post(`/admin/arena/sessions/${sessionId}/stop`);
  }
};
