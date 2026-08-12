// Admin 管理 API
import axios from 'axios';
import { setAuthFlashMessage } from '@/utils/authFlash';
import { clearUserLocalState } from '@/utils/sessionCleanup';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ADMIN_SESSION_REQUEST_TIMEOUT_MS = 10000;

/**
 * 管理员会话标记：token 已通过 HttpOnly Cookie 下发，JS 侧只记录"已登录"标记（非敏感）
 */
export const ADMIN_SESSION_KEY = 'wenflow_admin_session';
export const ADMIN_SESSION_CLEAR_EVENT_KEY = 'wenflow_admin_session_cleared';

const adminSessionTabId = createCommandId();

function isProtectedAdminPathname(pathname: string): boolean {
  const normalizedPath = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (normalizedPath !== '/admin' && !normalizedPath.startsWith('/admin/')) return false;

  return normalizedPath !== '/admin/login';
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
  || sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';

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

// 会话认证依赖 HttpOnly Cookie（withCredentials），无需在请求头注入 Token

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
  localStorage.removeItem('admin_user');
  sessionStorage.removeItem('admin_user');
  localStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  // 管理员登出同步清除投影令牌（真实凭据，防止残留放行受保护路由）
  clearUserLocalState();

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
  getActivity: async (limit?: number, excludeTest?: boolean) => {
    return adminAxios.get('/admin/activity', { params: { limit, excludeTest: excludeTest ? '1' : undefined } });
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
    data?: { scope?: 'dashboard' | 'full'; entry?: 'dashboard' | 'goal' | 'path' | 'learning' }
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

export const adminAgentsApi = {
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
    timeRange?: 'today' | 'yesterday' | 'week' | 'month' | 'all';
    sourceEntry?: string;
    startTime?: string;
    endTime?: string;
  }) => {
    return adminAxios.get('/admin/agents/logs', { params });
  },

  getLogDetail: async (id: string) => {
    return adminAxios.get(`/admin/agents/logs/${encodeURIComponent(id)}`);
  },
};

