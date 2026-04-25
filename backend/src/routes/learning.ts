// 学习路由
import express from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import learningService from '../services/learning/learning.service';
import aiService from '../services/ai/ai.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import pathOrchestrator from '../orchestrators/path.orchestrator';

const router = express.Router();

// 所有学习路由都需要认证
router.use(authMiddleware);

// 创建学习目标schema
const createGoalSchema = z.object({
  description: z.string().min(1, '学习目标不能为空'),
  subject: z.string().optional()
});

// 生成学习路径schema
const generatePathSchema = z.object({
  description: z.string().min(1, '学习目标不能为空'),
  subject: z.string().optional(),
  deadline: z.string().optional(),
  deadlineText: z.string().optional(),
  userProfile: z.object({
    skillLevel: z.string().optional(),
    currentSkillLevel: z.string().optional(),
    learningStyle: z.string().optional(),
    timePerDay: z.string().optional(),
    totalWeeks: z.number().optional(),
    learningGoal: z.string().optional(),
    deadline: z.string().optional(),
    deadlineText: z.string().optional(),
    cognitiveProfile: z.record(z.any()).optional(),
    emotionalProfile: z.record(z.any()).optional(),
    problemContext: z.any().optional(),
    priorKnowledge: z.array(z.any()).optional(),
    daysPerWeek: z.number().min(1).max(7).optional(),
    structuredData: z.record(z.any()).optional(),
    confirmedProposal: z.record(z.any()).optional(),
    confidenceScores: z.record(z.any()).optional(),
    conversationHistory: z.array(z.object({ role: z.string(), content: z.string() })).optional()
  }).optional()
});

// 创建学习路径schema
const createPathSchema = z.object({
  name: z.string().min(1, '路径名称不能为空'),
  title: z.string().optional(),
  description: z.string().optional(),
  deadline: z.string().optional(),
  deadlineText: z.string().optional(),
  estimatedHours: z.number().min(1).max(1000).optional()
});

// 完成任务schema
const completeTaskSchema = z.object({
  actualMinutes: z.number().optional(),
  subjectiveDifficulty: z.number().min(1).max(10).optional(),
  notes: z.string().optional()
});

const replanPathSchema = z.object({
  triggerSource: z.enum(['goal-conversation', 'progress-agent', 'ai-teaching', 'admin', 'system', 'api']).optional(),
  reason: z.string().optional(),
  mode: z.enum(['new_version', 'overwrite']).optional(),
  evidence: z.record(z.any()).optional()
});

// 创建学习目标
router.post('/goals', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const data = createGoalSchema.parse(req.body);

    const goal = await learningService.createLearningGoal({
      userId,
      description: data.description,
      subject: data.subject
    });

    res.status(201).json({
      success: true,
      data: goal
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }

    next(error);
  }
});

// 获取学习目标列表
router.get('/goals', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const goals = await learningService.getLearningGoals(userId);

    res.json({
      success: true,
      data: goals
    });
  } catch (error: any) {
    next(error);
  }
});

// 创建学习路径
router.post('/paths', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const data = createPathSchema.parse(req.body);

    const path = await learningService.createLearningPath({
      userId,
      name: data.name,
      title: data.title || data.name,
      description: data.description
    });

    res.status(201).json({
      success: true,
      data: path
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }

    next(error);
  }
});

// 创建占位课程（立即返回，后台异步生成）
router.post('/paths/create', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const data = generatePathSchema.parse(req.body);

    // 1. 立即创建占位课程
    const placeholderPath = await prisma.learning_paths.create({
      data: {
        id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        userId,
        title: '自定义学习路径',
        name: '自定义学习路径',
        description: data.description,
        subject: data.subject || '综合',
        status: 'generating',
        difficulty: 'beginner',
        estimatedHours: 0,
        aiGenerated: true,
        updatedAt: new Date()
      }
    });

// 2. 后台异步生成路径（不等待）
    // 解析时间表达式
    let deadline: Date | undefined;
    if (data.deadline) {
      deadline = new Date(data.deadline);
    } else if (data.deadlineText) {
      const monthsMatch = data.deadlineText.match(/(\d+)\s*个?月/);
      const weeksMatch = data.deadlineText.match(/(\d+)\s*周/);
      const daysMatch = data.deadlineText.match(/(\d+)\s*天/);
      
      if (monthsMatch) {
        deadline = new Date();
        deadline.setMonth(deadline.getMonth() + parseInt(monthsMatch[1]));
      } else if (weeksMatch) {
        deadline = new Date();
        deadline.setDate(deadline.getDate() + parseInt(weeksMatch[1]) * 7);
      } else if (daysMatch) {
        deadline = new Date();
        deadline.setDate(deadline.getDate() + parseInt(daysMatch[1]));
      }
    }
    
    pathOrchestrator.runAsync({
      userId,
      description: data.description,
      subject: data.subject,
      deadline,
      deadlineText: data.deadlineText,
      existingPathId: placeholderPath.id,
      userProfile: data.userProfile
    }, {
      onSuccess: () => {
        logger.info(`学习路径生成完成: ${placeholderPath.id}`);
      },
      onError: async (error) => {
        logger.error(`学习路径生成失败: ${placeholderPath.id}`, error);
        await prisma.learning_paths.update({
          where: { id: placeholderPath.id },
          data: {
            status: 'failed',
            updatedAt: new Date()
          }
        });
      }
    });

// 3. 立即返回占位课程 ID
    res.status(201).json({
      success: true,
      data: placeholderPath
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }
    next(error);
  }
});

