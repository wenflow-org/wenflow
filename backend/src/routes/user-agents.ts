// 用户 Agent 托管配置路由
import express from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';
import {
  OFFICIAL_AGENT_DEFINITIONS,
  getAgentLifecycleStatus,
  isOfficialAgent
} from '../services/agent-catalog.service';

const router = express.Router();

// 所有路由都需要认证
router.use(authMiddleware);

// 获取 Agent 列表（平台托管）
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const filter = req.query.filter as string; // all, system, custom

    // 获取用户的 Agent 配置
    const userAgents = await prisma.user_agent_configs.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    
    // 合并数据
    let agents: any[] = [];
    
    if (filter === 'custom') {
      // 托管模式下不提供用户自定义 Agent
      agents = [];
    } else if (filter === 'system') {
      // 只显示系统 Agent（带用户配置状态）
      const published = await Promise.all(
        OFFICIAL_AGENT_DEFINITIONS.map(async oa => ({
          ...oa,
          lifecycleStatus: await getAgentLifecycleStatus(oa.id)
        }))
      );

      agents = published
        .filter(oa => oa.lifecycleStatus === 'published')
        .map((oa: any) => {
        const userConfig = userAgents.find(ua => ua.agentName === oa.id);
        return {
          ...oa,
          agentName: oa.id,
          enabled: userConfig ? userConfig.enabled : true, // 默认启用
          sourceType: 'PLATFORM',
          userConfigId: userConfig?.id,
          isSystem: true,
          model: userConfig?.model || 'deepseek-chat',
          temperature: userConfig?.temperature || 0.7,
          maxTokens: userConfig?.maxTokens || 4096,
          systemPrompt: userConfig?.systemPrompt || '',
          version: userConfig?.version || '1.0.0'
        };
      });
    } else {
      // 显示所有
      const published = await Promise.all(
        OFFICIAL_AGENT_DEFINITIONS.map(async oa => ({
          ...oa,
          lifecycleStatus: await getAgentLifecycleStatus(oa.id)
        }))
      );

      const systemAgents = published
        .filter(oa => oa.lifecycleStatus === 'published')
        .map((oa: any) => {
        const userConfig = userAgents.find(ua => ua.agentName === oa.id);
        return {
          ...oa,
          agentName: oa.id,
          enabled: userConfig ? userConfig.enabled : true,
          sourceType: 'PLATFORM',
          userConfigId: userConfig?.id,
          isSystem: true,
          model: userConfig?.model || 'deepseek-chat',
          temperature: userConfig?.temperature || 0.7,
          maxTokens: userConfig?.maxTokens || 4096,
          systemPrompt: userConfig?.systemPrompt || '',
          version: userConfig?.version || '1.0.0'
        };
      });
      
      agents = [...systemAgents];
    }

    res.json({
      success: true,
      data: agents,
      total: agents.length
    });
  } catch (error) {
    next(error);
  }
});

// 获取 Agent 配置详情
router.get('/:name', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;

    if (!isOfficialAgent(name)) {
      return res.status(404).json({
        success: false,
        error: { message: '仅支持平台托管 Agent' }
      });
    }

    const agent = await prisma.user_agent_configs.findFirst({
      where: {
        userId,
        agentName: name
      }
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Agent 配置不存在' }
      });
    }

    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    next(error);
  }
});

// 创建/更新平台托管 Agent 配置
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const {
      agentName,
      sourceType = 'PLATFORM',
      model,
      temperature,
      maxTokens,
      systemPrompt,
      enabled
    } = req.body;

    // 验证必填字段
    if (!agentName) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少必填字段：agentName' }
      });
    }

    if (!isOfficialAgent(agentName)) {
      return res.status(400).json({
        success: false,
        error: { message: '仅允许配置平台托管 Agent' }
      });
    }

    if (sourceType !== 'PLATFORM') {
      return res.status(400).json({
        success: false,
        error: { message: '当前版本不支持用户自定义 Agent 导入' }
      });
    }

    if (req.body.codeRepositoryId || req.body.customCode) {
      return res.status(400).json({
        success: false,
        error: { message: '当前版本不支持代码仓库或内联代码配置' }
      });
    }

    const existing = await prisma.user_agent_configs.findFirst({
      where: {
        userId,
        agentName
      }
    });

    let agent;
    
    if (existing) {
      // 更新现有配置
      agent = await prisma.user_agent_configs.update({
        where: { id: existing.id },
        data: {
          sourceType: 'PLATFORM',
          codeRepositoryId: null,
          model,
          temperature,
          maxTokens,
          systemPrompt,
          customCode: null,
          ...(enabled !== undefined && { enabled }),
          version: incrementVersion(existing.version),
          updatedAt: new Date()
        }
      });
    } else {
      // 创建新配置
      const data: any = {
        id: uuidv4(),
        agentName,
        sourceType: 'PLATFORM',
        codeRepositoryId: null,
        model,
        temperature,
        maxTokens,
        systemPrompt,
        customCode: null,
        enabled: enabled !== undefined ? enabled : true,
        version: '1.0.0',
        updatedAt: new Date(),
        users: {
          connect: { id: userId }
        }
      };
      agent = await prisma.user_agent_configs.create({ data });
    }

    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    next(error);
  }
});

