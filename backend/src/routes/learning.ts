// 学习路由
import express from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import prisma from '../config/database';
import learningService from '../services/learning/learning.service';
import aiService from '../services/ai/ai.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { learningPathsPollingLimiter } from '../middleware/api-rate-limit.middleware';
import { logger } from '../utils/logger';
import pathOrchestrator from '../coordinators/path.coordinator';
import { buildGoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';
import { isPathMutationConflictError } from '../services/learning/path-mutation-safety';
import { setRequestContext, getRequestContext } from '../gateway/api-gateway/context';

const router = express.Router();

// ---- G5：LLM 计费端点按用户维度限速（额度可经环境变量调整）----
const parseRateLimitEnvValue = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const llmGenerateUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseRateLimitEnvValue(process.env.LLM_GENERATE_MAX_PER_HOUR, 20),
  message: { success: false, error: { message: '生成请求过于频繁，请稍后再试' } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip, 56),
});

// G7：deadline 需为 ISO 日期格式（日期或带时间的完整 ISO 8601）
const ISO_DEADLINE_REGEX = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** 在 LLM 触发链路前注入业务上下文（pathId 归组，执行日志/瀑布可追溯） */
const withPathContext = (req: express.Request, pathId?: string | null, conversationId?: string | null) => {
  setRequestContext({
    ...getRequestContext(),
    userId: req.user?.userId || undefined,
    pathId: pathId || undefined,
    conversationId: conversationId || undefined,
    sourceEntry: 'platform',
  });
};

const sendPathMutationConflict = (res: express.Response, error: unknown) => {
  if (!isPathMutationConflictError(error)) return false;

  res.status(409).json({
    success: false,
    error: {
      message: error.message,
      code: error.code,
      status: 409
    }
  });
  return true;
};

const stripPathGenerationInternals = (path: any) => {
  if (!path || typeof path !== 'object') return path;
  const {
    aiPromptTemplate: _aiPromptTemplate,
    processDetail: _processDetail,
    activeGenerationRun: _activeGenerationRun,
    activeGenerationRunId: _activeGenerationRunId,
    generationRun: _generationRun,
    ...safePath
  } = path;
  if (safePath.generationStatus && typeof safePath.generationStatus === 'object') {
    const { core, stageDesign, updatedAt } = safePath.generationStatus;
    safePath.generationStatus = { core, stageDesign, updatedAt };
  }
  // 保留 generationRun 的轻量子集（含阶段进度/重试信息），供前端 normalizeGenerationLifecycle 首帧准确推断；
  // 剔除 lease/heartbeat 等运行态内部字段
  // 注：generationRun 已被解构为 _generationRun（safePath 上不存在该键），此处基于 _generationRun 重建；
  // 仅当存在任一轻量子集字段时才输出该键（避免对无进度信息的历史路径产生空对象）
  if (_generationRun && typeof _generationRun === 'object') {
    const {
      runId, phase, status, progress, completedItems, totalItems,
      error, errorCode, retryType, retryAllowed,
    } = _generationRun;
    const subset: Record<string, unknown> = {
      runId, phase, status, progress, completedItems, totalItems,
      error, errorCode, retryType, retryAllowed,
    };
    const filtered = Object.fromEntries(
      Object.entries(subset).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      safePath.generationRun = filtered;
    }
  }
  return safePath;
};

const extractStoredSourceConversationId = (aiPromptTemplate?: string | null): string | undefined => {
  if (!aiPromptTemplate) return undefined;

  try {
    const parsed = JSON.parse(aiPromptTemplate);
    const handoffInputId = typeof parsed?.goalFinalPayload?.sourceConversationId === 'string'
      ? parsed.goalFinalPayload.sourceConversationId
      : null;
    if (handoffInputId) return handoffInputId;

    const normalizedInputId = typeof parsed?.normalizedInput?.sourceConversationId === 'string'
      ? parsed.normalizedInput.sourceConversationId
      : null;
    if (normalizedInputId) return normalizedInputId;

    const generationStatusId = typeof parsed?.generationStatus?.sourceConversationId === 'string'
      ? parsed.generationStatus.sourceConversationId
      : null;
    if (generationStatusId) return generationStatusId;

    const directId = typeof parsed?.sourceConversationId === 'string'
      ? parsed.sourceConversationId
      : null;
    if (directId) return directId;
  } catch {
    // Ignore malformed historical prompt templates.
  }

  return undefined;
};

