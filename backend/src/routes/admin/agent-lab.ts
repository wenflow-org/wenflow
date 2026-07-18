/**
 * Agent Lab API - 统一的 Agent 配置和测试接口
 * 整合 Arena Agents 和 Plugin Agents
 */

import { Router } from 'express';
import aiService from '../../services/ai/ai.service';
import { ARENA_AGENT_CONFIGS } from '../../services/arena/agent-configs';
import apiConfigService from '../../services/apiConfig.service';
import { rejectPromptMutation } from '../../middleware/prompt-file-truth.middleware';
import { safeHttpRequest } from '../../utils/safe-http';
import { agentPluginRegistry, agentPluginConfig } from '../../agents';
import { registerAllPlugins } from '../../agents/plugins';
import { getGateway } from '../../gateway';
import {
  getAgentLifecycleStatus,
  listOfficialAgentCatalog,
  setAgentLifecycleStatus
} from '../../services/agent-catalog.service';

const router = Router();

// 确保插件已注册
let pluginsInitialized = false;
function ensurePlugins() {
  if (!pluginsInitialized) {
    registerAllPlugins();
    pluginsInitialized = true;
  }
}

// Arena Agents - 对话交互层 + 业务执行层
const arenaAgents = ARENA_AGENT_CONFIGS.map(config => ({
  name: config.name,
  description: config.description,
  icon: config.icon,
  color: config.color,
  status: 'active',
  temperature: config.temperature,
  maxTokens: config.maxTokens,
  systemPrompt: config.systemPrompt || '',
  input: {
    type: 'object',
    required: ['prompt'],
    example: '测试输入'
  },
  output: {
    schema: {},
    example: {}
  },
  dependencies: [],
  dependents: [],
  category: getAgentCategory(config.name),
  capabilities: getAgentCapabilities(config.name)
}));

// 获取 Agent 分类
function getAgentCategory(name: string): string {
  const categories: Record<string, string> = {
    'PersonaAgent': 'dialogue',
    'UserAgent': 'dialogue',
    'GoalConversationAgent': 'dialogue',
    'ExtractAgent': 'analysis',
    'GenerateAgent': 'generation',  // 统一的路径生成 Agent
    'EvaluateAgent': 'analysis',
    'OptimizeAgent': 'analysis',
    'TutorAgent': 'execution'
  };
  return categories[name] || 'other';
}

// 获取 Agent 能力
function getAgentCapabilities(name: string): string[] {
  const capabilities: Record<string, string[]> = {
    'PersonaAgent': ['persona-generation', 'user-profiling'],
    'UserAgent': ['dialogue', 'role-play'],
    'GoalConversationAgent': ['dialogue', 'requirement-collection'],
    'ExtractAgent': ['requirement-extraction', 'data-parsing'],
    'GenerateAgent': ['path-generation', 'path-planning', 'curriculum-design'],  // 统一的路径生成能力
    'EvaluateAgent': ['quality-assessment', 'scoring'],
    'OptimizeAgent': ['optimization', 'recommendation']
  };
  return capabilities[name] || [];
}

const platformNameToCatalogId: Record<string, string> = {
  PathAgent: 'path-agent',
  GoalConversationAgent: 'goal-conversation-agent',
  'ai-teaching-agent': 'ai-teaching-agent',
  'learner-model-agent': 'learner-model-agent'
};

function normalizeCatalogAgentId(nameOrId: string): string {
  return platformNameToCatalogId[nameOrId] || nameOrId;
}

/**
 * GET /api/admin/agent-lab
 * Agent Lab 首页 - 显示 Arena Agents 和 Plugin Agents
 */
router.get('/', (req, res) => {
  ensurePlugins();

  // 获取插件 Agents
  const pluginAgents = agentPluginRegistry.list().map(plugin => ({
    name: plugin.id,
    description: plugin.description,
    version: plugin.version,
    type: plugin.type,
    capabilities: plugin.capabilities,
    status: 'active',
    category: 'plugin'
  }));

  // 获取当前配置
  const config = agentPluginConfig.getConfig();

  res.json({
    success: true,
    data: {
      arena: arenaAgents,
      plugins: pluginAgents,
      config: config,
      stats: {
        arenaCount: arenaAgents.length,
        pluginCount: pluginAgents.length,
        total: arenaAgents.length + pluginAgents.length
      }
    }
  });
});

/**
 * GET /api/admin/agent-lab/agents
 * 获取所有 Agent 配置（Arena + Plugins）
 */
