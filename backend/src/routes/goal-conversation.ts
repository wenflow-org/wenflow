import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import requirementOrchestrator from '../coordinators/requirement.coordinator';
import { PromptStreamEvent, setRequestContext } from '../gateway/api-gateway/context';

const router = express.Router();

/** 写一条 SSE 事件。HTTP 200 已提交后无法再改状态码，业务失败统一以 event: error 带内下发。 */
const writeSseEvent = (res: Response, event: string, data: unknown) => {
  if (!res || res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

/** 统一错误映射（SSE 场景复用；422 恢复信封随 error 事件 data 下发） */
const resolveGoalError = (error: any, req: Request): { status: number; code: string; message: string; data?: any } => {
  if (error?.status === 422 && error?.code === 'STRUCTURED_OUTPUT_INVALID' && error?.result) {
    return {
      status: 422,
      code: 'STRUCTURED_OUTPUT_INVALID',
      message: 'STRUCTURED_OUTPUT_INVALID',
      data: goalEnvelopeForRequest(req, error.result)
    };
  }
  const message = error instanceof Error ? error.message : String(error || '处理失败');
  return {
    status: message === '对话会话不存在' ? 404 : 500,
    code: 'INTERNAL_ERROR',
    message
  };
};

/**
 * 流式 Goal 请求处理：SSE 连接 + 注入 streamRequest（请求级流式意向）。
 * goal skill 为 JSON 输出，不产生 delta，final 事件携带完整 goal envelope。
 */
const handleStreamingGoal = async (
  req: Request,
  res: Response,
  task: () => Promise<any>,
  envelope: (result: any) => any
) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  setRequestContext({
    streamRequest: {
      enabled: true,
      onStream: (event: PromptStreamEvent) => {
        if (event.type === 'delta') {
          writeSseEvent(res, 'delta', { text: event.text });
        } else if (event.type === 'restart') {
          writeSseEvent(res, 'restart', { attempt: event.attempt });
        } else if (event.type === 'error') {
          writeSseEvent(res, 'error', { code: event.code, message: event.message });
        }
      },
    },
  });

  try {
    const result = await task();
    writeSseEvent(res, 'final', envelope(result));
    writeSseEvent(res, 'done', {});
  } catch (error: any) {
    const { status, code, message, data } = resolveGoalError(error, req);
    writeSseEvent(res, 'error', {
      status,
      code,
      message,
      ...(data !== undefined ? { data } : {})
    });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
};

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
    // 统一运行契约 envelope（与 agent-output-v1 并存；不破坏现有前端）
    runtimeEnvelope: result?.runtimeEnvelope || null,
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

    if (String(req.headers?.accept || '').includes('text/event-stream')) {
      return handleStreamingGoal(
        req,
        res,
        () => requirementOrchestrator.start(userId, goal, { contextMode: getContextMode(req.body) }),
        (result) => goalEnvelopeForRequest(req, result)
      );
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

    if (String(req.headers?.accept || '').includes('text/event-stream')) {
      return handleStreamingGoal(
        req,
        res,
        () => requirementOrchestrator.step(conversationId, reply, userId, {
          contextMode: getContextMode(req.body),
          confirmProposal: getConfirmProposal(req.body)
        }),
        (result) => goalEnvelopeForRequest(req, result, conversationId)
      );
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

    if (String(req.headers?.accept || '').includes('text/event-stream')) {
      return handleStreamingGoal(
        req,
        res,
        () => requirementOrchestrator.regenerate(conversationId, userId, adjustments?.trim() || undefined),
        (result) => goalEnvelopeForRequest(req, result, conversationId)
      );
    }

    const result = await requirementOrchestrator.regenerate(conversationId, userId, adjustments?.trim() || undefined);
    return res.json({
      success: true,
      data: goalEnvelopeForRequest(req, result, conversationId)
    });
  } catch (error: any) {
    logger.error('重新生成路径失败:', error);
    // 并发生成冲突（claimPathCoreGeneration）应返回 409，与 learning.ts 的 sendPathMutationConflict 一致
    if (error?.status === 409 || error?.code === 'PATH_GENERATION_RUN_CHANGED') {
      return res.status(409).json({ success: false, error: { message: '路径正在生成中，请稍后再试', code: 'PATH_GENERATION_RUN_CHANGED', status: 409 } });
    }
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

export default router;
