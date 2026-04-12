// AI路由
import express from 'express';
import { z } from 'zod';
import aiService from '../services/ai/ai.service';
import { optionalAuthMiddleware } from '../middleware/auth.middleware';
import prisma from '../config/database';

const router = express.Router();

// AI路由使用可选认证 - 允许未登录用户试用
router.use(optionalAuthMiddleware);

// 对话schema
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string()
  })),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  model: z.string().optional() // 允许指定模型
});

// 学习目标分析schema
const analyzeGoalSchema = z.object({
  goal: z.string().min(1, '学习目标不能为空'),
  userProfile: z.object({
    skillLevel: z.string().optional(),
    learningStyle: z.string().optional(),
    timePerDay: z.string().optional()
  }).optional()
});

// Prompt Lab 批量评估 schema
const evalBatchSchema = z.object({
  promptTemplate: z.string().min(1),
  testCases: z.array(z.record(z.any())).min(1),
  config: z.object({
    model: z.string().optional(),
    temperature: z.number().optional(),
    judgeModel: z.string().optional()
  }).optional()
});

// 获取所有系统Prompt
router.get('/prompts', async (req, res, next) => {
  try {
    const prompts = aiService.getSystemPrompts();
    res.json({
      success: true,
      data: prompts
    });
  } catch (error: any) {
    next(error);
  }
});

// AI对话
router.post('/chat', async (req, res, next) => {
  try {
    const data = chatSchema.parse(req.body);
    const messages = data.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

    const result = await aiService.chat(
      messages,
      {
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        model: data.model
      }
    );

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

    next(error);
  }
});

// Prompt Lab 单次测试路由 (前端 debug 使用)
router.post('/debug/eval', async (req, res, next) => {
  try {
    const { systemPrompt, userMessage, model, reasoningModel, judgeModel, judgePrompt } = req.body;

    if (!systemPrompt || !userMessage) {
      return res.status(400).json({
        success: false,
        error: { message: 'systemPrompt 和 userMessage 是必需的' }
      });
    }

    const aiModel = model || process.env.AI_MODEL || 'deepseek-chat';

    // 1. 调用AI生成结果
    const startTime = Date.now();
    const generationResult = await aiService.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], {
      model: aiModel,
      temperature: 0.7
    });
    const duration = Date.now() - startTime;

    // 2. 解析JSON结果
    let parsed = null;
    let parseError = null;
    try {
      const jsonMatch = generationResult.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      parseError = 'JSON解析失败';
    }

    // 3. 调用AI裁判打分
    let judgeResult = null;
    if (judgeModel && judgePrompt) {
      judgeResult = await aiService.judgeResult(
        systemPrompt,
        generationResult.content,
        judgeModel,
        judgePrompt
      );
    }

    res.json({
      success: true,
      data: {
        content: generationResult.content,
        parsed: parsed,
        parseError: parseError,
        judgeComment: judgeResult?.critique || judgeResult?.error || '',
        score: judgeResult?.score || 0,
        metrics: {
          duration,
          tokens: generationResult.usage
        }
      }
    });
  } catch (error: any) {
    next(error);
  }
});

