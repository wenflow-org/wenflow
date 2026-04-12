// Admin 管理路由
import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import { adminMiddleware } from '../../middleware/admin.middleware';
import { logger } from '../../utils/logger';
import goalConversationsRouter from './goal-conversations';
import platformRouter from './platform';
import debugSandboxRouter from './debug-sandbox';
import arenaRouter from './arena';
import agentMonitoringRouter from './agent-monitoring';

const router = Router();

// 所有路由都需要 admin 权限
router.use(adminMiddleware);

// 注册子路由
router.use('/goal-conversations', goalConversationsRouter);
router.use('/debug', debugSandboxRouter);
router.use('/arena', arenaRouter);
router.use('/agent-monitoring', agentMonitoringRouter);
router.use('/', platformRouter);

/**
 * GET /api/admin/users
 * 获取用户列表（支持分页和搜索）
 */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;

    const skip = (page - 1) * limit;

    const where = search ? {
      OR: [
        { email: { contains: search } },
        { name: { contains: search } }
      ]
    } : {};

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          xp: true,
          currentLevel: true,
          role: true,
          createdAt: true,
          _count: {
            select: {
              learning_paths: true,
              subtasks: true,
              learning_sessions: true
            }
          }
        }
      }),
      prisma.users.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('获取用户列表失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取用户列表失败' }
    });
  }
});

/**
 * GET /api/admin/users/:id
 * 获取单个用户详情
 */
router.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;

    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: {
        learning_goals: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        learning_paths: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        learning_sessions: {
          take: 10,
          orderBy: { startTime: 'desc' }
        },
        achievements: {
          where: { completed: true },
          take: 20
        },
        learning_metrics: {
          take: 30,
          orderBy: { calculatedAt: 'desc' }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: '用户不存在' }
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    logger.error('获取用户详情失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取用户详情失败' }
    });
  }
});

/**
 * PATCH /api/admin/users/:id/role
 * 更新用户角色
 */
router.patch('/users/:id/role', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: { message: '无效的角色' }
      });
    }

    const user = await prisma.users.update({
      where: { id: userId },
      data: {
        role,
        isAdmin: role === 'admin'
      }
    });

    logger.info(`用户角色更新：${user.email} -> ${role}`);

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('更新用户角色失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '更新用户角色失败' }
    });
  }
});

/**
 * GET /api/admin/conversations
 * 获取目标对话列表
 */
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    const skip = (page - 1) * limit;

    const where = status ? { status } : {};

    const [conversations, total] = await Promise.all([
      prisma.goal_conversations.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        }
      }),
      prisma.goal_conversations.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        conversations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('获取对话列表失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取对话列表失败' }
    });
  }
});

/**
 * GET /api/admin/conversations/:id
 * 获取对话详情
 */
router.get('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;

    const conversation = await prisma.goal_conversations.findUnique({
      where: { id: conversationId },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { message: '对话不存在' }
      });
    }

    // 解析消息 JSON
    let messages = [];
    if (conversation.messages) {
      try {
        messages = JSON.parse(conversation.messages);
      } catch (e) {
        messages = [];
      }
    }

    res.json({
      success: true,
      data: {
        ...conversation,
        messages
      }
    });
  } catch (error) {
    logger.error('获取对话详情失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取对话详情失败' }
    });
  }
});

/**
 * DELETE /api/admin/conversations/:id
 * 删除对话
 */
router.delete('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;

    await prisma.goal_conversations.delete({
      where: { id: conversationId }
    });

    logger.info(`对话删除：${conversationId}`);

    res.json({
      success: true,
      message: '对话已删除'
    });
  } catch (error) {
    logger.error('删除对话失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '删除对话失败' }
    });
  }
});

/**
 * GET /api/admin/agents
 * 获取 Agent 注册列表
 */
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const agents = await prisma.agent_registrations.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const skills = await prisma.skill_registrations.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: {
        agents,
        skills
      }
    });
  } catch (error) {
    logger.error('获取 Agent 列表失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Agent 列表失败' }
    });
  }
});

/**
 * GET /api/admin/activity
 * 获取最近活动日志
 */
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    // 最近的学习会话
    const recentSessions = await prisma.learning_sessions.findMany({
      take: limit,
      orderBy: { startTime: 'desc' },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    // 最近注册的用户
    const recentUsers = await prisma.users.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });

    // 最近完成的任务
    const completedTasks = await prisma.subtasks.findMany({
      take: 20,
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    res.json({
      success: true,
      data: {
        recentSessions,
        recentUsers,
        completedTasks
      }
    });
  } catch (error) {
    logger.error('获取活动日志失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取活动日志失败' }
    });
  }
});

export default router;
