// Admin 管理 API
import axios from 'axios';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

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

export interface AdvanceTimePreviewResponse {
  dayDiff: number;
  simulatedAsOf: string;
  hasMetricRecord: boolean;
  latestMetricAt?: string;
  before: any;
  after: any | null;
}

export const adminDevtoolsApi = {
  advanceTimePreview: async (data: { days: number; userId?: string; pathId?: string }) => {
    const response = await adminAxios.post('/admin/devtools/advance-time', data);
    return response.data?.data as AdvanceTimePreviewResponse;
  },
  getDebugEvents: async (params?: { limit?: number; userId?: string; types?: string[]; from?: string; to?: string }) => {
    const response = await adminAxios.get('/admin/debug/events', { params });
    return response.data?.data;
  }
};

/**
 * 测试工具 API
 */
export const adminTestApi = {
  replayPath: async (goalConversationId: string, systemPromptOverrides?: { pathAgent?: string }) => {
    const response = await adminAxios.post('/admin/test/replay-path', {
      goalConversationId,
      ...(systemPromptOverrides ? { systemPromptOverrides } : {})
    });
    return response.data;
  },
  getPromptVersions: async (agentId: string) => {
    const response = await adminAxios.get(`/admin/test/agent-prompts/${encodeURIComponent(agentId)}/versions`);
    return response.data;
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

  getProjectionGrant: async (userId: string) => {
    return adminAxios.get('/admin/projection-access-grants', {
      params: {
        userId,
        status: 'active'
      }
    });
  },

  createProjectionTokenFromGrant: async (
    grantId: string,
    data?: { scope?: 'dashboard' | 'full'; entry?: 'dashboard' | 'goal' | 'path' | 'learn' }
  ) => {
    return adminAxios.post(`/admin/projection-access-grants/${grantId}/projection-token`, data || {});
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
   kind?: 'agent' | 'skill' | 'orchestrator' | 'alias';
  aliases?: string[];
  runtimeEnabled?: boolean;
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
    agentFlow?: {
      description?: string;
      steps?: Array<{ agentId: string; action?: string; condition?: string }>;
    };
    promptManagement?: {
      mode: 'agent-prompt' | 'agent-no-direct-prompt' | 'legacy-service';
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

export interface AgentRelationItem {
  agentId: string;
  group: string;
  members: Array<{
    agentId: string;
    name: string;
    role: 'agent' | 'orchestrator';
  }>;
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

export interface PathAgentInputConfig {
  version: string;
  normalizedInput: {
    descriptionSources: string[];
    subjectSources: string[];
    skillLevelSources: string[];
    timePerDaySources: string[];
    deadlineTextSources: string[];
    includeStructuredData: boolean;
    includeConfirmedProposal: boolean;
    includeConfidenceScores: boolean;
    includeConversationHistory: boolean;
  };
}

export interface AgentDataContractSection {
  name: string;
  description: string;
  fields: Array<{
    key: string;
    description: string;
  }>;
}

export interface PathAgentNormalizedInputPreview {
  description: string | null;
  subject: string | null;
  deadlineText: string | null;
  sourceConversationId: string | null;
  existingPathId: string | null;
  skillLevel: string | null;
  timePerDay: string | null;
  structuredData: any;
  confirmedProposal: any;
  confidenceScores: any;
  conversationHistory: Array<{ role: string; content: string }>;
}

export interface PathAgentSupportingEvidencePreview {
  usagePolicy: 'reference_only';
  conversationHistory: Array<{ role: string; content: string }>;
  learnerQA: any[];
  behaviorLog: any[];
  notes: string[];
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

  getAgentRelations: async () => {
    return adminAxios.get<{ data: { agents: AgentRelationItem[] } }>('/admin/agents/relations');
  },

  getOrchestratorRelations: async () => {
    return adminAxios.get<{ data: { agents: OrchestratorRelationItem[]; orchestrators: OrchestratorRelationItem[] } }>(
      '/admin/agents/relations'
    );
  },

  getAgentConfig: async (agentId: string) => {
    return adminAxios.get<{ data: {
      agentId: string;
      config: PathAgentInputConfig;
      defaults: PathAgentInputConfig;
      availableSourcePaths: Record<string, string[]>;
    } }>(`/admin/agents/${encodeURIComponent(agentId)}/config`);
  },

  getAgentDataContract: async (agentId: string) => {
    return adminAxios.get<{ data: {
      agentId: string;
      entryPayload: AgentDataContractSection;
      derivedInput: AgentDataContractSection;
      outputContract: AgentDataContractSection;
    } }>(`/admin/agents/${encodeURIComponent(agentId)}/data-contract`);
  },

  previewAgentConfig: async (agentId: string, sampleGoalFinalPayload: Record<string, any>) => {
    return adminAxios.post<{ data: {
      agentId: string;
      normalizedInput: PathAgentNormalizedInputPreview;
    } }>(`/admin/agents/${encodeURIComponent(agentId)}/config-preview`, {
      sampleGoalFinalPayload
    });
  },

  updateAgentConfig: async (agentId: string, config: PathAgentInputConfig) => {
    return adminAxios.put<{ data: { agentId: string; config: PathAgentInputConfig } }>(
      `/admin/agents/${encodeURIComponent(agentId)}/config`,
      config
    );
  },

  getOrchestratorConfig: async (agentId: string) => {
    return adminAxios.get<{ data: {
      agentId: string;
      config: PathAgentInputConfig;
      defaults: PathAgentInputConfig;
      availableSourcePaths: Record<string, string[]>;
    } }>(`/admin/agents/${encodeURIComponent(agentId)}/config`);
  },

  getOrchestratorDataContract: async (agentId: string) => {
    return adminAxios.get<{ data: {
      agentId: string;
      entryPayload: AgentDataContractSection;
      derivedInput: AgentDataContractSection;
      outputContract: AgentDataContractSection;
    } }>(`/admin/agents/${encodeURIComponent(agentId)}/data-contract`);
  },

  previewOrchestratorConfig: async (agentId: string, sampleGoalFinalPayload: Record<string, any>) => {
    return adminAxios.post<{ data: {
      agentId: string;
      normalizedInput: PathAgentNormalizedInputPreview;
    } }>(`/admin/agents/${encodeURIComponent(agentId)}/config-preview`, {
      sampleGoalFinalPayload
    });
  },

  updateOrchestratorConfig: async (agentId: string, config: PathAgentInputConfig) => {
    return adminAxios.put<{ data: { agentId: string; config: PathAgentInputConfig } }>(
      `/admin/agents/${encodeURIComponent(agentId)}/config`,
      config
    );
  },

getManifestDiagnostics: async () => {
    return adminAxios.get<{ data: ManifestDiagnosticsData }>('/admin/manifest/diagnostics');
  },

  testAgent: async (agentId: string, input: any, context?: any) => {
    return adminAxios.post<{ success: boolean; data: { agentName: string; agentType: string; input: any; output: any; duration: number } }>(
      `/admin/agent-lab/agents/${encodeURIComponent(agentId)}/test`,
      { input, context }
    );
  },
};

export const adminRuntimeDefinitionsApi = {
  getAgentDefinitions: async () => {
    return adminAxios.get('/admin/runtime-definitions/agents');
  },

  getAgentDefinitionDetail: async (id: string) => {
    return adminAxios.get(`/admin/runtime-definitions/agents/${encodeURIComponent(id)}`);
  },

  getOrchestratorDefinitions: async () => {
    return adminAxios.get('/admin/runtime-definitions/orchestrators');
  },

  getOrchestratorDefinitionDetail: async (id: string) => {
    return adminAxios.get(`/admin/runtime-definitions/orchestrators/${encodeURIComponent(id)}`);
  },

  getPromptCallLogs: async (params?: {
    limit?: number;
    agentId?: string;
    pathId?: string;
    pipelineRunId?: string;
    traceId?: string;
    parentExecutionId?: string;
  }) => {
    return adminAxios.get('/admin/runtime-definitions/prompt-call-logs', { params });
  },

  getPathGenerationEvents: async (params?: {
    limit?: number;
    pathId?: string;
    traceId?: string;
    status?: string;
    phase?: string;
  }) => {
    return adminAxios.get('/admin/flow-events/path-generation', { params });
  },
};

// ============================================================
// V3 字段路由（AGENT_IO_DESIGN_V3 §3）
// ============================================================
export interface FieldRoutingPatch {
  render?: 'visible' | 'hidden';
  handoff?: string[];
  internal?: boolean;
  accumulate?: boolean;
  notes?: string;
  reason?: string;
}

export interface CreateFieldPayload {
  fieldId: string;
  stage: string;
  promptRole: 'soft-info' | 'hidden-inference' | 'derived-presentation';
  valueType?: string;
  snakeName?: string;
  camelName?: string;
  description?: string;
  enumValues?: string[];
  bindings?: Record<string, unknown>;
  reason?: string;
}

export const adminFieldRoutingsApi = {
  getStages: async () => adminAxios.get('/admin/field-routings/stages'),
  getStageDetail: async (stage: string) =>
    adminAxios.get(`/admin/field-routings/stages/${encodeURIComponent(stage)}`),
  createField: async (payload: CreateFieldPayload) =>
    adminAxios.post('/admin/field-routings/fields', payload),
  patchRouting: async (agentId: string, fieldId: string, patch: FieldRoutingPatch) =>
    adminAxios.patch(
      `/admin/field-routings/routings/${encodeURIComponent(agentId)}/${encodeURIComponent(fieldId)}`,
      patch
    ),
  getChanges: async (params?: { fieldId?: string; agentId?: string; limit?: number }) =>
    adminAxios.get('/admin/field-routings/changes', { params }),
};

/**
 * Skill 工作台综合元数据 API
 * 一次拉回：skill manifest + 隶属 Agent + 模型配置 + prompt 版本 + 字段契约 + 调用统计
 */
export const adminSkillWorkbenchApi = {
  getMeta: async (skillId: string) => {
    const canonicalSkillId = skillId.startsWith('skill:') ? skillId : `skill:${skillId}`;
    return adminAxios.get(`/admin/skills/${encodeURIComponent(canonicalSkillId)}/workbench-meta`);
  },
};

/**
 * Agent 拓扑可视化 API
 * 返回 5 Agent + 22 Skill 的节点图数据（含调用统计 + 隶属边）
 */
export const adminAgentTopologyApi = {
  getTopology: async (range: '24h' | '7d' | '30d' = '7d') =>
    adminAxios.get('/admin/agents/topology', { params: { range } }),
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
  },

  testModel: async (data: {
    apiUrl?: string;
    apiKey?: string;
    model: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }) => {
    return adminAxios.post('/admin/api-config/test-model', data);
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

  /**
   * 对比两个 Prompt 版本
   */
  comparePrompts: async (a: string, b: string) => {
    return adminAxios.get('/admin/agent-prompts/compare', { params: { a, b } });
  },
};

/**
 * Skill 模型配置 API
 */
export const adminSkillsApi = {
  getSkills: async () => {
    return adminAxios.get('/admin/skills');
  },

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

  testSkill: async (skillId: string, input: any) => {
    return adminAxios.post(`/admin/skills/${encodeURIComponent(skillId)}/test`, input);
  },

  getEffectiveSkillPrompt: async (skillId: string) => {
    return adminAxios.get(`/admin/skills/${encodeURIComponent(skillId)}/effective-prompt`);
  },

  getAgentRelations: async () => {
    return adminAxios.get('/admin/skills/agent-relations');
  },
};

export const adminVirtualLearnersApi = {
  generatePersona: async (data?: {
    preferredLevels?: string[];
    candidatePersonas?: string[];
    existingPersonaSeed?: Record<string, any>;
  }) => {
    return adminAxios.post('/admin/virtual-learners/generate-persona', data || {});
  },

  generateScenario: async (data?: {
    preferredDomains?: string[];
    preferredGoalTypes?: string[];
    preferredLevels?: string[];
    preferredMotivations?: string[];
    avoidDomains?: string[];
  }) => {
    return adminAxios.post('/admin/virtual-learners/generate-scenario', data || {});
  },

  generateProfile: async (data: {
    learningGoal: string;
    knowledgeLevel: string;
    simulationMode?: string;
    personalityTraits?: {
      verbosity?: string;
      enthusiasm?: string;
      confusionStyle?: string;
    };
  }) => {
    return adminAxios.post('/admin/virtual-learners/generate-profile', data);
  },

  getVirtualLearners: async (params?: { page?: number; limit?: number }) => {
    return adminAxios.get('/admin/virtual-learners', { params });
  },

  getVirtualLearner: async (id: string) => {
    return adminAxios.get(`/admin/virtual-learners/${id}`);
  },

  getVirtualLearnerStories: async (id: string) => {
    return adminAxios.get(`/admin/virtual-learners/${id}/stories`);
  },

  getVirtualLearnerTestProjection: async (id: string) => {
    return adminAxios.get(`/admin/virtual-learners/${id}/test-projection`);
  },

  createProjectionToken: async (id: string, data?: { storyId?: string; virtualSessionId?: string; scope?: 'dashboard' | 'full' }) => {
    return adminAxios.post(`/admin/virtual-learners/${id}/projection-token`, data || {});
  },

  resolveProjectionToken: async (token: string) => {
    return adminAxios.post('/admin/virtual-learners/projection/resolve', { token });
  },

  draftVirtualLearnerProfile: async (id: string) => {
    return adminAxios.post(`/admin/virtual-learners/${id}/draft-profile`);
  },

draftVirtualLearnerStories: async (id: string) => {
    return adminAxios.post(`/admin/virtual-learners/${id}/draft-stories`);
  },

  updateStoryStatus: async (
    profileId: string,
    storyIndex: number,
    payload: {
      status?: string;
      title?: string;
      storyOutline?: string;
      storyTriggerEvent?: string;
      visibleOpening?: string;
      pressurePoints?: string[];
    }
  ) => {
    return adminAxios.put(`/admin/virtual-learners/${profileId}/stories/${storyIndex}`, payload);
  },

  deleteStory: async (profileId: string, storyIndex: number) => {
    return adminAxios.delete(`/admin/virtual-learners/${profileId}/stories/${storyIndex}`);
  },

  createVirtualLearner: async (data: {
    name: string;
    learningGoal?: string;
    knowledgeLevel?: string;
    profile?: {
      age?: number;
      occupation?: string;
      education?: string;
      background?: string;
      corePersonality?: string;
      emotionalBaseline?: string;
      helpSeekingPattern?: string;
      adversarialPattern?: string;
      metacognitiveProfile?: string;
      cognitiveLoadTolerance?: string;
      memoryRepairPattern?: string;
    };
    simulationMode?: string;
    simulationTemperature?: number;
    personalityTraits?: {
      verbosity?: string;
      enthusiasm?: string;
      confusionStyle?: string;
    };
    notes?: string;
  }) => {
    return adminAxios.post('/admin/virtual-learners', data);
  },

  updateVirtualLearner: async (id: string, data: any) => {
    return adminAxios.put(`/admin/virtual-learners/${id}`, data);
  },

  deleteVirtualLearner: async (id: string) => {
    return adminAxios.delete(`/admin/virtual-learners/${id}`);
  },

  startVirtualSession: async (profileId: string, data?: {
    storyId?: string;
    storyIndex?: number;
    frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test';
  }) => {
    return adminAxios.post(`/admin/virtual-learners/${profileId}/start-session`, data || {});
  },

  startBlackboxVirtualSession: async (profileId: string, data?: {
    storyId?: string;
    storyIndex?: number;
    frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test';
  }) => {
    return adminAxios.post(`/admin/virtual-learners/${profileId}/start-blackbox-session`, data || {});
  },

  getVirtualSession: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}`);
  },

  getVirtualSessionContext: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/context`);
  },

  getVirtualSessionGoalConversation: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/goal-conversation`);
  },

  getVirtualSessionLearningPath: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/learning-path`);
  },

  getVirtualSessionLearningTask: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/learning-task`);
  },

  getVirtualSessionTeachingDetail: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/teaching-detail`);
  },

  virtualSessionStep: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/step`);
  },

  blackboxVirtualSessionStep: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-step`);
  },

  executeBlackboxVirtualAction: async (sessionId: string, action: any) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-action`, action);
  },

  observeBlackboxVirtualSession: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-observe`);
  },

  getBlackboxVirtualSnapshot: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/blackbox-snapshot`);
  },

  generateBlackboxRefereeReport: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-referee`);
  },

  virtualSessionAuto: async (sessionId: string, data?: { maxRounds?: number }) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/auto`, data);
  },

  virtualSessionAdvancePath: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/advance-path`);
  },

  reviewVirtualSessionPath: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/review-path`);
  },

  getVirtualSessionPathStatus: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/path-status`);
  },

  startVirtualLearning: async (sessionId: string, data?: { taskId?: string }) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/start-learning`, data);
  },

  virtualSessionLearningStep: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/learning-step`);
  },

  virtualSessionAutoLearning: async (sessionId: string, data?: { maxMilestones?: number }) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/auto-learning`, data);
  },

  virtualSessionRunFull: async (
    sessionId: string,
    data?: {
      maxRounds?: number;
      maxMilestones?: number;
      continueOnTaskComplete?: boolean;
      autoAdvanceToPath?: boolean;
      autoAdvanceToLearning?: boolean;
    }
  ) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/run-full`, data);
  },

  virtualSessionWrapup: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/wrapup`);
  },

  updateSessionSimulationConfig: async (
    sessionId: string,
    data: { frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test' }
  ) => {
    return adminAxios.put(`/admin/virtual-learners/sessions/${sessionId}/simulation-config`, data);
  },

  restartVirtualSessionPath: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/restart-path`);
  },

  restartVirtualLearning: async (sessionId: string, data?: { taskId?: string }) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/restart-learning`, data);
  },

  stopVirtualLearning: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/stop-learning`);
  },

  getVirtualSessionLogs: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/logs`);
  },

  deleteVirtualSession: async (sessionId: string) => {
    return adminAxios.delete(`/admin/virtual-learners/sessions/${sessionId}`);
  },

  regressionRun: async (profileId: string, data?: {
    storyId?: string;
    storyIndex?: number;
    systemPromptOverrides?: { goalAgent?: string; pathAgent?: string };
    maxGoalRounds?: number;
  }) => {
    return adminAxios.post(`/admin/virtual-learners/${profileId}/regression-run`, data);
  },

  compareSessions: async (sessionA: string, sessionB: string) => {
    return adminAxios.get('/admin/virtual-learners/regression/compare-sessions', {
      params: { sessionA, sessionB }
    });
  },
};

// ============================================================
// V3.6 · Prompt 运营开发与评估中心
// ============================================================
export const adminPromptOpsApi = {
  getAgentOverview: async () => {
    return adminAxios.get('/admin/prompt-ops/agent-overview');
  },

  getProtocolView: async () => {
    return adminAxios.get('/admin/prompt-ops/protocol-view');
  },

  listEvalCases: async (agentId?: string) => {
    return adminAxios.get('/admin/prompt-ops/eval-cases', {
      params: agentId ? { agentId } : {}
    });
  },

  createEvalCase: async (payload: {
    agentId: string;
    caseId?: string;
    name: string;
    description?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    previousState?: any;
    expectations?: {
      mustIncludeFields?: string[];
      mustNotInclude?: string[];
      expectedStage?: string;
      notes?: string;
    };
    enabled?: boolean;
  }) => {
    return adminAxios.post('/admin/prompt-ops/eval-cases', payload);
  },

  updateEvalCase: async (id: string, payload: any) => {
    return adminAxios.put(`/admin/prompt-ops/eval-cases/${id}`, payload);
  },

  deleteEvalCase: async (id: string) => {
    return adminAxios.delete(`/admin/prompt-ops/eval-cases/${id}`);
  },

  runEval: async (payload: {
    agentId: string;
    promptVersionId?: string | null;
    promptVersion?: number | null;
    customPrompt?: string;
    model?: string;
    repeatCount?: number;
    caseIds?: string[];
    adhocCases?: any[];
  }) => {
    return adminAxios.post('/admin/prompt-ops/run-eval', payload);
  },

  listEvalRuns: async (agentId?: string, limit = 20) => {
    return adminAxios.get('/admin/prompt-ops/eval-runs', {
      params: { ...(agentId ? { agentId } : {}), limit }
    });
  },

  getEvalRun: async (id: string) => {
    return adminAxios.get(`/admin/prompt-ops/eval-runs/${id}`);
  },

  getAgentFields: async (agentId: string) => {
    return adminAxios.get(`/admin/prompt-ops/agent-fields/${encodeURIComponent(agentId)}`);
  },

  getRecentCallSamples: async (agentId: string, limit = 20) => {
    return adminAxios.get('/admin/prompt-ops/recent-call-samples', {
      params: { agentId, limit }
    });
  },

  getPromptSchema: async (agentId: string) => {
    return adminAxios.get(`/admin/prompt-ops/prompt-schema/${encodeURIComponent(agentId)}`);
  },

  getSkillRulesOverview: async () => {
    return adminAxios.get('/admin/prompt-ops/skill-rules-overview');
  },

  // P-PROMPT-COMPILE: 编译产物预览 + 重编译
  getPromptCompileInfo: async (agentId: string) => {
    return adminAxios.get(`/admin/prompt-ops/${encodeURIComponent(agentId)}/compile-info`);
  },

  recompilePrompt: async (agentId: string) => {
    return adminAxios.post(`/admin/prompt-ops/${encodeURIComponent(agentId)}/recompile`);
  },

  // P-PROMPT-COMPILE: 保存源 + 自动编译 + 失效缓存 (一键 编辑→编译)
  savePromptSource: async (agentId: string, payload: { systemPrompt: string; autoCompile?: boolean }) => {
    return adminAxios.put(`/admin/prompt-ops/${encodeURIComponent(agentId)}/source`, payload);
  },

  // P-PROMPT-COMPILE: skill 目录 (agent.skill.字段 三级树, 用于可视化字段选择器)
  getSkillCatalog: async () => {
    return adminAxios.get('/admin/prompt-ops/skill-catalog');
  },

  // P-PROMPT-COMPILE: GUI 字段表 (input + output) 读写
  getPromptFields: async (agentId: string) => {
    return adminAxios.get(`/admin/prompt-ops/${encodeURIComponent(agentId)}/fields`);
  },

  updatePromptFields: async (
    agentId: string,
    payload: {
      inputFields?: any[];
      outputFields?: any[];
      autoCompile?: boolean;
    }
  ) => {
    return adminAxios.put(`/admin/prompt-ops/${encodeURIComponent(agentId)}/fields`, payload);
  }
};

// ============================================================
// V3.7 · Prompt Lab API（源文件编辑 / LLM 编译 / 发布）
// ============================================================
export const adminPromptLabApi = {
  getCompileSpec: async () => {
    return adminAxios.get('/admin/prompt-lab/compile-spec');
  },

  getSources: async () => {
    return adminAxios.get('/admin/prompt-lab/sources');
  },

  getSource: async (skillId: string) => {
    return adminAxios.get(`/admin/prompt-lab/source/${encodeURIComponent(skillId)}`);
  },

  saveSource: async (skillId: string, content: string) => {
    return adminAxios.put(`/admin/prompt-lab/source/${encodeURIComponent(skillId)}`, { content });
  },

  getManifest: async (skillId: string) => {
    return adminAxios.get(`/admin/prompt-lab/manifest/${encodeURIComponent(skillId)}`);
  },

  saveManifest: async (skillId: string, manifest: any) => {
    return adminAxios.put(`/admin/prompt-lab/manifest/${encodeURIComponent(skillId)}`, { manifest });
  },

  getParams: async (skillId: string) => {
    return adminAxios.get(`/admin/prompt-lab/params/${encodeURIComponent(skillId)}`);
  },

  compileSource: async (payload: { skillId: string }) => {
    return adminAxios.post('/admin/prompt-lab/compile-source', payload);
  },

  publish: async (payload: { skillId: string; prompt: string; params: any }) => {
    return adminAxios.post('/admin/prompt-lab/publish', payload);
  },

  createSourceFile: async (skillId: string) => {
    return adminAxios.post(`/admin/prompt-lab/source/${encodeURIComponent(skillId)}/create`);
  }
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
  
  // Skill Model Configs
  ...adminSkillsApi,

  // Virtual Learners
  ...adminVirtualLearnersApi,

  // PromptOps
  ...adminPromptOpsApi,

  // PromptLab
  ...adminPromptLabApi,

  // Test Tools
  ...adminTestApi,

  // Devtools
  ...adminDevtoolsApi,
};