router.get('/agents', async (req, res) => {
  ensurePlugins();

  // 读取prompt配置
  const fs = require('fs').promises;
  const path = require('path');
  const promptConfigPath = path.join(__dirname, '../../../config/agent-prompts.json');

  let promptConfig = {};
  try {
    const configData = await fs.readFile(promptConfigPath, 'utf-8');
    promptConfig = JSON.parse(configData);
  } catch (e) {
    // 文件不存在，使用空对象
  }

  // 获取插件 Agents
  const pluginAgents = await Promise.all(agentPluginRegistry.list().map(async plugin => ({
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    type: plugin.type,
    capabilities: plugin.capabilities,
    status: 'active',
    category: 'plugin',
    lifecycleStatus: await getAgentLifecycleStatus(normalizeCatalogAgentId(plugin.id))
  })));

  // 应用prompt配置到arena agents
  const arenaAgentsWithPrompts = await Promise.all(arenaAgents.map(async agent => ({
    ...agent,
    systemPrompt: promptConfig[agent.name] || agent.systemPrompt,
    lifecycleStatus: await getAgentLifecycleStatus(normalizeCatalogAgentId(agent.name))
  })));

  res.json({
    success: true,
    data: {
      arena: arenaAgentsWithPrompts,
      platform: pluginAgents,  // 前端期望 platform 字段
      unified: true // 标记已统一
    }
  });
});

/**
 * GET /api/admin/agent-lab/agents/:name
 * 获取单个 Agent 配置
 */
router.get('/agents/:name', async (req, res) => {
  const { name } = req.params;

  const agent = arenaAgents.find(a => a.name === name);

  if (!agent) {
    return res.status(404).json({
      success: false,
      error: 'Agent not found'
    });
  }

  // 读取prompt配置
  const fs = require('fs').promises;
  const path = require('path');
  const promptConfigPath = path.join(__dirname, '../../../config/agent-prompts.json');

  let promptConfig = {};
  try {
    const configData = await fs.readFile(promptConfigPath, 'utf-8');
    promptConfig = JSON.parse(configData);
  } catch (e) {
    // 文件不存在，使用空对象
  }

  // 应用prompt配置
  const agentWithPrompt = {
    ...agent,
    systemPrompt: promptConfig[name] || agent.systemPrompt,
    lifecycleStatus: await getAgentLifecycleStatus(normalizeCatalogAgentId(name))
  };

  res.json({
    success: true,
    data: agentWithPrompt
  });
});

/**
 * GET /api/admin/agent-lab/agent-catalog
 * 获取面向用户的 Agent 发布目录
 */
router.get('/agent-catalog', async (req, res) => {
  const data = await listOfficialAgentCatalog();
  res.json({
    success: true,
    data
  });
});

/**
 * PUT /api/admin/agent-lab/agent-catalog/:agentId/status
 * 更新 Agent 发布状态：draft/staging/published
 */
router.put('/agent-catalog/:agentId/status', async (req, res) => {
  const { agentId } = req.params;
  const { status } = req.body as { status?: 'draft' | 'staging' | 'published' };

  if (!status || !['draft', 'staging', 'published'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: 'status 必须是 draft/staging/published'
    });
  }

  try {
    const record = await setAgentLifecycleStatus(
      normalizeCatalogAgentId(agentId),
      status,
      (req as any).user?.email || 'admin'
    );

    res.json({
      success: true,
      data: {
        agentId: normalizeCatalogAgentId(agentId),
        ...record
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || '更新状态失败'
    });
  }
});

/**
 * POST /api/admin/agent-lab/agents/:name/test
 * 测试 Agent - 支持 Arena agents 和 Plugin agents
 */
router.post('/agents/:name/test', async (req, res) => {
  const { name } = req.params;
  const { input, context } = req.body;

  const startTime = Date.now();

  // 1. 先查找 Arena Agent
  const arenaAgent = arenaAgents.find(a => a.name === name);

  if (arenaAgent) {
    // 测试 Arena Agent
    try {
      const userPrompt = typeof input === 'string' ? input : JSON.stringify(input);

      const response = await aiService.chat([
        { role: 'system', content: arenaAgent.systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        temperature: arenaAgent.temperature || 0.8,
        maxTokens: arenaAgent.maxTokens || 2000
      });

      let output: any;
      try {
        output = JSON.parse(response.content);
      } catch {
        output = { rawContent: response.content };
      }

      return res.json({
        success: true,
        data: {
          agentName: name,
          agentType: 'arena',
          input: userPrompt,
          output,
          usage: response.usage,
          duration: Date.now() - startTime
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Test failed'
      });
    }
  }

  // 2. 查找 Plugin Agent
  ensurePlugins();

  if (agentPluginRegistry.has(name)) {
    try {
      const execution = await getGateway().executeSkill(name, {
        pluginInput: input,
        pluginContext: {
          userId: (req as any).user?.userId,
          taskId: context?.taskId,
          sessionId: context?.sessionId,
          metadata: context?.metadata || {},
        },
      });
      const result = execution.output;

      return res.json({
        success: result.success,
        data: {
          agentName: name,
          agentType: 'plugin',
          input,
          output: result.internal,
          userVisible: result.userVisible,
          error: result.error,
          metadata: result.metadata,
          duration: Date.now() - startTime
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Plugin test failed'
      });
    }
  }

  // 3. 都没找到
  return res.status(404).json({
    success: false,
    error: 'Agent not found'
  });
});

/**
 * GET /api/admin/agent-lab/api-config
 * 获取 API 配置
 */
router.get('/api-config', async (req, res) => {
  const config = await apiConfigService.getConfig();
  res.json({
    success: true,
    data: {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey ? '***已配置***' : '未配置',
      apiKeyConfigured: Boolean(config.apiKey),
      availableModels: config.availableModels,
      defaultModel: config.defaultModel,
      defaultReasoningModel: config.defaultReasoningModel,
      defaultEvaluationModel: config.defaultEvaluationModel
    }
  });
});

/**
 * GET /api/admin/agent-lab/plugin-config
 * 获取插件配置
 */
router.get('/plugin-config', (req, res) => {
  ensurePlugins();

  const config = agentPluginConfig.getConfig();
  const allPlugins = agentPluginRegistry.list();

  // 获取每个类型对应的插件详情
  const configWithDetails: any = {};
  for (const [type, pluginId] of Object.entries(config)) {
    try {
      const plugin = agentPluginRegistry.get(pluginId);
      configWithDetails[type] = {
        pluginId,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description
      };
    } catch {
      configWithDetails[type] = {
        pluginId,
        name: 'Not found'
      };
    }
  }

  res.json({
    success: true,
    data: {
      current: configWithDetails,
      available: allPlugins.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        capabilities: p.capabilities
      }))
    }
  });
});

