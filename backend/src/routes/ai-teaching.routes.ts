/**
 * AI Teaching Routes - AI 原生授课 API
 * 
 * 提供：
 * - 授课会话管理
 * - 消息处理（含认知分析和干预）
 * - 学习状态查询
 */

import { Router } from 'express';
import aiTeachingOrchestrator from '../services/ai-teaching/AITeachingOrchestrator';
import learningStateService from '../services/learning/learning-state.service';
import { authMiddleware } from '../middleware/auth.middleware';
import prisma from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

// 应用认证中间件
router.use(authMiddleware);

/**
 * 开始授课会话
 * POST /api/ai-teaching/sessions
 */
router.post('/sessions', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { subject, topic, difficulty = 5, taskId } = req.body;
    if (!subject || !topic) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数：subject, topic',
      });
    }

    // 从任务详情中获取 taskType
    let taskType: 'reading' | 'practice' | 'project' | 'quiz' = 'practice';
    if (taskId) {
      try {
        const task = await prisma.subtasks.findUnique({
          where: { id: taskId },
          select: { taskType: true },
        });
        if (task?.taskType) {
          taskType = task.taskType as 'reading' | 'practice' | 'project' | 'quiz';
        }
      } catch (error) {
        logger.warn(`获取任务 ${taskId} 的 taskType 失败：${error}`);
      }
    }

    const sessionId = `teaching_${Date.now()}_${userId}`;

    const session = await aiTeachingOrchestrator.startSession({
      userId,
      sessionId,
      subject,
      topic,
      difficulty,
      taskType,
      taskId,
    });

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        subject: session.subject,
        topic: session.topic,
        startTime: session.startTime,
        welcomeMessage: session.welcomeMessage,
      },
    });
  } catch (error: any) {
    console.error('开始授课会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '开始会话失败',
    });
  }
});

/**
 * 处理学生消息（核心 API）
 * POST /api/ai-teaching/sessions/:sessionId/messages
 */
router.post('/sessions/:sessionId/messages', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { sessionId } = req.params;
    const { message, lssInputs } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: '缺少消息内容',
      });
    }

    const result = await aiTeachingOrchestrator.processStudentMessage(
      sessionId,
      message,
      lssInputs
    );

    res.json({
      success: true,
      data: {
        aiResponse: result.aiResponse,
        analysis: {
          cognitiveLevel: result.analysis.cognitiveLevel,
          levelScore: result.analysis.levelScore,
          understanding: result.analysis.understanding,
          confusionPoints: result.analysis.confusionPoints,
          engagement: result.analysis.engagement,
          emotionalState: result.analysis.emotionalState,
        },
        state: {
          lss: result.currentState.lss,
          ktl: result.currentState.ktl,
          lf: result.currentState.lf,
          lsb: result.currentState.lsb,
        },
        strategies: result.strategies,
        knowledgePoint: result.knowledgePoint,
        knowledgePoints: result.knowledgePoints,
        isCompletion: result.isCompletion,
        peerTriggered: result.peerTriggered,
        peerMessage: result.peerMessage,
      },
    });
  } catch (error: any) {
    console.error('处理消息失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '处理消息失败',
    });
  }
});

/**
 * 结束授课会话
 * POST /api/ai-teaching/sessions/:sessionId/end
 */
router.post('/sessions/:sessionId/end', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { sessionId } = req.params;
    const result = await aiTeachingOrchestrator.endSession(sessionId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('结束会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '结束会话失败',
    });
  }
});

/**
 * 获取当前学习状态
 * GET /api/ai-teaching/state
 */
router.get('/state', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const state = await learningStateService.getCurrentState(userId);

    if (!state) {
      return res.json({
        success: true,
        data: null,
        message: '暂无学习状态数据',
      });
    }

    // 生成建议
    const suggestion = learningStateService.generateSuggestion(state);

    res.json({
      success: true,
      data: {
        lss: state.lss,
        ktl: state.ktl,
        lf: state.lf,
        lsb: state.lsb,
        suggestion,
      },
    });
  } catch (error: any) {
    console.error('获取学习状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取状态失败',
    });
  }
});

