// Admin 管理 API
import axios from 'axios';
import { adminArenaApi } from './adminArenaApi';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

/**
 * 获取认证 Token
 */
function getAuthToken(): string | null {
  return localStorage.getItem('admin_token');
}

/**
 * 创建 axios 实例
 */
const adminAxios = axios.create({
  baseURL: API_BASE,
  timeout: 240000, // 4分钟超时
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加 Token
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

// 导出 axios 实例供其他模块使用
export { adminAxios };

/**
 * 认证 API
 */
export const adminAuthApi = {
  /**
   * 管理员登录
   */
  login: async (data: { name: string; password: string; remember?: boolean }) => {
    return adminAxios.post('/admin-auth/login', data);
  },

  /**
   * 获取当前管理员信息
   */
  getMe: async () => {
    return adminAxios.get('/admin-auth/me');
  },

  /**
   * 登出
   */
  logout: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
  },
};

/**
 * 平台统计 API
 */
export const adminDashboardApi = {
  /**
   * 获取平台统计数据
   */
  getStats: async () => {
    return adminAxios.get('/admin/overview/stats');
  },

  /**
   * 获取活动日志
   */
  getActivity: async (limit?: number) => {
    return adminAxios.get('/admin/activity', { params: { limit } });
  },

  /**
   * 获取用户列表（兼容旧版）
   */
  users: async (params?: any) => {
    return adminAxios.get('/admin/users', { params });
  },
};

/**
 * 平台开关设置 API
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
 * 用户管理 API
 */
export const adminUsersApi = {
  /**
   * 获取用户列表
   */
  getUsers: async (params?: { page?: number; limit?: number; search?: string }) => {
    return adminAxios.get('/admin/users', { params });
  },

  /**
   * 获取用户列表（兼容旧版）
   */
  users: async (params?: { page?: number; limit?: number; search?: string }) => {
    return adminAxios.get('/admin/users', { params });
  },

  /**
   * 获取用户详情
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
   * 更新用户角色
   */
  updateUserRole: async (userId: string, role: 'user' | 'admin') => {
    return adminAxios.patch(`/admin/users/${userId}/role`, { role });
  },
};

/**
 * 目标对话管理 API
 */
export const adminConversationsApi = {
  /**
   * 获取对话列表
   */
  getConversations: async (params?: { page?: number; limit?: number; status?: string; userId?: string }) => {
    return adminAxios.get('/admin/goal-conversations', { params });
  },

  /**
   * 获取对话列表（兼容旧版）
   */
  list: async (params?: { page?: number; limit?: number; status?: string; userId?: string }) => {
    return adminAxios.get('/admin/goal-conversations', { params });
  },

  /**
   * 获取对话详情
   */
  getConversation: async (conversationId: string) => {
    return adminAxios.get(`/admin/goal-conversations/${conversationId}`);
  },

  /**
   * 获取对话详情（兼容旧版）
   */
  detail: async (conversationId: string) => {
    return adminAxios.get(`/admin/goal-conversations/${conversationId}`);
  },

  /**
   * 重新生成学习路径
   */
  generatePath: async (conversationId: string) => {
    return adminAxios.post(`/admin/goal-conversations/${conversationId}/regenerate-path`);
  },

  /**
   * 删除对话
   */
  deleteConversation: async (conversationId: string) => {
    return adminAxios.delete(`/admin/goal-conversations/${conversationId}`);
  },
};

export const adminLearnerModelsApi = {
  list: async (params?: {
    userId?: string;
    pathId?: string;
    staleOnly?: boolean;
    riskOnly?: boolean;
    page?: number;
    limit?: number;
  }) => {
    return adminAxios.get('/admin/learner-models', { params });
  },

  getDetail: async (userId: string, params?: {
    pathId?: string;
    mode?: 'global' | 'path' | 'teaching';
  }) => {
    return adminAxios.get(`/admin/learner-models/${userId}`, { params });
  },

  recompute: async (userId: string, data?: {
    pathId?: string;
    scope?: 'global' | 'path' | 'teaching';
  }) => {
    return adminAxios.post(`/admin/learner-models/${userId}/recompute`, data || {});
  },

  getEvidence: async (userId: string, params?: {
    pathId?: string;
    limit?: number;
  }) => {
    return adminAxios.get(`/admin/learner-models/${userId}/evidence`, { params });
  }
};

export const adminTeachingSessionsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    userId?: string;
    status?: string;
    onlyWithAdvisory?: boolean;
  }) => {
    return adminAxios.get('/admin/teaching-sessions', { params });
  }
};

