import { Router } from 'express';
import { z } from 'zod';
import {
  FeedbackCollectionError,
  feedbackCollectionService
} from '../../services/feedback/feedback-collection.service';
import { logger } from '../../utils/logger';

const router = Router();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  maxRating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(['new', 'triaged', 'resolved', 'dismissed']).optional(),
  userId: z.string().trim().min(1).optional(),
  taskId: z.string().trim().min(1).optional()
});

const updateBodySchema = z.object({
  status: z.enum(['new', 'triaged', 'resolved', 'dismissed']).optional(),
  assigneeAdminId: z.string().trim().min(1).nullable().optional(),
  internalNote: z.string().trim().max(2000).nullable().optional()
}).strict().refine(value => Object.keys(value).length > 0, '至少提供一个更新字段');

function sendError(res: any, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, error: { message: error.errors[0]?.message || '请求格式无效' } });
  }
  if (error instanceof FeedbackCollectionError) {
    return res.status(error.status).json({ success: false, error: { message: error.message, code: error.code } });
  }
  logger.error(fallback, error);
  return res.status(500).json({ success: false, error: { message: fallback } });
}

router.get('/', async (req, res) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const result = await feedbackCollectionService.listAdminFeedback({
      page,
      limit,
      maxRating: query.maxRating,
      status: query.status,
      userId: query.userId,
      taskId: query.taskId
    });
    return res.json({
      success: true,
      data: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    });
  } catch (error) {
    return sendError(res, error, '获取反馈列表失败');
  }
});

router.get('/task/:taskId/stats', async (req, res) => {
  try {
    return res.json({ success: true, data: await feedbackCollectionService.getTaskFeedbackStats(req.params.taskId) });
  } catch (error) {
    return sendError(res, error, '获取任务反馈统计失败');
  }
});

router.get('/strategy/stats', async (_req, res) => {
  try {
    return res.json({ success: true, data: await feedbackCollectionService.getStrategyFeedbackStats() });
  } catch (error) {
    return sendError(res, error, '获取策略反馈统计失败');
  }
});

router.get('/ui-type/stats', async (_req, res) => {
  try {
    return res.json({ success: true, data: await feedbackCollectionService.getUITypeFeedbackStats() });
  } catch (error) {
    return sendError(res, error, '获取界面反馈统计失败');
  }
});

router.get('/trend', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number.parseInt(String(req.query.days || '30'), 10) || 30));
    return res.json({ success: true, data: await feedbackCollectionService.getFeedbackTrend(days) });
  } catch (error) {
    return sendError(res, error, '获取反馈趋势失败');
  }
});

router.get('/time-range/stats', async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : new Date();
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
      return res.status(400).json({ success: false, error: { message: '时间范围无效' } });
    }
    return res.json({ success: true, data: await feedbackCollectionService.getTimeRangeFeedbackStats(startDate, endDate) });
  } catch (error) {
    return sendError(res, error, '获取反馈统计失败');
  }
});

router.get('/:feedbackId', async (req, res) => {
  try {
    const feedback = await feedbackCollectionService.getAdminFeedback(req.params.feedbackId);
    if (!feedback) return res.status(404).json({ success: false, error: { message: '反馈不存在' } });
    return res.json({ success: true, data: feedback });
  } catch (error) {
    return sendError(res, error, '获取反馈详情失败');
  }
});

router.patch('/:feedbackId', async (req, res) => {
  try {
    const input = updateBodySchema.parse(req.body);
    const feedback = await feedbackCollectionService.updateAdminFeedback(req.params.feedbackId, input);
    return res.json({ success: true, data: feedback });
  } catch (error) {
    return sendError(res, error, '更新反馈失败');
  }
});

export default router;
