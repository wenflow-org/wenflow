// Admin 管理 API
import axios from 'axios';
import { setAuthFlashMessage } from '@/utils/authFlash';
import { clearUserLocalState } from '@/utils/sessionCleanup';
import { AI_REQUEST_TIMEOUT } from '@/utils/api';
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

/**
 * 黑盒命令 Idempotency-Key 会话级缓存（P0-1 死锁修复）：
 * 同一 (sessionId, commandKey) 的命令在终态（成功或不可重试失败）前复用同一 key，
 * 使后端 barrier 允许的「同 key 重试对账」路径可用；终态后清除，下一次操作使用新 key
 * （step/observe 类每次操作都是新命令，不会误复用上一次的 key）。
 * 仅内存缓存：页面刷新后丢失 key 时，由后端自动对账 barrier（tryResolveOrderingBarrier）兜底。
 */
const BLACKBOX_COMMAND_KEY_CACHE_LIMIT = 200;
const blackboxCommandKeyCache = new Map<string, string>();

export function getOrCreateBlackboxCommandKey(sessionId: string, commandKey: string): string {
  const cacheKey = `${sessionId}::${commandKey}`;
  let value = blackboxCommandKeyCache.get(cacheKey);
  if (!value) {
    if (blackboxCommandKeyCache.size >= BLACKBOX_COMMAND_KEY_CACHE_LIMIT) blackboxCommandKeyCache.clear();
    value = createCommandId();
    blackboxCommandKeyCache.set(cacheKey, value);
  }
  return value;
}

export function clearBlackboxCommandKey(sessionId: string, commandKey: string): void {
  blackboxCommandKeyCache.delete(`${sessionId}::${commandKey}`);
}

/** 测试辅助：清空缓存，避免用例间 key 泄漏 */
export function resetBlackboxCommandKeyCache(): void {
  blackboxCommandKeyCache.clear();
}

/** 命令是否已达成终态判定：可重试失败（503 / retryable=true）保留 key，成功与不可重试失败清除 key */
export function isRetryableBlackboxCommandError(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { retryable?: unknown } } })?.response;
  return response?.data?.retryable === true || response?.status === 503;
}

/** 黑盒写命令统一发送：同一逻辑命令复用同一 Idempotency-Key，直到命令终态 */
async function sendBlackboxCommand(
  path: string,
  sessionId: string,
  commandKey: string,
  body: unknown,
  expectedTraceCount: number
) {
  const idempotencyKey = getOrCreateBlackboxCommandKey(sessionId, commandKey);
  try {
    const response = await adminAxios.post(path, body, {
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Expected-Trace-Count': String(expectedTraceCount)
      }
    });
    clearBlackboxCommandKey(sessionId, commandKey);
    return response;
  } catch (error) {
    if (!isRetryableBlackboxCommandError(error)) clearBlackboxCommandKey(sessionId, commandKey);
    throw error;
  }
}

/** 黑盒命令标识：action 按动作内容（含会话绑定），step/observe 按类型（后端 barrier 按 key 去重） */
function blackboxActionCommandKey(action: Record<string, unknown>): string {
  return `action:${JSON.stringify(action)}`;
}

/**
 * 创建 axios 实例
 */
