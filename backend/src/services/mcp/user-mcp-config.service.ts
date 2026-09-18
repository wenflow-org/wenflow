import prisma from '../../config/database';
import type { IMcpProviderConfig, IMcpToolConfig } from '../../core/mcp/McpGateway';
import { z } from 'zod';
import { isIP } from 'net';
import {
  decryptSecretTree,
  encryptSecretTree,
  isEncryptedSecret,
  isSecretFieldName
} from '../../utils/secret-crypto';
import { isAlwaysBlockedAddress, isLocalOrPrivateAddress } from '../../utils/safe-http';

export const USER_MCP_SECRET_CONTEXTS = {
  /**
   * ⚠️ 该字符串是 AES-GCM 的 AAD（加密参数），**必须冻结**，不随列名/类型改名而改变，
   * 否则已加密的 apiKey 将无法解密（列 user_mcp_configs.providers 原名 servers）。
   */
  providers: 'main.user_mcp_configs.servers',
  tools: 'main.user_mcp_configs.tools',
  healthCheck: 'main.user_mcp_configs.healthCheck',
} as const;

/**
 * 用户侧「外挂服务/供应商」配置（user_mcp_configs.providers）。
 *
 * 语义与平台侧 providers 一致（LLM 供应商连接）；原名 servers，易与 MCP server 混淆。
 */
export type UserMcpProviderConfig = Pick<IMcpProviderConfig, 'id' | 'name' | 'endpoint'>
  & Partial<Omit<IMcpProviderConfig, 'id' | 'name' | 'endpoint'>>;

export interface UserMcpRuntimeConfig {
  providers: UserMcpProviderConfig[];
  tools: IMcpToolConfig[];
  invalidToolIds?: string[];
  toolsConfigInvalid?: boolean;
  routingStrategy: string;
  fallbackEnabled: boolean;
  healthCheck: Record<string, unknown> | null;
}

export interface UserMcpConfigUpdate {
  providers?: UserMcpProviderConfig[];
  tools?: IMcpToolConfig[];
  routingStrategy?: 'priority' | 'latency' | 'round-robin';
  fallbackEnabled?: boolean;
  healthCheck?: Record<string, unknown> | null;
}