const parsePromptTemplate = (aiPromptTemplate?: string | null): Record<string, any> | null => {
  if (!aiPromptTemplate) return null;
  try {
    const parsed = JSON.parse(aiPromptTemplate);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const buildStoredGoalPathRequest = (path: {
  id: string;
  userId: string;
  description?: string | null;
  aiPromptTemplate?: string | null;
}) => {
  const parsed = parsePromptTemplate(path.aiPromptTemplate);
  const goalFinalPayload = parsed?.goalFinalPayload && typeof parsed.goalFinalPayload === 'object'
    ? parsed.goalFinalPayload
    : null;

  if (!goalFinalPayload) {
    return null;
  }

  return {
    userId: path.userId,
    source: 'goal' as const,
    mode: 'generate' as const,
    sourceConversationId: typeof goalFinalPayload.sourceConversationId === 'string' ? goalFinalPayload.sourceConversationId : undefined,
    existingPathId: path.id,
    rawGoal: typeof goalFinalPayload.rawGoal === 'string' && goalFinalPayload.rawGoal.trim()
      ? goalFinalPayload.rawGoal
      : (path.description || ''),
    visibleSummary: goalFinalPayload.visibleSummary || null,
    conversationHistory: Array.isArray(goalFinalPayload.conversationHistory) ? goalFinalPayload.conversationHistory : [],
    finalUserVisible: typeof goalFinalPayload.finalUserVisible === 'string' ? goalFinalPayload.finalUserVisible : undefined,
  };
};

const buildGoalPathRequestFromConversation = async (path: {
  id: string;
  userId: string;
  description?: string | null;
  aiPromptTemplate?: string | null;
}) => {
  const sourceConversationId = extractStoredSourceConversationId(path.aiPromptTemplate);
  const conversation = await prisma.goal_conversations.findFirst({
    where: sourceConversationId
      ? { id: sourceConversationId, userId: path.userId }
      : { learningPathId: path.id, userId: path.userId },
    select: {
      id: true,
      userId: true,
      description: true,
      stage: true,
      collectedData: true
    }
  });

  if (!conversation) {
    return null;
  }

  let collectedData: Record<string, any> = {};
  try {
    collectedData = JSON.parse(conversation.collectedData || '{}');
  } catch {
    collectedData = {};
  }

  const messages = Array.isArray(collectedData.messages) ? collectedData.messages : [];

  return {
    userId: conversation.userId,
    source: 'goal' as const,
    mode: 'generate' as const,
    sourceConversationId: conversation.id,
    existingPathId: path.id,
    rawGoal: conversation.description || path.description || '',
    visibleSummary: buildGoalPathVisibleSummary({
      understanding: collectedData.understanding || {},
      confirmedProposal: collectedData.confirmedProposal || null,
      collected: collectedData.collected || {},
    }),
    conversationHistory: messages
      .map((message: any) => ({
        role: message?.role === 'user' ? 'user' : 'assistant',
        content: typeof message?.content === 'string' ? message.content : ''
      }))
      .filter((message: { role: string; content: string }) => message.content),
    finalUserVisible: typeof collectedData.finalUserVisible === 'string' ? collectedData.finalUserVisible : undefined,
  };
};

// 所有学习路由都需要认证
router.use(authMiddleware);

// 学习路径列表会被前端轮询，单独放宽限流额度。
router.get('/paths', learningPathsPollingLimiter, async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const paths = (await learningService.getUserLearningPaths(userId)).map(stripPathGenerationInternals);

    res.json({
      success: true,
      data: paths
    });
  } catch (error: any) {
    next(error);
  }
});

// 创建学习目标schema
const createGoalSchema = z.object({
  description: z.string().min(1, '学习目标不能为空').max(4096, '学习目标不能超过 4096 字符'),
  subject: z.string().max(200).optional()
});

