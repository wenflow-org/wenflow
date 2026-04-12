import express, { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { interactiveSessionService, InteractiveSessionData, UserResponse, ContentSegment } from '../services/learning/interactive-session.service';
import { logger } from '../utils/logger';
import { InteractiveContentAgent, InteractiveSession } from '../agents/content-agent-interactive';
import prisma from '../config/database';

const router = express.Router();

router.use(authMiddleware);

router.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { message: '未授权' }
      });
    }
    
    const { taskId, pathId } = req.body;
    
    if (!taskId || !pathId) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 taskId 或 pathId' }
      });
    }
    
    const existingSession = await interactiveSessionService.getSessionByTask(userId, taskId);
    if (existingSession) {
      return res.json({
        success: true,
        data: {
          sessionId: existingSession.id,
          stage: existingSession.stage,
          activationQuestion: existingSession.activationQuestion || '提到这个主题，你脑海中第一个浮现的画面或经历是什么？',
          resumed: true
        }
      });
    }
    
    const session = await interactiveSessionService.createSession(userId, taskId, pathId);
    
    const task = await prisma.subtasks.findUnique({
      where: { id: taskId },
      select: { title: true, description: true }
    });
    
    const agent = new InteractiveContentAgent();
    const agentOutput = await agent.startSession({
      userId,
      taskId,
      topic: task?.title || '学习任务',
      description: task?.description || ''
    });
    
    if (agentOutput.content) {
      await interactiveSessionService.addSegment(session.id, agentOutput.content);
    }
    
    await prisma.interactive_sessions.update({
      where: { id: session.id },
      data: { activationQuestion: agentOutput.content?.content }
    });
    
    res.json({
      success: true,
      data: {
        sessionId: session.id,
        stage: 'ACTIVATION',
        activationQuestion: agentOutput.content?.content || '提到这个主题，你脑海中第一个浮现的画面是什么？'
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const session = await interactiveSessionService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    res.json({
      success: true,
      data: session
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:sessionId/next', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const session = await interactiveSessionService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    if (session.stage === 'CHECK' || session.stage === 'COMPLETED') {
      return res.json({
        success: true,
        data: {
          stage: session.stage,
          content: session.segments[session.segments.length - 1],
          isComplete: session.stage === 'COMPLETED'
        }
      });
    }
    
    const task = await prisma.subtasks.findUnique({
      where: { id: session.taskId },
      select: { title: true, description: true }
    });
    
    const agentSession: InteractiveSession = {
      sessionId: session.id,
      userId: session.userId,
      taskId: session.taskId,
      stage: session.stage as any,
      segments: session.segments as any,
      userResponses: session.userResponses as any,
      understandingScore: session.understandingScore || null,
      skippedActivation: session.skippedActivation,
      learningProfile: { preferredExamples: [], painPoints: [] },
      taskInfo: {
        topic: task?.title || '学习任务',
        description: task?.description || ''
      }
    };
    
    const agent = new InteractiveContentAgent();
    const agentOutput = await agent.getNextContent(agentSession);
    
    if (agentOutput.content) {
      await interactiveSessionService.addSegment(sessionId, agentOutput.content);
    }
    
    await interactiveSessionService.updateStage(sessionId, agentOutput.stage);
    
    res.json({
      success: true,
      data: {
        stage: agentOutput.stage,
        content: agentOutput.content,
        isComplete: agentOutput.isComplete
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:sessionId/respond', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const { response, skipped } = req.body;
    
    const session = await interactiveSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    const userResponse: UserResponse = {
      stage: session.stage,
      response: response || '',
      timestamp: new Date().toISOString(),
      skipped: skipped || false
    };
    
    await interactiveSessionService.addUserResponse(sessionId, userResponse);
    
    if (session.stage === 'ACTIVATION' && skipped) {
      await interactiveSessionService.markActivationSkipped(sessionId);
    }
    
    res.json({
      success: true,
      message: '回答已记录',
      data: {
        stage: session.stage,
        responseRecorded: true
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:sessionId/skip', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body;
    
    const session = await interactiveSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    await interactiveSessionService.addUserResponse(sessionId, {
      stage: session.stage,
      response: reason || '',
      timestamp: new Date().toISOString(),
      skipped: true
    });
    
    if (session.stage === 'ACTIVATION') {
      await interactiveSessionService.markActivationSkipped(sessionId);
    }
    
    res.json({
      success: true,
      message: '已跳过当前阶段'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:sessionId/stage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const { stage, segment } = req.body;
    
    const session = await interactiveSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    await interactiveSessionService.updateStage(sessionId, stage);
    
    if (segment) {
      await interactiveSessionService.addSegment(sessionId, segment as ContentSegment);
    }
    
    res.json({
      success: true,
      message: '阶段已更新',
      data: { stage }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:sessionId/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const { answer } = req.body;
    
    const session = await interactiveSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    await interactiveSessionService.addUserResponse(sessionId, {
      stage: 'CHECK',
      response: answer || '',
      timestamp: new Date().toISOString(),
      skipped: false
    });
    
    await interactiveSessionService.updateStage(sessionId, 'CHECK');
    
    const level = 'passed';
    const score = 0.85;
    
    res.json({
      success: true,
      data: {
        level,
        score,
        feedback: '很好！你已经理解了核心概念。',
        needReview: false
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:sessionId/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;
    const { understandingScore, understandingLevel } = req.body;
    
    const session = await interactiveSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在' }
      });
    }
    
    await interactiveSessionService.completeSession(
      sessionId,
      understandingScore,
      understandingLevel
    );
    
    res.json({
      success: true,
      message: '学习会话已完成'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/user/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { message: '未授权' }
      });
    }
    
    const limit = parseInt(req.query.limit as string) || 10;
    const sessions = await interactiveSessionService.getUserSessions(userId, limit);
    
    res.json({
      success: true,
      data: sessions
    });
  } catch (error) {
    next(error);
  }
});

export default router;