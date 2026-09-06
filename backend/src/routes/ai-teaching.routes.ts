/**
 * AI Teaching Routes - AI 原生授课 API
 * 
 * 提供：
 * - 授课会话管理
 * - 消息处理（含认知分析和干预）
 * - 学习状态查询
 */

import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import aiTeachingCoordinator from '../services/ai-teaching/AITeachingCoordinator';
import learningStateService from '../services/learning/learning-state.service';
import aiService from '../services/ai/ai.service';
import { authMiddleware } from '../middleware/auth.middleware';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import learningService from '../services/learning/learning.service';
import {
  isTeachingSessionConflictError,
  teachingSessionRepository
} from '../services/ai-teaching/TeachingSessionRepository';
import { sessionFinalizationService } from '../services/ai-teaching/SessionFinalizationService';
import { learnerExitService } from '../services/learner/LearnerExitService';
import { PromptStreamEvent, setRequestContext, getRequestContext } from '../gateway/api-gateway/context';
import type { InteractionMetaRecord } from '../services/ai-teaching/TeachingContextBuilder';

const router = Router();

const parseRateLimitEnvValue = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * 授课消息用户级限流（每消息触发 1-2 次 LLM 调用，按 userId 键控，未登录按 IP 兜底）
 */
const teachingMessagesUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseRateLimitEnvValue(process.env.TEACHING_MESSAGES_MAX_PER_HOUR, 60),
  message: { success: false, error: { message: '消息发送过于频繁，请稍后重试', code: 'RATE_LIMITED', status: 429 } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.userId || ipKeyGenerator(req.ip, 56),
});

/**
 * 到期复习清单（复习闭环 · learn agent 出口）
 * GET /api/ai-teaching/review/due
 */
router.get('/review/due', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }
    const due = await learnerExitService.getDueReview(userId, 20);
    res.json({
      success: true,
      data: {
        items: due.map((item) => ({
          conceptKey: item.conceptKey,
          label: item.label || item.conceptKey,
          retention: item.retention,
          reason: item.reason,
          masteryScore: item.masteryScore,
          estimatedMinutes: Math.max(5, Math.round(item.retention * 20)),
        })),
      },
    });
  } catch (error: any) {
    logger.error('[review] 到期复习清单获取失败:', error);
    return sendTeachingError(res, error, '获取复习清单失败');
  }
});

/**
 * 开始复习课（复习闭环 · mode=review 会话，knowledgeState 注入到期复习点）
 * POST /api/ai-teaching/review/sessions  body: { taskId }
 */
router.post('/review/sessions', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }
    const taskId = req.body?.taskId;
    if (!taskId || typeof taskId !== 'string') {
      return sendValidationError(res, '缺少 taskId');
    }
    await learningService.assertTaskReadyForLearning(taskId, userId);
    const session = await aiTeachingCoordinator.startSession({ userId, taskId, mode: 'review' });
    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        subject: session.subject,
        topic: session.topic,
        startTime: session.startTime,
        welcomeMessage: session.welcomeMessage,
        opening: session.opening,
        mode: session.mode,
        revision: session.revision,
        knowledgePoints: session.knowledgePoints,
        scene: session.scene,
      },
    });
  } catch (error: any) {
    logger.error('[review] 复习课创建失败:', error);
    return sendTeachingError(res, error, '创建复习课失败');
  }
});

const parseExpectedRevision = (value: unknown): number | undefined => {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
};

const requireExpectedRevision = (value: unknown): number => {
  const revision = parseExpectedRevision(value);
  if (revision === undefined) {
    const error = new Error('缺少有效的课堂 revision');
    (error as any).code = 'TEACHING_REVISION_REQUIRED';
    throw error;
  }
  return revision;
};

const META_KEYS = ['draftMs', 'idleMsBefore', 'lastIdleMs', 'editingCount', 'deleteCount', 'charsPerSentence'] as const;

/**
 * 清洗前端交互特征（认知负荷量测 · 前端情报层）。
 * 只保留合法数值字段；meta 缺失/非法时返回 undefined（走 absent 降级路径）。
 */
function sanitizeInteractionMeta(raw: unknown): InteractionMetaRecord | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const meta: InteractionMetaRecord = {};
  let valid = false;
  for (const key of META_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      (meta as Record<string, number>)[key] = value;
      valid = true;
    }
  }
  return valid ? meta : undefined;
}