/**
 * PUT /api/admin/agent-lab/plugin-config
 * 更新插件配置
 */
router.put('/plugin-config', (req, res) => {
  try {
    const updates = req.body;
    const newConfig = agentPluginConfig.updateConfig(updates);

    res.json({
      success: true,
      data: newConfig
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/agent-lab/api-config
 * 更新 API 配置
 */
router.put('/api-config', async (req, res) => {
  const { apiUrl, apiKey, availableModels, defaultModel, defaultReasoningModel, defaultEvaluationModel } = req.body;
  const currentConfig = await apiConfigService.getConfig();
  const resolvedApiKey = typeof apiKey === 'string' && apiKey.trim()
    ? apiKey.trim()
    : currentConfig.apiKey;
  
  const updatedConfig = await apiConfigService.updateConfig({
    apiUrl,
    apiKey: resolvedApiKey,
    availableModels: availableModels ? availableModels.split(',').map((m: string) => m.trim()) : undefined,
    defaultModel,
    defaultReasoningModel,
    defaultEvaluationModel
  });
  
  res.json({
    success: true,
    data: {
      apiUrl: updatedConfig.apiUrl,
      apiKey: updatedConfig.apiKey ? '***已配置***' : '未配置',
      availableModels: updatedConfig.availableModels,
      defaultModel: updatedConfig.defaultModel,
      defaultReasoningModel: updatedConfig.defaultReasoningModel,
      defaultEvaluationModel: updatedConfig.defaultEvaluationModel
    }
  });
});

/**
 * POST /api/admin/agent-lab/api-config/test
 * 测试 API 连接
 */
router.post('/api-config/test', async (req, res) => {
  const { baseURL, apiKey } = req.body;
  
  try {
    // 临时使用传入的配置测试
    const response = await safeHttpRequest<{ data?: any[] }>(`${baseURL}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.status >= 200 && response.status < 300) {
      const data = response.data;
      res.json({
        success: true,
        data: {
          connected: true,
          modelsCount: data.data?.length || 0,
          models: data.data?.map((m: any) => m.id) || []
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: `API 连接失败: ${response.status} ${response.statusText}`
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `API 连接错误: ${error.message}`
    });
  }
});

/**
 * PUT /api/admin/agent-lab/agents/:name/prompt
 * 更新 Agent 的 System Prompt
 */
router.put('/agents/:name/prompt', rejectPromptMutation, async (req, res) => {
  const { name } = req.params;
  const { prompt } = req.body;

  if (name === 'GoalConversationAgent' || name === 'goal-conversation-agent') {
    return res.status(400).json({
      success: false,
      error: 'goal-conversation-agent 已切换为数据库 Prompt 真相源，请使用 /api/admin/agent-prompts 接口管理'
    });
  }

  try {
    const fs = require('fs').promises;
    const path = require('path');
    const promptConfigPath = path.join(__dirname, '../../../config/agent-prompts.json');

    // 读取现有配置
    let promptConfig = {};
    try {
      const configData = await fs.readFile(promptConfigPath, 'utf-8');
      promptConfig = JSON.parse(configData);
    } catch (e) {
      // 文件不存在，使用空对象
    }

    // 更新配置
    promptConfig[name] = prompt;

    // 保存配置
    await fs.writeFile(promptConfigPath, JSON.stringify(promptConfig, null, 2), 'utf-8');

    res.json({
      success: true,
      data: {
        name,
        prompt
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `保存失败: ${error.message}`
    });
  }
});

export default router;