// 更新 Agent 配置
router.put('/:name', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;
    const {
      model,
      temperature,
      maxTokens,
      systemPrompt,
      customCode,
      codeRepositoryId
    } = req.body;

    if (!isOfficialAgent(name)) {
      return res.status(400).json({
        success: false,
        error: { message: '仅允许更新平台托管 Agent 配置' }
      });
    }

    if (customCode !== undefined || codeRepositoryId !== undefined) {
      return res.status(400).json({
        success: false,
        error: { message: '当前版本不支持用户代码导入' }
      });
    }

    const agent = await prisma.user_agent_configs.findFirst({
      where: {
        userId,
        agentName: name
      }
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Agent 配置不存在' }
      });
    }

    const updated = await prisma.user_agent_configs.update({
      where: { id: agent.id },
      data: {
        ...(model !== undefined && { model }),
        ...(temperature !== undefined && { temperature }),
        ...(maxTokens !== undefined && { maxTokens }),
        ...(systemPrompt !== undefined && { systemPrompt }),
        version: incrementVersion(agent.version),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// 删除 Agent 配置
router.delete('/:name', async (req, res, next) => {
  try {
    return res.status(403).json({
      success: false,
      error: { message: '托管 Agent 不支持删除，请使用启用/禁用控制' }
    });
  } catch (error) {
    next(error);
  }
});

// 启用 Agent
router.post('/:name/enable', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;

    if (!isOfficialAgent(name)) {
      return res.status(400).json({
        success: false,
        error: { message: '仅支持平台托管 Agent' }
      });
    }

    const agent = await prisma.user_agent_configs.findFirst({
      where: {
        userId,
        agentName: name
      }
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Agent 配置不存在' }
      });
    }

    await prisma.user_agent_configs.update({
      where: { id: agent.id },
      data: { enabled: true, updatedAt: new Date() }
    });

    res.json({
      success: true,
      message: 'Agent 已启用'
    });
  } catch (error) {
    next(error);
  }
});

// 禁用 Agent
router.post('/:name/disable', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;

    if (!isOfficialAgent(name)) {
      return res.status(400).json({
        success: false,
        error: { message: '仅支持平台托管 Agent' }
      });
    }

    const agent = await prisma.user_agent_configs.findFirst({
      where: {
        userId,
        agentName: name
      }
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Agent 配置不存在' }
      });
    }

    await prisma.user_agent_configs.update({
      where: { id: agent.id },
      data: { enabled: false, updatedAt: new Date() }
    });

    res.json({
      success: true,
      message: 'Agent 已禁用'
    });
  } catch (error) {
    next(error);
  }
});

// 测试 Agent
router.post('/:name/test', async (req, res, next) => {
  try {
    res.status(403).json({
      success: false,
      error: { message: '托管 Agent 的调试入口在管理端实验室，请联系管理员处理' }
    });
  } catch (error) {
    next(error);
  }
});

// 获取 Agent 调用日志
router.get('/:name/logs', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!isOfficialAgent(name)) {
      return res.status(400).json({
        success: false,
        error: { message: '仅支持平台托管 Agent' }
      });
    }

    const logs = await prisma.agent_call_logs.findMany({
      where: {
        userId,
        agentId: name
      },
      orderBy: { calledAt: 'desc' },
      take: limit,
      select: {
        id: true,
        success: true,
        durationMs: true,
        tokensUsed: true,
        error: true,
        calledAt: true
      }
    });

    res.json({
      success: true,
      data: logs,
      total: logs.length
    });
  } catch (error) {
    next(error);
  }
});

// 辅助函数：版本号递增
function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

export default router;
