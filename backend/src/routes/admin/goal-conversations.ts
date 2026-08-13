// 目标对话管理路由（后台管理）
import express from 'express';
import prisma from '../../config/database';
import { Prisma } from '@prisma/client';
import { generateLearningPathFromConversation } from '../../services/learning/goal-conversation.service';
import { logger } from '../../utils/logger';

const router = express.Router();

/**
 * 统计口径与漏斗/KPI 一致：排除虚拟/测试账号（含 qa_audit_）+ 软删。
 * 与 platform.ts REAL_USER_WHERE 等价（本地单点 utils/test-account.ts 未入库，此处内联）。
 */
const STATS_USER_WHERE: Prisma.usersWhereInput = {
  isVirtualLearner: false,
  deletedAt: null,
  NOT: [
    { email: { startsWith: 'virtual_' } },
    { email: { endsWith: '@test.local' } },
    { email: { startsWith: 'e2e_' } },
    { email: { startsWith: 'audit_probe_' } },
    { email: { startsWith: 'ui_check' } },
    { email: { startsWith: 'motion_review' } },
    { email: { startsWith: 'qa_audit_' } },
  ],
};

/**
 * 获取所有目标对话列表（分页）
 * GET /api/admin/goal-conversations
 */
router.get('/', async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const userId = req.query.userId as string;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (userId) {
      where.userId = userId;
    }

    const [conversations, total] = await Promise.all([
      prisma.goal_conversations.findMany({
        where,
        skip,
        take: limit,
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.goal_conversations.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        conversations: conversations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error: any) {
    logger.error('获取目标对话列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取对话列表失败'
    });
  }
});

/**
 * 获取单个对话详情
 * GET /api/admin/goal-conversations/:id
 */
router.get('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.goal_conversations.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: '对话不存在'
      });
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (error: any) {
    logger.error('获取对话详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取对话详情失败'
    });
  }
});

/**
 * 更新对话状态
 * PATCH /api/admin/goal-conversations/:id
 */
router.patch('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { status, collectedData } = req.body;

    const ALLOWED_STATUSES = ['active', 'completed', 'cancelled', 'discarded'];
    if (status !== undefined && (typeof status !== 'string' || !ALLOWED_STATUSES.includes(status))) {
      return res.status(400).json({
        success: false,
        error: { message: `status 仅支持 ${ALLOWED_STATUSES.join(' / ')}` }
      });
    }

    const updateData: any = {};
    if (status) {
      updateData.status = status;
    }
    if (collectedData) {
      updateData.collectedData = collectedData;
    }

    const conversation = await prisma.goal_conversations.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: conversation
    });
  } catch (error: any) {
    logger.error('更新对话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '更新对话失败'
    });
  }
});

/**
 * 删除对话
 * DELETE /api/admin/goal-conversations/:id
 */
router.delete('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;

  await prisma.goal_conversations.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '对话已删除'
    });
  } catch (error: any) {
    logger.error('删除对话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除对话失败'
    });
  }
});

/**
 * 重新生成学习路径
 * POST /api/admin/goal-conversations/:id/regenerate-path
 */
router.post('/:id/regenerate-path', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    // 验证对话是否存在
    const conversation = await prisma.goal_conversations.findUnique({
      where: { id },
      include: { users: true }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: '对话不存在'
      });
    }

    // 获取已生成的路径数量（通过查询该用户的 AI 生成路径）
    const existingPathsCount = await prisma.learning_paths.count({
      where: { 
        userId: conversation.userId,
        aiGenerated: true
      }
    });

    // 调用服务生成新的学习路径
    const pathData = await generateLearningPathFromConversation(id);

    res.json({
      success: true,
      data: {
        learningPathId: pathData.learningPath?.id,
        learningPathName: pathData.learningPath?.name,
        totalWeeks: pathData.learningPath?.totalWeeks,
        version: existingPathsCount + 1,
        totalVersions: existingPathsCount + 1
      }
    });
  } catch (error: any) {
    logger.error('重新生成学习路径失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重新生成学习路径失败'
    });
  }
});

/**
 * 获取统计信息
 * GET /api/admin/goal-conversations/stats
 */
router.get('/stats/overview', async (req: any, res) => {
  try {
    const [total, active, completed, cancelled] = await Promise.all([
      prisma.goal_conversations.count({ where: { users: STATS_USER_WHERE } }),
      prisma.goal_conversations.count({ where: { users: STATS_USER_WHERE, status: 'active' } }),
      prisma.goal_conversations.count({ where: { users: STATS_USER_WHERE, status: 'completed' } }),
      prisma.goal_conversations.count({ where: { users: STATS_USER_WHERE, status: 'cancelled' } })
    ]);

    // 获取最近 7 天的对话趋势（含 7 天内完成但更早创建的对话，保证「当日完成」完整）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentConversations = await prisma.goal_conversations.findMany({
      where: {
        users: STATS_USER_WHERE,
        OR: [
          { createdAt: { gte: sevenDaysAgo } },
          { completedAt: { gte: sevenDaysAgo } },
        ],
      },
      select: {
        createdAt: true,
        status: true,
        completedAt: true,
        updatedAt: true
      }
    });

    // 按日期分组统计（口径修复：新增按创建日归集；「完成」按完成时间（completedAt）
    // 归集 = 当日实际完成数，而非「当日创建、查询时点已完成」；
    // 老数据兼容：completed 状态但 completedAt 为空时用 updatedAt 兜底）
    const dailyStats: Record<string, any> = {};
    recentConversations.forEach(conv => {
      const date = conv.createdAt.toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { total: 0, active: 0, completed: 0, cancelled: 0 };
      }
      dailyStats[date].total++;
      if (conv.status === 'active') dailyStats[date].active++;
      if (conv.status === 'cancelled') dailyStats[date].cancelled++;
      if (conv.status === 'completed') {
        const doneAt = conv.completedAt || conv.updatedAt;
        const doneDate = doneAt ? doneAt.toISOString().split('T')[0] : date;
        if (!dailyStats[doneDate]) {
          dailyStats[doneDate] = { total: 0, active: 0, completed: 0, cancelled: 0 };
        }
        dailyStats[doneDate].completed++;
      }
    });

    res.json({
      success: true,
      data: {
        total,
        active,
        completed,
        cancelled,
        completionRate: total > 0 ? ((completed / total) * 100).toFixed(2) : '0',
        dailyStats: Object.entries(dailyStats).map(([date, stats]) => ({
          date,
          ...stats
        }))
      }
    });
  } catch (error: any) {
    logger.error('获取统计信息失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取统计信息失败'
    });
  }
});

export default router;
