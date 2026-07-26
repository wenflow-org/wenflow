// Admin 管理 API
import axios from 'axios';
import { setAuthFlashMessage } from '@/utils/authFlash';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ADMIN_SESSION_REQUEST_TIMEOUT_MS = 10000;

/**
 * 管理员会话标记：token 已通过 HttpOnly Cookie 下发，JS 侧只记录"已登录"标记（非敏感）
 * 旧的 admin_token 为历史遗留，读取处保留兼容
 */
export const ADMIN_SESSION_KEY = 'wenflow_admin_session';
export const ADMIN_SESSION_CLEAR_EVENT_KEY = 'wenflow_admin_session_cleared';

const adminSessionTabId = createCommandId();

function isProtectedAdminPathname(pathname: string): boolean {
  const normalizedPath = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (normalizedPath !== '/admin' && !normalizedPath.startsWith('/admin/')) return false;

  return normalizedPath !== '/admin/login'
    && normalizedPath !== '/admin/test'
    && !normalizedPath.startsWith('/admin/test/');
}

let adminProtectedLocationResolver = () => isProtectedAdminPathname(window.location.pathname);

export function setAdminProtectedLocationResolver(resolver: () => boolean): void {
  adminProtectedLocationResolver = resolver;
}

export function isAdminSessionClearBroadcast(value: string | null): boolean {
  if (!value) return false;

  try {
    return JSON.parse(value).source !== adminSessionTabId;
  } catch {
    return true;
  }
}

export const hasAdminSession = (): boolean =>
  localStorage.getItem(ADMIN_SESSION_KEY) === '1'
  || sessionStorage.getItem(ADMIN_SESSION_KEY) === '1'
  || !!getAuthToken();

/**
 * 获取认证 Token（仅兼容历史遗留的 localStorage 存储；新登录走 HttpOnly Cookie）
 */
function getAuthToken(): string | null {
  return localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
}

function createCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function blackboxCommandConfig(expectedTraceCount: number) {
  return {
    headers: {
      'Idempotency-Key': createCommandId(),
      'X-Expected-Trace-Count': String(expectedTraceCount)
    }
  };
}

/**
 * 创建 axios 实例
 */
const adminAxios = axios.create({
  baseURL: API_BASE,
  timeout: 240000, // 4分钟超时
  withCredentials: true,
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

let unauthorizedRedirect: Promise<void> | null = null;

function isAdminLogoutRequest(url?: string): boolean {
  return url === '/admin-auth/logout';
}

/** 清除失效会话并跳转登录页；重复调用只执行一次，避免重复广播。 */
export function handleAdminAuthenticationFailure(): void {
  if (unauthorizedRedirect) return;

  unauthorizedRedirect = Promise.resolve().then(() => {
    try {
      clearAdminSession();
    } catch (error) {
      console.error('[admin-session-clear-error]', error);
    }
    setAuthFlashMessage('管理员登录状态已失效，请重新登录');
    // 保留回跳地址，重新登录后可返回原页面
    const redirect = encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    );
    window.location.replace(`/admin/login?redirect=${redirect}`);
  });
}

adminAxios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401
      && adminProtectedLocationResolver()
      && !isAdminLogoutRequest(error.config?.url)
    ) {
      handleAdminAuthenticationFailure();
    }
    return Promise.reject(error);
  }
);

// 导出 axios 实例供其他模块使用
export { adminAxios };

/** 清除管理员会话的所有本地标记，并默认通知其他标签页 */
export function clearAdminSession(notifyOtherTabs = true): void {
  localStorage.removeItem('admin_token');
  sessionStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  sessionStorage.removeItem('admin_user');
  localStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_SESSION_KEY);

  if (notifyOtherTabs) {
    try {
      localStorage.setItem(ADMIN_SESSION_CLEAR_EVENT_KEY, JSON.stringify({
        source: adminSessionTabId,
        nonce: createCommandId()
      }));
    } catch (error) {
      console.error('[admin-session-clear-broadcast-error]', error);
    }
  }
}