export const adminRuntimeDefinitionsApi = {
  getAgentDefinitions: async () => {
    return adminAxios.get('/admin/runtime-definitions/agents');
  },


  getOrchestratorDefinitions: async () => {
    return adminAxios.get('/admin/runtime-definitions/orchestrators');
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

};

// ============================================================
// V3 字段路由（AGENT_IO_DESIGN_V3 §3）
// ============================================================

/**
 * Skill 工作台综合元数据 API
 * 一次拉回：skill manifest + 隶属 Agent + 模型配置 + prompt 版本 + 字段契约 + 调用统计
 * 完成度扩展（SKILL_READINESS_SPEC §1.3）：completion 字段；不在 manifest 但户口簿有登记的
 * skill 降级返回 draft 态（data.draft=true + completion + displayName/description），不再 404。
 */
export interface SkillCompletionGateDetail {
  ok: boolean;
  detail: string;
}

export interface SkillCompletionItem {
  id: string;
  label: string;
  ok: boolean | null;
  hint?: string;
}

export interface SkillCompletion {
  status: 'draft' | 'handler-ready' | 'core-ready' | 'fields-synced' | 'live';
  gates: {
    draft: SkillCompletionGateDetail;
    handlerReady: SkillCompletionGateDetail;
    coreReady: SkillCompletionGateDetail;
    fieldsSynced: SkillCompletionGateDetail;
    live: SkillCompletionGateDetail;
  };
  items: SkillCompletionItem[];
  warnings: string[];
}

export interface SkillWorkbenchMeta {
  skill?: {
    id: string;
    name: string;
    description: string;
    category: string;
    aliases: string[];
    ioContractVersion?: string;
    noPromptFile: boolean;
  };
  parentAgent?: { id: string; name: string; monitoringGroup?: string } | null;
  completion?: SkillCompletion;
  /** 404 降级分支：不在 manifest 但户口簿有登记的 skill */
  draft?: boolean;
  displayName?: string;
  description?: string | null;
  activePromptId?: string | null;
  [key: string]: unknown;
}

export const adminSkillWorkbenchApi = {
  getMeta: async (skillId: string) => {
    const canonicalSkillId = skillId.startsWith('skill:') ? skillId : `skill:${skillId}`;
    // 返回体结构：{ success, data: SkillWorkbenchMeta }；data.completion 为可选新增字段，
    // 404 降级分支 data.draft=true。既有调用方（SkillDrawer/SkillDesignPage）用
    // `res?.data?.data ?? res?.data` 取值，保持返回类型宽松不破坏。
    return adminAxios.get(`/admin/skills/${encodeURIComponent(canonicalSkillId)}/workbench-meta`);
  },
};

/**
 * 字段路由中心 API（agent 管辖 skill 的字段归属/流向/编辑）
 */
export const adminFieldRoutingsApi = {
  getStages: async () => adminAxios.get('/admin/field-routings/stages'),

  getStageDetail: async (stage: string) =>
    adminAxios.get(`/admin/field-routings/stages/${encodeURIComponent(stage)}`),

  /** skill 维度字段路由读取（M1 统一编辑）：产出行 + fields + core 状态投影（analyzeCoreFieldsSync 单 skill） */
  getSkillRoutings: async (skillId: string) =>
    adminAxios.get(`/admin/field-routings/skill/${encodeURIComponent(skillId)}`),

  getChanges: async (params?: { stage?: string; fieldId?: string; limit?: number }) =>
    adminAxios.get('/admin/field-routings/changes', { params }),

  getDrift: async (params?: { kind?: 'contract' | 'field' | 'routing'; stage?: string }) =>
    adminAxios.get('/admin/field-routings/drift', { params }),

  getOrchestrationFile: async (stage: string) =>
    adminAxios.get(`/admin/field-routings/orchestration/${encodeURIComponent(stage)}`),

  saveOrchestrationFile: async (stage: string, content: string) =>
    adminAxios.put(`/admin/field-routings/orchestration/${encodeURIComponent(stage)}`, { content }),

  syncOrchestrationFile: async (stage: string) =>
    adminAxios.post(`/admin/field-routings/orchestration/${encodeURIComponent(stage)}/sync`),

  /**
   * 清理孤儿行（P2 补全）：编排文件声明删除 → DB 孤儿行清理。
   * dryRun 默认 true（只报告不删）；dryRun=false 才执行删除（删除前写
   * node_config_changes 审计，changeType='orchestration-prune'）。
   */
  pruneOrchestrationFile: async (stage: string, dryRun = true) =>
    adminAxios.post(`/admin/field-routings/orchestration/${encodeURIComponent(stage)}/prune`, { dryRun }),
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

// ============================================================
// 健康中心（漂移/健康提醒聚合，编排结构页顶部健康区数据源）
// 契约：GET /api/admin/health-center（60s 缓存，refresh=1 强制）、
//       POST /api/admin/health-center/fix（body: { id }，仅 fixable 类）
// ============================================================

export type HealthCenterItemId =
  | 'w4-corehash'
  | 'field-routing-contract'
  | 'field-routing'
  | 'contract-parity'
  | 'snapshots'
  | 'yaml-crosscheck'
  | 'params-consistency'
  | 'fields-sync'
  | 'w1-active'
  | 'w2-registration'
  | 'w3-wiring'
  | 'override-record'
  | 'runtime-prompt';

/** 基准元数据：谁是真源（DRIFT_BASELINE_SURVEY §4.1） */
export type HealthCenterBase =
  | 'file:core.yaml'
  | 'file:manifest'
  | 'file:orchestration'
  | 'file:skills.yaml'
  | 'bidirectional'
  | 'db:managed'
  | 'runtime';

/** 语义分级：决定修复语义 */
export type HealthCenterSemantics = 'baseline-drift' | 'consistency' | 'override-record' | 'runtime-info';

export type HealthSeverity = 'ok' | 'warn' | 'error' | 'info';

export interface HealthCenterItem {
  id: HealthCenterItemId;
  label: string;
  base: HealthCenterBase;
  semantics: HealthCenterSemantics;
  severity: HealthSeverity;
  status: string;
  count: number;
  detail: string[];
  cause: string;
  action: 'fixable' | 'manual' | 'none';
  fixHint: string;
  source: string;
}

export interface HealthCenterSummary {
  total: number;
  baselineDrift: number;
  consistency: number;
  overrideRecord: number;
  fixable: number;
}

export interface HealthCenterReport {
  generatedAt: string;
  summary: HealthCenterSummary;
  items: HealthCenterItem[];
}

export interface HealthCenterFixResult {
  id: HealthCenterItemId;
  fixed: boolean;
  backupDir: string | null;
  gitCommitHint: string;
  before: HealthCenterItem;
  after: HealthCenterItem;
  auditId?: string;
}

export const adminHealthCenterApi = {
  /**
   * 统一健康清单；refresh=true 时绕过 60s 缓存强制重算。
   */
  get: async (refresh = false) => {
    return adminAxios.get<{ success: boolean; data: HealthCenterReport }>('/admin/health-center', {
      params: refresh ? { refresh: 1 } : {},
    });
  },

  /**
   * 一键修复（仅 fixable：w4-corehash / field-routing / snapshots）；
   * manual 类后端返回 409 + 指引。
   */
  fix: async (id: HealthCenterItemId) => {
    return adminAxios.post<{ success: boolean; data: HealthCenterFixResult }>('/admin/health-center/fix', { id });
  },
};

/**
 * 运营术语表（全局「这是什么」抽屉数据源）
 * 后端从 yaml-vocabulary（promptRole 人话）+ glossary-content（概念/完成度/文档）派生
 */
export interface GlossaryTerm {
  term: string;
  def: string;
  category: 'concept' | 'flow' | 'status' | 'health';
  where?: string;
}

export interface GlossaryPayload {
  promptRoles: Array<{ id: string; label: string; hint: string }>;
  completionStates: Array<{ status: string; label: string; short: string; hint: string }>;
  semantics: Array<{ id: string; label: string; hint: string }>;
  stages: Array<{ id: string; label: string; hint: string }>;
  terms: GlossaryTerm[];
  docs: Array<{ title: string; path: string; desc: string }>;
  vocabularyVersion: string;
}

export const adminGlossaryApi = {
  get: async () => {
    return adminAxios.get<{ success: boolean; data: GlossaryPayload }>('/admin/glossary');
  },
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
  update: async (id: string, data: Record<string, unknown>) => {
    return adminAxios.put(`/admin/announcements/${encodeURIComponent(id)}`, data);
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
 * 平台 MCP 工具管理（外挂能力页）
 */
export const adminMcpApi = {
  list: async () => {
    return adminAxios.get('/admin/mcp');
  },
  createTool: async (data: Record<string, unknown>) => {
    return adminAxios.post('/admin/mcp/tools', data);
  },
  updateTool: async (id: string, data: Record<string, unknown>) => {
    return adminAxios.put(`/admin/mcp/tools/${encodeURIComponent(id)}`, data);
  },
  removeTool: async (id: string) => {
    return adminAxios.delete(`/admin/mcp/tools/${encodeURIComponent(id)}`);
  },
  testTool: async (id: string) => {
    return adminAxios.post(`/admin/mcp/tools/${encodeURIComponent(id)}/test`);
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
  getSkills: async (params?: { range?: 'all' | '24h' | '7d' | '30d' }) => {
    return adminAxios.get('/admin/skills', { params });
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
    requestTimeoutMs?: number | null;
    maxLogicalRetries?: number | null;
    enabled?: boolean;
  }) => {
    return adminAxios.put(`/admin/skill-model-configs/${skillId}`, data);
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

  /**
   * 技能四向对账（SKILL_READINESS_SPEC §4.2）：户口簿 / manifest / gateway 注册 / ACTIVE prompt
   * 全量逐 skill 状态 + 完成度投影 + 差集标记（Skills.vue 对账面板数据源）。
   */
  getReconciliation: async () => {
    return adminAxios.get<{ success: boolean; data: SkillReconciliationReport }>('/admin/skills/reconciliation');
  },

  /**
   * W1-W5 readiness 诊断（全 warn 不阻断 ready）；refresh=true 时总是重算。
   */
  getReadiness: async (refresh = false) => {
    return adminAxios.get('/admin/skills/readiness', { params: refresh ? { refresh: 1 } : {} });
  },

  /**
   * 新建 Skill 一条龙（P5 scaffold，SKILL_READINESS_SPEC §5 步骤 1）：
   * 确定性生成 core.yaml 骨架 + skills.yaml 条目 + 编排 contracts 追加（mainline）+ handler 占位，
   * 注册/接线片段仅返回文本。幂等：条目与生成物齐备 → 409；条目在但缺生成物 → completed 补齐。
   */
  scaffold: async (payload: SkillScaffoldPayload) => {
    return adminAxios.post<{ success: boolean; data: SkillScaffoldResult }>('/admin/skills/scaffold', payload);
  },

  /** scaffold 表单元数据：kind/stage 枚举 + manifest 顶层 agent（parentAgent 下拉数据源） */
  getScaffoldMeta: async () => {
    return adminAxios.get<{ success: boolean; data: SkillScaffoldMeta }>('/admin/skills/scaffold/meta');
  },
};

export interface SkillScaffoldPayload {
  skillId: string;
  kind: 'mainline' | 'aux' | 'handler-only';
  /** mainline 必填 */
  stage?: string;
  /** mainline 必填 */
  parentAgent?: string;
  displayName?: string;
  description?: string;
  aliases?: string[];
}

export interface SkillScaffoldSnippet {
  title: string;
  content: string;
}

export interface SkillScaffoldResult {
  skillId: string;
  kind: 'mainline' | 'aux' | 'handler-only';
  status: 'created' | 'completed';
  generated: string[];
  completion: SkillCompletion;
  snippets: SkillScaffoldSnippet[];
  note: string;
}

export interface SkillScaffoldMeta {
  kinds: Array<'mainline' | 'aux' | 'handler-only'>;
  stages: string[];
  agents: Array<{ id: string; name: string }>;
}

export interface SkillReconciliationRow {
  skillId: string;
  kind: 'mainline' | 'aux' | 'handler-only';
  displayName: string | null;
  stage: string | null;
  parentAgent: string | null;
  book: boolean;
  manifest: boolean;
  registered: boolean;
  active: boolean;
  noPromptFile: boolean;
  registrationExempt: boolean;
  diff: 'unregistered' | 'active-missing' | null;
  completion: SkillCompletion;
}

export interface SkillReconciliationReport {
  generatedAt: string;
  summary: {
    total: number;
    registered: number;
    active: number;
    byStatus: Record<string, number>;
    unregistered: number;
    activeMissing: number;
    orphanRegistrations: number;
  };
  items: SkillReconciliationRow[];
  orphanRegistrations: Array<{ name: string }>;
}

export const adminVirtualLearnersApi = {
  generatePersona: async (data?: {
    preferredLevels?: string[];
    candidatePersonas?: string[];
    existingPersonaSeed?: Record<string, unknown>;
  }) => {
    return adminAxios.post('/admin/virtual-learners/generate-persona', data || {});
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

  createProjectionToken: async (id: string, data?: { storyId?: string; virtualSessionId?: string; scope?: 'dashboard' | 'full' }) => {
    return adminAxios.post(`/admin/virtual-learners/${id}/projection-token`, data || {});
  },

  draftVirtualLearnerStories: async (id: string) => {
    return adminAxios.post(`/admin/virtual-learners/${id}/draft-stories`);
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

  getVirtualSessionTeachingDetail: async (sessionId: string, teachingSessionId?: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/teaching-detail`, {
      params: teachingSessionId ? { teachingSessionId } : undefined,
    });
  },

  virtualSessionStep: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/step`);
  },

  executeBlackboxVirtualAction: async (sessionId: string, action: Record<string, unknown>, expectedTraceCount: number) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/blackbox-action`, action, blackboxCommandConfig(expectedTraceCount));
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

  acceptVirtualSessionPath: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/accept-path`);
  },

  replanVirtualSessionPath: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/replan-path`);
  },

  getVirtualSessionPathStatus: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/path-status`);
  },

  startVirtualLearning: async (sessionId: string, data?: { taskId?: string }) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/start-learning`, data);
  },

  virtualSessionLearningStep: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/teaching-step`);
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

  // 沙盘契约视图（只读）：5 个顶层 agent 的输入通道 / 输出字段 / 合法沙盘键
  getSandboxView: async () => {
    return adminAxios.get('/admin/prompt-ops/sandbox-view');
  },

  getSkillRulesOverview: async () => {
    return adminAxios.get('/admin/prompt-ops/skill-rules-overview');
  },

  // P-PROMPT-COMPILE: 编译产物预览 + 重编译
  getPromptCompileInfo: async (agentId: string) => {
    return adminAxios.get(`/admin/prompt-ops/${encodeURIComponent(agentId)}/compile-info`);
  },

  // P-PROMPT-COMPILE: 保存源 + 自动编译 + 失效缓存 (一键 编辑→编译)

  // P-PROMPT-COMPILE: skill 目录 (agent.skill.字段 三级树, 用于可视化字段选择器)
  getSkillCatalog: async () => {
    return adminAxios.get('/admin/prompt-ops/skill-catalog');
  },

};

// ============================================================
// V3.7 · Prompt Lab API（v2 源文件体系已退役；保留 manifest 平台层与编译约定）
// ============================================================
// V4 · Prompt 工作台 API（核心文件编辑 / 编译预览 / 发布 / 版本回滚 / 血缘）
// ============================================================
export const adminPromptWorkbenchApi = {
  getCoreList: async () => {
    return adminAxios.get('/admin/prompt-lab/core-list');
  },

  getCore: async (skillId: string) => {
    return adminAxios.get(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}`);
  },

  saveCore: async (skillId: string, content: string) => {
    return adminAxios.put(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}`, { content });
  },

  /** 表单模式保存：结构化 JSON → 服务端确定性序列化为 YAML（与 raw 共用校验/分级/备份路径） */
  saveCoreForm: async (skillId: string, core: Record<string, unknown>) => {
    return adminAxios.put(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}`, { mode: 'form', core });
  },

  compileCore: async (payload: { skillId: string; semanticJudge?: boolean; confirmUncertain?: boolean }) => {
    return adminAxios.post('/admin/prompt-lab/compile-core', payload);
  },

  publishCore: async (payload: {
    skillId: string;
    confirmUncertain?: boolean;
    developerApproval?: { reference: string };
  }) => {
    return adminAxios.post('/admin/prompt-lab/publish-core', payload);
  },

  getCoreVersions: async (skillId: string) => {
    return adminAxios.get(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}/versions`);
  },

  rollbackCore: async (skillId: string, version: number) => {
    return adminAxios.post(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}/rollback`, { version });
  },

  getCoreLineage: async (skillId: string) => {
    return adminAxios.get(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}/lineage`);
  },

  /**
   * 加字段向导原子追加（M1 统一编辑，UNIFIED_EDITING_DESIGN §4.3）：
   * core.yaml fields + 编排 fields/routings 双写 + 落库 + fields-sync 复检 + 审计。
   * 409 = 重名（去既有编辑面）；422 = 校验/复检违规（后端中文 message 直接展示）。
   */
  addSkillField: async (skillId: string, payload: {
    name: string;
    type: string;
    role?: string;
    render?: string;
    handoff?: string[];
    internal?: boolean;
    accumulate?: boolean;
    turn?: boolean;
    visibilityPreset?: string;
    locked?: 'system' | 'structure';
    desc: string;
    persistKey?: string;
    pathInRawOutput?: string;
  }) => {
    return adminAxios.post(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}/field`, payload);
  },

  /**
   * 改字段原子 API（M3）：PATCH /core/:skillId/field/:name。
   * 双文件联动修改 + sync 全量对账落库（managedByCode=false 行跳过报告）+ 审计 + 复检。
   * 幂等：无变化 → changed=false。404 = 字段不存在；409 = systemLocked / 消费中。
   */
  updateSkillField: async (skillId: string, name: string, payload: {
    type?: string;
    role?: string;
    render?: string;
    handoff?: string[];
    internal?: boolean;
    accumulate?: boolean;
    turn?: boolean;
    visibilityPreset?: string;
    locked?: 'system' | 'structure' | '';
    desc?: string;
    persistKey?: string;
    pathInRawOutput?: string;
  }) => {
    return adminAxios.patch(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}/field/${encodeURIComponent(name)}`, payload);
  },

  /**
   * 删字段原子 API（M3）：DELETE /core/:skillId/field/:name。
   * 双文件联动删除 + DB 行清理 + 审计 + 复检。409 = systemLocked / 仍被下游消费。
   */
  deleteSkillField: async (skillId: string, name: string) => {
    return adminAxios.delete(`/admin/prompt-lab/core/${encodeURIComponent(skillId)}/field/${encodeURIComponent(name)}`);
  }
};