const requireIdempotencyKey = (value: unknown): string => {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    const error = new Error('缺少有效的 Idempotency-Key');
    (error as any).code = 'FINALIZATION_IDEMPOTENCY_KEY_REQUIRED';
    throw error;
  }
  return key;
};

const resolveTeachingError = (error: any, fallbackMessage: string): { status: number; code: string; message: string } => {
  const message = error instanceof Error ? error.message : String(error || fallbackMessage);
  let status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  let code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';

  if (isTeachingSessionConflictError(error)) {
    status = 409;
  } else if (code === 'FINALIZATION_ACTION_UNSUPPORTED' || code === 'FINALIZATION_ACTION_MODE_MISMATCH') {
    status = 409;
  } else if (code === 'FINALIZATION_SESSION_NOT_CLOSED') {
    status = 409;
  } else if (message.includes('无权访问')) {
    status = 403;
    code = 'FORBIDDEN';
  } else if (message.includes('不存在')) {
    status = 404;
    code = 'NOT_FOUND';
  } else if (message.includes('缺少') || message.includes('无效') || message.includes('只能提交')) {
    status = 400;
    code = 'VALIDATION_ERROR';
  } else if (
    message.includes('已结束')
    || message.includes('无法')
    || message.includes('尚未解锁')
    || message.includes('还在生成')
    || message.includes('正在生成')
  ) {
    status = 409;
    code = 'TEACHING_SESSION_STATE_CHANGED';
  }

  return { status, code, message: status >= 500 ? fallbackMessage : message };
};

const sendTeachingError = (res: any, error: any, fallbackMessage: string) => {
  const { status, code, message } = resolveTeachingError(error, fallbackMessage);
  return res.status(status).json({
    success: false,
    error: {
      message,
      code,
      status
    }
  });
};

const sendUnauthorized = (res: any) =>
  res.status(401).json({ success: false, error: { message: '未登录', code: 'UNAUTHORIZED', status: 401 } });

const sendValidationError = (res: any, message: string) =>
  res.status(400).json({ success: false, error: { message, code: 'VALIDATION_ERROR', status: 400 } });

/**
 * 写一条 SSE 事件。HTTP 200 已提交后无法再改状态码，
 * 业务失败统一以 event: error 带内下发。
 */