/** 记录管理员会话标记（remember 决定存 localStorage 还是 sessionStorage） */
export function markAdminSession(remember: boolean): void {
  // 新登录必须清除旧 Bearer Token，否则请求拦截器会优先发送失效 Token 并遮蔽新 Cookie。
  localStorage.removeItem('admin_token');
  sessionStorage.removeItem('admin_token');
  localStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(ADMIN_SESSION_KEY, '1');
}

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
   * 获取当前管理员信息；会话校验使用短超时，避免 BFCache 恢复时长时间隐藏页面
   */
  getMe: async () => {
    return adminAxios.get('/admin-auth/me', { timeout: ADMIN_SESSION_REQUEST_TIMEOUT_MS });
  },

  /**
   * 登出：以后端成功清除 HttpOnly Cookie 为准，确认后才清除并广播本地会话
   */
  logout: async (): Promise<void> => {
    const response = await adminAxios.post(
      '/admin-auth/logout',
      undefined,
      { timeout: ADMIN_SESSION_REQUEST_TIMEOUT_MS }
    );
    if (response.data?.success !== true) {
      throw new Error('管理员登出未获得服务端确认');
    }
    clearAdminSession();
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
  users: async (params?: Record<string, unknown>) => {
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
  },

  getReliabilitySettings: async () => {
    return adminAxios.get('/admin/settings/reliability');
  },

  updateReliabilitySettings: async (data: {
    maxUpstreamAttempts: number;
    maxTransportRetries: number;
    maxLogicalRetries: number;
    defaultRequestTimeoutMs: number;
    retryBaseDelayMs: number;
    maxRetryAfterMs: number;
    jitterEnabled: boolean;
  }) => {
    return adminAxios.put('/admin/settings/reliability', data);
  }
};

export interface AdvanceTimePreviewResponse {
  dayDiff: number;
  simulatedAsOf: string;
  hasMetricRecord: boolean;
  latestMetricAt?: string;
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
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
    onlyMissingWrapup?: boolean;
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
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
  };
  samples: {
    agentCallLogs: Array<{
      id: string;
      calledAt: string;
      success: boolean;
      durationMs: number;
      error: string | null;
      input: unknown;
      output: unknown;
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
  structuredData: Record<string, unknown> | null;
  confirmedProposal: Record<string, unknown> | null;
  confidenceScores: Record<string, unknown> | null;
  conversationHistory: Array<{ role: string; content: string }>;
}

export interface PathAgentSupportingEvidencePreview {
  usagePolicy: 'reference_only';
  conversationHistory: Array<{ role: string; content: string }>;
  learnerQA: Array<Record<string, unknown>>;
  behaviorLog: Array<Record<string, unknown>>;
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
    sourceEntry?: string;
    startTime?: string;
    endTime?: string;
  }) => {
    return adminAxios.get('/admin/agents/logs', { params });
  },

  getLogDetail: async (id: string) => {
    return adminAxios.get(`/admin/agents/logs/${encodeURIComponent(id)}`);
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

  previewAgentConfig: async (agentId: string, sampleGoalFinalPayload: Record<string, unknown>) => {
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

  previewOrchestratorConfig: async (agentId: string, sampleGoalFinalPayload: Record<string, unknown>) => {
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

  testAgent: async (agentId: string, input: unknown, context?: unknown) => {
    return adminAxios.post<{ success: boolean; data: { agentName: string; agentType: string; input: unknown; output: unknown; duration: number } }>(
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
    status?: 'success' | 'error' | 'drift';
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
  getTopology: async (range: '24h' | '7d' | '30d' | 'all' = '7d') =>
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
  },

  updateNetworkPolicy: async (data: {
    adminAccessMode: 'loopback' | 'private' | 'any';
    adminAllowedIps: string[];
    allowPrivateNetwork: boolean;
    privateNetworkHosts: string[];
  }) => {
    return adminAxios.put('/admin/api-config/network-policy', data);
  }
};

/**
 * AI 能力探测设置（开关 + 间隔；默认关闭）
 */
export const adminCapabilityProbeApi = {
  getSettings: async () => {
    return adminAxios.get('/admin/settings/capability-probe');
  },
  updateSettings: async (payload: { enabled?: boolean; intervalMs?: number }) => {
    return adminAxios.put('/admin/settings/capability-probe', payload);
  }
};

/**
 * AI 能力健康快照（5 个核心能力 + 主动探测）
 */
export const adminSystemApi = {
  getCapabilities: async () => {
    return adminAxios.get('/admin/system/capabilities');
  },
  probeCapabilities: async () => {
    return adminAxios.post('/admin/system/capabilities/probe');
  }
};

/**
 * 用户反馈中心（前台教学反馈的收集与处理）
 */
export const adminFeedbackApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    maxRating?: number;
    status?: 'new' | 'triaged' | 'resolved' | 'dismissed';
    userId?: string;
    taskId?: string;
  }) => {
    return adminAxios.get('/admin/feedback', { params });
  },
  getDetail: async (feedbackId: string) => {
    return adminAxios.get(`/admin/feedback/${encodeURIComponent(feedbackId)}`);
  },
  update: async (
    feedbackId: string,
    payload: {
      status?: 'new' | 'triaged' | 'resolved' | 'dismissed';
      assigneeAdminId?: string | null;
      internalNote?: string | null;
    }
  ) => {
    return adminAxios.patch(`/admin/feedback/${encodeURIComponent(feedbackId)}`, payload);
  },
  getTrend: async (days = 30) => {
    return adminAxios.get('/admin/feedback/trend', { params: { days } });
  }
};