/**
 * 获取学习状态趋势
 * GET /api/ai-teaching/trends
 */
router.get('/trends', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const days = parseInt(req.query.days as string) || 7;
    const trends = await learningStateService.getTrends(userId, days);

    res.json({
      success: true,
      data: trends.map(t => ({
        timestamp: t.timestamp,
        lss: t.lss,
        ktl: t.ktl,
        lf: t.lf,
        lsb: t.lsb,
      })),
    });
  } catch (error: any) {
    console.error('获取趋势失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取趋势失败',
    });
  }
});

/**
 * 处理学习伙伴消息
 * POST /api/ai-teaching/sessions/:sessionId/peer/messages
 */
router.post('/sessions/:sessionId/peer/messages', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { sessionId } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: '缺少消息内容',
      });
    }

    const result = await aiTeachingOrchestrator.processPeerMessage(
      sessionId,
      message
    );

    res.json({
      success: true,
      data: {
        peerResponse: result.peerResponse,
      },
    });
  } catch (error: any) {
    console.error('处理学习伙伴消息失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '处理消息失败',
    });
  }
});

/**
 * 认知分析（独立 API）
 * POST /api/ai-teaching/analyze-cognitive
 */
router.post('/analyze-cognitive', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({
        success: false,
        error: '缺少消息内容',
      });
    }

    // 使用学习状态服务进行分析
    const analysis = learningStateService.analyzeCognitiveLevel(message, context);

    res.json({
      success: true,
      data: analysis,
    });
  } catch (error: any) {
    console.error('认知分析失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '分析失败',
    });
  }
});

/**
 * 获取活跃会话列表
 * GET /api/ai-teaching/sessions/active
 * 支持查询参数：taskId（可选）
 */
router.get('/sessions/active', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { taskId } = req.query;

    const sessions = await aiTeachingOrchestrator.getSessionHistory(userId);
    const activeSessions = sessions.filter(s => s.status === 'active');
    
    if (taskId) {
      const filtered = activeSessions
        .filter(s => s.taskId === taskId)
        .map(s => ({
          sessionId: s.id,
          subject: s.subject,
          topic: s.topic,
          startTime: s.startTime,
          messageCount: s.messageCount,
        }));
      return res.json({ success: true, data: filtered });
    }

    res.json({
      success: true,
      data: activeSessions.map(s => ({
        sessionId: s.id,
        subject: s.subject,
        topic: s.topic,
        startTime: s.startTime,
        messageCount: s.messageCount,
      })),
    });
  } catch (error: any) {
    console.error('获取活跃会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取会话失败',
    });
  }
});

/**
 * 获取历史授课会话列表
 * GET /api/ai-teaching/sessions/history
 */
router.get('/sessions/history', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const sessions = await aiTeachingOrchestrator.getSessionHistory(userId);

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error: any) {
    console.error('获取历史会话失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取历史会话失败',
    });
  }
});

/**
 * 获取授课会话详情
 * GET /api/ai-teaching/sessions/:sessionId/detail
 */
router.get('/sessions/:sessionId/detail', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { sessionId } = req.params;
    const session = await aiTeachingOrchestrator.getSessionDetail(sessionId, userId);

    if (!session) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    console.error('获取会话详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取会话详情失败',
    });
  }
});

/**
 * 获取指定任务最近一次授课评估
 * GET /api/ai-teaching/tasks/:taskId/evaluation/latest
 */
router.get('/tasks/:taskId/evaluation/latest', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { taskId } = req.params;
    const evaluation = await aiTeachingOrchestrator.getLatestTaskEvaluation(taskId, userId);

    if (!evaluation) {
      return res.json({ success: true, data: null, message: '暂无当堂评估记录' });
    }

    res.json({
      success: true,
      data: evaluation,
    });
  } catch (error: any) {
    console.error('获取任务评估失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取任务评估失败',
    });
  }
});

export default router;
