// Admin 管理 API
import axios from 'axios';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

/**
 * 获取认证 Token
 */
function getAuthToken(): string | null {
  return localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
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
    sessionStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    sessionStorage.removeItem('admin_user');
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
  getUsers: async (params?: { page?: number; limit?: number; search?: string; role?: string }) => {
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
    orchestratorFlow?: {
      description?: string;
      steps?: Array<{ agentId: string; action?: string; condition?: string }>;
    };
    promptManagement?: {
      mode: 'agent-prompt' | 'orchestrator-no-direct-prompt' | 'legacy-service';
      note: string | null;
    };
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
  };
  outputContracts?: {
    agentCallLogs: {
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

  seedCorePrompts: async () => {
    return adminAxios.post('/admin/agent-prompts/seed-core');
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

export interface PromptStabilityEvalResult {
  caseId: string;
  caseName: string;
  runIndex: number;
  durationMs: number;
  input: {
    userInput: string;
    conversationContextCount: number;
    previousState: Record<string, any>;
  };
  output: {
    userVisible: string;
    stage: string;
    confidence: number;
    nextQuestions: string[];
    quickReplies: Array<{ text?: string; icon?: string } | string>;
  };
  debug: {
    promptVersion: number;
    attemptCount: number;
    actualRetryCount: number;
    formatFailureCount: number;
    parseMode: string;
    failureType: string;
    violations: string[];
    structuredOutputValid: boolean;
    attempts: Array<{
      attemptIndex: number;
      parseMode: string;
      structuredOutputValid: boolean;
      failureType?: string;
      violations?: string[];
      rawContent: string;
    }>;
  };
  checks: {
    singleQuestionRule: boolean;
    stageValid: boolean;
    nextQuestionsSingle: boolean;
    noWrappedUserVisibleJson: boolean;
  };
}

export interface PromptStabilityEvalResponse {
  data: {
    config: {
      agentId: string;
      promptSource: string;
      promptVersion: number;
      model: string | null;
      repeatCount: number;
      caseCount: number;
      totalRuns: number;
    };
    summary: {
      structuredSuccessRate: number;
      proposingRate: number;
      checkerPassRate: number;
      avgAttemptCount: number;
      failureCount: number;
      parseModeDistribution: Record<string, number>;
      failureTypeDistribution: Record<string, number>;
    };
    results: PromptStabilityEvalResult[];
  };
}

export const adminPromptStabilityApi = {
  run: async (data: {
    agentId: string;
    promptVersionId?: string;
    promptVersion?: number;
    customPrompt?: string;
    model?: string;
    repeatCount?: number;
    cases: Array<{
      id?: string;
      name?: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      previousState?: Record<string, any> | null;
    }>;
  }) => {
    return adminAxios.post<PromptStabilityEvalResponse>('/admin/prompt-stability/run', data);
  }
};

/**
 * Skill 模型配置 API
 */
export const adminSkillsApi = {
  getSkillModelConfigs: async () => {
    return adminAxios.get('/admin/skill-model-configs');
  },

  getSkillModelConfig: async (skillId: string) => {
    return adminAxios.get(`/admin/skill-model-configs/${skillId}`);
  },

  updateSkillModelConfig: async (skillId: string, data: any) => {
    return adminAxios.put(`/admin/skill-model-configs/${skillId}`, data);
  },

  deleteSkillModelConfig: async (skillId: string) => {
    return adminAxios.delete(`/admin/skill-model-configs/${skillId}`);
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

  // Learner Models
  ...adminLearnerModelsApi,
  
  // Agents
  ...adminAgentsApi,
  
  // Agent Prompts
  ...adminAgentPromptsApi,

  // Prompt Stability
  ...adminPromptStabilityApi,
  
  // Skill Model Configs
  ...adminSkillsApi,
};