// 生成学习路径
router.post('/paths/generate', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const data = generatePathSchema.parse(req.body);

const result = await pathOrchestrator.generate({
      userId,
      description: data.description,
      subject: data.subject,
      deadline: data.deadline ? new Date(data.deadline) : undefined,
      deadlineText: data.deadlineText,
      userProfile: data.userProfile
    });

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }

    next(error);
  }
});

// 获取学习路径列表
router.get('/paths', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const paths = await learningService.getUserLearningPaths(userId);

    res.json({
      success: true,
      data: paths
    });
  } catch (error: any) {
    next(error);
  }
});

// 获取学习路径详情
router.get('/paths/:pathId', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;

    const path = await learningService.getLearningPath(pathId);
    
    // 验证权限：确保路径属于当前用户
    if (path.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: { message: '无权访问此学习路径' }
      });
    }

    res.json({
      success: true,
      data: path
    });
  } catch (error: any) {
    if (error.message === '学习路径不存在') {
      return res.status(404).json({
        success: false,
        error: { message: error.message }
      });
    }

    next(error);
  }
});

// 重试生成失败的路径
router.patch('/paths/:pathId/retry', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;

    // 获取原路径信息
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId }
    });

    if (!path) {
      return res.status(404).json({
        success: false,
        error: { message: '学习路径不存在' }
      });
    }

    if (path.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: { message: '无权访问此学习路径' }
      });
    }

    if (path.status !== 'failed' && path.status !== 'generating') {
      return res.status(400).json({
        success: false,
        error: { message: '只有失败或生成中的路径才能重试' }
      });
    }

    // 更新状态为 generating，重置创建时间（避免前端判定超时）
    await prisma.learning_paths.update({
      where: { id: pathId },
      data: {
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    // 异步重新生成路径
    pathOrchestrator.runAsync({
      userId,
      description: path.description,
      subject: path.subject,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      existingPathId: pathId,
      userProfile: {}
    }, {
      onError: (error) => {
        logger.error(`重试生成路径失败：${pathId}`, error);
      }
    });

    res.json({
      success: true,
      message: '正在重新生成学习路径'
    });
  } catch (error: any) {
    next(error);
  }
});

// 重新生成已有学习路径（主动触发，覆盖当前路径）
router.post('/paths/:pathId/regenerate', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;

    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId }
    });

    if (!path) {
      return res.status(404).json({
        success: false,
        error: { message: '学习路径不存在' }
      });
    }

    if (path.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: { message: '无权访问此学习路径' }
      });
    }

    await prisma.learning_paths.update({
      where: { id: pathId },
      data: {
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    pathOrchestrator.runAsync({
      userId,
      description: path.description || path.title || path.name || '个性化学习路径',
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      existingPathId: pathId,
      userProfile: {}
    }, {
      onError: async (error) => {
        logger.error(`重新生成学习路径失败：${pathId}`, error);
        try {
          await prisma.learning_paths.update({
            where: { id: pathId },
            data: {
              status: 'failed',
              updatedAt: new Date()
            }
          });
        } catch (updateError) {
          logger.error(`更新重新生成失败状态失败：${pathId}`, updateError);
        }
      }
    });

    res.json({
      success: true,
      message: '正在重新生成学习路径'
    });
  } catch (error: any) {
    next(error);
  }
});

// 预留：基于已学内容重调路径（当前仅返回占位结果）
router.post('/paths/:pathId/replan', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;
    const payload = replanPathSchema.parse(req.body || {});

    const result = await learningService.requestPathReplan({
      pathId,
      userId,
      triggerSource: payload.triggerSource,
      reason: payload.reason,
      mode: payload.mode,
      evidence: payload.evidence
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }

    if (error.message === '学习路径不存在') {
      return res.status(404).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (error.message === '无权访问此学习路径') {
      return res.status(403).json({
        success: false,
        error: { message: error.message }
      });
    }

    next(error);
  }
});

