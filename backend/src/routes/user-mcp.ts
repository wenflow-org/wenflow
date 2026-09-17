// 用户 MCP 配置路由
import express from 'express';
import prisma from '../config/database';
import { randomUUID as uuidv4 } from 'crypto';
import { safeHttpRequest } from '../utils/safe-http';
import { preserveNestedSecrets, preserveNestedSecretsById, toSecretSafeResponse } from '../utils/secret-redaction';
import { getGateway } from '../gateway';
import {
  normalizeStoredUserMcpHealthCheck,
  normalizeStoredUserMcpProviders,
  normalizeStoredUserMcpTools,
  parseUserMcpConfigUpdate,
  parseUserMcpProviders,
  parseUserMcpSecretJsonSafe,
  serializeUserMcpSecretJson,
  USER_MCP_SECRET_CONTEXTS,
} from '../services/mcp/user-mcp-config.service';

const PROVIDERS_CONTEXT = USER_MCP_SECRET_CONTEXTS.providers;
const TOOLS_CONTEXT = USER_MCP_SECRET_CONTEXTS.tools;
const HEALTH_CONTEXT = USER_MCP_SECRET_CONTEXTS.healthCheck;
const USER_MCP_VALIDATION_CODES = new Set([
  'MCP_CONFIG_INVALID',
  'MCP_PROVIDERS_INVALID',
  'MCP_PROVIDER_CONFIG_INVALID',
  'MCP_TOOLS_INVALID',
  'MCP_TOOL_CONFIG_INVALID',
  'MCP_USER_LOCAL_TOOL_FORBIDDEN'
]);
const MCP_EXECUTION_ERROR_MESSAGES: Record<string, string> = {
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
  MCP_TOOL_EXECUTION_FAILED: 'MCP 工具执行失败',
  SKILL_DISABLED: '该能力已被当前用户禁用'
};

function parseSecretJson(value: string | null, context: string, fallback: any) {
  return parseUserMcpSecretJsonSafe(value, context, fallback);
}

function serializeSecretJson(value: any, context: string) {
  return serializeUserMcpSecretJson(value, context);
}

function sendUserMcpValidationError(error: any, res: express.Response): boolean {
  if (!USER_MCP_VALIDATION_CODES.has(error?.code)) return false;
  res.status(error.status || 400).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    }
  });
  return true;
}

const router = express.Router();

// 获取用户 MCP 配置
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (!config) {
      res.json({
        success: true,
        data: {
          providers: [],
          tools: [],
          routingStrategy: 'priority',
          fallbackEnabled: true,
          healthCheck: null
        }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        providers: toSecretSafeResponse(normalizeStoredUserMcpProviders(
          parseSecretJson(config.providers, PROVIDERS_CONTEXT, [])
        )),
        tools: toSecretSafeResponse(normalizeStoredUserMcpTools(
          parseSecretJson(config.tools, TOOLS_CONTEXT, [])
        )),
        routingStrategy: config.routingStrategy,
        fallbackEnabled: config.fallbackEnabled,
        healthCheck: toSecretSafeResponse(normalizeStoredUserMcpHealthCheck(
          parseSecretJson(config.healthCheck, HEALTH_CONTEXT, null)
        ))
      }
    });
  } catch (error) {
    next(error);
  }
});

