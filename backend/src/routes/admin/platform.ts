import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getPlatformSettings, updatePlatformSettings } from '../../services/platform-settings.service';

const router = express.Router();
router.use(authMiddleware);

const ensureAdmin = async (userId?: string) => {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  });
  return !!operator?.isAdmin;
};

router.get('/settings/registration', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const settings = await getPlatformSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '获取设置失败', status: 500 }
    });
  }
});

router.put('/settings/registration', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const { registrationEnabled } = req.body;
    if (typeof registrationEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { message: 'registrationEnabled 必须是布尔值', status: 400 }
      });
    }

    const settings = await updatePlatformSettings({ registrationEnabled });
    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '更新设置失败', status: 500 }
    });
  }
});

/**
 * 获取平台概览数据
 * GET /api/admin/overview/stats
 */
router.get('/overview/stats', async (req: Request, res: Response) => {
  try {
    // 获取今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 获取昨日统计
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // 并行查询所有统计数据
    const [
      totalUsers,
      newUsersToday,
      activeUsersToday,
      totalPaths,
      activePaths,
      totalTasks,
      completedTasks,
      totalConversations,
      activeConversations,
      totalAgentLogs,
      platformStats
    ] = await Promise.all([
      // 总用户数
      prisma.users.count(),
      
      // 今日新增用户
      prisma.users.count({
        where: {
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),
      
      // 今日活跃用户（有学习会话）
      prisma.learning_sessions.findMany({
        where: {
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),
      
      // 总学习路径数
      prisma.learning_paths.count(),
      
      // 活跃学习路径（有未完成的任务）
      prisma.learning_paths.findMany({
        where: {
          milestones: {
            some: {
              subtasks: {
                some: {
                  status: {
                    in: ['todo', 'in_progress'],
                  },
                },
              },
            },
          },
        },
        select: { id: true },
      }),
      
      // 总任务数
      prisma.subtasks.count(),
      
      // 已完成任务数
      prisma.subtasks.count({
        where: {
          status: 'completed',
        },
      }),
      
      // 总对话数
      prisma.goal_conversations.count(),
      
      // 活跃对话
      prisma.goal_conversations.count({
        where: {
          status: 'active',
        },
      }),
      
      // Agent 调用统计 (使用 agentCallLog 表)
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        _count: true,
      }),
      
      // 最近的 platform stats
      prisma.platform_stats.findMany({
        take: 7,
        orderBy: { date: 'desc' },
      }),
    ]);

    // 计算活跃用户数
    const activeUsersCount = activeUsersToday.length;
    
    // 计算活跃路径数
    const activePathsCount = activePaths.length;

    // 计算 Agent 成功率 (使用 agentCallLog 的 success 字段)
    const agentStats = {
      total: totalAgentLogs.reduce((sum, s) => sum + s._count, 0),
      success: totalAgentLogs.find(s => s.success === true)?._count || 0,
      error: totalAgentLogs.find(s => s.success === false)?._count || 0,
    };
    
    const agentSuccessRate = agentStats.total > 0 
      ? agentStats.success / agentStats.total 
      : 1.0;

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          activeToday: activeUsersCount,
          activeRate: totalUsers > 0 ? (activeUsersCount / totalUsers * 100).toFixed(1) : 0,
        },
        learning: {
          totalPaths,
          activePaths: activePathsCount,
          totalTasks,
          completedTasks,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks * 100).toFixed(1) : 0,
        },
        conversations: {
          total: totalConversations,
          active: activeConversations,
        },
        agents: {
          totalCalls: agentStats.total,
          successRate: (agentSuccessRate * 100).toFixed(1),
        },
        platformStats,
      },
    });
  } catch (error: any) {
    console.error('获取平台概览失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取平台数据失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取 Agent 运行状态
 * GET /api/admin/agents/status
 */
router.get('/agents/status', async (req: Request, res: Response) => {
  try {
    const monitoredAgentOrder = [
      'RequirementCollection',
      'PathPlanning',
      'Teaching',
      'LearningCompanion',
      'SessionEvaluation',
      'Summary'
    ];

    // Agent ID 到流程阶段的映射
    const agentIdToName: Record<string, string> = {
      'goal-conversation': 'RequirementCollection',
      'goal-conversation-agent': 'RequirementCollection',
      'path-agent': 'PathPlanning',
      'generic-planner': 'PathPlanning',
      'content-agent': 'Teaching',
      'content-agent-v3': 'Teaching',
      'content-agent-v5': 'Teaching',
      'tutor-agent': 'Teaching',
      'tutor-core': 'Teaching',
      'basic-generator': 'Teaching',
      'basic-extractor': 'Teaching',
      'peer-agent': 'LearningCompanion',
      'session-evaluation-agent': 'SessionEvaluation',
      'summary-agent': 'Summary'
    };

    // 获取所有有记录的 Agent ID
    const agentIdsWithLogs = await prisma.agent_call_logs.groupBy({
      by: ['agentId'],
      _count: true,
    });

    // 如果没有日志数据，返回默认的 Agent 列表
    if (agentIdsWithLogs.length === 0) {
      const defaultAgents = [
        { name: 'RequirementCollection', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'PathPlanning', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'Teaching', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'LearningCompanion', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'SessionEvaluation', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
        { name: 'Summary', status: 'idle', successRate: '100.0', avgDuration: 0, totalCalls: 0 },
      ];
      return res.json({
        success: true,
        data: { agents: defaultAgents },
      });
    }

    const rawStatuses = await Promise.all(
      agentIdsWithLogs.map(async ({ agentId }) => {
        const agentName = agentIdToName[agentId];
        if (!agentName || !monitoredAgentOrder.includes(agentName)) {
          return null;
        }
        
        // 获取最近的执行日志
        const recentLogs = await prisma.agent_call_logs.findMany({
          where: { agentId },
          orderBy: { calledAt: 'desc' },
          take: 20,
        });

        // 计算统计数据
        const totalCalls = recentLogs.length;
        const successCalls = recentLogs.filter(log => log.success === true).length;
        const errorCalls = recentLogs.filter(log => log.success === false).length;
        const avgDuration = totalCalls > 0
          ? recentLogs.reduce((sum, log) => sum + (log.durationMs || 0), 0) / totalCalls
          : 0;

        // 最后活跃时间
        const lastActivity = recentLogs.length > 0 ? recentLogs[0].calledAt : null;
        
        // 最后状态
        const lastStatus = recentLogs.length > 0 
          ? (recentLogs[0].success ? 'success' : 'error')
          : 'idle';

        return {
          name: agentName,
          agentId,
          status: lastStatus,
          totalCalls,
          successCalls,
          errorCalls,
          successRate: totalCalls > 0 ? (successCalls / totalCalls * 100).toFixed(1) : 100,
          avgDuration: Math.round(avgDuration),
          lastActivity,
        };
      })
    );

    const merged = new Map<string, {
      name: string;
      status: string;
      totalCalls: number;
      successCalls: number;
      errorCalls: number;
      avgDurationWeighted: number;
      lastActivity: Date | null;
    }>();

    for (const item of rawStatuses) {
      if (!item) continue;

      const existing = merged.get(item.name);
      if (!existing) {
        merged.set(item.name, {
          name: item.name,
          status: item.status,
          totalCalls: item.totalCalls,
          successCalls: item.successCalls,
          errorCalls: item.errorCalls,
          avgDurationWeighted: item.avgDuration * item.totalCalls,
          lastActivity: item.lastActivity
        });
        continue;
      }

      const latestStatus = !existing.lastActivity || (item.lastActivity && item.lastActivity > existing.lastActivity)
        ? item.status
        : existing.status;

      merged.set(item.name, {
        name: item.name,
        status: latestStatus,
        totalCalls: existing.totalCalls + item.totalCalls,
        successCalls: existing.successCalls + item.successCalls,
        errorCalls: existing.errorCalls + item.errorCalls,
        avgDurationWeighted: existing.avgDurationWeighted + (item.avgDuration * item.totalCalls),
        lastActivity: !existing.lastActivity || (item.lastActivity && item.lastActivity > existing.lastActivity)
          ? item.lastActivity
          : existing.lastActivity
      });
    }

    const agentStatuses = monitoredAgentOrder.map(name => {
      const data = merged.get(name);
      if (!data) {
        return {
          name,
          status: 'idle',
          totalCalls: 0,
          successCalls: 0,
          errorCalls: 0,
          successRate: '100.0',
          avgDuration: 0,
          lastActivity: null
        };
      }

      const avgDuration = data.totalCalls > 0 ? Math.round(data.avgDurationWeighted / data.totalCalls) : 0;
      const successRate = data.totalCalls > 0 ? (data.successCalls / data.totalCalls * 100).toFixed(1) : '100.0';

      return {
        name: data.name,
        status: data.status,
        totalCalls: data.totalCalls,
        successCalls: data.successCalls,
        errorCalls: data.errorCalls,
        successRate,
        avgDuration,
        lastActivity: data.lastActivity
      };
    });

    res.json({
      success: true,
      data: {
        agents: agentStatuses,
      },
    });
  } catch (error: any) {
    console.error('获取 Agent 状态失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取 Agent 状态失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取 Agent 执行日志列表
 * GET /api/admin/agents/logs
 */
router.get('/agents/logs', async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, agentName, status, keyword, timeRange } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Agent Name 到 Agent ID 的映射（反向查找）
    const nameToAgentIds: Record<string, string[]> = {
      RequirementCollection: ['goal-conversation', 'goal-conversation-agent'],
      PathPlanning: ['path-agent', 'generic-planner'],
      Teaching: ['content-agent', 'content-agent-v3', 'content-agent-v5', 'tutor-agent', 'tutor-core', 'basic-generator', 'basic-extractor'],
      LearningCompanion: ['peer-agent'],
      SessionEvaluation: ['session-evaluation-agent'],
      Summary: ['summary-agent']
    };

    const monitoredAgentIds = Array.from(new Set(Object.values(nameToAgentIds).flat()));

    // Agent ID 到 Agent Name 的反向映射
    const agentIdToName: Record<string, string> = {};
    for (const [name, ids] of Object.entries(nameToAgentIds)) {
      for (const id of ids) {
        agentIdToName[id] = name;
      }
    }

    const where: any = {};
    where.agentId = { in: monitoredAgentIds };

    if (agentName) {
      const agentIds = nameToAgentIds[agentName as string];
      if (agentIds) {
        where.agentId = { in: agentIds };
      } else {
        where.agentId = agentName;
      }
    }
    if (status) {
      where.success = status === 'success';
    }

    // 时间范围筛选
    if (timeRange && timeRange !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      switch (timeRange) {
        case 'today':
          where.calledAt = { gte: today };
          break;
        case 'yesterday': {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          where.calledAt = { gte: yesterday, lt: today };
          break;
        }
        case 'week': {
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          where.calledAt = { gte: weekAgo };
          break;
        }
        case 'month': {
          const monthAgo = new Date(today);
          monthAgo.setDate(monthAgo.getDate() - 30);
          where.calledAt = { gte: monthAgo };
          break;
        }
      }
    }

    // 关键词搜索（搜索 input, output, error 字段）
    if (keyword) {
      const searchTerm = String(keyword);
      where.OR = [
        { input: { contains: searchTerm } },
        { output: { contains: searchTerm } },
        { error: { contains: searchTerm } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.agent_call_logs.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { calledAt: 'desc' },
      }),
      prisma.agent_call_logs.count({ where }),
    ]);

    // 转换日志格式以兼容前端
    const formattedLogs = logs.map(log => ({
      id: log.id,
      agentName: agentIdToName[log.agentId] || log.agentId,
      agentId: log.agentId,
      action: 'invoke',
      status: log.success ? 'success' : 'error',
      input: log.input,
      output: log.output,
      error: log.error,
      durationMs: log.durationMs,
      createdAt: log.calledAt,
      metadata: log.metadata,
    }));

    res.json({
      success: true,
      data: {
        logs: formattedLogs,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error: any) {
    console.error('获取 Agent 日志失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取 Agent 日志失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取目标对话列表
 * GET /api/admin/conversations
 */
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, status, userId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [conversations, total] = await Promise.all([
      prisma.goal_conversations.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          status: true,
          stage: true,
          description: true,
          messages: true,
          collectedData: true,
          completedAt: true,
          learningPathId: true,
          createdAt: true,
          updatedAt: true,
          users: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.goal_conversations.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        conversations,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error: any) {
    console.error('获取对话列表失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取对话列表失败',
        status: 500,
      },
    });
  }
});

/**
 * 获取对话详情
 * GET /api/admin/conversations/:id
 */
router.get('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.goal_conversations.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({
        success: false,
        error: {
          message: '对话不存在',
          status: 404,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: conversation,
    });
  } catch (error: any) {
    console.error('获取对话详情失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取对话详情失败',
        status: 500,
      },
    });
  }
});

/**
 * GET /api/admin/stats
 * 平台统计数据的别名端点（兼容旧版）
 */
router.get('/stats', async (req: Request, res: Response) => {
  // 重定向到 /overview/stats - 直接调用逻辑
  res.redirect('/api/admin/overview/stats');
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
  } catch (error: any) {
    console.error('获取活动日志失败:', error);
    res.status(500).json({
      success: false,
      error: {
        message: '获取活动日志失败',
        status: 500
      }
    });
  }
});

/**
 * 获取学生状态基线
 * GET /platform/student-state
 */
router.get('/student-state', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).query.userId as string;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 userId 参数' }
      });
    }
    
    const { studentBaselineService } = await import('../../services/student-baseline.service');
    const baselineStats = await studentBaselineService.getBaselineStats(userId);
    
    res.json({
      success: true,
      data: baselineStats
    });
  } catch (error: any) {
    console.error('获取学生状态基线失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取学生状态基线失败' }
    });
  }
});

/**
 * 获取学习会话状态
 * GET /platform/session-state/:sessionId
 */
router.get('/session-state/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    
    const { learningSessionService } = await import('../../services/learning/learning-session.service');
    const session = await learningSessionService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length
        },
        state: session.state
      }
    });
  } catch (error: any) {
    console.error('获取会话状态失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取会话状态失败' }
    });
  }
});

export default router;