// 删除学习路径
router.delete('/paths/:pathId', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;

    await learningService.deleteLearningPath(pathId, userId);

    res.json({
      success: true,
      message: '学习路径已删除'
    });
  } catch (error: any) {
    if (error.message === '学习路径不存在或无权删除') {
      return res.status(404).json({
        success: false,
        error: { message: error.message }
      });
    }

    next(error);
  }
});

// 获取任务详情
router.get('/tasks/:taskId', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { taskId } = req.params;

    const task = await learningService.getTaskById(taskId, userId);

    res.json({
      success: true,
      data: task
    });
  } catch (error: any) {
    if (error.message === '任务不存在') {
      return res.status(404).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (error.message === '无权访问此任务') {
      return res.status(403).json({
        success: false,
        error: { message: error.message }
      });
    }

    next(error);
  }
});

router.post('/paths/:pathId/retry-enrichment', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;

    const result = await learningService.retryPathEnrichment(pathId, userId);

    res.json({
      success: true,
      data: result,
      message: '正在继续准备学习内容'
    });
  } catch (error: any) {
    if (error.message === '学习路径不存在') {
      return res.status(404).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (error.message === '无权访问此学习路径') {
      return res.status(403).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (
      error.message === '学习路径主结构尚未完成，暂不能继续准备'
      || error.message === '学习内容仍在准备中，请稍后查看'
    ) {
      return res.status(400).json({
        success: false,
        error: { message: error.message }
      });
    }

    next(error);
  }
});

// 完成任务
router.post('/tasks/:taskId/complete', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { taskId } = req.params;

    const data = completeTaskSchema.parse(req.body);

    const task = await learningService.completeTask({
      taskId,
      userId,
      actualMinutes: data.actualMinutes,
      subjectiveDifficulty: data.subjectiveDifficulty,
      notes: data.notes
    });

    res.json({
      success: true,
      data: task
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }

    next(error);
  }
});

// 获取学习统计
router.get('/stats', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const stats = await learningService.getLearningStats(userId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    next(error);
  }
});