// ============================================================
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

  // ---- 同名冲突显式解决（与展开顺序的最终生效结果一致）----
  // getPromptVersions: 绑定语义更通用的 prompts 版本
  getPromptVersions: adminAgentPromptsApi.getPromptVersions,
};

// ============================================================
// V5 · 审计日志与会话安全（P3）
// 契约：GET /api/admin/audit-logs（scope=operation|login）、GET /api/admin/audit-logs/stats、
// GET /api/admin/sessions、DELETE /api/admin/sessions/:id、POST /api/admin/sessions/revoke-all
// ============================================================

export interface AuditLogQuery {
  page?: number;
  limit?: number;
  /** operation=操作审计（admin_audit_logs，默认）；login=登录审计（login_attempts） */
  scope?: 'operation' | 'login';
  /** 登录审计的维度（scope=login 时生效）：admin=管理端 / user=用户端 */
  loginScope?: 'admin' | 'user';
  adminId?: string;
  adminName?: string;
  action?: string;
  targetType?: string;
  keyword?: string;
  success?: boolean;
  timeRange?: 'today' | 'yesterday' | 'week' | 'month' | 'all';
  startTime?: string;
  endTime?: string;
}

export const adminAuditApi = {
  /**
   * 审计日志分页查询：scope=operation 返回 data.logs（admin_audit_logs 行）；
   * scope=login 返回 data.attempts（login_attempts 行）；两者均带 data.pagination。
   */
  getAuditLogs: async (params: AuditLogQuery = {}) => {
    return adminAxios.get('/admin/audit-logs', { params });
  },

  /**
   * 审计统计（状态条「N 条 · 失败 M 条」），筛选参数与 getAuditLogs 一致；
   * 返回 data.stats = { total, failed }
   */
  getAuditStats: async (params: AuditLogQuery = {}) => {
    return adminAxios.get('/admin/audit-logs/stats', { params });
  },
};