const writeSseEvent = (res: any, event: string, data: unknown) => {
  if (!res || res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

/** 消息端点统一响应载荷（流式 final 事件与非流式 JSON 共用） */
const buildMessageResultData = (result: any, synthetic: boolean): Record<string, unknown> => {
  if (synthetic) {
    return {
      aiResponse: result.aiResponse,
      shouldConfirmEnd: result.shouldConfirmEnd === true,
      endReason: result.endReason || null,
      recovered: result.recovered === true,
      peerMessage: result.peerTriggered ? result.peerMessage || null : null,
      peerStrategy: result.peerTriggered ? result.peerStrategy || null : null,
      peerFollowUpQuestions: result.peerTriggered && Array.isArray(result.peerFollowUpQuestions) ? result.peerFollowUpQuestions : [],
      revision: result.revision,
      schemaVersion: 'synthetic-user-v1'
    };
  }
  return {
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
      // 0-10 内部尺度 → 0-100 展示尺度（与 /api/state/current 一致）
      lss: Math.round((result.currentState?.lss ?? 0) * 10),
      ktl: Math.round((result.currentState?.ktl ?? 0) * 10),
      lf: Math.round((result.currentState?.lf ?? 0) * 10),
      lsb: Math.round((result.currentState?.lsb ?? 0) * 10),
    },
    strategies: result.strategies,
    knowledgePoint: result.knowledgePoint,
    knowledgePoints: result.knowledgePoints,
    isCompletion: result.isCompletion,
    shouldConfirmEnd: result.shouldConfirmEnd === true,
    endReason: result.endReason || null,
    recovered: result.recovered === true,
    advisory: result.advisory || null,
    peerTriggered: result.peerTriggered,
    peerMessage: result.peerMessage,
    peerStrategy: result.peerStrategy || null,
    peerFollowUpQuestions: Array.isArray(result.peerFollowUpQuestions) ? result.peerFollowUpQuestions : [],
    checkpoint: result.checkpoint || null,
    promptDebug: result.promptDebug || null,
    peerDebug: result.peerDebug || null,
    revision: result.revision,
  };
};

/** 流式消息处理：SSE 逐字推送 aiResponse，final 事件带完整 MessageResult */
const handleStreamingMessage = async (
  req: any,
  res: any,
  sessionId: string,
  message: string,
  expectedRevision: number,
  interactionMeta?: InteractionMetaRecord
) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 请求级流式意向：callPrompt 下沉层消费后按增量透传 delta/restart 事件
  const streamRequest = {
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
  };
  // 注入业务会话上下文：执行日志/瀑布按 sessionId 归组，链路可追溯
  setRequestContext({ streamRequest, sessionId, sourceEntry: 'platform' });

  try {
    const result = await aiTeachingCoordinator.processStudentMessage(sessionId, message, { expectedRevision, interactionMeta });
    const synthetic = req.user?.projection?.grantSource === 'synthetic';
    writeSseEvent(res, 'final', buildMessageResultData(result, synthetic));
    writeSseEvent(res, 'done', {});
  } catch (error: any) {
    const { status, code, message: errorMessage } = resolveTeachingError(error, '处理消息失败');
    writeSseEvent(res, 'error', { status, code, message: errorMessage });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
};

/** 通用流式 Session 出口（开场白 / 伴学）：final 事件携带业务 data 整包 */
const handleStreamingSession = async (
  req: any,
  res: any,
  task: () => Promise<Record<string, unknown>>,
  sessionId?: string
) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const streamRequest = {
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
  };
  // 注入业务会话上下文：执行日志/瀑布按 sessionId 归组，链路可追溯
  setRequestContext({ streamRequest, sessionId, sourceEntry: 'platform' });

  try {
    const data = await task();
    writeSseEvent(res, 'final', data);
    writeSseEvent(res, 'done', {});
  } catch (error: any) {
    const { status, code, message: errorMessage } = resolveTeachingError(error, '处理失败');
    writeSseEvent(res, 'error', { status, code, message: errorMessage });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
};

// 应用认证中间件
router.use(authMiddleware);

/**
 * 开始授课会话
 * POST /api/ai-teaching/tasks/:taskId/session
 */
router.post('/tasks/:taskId/session', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }

    const { taskId } = req.params;

    await learningService.assertTaskReadyForLearning(taskId, userId);

    if (String(req.headers?.accept || '').includes('text/event-stream')) {
      return handleStreamingSession(req, res, async () => {
        const session = await aiTeachingCoordinator.startSession({ userId, taskId });
        // 会话创建后补注入：本次请求后续的 LLM 调用都带上 sessionId，链路可追溯
        setRequestContext({ ...getRequestContext(), sessionId: session.sessionId });
        return {
          sessionId: session.sessionId,
          subject: session.subject,
          topic: session.topic,
          startTime: session.startTime,
          welcomeMessage: session.welcomeMessage,
          opening: req.user?.projection?.grantSource === 'synthetic' ? undefined : session.opening,
          mode: session.mode,
          revision: session.revision,
          knowledgePoints: session.knowledgePoints,
          scene: session.scene,
          ...(req.user?.projection?.grantSource === 'synthetic' ? { schemaVersion: 'synthetic-user-v1' } : {}),
        };
      });
    }

    const session = await aiTeachingCoordinator.startSession({
      userId,
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
        opening: req.user?.projection?.grantSource === 'synthetic' ? undefined : session.opening,
        mode: session.mode,
        revision: session.revision,
        knowledgePoints: session.knowledgePoints,
        scene: session.scene,
        ...(req.user?.projection?.grantSource === 'synthetic' ? { schemaVersion: 'synthetic-user-v1' } : {}),
      },
    });
  } catch (error: any) {
    logger.error('开始授课会话失败:', error);
    return sendTeachingError(res, error, '开始会话失败');
  }
});

/**
 * 暂停授课会话
 * POST /api/ai-teaching/sessions/:sessionId/pause
 */
