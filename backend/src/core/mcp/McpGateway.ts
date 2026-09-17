/**
 * McpGateway - MCP (Model Context Protocol) 网关
 * 统一管理 AI 服务连接和工具调用
 */

import * as fs from 'fs';
import * as path from 'path';
import { decryptSecret, encryptSecret } from '../../utils/secret-crypto';
import { safeHttpRequest, UnsafeUrlError } from '../../utils/safe-http';
import { readFileWithinRoots } from '../../utils/secure-file-reader';
import { McpClient, type McpToolDescriptor } from './McpClient';

const MCP_SECRET_CONTEXT = 'system.mcp_config.apiKey';
const ENV_TEMPLATE_PATTERN = /^\$\{[\s\S]*\}$/;
/** 真 MCP server 工具列表的缓存 TTL（可用 tool.config.toolsTtlMs 覆盖） */
const DEFAULT_MCP_TOOLS_TTL_MS = 5 * 60_000;
/** MCP 工具寻址分隔符：<serverId>:<toolName>（TOOL_ID_PATTERN 已允许 ":"） */
const MCP_TOOL_REF_SEPARATOR = ':';

function encryptStoredApiKey(value: string | undefined): string | undefined {
  if (!value) return value;
  // 环境变量模板（${VAR}）保持原样，仅对真实明文密钥加密
  if (ENV_TEMPLATE_PATTERN.test(value)) return value;
  return encryptSecret(value, MCP_SECRET_CONTEXT) ?? value;
}

function decryptStoredApiKey(value: string | undefined): string | undefined {
  // decryptSecret 对明文幂等（非 wfsec: 前缀原样返回）
  return value ? (decryptSecret(value, MCP_SECRET_CONTEXT) ?? value) : value;
}

/**
 * 外挂服务/供应商连接（LLM provider）。
 *
 * 注意：这里只是「连接与状态」的登记，**仅供管理端展示与健康检查，不参与运行时模型路由**——
 * 运行时模型路由的真实来源是 system 库 platform_api_configs。
 * 历史上该字段名为 servers（与 MCP server 混淆），已更名为 providers。
 */
export interface IMcpProviderConfig {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'openai-compatible';
  endpoint: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
  priority: number;
  enabled: boolean;
  config: {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
  };
}

/** 旧字段名：历史配置用 `servers` 表示「外挂服务/供应商」，加载时迁移为 providers */
const LEGACY_PROVIDERS_KEY = 'servers';

export interface IMcpToolConfig {
  id: string;
  name: string;
  description: string;
  type: string;
  /**
   * 连接方式：
   * - 'http'（默认，缺省即此值）：通用 HTTP 端点，调用时把 params 原样 POST 过去；
   * - 'mcp'：该条目代表「一个真 MCP server」，endpoint 是 server 地址，
   *        其工具在运行时经 tools/list 发现并按 `<id>:<toolName>` 寻址调用。
   */
  transport?: 'http' | 'mcp';
  endpoint: string;
  apiKey?: string;
  config?: Record<string, any>;
  enabled: boolean;
  userAccessible?: boolean;
}

/** 解析 `<serverId>:<toolName>` 形式的 MCP 工具引用 */
function parseMcpToolRef(toolId: string): { serverId: string; toolName: string } | null {
  const index = toolId.indexOf(MCP_TOOL_REF_SEPARATOR);
  if (index <= 0 || index === toolId.length - 1) return null;
  return { serverId: toolId.slice(0, index), toolName: toolId.slice(index + 1) };
}

function isMcpTransport(tool: IMcpToolConfig | undefined): boolean {
  return tool?.transport === 'mcp';
}

export interface IMcpConfig {
  version: string;
  description: string;
  /** 外挂服务/供应商连接（展示 + 健康检查；不参与运行时模型路由） */
  providers: IMcpProviderConfig[];
  tools: IMcpToolConfig[];
  routing: {
    strategy: string;
    fallback: boolean;
    healthCheck?: {
      enabled: boolean;
      interval: number;
    };
  };
}

interface IMcpToolsCacheEntry {
  tools: McpToolDescriptor[];
  fetchedAt: number;
}

