/**
 * McpGateway - MCP (Model Context Protocol) 网关
 * 统一管理 AI 服务连接和工具调用
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeHttpRequest, UnsafeUrlError } from '../../utils/safe-http';
import { readFileWithinRoots } from '../../utils/secure-file-reader';

export interface IMcpServerConfig {
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

export interface IMcpToolConfig {
  id: string;
  name: string;
  description: string;
  type: string;
  endpoint: string;
  apiKey?: string;
  config?: Record<string, any>;
  enabled: boolean;
  userAccessible?: boolean;
}

export interface IMcpAgentConfig {
  mcpServer: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface IMcpConfig {
  version: string;
  description: string;
  servers: IMcpServerConfig[];
  tools: IMcpToolConfig[];
  agents: Record<string, IMcpAgentConfig>;
  routing: {
    strategy: string;
    fallback: boolean;
    healthCheck?: {
      enabled: boolean;
      interval: number;
    };
  };
}

export interface IChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

export interface IChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class McpGateway {
  private config: IMcpConfig;
  private serverStatus: Map<string, boolean> = new Map();
  private healthCheckTimer?: NodeJS.Timeout;
  private configPath: string;

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
   * 更新配置并原子写回 mcp.json（保留 $schema/agents/routing 等字段，只替换 servers/tools）
   */
  async updateConfig(next: Partial<Pick<IMcpConfig, 'servers' | 'tools'>>): Promise<void> {
    const raw = fs.readFileSync(this.configPath, 'utf-8').replace(/^\uFEFF/, '');
    const onDisk: IMcpConfig = JSON.parse(raw);
    if (next.servers !== undefined && !Array.isArray(next.servers)) {
      throw new Error('servers 必须是数组');
    }
    if (next.tools !== undefined && !Array.isArray(next.tools)) {
      throw new Error('tools 必须是数组');
    }
    const merged: IMcpConfig = {
      ...onDisk,
      ...(next.servers !== undefined ? { servers: next.servers } : {}),
      ...(next.tools !== undefined ? { tools: next.tools } : {}),
    };
    const tmpPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.configPath);
    this.config = this.loadConfig(this.configPath);
    this.serverStatus.clear();
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
    const config: IMcpConfig = JSON.parse(content);

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
   * 获取可用的 MCP 服务器
   */
  getAvailableServers(): IMcpServerConfig[] {
    return this.config.servers
      .filter(s => s.enabled && this.serverStatus.get(s.id) !== false)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取指定 ID 的服务器配置
   */
  getServer(serverId: string): IMcpServerConfig | undefined {
    return this.config.servers.find(s => s.id === serverId && s.enabled);
  }

  getTool(toolId: string): IMcpToolConfig | undefined {
    const normalizedId = toolId.trim().toLowerCase();
    return this.config.tools.find(tool => tool.id.trim().toLowerCase() === normalizedId && tool.enabled);
  }

  /**
   * 获取 Agent 的 MCP 配置
   */
  getAgentMcpConfig(agentId: string): IMcpAgentConfig | undefined {
    return this.config.agents[agentId];
  }

  /**
   * 调用 Chat Completion
   */
  async chatCompletion(
    request: IChatCompletionRequest,
    serverId?: string
  ): Promise<IChatCompletionResponse> {
    const server = serverId
      ? this.getServer(serverId)
      : this.getAvailableServers()[0];

    if (!server) {
      throw new Error('没有可用的 MCP 服务器');
    }

    const url = `${server.endpoint}/chat/completions`;

    try {
      const response = await safeHttpRequest<IChatCompletionResponse>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.apiKey}`,
        },
        body: {
          model: request.model || server.defaultModel,
          messages: request.messages,
          temperature: request.temperature ?? server.config.temperature,
          max_tokens: request.max_tokens ?? server.config.maxTokens,
        },
        timeoutMs: server.config.timeout,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`MCP 服务器错误: ${response.status} ${response.statusText}`);
      }

      const data = response.data;
      
      // 验证响应格式
      if (!data.choices || !Array.isArray(data.choices)) {
        throw new Error('MCP 响应格式错误：缺少 choices 字段');
      }

      return data;
    } catch (error: any) {
      // 标记服务器不可用
      this.serverStatus.set(server.id, false);

      // 如果启用了 fallback，尝试下一个服务器
      if (this.config.routing.fallback && !serverId) {
        const nextServer = this.getAvailableServers().find(s => s.id !== server.id);
        if (nextServer) {
          return await this.chatCompletion(request, nextServer.id);
        }
      }

      // 如果没有可用服务器或 fallback 失败，抛出错误
      throw error;
    }
  }

  /**
   * 调用工具
   */
  async callTool(toolId: string, params: any, options: { signal?: AbortSignal } = {}): Promise<any> {
    const tool = this.getTool(toolId);
    if (!tool) {
      throw new Error(`工具 ${toolId} 不存在或未启用`);
    }

    return this.callConfiguredTool(tool, params, { allowLocal: true, signal: options.signal });
  }

  async callConfiguredTool(
    tool: IMcpToolConfig,
    params: any,
    options: {
      allowLocal?: boolean;
      privateNetworkPolicy?: 'runtime' | 'public-only';
      signal?: AbortSignal;
    } = {}
  ): Promise<any> {
    if (!tool.enabled) {
      throw Object.assign(new Error(`工具 ${tool.id} 不存在或未启用`), {
        code: 'MCP_TOOL_DISABLED'
      });
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
      // 远程工具调用
      const response = await safeHttpRequest<any>(tool.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tool.apiKey && { 'Authorization': `Bearer ${tool.apiKey}` }),
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

  /**
   * 执行本地工具
   */
  private async executeLocalTool(tool: IMcpToolConfig, params: any): Promise<any> {
    switch (tool.type) {
      case 'code':
        // 代码解释器 - 使用 vm2 或子进程执行
        return { result: '代码执行功能待实现' };
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
   * 健康检查
   */
  private initHealthCheck(): void {
    if (!this.config.routing.healthCheck?.enabled) return;

    const interval = this.config.routing.healthCheck.interval;

    this.healthCheckTimer = setInterval(async () => {
      for (const server of this.config.servers) {
        if (!server.enabled) continue;

        try {
          const response = await safeHttpRequest(`${server.endpoint}/models`, {
            headers: { 'Authorization': `Bearer ${server.apiKey}` },
            timeoutMs: server.config.timeout,
          });
          this.serverStatus.set(server.id, response.status >= 200 && response.status < 300);
        } catch {
          this.serverStatus.set(server.id, false);
        }
      }
    }, interval);
    this.healthCheckTimer.unref?.();
  }

  /**
   * 获取网关状态
   */
  getStatus() {
    return {
      servers: this.config.servers.map(s => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        healthy: this.serverStatus.get(s.id) ?? true,
      })),
      tools: this.config.tools.map(t => ({
        id: t.id,
        name: t.name,
        enabled: t.enabled,
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
