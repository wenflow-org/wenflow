import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import goalConversationService from '../services/learning/goal-conversation.service';

const router = express.Router();

router.post('/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { goal } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    if (!goal || goal.trim().length === 0) {
      return res.status(400).json({ success: false, error: '学习目标不能为空' });
    }

    const result = await goalConversationService.startConversation(userId, goal.trim());
    return res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('开始对话失败:', error);
    return res.status(500).json({ success: false, error: error.message || '开始对话失败' });
  }
});

router.post('/:conversationId/reply', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { conversationId } = req.params;
    const { reply } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    if (!reply || reply.trim().length === 0) {
      return res.status(400).json({ success: false, error: '回复内容不能为空' });
    }

    const result = await goalConversationService.continueConversation(conversationId, reply.trim(), userId);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('继续对话失败:', error);
    const status = error.message === '对话会话不存在' ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message || '继续对话失败' });
  }
});

router.post('/:conversationId/regenerate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { conversationId } = req.params;
    const { adjustments } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    const result = await goalConversationService.regeneratePath(conversationId, userId, adjustments?.trim() || undefined);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('重新生成路径失败:', error);
    const status = error.message === '对话会话不存在' ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message || '重新生成路径失败' });
  }
});

router.delete('/:conversationId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { conversationId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    await goalConversationService.deleteConversation(conversationId, userId);
    return res.json({ success: true, message: '对话已重置' });
  } catch (error: any) {
    logger.error('重置对话失败:', error);
    const status = error.message === '对话会话不存在' ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message || '重置对话失败' });
  }
});

router.get('/:conversationId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { conversationId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    const conversation = await goalConversationService.getConversation(conversationId, userId);
    return res.json({ success: true, data: conversation });
  } catch (error: any) {
    logger.error('获取对话会话失败:', error);
    const status = error.message === '对话会话不存在' ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message || '获取对话会话失败' });
  }
});

router.post('/quick-generate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { goal, level = 'beginner', timePerDay = '1 小时', learningStyle = 'mixed' } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    if (!goal || goal.trim().length === 0) {
      return res.status(400).json({ success: false, error: '学习目标不能为空' });
    }

    const result = await goalConversationService.quickGeneratePath(userId, {
      goal: goal.trim(),
      level,
      timePerDay,
      learningStyle
    });

    return res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('快速生成失败:', error);
    return res.status(500).json({ success: false, error: error.message || '快速生成失败' });
  }
});

export default router;
