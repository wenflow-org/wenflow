import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { runGoalConversationAgent } from '../../agents/goal-conversation-agent';
import { getCanonicalAgentId } from '../../services/agent-manifest.service';

const router = Router();
const prisma = new PrismaClient();

type ChatRole = 'user' | 'assistant';

interface EvalMessage {
  role: ChatRole;
  content: string;
}

interface EvalCaseInput {
  id?: string;
  name?: string;
  messages: EvalMessage[];
  previousState?: Record<string, any> | null;
}

interface EvalRunRequest {
  agentId: string;
  promptVersionId?: string;
  promptVersion?: number;
  customPrompt?: string;
  model?: string;
  repeatCount?: number;
  cases: EvalCaseInput[];
}

function normalizeMessages(value: any): EvalMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: String(item?.content || '').trim()
    }))
    .filter((item) => item.content.length > 0);
}

function normalizeEvalCases(value: any): EvalCaseInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => ({
      id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `case-${index + 1}`,
      name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `Case ${index + 1}`,
      messages: normalizeMessages(item?.messages),
      previousState: item?.previousState && typeof item.previousState === 'object' ? item.previousState : null
    }))
    .filter((item) => item.messages.length > 0);
}

function extractLatestUserInput(messages: EvalMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((item) => item.role === 'user');
  return lastUserMessage?.content || '';
}

function buildConversationHistory(messages: EvalMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history = messages.slice(0, -1);
  return history.map((item) => ({
    role: item.role,
    content: item.content
  }));
}

function inferCheckerResults(result: any) {
  const userVisible = String(result?.userVisible || '');
  const stage = result?.internal?.core?.stage;
  const nextQuestions = Array.isArray(result?.internal?.ext?.goalConversation?.nextQuestions)
    ? result.internal.ext.goalConversation.nextQuestions
    : [];

  const questionCount = (userVisible.match(/[?？]/g) || []).length;
  const hasJsonFence = /^```json[\s\S]*```$/i.test(userVisible.trim());

  return {
    singleQuestionRule: questionCount <= 1,
    stageValid: ['understanding', 'proposing', 'ready', 'completed'].includes(stage),
    nextQuestionsSingle: nextQuestions.length <= 1,
    noWrappedUserVisibleJson: !hasJsonFence
  };
}

async function resolvePrompt(agentId: string, payload: EvalRunRequest) {
  if (typeof payload.customPrompt === 'string' && payload.customPrompt.trim()) {
    return {
      source: 'custom' as const,
      promptVersion: 0,
      systemPrompt: payload.customPrompt.trim(),
      model: payload.model || null
    };
  }

  if (payload.promptVersionId) {
    const prompt = await prisma.agent_prompts.findUnique({ where: { id: payload.promptVersionId } });
    if (!prompt) {
      throw new Error('指定的 Prompt 版本不存在');
    }
    return {
      source: 'version-id' as const,
      promptVersion: prompt.version,
      systemPrompt: prompt.systemPrompt,
      model: payload.model || prompt.model || null
    };
  }

  if (typeof payload.promptVersion === 'number' && Number.isFinite(payload.promptVersion)) {
    const prompt = await prisma.agent_prompts.findFirst({
      where: {
        agentId,
        version: payload.promptVersion
      }
    });
    if (!prompt) {
      throw new Error('指定的 Prompt 版本不存在');
    }
    return {
      source: 'version-number' as const,
      promptVersion: prompt.version,
      systemPrompt: prompt.systemPrompt,
      model: payload.model || prompt.model || null
    };
  }

  const prompt = await prisma.agent_prompts.findFirst({
    where: {
      agentId,
      status: 'ACTIVE'
    },
    orderBy: { version: 'desc' }
  });

  if (!prompt) {
    throw new Error('未找到 ACTIVE Prompt');
  }

  return {
    source: 'active' as const,
    promptVersion: prompt.version,
    systemPrompt: prompt.systemPrompt,
    model: payload.model || prompt.model || null
  };
}

