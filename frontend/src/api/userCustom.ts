// 用户自定义功能 API
import request from '@/utils/request';

const API_BASE = '/user';
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
  scopeDefinition?: any;
  purpose?: string | null;
  lastUsedAt?: string | null;
  lastUsedByAdminId?: string | null;
  useCount?: number;
  [key: string]: any;
}

export const normalizeProjectionGrant = (payload: any): ProjectionGrant | null => {
  if (payload?.success === false) return null;

  const raw = payload?.data?.grant || payload?.data?.grants?.[0] || payload?.data || payload?.grant || payload;
  if (!raw || typeof raw !== 'object') return null;
  if (
    raw?.success === false ||
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
  };
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
  success?: boolean;
  includeSystem?: boolean;
  startDate?: string;
  endDate?: string;
}) => {
  const response = await request.get(`${USER_ME_BASE}/agent-logs`, { params });
  return response.data;
};

export const getAgentLogDetail = async (logId: string) => {
  const response = await request.get(`${USER_ME_BASE}/agent-logs/${logId}`);
  return response.data;
};

export const exportAgentLogs = async (params?: {
  startDate?: string;
  endDate?: string;
  format?: 'json' | 'csv';
}) => {
  const response = await request.get(`${USER_ME_BASE}/agent-logs/export`, {
    params,
    responseType: params?.format === 'csv' ? 'blob' : 'json'
  });
  return response.data;
};

// ==================== 投影视角许可 ====================

export const getUserProjectionGrant = async () => {
  const response = await request.get(USER_PROJECTION_GRANT_BASE, { params: { status: 'active' } });
  return response.data;
};

export const createUserProjectionGrant = async (data: {
  scope?: ProjectionGrantScope;
  expiresInHours?: number;
  note?: string;
}) => {
  const hours = Number(data.expiresInHours || 24);
  const note = data.note?.trim();
  const response = await request.post(USER_PROJECTION_GRANT_BASE, {
    scope: data.scope || 'dashboard',
    expiresInHours: hours,
    ttlHours: hours,
    expiresInMinutes: hours * 60,
    ...(note ? { note, reason: note, purpose: note } : {})
  });
  return response.data;
};

export const revokeUserProjectionGrant = async (grantId?: string) => {
  if (!grantId) {
    throw new Error('grantId 缺失，无法撤销许可');
  }
  const response = await request.post(`${USER_PROJECTION_GRANT_BASE}/${grantId}/revoke`);
  return response.data;
};

// ==================== Agent 自定义 ====================

export const getUserAgents = async (params?: {
  enabled?: boolean;
  filter?: 'all' | 'system' | 'custom';
}) => {
  const response = await request.get(`${API_BASE}/agents`, { params });
  return response.data;
};

export const getUserAgent = async (name: string) => {
  const response = await request.get(`${API_BASE}/agents/${name}`);
  return response.data;
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
  const response = await request.post(`${API_BASE}/agents`, data);
  return response.data;
};

export const updateUserAgent = async (name: string, data: {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}) => {
  const response = await request.put(`${API_BASE}/agents/${name}`, data);
  return response.data;
};

export const deleteUserAgent = async (name: string) => {
  const response = await request.delete(`${API_BASE}/agents/${name}`);
  return response.data;
};

export const enableUserAgent = async (name: string) => {
  const response = await request.post(`${API_BASE}/agents/${name}/enable`);
  return response.data;
};

export const disableUserAgent = async (name: string) => {
  const response = await request.post(`${API_BASE}/agents/${name}/disable`);
  return response.data;
};

export const testUserAgent = async (name: string, input: any) => {
  const response = await request.post(`${API_BASE}/agents/${name}/test`, { input });
  return response.data;
};

export const getUserAgentLogs = async (name: string, limit?: number) => {
  const response = await request.get(`${API_BASE}/agents/${name}/logs`, { params: { limit } });
  return response.data;
};

// ==================== Skill 自定义 ====================

export const getUserSkills = async (params?: {
  enabled?: boolean;
}) => {
  const response = await request.get(`${API_BASE}/skills`, { params });
  return response.data;
};

export const getUserSkill = async (name: string) => {
  const response = await request.get(`${API_BASE}/skills/${name}`);
  return response.data;
};

export const saveUserSkill = async (data: {
  skillName: string;
  sourceType?: 'PLATFORM' | 'CUSTOM';
  parameters?: any;
  endpoint?: string;
}) => {
  const response = await request.post(`${API_BASE}/skills`, data);
  return response.data;
};

export const updateUserSkill = async (name: string, data: {
  parameters?: any;
  endpoint?: string;
}) => {
  const response = await request.put(`${API_BASE}/skills/${name}`, data);
  return response.data;
};

export const deleteUserSkill = async (name: string) => {
  const response = await request.delete(`${API_BASE}/skills/${name}`);
  return response.data;
};

export const toggleUserSkill = async (name: string, enabled: boolean) => {
  const response = await request.post(`${API_BASE}/skills/${name}/enable`, { enabled });
  return response.data;
};

export const testUserSkill = async (name: string, input: any) => {
  const response = await request.post(`${API_BASE}/skills/${name}/test`, { input });
  return response.data;
};

// ==================== API 配置 ====================

// 获取平台默认配置
export const getPlatformDefault = async () => {
  const response = await request.get(`${API_BASE}/api-config/platform-default`);
  return response.data;
};

// 获取用户配置
export const getUserApiConfig = async () => {
  const response = await request.get(`${API_BASE}/api-config`);
  return response.data;
};

// 更新用户配置
export const updateUserApiConfig = async (data: {
  endpoint: string;
  apiKey: string;
  chatModel: string;
  reasoningModel: string;
  enabled: boolean;
}) => {
  const response = await request.put(`${API_BASE}/api-config`, data);
  return response.data;
};

// 禁用用户配置
export const disableUserApiConfig = async () => {
  const response = await request.delete(`${API_BASE}/api-config`);
  return response.data;
};

// 测试连接
export const testApiConnection = async (data: {
  endpoint: string;
  apiKey: string;
  model: string;
}) => {
  const response = await request.post(`${API_BASE}/api-config/test`, data);
  return response.data;
};

// ==================== MCP 配置 ====================

export const getUserMcpConfig = async () => {
  const response = await request.get(`${API_BASE}/mcp`);
  return response.data;
};

export const updateUserMcpConfig = async (data: {
  servers?: any[];
  tools?: any;
  routingStrategy?: string;
  fallbackEnabled?: boolean;
  healthCheck?: any;
}) => {
  const response = await request.put(`${API_BASE}/mcp`, data);
  return response.data;
};

export const getMcpServers = async () => {
  const response = await request.get(`${API_BASE}/mcp/servers`);
  return response.data;
};

export const addMcpServer = async (server: any) => {
  const response = await request.post(`${API_BASE}/mcp/servers`, server);
  return response.data;
};

export const deleteMcpServer = async (id: string) => {
  const response = await request.delete(`${API_BASE}/mcp/servers/${id}`);
  return response.data;
};

export const testMcpConnection = async (data: {
  endpoint: string;
  apiKey?: string;
}) => {
  const response = await request.post(`${API_BASE}/mcp/test-connection`, data);
  return response.data;
};

export const getMcpStatus = async () => {
  const response = await request.get(`${API_BASE}/mcp/status`);
  return response.data;
};

// ==================== 开发者接入 ====================

export const getDeveloperOverview = async () => {
  const response = await request.get(`${API_BASE}/developer/overview`);
  return response.data;
};

export const getDeveloperQuickstart = async () => {
  const response = await request.get(`${API_BASE}/developer/quickstart`);
  return response.data;
};