const MAX_USER_MCP_PROVIDERS = 50;
const MAX_USER_MCP_TOOLS = 100;
const MAX_MCP_TOOL_TIMEOUT_MS = 300_000;
const MCP_TOOL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function createMcpEndpointSchema(subject: '供应商' | '工具') {
  return z.string({
    required_error: `${subject} endpoint 必填`,
    invalid_type_error: `${subject} endpoint 必须是字符串`,
  }).trim().min(1, `${subject} endpoint 不能为空`)
    .max(2048, `${subject} endpoint 不能超过 2048 个字符`)
    .superRefine((value, ctx) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${subject} endpoint URL 格式无效` });
        return;
      }

      const allowedProtocols = new Set(['https:']);
      if (!allowedProtocols.has(url.protocol)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${subject} endpoint 仅允许 HTTPS`,
        });
      }
      if (url.username || url.password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${subject} endpoint 不允许包含用户名或密码` });
      }
      if (url.search || url.hash) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${subject} endpoint 不允许包含查询参数或片段` });
      }
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || isLocalOrPrivateAddress(hostname)
        || (isIP(hostname) !== 0 && isAlwaysBlockedAddress(hostname))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${subject} endpoint 不允许指向本机、局域网或保留地址` });
      }
    });
}

const mcpProviderSchema = z.object({
  id: z.string({
    required_error: '供应商 id 必填',
    invalid_type_error: '供应商 id 必须是字符串',
  }).trim().min(1, '供应商 id 不能为空').max(64, '供应商 id 不能超过 64 个字符')
    .regex(MCP_TOOL_ID_PATTERN, '供应商 id 只能包含字母、数字、点、下划线、冒号和连字符')
    .transform(value => value.toLowerCase()),
  name: z.string({
    required_error: '供应商 name 必填',
    invalid_type_error: '供应商 name 必须是字符串',
  }).trim().min(1, '供应商 name 不能为空').max(100, '供应商 name 不能超过 100 个字符'),
  type: z.enum(['openai', 'anthropic', 'openai-compatible'], {
    errorMap: () => ({ message: '供应商 type 仅支持 openai、anthropic 或 openai-compatible' }),
  }).optional(),
  endpoint: createMcpEndpointSchema('供应商'),
  apiKey: z.string({ invalid_type_error: '供应商 apiKey 必须是字符串' })
    .max(8192, '供应商 apiKey 不能超过 8192 个字符')
    .optional(),
  models: z.array(
    z.string({ invalid_type_error: '供应商 model 必须是字符串' })
      .trim().min(1, '供应商 model 不能为空').max(200, '供应商 model 不能超过 200 个字符')
  ).max(200, '供应商 models 不能超过 200 项').optional(),
  defaultModel: z.string({ invalid_type_error: '供应商 defaultModel 必须是字符串' })
    .trim().min(1, '供应商 defaultModel 不能为空').max(200, '供应商 defaultModel 不能超过 200 个字符')
    .optional(),
  priority: z.number({ invalid_type_error: '供应商 priority 必须是数字' })
    .int('供应商 priority 必须是整数').min(0, '供应商 priority 不能小于 0')
    .max(10_000, '供应商 priority 不能超过 10000').optional(),
  enabled: z.boolean({ invalid_type_error: '供应商 enabled 必须是布尔值' }).optional(),
  config: z.object({
    temperature: z.number({ invalid_type_error: '供应商 config.temperature 必须是数字' })
      .min(0, '供应商 config.temperature 不能小于 0')
      .max(2, '供应商 config.temperature 不能超过 2')
      .optional(),
    maxTokens: z.number({ invalid_type_error: '供应商 config.maxTokens 必须是数字' })
      .int('供应商 config.maxTokens 必须是整数')
      .min(1, '供应商 config.maxTokens 不能小于 1')
      .max(2_000_000, '供应商 config.maxTokens 不能超过 2000000')
      .optional(),
    timeout: z.number({ invalid_type_error: '供应商 config.timeout 必须是数字' })
      .int('供应商 config.timeout 必须是整数')
      .min(100, '供应商 config.timeout 不能小于 100 毫秒')
      .max(MAX_MCP_TOOL_TIMEOUT_MS, `服务器 config.timeout 不能超过 ${MAX_MCP_TOOL_TIMEOUT_MS} 毫秒`)
      .optional(),
  }).strict('供应商 config 包含不支持的字段').optional(),
}).strict('供应商包含不支持的字段');

const mcpToolSchema = z.object({
  id: z.string({
    required_error: '工具 id 必填',
    invalid_type_error: '工具 id 必须是字符串',
  }).trim().min(1, '工具 id 不能为空').max(64, '工具 id 不能超过 64 个字符')
    .regex(MCP_TOOL_ID_PATTERN, '工具 id 只能包含字母、数字、点、下划线、冒号和连字符')
    .transform(value => value.toLowerCase()),
  name: z.string({
    required_error: '工具 name 必填',
    invalid_type_error: '工具 name 必须是字符串',
  }).trim().min(1, '工具 name 不能为空').max(100, '工具 name 不能超过 100 个字符'),
  description: z.string({
    required_error: '工具 description 必填',
    invalid_type_error: '工具 description 必须是字符串',
  }).trim().max(1000, '工具 description 不能超过 1000 个字符'),
  type: z.string({
    required_error: '工具 type 必填',
    invalid_type_error: '工具 type 必须是字符串',
  }).trim().min(1, '工具 type 不能为空').max(64, '工具 type 不能超过 64 个字符')
    .regex(MCP_TOOL_ID_PATTERN, '工具 type 只能包含字母、数字、点、下划线、冒号和连字符'),
  /** 'http'（默认，通用 HTTP 端点）/ 'mcp'（真 MCP server，工具运行时发现） */
  transport: z.enum(['http', 'mcp'], {
    errorMap: () => ({ message: '工具 transport 仅支持 http 或 mcp' }),
  }).optional(),
  endpoint: createMcpEndpointSchema('工具'),
  apiKey: z.string({ invalid_type_error: '工具 apiKey 必须是字符串' })
    .max(8192, '工具 apiKey 不能超过 8192 个字符')
    .optional(),
  config: z.object({
    timeout: z.number({ invalid_type_error: '工具 config.timeout 必须是数字' })
      .int('工具 config.timeout 必须是整数')
      .min(100, '工具 config.timeout 不能小于 100 毫秒')
      .max(MAX_MCP_TOOL_TIMEOUT_MS, `工具 config.timeout 不能超过 ${MAX_MCP_TOOL_TIMEOUT_MS} 毫秒`)
      .optional(),
    toolsTtlMs: z.number({ invalid_type_error: '工具 config.toolsTtlMs 必须是数字' })
      .int('工具 config.toolsTtlMs 必须是整数')
      .min(0, '工具 config.toolsTtlMs 不能小于 0')
      .max(86_400_000, '工具 config.toolsTtlMs 不能超过 86400000')
      .optional(),
  }).strict('工具 config 包含不支持的字段').optional(),
  enabled: z.boolean({
    required_error: '工具 enabled 必填',
    invalid_type_error: '工具 enabled 必须是布尔值',
  }),
}).strict('工具包含不支持的字段').transform(tool => ({
  id: tool.id,
  name: tool.name,
  description: tool.description,
  type: tool.type,
  // 仅在显式声明 mcp 时落字段（缺省即 http），与读取侧 runtimeMcpToolSchema 保持同一约定
  ...(tool.transport === 'mcp' ? { transport: 'mcp' as const } : {}),
  endpoint: tool.endpoint,
  enabled: tool.enabled,
  ...(tool.apiKey === undefined ? {} : { apiKey: tool.apiKey }),
  ...(tool.config === undefined ? {} : { config: tool.config }),
}));

const runtimeMcpProviderSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(MCP_TOOL_ID_PATTERN).transform(value => value.toLowerCase()),
  name: z.string().trim().max(100).optional(),
  type: z.enum(['openai', 'anthropic', 'openai-compatible']).optional(),
  endpoint: createMcpEndpointSchema('供应商'),
  apiKey: z.string().max(8192).optional(),
  models: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  defaultModel: z.string().trim().min(1).max(200).optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional().default(true),
  config: z.object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(2_000_000).optional(),
    timeout: z.number().int().min(100).max(MAX_MCP_TOOL_TIMEOUT_MS).optional(),
  }).optional(),
}).transform(server => ({
  id: server.id,
  name: server.name || server.id,
  endpoint: server.endpoint,
  enabled: server.enabled,
  ...(server.type === undefined ? {} : { type: server.type }),
  ...(server.apiKey === undefined ? {} : { apiKey: server.apiKey }),
  ...(server.models === undefined ? {} : { models: server.models }),
  ...(server.defaultModel === undefined ? {} : { defaultModel: server.defaultModel }),
  ...(server.priority === undefined ? {} : { priority: server.priority }),
  ...(server.config === undefined ? {} : { config: server.config }),
}));

const runtimeMcpToolSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(MCP_TOOL_ID_PATTERN).transform(value => value.toLowerCase()),
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  type: z.string().trim().min(1).max(64).optional(),
  /** 'http'（默认，通用 HTTP 端点）/ 'mcp'（真 MCP server，工具运行时发现） */
  transport: z.enum(['http', 'mcp']).optional(),
  endpoint: createMcpEndpointSchema('工具'),
  apiKey: z.string().max(8192).optional(),
  config: z.object({
    timeout: z.number().int().min(100).max(MAX_MCP_TOOL_TIMEOUT_MS).optional(),
    toolsTtlMs: z.number().int().min(0).max(86_400_000).optional(),
  }).optional(),
  enabled: z.boolean().optional().default(true),
}).transform(tool => ({
  id: tool.id,
  name: tool.name || tool.id,
  description: tool.description || '',
  type: tool.type || 'remote',
  // 仅在显式声明 mcp 时落字段，其余保持原样（transport 缺省即 http，向后兼容既有数据）
  ...(tool.transport === 'mcp' ? { transport: 'mcp' as const } : {}),
  endpoint: tool.endpoint,
  enabled: tool.enabled,
  ...(tool.apiKey === undefined ? {} : { apiKey: tool.apiKey }),
  ...(tool.config === undefined ? {} : { config: tool.config }),
}));

const mcpHealthCheckSchema = z.object({
  enabled: z.boolean({ invalid_type_error: 'healthCheck.enabled 必须是布尔值' }).optional(),
  interval: z.number({ invalid_type_error: 'healthCheck.interval 必须是数字' })
    .int('healthCheck.interval 必须是整数')
    .min(1000, 'healthCheck.interval 不能小于 1000 毫秒')
    .max(86_400_000, 'healthCheck.interval 不能超过 86400000 毫秒')
    .optional(),
  timeout: z.number({ invalid_type_error: 'healthCheck.timeout 必须是数字' })
    .int('healthCheck.timeout 必须是整数')
    .min(100, 'healthCheck.timeout 不能小于 100 毫秒')
    .max(MAX_MCP_TOOL_TIMEOUT_MS, `healthCheck.timeout 不能超过 ${MAX_MCP_TOOL_TIMEOUT_MS} 毫秒`)
    .optional(),
  headers: z.record(z.string().max(8192, 'healthCheck.headers 值不能超过 8192 个字符')).optional(),
  auth: z.object({
    type: z.string().trim().max(64).optional(),
    username: z.string().max(512).optional(),
    password: z.string().max(8192).optional(),
    apiKey: z.string().max(8192).optional(),
    token: z.string().max(8192).optional(),
    clientId: z.string().max(512).optional(),
    clientSecret: z.string().max(8192).optional(),
    accessKeyId: z.string().max(8192).optional(),
    secretAccessKey: z.string().max(8192).optional(),
  }).strict('healthCheck.auth 包含不支持的字段').optional(),
  env: z.record(z.string().max(8192, 'healthCheck.env 值不能超过 8192 个字符')).optional(),
}).strict('healthCheck 包含不支持的字段');

const userMcpConfigUpdateSchema = z.object({
  providers: z.unknown().optional(),
  tools: z.unknown().optional(),
  routingStrategy: z.enum(['priority', 'latency', 'round-robin'], {
    errorMap: () => ({ message: 'routingStrategy 仅支持 priority、latency 或 round-robin' }),
  }).optional(),
  fallbackEnabled: z.boolean({ invalid_type_error: 'fallbackEnabled 必须是布尔值' }).optional(),
  healthCheck: mcpHealthCheckSchema.nullable().optional(),
}).strict('MCP 配置包含不支持的字段');

type UserMcpValidationIssue = {
  path: string;
  message: string;
};

function createUserMcpValidationError(
  code: string,
  message: string,
  details?: UserMcpValidationIssue[]
): Error & { code: string; status: number; details?: UserMcpValidationIssue[] } {
  return Object.assign(new Error(message), { code, status: 400, details });
}

function findEncryptedSecretInput(value: unknown, path: string): UserMcpValidationIssue | null {
  if (isEncryptedSecret(value)) {
    return { path, message: '不允许提交数据库 Secret 密文' };
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const issue = findEncryptedSecretInput(value[index], `${path}[${index}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const issue = findEncryptedSecretInput(item, `${path}.${key}`);
    if (issue) return issue;
  }
  return null;
}

