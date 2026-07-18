// 用户 MCP 配置路由
import express from 'express';
import prisma from '../config/database';
import { randomUUID as uuidv4 } from 'crypto';
import { safeHttpRequest } from '../utils/safe-http';
import { preserveNestedSecrets, preserveNestedSecretsById, toSecretSafeResponse } from '../utils/secret-redaction';
import { decryptSecretTree, encryptSecretTree } from '../utils/secret-crypto';

const SERVERS_CONTEXT = 'main.user_mcp_configs.servers';
const TOOLS_CONTEXT = 'main.user_mcp_configs.tools';
const HEALTH_CONTEXT = 'main.user_mcp_configs.healthCheck';

function parseSecretJson(value: string | null, context: string, fallback: any) {
  return value ? decryptSecretTree(JSON.parse(value), context) : fallback;
}

function serializeSecretJson(value: any, context: string) {
  return JSON.stringify(encryptSecretTree(value, context));
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
          servers: [],
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
        servers: toSecretSafeResponse(parseSecretJson(config.servers, SERVERS_CONTEXT, [])),
        tools: toSecretSafeResponse(parseSecretJson(config.tools, TOOLS_CONTEXT, [])),
        routingStrategy: config.routingStrategy,
        fallbackEnabled: config.fallbackEnabled,
        healthCheck: toSecretSafeResponse(parseSecretJson(config.healthCheck, HEALTH_CONTEXT, null))
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
    const { servers, tools, routingStrategy, fallbackEnabled, healthCheck } = req.body;

    let config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    const existingServers = parseSecretJson(config?.servers || null, SERVERS_CONTEXT, []);
    const existingTools = parseSecretJson(config?.tools || null, TOOLS_CONTEXT, []);
    const existingHealthCheck = parseSecretJson(config?.healthCheck || null, HEALTH_CONTEXT, {});
    const mergedServers = preserveNestedSecretsById(Array.isArray(servers) ? servers : [], existingServers);
    const mergedTools = preserveNestedSecretsById(Array.isArray(tools) ? tools : [], existingTools);
    const mergedHealthCheck = preserveNestedSecrets(healthCheck || {}, existingHealthCheck);

    if (config) {
      config = await prisma.user_mcp_configs.update({
        where: { userId },
        data: {
          servers: serializeSecretJson(mergedServers, SERVERS_CONTEXT),
          tools: serializeSecretJson(mergedTools, TOOLS_CONTEXT),
          routingStrategy: routingStrategy || 'priority',
          fallbackEnabled: fallbackEnabled !== false,
          healthCheck: serializeSecretJson(mergedHealthCheck, HEALTH_CONTEXT),
          updatedAt: new Date()
        }
      });
    } else {
      const data: any = {
        id: uuidv4(),
        servers: serializeSecretJson(mergedServers, SERVERS_CONTEXT),
        tools: serializeSecretJson(mergedTools, TOOLS_CONTEXT),
        routingStrategy: routingStrategy || 'priority',
        fallbackEnabled: fallbackEnabled !== false,
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
        servers: toSecretSafeResponse(mergedServers),
        tools: toSecretSafeResponse(mergedTools),
        routingStrategy,
        fallbackEnabled,
        healthCheck: toSecretSafeResponse(mergedHealthCheck)
      }
    });
  } catch (error) {
    next(error);
  }
});

// 获取服务器列表
router.get('/servers', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (!config || !config.servers) {
      res.json({
        success: true,
        data: []
      });
      return;
    }

    const servers = parseSecretJson(config.servers, SERVERS_CONTEXT, []);
    res.json({
      success: true,
      data: toSecretSafeResponse(servers)
    });
  } catch (error) {
    next(error);
  }
});

// 添加服务器
router.post('/servers', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    let server = req.body;

    if (!server.id || !server.name || !server.endpoint) {
      return res.status(400).json({
        success: false,
        error: { message: '服务器需要 id, name, endpoint 字段' }
      });
    }

    let config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    let servers = [];
    if (config && config.servers) {
      servers = parseSecretJson(config.servers, SERVERS_CONTEXT, []);
    }

    server = preserveNestedSecretsById([server], servers)[0];

    // 检查是否已存在
    const existingIndex = servers.findIndex((s: any) => s.id === server.id);
    if (existingIndex >= 0) {
      servers[existingIndex] = server;
    } else {
      servers.push(server);
    }

    config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (config) {
      config = await prisma.user_mcp_configs.update({
        where: { userId },
        data: {
          servers: serializeSecretJson(servers, SERVERS_CONTEXT),
          updatedAt: new Date()
        }
      });
    } else {
      const data: any = {
        id: uuidv4(),
        servers: serializeSecretJson(servers, SERVERS_CONTEXT),
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
      data: { servers: toSecretSafeResponse(servers) }
    });
  } catch (error) {
    next(error);
  }
});

// 删除服务器
router.delete('/servers/:id', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const config = await prisma.user_mcp_configs.findUnique({
      where: { userId }
    });

    if (!config || !config.servers) {
      return res.status(404).json({
        success: false,
        error: { message: '配置不存在' }
      });
    }

    let servers = parseSecretJson(config.servers, SERVERS_CONTEXT, []);
    servers = servers.filter((s: any) => s.id !== id);

    await prisma.user_mcp_configs.update({
      where: { userId },
      data: {
        servers: serializeSecretJson(servers, SERVERS_CONTEXT),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: { servers: toSecretSafeResponse(servers) }
    });
  } catch (error) {
    next(error);
  }
});

// 测试服务器连接
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
      const headers: any = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await safeHttpRequest<any>(`${endpoint}/models`, {
        headers,
        timeoutMs: 5000
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
          message: '连接失败',
          details: error.message
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

    if (!config || !config.servers) {
      res.json({
        success: true,
        data: { servers: [] }
      });
      return;
    }

    const servers = parseSecretJson(config.servers, SERVERS_CONTEXT, []);
    const statusPromises = servers.map(async (server: any) => {
      try {
        const headers: any = { 'Content-Type': 'application/json' };
        if (server.apiKey) {
          headers['Authorization'] = `Bearer ${server.apiKey}`;
        }

        const startTime = Date.now();
        const response = await safeHttpRequest(`${server.endpoint}/models`, {
          headers,
          timeoutMs: 3000
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const duration = Date.now() - startTime;

        return {
          id: server.id,
          name: server.name,
          status: 'online',
          responseTime: duration
        };
      } catch {
        return {
          id: server.id,
          name: server.name,
          status: 'offline',
          responseTime: null
        };
      }
    });

    const statuses = await Promise.all(statusPromises);

    res.json({
      success: true,
      data: { servers: statuses }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
