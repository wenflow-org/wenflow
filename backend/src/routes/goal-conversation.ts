import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import requirementOrchestrator from '../coordinators/requirement.coordinator';

const router = express.Router();

function envelopeGoalConversation(result: any, fallbackConversationId?: string) {
  const internal = result?.internal || {};
  const core = internal?.core || {};
  const goalExt = internal?.ext?.goalConversation || {};

  return {
    userVisible: result?.userVisible || '',
    internal: {
      core: {
        conversationId: core.conversationId || fallbackConversationId || null,
        stage: core.stage || 'understanding',
        confidence: typeof core.confidence === 'number' ? core.confidence : 0,
        isCompleted: !!core.isCompleted,
        learningPath: core.learningPath || null
      },
      ext: {
        goalConversation: {
          understanding: goalExt.understanding || {},
          nextQuestions: Array.isArray(goalExt.nextQuestions) ? goalExt.nextQuestions : [],
          quickReplies: Array.isArray(goalExt.quickReplies) ? goalExt.quickReplies : [],
          structuredData: goalExt.structuredData,
          confirmedProposal: goalExt.confirmedProposal,
          confidenceScores: goalExt.confidenceScores,
          collected: goalExt.collected || {}
        }
      }
    },
    renderHints: {
      quickReplies: Array.isArray(goalExt.quickReplies) ? goalExt.quickReplies : []
    },
    schemaVersion: 'agent-output-v1',
    meta: {
      source: 'goal-conversation',
      timestamp: new Date().toISOString()
    }
  };
}

function syntheticGoalEnvelope(result: any, fallbackConversationId?: string) {
  const envelope = envelopeGoalConversation(result, fallbackConversationId);
  const core = envelope.internal.core;
  return {
    userVisible: envelope.userVisible,
    control: {
      conversationId: core.conversationId,
      stage: core.stage,
      isCompleted: core.isCompleted,
      learningPath: core.learningPath ? { id: core.learningPath.id, status: core.learningPath.status } : null
    },
    renderHints: envelope.renderHints,
    schemaVersion: 'synthetic-user-v1'
  };
}

function goalEnvelopeForRequest(req: Request, result: any, fallbackConversationId?: string) {
  return req.user?.projection?.grantSource === 'synthetic'
    ? syntheticGoalEnvelope(result, fallbackConversationId)
    : envelopeGoalConversation(result, fallbackConversationId);
}

function getInputText(body: any): string {
  return String(body?.input?.text || '').trim();
}

function getContextMode(body: any): 'recent' | 'full' {
  return body?.contextMode === 'full' ? 'full' : 'recent';
}

function getConfirmProposal(body: any): boolean {
  return body?.confirmProposal === true;
}

router.post('/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const goal = getInputText(req.body);

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    if (!goal || goal.trim().length === 0) {
      return res.status(400).json({ success: false, error: '学习目标不能为空' });
    }

    const result = await requirementOrchestrator.start(userId, goal, {
      contextMode: getContextMode(req.body)
    });
    return res.json({
      success: true,
      data: goalEnvelopeForRequest(req, result)
    });
  } catch (error: any) {
    logger.error('开始对话失败:', error);
    if (error?.status === 422 && error?.code === 'STRUCTURED_OUTPUT_INVALID' && error?.result) {
      return res.status(422).json({
        success: false,
        error: 'STRUCTURED_OUTPUT_INVALID',
        data: goalEnvelopeForRequest(req, error.result)
      });
    }
    return res.status(500).json({ success: false, error: error.message || '开始对话失败' });
  }
});

router.post('/:conversationId/reply', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { conversationId } = req.params;
    const reply = getInputText(req.body);

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    if (!reply || reply.trim().length === 0) {
      return res.status(400).json({ success: false, error: '回复内容不能为空' });
    }

    const result = await requirementOrchestrator.step(conversationId, reply, userId, {
      contextMode: getContextMode(req.body),
      confirmProposal: getConfirmProposal(req.body)
    });
    return res.json({
      success: true,
      data: goalEnvelopeForRequest(req, result, conversationId)
    });
  } catch (error: any) {
    logger.error('继续对话失败:', error);
    if (error?.status === 422 && error?.code === 'STRUCTURED_OUTPUT_INVALID' && error?.result) {
      return res.status(422).json({
        success: false,
        error: 'STRUCTURED_OUTPUT_INVALID',
        data: goalEnvelopeForRequest(req, error.result, req.params.conversationId)
      });
    }
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

    const result = await requirementOrchestrator.regenerate(conversationId, userId, adjustments?.trim() || undefined);
    return res.json({
      success: true,
      data: goalEnvelopeForRequest(req, result, conversationId)
    });
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

    await requirementOrchestrator.reset(conversationId, userId);
    return res.json({ success: true, message: '目标对话已删除，已生成的学习路径会保留' });
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

    const conversation = await requirementOrchestrator.getConversation(conversationId, userId);
    if (req.user?.projection?.grantSource === 'synthetic') {
      return res.json({
        success: true,
        data: {
          userVisible: '会话详情获取成功',
          control: {
            conversationId,
            stage: conversation.stage,
            isCompleted: conversation.status === 'completed',
            learningPath: conversation.learningPath
              ? { id: conversation.learningPath.id, status: conversation.learningPath.status }
              : null
          },
          visibleMessages: conversation.messages || [],
          renderHints: {},
          schemaVersion: 'synthetic-user-v1'
        }
      });
    }
    return res.json({
      success: true,
      data: {
        userVisible: '会话详情获取成功',
        internal: {
          core: {
            conversationId,
            stage: conversation.stage,
            confidence: conversation.confidence,
            isCompleted: conversation.status === 'completed',
            learningPath: conversation.learningPath || null
          },
          ext: {
            goalConversation: {
              understanding: conversation.understanding || {},
              nextQuestions: conversation.nextQuestions || [],
              quickReplies: [],
              structuredData: conversation.structuredData || null,
              confirmedProposal: conversation.confirmedProposal || null,
              confidenceScores: conversation.confidenceScores || null,
              collected: conversation.collected || {}
            }
          }
        },
        renderHints: {},
        schemaVersion: 'agent-output-v1',
        meta: {
          source: 'goal-conversation',
          timestamp: new Date().toISOString(),
          messages: conversation.messages || []
        }
      }
    });
  } catch (error: any) {
    logger.error('获取对话会话失败:', error);
    const status = error.message === '对话会话不存在' ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message || '获取对话会话失败' });
  }
});

router.post('/quick-generate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const goal = getInputText(req.body);
    const { level = 'beginner', timePerDay = '1 小时', learningStyle = 'mixed' } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }

    if (!goal || goal.length === 0) {
      return res.status(400).json({ success: false, error: '学习目标不能为空' });
    }

    const result = await requirementOrchestrator.quickGenerate(userId, {
      goal,
      level,
      timePerDay,
      learningStyle
    });

    return res.json({
      success: true,
      data: goalEnvelopeForRequest(req, result)
    });
  } catch (error: any) {
    logger.error('快速生成失败:', error);
    return res.status(500).json({ success: false, error: error.message || '快速生成失败' });
  }
});

export default router;
