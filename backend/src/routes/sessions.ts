// 学习会话路由
import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import prisma from '../config/database';

const router = express.Router();

router.use(authMiddleware);

// 开始学习会话
router.post('/start', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { message: '未登录' }
      });
    }
    const { taskId, goalId } = req.body;

    const { learningSessionService } = await import('../services/learning/learning-session.service');
    
    const session = await learningSessionService.createSession(userId, goalId);

    res.status(201).json({
      success: true,
      data: { session }
    });
  } catch (error: any) {
    next(error);
  }
});

// 结束学习会话
router.post('/:sessionId/end', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { message: '未登录' }
      });
    }
    const { sessionId } = req.params;
    const { notes, subjectiveDifficulty } = req.body;

    const session = await prisma.learning_sessions.findUnique({
      where: { id: sessionId },
      select: { userId: true }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: '学习会话不存在' }
      });
    }

    if (session.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: { message: '无权操作此会话' }
      });
    }

    const { learningSessionService } = await import('../services/learning/learning-session.service');
    
    await learningSessionService.closeSession(sessionId);

    const closedSession = await learningSessionService.getSession(sessionId);

    res.json({
      success: true,
      data: closedSession
    });
  } catch (error: any) {
    if (error.message === '学习会话不存在') {
      return res.status(404).json({
        success: false,
        error: { message: error.message }
      });
    }
    next(error);
  }
});

// 获取用户学习会话列表
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { message: '未登录' }
      });
    }
    const { taskId, limit = 20 } = req.query;

    const { learningSessionService } = await import('../services/learning/learning-session.service');
    
    const sessions = await learningSessionService.getActiveSessions(userId);

    res.json({
      success: true,
      data: sessions
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;