// 更新用户 MCP 配置
router.put('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { providers, tools, routingStrategy, fallbackEnabled, healthCheck } = parseUserMcpConfigUpdate(req.body);

    let config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    const existingProviders = normalizeStoredUserMcpProviders(
      parseSecretJson(config?.providers || null, PROVIDERS_CONTEXT, [])
    );
    const existingTools = normalizeStoredUserMcpTools(
      parseSecretJson(config?.tools || null, TOOLS_CONTEXT, [])
    );
    const existingHealthCheck = normalizeStoredUserMcpHealthCheck(
      parseSecretJson(config?.healthCheck || null, HEALTH_CONTEXT, null)
    );
    const mergedProviders = providers === undefined
      ? existingProviders
      : preserveNestedSecretsById(Array.isArray(providers) ? providers : [], existingProviders);
    const mergedTools = tools === undefined
      ? existingTools
      : preserveNestedSecretsById(tools, existingTools);
    const mergedHealthCheck = healthCheck === undefined
      ? existingHealthCheck
      : healthCheck === null
        ? null
        : preserveNestedSecrets(healthCheck, existingHealthCheck || {});
    const nextRoutingStrategy = routingStrategy || config?.routingStrategy || 'priority';
    const nextFallbackEnabled = fallbackEnabled ?? config?.fallbackEnabled ?? true;

    if (config) {
      const data: any = { updatedAt: new Date() };
      if (providers !== undefined) data.providers = serializeSecretJson(mergedProviders, PROVIDERS_CONTEXT);
      if (tools !== undefined) data.tools = serializeSecretJson(mergedTools, TOOLS_CONTEXT);
      if (routingStrategy !== undefined) data.routingStrategy = nextRoutingStrategy;
      if (fallbackEnabled !== undefined) data.fallbackEnabled = nextFallbackEnabled;
      if (healthCheck !== undefined) data.healthCheck = serializeSecretJson(mergedHealthCheck, HEALTH_CONTEXT);
      config = await prisma.user_mcp_configs.update({
        where: { userId },
        data
      });
    } else {
      const data: any = {
        id: uuidv4(),
        providers: serializeSecretJson(mergedProviders, PROVIDERS_CONTEXT),
        tools: serializeSecretJson(mergedTools, TOOLS_CONTEXT),
        routingStrategy: nextRoutingStrategy,
        fallbackEnabled: nextFallbackEnabled,
        healthCheck: serializeSecretJson(mergedHealthCheck, HEALTH_CONTEXT),
        updatedAt: new Date(),
        users: {
          connect: { id: userId }
        }
      };
      config = await prisma.user_mcp_configs.create({ data });
    }

    res.json({
      success: true,
      data: {
        providers: toSecretSafeResponse(mergedProviders),
        tools: toSecretSafeResponse(mergedTools),
        routingStrategy: nextRoutingStrategy,
        fallbackEnabled: nextFallbackEnabled,
        healthCheck: toSecretSafeResponse(mergedHealthCheck)
      }
    });
  } catch (error: any) {
    if (sendUserMcpValidationError(error, res)) return;
    next(error);
  }
});

// 获取供应商列表
router.get('/providers', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (!config || !config.providers) {
      res.json({
        success: true,
        data: []
      });
      return;
    }

    const providers = normalizeStoredUserMcpProviders(parseSecretJson(config.providers, PROVIDERS_CONTEXT, []));
    res.json({
      success: true,
      data: toSecretSafeResponse(providers)
    });
  } catch (error) {
    next(error);
  }
});

// 添加供应商
router.post('/providers', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    let provider = parseUserMcpProviders([req.body])[0];

    let config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    let providers = [];
    if (config && config.providers) {
      providers = normalizeStoredUserMcpProviders(parseSecretJson(config.providers, PROVIDERS_CONTEXT, []));
    }

    provider = preserveNestedSecretsById([provider], providers)[0];

    // 检查是否已存在
    const existingIndex = providers.findIndex((s: any) => (
      String(s.id || '').trim().toLowerCase() === provider.id.toLowerCase()
    ));
    if (existingIndex >= 0) {
      providers[existingIndex] = provider;
    } else {
      providers.push(provider);
    }
    providers = parseUserMcpProviders(providers);

    config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (config) {
      config = await prisma.user_mcp_configs.update({
        where: { userId },
        data: {
          providers: serializeSecretJson(providers, PROVIDERS_CONTEXT),
          updatedAt: new Date()
        }
      });
    } else {
      const data: any = {
        id: uuidv4(),
        providers: serializeSecretJson(providers, PROVIDERS_CONTEXT),
        tools: serializeSecretJson([], TOOLS_CONTEXT),
        routingStrategy: 'priority',
        fallbackEnabled: true,
        healthCheck: serializeSecretJson({}, HEALTH_CONTEXT),
        updatedAt: new Date(),
        users: {
          connect: { id: userId }
        }
      };
      config = await prisma.user_mcp_configs.create({ data });
    }

    res.json({
      success: true,
      data: { providers: toSecretSafeResponse(providers) }
    });
  } catch (error: any) {
    if (sendUserMcpValidationError(error, res)) return;
    next(error);
  }
});

// 删除供应商
router.delete('/providers/:id', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (!config || !config.providers) {
      return res.status(404).json({
        success: false,
        error: { message: '配置不存在' }
      });
    }

    let providers = normalizeStoredUserMcpProviders(parseSecretJson(config.providers, PROVIDERS_CONTEXT, []));
    const normalizedId = id.trim().toLowerCase();
    providers = providers.filter((s: any) => String(s.id || '').trim().toLowerCase() !== normalizedId);

    await prisma.user_mcp_configs.update({
      where: { userId },
      data: {
        providers: serializeSecretJson(providers, PROVIDERS_CONTEXT),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: { providers: toSecretSafeResponse(providers) }
    });
  } catch (error) {
    next(error);
  }
});