router.post('/sessions/:sessionId/pause', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;
    // 'hidden'（标签页隐藏）与 'manual' 分开记录，保留前端可见性归因
    const reason = req.body?.reason === 'pagehide' || req.body?.reason === 'hidden' ? req.body.reason : 'manual';

    await teachingSessionRepository.assertOwnership(sessionId, userId);
    const revision = await aiTeachingCoordinator.pauseSession(
      sessionId,
      userId,
      reason,
      requireExpectedRevision(req.body?.revision)
    );

    res.json({ success: true, data: { sessionId, status: 'paused', revision } });
  } catch (error: any) {
    logger.error('暂停授课会话失败:', error);
    return sendTeachingError(res, error, '暂停会话失败');
  }
});

/**
 * 恢复暂停的授课会话（页面切回可见时调用）
 * POST /api/ai-teaching/sessions/:sessionId/resume
 */
router.post('/sessions/:sessionId/resume', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;

    await teachingSessionRepository.assertOwnership(sessionId, userId);
    const revision = await aiTeachingCoordinator.resumeSession(
      sessionId,
      userId,
      requireExpectedRevision(req.body?.revision)
    );

    res.json({ success: true, data: { sessionId, status: 'active', revision } });
  } catch (error: any) {
    logger.error('恢复授课会话失败:', error);
    return sendTeachingError(res, error, '恢复会话失败');
  }
});

/**
 * 重置授课会话
 * POST /api/ai-teaching/sessions/:sessionId/reset
 */
router.post('/sessions/:sessionId/reset', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;

    await teachingSessionRepository.assertOwnership(sessionId, userId);
    const revision = await aiTeachingCoordinator.resetSession(
      sessionId,
      userId,
      requireExpectedRevision(req.body?.revision)
    );

    res.json({ success: true, data: { sessionId, status: 'discarded', revision } });
  } catch (error: any) {
    logger.error('重置授课会话失败:', error);
    return sendTeachingError(res, error, '重置会话失败');
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
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;
    
    await teachingSessionRepository.assertOwnership(sessionId, userId);

    const { message } = req.body;
    const interactionMeta = sanitizeInteractionMeta(req.body?.meta);

    if (!message) {
      return sendValidationError(res, '缺少消息内容');
    }

    const expectedRevision = requireExpectedRevision(req.body?.revision);
    const wantsStream = String(req.headers?.accept || '').includes('text/event-stream');

    if (wantsStream) {
      return handleStreamingMessage(req, res, sessionId, message, expectedRevision, interactionMeta);
    }

    const result = await aiTeachingCoordinator.processStudentMessage(
      sessionId,
      message,
      { expectedRevision, interactionMeta }
    );

    const synthetic = req.user?.projection?.grantSource === 'synthetic';
    return res.json({ success: true, data: buildMessageResultData(result, synthetic) });
  } catch (error: any) {
    logger.error('处理消息失败:', error);
    return sendTeachingError(res, error, '处理消息失败');
  }
});

/**
 * 恢复续讲（resume-continue）：断线恢复后由前端「继续上课」触发，
 * 无学生新输入，后端直接跑一个纯续讲回合并返回 AI 接续开场白（SSE 流式）。
 * POST /api/ai-teaching/sessions/:sessionId/continue  body: { revision }
 */
router.post('/sessions/:sessionId/continue', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;
    await teachingSessionRepository.assertOwnership(sessionId, userId);

    const expectedRevision = requireExpectedRevision(req.body?.revision);
    const wantsStream = String(req.headers?.accept || '').includes('text/event-stream');

    if (wantsStream) {
      // 复用流式通道，但走 resume-continue 无输入模式
      const resumeStreamRequest = {
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
      };
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      setRequestContext({ streamRequest: resumeStreamRequest, sessionId, sourceEntry: 'platform' });
      try {
        const result = await aiTeachingCoordinator.processStudentMessage(sessionId, '', {
          expectedRevision,
          kind: 'resume-continue',
        });
        const synthetic = req.user?.projection?.grantSource === 'synthetic';
        writeSseEvent(res, 'final', buildMessageResultData(result, synthetic));
        writeSseEvent(res, 'done', {});
      } catch (error: any) {
        const { status, code, message: errorMessage } = resolveTeachingError(error, '恢复续讲失败');
        writeSseEvent(res, 'error', { status, code, message: errorMessage });
      } finally {
        if (!res.destroyed && !res.writableEnded) res.end();
      }
      return;
    }

    const result = await aiTeachingCoordinator.processStudentMessage(sessionId, '', {
      expectedRevision,
      kind: 'resume-continue',
    });
    const synthetic = req.user?.projection?.grantSource === 'synthetic';
    return res.json({ success: true, data: buildMessageResultData(result, synthetic) });
  } catch (error: any) {
    logger.error('恢复续讲失败:', error);
    return sendTeachingError(res, error, '恢复续讲失败');
  }
});

