// 用户自定义功能 API
import request from '@/utils/request';

const API_BASE = '/user';
const USER_ME_BASE = '/users/me';

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

// ==================== 代码仓库 ====================

export const getCodeRepositories = async (params?: {
  type?: 'AGENT' | 'SKILL' | 'MCP_TOOL';
  status?: 'active' | 'archived';
  limit?: number;
}) => {
  const response = await request.get(`${API_BASE}/code-repo`, { params });
  return response.data;
};

export const getCodeRepository = async (id: string) => {
  const response = await request.get(`${API_BASE}/code-repo/${id}`);
  return response.data;
};

export const saveCodeRepository = async (data: {
  name: string;
  type: 'AGENT' | 'SKILL' | 'MCP_TOOL';
  code: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
  metadata?: any;
}) => {
  const response = await request.post(`${API_BASE}/code-repo`, data);
  return response.data;
};

export const deleteCodeRepository = async (id: string) => {
  const response = await request.delete(`${API_BASE}/code-repo/${id}`);
  return response.data;
};

export const testCodeRepository = async (id: string, input: any) => {
  const response = await request.post(`${API_BASE}/code-repo/${id}/test`, { input });
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
  codeRepositoryId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  customCode?: string;
}) => {
  const response = await request.post(`${API_BASE}/agents`, data);
  return response.data;
};

export const updateUserAgent = async (name: string, data: {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  customCode?: string;
  codeRepositoryId?: string;
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
  codeRepositoryId?: string;
  parameters?: any;
  customCode?: string;
  endpoint?: string;
}) => {
  const response = await request.post(`${API_BASE}/skills`, data);
  return response.data;
};

export const updateUserSkill = async (name: string, data: {
  parameters?: any;
  customCode?: string;
  endpoint?: string;
  codeRepositoryId?: string;
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