/**
 * Agent 管理 API
 */
export interface AdminRegistryAgent {
  agentId: string;
  name: string;
  type: string;
  role?: string;
  lifecycleStatus: 'draft' | 'staging' | 'published';
  status: 'healthy' | 'warning' | 'error' | 'idle';
  callCount: number;
  successRate: number;
  avgDuration: number;
  lastActivity: string | null;
  version: string;
}

export interface AdminRegistryResponse {
  data: {
    summary: {
      total: number;
      active24h: number;
      neverCalled: number;
      unhealthy: number;
    };
    agents: AdminRegistryAgent[];
  };
}

export interface AgentDesignDetail {
  agentId: string;
  requestedAgentId: string;
  basic: {
    name: string;
    version: string;
    type: string;
    category: string;
    description: string;
  };
  runtime: {
    role: 'agent' | 'orchestrator';
    kind: 'agent' | 'orchestrator' | 'alias';
    runtimeEnabled: boolean;
    userVisible: boolean;
    monitoringGroup: string | null;
    ioContractVersion: 'legacy' | 'agent-output-v1';
    aliases: string[];
  };
  definition: {
    capabilities: string[];
    subscribes: string[];
    publishes: string[];
    inputSchema: any;
    outputSchema: any;
  };
  samples: {
    agentCallLogs: Array<{
      id: string;
      calledAt: string;
      success: boolean;
      durationMs: number;
      error: string | null;
      input: any;
      output: any;
    }>;
    arenaAgentLogs: Array<{
      id: string;
      calledAt: string;
      success: boolean;
      durationMs: number;
      error: string | null;
      input: any;
      output: any;
    }>;
  };
}

export interface OrchestratorRelationItem {
  orchestratorId: string;
  group: string;
  members: Array<{
    agentId: string;
    name: string;
    role: 'agent' | 'orchestrator';
  }>;
}

export interface ManifestDiagnosticsData {
  summary: {
    manifestTotal: number;
    registrationTotal: number;
    modelConfigTotal: number;
    calledAgentTotal: number;
    catalogTotal: number;
    driftCount: number;
    outputContractSampleSize?: number;
    arenaOutputContractSampleSize?: number;
  };
  outputContracts?: {
    agentCallLogs: {
      sampleSize: number;
      v1: number;
      legacy: number;
      mixed: number;
      unknown: number;
    };
    arenaAgentLogs: {
      sampleSize: number;
      v1: number;
      legacy: number;
      mixed: number;
      unknown: number;
    };
  };
  drift: {
    missingRegistrations: string[];
    unknownRegistrations: string[];
    aliasRegistrations: Array<{ id: string; canonicalId: string }>;
    unknownModelConfigs: string[];
    aliasModelConfigs: Array<{ id: string; canonicalId: string }>;
    unknownLogAgents: string[];
    aliasLogAgents: Array<{ id: string; canonicalId: string; calls: number }>;
    catalogOnly: string[];
  };
  samples: {
    registrations: Array<{
      id: string;
      name: string;
      type: string;
      updatedAt: string;
    }>;
    modelConfigs: Array<{
      agentId: string;
      enabled: boolean;
      updatedAt: string;
    }>;
    calledAgents: Array<{
      agentId: string;
      _count: { _all: number };
    }>;
  };
}

export const adminAgentsApi = {
  /**
   * 获取 Agent 列表
   */
  getAgents: async () => {
    return adminAxios.get('/admin/agents');
  },

  /**
   * 获取 Agent 状态
   */
  status: async () => {
    return adminAxios.get('/admin/agents/status');
  },

  /**
   * 获取 Agent 日志
   */
  getLogs: async (params?: {
    page?: number;
    limit?: number;
    agentName?: string;
    agentId?: string;
    traceId?: string;
    sessionId?: string;
    status?: 'success' | 'error' | 'timeout';
    keyword?: string;
    timeRange?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'week' | 'month' | 'all';
  }) => {
    return adminAxios.get('/admin/agents/logs', { params });
  },

  getRegistry: async () => {
    return adminAxios.get<AdminRegistryResponse>('/admin/agents/registry');
  },

  getAgentDesign: async (agentId: string) => {
    return adminAxios.get<{ data: AgentDesignDetail }>(`/admin/agents/design/${encodeURIComponent(agentId)}`);
  },

  getOrchestratorRelations: async () => {
    return adminAxios.get<{ data: { orchestrators: OrchestratorRelationItem[] } }>('/admin/orchestrators/relations');
  },

  getManifestDiagnostics: async () => {
    return adminAxios.get<{ data: ManifestDiagnosticsData }>('/admin/manifest/diagnostics');
  },
};