/**
 * Goal 会话管理（目标对话 → 路径生成源头）
 */
export const adminGoalConversationsApi = {
  list: async (params?: { page?: number; limit?: number; status?: string; userId?: string }) => {
    return adminAxios.get('/admin/goal-conversations', { params });
  },
  getDetail: async (id: string) => {
    return adminAxios.get(`/admin/goal-conversations/${encodeURIComponent(id)}`);
  },
  update: async (id: string, payload: { status?: string; collectedData?: string }) => {
    return adminAxios.patch(`/admin/goal-conversations/${encodeURIComponent(id)}`, payload);
  },
  remove: async (id: string) => {
    return adminAxios.delete(`/admin/goal-conversations/${encodeURIComponent(id)}`);
  },
  regeneratePath: async (id: string) => {
    return adminAxios.post(`/admin/goal-conversations/${encodeURIComponent(id)}/regenerate-path`);
  },
  getStats: async () => {
    return adminAxios.get('/admin/goal-conversations/stats/overview');
  }
};

/**
 * 平台公告管理
 */
export const adminAnnouncementsApi = {
  list: async () => {
    return adminAxios.get('/admin/announcements');
  },
  create: async (data: Record<string, unknown>) => {
    return adminAxios.post('/admin/announcements', data);
  },
  publish: async (id: string) => {
    return adminAxios.put(`/admin/announcements/${encodeURIComponent(id)}/publish`);
  },
  archive: async (id: string) => {
    return adminAxios.put(`/admin/announcements/${encodeURIComponent(id)}/archive`);
  },
  remove: async (id: string) => {
    return adminAxios.delete(`/admin/announcements/${encodeURIComponent(id)}`);
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
  updatePrompt: async (id: string, data: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }) => {
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

  updateSkillModelConfig: async (skillId: string, data: {
    tier?: string;
    model?: string | null;
    thinkingMode?: string;
    reasoningEffort?: string;
    /** @deprecated 生成参数已收敛到 ACTIVE Prompt，后端会忽略 */
    temperature?: number;
    /** @deprecated 生成参数已收敛到 ACTIVE Prompt，后端会忽略 */
    maxTokens?: number;
    requestTimeoutMs?: number | null;
    maxLogicalRetries?: number | null;
    enabled?: boolean;
  }) => {
    // Phase 2：不提交 temperature/maxTokens，避免旧调用方误写
    const {
      temperature: _t,
      maxTokens: _m,
      ...routingOnly
    } = data;
    return adminAxios.put(`/admin/skill-model-configs/${skillId}`, routingOnly);
  },

  deleteSkillModelConfig: async (skillId: string) => {
    return adminAxios.delete(`/admin/skill-model-configs/${skillId}`);
  },

  testSkill: async (skillId: string, input: unknown) => {
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
    existingPersonaSeed?: Record<string, unknown>;
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

  updateVirtualLearner: async (id: string, data: Record<string, unknown>) => {
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

  blackboxVirtualSessionStep: async (sessionId: string, expectedTraceCount: number) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-step`, {}, blackboxCommandConfig(expectedTraceCount));
  },

  executeBlackboxVirtualAction: async (sessionId: string, action: Record<string, unknown>, expectedTraceCount: number) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-action`, action, blackboxCommandConfig(expectedTraceCount));
  },

  observeBlackboxVirtualSession: async (sessionId: string, expectedTraceCount: number) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-observe`, {}, blackboxCommandConfig(expectedTraceCount));
  },

  getBlackboxVirtualSnapshot: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/blackbox-snapshot`);
  },

  generateBlackboxRefereeReport: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-referee`);
  },

  generateBlackboxEvaluations: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-evaluations`);
  },

  rerunBlackboxVirtualSession: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-rerun`, {});
  },

  cloneQuickLearnFixture: async (profileId: string, data: { sourcePathId: string; titlePrefix?: string }) => {
    return adminAxios.post(`/admin/virtual-learners/${profileId}/quick-learn/fixtures`, data);
  },

  getQuickLearnTasks: async (profileId: string) => {
    return adminAxios.get(`/admin/virtual-learners/${profileId}/quick-learn/tasks`);
  },

  startQuickLearnRun: async (profileId: string, data: { taskId: string; maxTurns?: number }) => {
    return adminAxios.post(`/admin/virtual-learners/${profileId}/quick-learn/runs`, data);
  },

  getQuickLearnRuns: async (profileId: string, params?: { page?: number; pageSize?: number }) => {
    return adminAxios.get(`/admin/virtual-learners/${profileId}/quick-learn/runs`, { params });
  },

  getQuickLearnRun: async (runId: string) => {
    return adminAxios.get(`/admin/virtual-learners/quick-learn/runs/${runId}`);
  },

  abortQuickLearnRun: async (runId: string) => {
    return adminAxios.post(`/admin/virtual-learners/quick-learn/runs/${runId}/abort`, {});
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
export interface EvalCaseExpectations {
  mustIncludeFields?: string[];
  mustNotInclude?: string[];
  expectedStage?: string;
  notes?: string;
}

export interface CreateEvalCasePayload {
  agentId: string;
  caseId?: string;
  name: string;
  description?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  previousState?: Record<string, unknown>;
  expectations?: EvalCaseExpectations;
  enabled?: boolean;
}

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

  createEvalCase: async (payload: CreateEvalCasePayload) => {
    return adminAxios.post('/admin/prompt-ops/eval-cases', payload);
  },

  updateEvalCase: async (id: string, payload: Partial<CreateEvalCasePayload>) => {
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
    adhocCases?: Array<Record<string, unknown>>;
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
      inputFields?: Array<Record<string, unknown>>;
      outputFields?: Array<Record<string, unknown>>;
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

  saveManifest: async (skillId: string, manifest: Record<string, unknown>) => {
    return adminAxios.put(`/admin/prompt-lab/manifest/${encodeURIComponent(skillId)}`, { manifest });
  },

  getParams: async (skillId: string) => {
    return adminAxios.get(`/admin/prompt-lab/params/${encodeURIComponent(skillId)}`);
  },

  compileSource: async (payload: { skillId: string }) => {
    return adminAxios.post('/admin/prompt-lab/compile-source', payload);
  },

  publish: async (payload: { skillId: string; prompt: string; params: Record<string, unknown> }) => {
    return adminAxios.post('/admin/prompt-lab/publish', payload);
  },

  createSourceFile: async (skillId: string) => {
    return adminAxios.post(`/admin/prompt-lab/source/${encodeURIComponent(skillId)}/create`);
  }
};

// ========== 统一导出 ==========

/**
 * 统一导出对象（兼容旧版代码）
 *
 * 注意：各子对象展开时存在三组同名键，后者会覆盖前者。
 * 本对象末尾已按历史展开顺序显式固定生效绑定（行为不变，但不再是隐式覆盖）；
 * 被覆盖的版本只能通过具名子对象访问。新代码请直接使用具名子对象，
 * 不要依赖本扁平对象的冲突键。
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

  // ---- 同名冲突显式解决（与展开顺序的最终生效结果一致）----
  // users: adminDashboardApi.users（宽松签名）被 adminUsersApi.users 覆盖；两者同端点
  // GET /admin/users，保留类型更精确的 adminUsersApi 版本
  users: adminUsersApi.users,
  // getAgentRelations: adminAgentsApi 版本请求 GET /admin/agents/relations，
  // adminSkillsApi 版本请求 GET /admin/skills/agent-relations（不同端点）；
  // 此处保留后展开的 skills 版本，agents 版本请用 adminAgentsApi.getAgentRelations()
  getAgentRelations: adminSkillsApi.getAgentRelations,
  // getPromptVersions: adminAgentPromptsApi 版本签名为 (params?: { agentId?, status? })，
  // adminTestApi 版本签名为 (agentId: string)（端点、签名均不同）；
  // 扁平键无现存调用方，绑定语义更通用的 prompts 版本，
  // test 版本请用 adminTestApi.getPromptVersions()
  getPromptVersions: adminAgentPromptsApi.getPromptVersions,
};
