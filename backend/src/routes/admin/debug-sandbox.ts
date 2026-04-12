import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { logger } from '../../utils/logger';
import aiService from '../../services/ai/ai.service';

const router = express.Router();

// 应用认证中间件
router.use(authMiddleware);

/**
 * 创建快照（保存原始对话）
 * POST /api/admin/debug/snapshots
 */
router.post('/snapshots', async (req: any, res) => {
  try {
    const { name, description, sourceConversationId, rawMessages, tags } = req.body;

    // 如果提供了对话ID，从对话中获取原始消息
    let finalRawMessages = rawMessages;

    if (sourceConversationId && !rawMessages) {
      const conversation = await prisma.goal_conversations.findUnique({
        where: { id: sourceConversationId },
        include: { users: true }
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: '对话不存在'
        });
      }

      // 解析原始消息 - 优先从 collectedData.messages 获取，其次从 messages 字段获取
      let messages = [];
      try {
        const collectedData = JSON.parse(conversation.collectedData || '{}');
        if (collectedData.messages && Array.isArray(collectedData.messages)) {
          messages = collectedData.messages;
        } else if (conversation.messages) {
          messages = JSON.parse(conversation.messages);
        }
      } catch { }

      finalRawMessages = JSON.stringify(messages);
    }

    const snapshot = await prisma.debug_snapshots.create({
      data: {
        id: uuidv4(),
        name: name || '未命名快照',
        description,
        sourceConversationId,
        rawMessages: finalRawMessages,
        userId: req.user?.userId,
        tags: tags ? JSON.stringify(tags) : null
      }
    });

    res.json({
      success: true,
      data: snapshot
    });
  } catch (error: any) {
    logger.error('创建快照失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '创建快照失败'
    });
  }
});

/**
 * 获取快照列表
 * GET /api/admin/debug/snapshots
 */
router.get('/snapshots', async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [snapshots, total] = await Promise.all([
      prisma.debug_snapshots.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
                  debug_requirements: {
                    select: {
                      id: true,
                      version: true,
                      isActive: true,
                      realProblem: true
                    },
                    orderBy: { version: 'asc' }
                  },          debug_proposals: {
            select: {
              id: true,
              version: true,
              isActive: true,
              _count: {
                select: { debug_learning_paths: true }
              }
            },
            orderBy: { version: 'asc' }
          }
        }
      }),
      prisma.debug_snapshots.count()
    ]);

    // 格式化响应
    const formattedSnapshots = snapshots.map(s => {
      const activeRequirement = s.debug_requirements.find(r => r.isActive);
      const proposalCount = s.debug_proposals.length;
      const pathCount = s.debug_proposals.reduce((sum, p) => sum + p._count.debug_learning_paths, 0);

      return {
        ...s,
        realProblem: activeRequirement?.realProblem || '-',
        level: (activeRequirement as any)?.level || '-',
        requirementCount: s.debug_requirements.length,
        proposalCount,
        pathCount
      };
    });

    res.json({
      success: true,
      data: {
        snapshots: formattedSnapshots,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error: any) {
    logger.error('获取快照列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取快照列表失败'
    });
  }
});

/**
 * 获取快照详情（完整流水线数据）
 * GET /api/admin/debug/snapshots/:id
 */
router.get('/snapshots/:id', async (req: any, res) => {
  try {
    const { id } = req.params;

    const snapshot = await prisma.debug_snapshots.findUnique({
      where: { id },
      include: {
        debug_requirements: {
          orderBy: { version: 'asc' }
        },
        debug_proposals: {
          include: {
            debug_learning_paths: {
              select: {
                id: true,
                version: true,
                isActive: true,
                totalWeeks: true,
                totalTasks: true,
                createdAt: true
              },
              orderBy: { version: 'asc' }
            },
            _count: {
              select: { debug_learning_paths: true }
            }
          },
          orderBy: { version: 'asc' }
        }
      }
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: '快照不存在'
      });
    }

    // 解析原始对话
    let parsedMessages: any[] = [];
    try {
      parsedMessages = JSON.parse(snapshot.rawMessages || '[]');
    } catch { }

    res.json({
      success: true,
      data: {
        ...snapshot,
        parsedMessages,
        pipeline: {
          a: parsedMessages,  // 原始对话
          a1: snapshot.debug_requirements,  // 需求收集版本
          b1: snapshot.debug_proposals,  // 方案版本
          c: snapshot.debug_proposals.flatMap(p => p.debug_learning_paths)  // 路径版本
        }
      }
    });
  } catch (error: any) {
    logger.error('获取快照详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取快照详情失败'
    });
  }
});

