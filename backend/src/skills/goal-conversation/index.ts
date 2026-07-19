import { agentConfigService } from '../../services/agentConfig.service';
import aiService from '../../services/ai/ai.service';
import { logger } from '../../utils/logger';
import {
  composePromptFromAgentRouting,
  isPromptSupplementEnabled,
} from '../../services/prompt-composer';
import {
  AgentContext,
  AgentDefinition,
  AgentInput,
  AgentOutput
} from '../../agents/protocol';
import {
  extractStructuredPayload,
  hasValidStructuredPayload,
  type GoalStructuredFailureType,
  type GoalStructuredParseMode,
  type StructuredParseResult,
  validateGoalConversationStructuredOutput
} from './structured-validator';
import {
  isPlaceholderValue,
  mergeUnderstanding,
  sanitizeUnderstanding,
  buildCollected
} from '../../skills/goal-understanding-composer';

export interface QuickReply {
  text: string;
  icon?: string;
}

export interface GoalConversationInternal {
  core: {
    conversationId?: string | null;
    stage: 'understanding' | 'proposing' | 'ready' | 'completed';
    confidence: number;
    isCompleted: boolean;
    learningPath?: any;
  };
  ext: {
    goalConversation: {
      understanding: any;
      nextQuestions: string[];
      quickReplies?: QuickReply[];
      collected: any;
      structuredData?: any;
      confirmedProposal?: any;
      confidenceScores?: any;
    };
  };
}

export interface GoalConversationAgentResult {
  userVisible: string;
  internal: GoalConversationInternal;
  debug?: {
    attemptCount?: number;
    actualRetryCount?: number;
    formatFailureCount?: number;
    parseMode: StructuredParseResult['parseMode'];
    failureType?: GoalStructuredFailureType;
    violations?: string[];
    observationMode?: boolean;
    promptVersion?: number;
    requestMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    attempts?: Array<{
      attemptIndex: number;
      parseMode: StructuredParseResult['parseMode'];
      structuredOutputValid: boolean;
      failureType?: GoalStructuredFailureType;
      violations?: string[];
      rawContent: string;
    }>;
    structuredOutputValid?: boolean;
  };
}

interface StageControlOptions {
  latestUserInput?: string;
  previousStage?: 'understanding' | 'proposing' | 'ready' | 'completed' | string;
  previousConfidence?: number;
  confirmProposal?: boolean;
}

interface GoalConversationStateSnapshot {
  stage?: 'understanding' | 'proposing' | 'ready' | 'completed' | string;
  confidence?: number;
  understanding?: any;
  collected?: any;
  structuredData?: any;
  confirmedProposal?: any;
  confidenceScores?: any;
}

interface RetryAttemptInfo {
  attemptIndex: number;
  parseMode: StructuredParseResult['parseMode'];
  structuredOutputValid: boolean;
  failureType: GoalStructuredFailureType;
  violations: string[];
  rawContent: string;
}

interface CallAIResult {
  content: string;
  attemptCount: number;
  actualRetryCount: number;
  formatFailureCount: number;
  parseMode: StructuredParseResult['parseMode'];
  structuredOutputValid: boolean;
  failureType: GoalStructuredFailureType;
  violations: string[];
  attempts: RetryAttemptInfo[];
}





function buildEffectivePrompt(configPrompt?: string | null, overridePrompt?: string | null): string {
  const normalizedOverridePrompt = typeof overridePrompt === 'string' ? overridePrompt.trim() : '';
  if (normalizedOverridePrompt) {
    return normalizedOverridePrompt;
  }

  const normalizedConfigPrompt = typeof configPrompt === 'string' ? configPrompt.trim() : '';
  if (normalizedConfigPrompt) {
    return normalizedConfigPrompt;
  }

  return '';
}