router.post('/run', async (req: Request, res: Response) => {
  try {
    const payload = (req.body || {}) as EvalRunRequest;
    const requestedAgentId = String(payload.agentId || '').trim();
    const canonicalAgentId = getCanonicalAgentId(requestedAgentId);

    if (canonicalAgentId !== 'goal-conversation-agent') {
      return res.status(400).json({
        success: false,
        error: { message: '当前轻量评测器仅支持 goal-conversation-agent' }
      });
    }

    const evalCases = normalizeEvalCases(payload.cases);
    if (!evalCases.length) {
      return res.status(400).json({
        success: false,
        error: { message: '至少需要 1 条有效测试用例' }
      });
    }

    const repeatCount = Math.max(1, Math.min(20, Number(payload.repeatCount || 1)));
    const promptConfig = await resolvePrompt(canonicalAgentId, payload);
    const previousEnvModel = process.env.AI_MODEL;
    if (promptConfig.model) {
      process.env.AI_MODEL = promptConfig.model;
    }

    const runResults: any[] = [];

    try {
      for (const item of evalCases) {
        for (let runIndex = 0; runIndex < repeatCount; runIndex += 1) {
          const userInput = extractLatestUserInput(item.messages);
          const history = buildConversationHistory(item.messages);
          const previousState = item.previousState || {};

          const startedAt = Date.now();
          const result = await runGoalConversationAgent({
            input: userInput,
            userId: 'admin-prompt-stability',
            conversationHistory: history,
            previousUnderstanding: previousState?.understanding || {},
            previousStage: previousState?.stage || 'understanding',
            previousState,
            maxFormatRetries: 2,
            systemPromptOverride: promptConfig.systemPrompt
          });
          const durationMs = Date.now() - startedAt;
          const structuredOutputValid = result?.debug?.structuredOutputValid === true;

            runResults.push({
            caseId: item.id,
            caseName: item.name,
            runIndex: runIndex + 1,
            durationMs,
              input: {
              userInput,
              conversationContextCount: history.length,
              previousState
            },
            output: {
              userVisible: result.userVisible,
              stage: result.internal?.core?.stage || 'understanding',
              confidence: result.internal?.core?.confidence || 0,
              nextQuestions: result.internal?.ext?.goalConversation?.nextQuestions || [],
              quickReplies: result.internal?.ext?.goalConversation?.quickReplies || []
            },
            debug: {
              promptVersion: result?.debug?.promptVersion || promptConfig.promptVersion,
              attemptCount: result?.debug?.attemptCount || 0,
              actualRetryCount: result?.debug?.actualRetryCount || 0,
              formatFailureCount: result?.debug?.formatFailureCount || 0,
              parseMode: result?.debug?.parseMode || 'none',
              failureType: result?.debug?.failureType || 'none',
              violations: Array.isArray(result?.debug?.violations) ? result.debug.violations : [],
              structuredOutputValid,
              attempts: result?.debug?.attempts || []
            },
            checks: inferCheckerResults(result)
          });
        }
      }
    } finally {
      if (typeof previousEnvModel === 'string') {
        process.env.AI_MODEL = previousEnvModel;
      } else {
        delete process.env.AI_MODEL;
      }
    }

    const structuredSuccessCount = runResults.filter((item) => item.debug.structuredOutputValid).length;
    const proposingCount = runResults.filter((item) => item.output.stage === 'proposing').length;
    const checkerPassCount = runResults.filter((item) => Object.values(item.checks).every(Boolean)).length;
    const avgAttemptCount = runResults.length
      ? Number((runResults.reduce((sum, item) => sum + Number(item.debug.attemptCount || 0), 0) / runResults.length).toFixed(2))
      : 0;

    logger.info('[admin-prompt-stability] run finished', {
      agentId: canonicalAgentId,
      promptSource: promptConfig.source,
      promptVersion: promptConfig.promptVersion,
      repeatCount,
      caseCount: evalCases.length,
      structuredSuccessCount,
      totalRuns: runResults.length
    });

    return res.json({
      success: true,
      data: {
        config: {
          agentId: canonicalAgentId,
          promptSource: promptConfig.source,
          promptVersion: promptConfig.promptVersion,
          model: promptConfig.model,
          repeatCount,
          caseCount: evalCases.length,
          totalRuns: runResults.length
        },
        summary: {
          structuredSuccessRate: runResults.length ? Number(((structuredSuccessCount / runResults.length) * 100).toFixed(1)) : 0,
          proposingRate: runResults.length ? Number(((proposingCount / runResults.length) * 100).toFixed(1)) : 0,
          checkerPassRate: runResults.length ? Number(((checkerPassCount / runResults.length) * 100).toFixed(1)) : 0,
          avgAttemptCount,
          failureCount: runResults.length - structuredSuccessCount,
          parseModeDistribution: runResults.reduce((acc, item) => {
            const key = String(item.debug.parseMode || 'none');
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          failureTypeDistribution: runResults.reduce((acc, item) => {
            const key = String(item.debug.failureType || 'none');
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        },
        results: runResults
      }
    });
  } catch (error: any) {
    logger.error('[admin-prompt-stability] run failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || 'Prompt 稳定性评测失败' }
    });
  }
});

export default router;