/**
 * Agent Lab API - Agent 配置和测试
 */
export const adminAgentLabApi = {
  /**
   * 获取所有 Agent 配置（Arena + Platform）
   */
  getAgents: async () => {
    return adminAxios.get('/admin/agent-lab/agents');
  },

  /**
   * 获取单个 Agent 配置
   */
  getAgent: async (name: string) => {
    return adminAxios.get(`/admin/agent-lab/agents/${name}`);
  },

  /**
   * 测试 Agent
   */
  testAgent: async (name: string, data: { input: any; context?: any }) => {
    return adminAxios.post(`/admin/agent-lab/agents/${name}/test`, data);
  },

  /**
   * 更新 Agent 的 System Prompt
   */
  updatePrompt: async (name: string, data: { prompt: string }) => {
    return adminAxios.put(`/admin/agent-lab/agents/${name}/prompt`, data);
  },

  /**
   * 获取 API 配置
   */
  getApiConfig: async () => {
    return adminAxios.get('/admin/agent-lab/api-config');
  },

  /**
   * 更新 API 配置
   */
  updateApiConfig: async (data: any) => {
    return adminAxios.put('/admin/agent-lab/api-config', data);
  },

  /**
   * 测试 API 连接
   */
  testApiConnection: async (data: { baseURL: string; apiKey: string }) => {
    return adminAxios.post('/admin/agent-lab/api-config/test', data);
  },

  /**
   * 获取插件配置
   */
  getPluginConfig: async () => {
    return adminAxios.get('/admin/agent-lab/plugin-config');
  },

  /**
   * 更新插件配置
   */
  updatePluginConfig: async (data: any) => {
    return adminAxios.put('/admin/agent-lab/plugin-config', data);
  },

  /**
   * 保存 Agent 独立配置
   */
  saveAgentConfig: async (name: string, data: any) => {
    return adminAxios.put(`/admin/agent-lab/agents/${name}/config`, data);
  },

  /**
   * 删除 Agent 独立配置
   */
  deleteAgentConfig: async (name: string) => {
    return adminAxios.delete(`/admin/agent-lab/agents/${name}/config`);
  },

  /**
   * 获取 Agent 发布目录（面向用户可选池）
   */
  getAgentCatalog: async () => {
    return adminAxios.get('/admin/agent-lab/agent-catalog');
  },

  /**
   * 更新 Agent 发布状态
   */
  updateAgentCatalogStatus: async (agentId: string, status: 'draft' | 'staging' | 'published') => {
    return adminAxios.put(`/admin/agent-lab/agent-catalog/${agentId}/status`, { status });
  },
};

/**
 * 平台 API 管理
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
 * Agent Prompt 管理 API - 版本管理
 */
export const adminAgentPromptsApi = {
  /**
   * 获取 Prompt 版本列表
   */
  getPromptVersions: async (params?: { agentId?: string; status?: string }) => {
    return adminAxios.get('/admin/agent-prompts', { params });
  },

  /**
   * 获取 Agent 活跃 Prompt
   */
  getActivePrompt: async (agentId: string) => {
    return adminAxios.get(`/admin/agent-prompts/${agentId}/active`);
  },

  /**
   * 获取 Prompt 详情
   */
  getPromptDetail: async (id: string) => {
    return adminAxios.get(`/admin/agent-prompts/detail/${id}`);
  },

  /**
   * 创建新 Prompt 版本
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
   * 发布 Prompt 版本
   */
  publishPrompt: async (id: string) => {
    return adminAxios.put(`/admin/agent-prompts/${id}/publish`);
  },

  /**
   * 更新 Prompt 草稿
   */
  updatePrompt: async (id: string, data: any) => {
    return adminAxios.put(`/admin/agent-prompts/${id}`, data);
  },

  /**
   * 删除 Prompt 草稿
   */
  deletePrompt: async (id: string) => {
    return adminAxios.delete(`/admin/agent-prompts/${id}`);
  },
};

