// 用户路由
import express from 'express';
import prisma from '../config/database';
import { rejectProjectionAccess } from '../middleware/projection-access.middleware';
import { learnerSnapshotRefreshService } from '../services/learner/LearnerSnapshotRefreshService';
import { getLevelFromXp } from '../services/learner/level.util';

const router = express.Router();

function buildAgentLogWhere(userId: string, query: any) {
  const agentId = query.agentId as string;
  const capabilityType = query.capabilityType as string;
  const success = query.success as string;
  const includeSystem = query.includeSystem as string;
  const startDate = query.startDate as string;
  const endDate = query.endDate as string;
  const where: any = { userId };

  const capabilityAgents: Record<string, string[]> = {
    goal: ['skill:goal-conversation'],
    path: ['skill:path-planning'],
    teaching: ['ai-teaching-agent'],
    tutoring: ['ai-tutor'],
    tracking: [],
    profile: ['learner-model-agent'],
    system: ['system-call', 'unknown']
  };

  if (agentId) {
    where.agentId = agentId;
  } else if (capabilityType && capabilityType in capabilityAgents) {
    where.agentId = { in: capabilityAgents[capabilityType] };
  }

  if (success !== undefined) {
    where.success = success === 'true';
  }

  if (includeSystem !== 'true' && !agentId && !capabilityType) {
    where.agentId = { notIn: ['system-call', 'unknown'] };
    where.AND = [
      {
        OR: [
          { executionLayer: null },
          { executionLayer: { not: 'api-gateway' } }
        ]
      }
    ];
  }

  if (startDate || endDate) {
    where.calledAt = {};
    if (startDate) {
      where.calledAt.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.calledAt.lte = end;
    }
  }

  return where;
}

const directUserSessionOnly = rejectProjectionAccess('投影视角不允许修改账户信息');

// 获取当前用户信息
router.get('/me', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        xp: true,
        role: true,
        currentLevel: true,
        createdAt: true,
        deletedAt: true
      }
    });

    if (user?.deletedAt) {
      return res.status(401).json({
        success: false,
        error: { message: '账号已被删除', status: 401 }
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: '用户不存在' }
      });
    }

    // 计算用户等级（基于XP，单点公式 level.util）
    const calculatedLevel = getLevelFromXp(user.xp);

    const { deletedAt: _deletedAt, ...userPayload } = user;

    res.json({
      success: true,
      data: {
        ...userPayload,
        level: calculatedLevel,
        xpToNextLevel: (calculatedLevel * calculatedLevel * 100) - user.xp
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me/learner-center', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const requestedPathId = typeof req.query.pathId === 'string' ? req.query.pathId : undefined;
    const scope = req.query.scope === 'path' || req.query.scope === 'teaching' ? req.query.scope : 'global';

    let pathId = requestedPathId;

    // 用户侧全局快照默认补一条活跃路径，避免账户页等入口误判为“暂无进行中路径”。
    if (!pathId && scope === 'global') {
      const activePath = await prisma.learning_paths.findFirst({
        where: {
          userId,
          status: 'active'
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true }
      });

      pathId = activePath?.id;
    }

    const snapshot = await learnerSnapshotRefreshService.refresh({
      userId,
      pathId,
      scope,
    });

    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    next(error);
  }
});

// 更新用户信息
router.put('/me', directUserSessionOnly, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.body;

    // G8：name 校验——非空、长度 ≤64；users.name 非唯一（仅 email 唯一），按设计不做重名校验
    let normalizedName: string | undefined;
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return res.status(400).json({ success: false, error: { message: 'name 必须为字符串' } });
      }
      const trimmed = name.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, error: { message: 'name 不能为空' } });
      }
      if (trimmed.length > 64) {
        return res.status(400).json({ success: false, error: { message: 'name 不能超过 64 字符' } });
      }
      normalizedName = trimmed;
    }

    const user = await prisma.users.update({
      where: { id: userId },
      data: {
        ...(normalizedName ? { name: normalizedName } : {})
      },
      select: {
        id: true,
        email: true,
        name: true,
        xp: true,
        role: true,
        currentLevel: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

// 获取用户成就
router.get('/me/achievements', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const achievements = await prisma.achievements.findMany({
      where: { userId },
      orderBy: { unlockedAt: 'desc' }
    });

    res.json({
      success: true,
      data: achievements,
      total: achievements.length
    });
  } catch (error) {
    next(error);
  }
});

// 获取用户学习会话历史
router.get('/me/sessions', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit as string) || 100;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    // 构建查询条件
    const where: any = { userId };
    
    // 添加日期范围过滤
    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) {
        where.startTime.gte = new Date(startDate);
      }
      if (endDate) {
        // 设置为当天的最后一秒
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.startTime.lte = end;
      }
    }

    const sessions = await prisma.teaching_sessions.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: limit
    });

    const taskIds = Array.from(new Set(sessions.map((session) => session.taskId).filter(Boolean))) as string[];
    const tasks = taskIds.length > 0
      ? await prisma.subtasks.findMany({
          where: { id: { in: taskIds } },
          select: {
            id: true,
            title: true,
            status: true,
            estimatedMinutes: true
          }
        })
      : [];

    const taskMap = new Map(tasks.map((task) => [task.id, task]));

    const enrichedSessions = sessions.map((session) => {
      const task = session.taskId ? taskMap.get(session.taskId) : null;
      let parsedState: any = null;

      if (session.teachingState) {
        try {
          parsedState = JSON.parse(session.teachingState);
        } catch {
          parsedState = null;
        }
      }

      const derivedMinutes = session.endTime
        ? Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000))
        : null;

      // 兼容历史数据：部分会话把 duration 以“秒”写入，导致日历分钟数异常膨胀
      // 优先使用 start/end 推导出的分钟数；没有 endTime 时才回退到 duration 字段
      const durationMinutes = derivedMinutes ?? (() => {
        const rawDuration = session.duration ?? 0;
        if (rawDuration <= 0) return 0;
        // 没有 endTime 时，若值异常大，按秒兜底转换
        return rawDuration > 24 * 60 ? Math.round(rawDuration / 60) : rawDuration;
      })();

      return {
        ...session,
        durationMinutes,
        taskTitle: task?.title || null,
        taskStatus: task?.status || null,
        estimatedMinutes: task?.estimatedMinutes || null,
        parsedState
      };
    });

    res.json({
      success: true,
      data: enrichedSessions
    });
  } catch (error) {
    next(error);
  }
});

