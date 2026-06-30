import express, { Request, Response } from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import { runGoalConversationAgent, type GoalConversationAgentResult } from '../skills/goal-conversation';
import pathOrchestrator from '../coordinators/path.coordinator';
import goalConversationService from '../services/learning/goal-conversation.service';
import { logger } from '../utils/logger';

const router = express.Router();

type Stage = 'understanding' | 'proposing' | 'ready' | 'completed';

interface TestGoalMessage {
  role: 'user' | 'ai';
  content: string;
  time: string;
}

interface TestGoalSession {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: TestGoalMessage[];
  understanding: Record<string, any>;
  collected: Record<string, any>;
  confirmedProposal: any;
  structuredData: any;
  confidenceScores: any;
  stage: Stage;
  confidence: number;
  path: {
    id: string | null;
    status: 'idle' | 'generating' | 'ready' | 'failed';
    name: string | null;
    error: string | null;
  };
  requestLog: TestGoalRequestTrace[];
}

interface TestGoalRequestTrace {
  id: string;
  timestamp: string;
  input: string;
  stageBefore: Stage;
  conversationContextCount?: number;
  stateSnapshot: {
    stage: Stage;
    confidence: number;
    understanding: Record<string, any>;
    collected: Record<string, any>;
    structuredData: any;
    confirmedProposal: any;
    confidenceScores: any;
  };
  promptVersion: number;
  parseMode: string | null;
  attemptCount: number;
  actualRetryCount: number;
  formatFailureCount: number;
  structuredOutputValid: boolean;
  stateApplied: boolean;
  requestMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  attempts: Array<{
    attemptIndex: number;
    parseMode: string;
    structuredOutputValid: boolean;
    failureType?: string;
    violations?: string[];
    rawContent: string;
  }>;
  rawUserVisible: string;
}

interface TestGoalDebug {
  contextMode: 'full';
  contextStrategy: 'state-first-with-full-content';
  historyCount: number;
  conversationContextCount?: number;
  visibleMessageCount: number;
  stateFieldCount: number;
  promptVersion?: number;
  requestMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  requestLog?: TestGoalRequestTrace[];
  attemptCount: number;
  actualRetryCount: number;
  formatFailureCount: number;
  structuredOutputValid: boolean;
  stateApplied: boolean;
  maxFormatRetries: number;
  usage?: Record<string, any> | null;
  parseMode?: string | null;
  failureType?: string;
  violations?: string[];
  observationMode?: boolean;
}

const TEST_GOAL_MAX_FORMAT_RETRIES = 2;

const sessions = new Map<string, TestGoalSession>();

