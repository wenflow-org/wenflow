import { Router, Request, Response } from 'express';
import { feedbackCollectionService } from '../services/feedback/feedback-collection.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();

interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    isAdmin?: boolean;
  };
}

// 提交反馈
router.post('/submit', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const {
    sessionId,
    taskId,
    rating,
    helpfulness,
    clarity,
    difficulty,
    comment,
    suggestions,
    confusionPoint,
    strategy,
    uiType,
    roundNumber
  } = req.body;
  
  // 验证必填字段
  if (!sessionId || !taskId) {
    return res.status(400).json({
      error: '缺少必填字段：sessionId 或 taskId'
    });
  }
  
  // 验证评分
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({
      error: '评分必须在 1-5 之间'
    });
  }
  
  // 验证其他维度评分（如果提供）
  const dimensionFields = ['helpfulness', 'clarity', 'difficulty'];
  for (const field of dimensionFields) {
    const value = (req.body as any)[field];
    if (value !== undefined && (value < 1 || value > 5)) {
      return res.status(400).json({
        error: `${field} 评分必须在 1-5 之间`
      });
    }
  }
  
  try {
    await feedbackCollectionService.submitFeedback({
      userId: userId!,
      sessionId,
      taskId,
      rating,
      helpfulness,
      clarity,
      difficulty,
      comment,
      suggestions,
      confusionPoint,
      strategy,
      uiType,
      roundNumber
    });
    
    res.json({ 
      success: true, 
      message: '感谢你的反馈！',
      data: { submitted: true }
    });
  } catch (error) {
    logger.error('提交反馈失败:', error);
    res.status(500).json({ 
      error: '提交失败，请重试',
      details: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 获取我的反馈历史
router.get('/my-feedback', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const limit = parseInt(req.query.limit as string) || 50;
  const page = parseInt(req.query.page as string) || 1;
  const skip = (page - 1) * limit;
  
  try {
    const feedbacks = await feedbackCollectionService.getUserFeedback(userId!, limit);
    
    res.json({ 
      success: true, 
      data: feedbacks,
      pagination: {
        page,
        limit,
        total: feedbacks.length
      }
    });
  } catch (error) {
    logger.error('获取反馈历史失败:', error);
    res.status(500).json({ 
      error: '获取失败，请重试'
    });
  }
});

// 获取任务反馈统计（管理员）
router.get('/task/:taskId/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { taskId } = req.params;
  
  // 检查管理员权限
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: '需要管理员权限'
    });
  }
  
  try {
    const stats = await feedbackCollectionService.getTaskFeedbackStats(taskId);
    
    res.json({ 
      success: true, 
      data: stats
    });
  } catch (error) {
    logger.error('获取任务反馈统计失败:', error);
    res.status(500).json({ 
      error: '获取失败，请重试'
    });
  }
});

// 获取策略反馈统计（管理员）
router.get('/strategy/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  // 检查管理员权限
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: '需要管理员权限'
    });
  }
  
  try {
    const stats = await feedbackCollectionService.getStrategyFeedbackStats();
    
    res.json({ 
      success: true, 
      data: stats
    });
  } catch (error) {
    logger.error('获取策略反馈统计失败:', error);
    res.status(500).json({ 
      error: '获取失败，请重试'
    });
  }
});

// 获取 UI 类型反馈统计（管理员）
router.get('/uitype/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  // 检查管理员权限
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: '需要管理员权限'
    });
  }
  
  try {
    const stats = await feedbackCollectionService.getUITypeFeedbackStats();
    
    res.json({ 
      success: true, 
      data: stats
    });
  } catch (error) {
    logger.error('获取 UI 类型反馈统计失败:', error);
    res.status(500).json({ 
      error: '获取失败，请重试'
    });
  }
});

// 获取低分反馈（管理员）
router.get('/low-ratings', authMiddleware, async (req: AuthRequest, res: Response) => {
  // 检查管理员权限
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: '需要管理员权限'
    });
  }
  
  const threshold = parseInt(req.query.threshold as string) || 3;
  const limit = parseInt(req.query.limit as string) || 100;
  
  try {
    const feedbacks = await feedbackCollectionService.getLowRatingFeedback(threshold, limit);
    
    res.json({ 
      success: true, 
      data: feedbacks,
      pagination: {
        threshold,
        limit,
        total: feedbacks.length
      }
    });
  } catch (error) {
    logger.error('获取低分反馈失败:', error);
    res.status(500).json({ 
      error: '获取失败，请重试'
    });
  }
});

// 获取反馈趋势（管理员）
router.get('/trend', authMiddleware, async (req: AuthRequest, res: Response) => {
  // 检查管理员权限
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: '需要管理员权限'
    });
  }
  
  const days = parseInt(req.query.days as string) || 30;
  
  try {
    const trend = await feedbackCollectionService.getFeedbackTrend(days);
    
    res.json({ 
      success: true, 
      data: trend
    });
  } catch (error) {
    logger.error('获取反馈趋势失败:', error);
    res.status(500).json({ 
      error: '获取失败，请重试'
    });
  }
});

// 获取时间段反馈统计（管理员）
router.get('/time-range/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  // 检查管理员权限
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: '需要管理员权限'
    });
  }
  
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
  
  try {
    const stats = await feedbackCollectionService.getTimeRangeFeedbackStats(startDate, endDate);
    
    res.json({ 
      success: true, 
      data: stats
    });
  } catch (error) {
    logger.error('获取时间段反馈统计失败:', error);
    res.status(500).json({ 
      error: '获取失败，请重试'
    });
  }
});

export default router;