export interface AdminSessionQuery {
  adminId?: string;
  status?: 'active' | 'revoked' | 'expired';
}

export const adminSessionsApi = {
  /**
   * 管理员会话列表（含 adminName/adminEmail 联查）；status 枚举与后端一致。
   */
  getAdminSessions: async (params?: AdminSessionQuery) => {
    return adminAxios.get('/admin/sessions', { params });
  },

  /** 强制下线指定会话（禁止下线自己的当前会话，后端返回 409） */
  revokeAdminSession: async (sessionId: string) => {
    return adminAxios.delete(`/admin/sessions/${encodeURIComponent(sessionId)}`);
  },

  /** 批量吊销：指定 adminId（缺省为全部）的未吊销会话；excludeCurrent=true 保留请求者当前会话 */
  revokeAllAdminSessions: async (payload: { adminId?: string; excludeCurrent?: boolean }) => {
    return adminAxios.post('/admin/sessions/revoke-all', payload);
  },
};

// ============================================================
// V6 · 用户软删除 Phase 2：恢复 / 已删列表 / 含已删详情
// 说明：现有 adminUsersApi.getUsers/getUser 未扩展参数，这里以独立函数末尾追加，
//       不触碰既有代码；后端 GET /admin/users 支持 status=deleted，
//       GET /admin/users/:id 支持 includeDeleted=1（见 backend/src/routes/admin/users.ts）
// ============================================================

/** 恢复已软删用户（POST /admin/users/:id/restore；目标不存在 404、未软删 409） */
export const restoreUser = async (userId: string) => {
  return adminAxios.post(`/admin/users/${encodeURIComponent(userId)}/restore`);
};

/** 已删用户列表（status=deleted 反转软删筛选，供「已删除」筛选 pill 使用） */
export const getDeletedUsers = async (params?: { page?: number; limit?: number; search?: string }) => {
  return adminAxios.get('/admin/users', { params: { ...params, status: 'deleted' } });
};

/** 含已软删用户在内的详情（includeDeleted=1；详情页恢复入口的数据源） */
export const getUserIncludingDeleted = async (userId: string) => {
  return adminAxios.get(`/admin/users/${encodeURIComponent(userId)}`, { params: { includeDeleted: '1' } });
};
