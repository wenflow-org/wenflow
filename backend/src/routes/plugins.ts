/**
 * 插件 API 路由
 * 
 * 提供基于配置的插件执行接口
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { 
  agentPluginRegistry, 
  agentPluginConfig,
  registerAllPlugins,
  getAllPlugins
} from '../agents';
import { AgentContext } from '../agents/protocol';

const router = Router();

// 确保插件已注册
let pluginsInitialized = false;

/**
 * 初始化插件（延迟初始化）
 */
function ensurePluginsInitialized() {
  if (!pluginsInitialized) {
    registerAllPlugins();
    pluginsInitialized = true;
  }
}

/**
 * 获取所有已注册的插件列表
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    ensurePluginsInitialized();
    
    const plugins = getAllPlugins();
    
    res.json({
      success: true,
      data: plugins.map(p => ({
        id: p.id,
        name: p.name,
        version: p.version,
        type: p.type,
        description: p.description,
        capabilities: p.capabilities
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 根据类型获取当前配置的插件
 */
router.get('/active/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const validTypes = ['requirementExtractor', 'pathPlanner', 'contentGenerator', 'qualityEvaluator', 'tutor'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Valid types: ${validTypes.join(', ')}`
      });
    }
    
    const pluginId = agentPluginConfig.getPluginId(type as any);
    const plugin = agentPluginRegistry.get(pluginId);
    
    res.json({
      success: true,
      data: {
        type,
        pluginId,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        capabilities: plugin.capabilities
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 执行指定插件
 */
router.post('/execute/:pluginId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { pluginId } = req.params;
    const { input, context } = req.body;
    
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }
    
    ensurePluginsInitialized();
    
    if (!agentPluginRegistry.has(pluginId)) {
      return res.status(404).json({
        success: false,
        error: `Plugin not found: ${pluginId}`
      });
    }
    
    // 构建上下文
    const agentContext: AgentContext = {
      userId,
      sessionId: context?.sessionId,
      metadata: {
        ...context?.metadata,
        taskId: context?.taskId
      }
    };
    
    // 执行插件
    const result = await agentPluginRegistry.execute(pluginId, input, agentContext);

    res.json({
      success: result.success,
      userVisible: result.userVisible,
      internal: result.internal,
      error: result.error,
      metadata: result.metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 根据配置执行指定类型的插件
 */
router.post('/execute-by-type/:type', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const { input, context } = req.body;
    
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }
    
    const validTypes = ['requirementExtractor', 'pathPlanner', 'contentGenerator', 'qualityEvaluator', 'tutor'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Valid types: ${validTypes.join(', ')}`
      });
    }
    
    ensurePluginsInitialized();
    
    // 根据配置获取插件 ID
    const pluginId = agentPluginConfig.getPluginId(type as any);
    
    // 构建上下文
    const agentContext: AgentContext = {
      userId,
      sessionId: context?.sessionId,
      metadata: {
        ...context?.metadata,
        taskId: context?.taskId
      }
    };
    
    // 执行插件
    const result = await agentPluginRegistry.execute(pluginId, input, agentContext);

    res.json({
      success: result.success,
      userVisible: result.userVisible,
      internal: result.internal,
      error: result.error,
      metadata: {
        ...result.metadata,
        pluginId,
        type
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取当前插件配置
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const config = agentPluginConfig.getConfig();
    
    // 获取每个类型对应的插件详情
    const configWithDetails: any = {};
    for (const [type, pluginId] of Object.entries(config)) {
      if (pluginId && agentPluginRegistry.has(pluginId)) {
        try {
          const plugin = agentPluginRegistry.get(pluginId);
          configWithDetails[type] = {
            pluginId,
            name: plugin.name,
            version: plugin.version
          };
        } catch {
          configWithDetails[type] = {
            pluginId,
            name: 'Not found'
          };
        }
      } else {
        configWithDetails[type] = {
          pluginId: pluginId || 'not set',
          name: pluginId ? 'Not found' : 'No plugin configured'
        };
      }
    }
    
    res.json({
      success: true,
      data: configWithDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 更新插件配置
 */
router.put('/config', authMiddleware, async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    
    // 验证用户权限（需要管理员）
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }
    
    // 更新配置
    const newConfig = agentPluginConfig.updateConfig(updates);
    
    res.json({
      success: true,
      data: newConfig
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 重置插件配置为默认
 */
router.post('/config/reset', authMiddleware, async (req: Request, res: Response) => {
  try {
    const newConfig = agentPluginConfig.reset();
    
    res.json({
      success: true,
      data: newConfig
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取插件统计信息
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    ensurePluginsInitialized();
    
    const stats = agentPluginRegistry.getAllStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取指定插件的统计信息
 */
router.get('/stats/:pluginId', async (req: Request, res: Response) => {
  try {
    const { pluginId } = req.params;
    
    ensurePluginsInitialized();
    
    const stats = agentPluginRegistry.getStats(pluginId);
    
    if (!stats) {
      return res.status(404).json({
        success: false,
        error: `Plugin not found: ${pluginId}`
      });
    }
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取指定类型的可用插件列表
 */
router.get('/available/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const validTypes = ['requirementExtractor', 'pathPlanner', 'contentGenerator', 'qualityEvaluator', 'tutor'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Valid types: ${validTypes.join(', ')}`
      });
    }
    
    ensurePluginsInitialized();
    
    const availablePlugins = agentPluginConfig.getAvailablePlugins(type as any);
    
    // 获取每个插件的详情
    const pluginsWithDetails = availablePlugins.map(pluginId => {
      try {
        const plugin = agentPluginRegistry.get(pluginId);
        return {
          id: pluginId,
          name: plugin.name,
          version: plugin.version,
          description: plugin.description,
          capabilities: plugin.capabilities
        };
      } catch {
        return {
          id: pluginId,
          name: 'Unknown',
          available: false
        };
      }
    });
    
    res.json({
      success: true,
      data: pluginsWithDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