/**
 * 更新快照
 * PUT /api/admin/debug/snapshots/:id
 */
router.put('/snapshots/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { name, description, tags } = req.body;

    const snapshot = await prisma.debug_snapshots.update({
      where: { id },
      data: {
        name,
        description,
        tags: tags ? JSON.stringify(tags) : undefined
      }
    });

    res.json({
      success: true,
      data: snapshot
    });
  } catch (error: any) {
    logger.error('更新快照失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '更新快照失败'
    });
  }
});

/**
 * 删除快照
 * DELETE /api/admin/debug/snapshots/:id
 */
router.delete('/snapshots/:id', async (req: any, res) => {
  try {
    const { id } = req.params;

    await prisma.debug_snapshots.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '快照已删除'
    });
  } catch (error: any) {
    logger.error('删除快照失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除快照失败'
    });
  }
});

/**
 * 重新运行需求收集（A → A1）
 * POST /api/admin/debug/snapshots/:id/regenerate-requirement
 */
router.post('/snapshots/:id/regenerate-requirement', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { params } = req.body;  // prompt 调整参数

    // 获取快照
    const snapshot = await prisma.debug_snapshots.findUnique({
      where: { id }
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: '快照不存在'
      });
    }

    // 解析原始对话
    let messages: any[] = [];
    try {
      messages = JSON.parse(snapshot.rawMessages || '[]');
    } catch { }

    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: '快照中没有原始对话数据'
      });
    }

    // 获取当前最大版本号
    const lastRequirement = await prisma.debug_requirements.findFirst({
      where: { snapshotId: id },
      orderBy: { version: 'desc' }
    });
    const newVersion = (lastRequirement?.version || 0) + 1;

    // TODO: 这里应该调用 AI 服务分析对话，生成需求
    // 现在返回模拟数据
    const mockRequirement = {
      surfaceGoal: '我想学 Python',
      realProblem: '自动化 Excel 报表处理',
      motivation: '提高工作效率，减少重复劳动',
      level: 'beginner',
      timePerDay: '每天 20 分钟',
      learningStyle: '实践优先',
      background: {
        current_level: 'Excel 基础用户',
        available_time: '每天 20 分钟',
        prior_knowledge: ['Excel 基础', '数据处理概念']
      }
    };

    const requirement = await prisma.debug_requirements.create({
      data: {
        id: uuidv4(),
        snapshotId: id,
        userId: req.user?.userId || 'system',
        requirement: JSON.stringify(mockRequirement),
        version: newVersion,
        isActive: false,
        realProblem: mockRequirement.realProblem,
        status: 'pending'
      }
    });

    res.json({
      success: true,
      data: requirement
    });
  } catch (error: any) {
    logger.error('重新生成需求失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重新生成需求失败'
    });
  }
});

/**
 * 激活需求版本
 * PATCH /api/admin/debug/requirements/:id/activate
 */
