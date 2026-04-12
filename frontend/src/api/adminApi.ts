// Admin 绠＄悊 API
import axios from 'axios';
import { adminArenaApi } from './adminArenaApi';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

/**
 * 鑾峰彇璁よ瘉 Token
 */
function getAuthToken(): string | null {
  return localStorage.getItem('admin_token');
}

/**
 * 鍒涘缓 axios 瀹炰緥
 */
const adminAxios = axios.create({
  baseURL: API_BASE,
  timeout: 240000, // 4鍒嗛挓瓒呮椂
  headers: {
    'Content-Type': 'application/json',
  },
});

// 璇锋眰鎷︽埅鍣?- 娣诲姞 Token
adminAxios.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 瀵煎嚭 axios 瀹炰緥渚涘叾浠栨ā鍧椾娇鐢?
export { adminAxios };

/**
 * 璁よ瘉 API
 */
export const adminAuthApi = {
  /**
   * 绠＄悊鍛樼櫥褰?
   */
  login: async (data: { name: string; password: string; remember?: boolean }) => {
    return adminAxios.post('/admin-auth/login', data);
  },

  /**
   * 鑾峰彇褰撳墠绠＄悊鍛樹俊鎭?
   */
  getMe: async () => {
    return adminAxios.get('/admin-auth/me');
  },

  /**
   * 鐧诲嚭
   */
  logout: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
  },
};

/**
 * 骞冲彴缁熻 API
 */
export const adminDashboardApi = {
  /**
   * 鑾峰彇骞冲彴缁熻鏁版嵁
   */
  getStats: async () => {
    return adminAxios.get('/admin/overview/stats');
  },

  /**
   * 鑾峰彇娲诲姩鏃ュ織
   */
  getActivity: async (limit?: number) => {
    return adminAxios.get('/admin/activity', { params: { limit } });
  },

  /**
   * 鑾峰彇鐢ㄦ埛鍒楄〃锛堝吋瀹规棫鐗堬級
   */
  users: async (params?: any) => {
    return adminAxios.get('/admin/users', { params });
  },
};

/**
 * 骞冲彴寮€鍏宠缃?API
 */
export const adminPlatformSettingsApi = {
  getRegistrationSetting: async () => {
    return adminAxios.get('/admin/settings/registration');
  },

  updateRegistrationSetting: async (registrationEnabled: boolean) => {
    return adminAxios.put('/admin/settings/registration', { registrationEnabled });
  }
};

/**
 * 鐢ㄦ埛绠＄悊 API
 */
export const adminUsersApi = {
  /**
   * 鑾峰彇鐢ㄦ埛鍒楄〃
   */
  getUsers: async (params?: { page?: number; limit?: number; search?: string }) => {
    return adminAxios.get('/admin/users', { params });
  },

  /**
   * 鑾峰彇鐢ㄦ埛鍒楄〃锛堝吋瀹规棫鐗堬級
   */
  users: async (params?: { page?: number; limit?: number; search?: string }) => {
    return adminAxios.get('/admin/users', { params });
  },

  /**
   * 鑾峰彇鐢ㄦ埛璇︽儏
   */
  getUser: async (userId: string) => {
    return adminAxios.get(`/admin/users/${userId}`);
  },

  createUser: async (data: {
    email: string;
    password: string;
    name: string;
    role?: 'user' | 'admin';
    currentLevel?: string;
    xp?: number;
    isAdmin?: boolean;
  }) => {
    return adminAxios.post('/admin/users', data);
  },

  deleteUser: async (userId: string) => {
    return adminAxios.delete(`/admin/users/${userId}`);
  },

  batchDeleteUsers: async (ids: string[]) => {
    return adminAxios.post('/admin/users/batch-delete', { ids });
  },

  updateUser: async (
    userId: string,
    data: {
      name?: string;
      email?: string;
      isAdmin?: boolean;
      currentLevel?: string;
      xp?: number;
      password?: string;
    }
  ) => {
    return adminAxios.patch(`/admin/users/${userId}`, data);
  },

  /**
   * 鏇存柊鐢ㄦ埛瑙掕壊
   */
  updateUserRole: async (userId: string, role: 'user' | 'admin') => {
    return adminAxios.patch(`/admin/users/${userId}/role`, { role });
  },
};

/**
 * 鐩爣瀵硅瘽绠＄悊 API
 */