/**
 * 提交理解检查
 * POST /api/ai-teaching/sessions/:sessionId/checkpoints/:checkpointId/submit
 */
router.post('/sessions/:sessionId/checkpoints/:checkpointId/submit', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }

    const { sessionId, checkpointId } = req.params;
    const selectedOptionIds = Array.isArray(req.body?.selectedOptionIds)
      ? req.body.selectedOptionIds.filter((value: unknown) => typeof value === 'string' && value.trim())
      : undefined;
    const answerText = typeof req.body?.answerText === 'string' ? req.body.answerText.trim() : undefined;

    if ((!selectedOptionIds || selectedOptionIds.length === 0) && !answerText) {
      return sendValidationError(res, '缺少作答内容');
    }

    await teachingSessionRepository.assertOwnership(sessionId, userId);
    const result = await aiTeachingCoordinator.submitCheckpoint(sessionId, checkpointId, {
      selectedOptionIds,
      answerText,
    }, requireExpectedRevision(req.body?.revision));

    return res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('提交理解检查失败:', error);
    return sendTeachingError(res, error, '提交理解检查失败');
  }
});

/**
 * 结束授课会话
 * POST /api/ai-teaching/sessions/:sessionId/end
 * 收敛为 /finalize(end_only) 的薄封装：稳定幂等 key + 统一 202 轮询契约
 */
router.post('/sessions/:sessionId/end', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;
    
    await teachingSessionRepository.assertOwnership(sessionId, userId);

    const endReason = req.body?.reason === 'learner-abandoned'
      ? 'learner-abandoned'
      : req.body?.reason === 'task-completed' ? 'task-completed' : 'manual-end';
    const revision = requireExpectedRevision(req.body?.revision);
    const result = await sessionFinalizationService.finalize({
      sessionId,
      userId,
      action: 'end_only',
      // 稳定幂等 key（而非每次随机 UUID）：重复调用复用同一次最终化，避免孤儿操作行
      operationId: `end:${sessionId}:${revision}`,
      revision,
      endReason,
    });

    res.status(result.status === 'processing' ? 202 : 200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('结束会话失败:', error);
    return sendTeachingError(res, error, '结束会话失败');
  }
});

/**
 * 可靠课堂结束与任务完成
 * POST /api/ai-teaching/sessions/:sessionId/finalize
 */
router.post('/sessions/:sessionId/finalize', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return sendUnauthorized(res);

    const action = req.body?.action;
    if (!['end_only', 'complete_task', 'complete_review'].includes(action)) {
      const error = new Error('缺少有效的 Finalization action');
      (error as any).code = 'FINALIZATION_ACTION_INVALID';
      throw error;
    }
    const actualMinutes = req.body?.actualMinutes;
    const subjectiveDifficulty = req.body?.subjectiveDifficulty;
    if (actualMinutes !== undefined && (!Number.isFinite(actualMinutes) || actualMinutes < 0)) {
      throw new Error('actualMinutes 无效');
    }
    if (
      subjectiveDifficulty !== undefined
      && (!Number.isFinite(subjectiveDifficulty) || subjectiveDifficulty < 1 || subjectiveDifficulty > 10)
    ) {
      throw new Error('subjectiveDifficulty 无效');
    }

    const result = await sessionFinalizationService.finalize({
      sessionId: req.params.sessionId,
      userId,
      action,
      operationId: requireIdempotencyKey(req.headers['idempotency-key']),
      revision: requireExpectedRevision(req.body?.revision),
      actualMinutes,
      subjectiveDifficulty,
      endReason: req.body?.reason === 'learner-abandoned'
        ? 'learner-abandoned'
        : req.body?.reason === 'task-completed' ? 'task-completed' : 'manual-end'
    });
    return res.status(result.status === 'processing' ? 202 : 200).json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Finalization 失败:', error);
    return sendTeachingError(res, error, '课堂结束处理失败');
  }
});

