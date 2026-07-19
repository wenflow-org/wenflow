// 用户自定义功能 API
import api, { AI_REQUEST_TIMEOUT } from '@/utils/api';

const API_BASE = '/user';
const MCP_TOOL_REQUEST_TIMEOUT = AI_REQUEST_TIMEOUT + 30_000;
const USER_ME_BASE = '/users/me';
const USER_PROJECTION_GRANT_BASE = `${API_BASE}/developer/access-grants`;

export type ProjectionGrantScope = 'dashboard' | 'full';

export interface ProjectionGrant {
  id?: string;
  userId?: string | null;
  status?: string | null;
  scope: ProjectionGrantScope;
  note?: string | null;
  purpose?: string | null;
  grantedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  scopeDefinition?: Record<string, unknown> | null;
  lastUsedAt?: string | null;
  lastUsedByAdminId?: string | null;
  useCount?: number;
  [key: string]: unknown;
}

export const normalizeProjectionGrant = (payload: unknown): ProjectionGrant | null => {
  const source = payload as {
    success?: unknown;
    data?: { grant?: unknown; grants?: unknown[] } | null;
    grant?: unknown;
  } | null | undefined;

  if (source?.success === false) return null;

  const raw = (source?.data?.grant
    || source?.data?.grants?.[0]
    || source?.data
    || source?.grant
    || payload) as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  if (
    raw.success === false ||
    !(
      'scope' in raw ||
      'grantScope' in raw ||
      'status' in raw ||
      'state' in raw ||
      'expiresAt' in raw ||
      'expireAt' in raw ||
      'grantedAt' in raw ||
      'createdAt' in raw ||
      'note' in raw ||
      'reason' in raw
    )
  ) {
    return null;
  }

  return {
    ...raw,
    scope: raw.scope === 'full' || raw.grantScope === 'full' ? 'full' : 'dashboard',
    status: raw.status ?? raw.state ?? null,
    note: raw.note ?? raw.reason ?? raw.description ?? raw.purpose ?? null,
    purpose: raw.purpose ?? raw.note ?? raw.reason ?? null,
    grantedAt: raw.grantedAt ?? raw.createdAt ?? raw.issuedAt ?? null,
    expiresAt: raw.expiresAt ?? raw.expireAt ?? raw.expiresAtIso ?? null,
    revokedAt: raw.revokedAt ?? null
  } as ProjectionGrant;
};

export const getProjectionGrantStatus = (
  grant: ProjectionGrant | null
): 'inactive' | 'active' | 'expired' | 'revoked' => {
  if (!grant) return 'inactive';

  const rawStatus = String(grant.status || '').toLowerCase();
  if (rawStatus === 'inactive' || rawStatus === 'none') return 'inactive';
  if (rawStatus === 'revoked' || grant.revokedAt) return 'revoked';
  if (rawStatus === 'expired') return 'expired';

  if (grant.expiresAt) {
    const expiresAt = new Date(grant.expiresAt).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      return 'expired';
    }
  }

  return 'active';
};

// ==================== 对话日志 ====================

export const getAgentLogs = async (params?: {
  page?: number;
  limit?: number;
  agentId?: string;
  capabilityType?: string;
  success?: boolean;
  includeSystem?: boolean;
  startDate?: string;
  endDate?: string;
}) => {
  return await api.get(`${USER_ME_BASE}/agent-logs`, { params });
};

export const getAgentLogDetail = async (logId: string) => {
  return await api.get(`${USER_ME_BASE}/agent-logs/${logId}`);
};

export const exportAgentLogs = async (params?: {
  agentId?: string;
  capabilityType?: string;
  success?: boolean;
  includeSystem?: boolean;
  startDate?: string;
  endDate?: string;
  format?: 'json' | 'csv';
}): Promise<Blob | { data?: unknown }> => {
  // 响应拦截器已解包：csv 时返回 Blob，json 时返回响应体
  return await api.get(`${USER_ME_BASE}/agent-logs/export`, {
    params,
    responseType: params?.format === 'csv' ? 'blob' : 'json'
  }) as unknown as Blob | { data?: unknown };
};

// ==================== 投影视角许可 ====================

export const getUserProjectionGrant = async () => {
  return await api.get(USER_PROJECTION_GRANT_BASE, { params: { status: 'active' } });
};

export const createUserProjectionGrant = async (data: {
  scope?: ProjectionGrantScope;
  expiresInHours?: number;
  note?: string;
}) => {
  const hours = Number(data.expiresInHours || 24);
  const note = data.note?.trim();
  return await api.post(USER_PROJECTION_GRANT_BASE, {
    scope: data.scope || 'dashboard',
    expiresInHours: hours,
    ttlHours: hours,
    expiresInMinutes: hours * 60,
    ...(note ? { note, reason: note, purpose: note } : {})
  });
};

export const revokeUserProjectionGrant = async (grantId?: string) => {
  if (!grantId) {
    throw new Error('grantId 缺失，无法撤销许可');
  }
  return await api.post(`${USER_PROJECTION_GRANT_BASE}/${grantId}/revoke`);
};

// ==================== Agent 自定义 ====================

export const getUserAgents = async (params?: {
  enabled?: boolean;
  filter?: 'all' | 'system' | 'custom';
}) => {
  return await api.get(`${API_BASE}/agents`, { params });
};