// 通过统一 Capability Runtime 执行 MCP 工具
router.post('/tools/:id/execute', async (req, res) => {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  req.once?.('aborted', abort);
  res.once?.('close', abort);
  try {
    const result = await getGateway().executeSkill('mcp-tool', {
      toolId: req.params.id,
      params: req.body?.params === undefined ? {} : req.body.params,
      signal: abortController.signal,
    });

    res.json({
      success: true,
      data: result.output,
      metadata: { duration: result.duration },
    });
  } catch (error: any) {
    if (req.aborted || res.destroyed) return;
    const rawCode = typeof error?.code === 'string' ? error.code : '';
    const code = Object.prototype.hasOwnProperty.call(MCP_EXECUTION_ERROR_MESSAGES, rawCode)
      ? rawCode
      : 'MCP_TOOL_EXECUTION_FAILED';
    const status = code === 'MCP_USER_LOCAL_TOOL_FORBIDDEN'
      || code === 'MCP_TOOL_ENDPOINT_FORBIDDEN'
      || code === 'MCP_TOOL_DISABLED'
      || code === 'SKILL_DISABLED'
      ? 403
      : code === 'MCP_TOOL_NOT_FOUND'
        ? 404
        : code === 'MCP_UPSTREAM_TIMEOUT'
          ? 504
          : code === 'MCP_UPSTREAM_HTTP_ERROR' || code === 'MCP_UPSTREAM_UNAVAILABLE'
            ? 502
            : code === 'MCP_TOOL_ID_REQUIRED'
              || code === 'MCP_TOOL_PARAMS_INVALID'
              || code === 'MCP_TOOL_CONFIG_INVALID'
              ? 400
              : 500;
    res.status(status).json({
      success: false,
      error: {
        code,
        message: MCP_EXECUTION_ERROR_MESSAGES[code] || 'MCP 工具执行失败',
      },
    });
  } finally {
    req.off?.('aborted', abort);
    res.off?.('close', abort);
  }
});

// 测试供应商连接
router.post('/test-connection', async (req, res, next) => {
  try {
    const { endpoint, apiKey } = req.body;

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: { message: '需要提供 endpoint' }
      });
    }

    try {
      const normalizedEndpoint = parseUserMcpProviders([{
        id: 'connection-test',
        name: 'connection-test',
        endpoint
      }])[0].endpoint.replace(/\/$/, '');
      const headers: any = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await safeHttpRequest<any>(`${normalizedEndpoint}/models`, {
        headers,
        timeoutMs: 5000,
        privateNetworkPolicy: 'public-only'
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      res.json({
        success: true,
        message: '连接成功',
        data: {
          models: response.data.data?.length || 0
        }
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: {
          message: '连接失败'
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

// 获取服务状态
router.get('/status', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (!config || !config.providers) {
      res.json({
        success: true,
        data: { providers: [] }
      });
      return;
    }

    const providers = normalizeStoredUserMcpProviders(parseSecretJson(config.providers, PROVIDERS_CONTEXT, []));
    // 安全加固：并发探测上限（分片串行），防止 /status 被用作并发出站请求放大面
    const MAX_CONCURRENT_STATUS_CHECKS = 5;
    const probeServer = async (provider: any) => {
      try {
        const headers: any = { 'Content-Type': 'application/json' };
        if (provider.apiKey) {
          headers['Authorization'] = `Bearer ${provider.apiKey}`;
        }

        const startTime = Date.now();
        const response = await safeHttpRequest(`${provider.endpoint}/models`, {
          headers,
          timeoutMs: 3000,
          privateNetworkPolicy: 'public-only'
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const duration = Date.now() - startTime;

        return {
          id: provider.id,
          name: provider.name,
          status: 'online',
          responseTime: duration
        };
      } catch {
        return {
          id: provider.id,
          name: provider.name,
          status: 'offline',
          responseTime: null
        };
      }
    };

    const statuses: any[] = [];
    for (let i = 0; i < providers.length; i += MAX_CONCURRENT_STATUS_CHECKS) {
      const chunk = providers.slice(i, i + MAX_CONCURRENT_STATUS_CHECKS);
      statuses.push(...(await Promise.all(chunk.map(probeServer))));
    }

    res.json({
      success: true,
      data: { providers: statuses }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