export const adminConversationsApi = {
  /**
   * 鑾峰彇瀵硅瘽鍒楄〃
   */
  getConversations: async (params?: { page?: number; limit?: number; status?: string; userId?: string }) => {
    return adminAxios.get('/admin/goal-conversations', { params });
  },

  /**
   * 鑾峰彇瀵硅瘽鍒楄〃锛堝吋瀹规棫鐗堬級
   */
  list: async (params?: { page?: number; limit?: number; status?: string; userId?: string }) => {
    return adminAxios.get('/admin/goal-conversations', { params });
  },

  /**
   * 鑾峰彇瀵硅瘽璇︽儏
   */
  getConversation: async (conversationId: string) => {
    return adminAxios.get(`/admin/goal-conversations/${conversationId}`);
  },

  /**
   * 鑾峰彇瀵硅瘽璇︽儏锛堝吋瀹规棫鐗堬級
   */
  detail: async (conversationId: string) => {
    return adminAxios.get(`/admin/goal-conversations/${conversationId}`);
  },

  /**
   * 閲嶆柊鐢熸垚瀛︿範璺緞
   */
  generatePath: async (conversationId: string) => {
    return adminAxios.post(`/admin/goal-conversations/${conversationId}/regenerate-path`);
  },

  /**
   * 鍒犻櫎瀵硅瘽
   */
  deleteConversation: async (conversationId: string) => {
    return adminAxios.delete(`/admin/goal-conversations/${conversationId}`);
  },
};

/**
 * Agent 绠＄悊 API
 */
export const adminAgentsApi = {
  /**
   * 鑾峰彇 Agent 鍒楄〃
   */
  getAgents: async () => {
    return adminAxios.get('/admin/agents');
  },

  /**
   * 鑾峰彇 Agent 鐘舵€?
   */
  status: async () => {
    return adminAxios.get('/admin/agents/status');
  },

  /**
   * 鑾峰彇 Agent 鏃ュ織
   */
  getLogs: async (params?: { page?: number; limit?: number; agentName?: string }) => {
    return adminAxios.get('/admin/agents/logs', { params });
  },
};

/**
 * Agent Lab API - Agent 閰嶇疆鍜屾祴璇?
 */
export const adminAgentLabApi = {
  /**
   * 鑾峰彇鎵€鏈?Agent 閰嶇疆锛圓rena + Platform锛?
   */
  getAgents: async () => {
    return adminAxios.get('/admin/agent-lab/agents');
  },

  /**
   * 鑾峰彇鍗曚釜 Agent 閰嶇疆
   */
  getAgent: async (name: string) => {
    return adminAxios.get(`/admin/agent-lab/agents/${name}`);
  },

  /**
   * 娴嬭瘯 Agent
   */
  testAgent: async (name: string, data: { input: any; context?: any }) => {
    return adminAxios.post(`/admin/agent-lab/agents/${name}/test`, data);
  },

  /**
   * 鏇存柊 Agent 鐨?System Prompt
   */
  updatePrompt: async (name: string, data: { prompt: string }) => {
    return adminAxios.put(`/admin/agent-lab/agents/${name}/prompt`, data);
  },

  /**
   * 鑾峰彇 API 閰嶇疆
   */
  getApiConfig: async () => {
    return adminAxios.get('/admin/agent-lab/api-config');
  },

  /**
   * 鏇存柊 API 閰嶇疆
   */
  updateApiConfig: async (data: any) => {
    return adminAxios.put('/admin/agent-lab/api-config', data);
  },

  /**
   * 娴嬭瘯 API 杩炴帴
   */
  testApiConnection: async (data: { baseURL: string; apiKey: string }) => {
    return adminAxios.post('/admin/agent-lab/api-config/test', data);
  },

  /**
   * 鑾峰彇鎻掍欢閰嶇疆
   */
  getPluginConfig: async () => {
    return adminAxios.get('/admin/agent-lab/plugin-config');
  },

  /**
   * 鏇存柊鎻掍欢閰嶇疆
   */
  updatePluginConfig: async (data: any) => {
    return adminAxios.put('/admin/agent-lab/plugin-config', data);
  },

  /**
   * 淇濆瓨 Agent 鐙珛閰嶇疆
   */
  saveAgentConfig: async (name: string, data: any) => {
    return adminAxios.put(`/admin/agent-lab/agents/${name}/config`, data);
  },

  /**
   * 鍒犻櫎 Agent 鐙珛閰嶇疆
   */
  deleteAgentConfig: async (name: string) => {
    return adminAxios.delete(`/admin/agent-lab/agents/${name}/config`);
  },

  /**
   * 鑾峰彇 Agent 鍙戝竷鐩綍锛堥潰鍚戠敤鎴峰彲閫夋睜锛?
   */
  getAgentCatalog: async () => {
    return adminAxios.get('/admin/agent-lab/agent-catalog');
  },

  /**
   * 鏇存柊 Agent 鍙戝竷鐘舵€?
   */
  updateAgentCatalogStatus: async (agentId: string, status: 'draft' | 'staging' | 'published') => {
    return adminAxios.put(`/admin/agent-lab/agent-catalog/${agentId}/status`, { status });
  },
};

