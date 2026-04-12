/**
 * McpGateway - MCP (Model Context Protocol) 网关
 * 统一管理 AI 服务连接和工具调用
 */

import * as fs from 'fs';
import * as path from 'path';

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

  constructor(configPath?: string) {
    this.config = this.loadConfig(configPath);
    this.initHealthCheck();
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

    const content = fs.readFileSync(filePath, 'utf-8');
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
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || server.defaultModel,
          messages: request.messages,
          temperature: request.temperature ?? server.config.temperature,
          max_tokens: request.max_tokens ?? server.config.maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`MCP 服务器错误: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as IChatCompletionResponse;
      
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
  async callTool(toolId: string, params: any): Promise<any> {
    const tool = this.config.tools.find(t => t.id === toolId && t.enabled);
    if (!tool) {
      throw new Error(`工具 ${toolId} 不存在或未启用`);
    }

    if (tool.endpoint === 'local') {
      return this.executeLocalTool(tool, params);
    }

    // 远程工具调用
    const response = await fetch(tool.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tool.apiKey && { 'Authorization': `Bearer ${tool.apiKey}` }),
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`工具调用失败: ${response.status}`);
    }

    return response.json();
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
    const filePath = params.path;

    // 安全检查
    const isAllowed = allowedPaths.some((p: string) => filePath.startsWith(p));
    if (!isAllowed) {
      throw new Error('文件路径不在允许范围内');
    }

    const content = fs.readFileSync(filePath, 'utf-8');
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
          const response = await fetch(`${server.endpoint}/models`, {
            headers: { 'Authorization': `Bearer ${server.apiKey}` },
          });
          this.serverStatus.set(server.id, response.ok);
        } catch {
          this.serverStatus.set(server.id, false);
        }
      }
    }, interval);
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
  }
}

// 导出单例
export const mcpGateway = new McpGateway();