function assertNoEncryptedSecretInput(value: unknown, root: string, code: string): void {
  const issue = findEncryptedSecretInput(value, root);
  if (!issue) return;
  throw createUserMcpValidationError(code, issue.message, [issue]);
}

function formatValidationIssue(issue: z.ZodIssue, root: string): UserMcpValidationIssue {
  const suffix = issue.path.map(part => typeof part === 'number' ? `[${part}]` : `.${part}`).join('');
  return { path: `${root}${suffix}`, message: issue.message };
}

function stripSecretConfiguredMarkers(value: unknown, forceSecretFields = false): unknown {
  if (Array.isArray(value)) return value.map(item => stripSecretConfiguredMarkers(item, forceSecretFields));
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const baseKey = key.endsWith('Configured') ? key.slice(0, -'Configured'.length) : '';
    if (baseKey && (forceSecretFields || isSecretFieldName(baseKey))) continue;
    const forceChildSecrets = key.toLowerCase() === 'headers' || key.toLowerCase() === 'env';
    result[key] = stripSecretConfiguredMarkers(item, forceChildSecrets);
  }
  return result;
}

export function isLocalMcpTool(tool: Pick<IMcpToolConfig, 'endpoint'>): boolean {
  return typeof tool?.endpoint === 'string' && tool.endpoint.trim().toLowerCase() === 'local';
}