const adminAxios = axios.create({
  baseURL: API_BASE,
  timeout: 30000, // 30秒超时
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
export interface RegistrationSettings {
  registrationEnabled: boolean;
  registerIpQuotaEnabled?: boolean;
  registerIpDailyQuota?: number;
}

export const adminPlatformSettingsApi = {
  getRegistrationSetting: async (): Promise<{ data: { data: RegistrationSettings } }> => {
    return adminAxios.get('/admin/settings/registration');
  },

  updateRegistrationSetting: async (data: Partial<RegistrationSettings>): Promise<{ data: { data: RegistrationSettings } }> => {
    return adminAxios.put('/admin/settings/registration', data);
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
  getUsers: async (params?: { page?: number; limit?: number; search?: string; role?: string; status?: string; includeTest?: boolean }) => {
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
    excludeTest?: boolean;
    includeTest?: boolean;
    page?: number;
    limit?: number;
  }) => {
    return adminAxios.get('/admin/learner-models', { params });
  },

  getDetail: async (userId: string, params?: {
    pathId?: string;
    mode?: 'global' | 'path' | 'teaching';
    includeTest?: boolean;
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
    includeTest?: boolean;
  }) => {
    return adminAxios.get(`/admin/learner-models/${userId}/evidence`, { params });
  },

  getPredictions: async (userId: string, params?: {
    includeTest?: boolean;
  }) => {
    return adminAxios.get(`/admin/learner-models/${userId}/predictions`, { params });
  }
};

export const adminMemoryTracesApi = {
  list: async (params?: {
    userId?: string;
    limit?: number;
    includeVirtual?: boolean;
  }) => {
    return adminAxios.get('/admin/memory-traces', { params });
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
    includeTest?: boolean;
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
    errorCategory?: string;
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

  /**
   * 行级编辑路由行（2026-08 编排结构页重构恢复）：仅允许编辑路由行属性
   * （render/handoff/internal/accumulate/visibilityPreset/notes），
   * 后端会同步回写编排文件（File-as-Truth 单源化保持）并写审计。
   */
  patchRouting: async (agentId: string, fieldId: string, data: {
    render?: 'visible' | 'hidden';
    handoff?: string[];
    internal?: boolean;
    accumulate?: boolean;
    visibilityPreset?: string | null;
    notes?: string | null;
  }) =>
    adminAxios.patch(
      `/admin/field-routings/routings/${encodeURIComponent(agentId)}/${encodeURIComponent(fieldId)}`,
      data
    ),
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
    defaultThinkingMode?: string;
    defaultReasoningEffort?: string;
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

// ============================================================
// 巡检工作台聚合（G1：GET /api/admin/health-center/summary）
// 一次请求返回五分组：健康 13 项 / 漂移三义 / 对账 W1-W5 / 完成度五档 / 全局统计
// ============================================================

export type HealthCompletionState = 'draft' | 'handler-ready' | 'core-ready' | 'fields-synced' | 'live';

/** 漂移摘要：三种漂移语义各自独立计数（术语统一，ADMIN_IA_AUDIT §3.2） */
export interface HealthDriftSummary {
  /** 契约漂移（编排契约声明 vs DB，health item field-routing-contract） */
  contract: number;
  /** W4 哈希漂移（core → 产物 → DB 哈希，health item w4-corehash） */
  hash: number;
  /** 运行时漂移（遥测 promptDrift 观测，health item runtime-prompt） */
  runtime: number;
}

/** 对账摘要：W1-W5 简版计数（与 skills-readiness 同一报告派生） */
export interface HealthReconciliationSummary {
  /** 户口簿活跃 skill 总数（对账对象） */
  total: number;
  /** W2 缺注册：户口簿登记但 skill_registrations 无行 */
  missingRegistration: number;
  /** W2 幽灵注册：注册表行不在户口簿活跃集 */
  zombieRegistration: number;
  /** W1 缺 ACTIVE：户口簿登记（有 prompt 文件）但无 ACTIVE prompt */
  missingActive: number;
  /** W1 幽灵 ACTIVE：agent_prompts ACTIVE 的 skill 不在户口簿活跃集 */
  zombieActive: number;
  /** W1 僵尸技能 ACTIVE 残留（保留注册零调用） */
  zombieSkillActive: number;
  /** W3 接线差集：steps 引用缺户口簿登记 + 户口簿登记缺 steps 引用 */
  unwired: number;
}

/** 完成度摘要：五档分布计数（明细仍走 /skills/reconciliation） */
export interface HealthCompletionSummary {
  distribution: Record<HealthCompletionState, number>;
  /** 已达 live 档的 skill 数 */
  live: number;
}

/** 全局统计 */
export interface HealthGlobalSummary {
  /** skill 总数（户口簿活跃集） */
  total: number;
  aux: number;
  mainline: number;
  handlerOnly: number;
  /** 异常 skill 数：任一已评估的完成度检查项不过 */
  abnormalSkills: number;
}

export interface HealthCenterSummaryReport {
  generatedAt: string;
  health: {
    summary: HealthCenterSummary;
    items: HealthCenterItem[];
    /** 异常检查项数（severity=error/warn，不含 info 观测项） */
    abnormal: number;
  };
  drift: HealthDriftSummary;
  reconciliation: HealthReconciliationSummary;
  completion: HealthCompletionSummary;
  global: HealthGlobalSummary;
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
   * 巡检聚合（G1 一页式巡检工作台）：健康 13 项 + 漂移 + 对账 + 完成度 + 全局统计；
   * refresh=true 时绕过 60s 缓存强制重算（?refresh=1）。
   */
  getSummary: async (refresh = false) => {
    return adminAxios.get<{ success: boolean; data: HealthCenterSummaryReport }>(
      '/admin/health-center/summary',
      { params: refresh ? { refresh: 1 } : {} },
    );
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
 * Token 成本统计（LLM 用量与成本透视）
 */
export const adminTokenCostApi = {
  /** 总览：总量 / 调用数 / 失败数 / prompt·completion 拆分 / 按天趋势 */
  getSummary: async (params?: { days?: number; includeTest?: boolean }) => {
    return adminAxios.get('/admin/token-cost/summary', {
      params: { ...params, includeTest: params?.includeTest ? '1' : undefined },
    });
  },
  /** per-agent（skill）token 排行 */
  getBySkill: async (params?: { days?: number; includeTest?: boolean }) => {
    return adminAxios.get('/admin/token-cost/by-skill', {
      params: { ...params, includeTest: params?.includeTest ? '1' : undefined },
    });
  },
  /** per-user token 排行 */
  getByUser: async (params?: { days?: number; includeTest?: boolean; limit?: number }) => {
    return adminAxios.get('/admin/token-cost/by-user', {
      params: { ...params, includeTest: params?.includeTest ? '1' : undefined },
    });
  },
  /** per-model token 排行 */
  getByModel: async (params?: { days?: number; includeTest?: boolean }) => {
    return adminAxios.get('/admin/token-cost/by-model', {
      params: { ...params, includeTest: params?.includeTest ? '1' : undefined },
    });
  },
};

/**
 * Goal 会话管理（目标对话 → 路径生成源头）
 */
export const adminGoalConversationsApi = {
  list: async (params?: { page?: number; limit?: number; status?: string; userId?: string; includeTest?: boolean }) => {
    return adminAxios.get('/admin/goal-conversations', { params });
  },
  getDetail: async (id: string) => {
    return adminAxios.get(`/admin/goal-conversations/${encodeURIComponent(id)}`);
  },
  remove: async (id: string) => {
    return adminAxios.delete(`/admin/goal-conversations/${encodeURIComponent(id)}`);
  },
  regeneratePath: async (id: string) => {
    // LLM 上游调用（Path 重生成）：放宽到 AI 请求超时
    return adminAxios.post(`/admin/goal-conversations/${encodeURIComponent(id)}/regenerate-path`, undefined, { timeout: AI_REQUEST_TIMEOUT });
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

  /** 模型延迟探测：不对 handler 全量试跑，直发上游看指定思考档的真实延迟/JSON/token */
  modelProbe: async (skillId: string, data: {
    thinkingMode?: string;
    reasoningEffort?: string;
    testInput?: string;
    timeoutMs?: number;
  }) => {
    return adminAxios.post(`/admin/skills/${encodeURIComponent(skillId)}/model-probe`, data);
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
    /** 样本类型：'student' 生成传统学生样本（课纲/考试节点/学期节奏/家长同伴环境） */
    sampleType?: string;
  }) => {
    // LLM 上游调用（persona-designer skill）：上游慢/限流时 30s 默认超时不够，放宽到 AI 请求超时
    return adminAxios.post('/admin/virtual-learners/generate-persona', data || {}, { timeout: AI_REQUEST_TIMEOUT });
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

  getVirtualLearnerMemory: async (id: string) => {
    return adminAxios.get(`/admin/virtual-learners/${id}/memory`);
  },

  createProjectionToken: async (id: string, data?: { storyId?: string; virtualSessionId?: string; scope?: 'dashboard' | 'full' }) => {
    return adminAxios.post(`/admin/virtual-learners/${id}/projection-token`, data || {});
  },

  draftVirtualLearnerStories: async (id: string, data?: { /** 样本类型：'student' 生成传统学生故事 */ sampleType?: string }) => {
    // LLM 上游调用（scenario-designer skill）：放宽到 AI 请求超时
    return adminAxios.post(`/admin/virtual-learners/${id}/draft-stories`, data || {}, { timeout: AI_REQUEST_TIMEOUT });
  },

  deleteStory: async (profileId: string, storyIndex: number) => {
    return adminAxios.delete(`/admin/virtual-learners/${profileId}/stories/${storyIndex}`);
  },

  updateStory: async (profileId: string, storyIndex: number, data: {
    title?: string;
    storyOutline?: string;
    storyTriggerEvent?: string;
    visibleOpening?: string;
    pressurePoints?: string[];
    problemKnowledge?: {
      domainFamiliarity?: 'low' | 'medium' | 'high';
      knownConcepts?: string[];
      struggleConcepts?: string[];
      hiddenGaps?: string[];
      selfAssessment?: string;
    };
    /** 故事级预算覆盖（可选，缺省继承角色级） */
    budget?: {
      maxRetriesPerStep?: number;
      maxRetriesTotal?: number;
    };
  }) => {
    return adminAxios.put(`/admin/virtual-learners/${profileId}/stories/${storyIndex}`, data);
  },

  getVirtualLearnerStats: async () => {
    return adminAxios.get('/admin/virtual-learners/stats');
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

  /** 真实会话控制台同构端点（teaching_sessions / goal_conversations）：只读，结构对齐 stageResults 契约 */
  getRealSessionConsole: async (sessionId: string) => {
    return adminAxios.get(`/admin/session-console/${sessionId}`);
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
    return sendBlackboxCommand(
      `/admin/virtual-learners/sessions/${sessionId}/blackbox-action`,
      sessionId,
      blackboxActionCommandKey(action),
      action,
      expectedTraceCount
    );
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

  startQuickLearnRun: async (profileId: string, data: { taskId: string; maxTurns?: number; storyId?: string; frictionBudget?: string }) => {
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

  virtualSessionAutoLearning: async (sessionId: string, data?: { maxMilestones?: number; maxTurns?: number }) => {
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

  /** 全自动模式：target='stage' 阶段级（推进完当前阶段即停）/ 'final' 全局级（直达 Path 全部完成，默认） */
  autopilotStart: async (sessionId: string, data?: { target?: 'stage' | 'final'; maxTurns?: number }) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/autopilot/start`, data || {});
  },
  autopilotStop: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/autopilot/stop`);
  },
  autopilotStatus: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/autopilot`);
  },

  virtualSessionWrapup: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/wrapup`);
  },

  /* ===== 批量新建（服务端队列） ===== */
  batchCreateLearners: async (data: { rows: Array<{ name: string; storyCount: number }>; cohort?: string; note?: string }) => {
    return adminAxios.post('/admin/virtual-learners/batch-create', data);
  },
  batchCreateJob: async (batchId: string) => {
    return adminAxios.get(`/admin/virtual-learners/batch-create/${batchId}`);
  },
  batchCreateRetry: async (batchId: string) => {
    return adminAxios.post(`/admin/virtual-learners/batch-create/${batchId}/retry`);
  },

  updateSessionSimulationConfig: async (
    sessionId: string,
    data: { frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test'; model?: string | null }
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

  /** 暂停会话（温和暂停，非紧急停止） */
  pauseVirtualSession: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/pause`);
  },

  /** 恢复暂停的会话 */
  resumeVirtualSession: async (sessionId: string) => {
    return adminAxios.post(`/admin/virtual-learners/sessions/${sessionId}/resume`);
  },

  getVirtualSessionLogs: async (sessionId: string) => {
    return adminAxios.get(`/admin/virtual-learners/sessions/${sessionId}/logs`);
  },

  deleteVirtualSession: async (sessionId: string) => {
    return adminAxios.delete(`/admin/virtual-learners/sessions/${sessionId}`);
  },

  /**
   * A1 批量终止：非终态会话统一标记 abandoned（dryRun 默认 true 只报告）。
   * sessionIds 与 profileIds 至少其一（profileIds = 该虚拟人全部非终态会话）。
   */
  terminateVirtualSessions: async (data: { sessionIds?: string[]; profileIds?: string[]; dryRun?: boolean }) => {
    return adminAxios.post('/admin/virtual-learners/sessions/terminate', data);
  },

  /** P0-2/A2 僵尸会话回收：dryRun 默认 true（干跑确认清单）；profileIds 提供时只回收选中虚拟人 */
  reclaimStaleVirtualSessions: async (data: { dryRun?: boolean; profileIds?: string[] }) => {
    return adminAxios.post('/admin/virtual-learners/sessions/reclaim-stale', data);
  },

  /** A3 批量删除虚拟学习者：级联删除 profile + 全部虚拟数据 */
  batchDeleteVirtualLearners: async (profileIds: string[]) => {
    return adminAxios.post('/admin/virtual-learners/batch-delete', { profileIds });
  },
};

// ============================================================
// V3.6 · Prompt 运营开发与评估中心
// ============================================================
export interface EvalCaseExpectations {
  mustIncludeFields?: string[];
  /** 人话校验：回复中必须出现的文字（一个都不能少） */
  mustContainText?: string[];
  mustNotInclude?: string[];
  expectedStage?: string;
  /** path-planning：期望里程碑数（同时作为 prompt 注入约束） */
  expectedMilestones?: number;
  /** stage-designer：期望子任务数（同时作为 prompt 注入约束） */
  expectedSubtaskCount?: number;
  /** ===== 虚拟学习者模拟输入（mode:simulated） ===== */
  /** 输入来源模式：manual（默认，手写对话）/ simulated（虚拟学习者扮演学生输入） */
  mode?: 'manual' | 'simulated';
  /** 新建场景：一句话描述当次学习需求，如"考英语，时间不多，每周两次一小时" */
  scenario?: string;
  /** 复用已有虚拟人（virtual_learner_profiles id）；缺省由场景即时生成人设 */
  personaId?: string;
  /** goal 多轮模拟轮数（>1 开启多轮对话；默认 1=仅首句） */
  dialogueRounds?: number;
  /** 学生对抗度 none|low|normal|high|stress_test */
  frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test';
  /** 收敛门禁：对话推进过程中必须产出的字段 */
  convergeRequires?: string[];
  notes?: string;
}

export interface CreateEvalCasePayload {
  agentId: string;
  caseId?: string;
  name: string;
  description?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  previousState?: Record<string, unknown>;
  /** path/stage 的结构化输入（milestone/cognitiveCore/expectedMilestones 等） */
  inputPayload?: Record<string, unknown>;
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

  // ===== 评估用例（eval-cases） =====
  getEvalCases: async (agentId?: string) => {
    return adminAxios.get('/admin/prompt-ops/eval-cases', { params: agentId ? { agentId } : {} });
  },

  createEvalCase: async (payload: CreateEvalCasePayload) => {
    return adminAxios.post('/admin/prompt-ops/eval-cases', payload);
  },

  updateEvalCase: async (id: string, payload: Partial<CreateEvalCasePayload>) => {
    return adminAxios.put(`/admin/prompt-ops/eval-cases/${encodeURIComponent(id)}`, payload);
  },

  deleteEvalCase: async (id: string) => {
    return adminAxios.delete(`/admin/prompt-ops/eval-cases/${encodeURIComponent(id)}`);
  },

  // ===== 评估运行（run-eval / eval-runs） =====
  runEval: async (payload: {
    agentId: string;
    promptVersionId?: string | null;
    promptVersion?: number | null;
    customPrompt?: string;
    model?: string;
    repeatCount?: number;
    caseIds?: string[];
    adhocCases?: Array<{
      id?: string;
      name?: string;
      messages: Array<{ role: string; content: string }>;
      previousState?: unknown;
      inputPayload?: unknown;
      expectations?: unknown;
    }>;
  }) => {
    return adminAxios.post('/admin/prompt-ops/run-eval', payload);
  },

  getEvalRuns: async (agentId?: string, limit?: number) => {
    return adminAxios.get('/admin/prompt-ops/eval-runs', { params: { agentId: agentId || undefined, limit: limit || undefined } });
  },

  getEvalRun: async (id: string) => {
    return adminAxios.get(`/admin/prompt-ops/eval-runs/${encodeURIComponent(id)}`);
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

  // Memory Traces
  ...adminMemoryTracesApi,

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

// ============================================================
// 批量实验（admin 虚拟学习者页 · 系统级队列实验）
// 后端：backend/src/routes/admin/batch-experiments.ts
// ============================================================

export interface BatchLearnerInput {
  name: string;
  learningGoal?: string;
  frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test';
}

export interface BatchExperimentRun {
  id: string;
  experimentId: string;
  profileId?: string | null;
  sessionId?: string | null;
  learnerName: string;
  frictionBudget: string;
  phase: string;
  status: string;
  completedTasks: number;
  totalTasks?: number | null;
  currentTask?: string | null;
  stallCount: number;
  lastError?: string | null;
  checkpoints?: string | null;
  decaySims?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchExperiment {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  createdBy: string;
  learnersConfig: string;
  createdAt: string;
  updatedAt: string;
  runs?: BatchExperimentRun[];
}

export const adminBatchExperimentsApi = {
  list: async () => {
    return adminAxios.get('/admin/batch-experiments');
  },
  create: async (payload: { name: string; description?: string; learners: BatchLearnerInput[] }) => {
    return adminAxios.post('/admin/batch-experiments', payload);
  },
  detail: async (id: string) => {
    return adminAxios.get(`/admin/batch-experiments/${encodeURIComponent(id)}`);
  },
  stop: async (id: string) => {
    return adminAxios.post(`/admin/batch-experiments/${encodeURIComponent(id)}/stop`);
  },
  advanceRun: async (experimentId: string, runId: string) => {
    return adminAxios.post(`/admin/batch-experiments/${encodeURIComponent(experimentId)}/runs/${encodeURIComponent(runId)}/advance`);
  },
  decayRun: async (experimentId: string, runId: string) => {
    return adminAxios.post(`/admin/batch-experiments/${encodeURIComponent(experimentId)}/runs/${encodeURIComponent(runId)}/decay`);
  },
  snapshotRun: async (experimentId: string, runId: string) => {
    return adminAxios.post(`/admin/batch-experiments/${encodeURIComponent(experimentId)}/runs/${encodeURIComponent(runId)}/snapshot`);
  },
};

/** 已删用户列表（status=deleted 反转软删筛选，供「已删除」筛选 pill 使用） */
export const getDeletedUsers = async (params?: { page?: number; limit?: number; search?: string }) => {
  return adminAxios.get('/admin/users', { params: { ...params, status: 'deleted' } });
};

/** 含已软删用户在内的详情（includeDeleted=1；详情页恢复入口的数据源） */
export const getUserIncludingDeleted = async (userId: string) => {
  return adminAxios.get(`/admin/users/${encodeURIComponent(userId)}`, { params: { includeDeleted: '1' } });
};

// ============================================================
// 成就管理（admin 后台：成就定义 / 解锁记录 / 发放与撤回 / 重检）
// 后端：backend/src/routes/admin/achievements.ts
// ============================================================

export interface AchievementDef {
  id: string;
  type: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  requirement: { type: string; value: number | string };
  unlockCount: number;
}

export interface AchievementRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  description: string | null;
  iconUrl: string | null;
  xpReward: number;
  completed: boolean;
  earnedAt: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; isVirtualLearner: boolean } | null;
}

export const adminAchievementsApi = {
  getDefinitions: async () => {
    return adminAxios.get<{ success: boolean; data: AchievementDef[] }>('/admin/achievements/definitions');
  },
  getRecords: async (params?: { page?: number; limit?: number; userId?: string; includeTest?: boolean }) => {
    return adminAxios.get<{ success: boolean; data: { records: AchievementRecord[]; pagination: { total: number; page: number; limit: number } } }>(
      '/admin/achievements/records',
      { params }
    );
  },
  grant: async (userId: string, achievementId: string) => {
    return adminAxios.post('/admin/achievements/grant', { userId, achievementId });
  },
  revoke: async (recordId: string) => {
    return adminAxios.post('/admin/achievements/revoke', { recordId });
  },
  recheck: async (userId: string) => {
    return adminAxios.post('/admin/achievements/recheck', { userId });
  },
};

// ============================================================
// 内容管理（admin 后台：学习路径治理）
// 后端：backend/src/routes/admin/learning-content.ts
// ============================================================

export interface LearningPathRow {
  id: string;
  title: string;
  subject: string;
  status: string;
  difficulty: string;
  estimatedHours: number | null;
  totalMilestones: number;
  completedMilestones: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  deadline: string | null;
  user: { id: string; name: string; email: string; isVirtualLearner: boolean } | null;
  milestoneStatuses: string[];
  milestoneCount: number;
}

export interface LearningContentStats {
  total: number;
  byStatus: Record<string, number>;
  bySubject: Array<{ subject: string; count: number }>;
  totalMilestones: number;
  totalTasks: number;
}

export const adminLearningContentApi = {
  listPaths: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    subject?: string;
    keyword?: string;
    includeTest?: boolean;
  }) => {
    return adminAxios.get<{ success: boolean; data: { paths: LearningPathRow[]; pagination: { total: number; page: number; limit: number } } }>(
      '/admin/learning-content/paths',
      { params }
    );
  },
  getPathDetail: async (id: string) => {
    return adminAxios.get(`/admin/learning-content/paths/${encodeURIComponent(id)}`);
  },
  archivePath: async (id: string) => {
    return adminAxios.post(`/admin/learning-content/paths/${encodeURIComponent(id)}/archive`);
  },
  restorePath: async (id: string) => {
    return adminAxios.post(`/admin/learning-content/paths/${encodeURIComponent(id)}/restore`);
  },
  deletePath: async (id: string) => {
    return adminAxios.delete(`/admin/learning-content/paths/${encodeURIComponent(id)}`);
  },
  getStats: async () => {
    return adminAxios.get<{ success: boolean; data: LearningContentStats }>('/admin/learning-content/stats');
  },
};

// ============================================================
// 运维工具（admin 后台：时间推进模拟 / outbox 死信重放）
// 后端：backend/src/routes/admin/devtools.ts
// ============================================================

export const adminDevtoolsApi = {
  /** 模拟自然天推进（不写库，仅按衰减模型预览画像变化） */
  advanceTime: async (data: { userId?: string; days?: number; pathId?: string }) => {
    return adminAxios.post('/admin/devtools/advance-time', data);
  },

  /** outbox 死信清单（终态死信：worker 不再拾取，需人工确认后重放） */
  getOutboxDead: async () => {
    return adminAxios.get<{ success: boolean; data: { deadCount: number; items: Array<{ id: string; eventType: string; userId: string | null; aggregateId: string | null; attemptCount: number; lastError: string | null; occurredAt: string }> } }>(
      '/admin/devtools/outbox/dead'
    );
  },

  /** 死信重放（eventType 可选；缺省全部） */
  requeueOutboxDead: async (eventType?: string) => {
    return adminAxios.post('/admin/devtools/outbox/requeue-dead', { eventType });
  },
};

// ============================================================
// 站内通知管理（admin 后台：全员/定向推送）
// 后端：backend/src/routes/admin/notifications.ts
// ============================================================

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  kind: string;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

export const adminNotificationsApi = {
  list: async (params?: { page?: number; limit?: number; userId?: string; kind?: string; unreadOnly?: boolean }) => {
    return adminAxios.get<{ success: boolean; data: { items: NotificationItem[]; pagination: { total: number; page: number; limit: number }; unreadTotal: number } }>(
      '/admin/notifications',
      { params }
    );
  },
  send: async (payload: { title: string; body?: string; kind?: string; scope: 'all' | 'user'; userId?: string; link?: string }) => {
    return adminAxios.post('/admin/notifications', payload);
  },
  remove: async (id: string) => {
    return adminAxios.delete(`/admin/notifications/${encodeURIComponent(id)}`);
  },
};
