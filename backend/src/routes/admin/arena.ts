import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { logger } from '../../utils/logger';
import arenaService from '../../services/arena/arena.service';
import goalConversationService from '../../services/learning/goal-conversation.service';
import { setRequestContext, runWithContext } from '../../gateway/openai-client';

const router = express.Router();

// 应用认证中间件
router.use(authMiddleware);

/**
 * 创建演练会话
 * POST /api/admin/arena/sessions
 */
router.post('/sessions', async (req: any, res) => {
  try {
    const { name, description, config } = req.body;

    const session = await prisma.arena_sessions.create({
      data: {
        id: uuidv4(),
        name: name || `演练-${Date.now()}`,
        description,
        config: config ? JSON.stringify(config) : null,
        status: 'running'
      }
    });

    // 手动模式：不自动执行完整流程
    // 用户需要在前端手动逐个执行Agent
    // 可选：自动执行第一个Agent（画像Agent）
    // arenaService.runPersonaAgent(session.id, config).catch(error => {
    //   logger.error(`Arena session ${session.id} persona agent failed:`, error);
    // });

    res.json({
      success: true,
      data: session
    });
  } catch (error: any) {
    logger.error('创建演练会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '创建演练会话失败'
    });
  }
});

/**
 * 获取演练会话列表
 * GET /api/admin/arena/sessions
 */
router.get('/sessions', async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      prisma.arena_sessions.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.arena_sessions.count()
    ]);

    res.json({
      success: true,
      data: {
        sessions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error: any) {
    logger.error('获取演练会话列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取演练会话列表失败'
    });
  }
});

/**
 * 获取演练会话详情
 * GET /api/admin/arena/sessions/:id
 */
router.get('/sessions/:id', async (req: any, res) => {
  try {
    const { id } = req.params;

    const session = await prisma.arena_sessions.findUnique({
      where: { id },
      include: {
        arena_personas: true,
        arena_dialogues: true,
        arena_extractions: true,
        arena_generations: true,
        arena_evaluations: true,
        arena_optimizations: true,
        arena_agent_logs: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '会话不存在'
      });
    }

    // 解析JSON字段
    const parsedSession = {
      ...session,
      config: session.config ? JSON.parse(session.config) : null,
      arena_personas: session.arena_personas ? {
        ...session.arena_personas,
        content: session.arena_personas.content ? JSON.parse(session.arena_personas.content) : null
      } : null,
      arena_dialogues: session.arena_dialogues ? {
        ...session.arena_dialogues,
        messages: session.arena_dialogues.messages ? JSON.parse(session.arena_dialogues.messages) : []
      } : null,
      arena_extractions: session.arena_extractions ? {
        ...session.arena_extractions,
        content: session.arena_extractions.content ? JSON.parse(session.arena_extractions.content) : null,
        missingFields: session.arena_extractions.missingFields ? JSON.parse(session.arena_extractions.missingFields) : []
      } : null,
      arena_generations: session.arena_generations ? {
        ...session.arena_generations,
        proposalContent: session.arena_generations.proposalContent ? JSON.parse(session.arena_generations.proposalContent) : null,
        pathContent: session.arena_generations.pathContent ? JSON.parse(session.arena_generations.pathContent) : null
      } : null,
      arena_evaluations: session.arena_evaluations ? {
        ...session.arena_evaluations,
        report: session.arena_evaluations.report ? JSON.parse(session.arena_evaluations.report) : null,
        suggestions: session.arena_evaluations.suggestions ? JSON.parse(session.arena_evaluations.suggestions) : []
      } : null,
      arena_optimizations: session.arena_optimizations ? {
        ...session.arena_optimizations,
        suggestions: session.arena_optimizations.suggestions ? JSON.parse(session.arena_optimizations.suggestions) : [],
        optimizedPrompts: session.arena_optimizations.optimizedPrompts ? JSON.parse(session.arena_optimizations.optimizedPrompts) : {},
        expectedImprovement: session.arena_optimizations.expectedImprovement ? JSON.parse(session.arena_optimizations.expectedImprovement) : {}
      } : null,
      arena_agent_logs: session.arena_agent_logs.map((log: any) => ({
        ...log,
        input: log.input ? JSON.parse(log.input) : null,
        output: log.output ? JSON.parse(log.output) : null
      }))
    };

    res.json({
      success: true,
      data: parsedSession
    });
  } catch (error: any) {
    logger.error('获取演练会话详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取演练会话详情失败'
    });
  }
});

/**
 * 删除演练会话
 * DELETE /api/admin/arena/sessions/:id
 */
router.delete('/sessions/:id', async (req: any, res) => {
  try {
    const { id } = req.params;

    await prisma.arena_sessions.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '演练会话已删除'
    });
  } catch (error: any) {
    logger.error('删除演练会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除演练会话失败'
    });
  }
});

/**
 * 批量创建演练会话
 * POST /api/admin/arena/batch
 */