/**
 * 骞冲彴 API 绠＄悊
 */
export const adminApiConfigApi = {
  getConfig: async () => {
    return adminAxios.get('/admin/api-config');
  },

  updateConfig: async (data: {
    apiUrl: string;
    apiKey: string;
    availableModels: string | string[];
    defaultModel: string;
    defaultReasoningModel: string;
    defaultEvaluationModel: string;
  }) => {
    return adminAxios.put('/admin/api-config', data);
  },

  testConnection: async (data: { apiUrl: string; apiKey: string }) => {
    return adminAxios.post('/admin/api-config/test', data);
  }
};

/**
 * Agent Prompt 绠＄悊 API - 鐗堟湰绠＄悊
 */
export const adminAgentPromptsApi = {
  /**
   * 鑾峰彇 Prompt 鐗堟湰鍒楄〃
   */
  getPromptVersions: async (params?: { agentId?: string; status?: string }) => {
    return adminAxios.get('/admin/agent-prompts', { params });
  },

  /**
   * 鑾峰彇 Agent 娲昏穬 Prompt
   */
  getActivePrompt: async (agentId: string) => {
    return adminAxios.get(`/admin/agent-prompts/${agentId}/active`);
  },

  /**
   * 鑾峰彇 Prompt 璇︽儏
   */
  getPromptDetail: async (id: string) => {
    return adminAxios.get(`/admin/agent-prompts/detail/${id}`);
  },

  /**
   * 鍒涘缓鏂?Prompt 鐗堟湰
   */
  createPrompt: async (data: {
    agentId: string;
    name: string;
    description?: string;
    systemPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }) => {
    return adminAxios.post('/admin/agent-prompts', data);
  },

  /**
   * 鍙戝竷 Prompt 鐗堟湰
   */
  publishPrompt: async (id: string) => {
    return adminAxios.put(`/admin/agent-prompts/${id}/publish`);
  },

  /**
   * 鏇存柊 Prompt 鑽夌
   */
  updatePrompt: async (id: string, data: any) => {
    return adminAxios.put(`/admin/agent-prompts/${id}`, data);
  },

  /**
   * 鍒犻櫎 Prompt 鑽夌
   */
  deletePrompt: async (id: string) => {
    return adminAxios.delete(`/admin/agent-prompts/${id}`);
  },
};

/**
 * 璋冭瘯娌欑洅 API - 瀹屾暣娴佹按绾胯皟璇?
 * A: 鍘熷瀵硅瘽 -> A1: 闇€姹傛敹闆?-> B1: 鏂规鐢熸垚 -> C: 璺緞鐢熸垚
 */