function buildGoalConversationUserPayload(input: {
  userInput: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  previousState?: GoalConversationStateSnapshot;
  previousUnderstanding?: any;
  previousStage?: string;
}): string {
  const statePayload = input.previousState
    ? input.previousState
    : input.previousUnderstanding
      ? {
          stage: input.previousStage || 'understanding',
          confidence: input.previousUnderstanding?.confidence || 0,
          understanding: input.previousUnderstanding
        }
      : {
          stage: input.previousStage || 'understanding',
          confidence: 0,
          understanding: {}
        };

  const conversationContext = (input.conversationHistory || []).map((item) => ({
    role: item.role,
    text: item.content
  }));

  return JSON.stringify({
    userInput: input.userInput,
    state: statePayload,
    conversationContext,
    task: {
      mode: 'goal-conversation-turn-update',
      requirements: [
        'treat state as primary memory',
        'treat conversationContext as supporting evidence only',
        'if state conflicts with userInput, trust userInput',
        'do not treat conversationContext as chat history to continue',
        'return exactly one raw JSON object with no extra text'
      ]
    }
  }, null, 2);
}

export const goalConversationAgentDefinition: AgentDefinition = {
  id: 'skill:goal-conversation',
  name: '目标对话 Skill',
  version: '1.1.0',
  type: 'custom',
  category: 'standard',
  description: '负责学习目标澄清、问题穿透和阶段推进的专用业务 Skill',
  capabilities: ['goal-clarification', 'problem-discovery', 'stage-transition', 'quick-replies'],
  subscribes: [],
  publishes: ['goal-conversation:updated', 'goal-conversation:ready'],
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      metadata: { type: 'object' },
      conversationHistory: { type: 'array' }
    },
    required: ['goal']
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      userVisible: { type: 'string' },
      internal: {
        type: 'object',
        properties: {
          core: {
            type: 'object',
            properties: {
              stage: {
                type: 'string',
                enum: ['understanding', 'proposing', 'ready', 'completed']
              },
              confidence: { type: 'number' },
              isCompleted: { type: 'boolean' }
            },
            required: ['stage', 'confidence', 'isCompleted']
          },
          ext: {
            type: 'object',
            properties: {
              goalConversation: { type: 'object' }
            },
            required: ['goalConversation']
          }
        },
        required: ['core', 'ext']
      },
      renderHints: {
        type: 'object'
      },
      schemaVersion: {
        type: 'string',
        enum: ['agent-output-v1']
      }
    },
    required: ['success', 'userVisible', 'internal', 'schemaVersion']
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};


