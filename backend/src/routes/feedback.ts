import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  FeedbackCollectionError,
  feedbackCollectionService
} from '../services/feedback/feedback-collection.service';
import { logger } from '../utils/logger';

const router = Router();

const feedbackBodySchema = z.object({
  taskId: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  helpfulness: z.number().int().min(1).max(5).optional(),
  clarity: z.number().int().min(1).max(5).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  difficultyFit: z.enum(['too_easy', 'appropriate', 'too_hard']).optional(),
  comment: z.string().trim().max(1000).optional(),
  suggestions: z.string().trim().max(1000).optional(),
  confusionPoint: z.string().trim().max(500).optional(),
  reasonCodes: z.array(z.string().trim().min(1).max(64)).max(10).optional()
}).strict();

/** 消息级点赞/点踩（message-thumbs）：按消息内容去重，不依赖消息 id */
const messageFeedbackBodySchema = z.object({
  messageText: z.string().trim().min(1).max(5000),
  thumbsUp: z.boolean(),
  comment: z.string().trim().max(500).optional()
}).strict();

function sendFeedbackError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: { message: error.errors[0]?.message || '反馈格式无效', code: 'VALIDATION_ERROR' }
    });
  }
  if (error instanceof FeedbackCollectionError) {
    return res.status(error.status).json({
      success: false,
      error: { message: error.message, code: error.code, status: error.status }
    });
  }

  logger.error(fallback, error);
  return res.status(500).json({
    success: false,
    error: { message: fallback, code: 'INTERNAL_ERROR', status: 500 }
  });
}

async function submitSessionFeedback(req: Request, res: Response, sessionId: string) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: { message: '未登录' } });
    const input = feedbackBodySchema.parse(req.body);
    const feedback = await feedbackCollectionService.submitFeedback({
      userId,
      sessionId,
      taskId: input.taskId!,
      rating: input.rating!,
      helpfulness: input.helpfulness,
      clarity: input.clarity,
      difficulty: input.difficulty,
      difficultyFit: input.difficultyFit,
      comment: input.comment,
      suggestions: input.suggestions,
      confusionPoint: input.confusionPoint,
      reasonCodes: input.reasonCodes
    });
    return res.json({
      success: true,
      message: '感谢你的反馈！',
      data: feedback
    });
  } catch (error) {
    return sendFeedbackError(res, error, '提交反馈失败，请重试');
  }
}

router.put('/sessions/:sessionId', async (req, res) => {
  return submitSessionFeedback(req, res, req.params.sessionId);
});

/** 消息级点赞/点踩：PUT /feedback/sessions/:sessionId/message-thumbs */
router.put('/sessions/:sessionId/message-thumbs', async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: { message: '未登录' } });
    const input = messageFeedbackBodySchema.parse(req.body);
    const feedback = await feedbackCollectionService.submitMessageFeedback({
      userId,
      sessionId: req.params.sessionId,
      messageText: input.messageText,
      thumbsUp: input.thumbsUp,
      comment: input.comment
    });
    return res.json({
      success: true,
      message: input.thumbsUp ? '已记录你的认可' : '已记录，我们会参考改进',
      data: feedback
    });
  } catch (error) {
    return sendFeedbackError(res, error, '提交反馈失败，请重试');
  }
});

router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: { message: '未登录' } });
    const feedback = await feedbackCollectionService.getSessionFeedback(userId, req.params.sessionId);
    return res.json({ success: true, data: feedback });
  } catch (error) {
    return sendFeedbackError(res, error, '获取反馈失败，请重试');
  }
});

router.get('/my-feedback', async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: { message: '未登录' } });
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
    const result = await feedbackCollectionService.getUserFeedback(userId, page, limit);
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
    return sendFeedbackError(res, error, '获取反馈历史失败，请重试');
  }
});

export default router;
