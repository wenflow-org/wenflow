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
import { openSessionClearanceService } from '../services/learning/open-session-clearance.service';
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

  const conflict = error as { message: string; code: string; details?: unknown };
  res.status(409).json({
    success: false,
    error: {
      message: conflict.message,
      code: conflict.code,
      status: 409,
      ...(conflict.details ? { details: conflict.details } : {})
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
}, adjustments?: string | null) => {
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
    adjustments: typeof adjustments === 'string' && adjustments.trim() ? adjustments.trim() : null,
    visibleSummary: goalFinalPayload.visibleSummary || null,
    conversationHistory: Array.isArray(goalFinalPayload.conversationHistory) ? goalFinalPayload.conversationHistory : [],
    finalUserVisible: typeof goalFinalPayload.finalUserVisible === 'string' ? goalFinalPayload.finalUserVisible : undefined,
    prerequisiteCheckResults: Array.isArray(goalFinalPayload.prerequisiteCheckResults)
      ? goalFinalPayload.prerequisiteCheckResults
      : null,
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
    prerequisiteCheckResults: Array.isArray(collectedData.understanding?.prerequisiteCheckResults)
      ? collectedData.understanding.prerequisiteCheckResults
      : null,
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
  fromStageNumber: z.number().int().positive().optional(),
  evidence: z.record(z.any()).optional(),
  requireConfirmation: z.boolean().optional(),
  previewOnly: z.boolean().optional(),
  clearedSessionIds: z.array(z.string()).optional()
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
// 支持用户侧"补充说明"（adjustments）：
//   - 无学习进度（全 todo）→ 整路径重建（replace-path），补充说明注入 goal 请求供 LLM 重新规划
//   - 有已完成任务（completed，无 in_progress）→ 收敛为重设计当前活动阶段（replan-stage），
//     补充说明作为 reason 传给 stage-designer，已完成任务保留冻结
//   - 有 in_progress 任务或未结束课堂 → 409 拦截，提示先结束课堂
router.post('/paths/:pathId/regenerate', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;
    withPathContext(req, pathId, String(req.body?.sourceConversationId || ''));

    const adjustments = typeof req.body?.adjustments === 'string' && req.body.adjustments.trim()
      ? req.body.adjustments.trim()
      : null;

    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      include: {
        milestones: {
          include: {
            subtasks: { select: { id: true, status: true } }
          }
        }
      }
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

    const tasks = (path.milestones || []).flatMap((milestone: any) => milestone.subtasks || []);
    const hasInProgress = tasks.some((task: any) => task.status === 'in_progress');
    const hasCompleted = tasks.some((task: any) => task.status === 'completed');
    const isRebuildAll = req.body?.mode === 'rebuild-all';

    // 显式整条重建（用户选「学得不好想重来」）：即使有已完成任务也走 replace-path 整建。
    // 已完成任务的历史课堂/记录仍保留在库中（孤儿化），新路径从头规划；
    // 进行中任务与未结束课堂依旧拦截（需先结束/放弃当前任务）。
    if (isRebuildAll) {
      // 前置校验：有进行中任务 → 直接 409（整建不能丢未完成的进行中进度，用户需先结束或放弃）
      if (hasInProgress) {
        return sendPathMutationConflict(res, Object.assign(
          new Error('当前任务尚未结束，请先完成、暂停或放弃当前任务后再整条重建'),
          { status: 409, code: 'PATH_MUTATION_HAS_IN_PROGRESS' }
        ));
      }
      const runId = await learningService.claimPathCoreGeneration(pathId, path.activeGenerationRunId, { allowCompleted: true });

      // 整建统一走 runAsync（forceReplace 经 userProfile.replan 透传；runGoalAsync 无此通道）
      const sourceConversationId = extractStoredSourceConversationId(path.aiPromptTemplate);
      // 基底用原始用户目标（goalFinalPayload.rawGoal / 会话 description），
      // 避免用已被历次重建污染的 path.description 造成「（整条重建）（整条重建）…」嵌套累积
      const parsedPromptTemplate = parsePromptTemplate(path.aiPromptTemplate);
      const rawGoal = typeof parsedPromptTemplate?.goalFinalPayload?.rawGoal === 'string'
        && parsedPromptTemplate.goalFinalPayload.rawGoal.trim()
        ? parsedPromptTemplate.goalFinalPayload.rawGoal.trim()
        : null;
      let baseGoal = rawGoal || path.description || path.title || path.name || '个性化学习路径';
      pathOrchestrator.runAsync({
        userId,
        description: adjustments
          ? `（整条重建）${baseGoal}。用户补充说明：${adjustments}`
          : `（整条重建）${baseGoal}`,
        subject: path.subject || undefined,
        deadline: path.deadline || undefined,
        deadlineText: path.deadlineText || undefined,
        sourceConversationId,
        existingPathId: pathId,
        generationRunId: runId,
        userProfile: {
          replan: {
            mode: 'overwrite',
            forceReplace: true,
            triggerSource: 'api',
            sourcePathId: pathId,
            reason: adjustments || '用户选择整条重建'
          }
        }
      }, {
        onError: async (error) => {
          logger.error(`整条重建学习路径失败：${pathId}`, error);
          await learningService.markActiveGenerationFailed(pathId, error, runId);
        }
      });

      return res.json({
        success: true,
        data: { runId, adjustments, mode: 'rebuild-all' },
        message: adjustments
          ? '正在按你的说明整条重建学习路径'
          : '正在整条重建学习路径'
      });
    }

    // 有进行中任务或已完成任务（有学习进度）→ 走 replan-stage 语义（保留已完成，重设计当前活动阶段）
    if (hasInProgress || hasCompleted) {
      const fromStageNumber = Number.isInteger(req.body?.fromStageNumber) ? req.body.fromStageNumber : undefined;
      const clearedSessionIds = Array.isArray(req.body?.clearedSessionIds) && req.body.clearedSessionIds.length > 0
        ? req.body.clearedSessionIds.filter((x: unknown) => typeof x === 'string')
        : undefined;
      // 复用 requestPathReplan 的 overwrite 分支：补充说明作为 reason，重设计当前活动阶段
      // （显式传 fromStageNumber 时转为后续阶段多阶段重排）
      const result = await learningService.requestPathReplan({
        pathId,
        userId,
        triggerSource: 'api',
        mode: 'overwrite',
        reason: adjustments || '用户主动调整路径',
        requireConfirmation: false,
        ...(fromStageNumber ? { fromStageNumber } : {}),
        evidence: {
          adjustments,
          source: 'path-regenerate',
          ...(clearedSessionIds ? { clearedSessionIds } : {})
        }
      });
      return res.json({
        success: true,
        data: result,
        message: fromStageNumber
          ? '已按你的说明从该阶段起调整剩余部分'
          : (adjustments
            ? '已按你的补充说明调整后续阶段'
            : '已调整后续阶段')
      });
    }

    // 无学习进度 → 整路径重建（现有 replace-path 语义），补充说明注入 goal 请求
    const runId = await learningService.claimPathCoreGeneration(pathId, path.activeGenerationRunId);

    const storedGoalRequest = buildStoredGoalPathRequest(path, adjustments)
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
        userProfile: {
          ...(adjustments ? { replan: { mode: 'regenerate-user', reason: adjustments, sourcePathId: pathId } } : {})
        }
      }, {
        onError: async (error) => {
          logger.error(`重新生成学习路径失败：${pathId}`, error);
          await learningService.markActiveGenerationFailed(pathId, error, runId);
        }
      });
    }

    res.json({
      success: true,
      data: { runId, adjustments },
      message: adjustments
        ? '正在按你的补充说明重新生成学习路径'
        : '正在重新生成学习路径'
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
      fromStageNumber: payload.fromStageNumber,
      evidence: {
        ...(payload.evidence || {}),
        ...(payload.clearedSessionIds?.length ? { clearedSessionIds: payload.clearedSessionIds } : {})
      },
      requireConfirmation: payload.requireConfirmation,
      previewOnly: payload.previewOnly
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

// 一键清场：把路径调整范围内未结束的 AI 课堂按放弃（learner-abandoned）收尾
// body: { fromStageNumber?, stageNumber?, sessionIds? }
// 返回 cleared/failed/remaining，前端可据此提示并自动重试调整请求
router.post('/paths/:pathId/abandon-open-sessions', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { pathId } = req.params;
    const fromStageNumber = Number.isInteger(req.body?.fromStageNumber) ? req.body.fromStageNumber : undefined;
    const stageNumber = Number.isInteger(req.body?.stageNumber) ? req.body.stageNumber : undefined;
    const sessionIds = Array.isArray(req.body?.sessionIds) && req.body.sessionIds.length > 0
      ? req.body.sessionIds.filter((x: unknown) => typeof x === 'string')
      : undefined;

    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { userId: true }
    });
    if (!path) {
      return res.status(404).json({ success: false, error: { message: '学习路径不存在' } });
    }
    if (path.userId !== userId) {
      return res.status(403).json({ success: false, error: { message: '无权访问此学习路径' } });
    }

    // 解析调整范围对应的任务集（与 replan 的 fromStage/stage 语义对齐）
    const milestones = await prisma.milestones.findMany({
      where: { learningPathId: pathId },
      include: { subtasks: { select: { id: true } } },
      orderBy: { stageNumber: 'asc' }
    });
    const firstOpen = milestones.find((m: any) => m.status !== 'completed');
    let scopeTaskIds: string[] = [];
    let scopeMilestoneIds: string[] = [];
    if (fromStageNumber) {
      const from = milestones.find((m: any) => m.stageNumber === fromStageNumber);
      if (from) {
        const scoped = milestones.filter((m: any) => m.stageNumber >= from.stageNumber && m.status !== 'completed');
        scopeMilestoneIds = scoped.map((m: any) => m.id);
        scopeTaskIds = scoped.flatMap((m: any) => (m.subtasks || []).map((t: any) => t.id));
      }
    } else if (stageNumber) {
      const scoped = milestones.filter((m: any) => m.stageNumber === stageNumber);
      scopeMilestoneIds = scoped.map((m: any) => m.id);
      scopeTaskIds = scoped.flatMap((m: any) => (m.subtasks || []).map((t: any) => t.id));
    } else if (firstOpen) {
      const scoped = milestones.filter((m: any) => m.stageNumber >= firstOpen.stageNumber && m.status !== 'completed');
      scopeMilestoneIds = scoped.map((m: any) => m.id);
      scopeTaskIds = scoped.flatMap((m: any) => (m.subtasks || []).map((t: any) => t.id));
    }

    const result = await openSessionClearanceService.abandonBlocking({
      pathId,
      userId,
      taskIds: scopeTaskIds.length > 0 ? scopeTaskIds : undefined,
      milestoneIds: scopeMilestoneIds.length > 0 ? scopeMilestoneIds : undefined,
      ...(sessionIds ? { taskIds: undefined, milestoneIds: undefined } : {})
    });

    res.json({
      success: true,
      data: {
        cleared: result.cleared,
        failed: result.failed,
        remaining: result.remaining,
        allCleared: result.remaining.length === 0,
      },
      message: result.cleared.length > 0
        ? `已按放弃结束 ${result.cleared.length} 个未完成课堂`
        : '没有需要结束的课堂'
    });
  } catch (error: any) {
    logger.error('放弃课堂失败:', error);
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