function buildSessionCollectedData(session: TestGoalSession) {
  return {
    source: 'test-goal-conversation',
    messages: session.messages,
    collected: session.collected,
    understanding: session.understanding,
    confidence: session.confidence,
    confirmedProposal: session.confirmedProposal,
    structuredData: session.structuredData,
    confidenceScores: session.confidenceScores,
    learningPath: session.path.id
      ? {
          id: session.path.id,
          status: session.path.status,
          name: session.path.name,
          error: session.path.error,
        }
      : null,
    testGoalDebug: {
      requestLog: session.requestLog,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  };
}

async function persistSession(session: TestGoalSession): Promise<void> {
  const description = String(
    session.understanding?.real_problem
      || session.understanding?.surface_goal
      || session.messages.find((msg) => msg.role === 'user')?.content
      || '测试学习目标'
  );

  await prisma.goal_conversations.upsert({
    where: { id: session.id },
    create: {
      id: session.id,
      userId: session.userId,
      description,
      status: session.stage === 'completed' ? 'completed' : 'active',
      stage: session.stage,
      messages: JSON.stringify(session.messages),
      collectedData: JSON.stringify(buildSessionCollectedData(session)),
      completedAt: session.stage === 'completed' ? new Date() : null,
      learningPathId: session.path.id || null,
      updatedAt: new Date(session.updatedAt),
    },
    update: {
      description,
      status: session.stage === 'completed' ? 'completed' : 'active',
      stage: session.stage,
      messages: JSON.stringify(session.messages),
      collectedData: JSON.stringify(buildSessionCollectedData(session)),
      completedAt: session.stage === 'completed' ? new Date() : null,
      learningPathId: session.path.id || null,
      updatedAt: new Date(session.updatedAt),
    }
  });
}

function restoreSessionFromConversation(conversation: any): TestGoalSession {
  const collected = (() => {
    try {
      return JSON.parse(conversation.collectedData || '{}');
    } catch {
      return {};
    }
  })();
  const debug = collected?.testGoalDebug || {};
  const messages = Array.isArray(collected?.messages) ? collected.messages : [];
  const learningPath = collected?.learningPath && typeof collected.learningPath === 'object'
    ? collected.learningPath
    : null;

  return {
    id: conversation.id,
    userId: conversation.userId,
    createdAt: debug.createdAt || conversation.createdAt?.toISOString?.() || new Date().toISOString(),
    updatedAt: debug.updatedAt || conversation.updatedAt?.toISOString?.() || new Date().toISOString(),
    messages,
    understanding: collected?.understanding || {},
    collected: collected?.collected || {},
    confirmedProposal: collected?.confirmedProposal ?? null,
    structuredData: collected?.structuredData ?? null,
    confidenceScores: collected?.confidenceScores ?? null,
    stage: (conversation.stage || collected?.stage || 'understanding') as Stage,
    confidence: typeof collected?.confidence === 'number' ? collected.confidence : 0,
    path: {
      id: learningPath?.id || conversation.learningPathId || null,
      status: learningPath?.status || 'idle',
      name: learningPath?.name || null,
      error: learningPath?.error || null,
    },
    requestLog: Array.isArray(debug.requestLog) ? debug.requestLog : []
  };
}

async function getSession(sessionId: string, userId: string): Promise<TestGoalSession | null> {
  const cached = sessions.get(sessionId);
  if (cached && cached.userId === userId) {
    return cached;
  }

  const conversation = await prisma.goal_conversations.findFirst({
    where: {
      id: sessionId,
      userId,
    }
  });

  if (!conversation) {
    return null;
  }

  const restored = restoreSessionFromConversation(conversation);
  sessions.set(restored.id, restored);
  return restored;
}

function createSession(userId: string): TestGoalSession {
  const now = new Date().toISOString();
  return {
    id: `tgc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    userId,
    createdAt: now,
    updatedAt: now,
    messages: [],
    understanding: {},
    collected: {},
    confirmedProposal: null,
    structuredData: null,
    confidenceScores: null,
    stage: 'understanding',
    confidence: 0,
    path: {
      id: null,
      status: 'idle',
      name: null,
      error: null
    },
    requestLog: []
  };
}

function getConfirmProposal(body: any): boolean {
  return body?.confirmProposal === true;
}

function buildMockConversation(session: TestGoalSession) {
  const description = String(
    session.understanding?.real_problem
      || session.understanding?.surface_goal
      || session.messages.find((msg) => msg.role === 'user')?.content
      || '测试学习目标'
  );

  return {
    id: session.id,
    userId: session.userId,
    description,
    stage: session.stage,
    learningPathId: session.path.id || undefined,
    collectedData: JSON.stringify({
      messages: session.messages,
      collected: session.collected,
      understanding: session.understanding,
      confidence: session.confidence,
      confirmedProposal: session.confirmedProposal,
      structuredData: session.structuredData,
      confidenceScores: session.confidenceScores,
      learningPath: session.path.id ? { id: session.path.id, status: session.path.status } : null
    })
  };
}

async function refreshSessionPath(session: TestGoalSession): Promise<void> {
  if (!session.path.id) {
    return;
  }

  const path = await prisma.learning_paths.findFirst({
    where: { id: session.path.id }
  });

  if (!path) {
    return;
  }

  session.path.id = path.id;
  session.path.name = path.name || null;
  session.path.status = path.status === 'completed'
    ? 'ready'
    : (path.status === 'failed' ? 'failed' : 'generating');

  if (session.path.status === 'ready') {
    session.stage = 'completed';
  }

  session.updatedAt = new Date().toISOString();
  await persistSession(session);
}

async function startPathGeneration(session: TestGoalSession, result: GoalConversationAgentResult): Promise<{ id: string; status: 'generating' }> {
  if (session.path.id && session.path.status === 'generating') {
    return { id: session.path.id, status: 'generating' };
  }

  const mockConversation = buildMockConversation(session) as any;
  const placeholderPath = await (goalConversationService as any)['createGeneratingPlaceholderPath'](mockConversation, result as any);
  const goalPathRequest = (goalConversationService as any)['buildGoalPathRequest'](mockConversation, result as any, placeholderPath.id);

  session.path = {
    id: placeholderPath.id,
    status: 'generating',
    name: placeholderPath.name || null,
    error: null
  };
  session.updatedAt = new Date().toISOString();
  await persistSession(session);

  pathOrchestrator.runGoalAsync(goalPathRequest, {
    onSuccess: async () => {
      try {
        await refreshSessionPath(session);
      } catch (error) {
        logger.error('[test-goal] refresh generated path failed', { sessionId: session.id, error });
      }
    },
    onError: async (pathError: unknown) => {
      session.path.status = 'failed';
      session.path.error = pathError instanceof Error ? pathError.message : String(pathError);
      session.updatedAt = new Date().toISOString();
      await persistSession(session);

      try {
        await prisma.learning_paths.update({
          where: { id: placeholderPath.id },
          data: { status: 'failed', updatedAt: new Date() }
        });
      } catch (updateError) {
        logger.error('[test-goal] update failed path status failed', { sessionId: session.id, error: updateError });
      }
    }
  });

  return { id: placeholderPath.id, status: 'generating' };
}

function getInputText(body: any): string {
  return String(body?.input?.text || '').trim();
}

function toConversationHistory(messages: TestGoalMessage[]) {
  return messages.map((msg) => ({
    role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
    content: msg.content
  }));
}

function buildStateSnapshot(session: TestGoalSession) {
  return {
    stage: session.stage,
    confidence: session.confidence,
    understanding: session.understanding || {},
    collected: session.collected || {},
    structuredData: session.structuredData ?? null,
    confirmedProposal: session.confirmedProposal ?? null,
    confidenceScores: session.confidenceScores ?? null
  };
}

function countStateFields(value: any): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countStateFields(item), 0);
  }

  if (typeof value !== 'object') {
    return 1;
  }

  return (Object.values(value) as any[]).reduce((sum, item) => sum + countStateFields(item), 0);
}

function mergeAgentState(session: TestGoalSession, result: GoalConversationAgentResult) {
  const core = result.internal?.core;
  const ext = result.internal?.ext?.goalConversation;

  if (core?.stage) {
    session.stage = core.stage;
  }
  if (typeof core?.confidence === 'number') {
    session.confidence = core.confidence;
  }
  if (ext?.understanding && typeof ext.understanding === 'object') {
    session.understanding = ext.understanding;
  }
  if (ext?.collected && typeof ext.collected === 'object') {
    session.collected = { ...session.collected, ...ext.collected };
  }
  if (ext?.confirmedProposal !== undefined) {
    session.confirmedProposal = ext.confirmedProposal;
  }
  if (ext?.structuredData !== undefined) {
    session.structuredData = ext.structuredData;
  }
  if (ext?.confidenceScores !== undefined) {
    session.confidenceScores = ext.confidenceScores;
  }
}

function envelopeSession(session: TestGoalSession, result?: GoalConversationAgentResult, debug?: TestGoalDebug) {
  const goalExt = result?.internal?.ext?.goalConversation;

  return {
    userVisible: result?.userVisible || '',
    internal: {
      core: {
        conversationId: session.id,
        stage: session.stage,
        confidence: session.confidence,
        isCompleted: session.stage === 'completed',
        learningPath: session.path.id
          ? {
              id: session.path.id,
              status: session.path.status,
              name: session.path.name || undefined
            }
          : null
      },
      ext: {
        goalConversation: {
          understanding: session.understanding,
          nextQuestions: Array.isArray(goalExt?.nextQuestions) ? goalExt.nextQuestions : [],
          quickReplies: Array.isArray(goalExt?.quickReplies) ? goalExt.quickReplies : [],
          structuredData: session.structuredData,
          confirmedProposal: session.confirmedProposal,
          confidenceScores: session.confidenceScores,
          collected: session.collected
        }
      }
    },
    renderHints: {
      quickReplies: Array.isArray(goalExt?.quickReplies) ? goalExt.quickReplies : []
    },
    schemaVersion: 'agent-output-v1',
    meta: {
      source: 'test-goal-conversation',
      timestamp: new Date().toISOString(),
      messages: session.messages,
      debug: debug || {
        contextMode: 'full',
        contextStrategy: 'state-first-with-full-content',
        historyCount: session.messages.length,
        conversationContextCount: session.messages.length,
        visibleMessageCount: session.messages.length,
        stateFieldCount: countStateFields(buildStateSnapshot(session)),
        promptVersion: 0,
        requestMessages: [],
        requestLog: session.requestLog,
        attemptCount: 0,
        actualRetryCount: 0,
        formatFailureCount: 0,
        structuredOutputValid: true,
        stateApplied: true,
        maxFormatRetries: TEST_GOAL_MAX_FORMAT_RETRIES,
        usage: null,
        parseMode: null
      }
    }
  };
}

async function callAgent(session: TestGoalSession, input: string): Promise<{ result: GoalConversationAgentResult; debug: TestGoalDebug; structuredOutputValid: boolean; }> {
  const history = toConversationHistory(session.messages);
  const previousState = buildStateSnapshot(session);
  const stageBefore = session.stage;
  const startedAt = Date.now();

  const result = await runGoalConversationAgent({
    input,
    userId: session.userId,
    conversationHistory: history,
    previousUnderstanding: session.understanding,
    previousStage: session.stage,
    previousState,
    maxFormatRetries: TEST_GOAL_MAX_FORMAT_RETRIES,
    allowInvalidStructuredOutput: true
  });

  const duration = Date.now() - startedAt;
  logger.info('[test-goal] agent responded', {
    sessionId: session.id,
    userId: session.userId,
    historyCount: history.length,
    stage: result.internal.core.stage,
    confidence: result.internal.core.confidence,
    attemptCount: result.debug?.attemptCount || 0,
    actualRetryCount: result.debug?.actualRetryCount || 0,
    formatFailureCount: result.debug?.formatFailureCount || 0,
    structuredOutputValid: result.debug?.structuredOutputValid === true,
    parseMode: result.debug?.parseMode || null,
    duration
  });

  const structuredOutputValid = result.debug?.structuredOutputValid === true;

  const requestTrace: TestGoalRequestTrace = {
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    input,
    stageBefore,
    conversationContextCount: history.length,
    stateSnapshot: previousState,
    promptVersion: Number(result.debug?.promptVersion || 0),
    parseMode: result.debug?.parseMode || null,
    attemptCount: result.debug?.attemptCount || 0,
    actualRetryCount: result.debug?.actualRetryCount || 0,
    formatFailureCount: result.debug?.formatFailureCount || 0,
    structuredOutputValid,
    stateApplied: structuredOutputValid,
    requestMessages: Array.isArray(result.debug?.requestMessages) ? result.debug.requestMessages : [],
    attempts: Array.isArray(result.debug?.attempts) ? result.debug.attempts.map((item: any) => ({
      attemptIndex: Number(item?.attemptIndex || 0),
      parseMode: String(item?.parseMode || 'none'),
      structuredOutputValid: item?.structuredOutputValid === true,
      failureType: String(item?.failureType || 'none'),
      violations: Array.isArray(item?.violations) ? item.violations.map((violation: any) => String(violation)) : [],
      rawContent: String(item?.rawContent || '')
    })) : [],
    rawUserVisible: String(result.userVisible || '')
  };
  session.requestLog.push(requestTrace);

  return {
    result,
    structuredOutputValid,
    debug: {
      contextMode: 'full',
      contextStrategy: 'state-first-with-full-content',
      historyCount: history.length,
      conversationContextCount: history.length,
      visibleMessageCount: history.length,
      stateFieldCount: countStateFields(previousState),
      promptVersion: requestTrace.promptVersion,
      requestMessages: requestTrace.requestMessages,
      requestLog: session.requestLog,
      attemptCount: requestTrace.attemptCount,
      actualRetryCount: requestTrace.actualRetryCount,
      formatFailureCount: requestTrace.formatFailureCount,
      structuredOutputValid,
      stateApplied: structuredOutputValid,
      maxFormatRetries: TEST_GOAL_MAX_FORMAT_RETRIES,
      usage: null,
      parseMode: result.debug?.parseMode || null,
      failureType: result.debug?.failureType || 'none',
      violations: Array.isArray(result.debug?.violations) ? result.debug.violations : [],
      observationMode: result.debug?.observationMode === true
    }
  };
}

router.post('/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const input = getInputText(req.body);

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }
    if (!input) {
      return res.status(400).json({ success: false, error: '学习目标不能为空' });
    }

    const session = createSession(userId);
    sessions.set(session.id, session);
    await persistSession(session);

    const { result, debug, structuredOutputValid } = await callAgent(session, input);
    const now = new Date().toISOString();
    session.messages.push({ role: 'user', content: input, time: now });
    session.updatedAt = new Date().toISOString();

    if (structuredOutputValid) {
      session.messages.push({ role: 'ai', content: result.userVisible, time: new Date().toISOString() });
      mergeAgentState(session, result);
      await persistSession(session);
      return res.json({ success: true, data: envelopeSession(session, result, debug) });
    }

    await persistSession(session);

    if (debug.observationMode) {
      return res.json({ success: true, data: envelopeSession(session, result, debug) });
    }

    return res.status(422).json({ success: false, error: 'STRUCTURED_OUTPUT_INVALID', data: envelopeSession(session, undefined, debug) });
  } catch (error: any) {
    logger.error('[test-goal] start failed:', error);
    return res.status(500).json({ success: false, error: error.message || '开始测试对话失败' });
  }
});

router.post('/:sessionId/reply', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { sessionId } = req.params;
    const input = getInputText(req.body);

    if (!userId) {
      return res.status(401).json({ success: false, error: '用户未认证' });
    }
    if (!input) {
      return res.status(400).json({ success: false, error: '回复内容不能为空' });
    }

    const session = await getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '测试会话不存在或已失效，请重新开始测试目标对话'
      });
    }

    const previousStage = session.stage;

    if (previousStage === 'proposing' && getConfirmProposal(req.body)) {
      session.messages.push({ role: 'user', content: input, time: new Date().toISOString() });
      const seedResult: GoalConversationAgentResult = {
        userVisible: '已收到确认，学习路径正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。',
        internal: {
          core: {
            stage: 'ready',
            confidence: session.confidence || 0.95,
            isCompleted: true
          },
          ext: {
            goalConversation: {
              understanding: session.understanding,
              nextQuestions: [],
              quickReplies: [],
              structuredData: session.structuredData,
              confirmedProposal: session.confirmedProposal,
              confidenceScores: session.confidenceScores,
              collected: session.collected
            }
          }
        }
      };

      session.messages.push({ role: 'ai', content: seedResult.userVisible, time: new Date().toISOString() });
      const learningPath = await startPathGeneration(session, seedResult);
      session.stage = 'completed';
      session.updatedAt = new Date().toISOString();
      await persistSession(session);

      return res.json({
        success: true,
        data: envelopeSession(session, {
          ...seedResult,
          internal: {
            ...seedResult.internal,
            core: {
              conversationId: session.id,
              stage: 'completed',
              confidence: session.confidence || 0.95,
              isCompleted: true,
              learningPath
            }
          }
        }, {
          contextMode: 'full',
          contextStrategy: 'state-first-with-full-content',
          historyCount: session.messages.length,
          conversationContextCount: session.messages.length,
          visibleMessageCount: session.messages.length,
          stateFieldCount: countStateFields(buildStateSnapshot(session)),
          promptVersion: 0,
          requestMessages: [],
          requestLog: session.requestLog,
          attemptCount: 0,
          actualRetryCount: 0,
          formatFailureCount: 0,
          structuredOutputValid: true,
          stateApplied: true,
          maxFormatRetries: TEST_GOAL_MAX_FORMAT_RETRIES,
          usage: null,
          parseMode: null
        })
      });
    }

    const { result, debug, structuredOutputValid } = await callAgent(session, input);
    session.messages.push({ role: 'user', content: input, time: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();

    if (!structuredOutputValid && debug.observationMode) {
      await persistSession(session);
      return res.json({ success: true, data: envelopeSession(session, result, debug) });
    }

    if (!structuredOutputValid) {
      await persistSession(session);
      return res.status(422).json({ success: false, error: 'STRUCTURED_OUTPUT_INVALID', data: envelopeSession(session, undefined, debug) });
    }

    session.messages.push({ role: 'ai', content: result.userVisible, time: new Date().toISOString() });
    mergeAgentState(session, result);

    if (result.internal.core.stage === 'ready') {
      const learningPath = await startPathGeneration(session, result);
      session.stage = 'completed';
      session.updatedAt = new Date().toISOString();
      await persistSession(session);

      return res.json({
        success: true,
        data: envelopeSession(session, {
          ...result,
          userVisible: `${result.userVisible}\n\n⏳ 学习路径已开始生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。`,
          internal: {
            ...result.internal,
            core: {
              conversationId: session.id,
              stage: 'completed',
              confidence: result.internal.core.confidence,
              isCompleted: true,
              learningPath
            }
          }
        }, debug)
      });
    }

    await persistSession(session);

    return res.json({ success: true, data: envelopeSession(session, result, debug) });
  } catch (error: any) {
    logger.error('[test-goal] reply failed:', error);
    return res.status(500).json({ success: false, error: error.message || '继续测试对话失败' });
  }
});

router.get('/:sessionId', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const { sessionId } = req.params;

  if (!userId) {
    return res.status(401).json({ success: false, error: '用户未认证' });
  }

  const session = await getSession(sessionId, userId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: '测试会话不存在或已失效，请重新开始测试目标对话'
    });
  }

  await refreshSessionPath(session);

  return res.json({ success: true, data: envelopeSession(session) });
});

router.delete('/:sessionId', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const { sessionId } = req.params;

  if (!userId) {
    return res.status(401).json({ success: false, error: '用户未认证' });
  }

  const session = await getSession(sessionId, userId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: '测试会话不存在或已失效，请重新开始测试目标对话'
    });
  }

  sessions.delete(sessionId);
  await prisma.goal_conversations.deleteMany({
    where: { id: sessionId, userId }
  });
  return res.json({ success: true, message: '测试会话已删除' });
});

export default router;