router.patch('/requirements/:id/activate', async (req: any, res) => {
  try {
    const { id } = req.params;

    const requirement = await prisma.debug_requirements.findUnique({
      where: { id }
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        error: '需求版本不存在'
      });
    }

    // 先将同一快照下的所有需求设为非激活
    await prisma.debug_requirements.updateMany({
      where: { snapshotId: requirement.snapshotId },
      data: { isActive: false }
    });

    // 激活当前需求
    const updated = await prisma.debug_requirements.update({
      where: { id },
      data: { isActive: true }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (error: any) {
    logger.error('激活需求版本失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '激活需求版本失败'
    });
  }
});

/**
 * 重新生成方案轮廓（A1 → B1）
 * POST /api/admin/debug/requirements/:id/regenerate-proposal
 */
router.post('/requirements/:id/regenerate-proposal', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { params } = req.body;

    const requirement = await prisma.debug_requirements.findUnique({
      where: { id },
      include: { debug_snapshots: true }
    });

    if (!requirement) {
      return res.status(404).json({
        success: false,
        error: '需求版本不存在'
      });
    }

    // 获取当前最大版本号
    const lastProposal = await prisma.debug_proposals.findFirst({
      where: { snapshotId: requirement.snapshotId },
      orderBy: { version: 'desc' }
    });
    const newVersion = (lastProposal?.version || 0) + 1;

    // TODO: 调用 AI 服务生成方案
    const mockProposal = {
      title: 'Python 数据分析学习方案',
      weeks: params?.weeks || 8,
      phases: [
        { week: '1-2', focus: 'Python 基础', tasks: ['变量、数据类型', '控制流', '函数'] },
        { week: '3-4', focus: '数据处理', tasks: ['pandas 基础', '数据清洗', '数据转换'] },
        { week: '5-6', focus: '数据分析', tasks: ['数据可视化', '统计分析', '报表生成'] },
        { week: '7-8', focus: '实战项目', tasks: ['完整数据分析流程', '自动化报表'] }
      ]
    };

    const proposal = await prisma.debug_proposals.create({
      data: {
        id: uuidv4(),
        snapshotId: requirement.snapshotId,
        userId: requirement.userId,
        goal: requirement.requirement,
        proposal: JSON.stringify(mockProposal),
        version: newVersion,
        isActive: false,
        status: 'pending'
      }
    });

    res.json({
      success: true,
      data: proposal
    });
  } catch (error: any) {
    logger.error('重新生成方案失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重新生成方案失败'
    });
  }
});

/**
 * 设置激活的方案版本
 * PATCH /api/admin/debug/proposals/:id/activate
 */
router.patch('/proposals/:id/activate', async (req: any, res) => {
  try {
    const { id } = req.params;

    const proposal = await prisma.debug_proposals.findUnique({
      where: { id }
    });

    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: '方案不存在'
      });
    }

    // 先将同一快照下的所有方案设为非激活
    await prisma.debug_proposals.updateMany({
      where: { snapshotId: proposal.snapshotId },
      data: { isActive: false }
    });

    // 激活当前方案
    const updated = await prisma.debug_proposals.update({
      where: { id },
      data: { isActive: true }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (error: any) {
    logger.error('激活方案失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '激活方案失败'
    });
  }
});

/**
 * 重新生成学习路径（B1 → C）
 * POST /api/admin/debug/proposals/:id/regenerate-path
 */
router.post('/proposals/:id/regenerate-path', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { params } = req.body;

    const proposal = await prisma.debug_proposals.findUnique({
      where: { id },
      include: { debug_snapshots: true }
    });

    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: '方案不存在'
      });
    }

    // 获取当前最大版本号
    const lastPath = await prisma.debug_learning_paths.findFirst({
      where: { proposalId: id },
      orderBy: { version: 'desc' }
    });
    const newVersion = (lastPath?.version || 0) + 1;

    // TODO: 调用 AI 服务生成路径
    const mockPath = {
      name: 'Python 数据分析实战路径',
      description: '从零基础到能独立完成数据分析项目',
      totalWeeks: params?.weeks || 8,
      weeks: Array.from({ length: params?.weeks || 8 }, (_, i) => ({
        weekNumber: i + 1,
        title: `第${i + 1}周`,
        description: `第${i + 1}周的学习内容`,
        tasks: [
          { title: `任务${i + 1}-1`, duration: '30min' },
          { title: `任务${i + 1}-2`, duration: '45min' }
        ]
      }))
    };

    const learningPath = await prisma.debug_learning_paths.create({
      data: {
        id: uuidv4(),
        snapshotId: proposal.snapshotId,
        userId: proposal.userId,
        goal: proposal.goal,
        path: JSON.stringify(mockPath),
        version: newVersion,
        isActive: false,
        totalWeeks: mockPath.totalWeeks,
        totalTasks: mockPath.weeks.length * 2,
        proposalId: id
      }
    });

    res.json({
      success: true,
      data: learningPath
    });
  } catch (error: any) {
    logger.error('重新生成路径失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重新生成路径失败'
    });
  }
});

