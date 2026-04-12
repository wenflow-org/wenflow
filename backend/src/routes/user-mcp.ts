// 用户 MCP 配置路由
import express from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

router.use(authMiddleware);

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
        servers: config.servers ? JSON.parse(config.servers) : [],
        tools: config.tools ? JSON.parse(config.tools) : [],
        routingStrategy: config.routingStrategy,
        fallbackEnabled: config.fallbackEnabled,
        healthCheck: config.healthCheck ? JSON.parse(config.healthCheck) : null
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

    if (config) {
      config = await prisma.user_mcp_configs.update({
        where: { userId },
        data: {
          servers: JSON.stringify(servers || []),
          tools: JSON.stringify(tools || []),
          routingStrategy: routingStrategy || 'priority',
          fallbackEnabled: fallbackEnabled !== false,
          healthCheck: JSON.stringify(healthCheck || {}),
          updatedAt: new Date()
        }
      });
    } else {
      const data: any = {
        id: uuidv4(),
        servers: JSON.stringify(servers || []),
        tools: JSON.stringify(tools || []),
        routingStrategy: routingStrategy || 'priority',
        fallbackEnabled: fallbackEnabled !== false,
        healthCheck: JSON.stringify(healthCheck || {}),
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
        servers,
        tools,
        routingStrategy,
        fallbackEnabled,
        healthCheck
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

    const servers = JSON.parse(config.servers);
    res.json({
      success: true,
      data: servers
    });
  } catch (error) {
    next(error);
  }
});

// 添加服务器
router.post('/servers', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const server = req.body;

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
      servers = JSON.parse(config.servers);
    }

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
          servers: JSON.stringify(servers),
          updatedAt: new Date()
        }
      });
    } else {
      const data: any = {
        id: uuidv4(),
        servers: JSON.stringify(servers),
        tools: JSON.stringify([]),
        routingStrategy: 'priority',
        fallbackEnabled: true,
        healthCheck: JSON.stringify({}),
        updatedAt: new Date(),
        users: {
          connect: { id: userId }
        }
      };
      config = await prisma.user_mcp_configs.create({ data });
    }

    res.json({
      success: true,
      data: { servers }
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

    let servers = JSON.parse(config.servers);
    servers = servers.filter((s: any) => s.id !== id);

    await prisma.user_mcp_configs.update({
      where: { userId },
      data: {
        servers: JSON.stringify(servers),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: { servers }
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

      const response = await axios.get(`${endpoint}/models`, {
        headers,
        timeout: 5000
      });

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

    const servers = JSON.parse(config.servers);
    const statusPromises = servers.map(async (server: any) => {
      try {
        const headers: any = { 'Content-Type': 'application/json' };
        if (server.apiKey) {
          headers['Authorization'] = `Bearer ${server.apiKey}`;
        }

        const startTime = Date.now();
        await axios.get(`${server.endpoint}/models`, {
          headers,
          timeout: 3000
        });
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