// 生成学习路径schema
const generatePathSchema = z.object({
  description: z.string().min(1, '学习目标不能为空').max(4096, '学习目标不能超过 4096 字符'),
  subject: z.string().max(200).optional(),
  deadline: z.string().regex(ISO_DEADLINE_REGEX, 'deadline 必须是 ISO 日期格式').optional(),
  deadlineText: z.string().max(500).optional(),
  userProfile: z.object({
    skillLevel: z.string().optional(),
    currentSkillLevel: z.string().optional(),
    learningStyle: z.string().optional(),
    timePerDay: z.string().optional(),
    totalWeeks: z.number().optional(),
    learningGoal: z.string().max(4096).optional(),
    deadline: z.string().optional(),
    deadlineText: z.string().optional(),
    cognitiveProfile: z.record(z.any()).optional(),
    emotionalProfile: z.record(z.any()).optional(),
    problemContext: z.any().optional(),
    priorKnowledge: z.array(z.any()).optional(),
    daysPerWeek: z.number().min(1).max(7).optional(),
    confirmedProposal: z.record(z.any()).optional(),
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
  triggerSource: z.enum(['goal-conversation', 'learner-model-agent', 'ai-teaching', 'admin', 'system', 'api']).optional(),
  reason: z.string().optional(),
  mode: z.enum(['new_version', 'overwrite']).optional(),
  stageNumber: z.number().int().positive().optional(),
  evidence: z.record(z.any()).optional(),
  requireConfirmation: z.boolean().optional()
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

// 获取学习目标列表（可 status 过滤）
router.get('/goals', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : undefined;

    const goals = await learningService.getLearningGoals(userId, status);

    res.json({
      success: true,
      data: goals
    });
  } catch (error: any) {
    next(error);
  }
});

// 更新学习目标（多目标预算台账：status/pathId/priority/plannedMinutesPerDay）
const GOAL_STATUS_WHITELIST = ['active', 'paused', 'completed', 'archived'];

router.patch('/goals/:goalId', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const goalId = String(req.params.goalId);
    const body = req.body || {};

    // G2：status 白名单校验（与 learning.service updateLearningGoal 的类型枚举一致）
    if (body.status !== undefined && !GOAL_STATUS_WHITELIST.includes(body.status)) {
      return res.status(400).json({
        success: false,
        error: { message: 'status 无效，仅支持 active/paused/completed/archived' }
      });
    }

    // G2：pathId 必须归属当前用户，防止跨用户引用学习路径
    if (body.pathId !== undefined && body.pathId !== null) {
      const path = await prisma.learning_paths.findFirst({
        where: { id: String(body.pathId), userId }
      });
      if (!path) {
        return res.status(400).json({
          success: false,
          error: { message: 'pathId 无效或不属于当前用户' }
        });
      }
    }

    // G2：plannedMinutesPerDay 数值范围 0-1440
    if (body.plannedMinutesPerDay !== undefined) {
      const plannedMinutes = Number(body.plannedMinutesPerDay);
      if (!Number.isFinite(plannedMinutes) || plannedMinutes < 0 || plannedMinutes > 1440) {
        return res.status(400).json({
          success: false,
          error: { message: 'plannedMinutesPerDay 需为 0-1440 的数值' }
        });
      }
    }

    // priority 需为有限数值
    if (body.priority !== undefined && !Number.isFinite(Number(body.priority))) {
      return res.status(400).json({
        success: false,
        error: { message: 'priority 需为数值' }
      });
    }

    const goal = await learningService.updateLearningGoal(userId, goalId, {
      ...(body.status ? { status: body.status } : {}),
      ...(body.pathId !== undefined ? { pathId: body.pathId } : {}),
      ...(body.priority !== undefined ? { priority: Number(body.priority) } : {}),
      ...(body.plannedMinutesPerDay !== undefined ? { plannedMinutesPerDay: Number(body.plannedMinutesPerDay) } : {}),
      ...(body.cognitiveBandwidth !== undefined ? { cognitiveBandwidth: body.cognitiveBandwidth } : {}),
    });

    res.json({ success: true, data: goal });
  } catch (error: any) {
    next(error);
  }
});

// 今日预算视图（多目标调度台账）
router.get('/schedule/today', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const schedule = await learningService.getTodaySchedule(userId);
    res.json({ success: true, data: schedule });
  } catch (error: any) {
    next(error);
  }
});