export const adminDebugSandboxApi = {
  // ========== 蹇収绠＄悊 ==========
  
  /**
   * 鑾峰彇蹇収鍒楄〃
   */
  getSnapshots: async (params?: { page?: number; limit?: number }) => {
    return adminAxios.get('/admin/debug/snapshots', { params });
  },

  /**
   * 鑾峰彇蹇収璇︽儏锛堝畬鏁存祦姘寸嚎鏁版嵁锛?
   */
  getSnapshot: async (id: string) => {
    return adminAxios.get(`/admin/debug/snapshots/${id}`);
  },

  /**
   * 鍒涘缓蹇収锛堜繚瀛樺師濮嬪璇濓級
   */
  createSnapshot: async (data: {
    name: string;
    description?: string;
    sourceConversationId?: string;
    rawMessages?: string;
    tags?: string[];
  }) => {
    return adminAxios.post('/admin/debug/snapshots', data);
  },

  /**
   * 鏇存柊蹇収
   */
  updateSnapshot: async (id: string, data: any) => {
    return adminAxios.put(`/admin/debug/snapshots/${id}`, data);
  },

  /**
   * 鍒犻櫎蹇収
   */
  deleteSnapshot: async (id: string) => {
    return adminAxios.delete(`/admin/debug/snapshots/${id}`);
  },

  // ========== 闇€姹傛敹闆嗭紙A 鈫?A1锛?=========

  /**
   * 閲嶆柊杩愯闇€姹傛敹闆?
   */
  regenerateRequirement: async (snapshotId: string, params?: {
    promptTemplate?: string;
    temperature?: number;
    focusAreas?: string[];
  }) => {
    return adminAxios.post(`/admin/debug/snapshots/${snapshotId}/regenerate-requirement`, { params });
  },

  /**
   * 婵€娲婚渶姹傜増鏈?
   */
  activateRequirement: async (requirementId: string) => {
    return adminAxios.patch(`/admin/debug/requirements/${requirementId}/activate`);
  },

  // ========== 鏂规鐢熸垚锛圓1 鈫?B1锛?=========

  /**
   * 閲嶆柊鐢熸垚鏂规
   */
  regenerateProposal: async (requirementId: string, params?: {
    weeks?: number;
    difficulty?: string;
    focus?: string;
    includeProjects?: boolean;
  }) => {
    return adminAxios.post(`/admin/debug/requirements/${requirementId}/regenerate-proposal`, { params });
  },

  /**
   * 婵€娲绘柟妗?
   */
  activateProposal: async (proposalId: string) => {
    return adminAxios.patch(`/admin/debug/proposals/${proposalId}/activate`);
  },

  // ========== 璺緞鐢熸垚锛圔1 鈫?C锛?=========

  /**
   * 閲嶆柊鐢熸垚璺緞
   */
  regeneratePath: async (proposalId: string, params?: {
    taskGranularity?: string;
    resourcePreference?: string;
  }) => {
    return adminAxios.post(`/admin/debug/proposals/${proposalId}/regenerate-path`, { params });
  },

  /**
   * 婵€娲昏矾寰?
   */
  activatePath: async (pathId: string) => {
    return adminAxios.patch(`/admin/debug/learning-paths/${pathId}/activate`);
  },

  // ========== 杈呭姪鍔熻兘 ==========

  /**
   * 鑾峰彇鏈€杩戝璇濆垪琛?
   */
  getRecentConversations: async () => {
    return adminAxios.get('/admin/debug/recent-conversations');
  },

  /**
   * 鎵归噺娓呯悊
   */
  cleanup: async (keepRecent: number) => {
    return adminAxios.delete('/admin/debug/cleanup', { data: { keepRecent } });
  },

  /**
   * 閲嶆柊鐢熸垚鏂规杞粨
   */
  regenerateOutline: async (snapshotId: string, params?: {
    promptTemplate?: string;
    temperature?: number;
  }) => {
    return adminAxios.post(`/admin/debug/snapshots/${snapshotId}/regenerate-outline`, params);
  },

  // ========== 瀛︾敓鐘舵€佽拷韪?==========

    

    /**

     * 鑾峰彇瀛︾敓鐘舵€佸熀绾?

     */

    getStudentBaseline: async (userId: string) => {

      return adminAxios.get('/admin/platform/student-state', { params: { userId } });

    },

    

    /**

     * 鑾峰彇瀛︿範浼氳瘽鐘舵€?

     */

    getSessionState: async (sessionId: string) => {

      return adminAxios.get(`/admin/platform/session-state/${sessionId}`);

    },

  };

  /**
   * Skills 绠＄悊 API
   */
  export const adminSkillsApi = {
    /**
     * 鑾峰彇鎵€鏈?Skill 鍒楄〃
     */
    getSkills: async () => {
      return adminAxios.get('/admin/skills');
    },

    /**
     * 鎸夊垎绫荤粺璁?
     */
    getCategories: async () => {
      return adminAxios.get('/admin/skills/categories');
    },

    /**
     * 鑾峰彇 Skill 璇︽儏
     */
    getSkillDetail: async (name: string) => {
      return adminAxios.get(`/admin/skills/${name}`);
    },

    /**
     * 鑾峰彇 Skill 鏁版嵁搴撶粺璁?
     */
    getSkillDbStats: async (name: string) => {
      return adminAxios.get(`/admin/skills/${name}/db-stats`);
    },

    /**
     * 娴嬭瘯鎵ц Skill
     */
    testSkill: async (name: string, input: any) => {
      return adminAxios.post(`/admin/skills/${name}/test`, input);
    },

    /**
     * 鑾峰彇浣跨敤瓒嬪娍
     */
    getUsageTrends: async () => {
      return adminAxios.get('/admin/skills/usage/trends');
    },
  };

  // ========== 缁熶竴瀵煎嚭 ==========
  
  /**
   * 缁熶竴瀵煎嚭瀵硅薄锛堝吋瀹规棫鐗堜唬鐮侊級
   */
export const adminApi = {
  // Dashboard
  ...adminDashboardApi,

  // Platform Settings
  ...adminPlatformSettingsApi,

  // API Config
  ...adminApiConfigApi,
  
  // Users
  ...adminUsersApi,
    
    // Conversations
    ...adminConversationsApi,
    
    // Agents
    ...adminAgentsApi,
    
    // Agent Lab
    ...adminAgentLabApi,
    
    // Agent Prompts
    ...adminAgentPromptsApi,
    
    // Debug Sandbox
    ...adminDebugSandboxApi,
    
    // Arena
    ...adminArenaApi,
    
    // Skills
    ...adminSkillsApi,
  };

export { adminArenaApi };