// ==================== 旧版 Weeks/Tasks 路由（已废弃）====================
// 注意：以下路由使用旧的 weeks/tasks 模型，已被 milestones/subtasks 取代
// 保留用于向后兼容，但建议使用新的 ContentAgent 集成端点
/*
// 获取某周的所有任务
router.get('/weeks/:weekId/tasks', async (req, res, next) => {
  try {
    const { weekId } = req.params;
    
    const tasks = await prisma.tasks.findMany({
      where: { weekId },
      orderBy: { createdAt: 'asc' }
    });

    res.json(tasks);
  } catch (error: any) {
    next(error);
  }
});

// 生成指定周的任务
router.post('/paths/:pathId/weeks/:weekNumber/generate-tasks', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId, weekNumber } = req.params;
    const weekNum = parseInt(weekNumber, 10);

    // 1. 验证路径归属
    const path = await prisma.learning_paths.findFirst({
      where: { id: pathId, userId },
      include: {
        weeks: {
          include: { tasks: true },
          orderBy: { weekNumber: 'asc' }
        }
      }
    });

    if (!path) {
      return res.status(404).json({
        success: false,
        error: { message: '学习路径不存在' }
      });
    }

    // 2. 找到目标周
    const targetWeek = path.weeks.find(w => w.weekNumber === weekNum);
    if (!targetWeek) {
      return res.status(404).json({
        success: false,
        error: { message: `第${weekNum}周不存在` }
      });
    }

    // 3. 检查是否已有任务
    if (targetWeek.tasks.length > 0) {
      return res.status(400).json({
        success: false,
        error: { message: '该周已有任务，如需重新生成请先删除现有任务' },
        data: { existingTasks: targetWeek.tasks.length }
      });
    }

    // 4. 获取用户信息
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { skillLevel: true, learningStyle: true, timePerDay: true }
    });

    // 5. 计算已完成的周次（用于上下文）
    const previousWeeks = path.weeks
      .filter(w => w.weekNumber < weekNum)
      .map(w => ({
        weekNumber: w.weekNumber,
        title: w.title || '',
        completedTasks: w.tasks.filter(t => t.status === 'completed').length
      }));

    // 6. 调用AI设计课程
    logger.info('开始生成周任务', { pathId, weekNumber: weekNum });

    const result = await aiService.designWeekCourses({
      userId,
      weekNumber: weekNum,
      weekTitle: targetWeek.title || `第${weekNum}周`,
      weekDescription: targetWeek.description || '',
      overallGoal: path.description || path.name,
      userProfile: {
        skillLevel: user?.skillLevel,
        learningStyle: user?.learningStyle,
        timePerDay: user?.timePerDay
      },
      previousWeeks
    });

    if (!result.success || !result.internal) {
      return res.status(500).json({
        success: false,
        error: { message: result.error || 'AI生成失败' }
      });
    }

    // 7. 创建任务记录（从 internal 读取数据）
    const tasks = result.internal.tasks || [];
    const createdTasks = [];

    for (const task of tasks) {
      const created = await prisma.tasks.create({
        data: {
          weekId: targetWeek.id,
          userId,
          title: task.title,
          description: task.description,
          taskType: task.type || 'practice',
          estimatedMinutes: task.estimatedMinutes || 30,
          contentJson: JSON.stringify({
            acceptanceCriteria: task.acceptanceCriteria,
            resources: task.resources,
            hints: task.hints
          }),
          status: 'todo'
        }
      });
      createdTasks.push(created);
    }

    // 8. 更新周的学习目标（从 internal 读取数据）
    if (result.internal.keyConcepts || result.internal.weeklyGoal) {
      await prisma.weeks.update({
        where: { id: targetWeek.id },
        data: {
          learningObjectives: JSON.stringify({
            goal: result.internal.weeklyGoal,
            concepts: result.internal.keyConcepts
          })
        }
      });
    }

    logger.info('周任务生成完成', {
      pathId,
      weekNumber: weekNum,
      taskCount: createdTasks.length
    });

    res.json({
      success: true,
      data: {
        weekNumber: weekNum,
        weekTheme: result.internal.weekTheme,
        weeklyGoal: result.internal.weeklyGoal,
        keyConcepts: result.internal.keyConcepts,
        tasks: createdTasks
      }
    });
  } catch (error: any) {
    logger.error('生成周任务失败:', error);
    next(error);
  }
});

// 批量生成所有周的任务
router.post('/paths/:pathId/generate-all-tasks', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;

    // 1. 验证路径归属
    const path = await prisma.learning_paths.findFirst({
      where: { id: pathId, userId },
      include: {
        weeks: {
          include: { tasks: true },
          orderBy: { weekNumber: 'asc' }
        }
      }
    });

    if (!path) {
      return res.status(404).json({
        success: false,
        error: { message: '学习路径不存在' }
      });
    }

    // 2. 找出没有任务的周
    const weeksWithoutTasks = path.weeks.filter(w => w.tasks.length === 0);
    
    if (weeksWithoutTasks.length === 0) {
      return res.json({
        success: true,
        message: '所有周都已有任务',
        data: { generatedWeeks: 0 }
      });
    }

    // 3. 获取用户信息
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { skillLevel: true, learningStyle: true, timePerDay: true }
    });

    // 4. 批量生成（逐周）
    const results = [];
    for (const week of weeksWithoutTasks) {
      try {
        const previousWeeks = path.weeks
          .filter(w => w.weekNumber < week.weekNumber)
          .map(w => ({
            weekNumber: w.weekNumber,
            title: w.title || '',
            completedTasks: w.tasks.filter(t => t.status === 'completed').length
          }));

        const result = await aiService.designWeekCourses({
          userId,
          weekNumber: week.weekNumber,
          weekTitle: week.title || `第${week.weekNumber}周`,
          weekDescription: week.description || '',
          overallGoal: path.description || path.name,
          userProfile: {
            skillLevel: user?.skillLevel,
            learningStyle: user?.learningStyle,
            timePerDay: user?.timePerDay
          },
          previousWeeks
        });

        if (result.success && result.internal?.tasks) {
          const createdTasks = [];
          for (const task of result.internal.tasks) {
            const created = await prisma.tasks.create({
              data: {
                weekId: week.id,
                userId,
                title: task.title,
                description: task.description,
                taskType: task.type || 'practice',
                estimatedMinutes: task.estimatedMinutes || 30,
                contentJson: JSON.stringify({
                  acceptanceCriteria: task.acceptanceCriteria,
                  resources: task.resources,
                  hints: task.hints
                }),
                status: 'todo'
              }
            });
            createdTasks.push(created);
          }
          results.push({ weekNumber: week.weekNumber, success: true, taskCount: createdTasks.length });
        } else {
          results.push({ weekNumber: week.weekNumber, success: false, error: result.error });
        }

        // 避免API限流
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err: any) {
        results.push({ weekNumber: week.weekNumber, success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      data: {
        totalWeeks: weeksWithoutTasks.length,
        results
      }
    });
  } catch (error: any) {
    logger.error('批量生成任务失败:', error);
    next(error);
  }
});
*/
export default router;