export class McpGateway {
  private config: IMcpConfig;
  private providerStatus: Map<string, boolean> = new Map();
  private healthCheckTimer?: NodeJS.Timeout;
  private configPath: string;
  /** 真 MCP server 的 tools/list 结果缓存（key = serverId） */
  private mcpToolsCache: Map<string, IMcpToolsCacheEntry> = new Map();

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(__dirname, '../../../config/mcp.json');
    this.config = this.loadConfig(this.configPath);
    this.initHealthCheck();
  }

  /** 当前配置（管理台只读展示/编辑用） */
  getConfig(): IMcpConfig {
    return this.config;
  }

  /**
   * 更新配置并原子写回 mcp.json（保留 $schema/routing 等字段，只替换 providers/tools；
   * apiKey 落盘前加密，环境变量模板 ${VAR} 保持原样）
   */
  async updateConfig(next: Partial<Pick<IMcpConfig, 'providers' | 'tools'>>): Promise<void> {
    const raw = fs.readFileSync(this.configPath, 'utf-8').replace(/^\uFEFF/, '');
    // 读原始 JSON（不能用 loadConfig：它会做环境变量替换，写回会把 ${VAR} 模板固化为实际值）
    const onDisk = JSON.parse(raw) as IMcpConfig & Record<string, unknown>;
    // 旧字段名归一到 providers，并清除旧键（避免写回后两者同存）
    if (onDisk.providers === undefined && Array.isArray(onDisk[LEGACY_PROVIDERS_KEY])) {
      onDisk.providers = onDisk[LEGACY_PROVIDERS_KEY] as IMcpProviderConfig[];
    }
    delete onDisk[LEGACY_PROVIDERS_KEY];
    if (!Array.isArray(onDisk.providers)) {
      onDisk.providers = [];
    }

    if (next.providers !== undefined && !Array.isArray(next.providers)) {
      throw new Error('providers 必须是数组');
    }
    if (next.tools !== undefined && !Array.isArray(next.tools)) {
      throw new Error('tools 必须是数组');
    }
    const merged: IMcpConfig = {
      ...onDisk,
      ...(next.providers !== undefined
        ? { providers: next.providers.map(provider => ({ ...provider, apiKey: encryptStoredApiKey(provider.apiKey) })) }
        : {}),
      ...(next.tools !== undefined
        ? { tools: next.tools.map(tool => (
            tool.apiKey !== undefined ? { ...tool, apiKey: encryptStoredApiKey(tool.apiKey) } : tool
          )) }
        : {}),
    };
    const tmpPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.configPath);
    this.config = this.loadConfig(this.configPath);
    this.providerStatus.clear();
    this.mcpToolsCache.clear();
  }

  /**
   * 加载 MCP 配置
   */
  private loadConfig(configPath?: string): IMcpConfig {
    const defaultPath = path.join(__dirname, '../../../config/mcp.json');
    const filePath = configPath || defaultPath;

    if (!fs.existsSync(filePath)) {
      throw new Error(`MCP 配置文件不存在: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const config = JSON.parse(content) as IMcpConfig & Record<string, unknown>;

    // 旧字段名迁移：历史配置用 servers 表示「外挂服务/供应商」，加载时归一到 providers
    const legacyProviders = config[LEGACY_PROVIDERS_KEY];
    if (config.providers === undefined && Array.isArray(legacyProviders)) {
      config.providers = legacyProviders as IMcpProviderConfig[];
    }
    delete config[LEGACY_PROVIDERS_KEY];
    if (!Array.isArray(config.providers)) {
      config.providers = [];
    }

    // 环境变量替换
    this.replaceEnvVars(config);

    return config;
  }

  /**
   * 替换环境变量
   */
  private replaceEnvVars(obj: any): void {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key].replace(/\$\{([^}]+)\}/g, (match, varName) => {
          const [name, defaultValue] = varName.split(':-');
          return process.env[name] || defaultValue || match;
        });
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        this.replaceEnvVars(obj[key]);
      }
    }
  }

  /**
   * 获取指定 ID 的启用工具
   */
  getTool(toolId: string): IMcpToolConfig | undefined {
    const normalizedId = toolId.trim().toLowerCase();
    return this.config.tools.find(tool => tool.id.trim().toLowerCase() === normalizedId && tool.enabled);
  }

  /**
   * 调用工具。
   *
   * 寻址优先级：
   * 1. `tools[]` 中 id 精确匹配（既有行为，含本地工具）；
   * 2. `<serverId>:<toolName>`，且 serverId 命中一个 transport='mcp' 的条目时，走真 MCP 调用。
   */
  async callTool(toolId: string, params: any, options: { signal?: AbortSignal } = {}): Promise<any> {
    const tool = this.getTool(toolId);
    if (tool) {
      return this.callConfiguredTool(tool, params, { allowLocal: true, signal: options.signal });
    }

    const ref = this.resolveMcpToolRef(toolId);
    if (ref) {
      return this.callConfiguredTool(ref.server, params, {
        allowLocal: false,
        mcpToolName: ref.toolName,
        signal: options.signal,
      });
    }

    throw new Error(`工具 ${toolId} 不存在或未启用`);
  }

  /**
   * 解析 `<serverId>:<toolName>`：仅当 serverId 命中一个启用的 transport='mcp' 条目时才成立，
   * 因此不会误伤 id 中恰好含 ":" 的普通 HTTP 工具（那些走精确匹配分支）。
   */
  private resolveMcpToolRef(toolId: string): { server: IMcpToolConfig; toolName: string } | null {
    const parsed = parseMcpToolRef(toolId.trim());
    if (!parsed) return null;
    const server = this.getTool(parsed.serverId);
    if (!server || !isMcpTransport(server)) return null;
    return { server, toolName: parsed.toolName };
  }

  async callConfiguredTool(
    tool: IMcpToolConfig,
    params: any,
    options: {
      allowLocal?: boolean;
      privateNetworkPolicy?: 'runtime' | 'public-only';
      signal?: AbortSignal;
      /** transport='mcp' 时必填：服务端工具名 */
      mcpToolName?: string;
    } = {}
  ): Promise<any> {
    if (!tool.enabled) {
      throw Object.assign(new Error(`工具 ${tool.id} 不存在或未启用`), {
        code: 'MCP_TOOL_DISABLED'
      });
    }

    if (isMcpTransport(tool)) {
      return this.callMcpServerTool(tool, options.mcpToolName, params, options);
    }

    if (typeof tool.endpoint === 'string' && tool.endpoint.trim().toLowerCase() === 'local') {
      if (!options.allowLocal) {
        throw new Error('当前调用来源不允许执行服务器本地 MCP 工具');
      }
      return this.executeLocalTool(tool, params);
    }

    if (!tool.endpoint) {
      throw Object.assign(new Error(`工具 ${tool.id} 未配置 endpoint`), {
        code: 'MCP_TOOL_CONFIG_INVALID'
      });
    }

    try {
      // 远程工具调用（apiKey 落盘为密文，调用时解密；明文/用户级已解密值幂等直通）
      const response = await safeHttpRequest<any>(tool.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tool.apiKey && { 'Authorization': `Bearer ${decryptStoredApiKey(tool.apiKey)}` }),
        },
        body: params,
        timeoutMs: tool.config?.timeout,
        privateNetworkPolicy: options.privateNetworkPolicy,
        signal: options.signal,
      });

      if (response.status < 200 || response.status >= 300) {
        const timeout = response.status === 408 || response.status === 504;
        throw Object.assign(new Error(timeout ? 'MCP 上游工具响应超时' : 'MCP 上游工具返回错误'), {
          code: timeout ? 'MCP_UPSTREAM_TIMEOUT' : 'MCP_UPSTREAM_HTTP_ERROR'
        });
      }

      return response.data;
    } catch (error: any) {
      if (error?.code?.startsWith?.('MCP_')) throw error;
      if (error instanceof UnsafeUrlError) {
        throw Object.assign(new Error('MCP 工具地址不允许访问'), {
          code: 'MCP_TOOL_ENDPOINT_FORBIDDEN'
        });
      }
      if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
        throw Object.assign(new Error('MCP 上游工具响应超时'), {
          code: 'MCP_UPSTREAM_TIMEOUT'
        });
      }
      throw Object.assign(new Error('MCP 上游工具暂时不可用'), {
        code: 'MCP_UPSTREAM_UNAVAILABLE'
      });
    }
  }

  /* ================= 真 MCP server（transport='mcp'） ================= */

  /** 取一个启用的 MCP server 条目；非 MCP/不存在/未启用都抛带 code 的错误 */
  private requireMcpServer(serverId: string): IMcpToolConfig {
    const server = this.getTool(serverId);
    if (!server) {
      throw Object.assign(new Error(`MCP server ${serverId} 不存在或未启用`), {
        code: 'MCP_SERVER_NOT_FOUND'
      });
    }
    if (!isMcpTransport(server)) {
      throw Object.assign(new Error(`${serverId} 不是 MCP server（transport != 'mcp'）`), {
        code: 'MCP_SERVER_TRANSPORT_MISMATCH'
      });
    }
    if (!server.endpoint) {
      throw Object.assign(new Error(`MCP server ${serverId} 未配置 endpoint`), {
        code: 'MCP_TOOL_CONFIG_INVALID'
      });
    }
    return server;
  }

  private createMcpClient(
    server: IMcpToolConfig,
    options: { privateNetworkPolicy?: 'runtime' | 'public-only'; signal?: AbortSignal } = {}
  ): McpClient {
    return new McpClient({
      endpoint: server.endpoint,
      apiKey: decryptStoredApiKey(server.apiKey),
      clientName: 'wenflow',
      clientVersion: '1.0.0',
      timeoutMs: server.config?.timeout,
      privateNetworkPolicy: options.privateNetworkPolicy,
      signal: options.signal,
    });
  }

  /** 列出某个 MCP server 的工具（带 TTL 缓存；refresh=true 强制重取） */
  async listMcpServerTools(
    serverId: string,
    options: { refresh?: boolean; privateNetworkPolicy?: 'runtime' | 'public-only'; signal?: AbortSignal } = {}
  ): Promise<McpToolDescriptor[]> {
    const server = this.requireMcpServer(serverId);
    const ttl = Number(server.config?.toolsTtlMs) > 0
      ? Number(server.config?.toolsTtlMs)
      : DEFAULT_MCP_TOOLS_TTL_MS;
    const cached = this.mcpToolsCache.get(server.id);
    if (!options.refresh && cached && Date.now() - cached.fetchedAt < ttl) {
      return cached.tools;
    }

    try {
      const client = this.createMcpClient(server, options);
      await client.initialize();
      const tools = await client.listTools();
      this.mcpToolsCache.set(server.id, { tools, fetchedAt: Date.now() });
      return tools;
    } catch (error: any) {
      if (error?.code?.startsWith?.('MCP_')) throw error;
      throw Object.assign(new Error(`MCP server ${serverId} 工具发现失败`), {
        code: 'MCP_UPSTREAM_UNAVAILABLE'
      });
    }
  }

  /** 调用 MCP server 上的某个工具 */
  private async callMcpServerTool(
    server: IMcpToolConfig,
    toolName: string | undefined,
    params: any,
    options: { privateNetworkPolicy?: 'runtime' | 'public-only'; signal?: AbortSignal } = {}
  ): Promise<any> {
    if (!toolName || !toolName.trim()) {
      throw Object.assign(
        new Error(`调用 MCP server ${server.id} 需指定工具名，形如 ${server.id}:<toolName>`),
        { code: 'MCP_TOOL_NAME_REQUIRED' }
      );
    }
    this.requireMcpServer(server.id);

    const args = params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};

    let result;
    try {
      const client = this.createMcpClient(server, options);
      await client.initialize();
      result = await client.callTool(toolName.trim(), args);
    } catch (error: any) {
      if (error?.code === 'MCP_ENDPOINT_FORBIDDEN') {
        throw Object.assign(new Error('MCP 工具地址不允许访问'), {
          code: 'MCP_TOOL_ENDPOINT_FORBIDDEN'
        });
      }
      if (error?.code === 'MCP_UNAUTHORIZED') {
        throw Object.assign(new Error('MCP server 鉴权失败'), {
          code: 'MCP_TOOL_CONFIG_INVALID'
        });
      }
      if (error?.code?.startsWith?.('MCP_')) throw error;
      throw Object.assign(new Error('MCP 上游工具暂时不可用'), {
        code: 'MCP_UPSTREAM_UNAVAILABLE'
      });
    }

    if (result.isError) {
      throw Object.assign(new Error(`MCP 工具 ${toolName} 返回错误`), {
        code: 'MCP_UPSTREAM_TOOL_ERROR'
      });
    }

    // 忠实返回 MCP 结果：content[]（可能含 text JSON）+ 可选 structuredContent
    return {
      content: result.content,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
    };
  }

  /**
   * 执行本地工具
   */
  private async executeLocalTool(tool: IMcpToolConfig, params: any): Promise<any> {
    switch (tool.type) {
      case 'filesystem':
        // 文件读取
        return this.executeFileTool(tool, params);
      default:
        throw new Error(`未知的本地工具类型: ${tool.type}`);
    }
  }

  /**
   * 执行文件工具
   */
  private async executeFileTool(tool: IMcpToolConfig, params: any): Promise<any> {
    const allowedPaths = tool.config?.allowedPaths || [];
    const filePath = params?.path;
    const content = await readFileWithinRoots({
      filePath,
      allowedRoots: allowedPaths,
      maxFileSize: tool.config?.maxFileSize
    });
    return { content, path: filePath };
  }

  /**
   * 健康检查：低频轮询 + 失败退避；策略拒绝（https-only / 私网策略）不误伤服务器状态
   */
  private healthCheckBackoffUntil: Map<string, number> = new Map();

  private healthCheckBackoffMs(interval: number): number {
    return Math.max(interval, 60_000) * 3;
  }

  private async runHealthCheck(provider: IMcpProviderConfig, interval: number): Promise<void> {
    const backoffUntil = this.healthCheckBackoffUntil.get(provider.id) || 0;
    if (Date.now() < backoffUntil) return;

    try {
      const response = await safeHttpRequest(`${provider.endpoint}/models`, {
        headers: { 'Authorization': `Bearer ${decryptStoredApiKey(provider.apiKey)}` },
        timeoutMs: provider.config.timeout,
      });
      const healthy = response.status >= 200 && response.status < 300;
      this.providerStatus.set(provider.id, healthy);
      if (healthy) {
        this.healthCheckBackoffUntil.delete(provider.id);
      } else {
        this.healthCheckBackoffUntil.set(provider.id, Date.now() + this.healthCheckBackoffMs(interval));
      }
    } catch (error) {
      const backoffUntil = Date.now() + this.healthCheckBackoffMs(interval);
      if (error instanceof UnsafeUrlError) {
        // 策略拒绝（如生产环境 https-only 拦截 http 端点）非真实故障：保留原状态，仅退避，避免误伤
        this.healthCheckBackoffUntil.set(provider.id, backoffUntil);
        return;
      }
      this.providerStatus.set(provider.id, false);
      this.healthCheckBackoffUntil.set(provider.id, backoffUntil);
    }
  }

  private initHealthCheck(): void {
    if (!this.config.routing.healthCheck?.enabled) return;

    const interval = this.config.routing.healthCheck.interval;

    this.healthCheckTimer = setInterval(() => {
      for (const provider of this.config.providers) {
        if (!provider.enabled) continue;
        void this.runHealthCheck(provider, interval);
      }
    }, interval);
    this.healthCheckTimer.unref?.();
  }

  /**
   * 获取网关状态
   */
  getStatus() {
    return {
      providers: this.config.providers.map(p => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        healthy: this.providerStatus.get(p.id) ?? true,
      })),
      tools: this.config.tools.map(t => ({
        id: t.id,
        name: t.name,
        transport: t.transport || 'http',
        enabled: t.enabled,
        // 真 MCP server：已发现并缓存的工具名（未发现时为空数组）
        ...(isMcpTransport(t)
          ? { discoveredTools: (this.mcpToolsCache.get(t.id)?.tools || []).map(tool => tool.name) }
          : {}),
      })),
    };
  }

  /**
   * 销毁网关
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    this.healthCheckTimer = undefined;
  }
}

// 导出单例
export const mcpGateway = new McpGateway();