router.post('/batch', async (req: any, res) => {
  try {
    const { personas, config } = req.body;

    if (!Array.isArray(personas) || personas.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供用户画像列表'
      });
    }

    const sessions = [];
    
    for (const persona of personas) {
      const session = await prisma.arena_sessions.create({
        data: {
          id: uuidv4(),
          name: `批量演练-${persona.surfaceGoal?.substring(0, 20) || Date.now()}`,
          description: persona.realProblem,
          config: JSON.stringify(config),
          status: 'running'
        }
      });

      // 先保存画像
      await prisma.arena_personas.create({
        data: {
          id: uuidv4(),
          sessionId: session.id,
          content: JSON.stringify(persona),
          surfaceGoal: persona.surfaceGoal,
          realProblem: persona.realProblem,
          level: persona.level,
          timePerDay: persona.timePerDay,
          totalWeeks: persona.totalWeeks,
          motivation: persona.motivation,
          urgency: persona.urgency,
          agentName: 'BatchImport'
        }
      });

      // 异步运行剩余流程
      arenaService.runDialogAgent(session.id)
        .then(() => arenaService.runExtractAgent(session.id))
        .then(() => arenaService.runGenerateAgent(session.id))
        .then(() => arenaService.runEvaluateAgent(session.id))
        .then(() => arenaService.runOptimizeAgent(session.id))
        .then(() => {
          return prisma.arena_sessions.update({
            where: { id: session.id },
            data: { status: 'completed' }
          });
        })
        .catch(error => {
          logger.error(`Batch session ${session.id} failed:`, error);
          return prisma.arena_sessions.update({
            where: { id: session.id },
            data: { status: 'failed' }
          });
        });

      sessions.push(session);
    }

    res.json({
      success: true,
      data: {
        sessions,
        count: sessions.length
      }
    });
  } catch (error: any) {
    logger.error('批量创建演练会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '批量创建演练会话失败'
    });
  }
});

/**
 * 获取Agent监控统计
 * GET /api/admin/arena/stats
 */
router.get('/stats', async (req: any, res) => {
  try {
    // 统计各Agent的执行情况
    const agentStats = await prisma.arena_agent_logs.groupBy({
      by: ['agentName'],
      _count: { id: true },
      _avg: { durationMs: true },
      where: { status: 'success' }
    });

    // 统计成功率
    const successRate = await prisma.arena_agent_logs.groupBy({
      by: ['agentName', 'status'],
      _count: { id: true }
    });

    // 统计评分分布
    const scoreDistribution = await prisma.arena_evaluations.groupBy({
      by: ['overallScore'],
      _count: { id: true }
    });

    res.json({
      success: true,
      data: {
        agentStats,
        successRate,
        scoreDistribution,
        totalSessions: await prisma.arena_sessions.count(),
        completedSessions: await prisma.arena_sessions.count({ where: { status: 'completed' } }),
        failedSessions: await prisma.arena_sessions.count({ where: { status: 'failed' } })
      }
    });
  } catch (error: any) {
    logger.error('获取Agent统计失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取Agent统计失败'
    });
  }
});

/**
 * 手动执行单个 Agent
 * POST /api/admin/arena/sessions/:id/run-agent
 */
router.post('/sessions/:id/run-agent', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { agentType, config, fromRound } = req.body;

    // 检查会话是否存在
    const session = await prisma.arena_sessions.findUnique({
      where: { id }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '会话不存在'
      });
    }

    // 如果运行对话Agent且会话状态是stopped，重置为running
    if (agentType === 'dialogue' && session.status === 'stopped') {
      await prisma.arena_sessions.update({
        where: { id },
        data: { status: 'running' }
      });
      logger.info(`Session ${id} status reset from stopped to running`);
    }

    let result;

    // 根据 agentType 执行对应的 Agent
    switch (agentType) {
      case 'persona':
        result = await arenaService.runPersonaAgent(id, config);
        break;
      case 'userAgent':
        // 用户Agent是虚拟步骤，不需要实际执行
        // 它只是表示画像已准备好，可以开始对话
        result = { success: true, data: { message: '用户Agent准备就绪' } };
        break;
      case 'dialogue':
        // 支持从指定轮次重新生成
        result = await arenaService.runDialogAgent(id, { 
          maxRounds: Math.min(config?.maxRounds || 15, 30),
          fromRound: fromRound // 从第几轮开始重新生成
        });
        break;
      case 'extraction':
        result = await arenaService.runExtractAgent(id);
        break;
      case 'generation':
        result = await arenaService.runGenerateAgent(id);
        break;
      case 'evaluation':
        result = await arenaService.runEvaluateAgent(id);
        break;
      case 'optimization':
        result = await arenaService.runOptimizeAgent(id);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: '未知的 Agent 类型'
        });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    logger.error(`手动执行 ${req.body.agentType} Agent 失败:`, error);
    res.status(500).json({
      success: false,
      error: error.message || '执行失败'
    });
  }
});

/**
 * 停止对话（手动停止）
 * POST /api/admin/arena/sessions/:id/stop
 */