// 获取用户 Agent 调用日志
router.get('/me/agent-logs', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const where = buildAgentLogWhere(userId, req.query);

    const [logs, total] = await Promise.all([
      prisma.agent_call_logs.findMany({
        where,
        orderBy: { calledAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit * 3,
        select: {
          id: true,
          agentId: true,
          sourceEntry: true,
          traceId: true,
          callerAgent: true,
          success: true,
          durationMs: true,
          tokensUsed: true,
          error: true,
          errorCode: true,
          calledAt: true,
          metadata: true
        }
      }),
      prisma.agent_call_logs.count({ where })
    ]);

    const parseMetadata = (metadata: string | null) => {
      if (!metadata) return {} as Record<string, any>;
      try {
        return JSON.parse(metadata) as Record<string, any>;
      } catch {
        return {} as Record<string, any>;
      }
    };

    const getLogSource = (log: {
      id: string;
      agentId: string;
      sourceEntry: string;
    }) => {
      if (log.id.startsWith('acl_')) return 'business';
      if (log.agentId === 'system-call' || log.agentId === 'unknown') return 'infrastructure';
      return 'runtime';
    };

    const sourcePriority: Record<string, number> = {
      business: 3,
      runtime: 2,
      infrastructure: 1,
    };

    const dedupeMap = new Map<string, any>();
    for (const log of logs) {
      const metadata = parseMetadata(log.metadata);
      const traceId = log.traceId || metadata.traceId || '';
      const secondBucket = log.calledAt.toISOString().slice(0, 19);
      const dedupeKey = traceId
        ? `${traceId}|${log.agentId}|${secondBucket}`
        : `${log.agentId}|${secondBucket}`;

      const currentSource = getLogSource(log as any);
      const existing = dedupeMap.get(dedupeKey);
      if (!existing) {
        dedupeMap.set(dedupeKey, { ...log, logSource: currentSource });
        continue;
      }

      const existingPriority = sourcePriority[existing.logSource] || 0;
      const currentPriority = sourcePriority[currentSource] || 0;
      if (currentPriority > existingPriority) {
        dedupeMap.set(dedupeKey, { ...log, logSource: currentSource });
      }
    }

    const normalizedLogs = Array.from(dedupeMap.values())
      .sort((a, b) => new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime())
      .slice(0, limit);

    res.json({
      success: true,
      data: {
        logs: normalizedLogs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// 导出日志
router.get('/me/agent-logs/export', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const format = (req.query.format as string) || 'json';
    const where = buildAgentLogWhere(userId, req.query);

    const logs = await prisma.agent_call_logs.findMany({
      where,
      orderBy: { calledAt: 'desc' },
      take: 1000
    });

    if (format === 'csv') {
      const headers = ['id', 'agentId', 'success', 'durationMs', 'tokensUsed', 'error', 'calledAt'];
      const csv = [
        headers.join(','),
        ...logs.map(log => 
          headers.map(h => {
            const value = (log as any)[h];
            if (typeof value === 'string' && /[",\r\n]/.test(value)) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value ?? '';
          }).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=agent-logs-${userId}.csv`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: logs
      });
    }
  } catch (error) {
    next(error);
  }
});

// 获取单条日志详情。参数路由必须放在 /export 之后，避免把 export 当作 logId。
router.get('/me/agent-logs/:logId', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { logId } = req.params;

    const log = await prisma.agent_call_logs.findFirst({
      where: {
        id: logId,
        userId
      }
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        error: { message: '日志不存在' }
      });
    }

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    next(error);
  }
});

export default router;