// 今日台账写入
router.post('/schedule/plan', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // G6：plan 输入校验——数组上限 20 项、budgetMinutes 0-1440、plannedTasks 字符串数组
    const rawPlan = req.body?.plan;
    if (!Array.isArray(rawPlan)) {
      return res.status(400).json({ success: false, error: { message: 'plan 必须为数组' } });
    }
    if (rawPlan.length > 20) {
      return res.status(400).json({ success: false, error: { message: 'plan 最多 20 项' } });
    }

    const plan: Array<{ goalId: string; budgetMinutes: number; plannedTasks?: string[] }> = [];
    for (const item of rawPlan) {
      if (!item || typeof item !== 'object') {
        return res.status(400).json({ success: false, error: { message: 'plan 项格式无效' } });
      }

      const goalId = String(item.goalId || '');
      if (!goalId) {
        return res.status(400).json({ success: false, error: { message: 'plan 项缺少 goalId' } });
      }

      const budgetMinutes = Number(item.budgetMinutes);
      if (!Number.isFinite(budgetMinutes) || budgetMinutes < 0 || budgetMinutes > 1440) {
        return res.status(400).json({ success: false, error: { message: 'budgetMinutes 需为 0-1440 的数值' } });
      }

      let plannedTasks: string[] | undefined;
      if (item.plannedTasks !== undefined) {
        if (!Array.isArray(item.plannedTasks) || item.plannedTasks.some((task: any) => typeof task !== 'string')) {
          return res.status(400).json({ success: false, error: { message: 'plannedTasks 需为字符串数组' } });
        }
        plannedTasks = item.plannedTasks;
      }

      plan.push({ goalId, budgetMinutes, plannedTasks });
    }

    const results = await learningService.planTodaySchedule(userId, plan);
    res.json({ success: true, data: results });
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

// 生成学习路径
router.post('/paths/generate', llmGenerateUserLimiter, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const data = generatePathSchema.parse(req.body);
    withPathContext(req);

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

    const responsePath = req.user?.projection?.grantSource === 'synthetic'
      ? {
          id: path.id,
          title: path.title,
          name: path.name,
          summary: path.summary || null,
          description: path.description,
          subject: path.subject,
          difficulty: path.difficulty,
          estimatedHours: path.estimatedHours,
          status: path.status,
          canStartLearning: path.canStartLearning,
          learningBlockedReason: path.learningBlockedReason || null,
          milestones: (path.milestones || []).map((milestone: any) => ({
            id: milestone.id,
            stageNumber: milestone.stageNumber,
            title: milestone.title,
            description: milestone.description,
            subtasks: (milestone.subtasks || []).map((task: any) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              order: task.order
            }))
          })),
          schemaVersion: 'synthetic-user-v1'
        }
      : stripPathGenerationInternals(path);

    res.json({
      success: true,
      data: responsePath
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

// 轮询路径生成状态，仅返回渲染状态所需的轻量数据。
router.get('/paths/:pathId/generation-status', learningPathsPollingLimiter, async (req, res, next) => {
  try {
    const data = await learningService.getPathGenerationLifecycle(req.params.pathId, req.user.userId);
    res.json({ success: true, data });
  } catch (error: any) {
    if (error.message === '学习路径不存在') {
      return res.status(404).json({ success: false, error: { message: error.message } });
    }
    if (error.message === '无权访问此学习路径') {
      return res.status(403).json({ success: false, error: { message: error.message } });
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

    const retry = await learningService.getPathGenerationRetry(pathId, userId);
    if (!retry.allowed || !retry.retryType) {
      return res.status(400).json({
        success: false,
        error: { message: retry.reason === 'completed' ? '路径已经生成完成，无需重试' : '当前生成任务未失败或未过期，不能重试' }
      });
    }

    if (retry.retryType === 'stageDesign') {
      const result = await learningService.retryPathEnrichment(pathId, userId);
      return res.json({
        success: true,
        data: result,
        message: '正在继续生成阶段任务'
      });
    }

    const runId = await learningService.claimPathCoreGeneration(
      pathId,
      retry.expectedActiveGenerationRunId
    );

    const storedGoalRequest = buildStoredGoalPathRequest(path)
      || await buildGoalPathRequestFromConversation(path);

    if (storedGoalRequest) {
      pathOrchestrator.runGoalAsync({ ...storedGoalRequest, generationRunId: runId }, {
        onError: async (error) => {
          logger.error(`重试生成路径失败：${pathId}`, error);
          await learningService.markActiveGenerationFailed(pathId, error, runId);
        }
      });
    } else {
      // 兜底：非 Goal 来源或旧数据缺少正式入口时，退回裸 Path 输入重试。
      const sourceConversationId = extractStoredSourceConversationId(path.aiPromptTemplate);
      pathOrchestrator.runAsync({
        userId,
        description: path.description,
        subject: path.subject,
        deadline: path.deadline || undefined,
        deadlineText: path.deadlineText || undefined,
        sourceConversationId,
        existingPathId: pathId,
        generationRunId: runId,
        userProfile: {}
      }, {
        onError: async (error) => {
          logger.error(`重试生成路径失败：${pathId}`, error);
          await learningService.markActiveGenerationFailed(pathId, error, runId);
        }
      });
    }

    res.json({
      success: true,
      data: { retryType: 'core', runId },
      message: '正在重新生成学习路径'
    });
  } catch (error: any) {
    if (sendPathMutationConflict(res, error)) return;
    next(error);
  }
});

// 重新生成已有学习路径（主动触发，覆盖当前路径）
router.post('/paths/:pathId/regenerate', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;
    withPathContext(req, pathId, String(req.body?.sourceConversationId || ''));

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

    const runId = await learningService.claimPathCoreGeneration(pathId, path.activeGenerationRunId);

    const storedGoalRequest = buildStoredGoalPathRequest(path)
      || await buildGoalPathRequestFromConversation(path);

    if (storedGoalRequest) {
      pathOrchestrator.runGoalAsync({ ...storedGoalRequest, generationRunId: runId }, {
        onError: async (error) => {
          logger.error(`重新生成学习路径失败：${pathId}`, error);
          await learningService.markActiveGenerationFailed(pathId, error, runId);
        }
      });
    } else {
      const sourceConversationId = extractStoredSourceConversationId(path.aiPromptTemplate);
      pathOrchestrator.runAsync({
        userId,
        description: path.description || path.title || path.name || '个性化学习路径',
        subject: path.subject || undefined,
        deadline: path.deadline || undefined,
        deadlineText: path.deadlineText || undefined,
        sourceConversationId,
        existingPathId: pathId,
        generationRunId: runId,
        userProfile: {}
      }, {
        onError: async (error) => {
          logger.error(`重新生成学习路径失败：${pathId}`, error);
          await learningService.markActiveGenerationFailed(pathId, error, runId);
        }
      });
    }

    res.json({
      success: true,
      data: { runId },
      message: '正在重新生成学习路径'
    });
  } catch (error: any) {
    if (sendPathMutationConflict(res, error)) return;
    next(error);
  }
});

// 预留：基于已学内容重调路径（当前仅返回占位结果）
router.post('/paths/:pathId/replan', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;
    const payload = replanPathSchema.parse(req.body || {});
    withPathContext(req, pathId);

    const result = await learningService.requestPathReplan({
      pathId,
      userId,
      triggerSource: payload.triggerSource,
      reason: payload.reason,
      mode: payload.mode,
      stageNumber: payload.stageNumber,
      evidence: payload.evidence,
      requireConfirmation: payload.requireConfirmation
    });

    res.json({
      success: true,
      data: req.user?.projection?.grantSource === 'synthetic'
        ? {
            status: result?.status || null,
            enabled: result?.enabled === true,
            pathId,
            schemaVersion: 'synthetic-user-v1'
          }
        : result
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

    if (sendPathMutationConflict(res, error)) return;

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
    if (error.message === '学习路径不存在') {
      return res.status(404).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (error.message === '无权删除此学习路径') {
      return res.status(403).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (sendPathMutationConflict(res, error)) return;

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

router.post('/paths/:pathId/retry-stage-design', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;
    withPathContext(req, pathId);

    const result = await learningService.retryPathEnrichment(pathId, userId);

    res.json({
      success: true,
      data: result,
      message: '正在继续生成阶段任务'
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
      error.message === '学习路径主结构尚未完成，暂不能继续生成阶段任务'
      || error.message === '阶段任务仍在生成中，请稍后查看'
      || error.message === '阶段任务已经准备完成，无需重试'
    ) {
      return res.status(400).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (sendPathMutationConflict(res, error)) return;

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
      data: req.user?.projection?.grantSource === 'synthetic'
        ? {
            id: task.task?.id || taskId,
            status: task.task?.status || 'completed',
            completedAt: task.task?.completedAt || null,
            alreadyCompleted: task.alreadyCompleted === true,
            schemaVersion: 'synthetic-user-v1'
          }
        : task
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: '数据验证失败', details: error.errors }
      });
    }

    if (error.message === '无权访问此任务') {
      return res.status(403).json({
        success: false,
        error: { message: error.message }
      });
    }

    if (sendPathMutationConflict(res, error)) return;

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

export default router;