function normalizeDialogueText(text: string): string {
  return text
    .replace(/^第一段[：:]/m, '')
    .replace(/^第二段[：:].*$/m, '')
    .replace(/```json[\s\S]*$/m, '')
    .trim();
}

function enforceSingleQuestionForUnderstanding(text: string, stage: 'understanding' | 'proposing' | 'ready' | 'completed'): string {
  if (!text || stage !== 'understanding') {
    return text;
  }

  let usedQuestion = false;
  const lines = text.split('\n');
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      normalizedLines.push(line);
      continue;
    }

    const hasQuestion = /[？?]/.test(trimmed);
    if (!hasQuestion) {
      normalizedLines.push(line);
      continue;
    }

    if (!usedQuestion) {
      const chineseIdx = trimmed.indexOf('？');
      const englishIdx = trimmed.indexOf('?');
      const firstQuestionIdx = chineseIdx === -1
        ? englishIdx
        : englishIdx === -1
          ? chineseIdx
          : Math.min(chineseIdx, englishIdx);
      if (firstQuestionIdx >= 0) {
        normalizedLines.push(trimmed.slice(0, firstQuestionIdx + 1));
      } else {
        normalizedLines.push(trimmed);
      }
      usedQuestion = true;
      continue;
    }

    // 超过 1 个问题时，将其改写为说明句，避免连续追问
    normalizedLines.push(trimmed.replace(/[？?]/g, '。'));
  }

  return normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function inferQuickRepliesFromList(content: string): QuickReply[] {
  const listItems = content.match(/(?:^|\n)\s*(?:\d+[.、]|[•\-])\s*(.+?)(?=\n|$)/g);
  if (!listItems || listItems.length < 2 || listItems.length > 5) return [];

  return listItems.map((item) => ({
    text: item.replace(/^\s*(?:\d+[.、]|[•\-])\s*/, '').trim()
  }));
}

function buildConfirmationBlock(parsedJson: any): string {
  return `【确认方案】
你想学的是：${parsedJson.real_problem || parsedJson.understanding?.real_problem || parsedJson.understanding?.surface_goal || '学习目标'}
你的情况是：${parsedJson.background?.current_level || parsedJson.understanding?.background?.current_level || '待确认'}
期望见效：${parsedJson.background?.expected_time || parsedJson.understanding?.background?.expected_time || '待确认'}
${parsedJson.pain_points || parsedJson.understanding?.pain_points ? `你的痛点是：${parsedJson.pain_points || parsedJson.understanding?.pain_points}\n` : ''}
确认这个方向对吗？如有补充可以告诉我。`;
}

function normalizeStageAndConfidence(
  stage: 'understanding' | 'proposing' | 'ready' | 'completed',
  confidence: number,
  options?: StageControlOptions
): { stage: 'understanding' | 'proposing' | 'ready' | 'completed'; confidence: number } {
  const STAGE_CAPS = {
    understanding: 0.92,
    proposing: 0.95,
    ready: 0.98
  };

  const STAGE_MINIMUMS = {
    understanding: 0.15,
    proposing: 0.75,
    ready: 0.95
  };

  let normalizedStage = stage;
  let normalizedConfidence = Number.isFinite(confidence) ? confidence : 0.2;

  const previousStage = options?.previousStage;

  if (previousStage === 'proposing' && options?.confirmProposal === true) {
    normalizedStage = 'ready';
  }

  const cap = STAGE_CAPS[normalizedStage] || 0.92;
  const floor = STAGE_MINIMUMS[normalizedStage] || 0.15;
  normalizedConfidence = Math.min(normalizedConfidence, cap);
  normalizedConfidence = Math.max(normalizedConfidence, floor);

  return {
    stage: normalizedStage,
    confidence: Math.min(normalizedConfidence, 0.99)
  };
}

function hasThinProposalPayload(payload: {
  understanding?: any;
  confirmedProposal?: any;
  structuredData?: any;
}): boolean {
  const understanding = payload.understanding || {};
  const confirmedProposal = payload.confirmedProposal || {};
  const structuredData = payload.structuredData || {};

  // V3 §10 P1.7: 优先从 routing 表（cache）取硬必需字段，回落到硬编码
  const requiredFields = getCachedHardRequiredFields();

  // 取嵌套路径值
  const valueAt = (obj: any, path: string): any => {
    if (!obj || typeof obj !== 'object') return undefined;
    return path.split('.').reduce((cur: any, p) => (cur && typeof cur === 'object' ? cur[p] : undefined), obj);
  };
  const isNonEmptyString = (v: any): boolean => typeof v === 'string' && v.trim().length > 0;
  const isNonEmptyArray = (v: any): boolean =>
    Array.isArray(v) && v.filter((item) => typeof item === 'string' && item.trim().length > 0).length >= 2;

  if (requiredFields && requiredFields.length > 0) {
    // 把 fieldId 拆到 understanding / confirmedProposal 两个根上
    const checkField = (fieldId: string): boolean => {
      if (fieldId.startsWith('understanding.')) {
        const path = fieldId.slice('understanding.'.length);
        const v = valueAt(understanding, path);
        return isNonEmptyString(v) || isNonEmptyArray(v);
      }
      if (fieldId.startsWith('confirmedProposal.')) {
        const path = fieldId.slice('confirmedProposal.'.length);
        const v = valueAt(confirmedProposal, path);
        if (path === 'key_stages') return isNonEmptyArray(v);
        if (path === 'out_of_scope') return Array.isArray(v);
        return isNonEmptyString(v);
      }
      return true; // userVisible / core.* 等不参与该判定
    };

    // 特殊处理 time_budget OR time_horizon（任意其一即可）
    const hasTimeAny = (() => {
      const tb = valueAt(understanding, 'available_resources.time_budget');
      const th = valueAt(understanding, 'available_resources.time_horizon');
      return isNonEmptyString(tb) || isNonEmptyString(th);
    })();

    const otherChecks = requiredFields
      .filter(
        (id) =>
          id !== 'understanding.available_resources.time_budget' &&
          id !== 'understanding.available_resources.time_horizon'
      )
      .map(checkField);

    const allRequiredHit = hasTimeAny && otherChecks.every(Boolean);
    // V3：阈值 = 硬必需字段数（time_budget/time_horizon 二选一算 1 个）
    // 旧硬编码兜底固定阈值 5，但 V3 routing 实际数量可能少于 5（当前 5 个 = 3 + 1）
    // 用 otherChecks.length + 1 与 allRequiredHit 含义一致；不再 max(_, 5)
    return !allRequiredHit;
  }

  // 兜底：原硬编码逻辑
  const hasRealProblem = typeof understanding.real_problem === 'string' && understanding.real_problem.trim().length > 0;
  const hasTimeBudget = typeof understanding.available_resources?.time_budget === 'string'
    && understanding.available_resources.time_budget.trim().length > 0;
  const hasTimeHorizon = typeof understanding.available_resources?.time_horizon === 'string'
    && understanding.available_resources.time_horizon.trim().length > 0;
  const hasSuccessCriteria = typeof understanding.success_criteria?.observable_result === 'string'
    && understanding.success_criteria.observable_result.trim().length > 0;
  const hasProposalDirection = typeof confirmedProposal.learning_direction === 'string'
    && confirmedProposal.learning_direction.trim().length > 0;
  const hasFirstDeliverable = typeof confirmedProposal.first_deliverable === 'string'
    && confirmedProposal.first_deliverable.trim().length > 0;
  const hasKeyStages = Array.isArray(confirmedProposal.key_stages)
    && confirmedProposal.key_stages.filter((item: any) => typeof item === 'string' && item.trim().length > 0).length >= 2;
  const hasOutOfScope = Array.isArray(confirmedProposal.out_of_scope);
  const hasStructuredOutline = structuredData && typeof structuredData === 'object' && Object.keys(structuredData).length > 0;

  const evidenceCount = [
    hasRealProblem,
    hasTimeBudget || hasTimeHorizon,
    hasSuccessCriteria,
    hasProposalDirection,
    hasFirstDeliverable,
    hasKeyStages,
    hasOutOfScope,
    hasStructuredOutline
  ].filter(Boolean).length;

  return !(hasRealProblem && (hasTimeBudget || hasTimeHorizon) && hasSuccessCriteria && hasProposalDirection && hasFirstDeliverable && hasKeyStages && hasOutOfScope) || evidenceCount < 6;
}

// V3 §10 P1.7: 模块级缓存——hard-required 字段清单
let _hardRequiredCache: string[] | null = null;
let _hardRequiredLoadingAt = 0;
const HARD_REQUIRED_CACHE_TTL_MS = 30_000;

function getCachedHardRequiredFields(): string[] | null {
  // 同步访问；过期时间到了启动后台刷新（但不阻塞）
  const now = Date.now();
  if (_hardRequiredCache && now - _hardRequiredLoadingAt < HARD_REQUIRED_CACHE_TTL_MS) {
    return _hardRequiredCache;
  }
  if (now - _hardRequiredLoadingAt > HARD_REQUIRED_CACHE_TTL_MS) {
    _hardRequiredLoadingAt = now;
    void refreshHardRequiredCache();
  }
  return _hardRequiredCache;
}

async function refreshHardRequiredCache(): Promise<void> {
  try {
    const { getAgentRoutings } = await import('../../services/field-dispatcher');
    const rows = await getAgentRoutings('goal-conversation');
    const ids = rows
      .filter((r) => r.promptRole === 'hard-required')
      .map((r) => r.fieldId);
    if (ids.length > 0) {
      _hardRequiredCache = ids;
    }
  } catch (err) {
    logger.debug('[skill:goal-conversation] refresh hard-required cache failed', {
      error: (err as Error).message,
    });
  }
}

// 启动时预热一次（不 await）
void refreshHardRequiredCache();

function parseGoalConversationResponse(
  content: string,
  previousUnderstanding?: any,
  stageControlOptions?: StageControlOptions
): GoalConversationAgentResult {
  const { parsedJson, dialogueText: extractedDialogueText } = extractStructuredPayload(content);
  let dialogueText = extractedDialogueText;

  let stage: 'understanding' | 'proposing' | 'ready' | 'completed' = 'understanding';
  let quickReplies: QuickReply[] = [];
  let structuredData: any = undefined;
  let confirmedProposal: any = undefined;
  let confidenceScores: any = undefined;
  let nextQuestions: string[] = [];
  let understanding = { ...(previousUnderstanding || {}) };

  if (parsedJson) {
    const normalizedPayload = parsedJson.goalConversation || parsedJson;
    understanding = mergeUnderstanding(previousUnderstanding, normalizedPayload);
    const validStages = ['understanding', 'proposing', 'ready', 'completed'];
    const stageFromPayload = parsedJson.stage || parsedJson.state?.stage;
    stage = validStages.includes(stageFromPayload) ? stageFromPayload : 'understanding';

    const payloadNextQuestions = normalizedPayload.nextQuestions;
    nextQuestions = Array.isArray(payloadNextQuestions) ? payloadNextQuestions : [];

    const payloadQuickReplies = normalizedPayload.quickReplies || parsedJson.hints?.quickReplies;
    if (Array.isArray(payloadQuickReplies)) {
      quickReplies = payloadQuickReplies.map((item: string | QuickReply) => (
        typeof item === 'string' ? { text: item } : { text: item.text, icon: item.icon }
      )).filter((item: QuickReply) => item.text && item.text.trim().length > 0);
    }

    structuredData = normalizedPayload.structuredData;
    confirmedProposal = normalizedPayload.confirmedProposal;
    confidenceScores = normalizedPayload.confidenceScores;

    if (!understanding || Object.keys(understanding).length === 0) {
      understanding = mergeUnderstanding(previousUnderstanding, normalizedPayload);
    }
  } else {
    if (content.includes('【确认方案】')) {
      stage = 'proposing';

      const goalMatch = content.match(/你想学的是[：:]\s*([\s\S]+?)(?=\n你的情况|\n背景|\n期望|\n每周|$)/);
      const baseMatch = content.match(/你的情况(?:是)?[：:]\s*([\s\S]+?)(?=\n期望|\n每周|\n痛点|\n确认|$)/);
      const timeMatch = content.match(/期望见效[：:]\s*(.+?)(?:\n|$)/);
      const painMatch = content.match(/你的痛点(?:是)?[：:]\s*([\s\S]+?)(?=\n确认|\n如有|$)/);

      if (goalMatch) understanding.real_problem = goalMatch[1].trim();
      if (baseMatch || timeMatch) {
        understanding.background = {
          ...(understanding.background || {}),
          ...(baseMatch ? { current_level: baseMatch[1].trim() } : {}),
          ...(timeMatch ? { expected_time: timeMatch[1].trim() } : {})
        };
      }
      if (painMatch) understanding.pain_points = painMatch[1].trim();
    } else {
      quickReplies = inferQuickRepliesFromList(content);
    }

    const contentLower = content.toLowerCase();
    if (contentLower.includes('确认请回复') || contentLower.includes('如有补充')) {
      stage = 'proposing';
    }
  }

  // 直接使用 AI 返回的 confidence
  let confidence = typeof (parsedJson?.confidence ?? parsedJson?.state?.confidence) === 'number'
    ? (parsedJson?.confidence ?? parsedJson?.state?.confidence)
    : 0.2;

  const stageControl = normalizeStageAndConfidence(stage, confidence, stageControlOptions);
  stage = stageControl.stage;
  confidence = stageControl.confidence;

  if (stage === 'proposing' && hasThinProposalPayload({ understanding, confirmedProposal, structuredData })) {
    stage = 'understanding';
    confidence = Math.min(confidence, 0.78);
  }

  understanding = sanitizeUnderstanding(understanding);

  dialogueText = normalizeDialogueText(dialogueText);
  if (parsedJson?.reply) {
    dialogueText = normalizeDialogueText(String(parsedJson.reply));
  }
  if (!dialogueText && parsedJson) {
    dialogueText = stage === 'proposing' ? buildConfirmationBlock(parsedJson) : '我来帮你分析一下...';
  }

  if (!dialogueText) {
    dialogueText = content.trim();
  }

  dialogueText = enforceSingleQuestionForUnderstanding(dialogueText, stage);

  if (stage === 'understanding') {
    nextQuestions = nextQuestions.slice(0, 1);
  }

  if (!quickReplies.length && stage === 'proposing') {
    quickReplies = [
      { text: '确认，生成学习路径' },
      { text: '需要调整' }
    ];
  }

  return {
    userVisible: dialogueText,
    internal: {
      core: {
        stage,
        confidence,
        isCompleted: stage === 'ready' || stage === 'completed'
      },
      ext: {
        goalConversation: {
          understanding,
          nextQuestions,
          quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
          collected: buildCollected(understanding, parsedJson),
          structuredData,
          confirmedProposal,
          confidenceScores
        }
      }
    }
  };
}

function buildStructuredOutputErrorMessage(attemptCount: number): string {
  return `本轮结构化输出连续 ${attemptCount} 次未通过校验，状态未更新。请点击重试，再尝试一次。`;
}

async function callAIWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature?: number; maxTokens?: number; model?: string },
  userId?: string,
  maxRetries: number = 2
): Promise<CallAIResult> {
  let lastContent = '';
  let lastParseMode: StructuredParseResult['parseMode'] = 'none';
  const attempts: RetryAttemptInfo[] = [];
  let currentMaxTokens = options.maxTokens ?? 8000;
  const tokenCeiling = 16000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await aiService.chat(messages, {
      temperature: options.temperature,
      maxTokens: currentMaxTokens,
      model: options.model,
      agentId: 'goal-agent',
      skillId: 'goal-conversation',
      userId,
      action: 'goal-conversation:dialogue',
      sanitizeUserVisible: false
    });

    lastContent = response.content;
    const validation = validateGoalConversationStructuredOutput(response.content);
    lastParseMode = validation.parseMode;
    const structuredOutputValid = validation.valid;
    attempts.push({
      attemptIndex: attempt + 1,
      parseMode: validation.parseMode,
      structuredOutputValid,
      failureType: validation.failureType,
      violations: validation.violations,
      rawContent: response.content
    });

    if (structuredOutputValid) {
      return {
        content: response.content,
        attemptCount: attempts.length,
        actualRetryCount: Math.max(0, attempts.length - 1),
        formatFailureCount: attempts.filter((item) => !item.structuredOutputValid).length,
        parseMode: validation.parseMode,
        structuredOutputValid: true,
        failureType: 'none',
        violations: [],
        attempts
      };
    }

    // 检测长度截断: finish_reason='length' 或 JSON 末尾被截断
    const wasTruncatedByLength = (response as any).finishReason === 'length'
      || /[",:][^"]*$/.test(response.content.trim().slice(-50));

    logger.warn('GoalConversationAgent 输出不完整，准备重试', {
      attempt: attempt + 1,
      maxRetries,
      parseMode: validation.parseMode,
      failureType: validation.failureType,
      violations: validation.violations,
      finishReason: (response as any).finishReason,
      wasTruncatedByLength,
      currentMaxTokens,
      contentPreview: response.content.substring(0, 200)
    });

    // 长度截断 → 下一次重试时把 maxTokens 翻倍 (最多到 tokenCeiling)
    if (wasTruncatedByLength && attempt < maxRetries) {
      const nextMaxTokens = Math.min(tokenCeiling, currentMaxTokens * 2);
      if (nextMaxTokens > currentMaxTokens) {
        logger.info('[GoalConversation] 检测到长度截断，重试时扩大 maxTokens', {
          from: currentMaxTokens,
          to: nextMaxTokens
        });
        currentMaxTokens = nextMaxTokens;
      }
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  logger.warn(`GoalConversationAgent 重试 ${maxRetries} 次后仍不完整，使用最后一次响应`);
  return {
    content: lastContent,
    attemptCount: attempts.length,
    actualRetryCount: Math.max(0, attempts.length - 1),
    formatFailureCount: attempts.filter((item) => !item.structuredOutputValid).length,
    parseMode: lastParseMode,
    structuredOutputValid: false,
    failureType: attempts[attempts.length - 1]?.failureType || 'missing_json_block',
    violations: attempts[attempts.length - 1]?.violations || ['结构化输出校验失败'],
    attempts
  };
}

interface GoalConversationAgentOptions {
  maxFormatRetries?: number;
  allowInvalidStructuredOutput?: boolean;
  systemPromptOverride?: string;
}

export async function goalConversationAgentHandler(
  input: AgentInput,
  context: AgentContext,
  options: GoalConversationAgentOptions = {}
): Promise<AgentOutput> {
  const userId = context.userId;

  try {
    const config =
      await agentConfigService.getActivePrompt('skill:goal-conversation')
      || await agentConfigService.getActivePrompt('goal-conversation');
    let systemPrompt = buildEffectivePrompt(config?.systemPrompt, options.systemPromptOverride);

    // V3 §6 P1.5: 字段路由 supplement
    if (isPromptSupplementEnabled()) {
      const { finalPrompt, supplementApplied, fieldsCovered } =
        await composePromptFromAgentRouting('goal-conversation', systemPrompt);
      if (supplementApplied) {
        systemPrompt = finalPrompt;
        logger.debug('[skill:goal-conversation] field routing supplement applied', {
          fieldsCovered,
        });
      }
    }
    const history = (context.conversationHistory || [])
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));
    const previousState = input.metadata?.previousState as GoalConversationStateSnapshot | undefined;
    const previousUnderstanding = input.metadata?.previousUnderstanding;

    const structuredUserPayload = buildGoalConversationUserPayload({
      userInput: input.goal,
      conversationHistory: history,
      previousState,
      previousUnderstanding,
      previousStage: input.metadata?.previousStage
    });

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: structuredUserPayload }
    ];

    const retryInfo = await callAIWithRetry(
      chatMessages,
      {
        temperature: config?.temperature ?? 0.7,
        maxTokens: config?.maxTokens ?? 8000
      },
      userId,
      options.maxFormatRetries ?? 2
    );

    if (!retryInfo.structuredOutputValid && options.allowInvalidStructuredOutput) {
      const observedResult = parseGoalConversationResponse(retryInfo.content, previousUnderstanding, {
        latestUserInput: input.goal,
        previousStage: input.metadata?.previousStage,
        previousConfidence: previousUnderstanding?.confidence || 0.2,
        confirmProposal: input.metadata?.confirmProposal === true
      });

      return {
        success: true,
        userVisible: observedResult.userVisible,
        internal: observedResult.internal,
        renderHints: {
          component: 'goal-conversation',
          quickReplies: observedResult.internal.ext.goalConversation.quickReplies || []
        },
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'skill:goal-conversation',
          agentName: '目标对话 Skill',
          agentType: 'custom',
          confidence: observedResult.internal.core.confidence,
          generatedAt: new Date().toISOString()
        },
        debug: {
          attemptCount: retryInfo.attemptCount,
          actualRetryCount: retryInfo.actualRetryCount,
          formatFailureCount: retryInfo.formatFailureCount,
          parseMode: retryInfo.parseMode,
          failureType: retryInfo.failureType,
          violations: retryInfo.violations,
          promptVersion: config?.version || 0,
          requestMessages: chatMessages,
          attempts: retryInfo.attempts,
          structuredOutputValid: false,
          observationMode: true
        }
      };
    }

    if (!retryInfo.structuredOutputValid) {
      return {
        success: false,
        error: 'STRUCTURED_OUTPUT_INVALID',
        userVisible: buildStructuredOutputErrorMessage(retryInfo.attemptCount),
        internal: {
          core: {
            stage: input.metadata?.previousStage === 'proposing' || input.metadata?.previousStage === 'ready'
              ? 'proposing'
              : 'understanding',
            confidence: typeof previousState?.confidence === 'number' ? previousState.confidence : 0,
            isCompleted: false
          },
          ext: {
            goalConversation: {
              understanding: previousUnderstanding || {},
              nextQuestions: [],
              collected: previousState?.collected || {}
            }
          }
        },
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'skill:goal-conversation',
          agentName: '目标对话 Skill',
          agentType: 'custom',
          confidence: typeof previousState?.confidence === 'number' ? previousState.confidence : 0,
          generatedAt: new Date().toISOString()
        },
        debug: {
          attemptCount: retryInfo.attemptCount,
          actualRetryCount: retryInfo.actualRetryCount,
          formatFailureCount: retryInfo.formatFailureCount,
          parseMode: retryInfo.parseMode,
          failureType: retryInfo.failureType,
          violations: retryInfo.violations,
          promptVersion: config?.version || 0,
          requestMessages: chatMessages,
          attempts: retryInfo.attempts,
          structuredOutputValid: false
        }
      };
    }

    const result = parseGoalConversationResponse(retryInfo.content, previousUnderstanding, {
      latestUserInput: input.goal,
      previousStage: input.metadata?.previousStage,
      previousConfidence: previousUnderstanding?.confidence || 0.2,
      confirmProposal: input.metadata?.confirmProposal === true
    });

    return {
      success: true,
      userVisible: result.userVisible,
      internal: result.internal,
      renderHints: {
        component: 'goal-conversation',
        quickReplies: result.internal.ext.goalConversation.quickReplies || []
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'skill:goal-conversation',
        agentName: '目标对话 Skill',
        agentType: 'custom',
        confidence: result.internal.core.confidence,
        generatedAt: new Date().toISOString()
      },
      debug: {
        attemptCount: retryInfo.attemptCount,
        actualRetryCount: retryInfo.actualRetryCount,
        formatFailureCount: retryInfo.formatFailureCount,
        parseMode: retryInfo.parseMode,
        failureType: retryInfo.failureType,
        violations: retryInfo.violations,
        promptVersion: config?.version || 0,
        requestMessages: chatMessages,
        attempts: retryInfo.attempts,
        structuredOutputValid: true
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
      userVisible: '抱歉，我刚才走神了，能再说一遍吗？',
      internal: {
        core: {
          stage: 'understanding',
          confidence: 0,
          isCompleted: false
        },
        ext: {
          goalConversation: {
            understanding: input.metadata?.previousUnderstanding || {},
            nextQuestions: [],
            collected: {}
          }
        }
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'skill:goal-conversation',
        agentName: '目标对话 Skill',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

export async function runGoalConversationAgent(params: {
  input: string;
  userId: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  previousUnderstanding?: any;
  previousStage?: string;
  previousState?: GoalConversationStateSnapshot;
  maxFormatRetries?: number;
  allowInvalidStructuredOutput?: boolean;
  systemPromptOverride?: string;
  confirmProposal?: boolean;
}): Promise<GoalConversationAgentResult> {
  const result = await goalConversationAgentHandler(
    {
      type: 'custom',
      goal: params.input,
        metadata: {
          userId: params.userId,
          previousUnderstanding: params.previousUnderstanding,
          previousStage: params.previousStage,
          previousState: params.previousState,
          confirmProposal: params.confirmProposal === true
        }
    },
    {
      userId: params.userId,
      conversationHistory: params.conversationHistory || []
    } as AgentContext,
    {
      maxFormatRetries: params.maxFormatRetries,
      allowInvalidStructuredOutput: params.allowInvalidStructuredOutput,
      systemPromptOverride: params.systemPromptOverride
    }
  );

  if (!result.success || !result.internal) {
    const errorMessage = typeof result.error === 'string' ? result.error : result.error?.message;
    if (errorMessage === 'STRUCTURED_OUTPUT_INVALID' && result.internal) {
      return {
        userVisible: result.userVisible || '',
        internal: result.internal as GoalConversationInternal,
        debug: {
          attemptCount: Number(result.debug?.attemptCount || 0),
          actualRetryCount: Number(result.debug?.actualRetryCount || 0),
          formatFailureCount: Number(result.debug?.formatFailureCount || 0),
          parseMode: (result.debug?.parseMode || 'none') as StructuredParseResult['parseMode'],
          failureType: (result.debug?.failureType || 'missing_json_block') as GoalStructuredFailureType,
          violations: Array.isArray(result.debug?.violations) ? result.debug?.violations as string[] : [],
          promptVersion: Number(result.debug?.promptVersion || 0),
          requestMessages: Array.isArray(result.debug?.requestMessages)
            ? result.debug?.requestMessages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
            : [],
          attempts: Array.isArray(result.debug?.attempts)
            ? result.debug?.attempts as RetryAttemptInfo[]
            : [],
          structuredOutputValid: false
        }
      };
    }
    throw new Error(errorMessage || 'Goal conversation agent failed');
  }

  return {
    userVisible: result.userVisible || '',
    internal: result.internal as GoalConversationInternal,
    debug: {
      attemptCount: Number(result.debug?.attemptCount || 0),
      actualRetryCount: Number(result.debug?.actualRetryCount || 0),
      formatFailureCount: Number(result.debug?.formatFailureCount || 0),
      parseMode: (result.debug?.parseMode || 'none') as StructuredParseResult['parseMode'],
      failureType: (result.debug?.failureType || 'none') as GoalStructuredFailureType,
      violations: Array.isArray(result.debug?.violations) ? result.debug?.violations as string[] : [],
      promptVersion: Number(result.debug?.promptVersion || 0),
      requestMessages: Array.isArray(result.debug?.requestMessages)
        ? result.debug?.requestMessages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
        : [],
      attempts: Array.isArray(result.debug?.attempts)
        ? result.debug?.attempts as RetryAttemptInfo[]
        : [],
      structuredOutputValid: result.debug?.structuredOutputValid === true
    }
  };
}