export function parseUserMcpProviders(providers: unknown): UserMcpProviderConfig[] {
  assertNoEncryptedSecretInput(providers, 'providers', 'MCP_PROVIDER_CONFIG_INVALID');
  if (!Array.isArray(providers)) {
    throw createUserMcpValidationError('MCP_PROVIDERS_INVALID', 'MCP providers 必须是数组');
  }
  if (providers.length > MAX_USER_MCP_PROVIDERS) {
    throw createUserMcpValidationError(
      'MCP_PROVIDER_CONFIG_INVALID',
      `MCP 供应商数量不能超过 ${MAX_USER_MCP_PROVIDERS}`,
      [{ path: 'providers', message: `最多允许 ${MAX_USER_MCP_PROVIDERS} 个供应商` }]
    );
  }

  const parsed = z.array(mcpProviderSchema).safeParse(stripSecretConfiguredMarkers(providers));
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => formatValidationIssue(issue, 'providers'));
    throw createUserMcpValidationError(
      'MCP_PROVIDER_CONFIG_INVALID',
      details[0]?.message || 'MCP 供应商配置无效',
      details
    );
  }

  const seenIds = new Set<string>();
  for (const provider of parsed.data) {
    const normalizedId = provider.id.toLowerCase();
    if (seenIds.has(normalizedId)) {
      throw createUserMcpValidationError(
        'MCP_PROVIDER_CONFIG_INVALID',
        `MCP 供应商 ID 重复: ${provider.id}`,
        [{ path: 'providers', message: `供应商 ID ${provider.id} 重复` }]
      );
    }
    seenIds.add(normalizedId);
  }

  return parsed.data as UserMcpProviderConfig[];
}