router.post('/sessions/:id/stop', async (req: any, res) => {
  try {
    const { id } = req.params;

    // 检查会话是否存在
    const session = await prisma.arena_sessions.findUnique({
      where: { id }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '会话不存在'
      });
    }

    // 更新会话状态为 stopped
    const updatedSession = await prisma.arena_sessions.update({
      where: { id },
      data: { status: 'stopped' }
    });

    logger.info(`Arena会话已手动停止`, { sessionId: id });

    res.json({
      success: true,
      data: updatedSession,
      message: '对话已停止'
    });
  } catch (error: any) {
    logger.error('停止对话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '停止失败'
    });
  }
});

/**
 * 更新对话内容（手动编辑）
 * PUT /api/admin/arena/sessions/:id/dialogue
 */
router.put('/sessions/:id/dialogue', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { messages } = req.body;

    // 检查会话是否存在
    const session = await prisma.arena_sessions.findUnique({
      where: { id }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '会话不存在'
      });
    }

    // 统计消息
    const userCount = messages.filter((m: any) => m.role === 'user').length;
    const aiCount = messages.filter((m: any) => m.role === 'assistant').length;

    // 更新对话
    const updatedDialogue = await prisma.arena_dialogues.upsert({
      where: { sessionId: id },
      update: {
        messages: JSON.stringify(messages),
        messageCount: messages.length,
        userMessageCount: userCount,
        aiMessageCount: aiCount,
        agentName: 'ManualEdit'
      },
      create: {
        id: uuidv4(),
        sessionId: id,
        messages: JSON.stringify(messages),
        messageCount: messages.length,
        userMessageCount: userCount,
        aiMessageCount: aiCount,
        agentName: 'ManualEdit'
      }
    });

    res.json({
      success: true,
      data: updatedDialogue
    });
  } catch (error: any) {
    logger.error('保存对话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '保存失败'
    });
  }
});

// ==================== Arena 复用 Platform 流程 ====================
// Arena 作为 Platform 的测试模式，复用 GoalConversation 流程

/**
 * 开始 Arena 目标对话（复用 Platform GoalConversation 流程）
 * POST /api/admin/arena/goal-conversation/start
 * 
 * 通过 X-Test-Mode: arena header 区分测试模式
 * 调用记录标记 sourceEntry: 'arena'
 */
router.post('/goal-conversation/start', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    const { goal, personaId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    if (!goal || goal.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: '学习目标不能为空'
      });
    }

    // 使用 Arena 上下文运行（sourceEntry: 'arena'）
    const result = await runWithContext({
      userId,
      agentId: 'goal-conversation',
      action: 'arena-start',
      sourceEntry: 'arena',
      traceId: req.headers['x-trace-id'] as string || `arena-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userRole: 'tester'
    }, async () => {
      return await goalConversationService.startConversation(userId, goal.trim());
    });

    logger.info('Arena GoalConversation 开始', {
      userId,
      goal: goal.substring(0, 50),
      sourceEntry: 'arena'
    });

    res.json({
      success: true,
      userVisible: result.userVisible,
      internal: result.internal,
      _meta: {
        sourceEntry: 'arena',
        mode: 'test'
      }
    });
  } catch (error: any) {
    logger.error('Arena GoalConversation 开始失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '开始对话失败'
    });
  }
});

/**
 * 继续 Arena 目标对话（复用 Platform GoalConversation 流程）
 * POST /api/admin/arena/goal-conversation/:conversationId/reply
 */
router.post('/goal-conversation/:conversationId/reply', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    const { conversationId } = req.params;
    const { reply } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    if (!reply || reply.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: '回复内容不能为空'
      });
    }

    // 使用 Arena 上下文运行
    const result = await runWithContext({
      userId,
      agentId: 'goal-conversation',
      action: 'arena-reply',
      sourceEntry: 'arena',
      traceId: req.headers['x-trace-id'] as string || `arena-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userRole: 'tester'
    }, async () => {
      return await goalConversationService.continueConversation(
        conversationId,
        reply.trim(),
        userId
      );
    });

    logger.info('Arena GoalConversation 继续', {
      userId,
      conversationId,
      replyLength: reply.length,
      sourceEntry: 'arena'
    });

    res.json({
      success: true,
      userVisible: result.userVisible,
      internal: result.internal,
      _meta: {
        sourceEntry: 'arena',
        mode: 'test'
      }
    });
  } catch (error: any) {
    logger.error('Arena GoalConversation 继续失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '继续对话失败'
    });
  }
});

/**
 * 获取 Arena 目标对话详情
 * GET /api/admin/arena/goal-conversation/:conversationId
 */
router.get('/goal-conversation/:conversationId', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    const { conversationId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    const conversation = await goalConversationService.getConversation(
      conversationId,
      userId
    );

    res.json({
      success: true,
      data: conversation,
      _meta: {
        sourceEntry: 'arena',
        mode: 'test'
      }
    });
  } catch (error: any) {
    logger.error('获取 Arena GoalConversation 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取对话失败'
    });
  }
});

export default router;