/**
 * 查询当前 Finalization 状态
 * GET /api/ai-teaching/sessions/:sessionId/finalization
 */
router.get('/sessions/:sessionId/finalization', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return sendUnauthorized(res);
    const result = await sessionFinalizationService.getStatus(req.params.sessionId, userId);
    return res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('查询 Finalization 状态失败:', error);
    return sendTeachingError(res, error, '查询课堂结束状态失败');
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
      return sendUnauthorized(res);
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
    // 统一输出 0-100 展示尺度（与 /api/state/current 一致）
    const displayState = learningStateService.toDisplayMetrics(state);

    res.json({
      success: true,
      data: {
        lss: displayState.lss,
        ktl: displayState.ktl,
        lf: displayState.lf,
        lsb: displayState.lsb,
        suggestion,
      },
    });
  } catch (error: any) {
    logger.error('获取学习状态失败:', error);
    return sendTeachingError(res, error, '获取状态失败');
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
      return sendUnauthorized(res);
    }

    const days = parseInt(req.query.days as string) || 7;
    const trends = await learningStateService.getTrends(userId, days);

    res.json({
      success: true,
      data: trends.map(t => ({
        timestamp: t.timestamp,
        lss: Number((t.lss * 10).toFixed(2)),
        ktl: Number((t.ktl * 10).toFixed(2)),
        lf: Number((t.lf * 10).toFixed(2)),
        lsb: Number((t.lsb * 10).toFixed(2)),
      })),
    });
  } catch (error: any) {
    logger.error('获取趋势失败:', error);
    return sendTeachingError(res, error, '获取趋势失败');
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
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;
    
    await teachingSessionRepository.assertOwnership(sessionId, userId);

    const { message } = req.body;

    if (!message) {
      return sendValidationError(res, '缺少消息内容');
    }

    if (String(req.headers?.accept || '').includes('text/event-stream')) {
      return handleStreamingSession(req, res, async () => {
        const result = await aiTeachingCoordinator.processPeerMessage(sessionId, message);
        return {
          peerResponse: result.peerResponse,
          peerStrategy: result.strategy || null,
          peerFollowUpQuestions: Array.isArray(result.followUpQuestions) ? result.followUpQuestions : [],
        };
      }, sessionId);
    }

    const result = await aiTeachingCoordinator.processPeerMessage(
      sessionId,
      message
    );

    res.json({
      success: true,
      data: {
        peerResponse: result.peerResponse,
        peerStrategy: result.strategy || null,
        peerFollowUpQuestions: Array.isArray(result.followUpQuestions) ? result.followUpQuestions : [],
      },
    });
  } catch (error: any) {
    logger.error('处理学习伙伴消息失败:', error);
    return sendTeachingError(res, error, '伴学消息处理失败，请稍后重试');
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
      return sendUnauthorized(res);
    }

    const { taskId } = req.query;

    const sessions = await aiTeachingCoordinator.getSessionHistory(userId);
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
    logger.error('获取活跃会话失败:', error);
    return sendTeachingError(res, error, '获取会话失败');
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
      return sendUnauthorized(res);
    }

    const sessions = await aiTeachingCoordinator.getSessionHistory(userId);

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error: any) {
    logger.error('获取历史会话失败:', error);
    return sendTeachingError(res, error, '获取历史会话失败');
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
      return sendUnauthorized(res);
    }

    const { sessionId } = req.params;
    
    await teachingSessionRepository.assertOwnership(sessionId, userId);
    
    const session = await aiTeachingCoordinator.getSessionDetail(sessionId, userId);

    if (!session) {
      return sendTeachingError(res, new Error('会话不存在'), '获取会话详情失败');
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    logger.error('获取会话详情失败:', error);
    return sendTeachingError(res, error, '获取会话详情失败');
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
      return sendUnauthorized(res);
    }

    const { taskId } = req.params;
    const evaluation = await aiTeachingCoordinator.getLatestTaskEvaluation(taskId, userId);

    if (!evaluation) {
      return res.json({ success: true, data: null, message: '暂无当堂评估记录' });
    }

    res.json({
      success: true,
      data: evaluation,
    });
  } catch (error: any) {
    logger.error('获取任务评估失败:', error);
    return sendTeachingError(res, error, '获取任务评估失败');
  }
});

export default router;