export function parseUserMcpTools(tools: unknown): IMcpToolConfig[] {
  assertNoEncryptedSecretInput(tools, 'tools', 'MCP_TOOL_CONFIG_INVALID');
  if (!Array.isArray(tools)) {
    throw createUserMcpValidationError('MCP_TOOLS_INVALID', 'MCP tools 必须是数组');
  }

  if (tools.some((tool) => tool && typeof tool === 'object' && isLocalMcpTool(tool as IMcpToolConfig))) {
    throw createUserMcpValidationError(
      'MCP_USER_LOCAL_TOOL_FORBIDDEN',
      '用户 MCP 配置不允许声明服务器本地工具'
    );
  }

  if (tools.length > MAX_USER_MCP_TOOLS) {
    throw createUserMcpValidationError(
      'MCP_TOOL_CONFIG_INVALID',
      `MCP 工具数量不能超过 ${MAX_USER_MCP_TOOLS}`,
      [{ path: 'tools', message: `最多允许 ${MAX_USER_MCP_TOOLS} 个工具` }]
    );
  }

  const parsed = z.array(mcpToolSchema).safeParse(stripSecretConfiguredMarkers(tools));
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => formatValidationIssue(issue, 'tools'));
    throw createUserMcpValidationError(
      'MCP_TOOL_CONFIG_INVALID',
      details[0]?.message || 'MCP 工具配置无效',
      details
    );
  }

  const seenIds = new Set<string>();
  for (const tool of parsed.data) {
    const normalizedId = tool.id.toLowerCase();
    if (seenIds.has(normalizedId)) {
      throw createUserMcpValidationError(
        'MCP_TOOL_CONFIG_INVALID',
        `MCP 工具 ID 重复: ${tool.id}`,
        [{ path: 'tools', message: `工具 ID ${tool.id} 重复` }]
      );
    }
    seenIds.add(normalizedId);
  }

  return parsed.data as IMcpToolConfig[];
}

function parseRuntimeUserMcpTools(tools: unknown): {
  tools: IMcpToolConfig[];
  invalidToolIds: string[];
  configInvalid: boolean;
} {
  if (!Array.isArray(tools)) {
    return { tools: [], invalidToolIds: [], configInvalid: true };
  }
  const result: IMcpToolConfig[] = [];
  const seenIds = new Set<string>();
  const invalidIds = new Set<string>();
  let configInvalid = false;
  for (const candidate of tools) {
    const rawId = candidate && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>).id
      : undefined;
    const normalizedId = typeof rawId === 'string' ? rawId.trim().toLowerCase() : '';
    if (!normalizedId || !MCP_TOOL_ID_PATTERN.test(normalizedId)) {
      configInvalid = true;
      continue;
    }
    const parsed = runtimeMcpToolSchema.safeParse(candidate);
    if (!parsed.success) {
      if (!seenIds.has(normalizedId)) invalidIds.add(normalizedId);
      continue;
    }
    if (seenIds.has(parsed.data.id)) continue;
    seenIds.add(parsed.data.id);
    invalidIds.delete(parsed.data.id);
    result.push(parsed.data);
  }
  return { tools: result, invalidToolIds: Array.from(invalidIds), configInvalid };
}