/**
 * 设置激活的路径版本
 * PATCH /api/admin/debug/learning-paths/:id/activate
 */
router.patch('/learning-paths/:id/activate', async (req: any, res) => {
  try {
    const { id } = req.params;

    const path = await prisma.debug_learning_paths.findUnique({
      where: { id }
    });

    if (!path) {
      return res.status(404).json({
        success: false,
        error: '路径不存在'
      });
    }

    // 先将同一方案下的所有路径设为非激活
    await prisma.debug_learning_paths.updateMany({
      where: { proposalId: path.proposalId },
      data: { isActive: false }
    });

    // 激活当前路径
    const updated = await prisma.debug_learning_paths.update({
      where: { id },
      data: { isActive: true }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (error: any) {
    logger.error('激活路径失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '激活路径失败'
    });
  }
});

/**
 * 批量清理调试数据
 * DELETE /api/admin/debug/cleanup
 */
router.delete('/cleanup', async (req: any, res) => {
  try {
    const { keepRecent = 10 } = req.body;

    // 获取要删除的快照ID列表
    const snapshotsToDelete = await prisma.debug_snapshots.findMany({
      orderBy: { createdAt: 'desc' },
      skip: keepRecent,
      select: { id: true }
    });

    const ids = snapshotsToDelete.map(s => s.id);

    if (ids.length > 0) {
      await prisma.debug_snapshots.deleteMany({
        where: { id: { in: ids } }
      });
    }

    res.json({
      success: true,
      message: `已清理 ${ids.length} 个旧快照`,
      data: { deletedCount: ids.length }
    });
  } catch (error: any) {
    logger.error('清理调试数据失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '清理调试数据失败'
    });
  }
});

/**
 * 获取最近的对话列表
 * GET /api/admin/debug/recent-conversations
 */
router.get('/recent-conversations', async (req: any, res) => {
  try {
    const conversations = await prisma.goal_conversations.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          select: { name: true, email: true }
        }
      }
    });

    const formatted = conversations.map(c => {
      let messages: any[] = [];
      try {
        messages = JSON.parse(c.messages || '[]');
      } catch { }

      return {
        id: c.id,
        description: c.description,
        userName: c.users?.name || '-',
        createdAt: c.createdAt,
        messageCount: messages.length
      };
    });

    res.json({
      success: true,
      data: formatted
    });
  } catch (error: any) {
    logger.error('获取最近对话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取最近对话失败'
    });
  }
});

/**
 * 重新生成方案轮廓（从原始对话调用 AI）
 * POST /api/admin/debug/snapshots/:id/regenerate-outline
 */
