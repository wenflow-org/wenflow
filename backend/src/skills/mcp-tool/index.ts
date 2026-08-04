import { mcpGateway } from '../../core/mcp/McpGateway';
import { getRequestContext } from '../../gateway/api-gateway/context';
import { getUserMcpRuntimeConfig, isLocalMcpTool } from '../../services/mcp/user-mcp-config.service';
import { SkillDefinition, SkillExecutionResult } from '../protocol';

export interface McpToolInput {
  toolId: string;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface McpToolOutput {
  toolId: string;
  source: 'user' | 'platform';
  result: unknown;
}

export const mcpToolDefinition: SkillDefinition = {
  name: 'mcp-tool',
  displayName: 'MCP 工具调用',
  version: '1.0.0',
  category: 'computation',
  description: '在统一 Capability Runtime 中调用用户或平台配置的 MCP 工具',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      toolId: { type: 'string', description: 'MCP 工具 ID', required: true },
      params: { type: 'object', description: '工具参数' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      toolId: { type: 'string' },
      source: { type: 'string' },
      result: { type: 'any' },
    },
  },
  capabilities: ['mcp-tool-invocation', 'external-tool', 'user-configured-tool'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

const MCP_ERROR_MESSAGES: Record<string, string> = {
  MCP_TOOL_ID_REQUIRED: 'MCP toolId 不能为空',
  MCP_TOOL_PARAMS_INVALID: 'MCP params 必须是对象',
  MCP_TOOL_NOT_FOUND: 'MCP 工具不存在',
  MCP_TOOL_DISABLED: 'MCP 工具已禁用',
  MCP_USER_LOCAL_TOOL_FORBIDDEN: '用户 MCP 配置不允许声明服务器本地工具',
  MCP_TOOL_ENDPOINT_FORBIDDEN: 'MCP 工具地址不允许访问',
  MCP_TOOL_CONFIG_INVALID: 'MCP 工具配置无效',
  MCP_UPSTREAM_HTTP_ERROR: 'MCP 上游工具返回错误',
  MCP_UPSTREAM_UNAVAILABLE: 'MCP 上游工具暂时不可用',
  MCP_UPSTREAM_TIMEOUT: 'MCP 上游工具响应超时',
};

export async function executeMcpTool(input: McpToolInput): Promise<SkillExecutionResult<McpToolOutput>> {
  const startedAt = Date.now();
  const toolId = typeof input?.toolId === 'string' ? input.toolId.trim().toLowerCase() : '';
  if (!toolId) {
    return {
      success: false,
      error: { code: 'MCP_TOOL_ID_REQUIRED', message: 'MCP toolId 不能为空' },
      duration: Date.now() - startedAt,
    };
  }
  if (input.params !== undefined
    && (!input.params || typeof input.params !== 'object' || Array.isArray(input.params))) {
    return {
      success: false,
      error: { code: 'MCP_TOOL_PARAMS_INVALID', message: 'MCP params 必须是对象' },
      duration: Date.now() - startedAt,
    };
  }

  try {
    const requestContext = getRequestContext();
    const userId = requestContext.userId;
    if (userId && userId !== 'system') {
      const userConfig = await getUserMcpRuntimeConfig(userId);
      const userTool = userConfig?.tools.find((tool) => tool.id.toLowerCase() === toolId);

      if (userTool) {
        if (!userTool.enabled) {
          throw Object.assign(new Error(`MCP 工具 ${toolId} 已被用户禁用`), {
            code: 'MCP_TOOL_DISABLED',
          });
        }
        if (isLocalMcpTool(userTool)) {
          throw Object.assign(new Error('用户 MCP 配置不允许声明服务器本地工具'), {
            code: 'MCP_USER_LOCAL_TOOL_FORBIDDEN',
          });
        }

        const result = await mcpGateway.callConfiguredTool(userTool, input.params || {}, {
          allowLocal: false,
          privateNetworkPolicy: 'public-only',
          signal: input.signal,
        });
        return {
          success: true,
          output: { toolId, source: 'user', result },
          duration: Date.now() - startedAt,
        };
      }

      if (userConfig?.invalidToolIds?.includes(toolId)) {
        throw Object.assign(new Error(`用户 MCP 工具 ${toolId} 配置无效`), {
          code: 'MCP_TOOL_CONFIG_INVALID',
        });
      }

      if (userConfig?.toolsConfigInvalid) {
        throw Object.assign(new Error('用户 MCP tools 配置无效'), {
          code: 'MCP_TOOL_CONFIG_INVALID',
        });
      }

      if (userConfig?.fallbackEnabled === false) {
        throw Object.assign(new Error(`用户 MCP 配置中不存在工具 ${toolId}`), {
          code: 'MCP_TOOL_NOT_FOUND',
        });
      }
    }

    const platformTool = mcpGateway.getTool(toolId);
    if (!platformTool) {
      throw Object.assign(new Error(`平台 MCP 配置中不存在工具 ${toolId}`), {
        code: 'MCP_TOOL_NOT_FOUND',
      });
    }
    const privilegedCaller = requestContext.userRole === 'admin' || userId === 'system';
    if (!privilegedCaller && (platformTool.userAccessible !== true || isLocalMcpTool(platformTool))) {
      throw Object.assign(new Error(`平台 MCP 配置中不存在工具 ${toolId}`), {
        code: 'MCP_TOOL_NOT_FOUND',
      });
    }

    const result = privilegedCaller
      ? await mcpGateway.callTool(toolId, input.params || {}, { signal: input.signal })
      : await mcpGateway.callConfiguredTool(platformTool, input.params || {}, {
          allowLocal: false,
          privateNetworkPolicy: 'public-only',
          signal: input.signal,
        });
    return {
      success: true,
      output: { toolId, source: 'platform', result },
      duration: Date.now() - startedAt,
    };
  } catch (error: any) {
    const code = error?.code && MCP_ERROR_MESSAGES[error.code]
      ? error.code
      : 'MCP_TOOL_EXECUTION_FAILED';
    return {
      success: false,
      error: {
        code,
        message: MCP_ERROR_MESSAGES[code] || 'MCP 工具执行失败',
      },
      duration: Date.now() - startedAt,
    };
  }
}