export function normalizeStoredUserMcpProviders(providers: unknown): UserMcpProviderConfig[] {
  if (!Array.isArray(providers)) return [];
  const result: UserMcpProviderConfig[] = [];
  const seenIds = new Set<string>();
  for (const candidate of providers) {
    const parsed = runtimeMcpProviderSchema.safeParse(candidate);
    if (!parsed.success || seenIds.has(parsed.data.id)) continue;
    seenIds.add(parsed.data.id);
    result.push(parsed.data as UserMcpProviderConfig);
  }
  return result;
}

export function normalizeStoredUserMcpTools(tools: unknown): IMcpToolConfig[] {
  return parseRuntimeUserMcpTools(tools).tools;
}

export function normalizeStoredUserMcpHealthCheck(
  healthCheck: unknown
): Record<string, unknown> | null {
  if (healthCheck === null || healthCheck === undefined) return null;
  const parsed = mcpHealthCheckSchema.safeParse(healthCheck);
  return parsed.success ? parsed.data : null;
}

export function parseUserMcpConfigUpdate(input: unknown): UserMcpConfigUpdate {
  assertNoEncryptedSecretInput(input, 'config', 'MCP_CONFIG_INVALID');
  const parsed = userMcpConfigUpdateSchema.safeParse(stripSecretConfiguredMarkers(input));
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => formatValidationIssue(issue, 'config'));
    throw createUserMcpValidationError(
      'MCP_CONFIG_INVALID',
      details[0]?.message || 'MCP 配置无效',
      details
    );
  }

  const result: UserMcpConfigUpdate = {
    routingStrategy: parsed.data.routingStrategy,
    fallbackEnabled: parsed.data.fallbackEnabled,
    healthCheck: parsed.data.healthCheck,
  };
  if (parsed.data.providers !== undefined) {
    result.providers = parseUserMcpProviders(parsed.data.providers);
  }
  if (parsed.data.tools !== undefined) {
    result.tools = parseUserMcpTools(parsed.data.tools);
  }
  return result;
}

export function parseUserMcpSecretJson<T>(value: string | null, context: string, fallback: T): T {
  return value ? decryptSecretTree(JSON.parse(value), context) as T : fallback;
}

export function parseUserMcpSecretJsonSafe<T>(value: string | null, context: string, fallback: T): T {
  return parseUserMcpSecretJsonSafeResult(value, context, fallback).value;
}

function parseUserMcpSecretJsonSafeResult<T>(
  value: string | null,
  context: string,
  fallback: T
): { value: T; malformedJson: boolean } {
  try {
    return { value: parseUserMcpSecretJson(value, context, fallback), malformedJson: false };
  } catch (error) {
    if (error instanceof SyntaxError) return { value: fallback, malformedJson: true };
    throw error;
  }
}

export function serializeUserMcpSecretJson(value: unknown, context: string): string {
  return JSON.stringify(encryptSecretTree(value, context));
}

export async function getUserMcpRuntimeConfig(userId: string): Promise<UserMcpRuntimeConfig | null> {
  const config = await prisma.user_mcp_configs.findUnique({ where: { userId } });
  if (!config) return null;

  const providers = parseUserMcpSecretJsonSafe<unknown>(
    config.providers,
    USER_MCP_SECRET_CONTEXTS.providers,
    []
  );
  const toolsResult = parseUserMcpSecretJsonSafeResult<unknown>(
    config.tools,
    USER_MCP_SECRET_CONTEXTS.tools,
    []
  );
  const healthCheck = parseUserMcpSecretJsonSafe<unknown>(
    config.healthCheck,
    USER_MCP_SECRET_CONTEXTS.healthCheck,
    null
  );
  const parsedTools = parseRuntimeUserMcpTools(toolsResult.value);

  return {
    providers: normalizeStoredUserMcpProviders(providers),
    tools: parsedTools.tools,
    ...(parsedTools.invalidToolIds.length > 0 ? { invalidToolIds: parsedTools.invalidToolIds } : {}),
    ...(toolsResult.malformedJson || parsedTools.configInvalid ? { toolsConfigInvalid: true } : {}),
    routingStrategy: config.routingStrategy,
    fallbackEnabled: config.fallbackEnabled,
    healthCheck: normalizeStoredUserMcpHealthCheck(healthCheck),
  };
}