// Prompt Lab 批量评估路由
router.post('/prompt/eval-batch', async (req, res, next) => {
  try {
    const data = evalBatchSchema.parse(req.body);

    // 可以在这里加权限控制，防止滥用
    // if (!req.user?.isAdmin) ...

    const result = await aiService.evaluatePromptBatch({
      promptTemplate: data.promptTemplate,
      testCases: data.testCases,
      config: data.config
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
    next(error);
  }
});

// 分析学习目标
router.post('/analyze-goal', async (req, res, next) => {
  try {
    const data = analyzeGoalSchema.parse(req.body);

    const result = await aiService.analyzeLearningGoal(
      data.goal,
      data.userProfile
    );

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

    next(error);
  }
});

// AI辅导
router.post('/tutor', async (req, res, next) => {
  try {
    const { question, context } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        error: { message: '问题不能为空' }
      });
    }

    // 从认证中间件获取 userId
    const userId = req.user?.userId;

    const result = await aiService.tutoring(question, {
      ...context,
      userId
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    next(error);
  }
});

// ZPD分层AI辅导
router.post('/zpd-tutor', async (req, res, next) => {
  try {
    // 需要认证才能使用ZPD辅导
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        error: { message: '需要登录才能使用ZPD辅导' }
      });
    }

    const { question, taskId, taskDescription, taskContext } = req.body;

    if (!question || !taskId || !taskDescription) {
      return res.status(400).json({
        success: false,
        error: { message: '问题、任务ID和任务描述是必需的' }
      });
    }

    // 获取用户信息
    const user = await prisma.users.findUnique({
      where: { id: req.user.userId },
      select: { xp: true }
    });

    // 获取用户完成的任务数（使用 subtasks 表）
    const completedTasksCount = await prisma.subtasks.count({
      where: {
        userId: req.user.userId,
        status: 'completed'
      }
    });

    // 调用ZPD辅导（通过 TutorAgent）
    const result = await aiService.zpdTutoring({
      question,
      taskDescription,
      userXP: user?.xp || 0,
      completedTasks: completedTasksCount || 0,
      taskContext,
      userId: req.user.userId // 传递 userId 用于 Agent 日志记录
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    next(error);
  }
});

// ============================================
// AI 授课 v5.0 API
// ============================================

import {
  tutorCoreHandlerFn,
  contentAgentV5HandlerFn,
  clearSessionState,
  getSessionState,
  createInitialLearningState,
  generateStateSnapshot,
  selectStrategy
} from '../agents';

// 授课会话状态 Schema
const tutorSessionSchema = z.object({
  sessionId: z.string().optional(),
  topic: z.string().min(1, '主题不能为空'),
  studentMessage: z.string().optional(),
  isCorrect: z.boolean().optional(),
  isNewSession: z.boolean().optional()
});

// 开始/继续授课会话
router.post('/tutor/session', async (req, res, next) => {
  try {
    const data = tutorSessionSchema.parse(req.body);
    const userId = req.user?.userId || 'anonymous';
    
    const result = await tutorCoreHandlerFn(
      {
        type: 'standard',
        goal: data.topic,
        metadata: {
          sessionId: data.sessionId,
          topic: data.topic,
          studentMessage: data.studentMessage,
          isCorrect: data.isCorrect,
          isNewSession: data.isNewSession ?? !data.sessionId
        }
      },
      { userId }
    );
    
    res.json({
      success: result.success,
      data: result.content,
      error: result.error
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

// 获取学习状态
router.get('/tutor/state/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const state = getSessionState(sessionId);
    
    if (!state) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    const { snapshot } = generateStateSnapshot(state);
    const strategy = selectStrategy(state);
    
    res.json({
      success: true,
      data: {
        state: snapshot,
        currentStrategy: strategy?.name || null
      }
    });
  } catch (error: any) {
    next(error);
  }
});

// 清理会话
router.delete('/tutor/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    clearSessionState(sessionId);
    
    res.json({
      success: true,
      message: '会话已清理'
    });
  } catch (error: any) {
    next(error);
  }
});

// 生成教学内容 v5.0
router.post('/tutor/content', async (req, res, next) => {
  try {
    const { topic, description, taskGoal, mastery, frustration, depthScore } = req.body;
    const userId = req.user?.userId || 'anonymous';
    
    const result = await contentAgentV5HandlerFn(
      {
        type: 'standard',
        goal: topic,
        metadata: {
          topic,
          description,
          taskGoal,
          mastery: mastery || 0,
          frustration: frustration || 0,
          depthScore: depthScore || 0.5
        }
      },
      { userId }
    );
    
    res.json({
      success: result.success,
      data: result.content,
      error: result.error
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