/**
 * 调试沙箱 API - 完整流水线调试
 * A: 原始对话 -> A1: 需求收集 -> B1: 方案生成 -> C: 路径生成
 */
export const adminDebugSandboxApi = {
  // ========== 快照管理 ==========
  
  /**
   * 获取快照列表
   */
  getSnapshots: async (params?: { page?: number; limit?: number }) => {
    return adminAxios.get('/admin/debug/snapshots', { params });
  },

  /**
   * 获取快照详情（完整流水线数据）
   */
  getSnapshot: async (id: string) => {
    return adminAxios.get(`/admin/debug/snapshots/${id}`);
  },

  /**
   * 创建快照（保存原始对话）
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
   * 更新快照
   */
  updateSnapshot: async (id: string, data: any) => {
    return adminAxios.put(`/admin/debug/snapshots/${id}`, data);
  },

  /**
   * 删除快照
   */
  deleteSnapshot: async (id: string) => {
    return adminAxios.delete(`/admin/debug/snapshots/${id}`);
  },

  // ========== 需求收集（A -> A1）=========

  /**
   * 重新运行需求收集
   */
  regenerateRequirement: async (snapshotId: string, params?: {
    promptTemplate?: string;
    temperature?: number;
    focusAreas?: string[];
  }) => {
    return adminAxios.post(`/admin/debug/snapshots/${snapshotId}/regenerate-requirement`, { params });
  },

  /**
   * 激活需求版本
   */
  activateRequirement: async (requirementId: string) => {
    return adminAxios.patch(`/admin/debug/requirements/${requirementId}/activate`);
  },

  // ========== 方案生成（A1 -> B1）=========

  /**
   * 重新生成方案
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
   * 激活方案
   */
  activateProposal: async (proposalId: string) => {
    return adminAxios.patch(`/admin/debug/proposals/${proposalId}/activate`);
  },

  // ========== 路径生成（B1 -> C）=========

  /**
   * 重新生成路径
   */
  regeneratePath: async (proposalId: string, params?: {
    taskGranularity?: string;
    resourcePreference?: string;
  }) => {
    return adminAxios.post(`/admin/debug/proposals/${proposalId}/regenerate-path`, { params });
  },

  /**
   * 激活路径
   */
  activatePath: async (pathId: string) => {
    return adminAxios.patch(`/admin/debug/learning-paths/${pathId}/activate`);
  },

  // ========== 辅助功能 ==========

  /**
   * 获取最近对话列表
   */
  getRecentConversations: async () => {
    return adminAxios.get('/admin/debug/recent-conversations');
  },

  /**
   * 批量清理
   */
  cleanup: async (keepRecent: number) => {
    return adminAxios.delete('/admin/debug/cleanup', { data: { keepRecent } });
  },

  /**
   * 重新生成方案轮廓
   */
  regenerateOutline: async (snapshotId: string, params?: {
    promptTemplate?: string;
    temperature?: number;
  }) => {
    return adminAxios.post(`/admin/debug/snapshots/${snapshotId}/regenerate-outline`, params);
  },

  // ========== 学生状态追踪 ==========

    

    /**

     * 获取学生状态基线

     */

    getStudentBaseline: async (userId: string) => {

      return adminAxios.get('/admin/platform/student-state', { params: { userId } });

    },

    

  };

  /**
   * Skills 管理 API
   */
  export const adminSkillsApi = {
    /**
     * 获取所有 Skill 列表
     */
    getSkills: async () => {
      return adminAxios.get('/admin/skills');
    },

    /**
     * 按分类统计
     */
    getCategories: async () => {
      return adminAxios.get('/admin/skills/categories');
    },

    /**
     * 获取 Skill 详情
     */
    getSkillDetail: async (name: string) => {
      return adminAxios.get(`/admin/skills/${name}`);
    },

    /**
     * 获取 Skill 数据库统计
     */
    getSkillDbStats: async (name: string) => {
      return adminAxios.get(`/admin/skills/${name}/db-stats`);
    },

    /**
     * 测试执行 Skill
     */
    testSkill: async (name: string, input: any) => {
      return adminAxios.post(`/admin/skills/${name}/test`, input);
    },

    /**
     * 获取使用趋势
     */
    getUsageTrends: async () => {
      return adminAxios.get('/admin/skills/usage/trends');
    },
  };

  // ========== 统一导出 ==========
  
  /**
   * 统一导出对象（兼容旧版代码）
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

    // Learner Models
    ...adminLearnerModelsApi,
    
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