export const getUserAgent = async (name: string) => {
  return await api.get(`${API_BASE}/agents/${name}`);
};

export const saveUserAgent = async (data: {
  agentName: string;
  sourceType?: 'PLATFORM' | 'CUSTOM';
  enabled?: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}) => {
  return await api.post(`${API_BASE}/agents`, data);
};

export const updateUserAgent = async (name: string, data: {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}) => {
  return await api.put(`${API_BASE}/agents/${name}`, data);
};

export const deleteUserAgent = async (name: string) => {
  return await api.delete(`${API_BASE}/agents/${name}`);
};

export const enableUserAgent = async (name: string) => {
  return await api.post(`${API_BASE}/agents/${name}/enable`);
};

export const disableUserAgent = async (name: string) => {
  return await api.post(`${API_BASE}/agents/${name}/disable`);
};

export const testUserAgent = async (name: string, input: unknown) => {
  return await api.post(`${API_BASE}/agents/${name}/test`, { input }, { timeout: AI_REQUEST_TIMEOUT });
};

export const getUserAgentLogs = async (name: string, limit?: number) => {
  return await api.get(`${API_BASE}/agents/${name}/logs`, { params: { limit } });
};

// ==================== Skill 配置（只读 + 启停） ====================

export const getUserSkills = async (params?: {
  enabled?: boolean;
}) => {
  return await api.get(`${API_BASE}/skills`, { params });
};

export const getUserSkill = async (name: string) => {
  return await api.get(`${API_BASE}/skills/${name}`);
};

export const toggleUserSkill = async (name: string, enabled: boolean) => {
  return await api.post(`${API_BASE}/skills/${name}/enable`, { enabled });
};

// ==================== API 配置 ====================

// 获取平台默认配置
export const getPlatformDefault = async () => {
  return await api.get(`${API_BASE}/api-config/platform-default`);
};

// 获取用户配置
export const getUserApiConfig = async () => {
  return await api.get(`${API_BASE}/api-config`);
};

// 更新用户配置
export const updateUserApiConfig = async (data: {
  endpoint: string;
  apiKey?: string;
  chatModel: string;
  reasoningModel: string;
  enabled: boolean;
}) => {
  return await api.put(`${API_BASE}/api-config`, data);
};

// 禁用用户配置
export const disableUserApiConfig = async () => {
  return await api.delete(`${API_BASE}/api-config`);
};

// 测试连接
export const testApiConnection = async (data: {
  endpoint: string;
  apiKey?: string;
  model: string;
}) => {
  return await api.post(`${API_BASE}/api-config/test`, data, { timeout: AI_REQUEST_TIMEOUT });
};

// ==================== MCP 配置 ====================

export interface UserMcpToolConfig {
  id: string;
  name: string;
  description: string;
  type: string;
  endpoint: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  config?: { timeout?: number };
  enabled: boolean;
}

export interface UserMcpServerConfig {
  id: string;
  name: string;
  endpoint: string;
  type?: 'openai' | 'anthropic' | 'openai-compatible';
  apiKey?: string;
  apiKeyConfigured?: boolean;
  models?: string[];
  defaultModel?: string;
  priority?: number;
  enabled?: boolean;
  config?: {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
  };
}

export type UserMcpRoutingStrategy = 'priority' | 'latency' | 'round-robin';

export interface UserMcpHealthCheckConfig {
  enabled?: boolean;
  interval?: number;
  timeout?: number;
  headers?: Record<string, string>;
  auth?: {
    type?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    token?: string;
    clientId?: string;
    clientSecret?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  env?: Record<string, string>;
}

export const getUserMcpConfig = async () => {
  return await api.get(`${API_BASE}/mcp`);
};

export const updateUserMcpConfig = async (data: {
  servers?: UserMcpServerConfig[];
  tools?: UserMcpToolConfig[];
  routingStrategy?: UserMcpRoutingStrategy;
  fallbackEnabled?: boolean;
  healthCheck?: UserMcpHealthCheckConfig | null;
}) => {
  return await api.put(`${API_BASE}/mcp`, data);
};

export const executeMcpTool = async (id: string, params: Record<string, unknown> = {}) => {
  return await api.post(`${API_BASE}/mcp/tools/${encodeURIComponent(id)}/execute`, { params }, {
    timeout: MCP_TOOL_REQUEST_TIMEOUT
  });
};

export const getMcpServers = async () => {
  return await api.get(`${API_BASE}/mcp/servers`);
};

export const addMcpServer = async (server: UserMcpServerConfig) => {
  return await api.post(`${API_BASE}/mcp/servers`, server);
};

export const deleteMcpServer = async (id: string) => {
  return await api.delete(`${API_BASE}/mcp/servers/${id}`);
};

export const testMcpConnection = async (data: {
  endpoint: string;
  apiKey?: string;
}) => {
  return await api.post(`${API_BASE}/mcp/test-connection`, data, { timeout: AI_REQUEST_TIMEOUT });
};

export const getMcpStatus = async () => {
  return await api.get(`${API_BASE}/mcp/status`);
};

// ==================== 开发者接入 ====================

export const getDeveloperOverview = async () => {
  return await api.get(`${API_BASE}/developer/overview`);
};

export const getDeveloperQuickstart = async () => {
  return await api.get(`${API_BASE}/developer/quickstart`);
};