router.post('/snapshots/:id/regenerate-outline', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { promptTemplate, temperature = 0.7 } = req.body;

    // 获取快照
    const snapshot = await prisma.debug_snapshots.findUnique({
      where: { id }
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: '快照不存在'
      });
    }

    // 解析原始对话
    let messages: any[] = [];
    try {
      messages = JSON.parse(snapshot.rawMessages || '[]');
    } catch { }

    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: '快照中没有原始对话数据'
      });
    }

    // 构建 AI 提示词
    const systemPrompt = `你是学习规划顾问。基于用户的对话历史，生成一个方案轮廓。

请分析用户的需求，输出以下格式的方案轮廓：

📌 学习方向：[具体的学习方向]

📌 分阶段：
• 第一阶段：[时间范围] - [内容]
• 第二阶段：[时间范围] - [内容]
• ...

📌 学习方式：[学习方式和节奏]

要求：
- 基于对话中提取的真问题
- 考虑用户的背景和时间约束
- 给出清晰的学习阶段划分
- 语言简洁明了`;

    // 构建消息列表
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请基于以下对话生成方案轮廓：\n\n${JSON.stringify(messages, null, 2)}` }
    ];

    // 调用 AI
    const aiResponse = await aiService.chat(aiMessages as any, {
      temperature,
      maxTokens: 1000
    });

    // 解析 AI 响应
    const content = aiResponse.content;
    const outline: any = {
      rawContent: content,
      generatedAt: new Date().toISOString()
    };

    // 提取结构化数据
    const directionMatch = content.match(/📌\s*学习方向[：:]\s*(.+?)(?=\n|$)/);
    if (directionMatch) outline.方向 = directionMatch[1].trim();

    const methodMatch = content.match(/📌\s*学习方式[：:]\s*(.+?)(?=\n|$)/);
    if (methodMatch) outline.方式 = methodMatch[1].trim();

    const stages: string[] = [];
    const stageRegex = /[•·]\s*第[一二三四五六七八九十\d]+阶段[（(]?[^)）]*[)）]?[：:]?\s*(.+?)(?=\n[•·]|\n\n|$)/g;
    let match;
    while ((match = stageRegex.exec(content)) !== null) {
      stages.push(match[1].trim());
    }
    if (stages.length > 0) outline.阶段 = stages;

    res.json({
      success: true,
      data: {
        outline,
        aiResponse: content
      }
    });
  } catch (error: any) {
    logger.error('重新生成方案轮廓失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重新生成方案轮廓失败'
    });
  }
});

/**
 * 重新运行需求收集（从原始对话调用 AI）
 * POST /api/admin/debug/snapshots/:id/regenerate-requirement
 */
router.post('/snapshots/:id/regenerate-requirement', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { promptTemplate, temperature = 0.7 } = req.body;

    // 获取快照
    const snapshot = await prisma.debug_snapshots.findUnique({
      where: { id }
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: '快照不存在'
      });
    }

    // 解析原始对话
    let messages: any[] = [];
    try {
      messages = JSON.parse(snapshot.rawMessages || '[]');
    } catch { }

    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: '快照中没有原始对话数据'
      });
    }

    // 构建 AI 提示词 - 使用与 goal-conversation.service.ts 相同的逻辑
    const systemPrompt = `你是学习规划顾问。基于用户的对话历史，分析并提取以下信息：

请输出 JSON 格式：
{
  "understanding": {
    "surface_goal": "用户表面说的学习目标",
    "real_problem": "穿透表象后的真问题",
    "motivation": "学习动机",
    "urgency": "紧迫程度",
    "background": {
      "current_level": "当前水平",
      "available_time": "可用时间",
      "prior_knowledge": ["已有知识"]
    },
    "learning_style": {
      "preferred_format": "偏好格式(视频/阅读/动手)",
      "theory_vs_practice": "理论vs实践偏好"
    }
  },
  "stage": "understanding",
  "confidence": 0.8
}`;

    // 构建消息列表
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请分析以下对话，提取需求信息：\n\n${JSON.stringify(messages, null, 2)}` }
    ];

    // 调用 AI
    const aiResponse = await aiService.chat(aiMessages as any, {
      temperature,
      maxTokens: 1500
    });

    // 解析 AI 响应
    let requirement: any = {};
    try {
      const parsed = JSON.parse(aiResponse.content);
      requirement = parsed.understanding || {};
    } catch {
      // 如果解析失败，使用原始内容
      requirement = { rawContent: aiResponse.content };
    }

    // 获取当前最大版本号
    const lastRequirement = await prisma.debug_requirements.findFirst({
      where: { snapshotId: id },
      orderBy: { version: 'desc' }
    });
    const newVersion = (lastRequirement?.version || 0) + 1;

    // 保存到数据库
    const newRequirement = await prisma.debug_requirements.create({
      data: {
        id: uuidv4(),
        snapshotId: id,
        userId: req.user?.userId || 'system',
        requirement: JSON.stringify(requirement),
        version: newVersion,
        isActive: false,
        realProblem: requirement.real_problem || null,
        status: 'pending'
      }
    });

    res.json({
      success: true,
      data: newRequirement
    });
  } catch (error: any) {
    logger.error('重新运行需求收集失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重新运行需求收集失败'
    });
  }
});

export default router;
