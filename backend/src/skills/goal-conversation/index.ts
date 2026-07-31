import { logger } from '../../utils/logger';
import { agentConfigService } from '../../services/agentConfig.service';
import { mergeStateDelta } from './delta-merge';
import {
  composePromptFromAgentRouting,
  isPromptSupplementEnabled,
} from '../../services/prompt-composer';
import { callPrompt } from '../../composers/prompt-composer';
import type { PromptCallSpec } from '../../composers/types';
import {
  AgentContext,
  AgentDefinition,
  AgentInput,
  AgentOutput
} from '../../agents/protocol';
import {
  extractStructuredPayload,
  type GoalStructuredFailureType,
  type StructuredParseResult,
  validateGoalConversationStructuredOutput
} from './structured-validator';
import {
  isPlaceholderValue,
  mergeUnderstanding,
  sanitizeUnderstanding,
  buildCollected
} from '../../skills/goal-understanding-composer';
import {
  buildDefaultRuntimeContract,
  type RuntimeContract,
} from '../../services/prompt-lab/runtime-contract';
import {
  adaptGoalConversationEnvelope,
  type RuntimeEnvelope,
} from '../../services/prompt-lab/envelope-adapter';

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
  /** 统一运行契约 envelope（C2 试点，不替换 agent-output-v1） */
  runtimeEnvelope?: RuntimeEnvelope;
  /** Delta 试验（§5.4）量测：漏报率观测数据 */
  deltaStats?: {
    mode: true;
    /** 模型本轮实际产出的 understanding 键数 */
    emittedUnderstandingKeys: number;
    /** 合并后完整 understanding 键数 */
    mergedUnderstandingKeys: number;
    /** 本轮 understanding 增量为空（漏报候选信号） */
    emptyDelta: boolean;
    /** 本轮是否产出了 state 对象 */
    stateEmitted: boolean;
  };
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

const DEFAULT_GOAL_RUNTIME_CONTRACT = buildDefaultRuntimeContract('goal-conversation', 'conversational');

function buildGoalRuntimeEnvelope(
  result: Pick<GoalConversationAgentResult, 'userVisible' | 'internal'>,
  options: {
    contract: RuntimeContract;
    status?: 'succeeded' | 'partial' | 'blocked' | 'failed';
    reason?: string | null;
  }
): RuntimeEnvelope {
  return adaptGoalConversationEnvelope(result, {
    contract: options.contract,
    status: options.status || 'succeeded',
    reason: options.reason ?? null,
  });
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

interface GoalPromptInput {
  goal: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  previousState?: GoalConversationStateSnapshot;
  previousUnderstanding?: any;
  previousStage?: string;
  confirmProposal?: boolean;
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
  const listItems = content.match(/(?:^|\n)\s*(?:\d+[.、]|[•-])\s*(.+?)(?=\n|$)/g);
  if (!listItems || listItems.length < 2 || listItems.length > 5) return [];

  return listItems.map((item) => ({
    text: item.replace(/^\s*(?:\d+[.、]|[•-])\s*/, '').trim()
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

/**
 * 从 ACTIVE prompt metadata 解析 Delta 开关（§5.4）。
 * 锚点链：core.yaml deltaOutput → 编译产物 frontmatter → seed metadata.promptLab.deltaOutput。
 */
function extractDeltaOutputMode(metadata: unknown): boolean {
  if (!metadata) return false;
  try {
    const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    return parsed?.promptLab?.deltaOutput === true;
  } catch {
    return false;
  }
}

function parseGoalConversationResponse(
  content: string,
  previousUnderstanding?: any,
  stageControlOptions?: StageControlOptions,
  deltaOptions?: { deltaMode?: boolean }
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
  let normalizedPayload: Record<string, any> = {};

  if (parsedJson) {
    normalizedPayload = normalizeGoalConversationModelPayload(parsedJson);
    if (deltaOptions?.deltaMode) {
      // Delta 试验（§5.4）：模型只产出变动字段，平台合并回完整状态
      understanding = mergeStateDelta(previousUnderstanding, normalizedPayload.understanding);
    } else {
      understanding = mergeUnderstanding(previousUnderstanding, normalizedPayload);
    }
    const validStages = ['understanding', 'proposing', 'ready', 'completed'];
    const stageFromPayload = parsedJson.stage || parsedJson.state?.stage;
    if (validStages.includes(stageFromPayload)) {
      stage = stageFromPayload;
    } else if (deltaOptions?.deltaMode && validStages.includes(stageControlOptions?.previousStage as string)) {
      // Delta：stage 缺席=不变，回填上一轮阶段
      stage = stageControlOptions!.previousStage as typeof stage;
    } else {
      stage = 'understanding';
    }

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

  // 直接使用 AI 返回的 confidence；Delta 模式下缺席=不变，回填上一轮置信度
  let confidence = typeof (parsedJson?.confidence ?? parsedJson?.state?.confidence) === 'number'
    ? (parsedJson?.confidence ?? parsedJson?.state?.confidence)
    : (deltaOptions?.deltaMode && typeof stageControlOptions?.previousConfidence === 'number'
        ? stageControlOptions.previousConfidence
        : 0.2);

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

  const parsed: GoalConversationAgentResult = {
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
          collected: buildCollected(understanding, normalizedPayload),
          structuredData,
          confirmedProposal,
          confidenceScores
        }
      }
    }
  };

  // Delta 试验（§5.4）量测：漏报率观测（emitted=模型本轮产出，merged=合并后全量）
  if (deltaOptions?.deltaMode) {
    const emittedKeys = Object.keys(normalizedPayload.understanding || {}).length;
    parsed.deltaStats = {
      mode: true,
      emittedUnderstandingKeys: emittedKeys,
      mergedUnderstandingKeys: Object.keys(understanding || {}).length,
      emptyDelta: emittedKeys === 0,
      stateEmitted: Boolean(parsedJson?.state),
    };
  }
  return parsed;
}

/**
 * Accept legacy wrapper and input-shaped state fields, then give the parser one
 * canonical raw payload. The preferred model shape remains top-level fields.
 */
export function normalizeGoalConversationModelPayload(parsedJson: any): Record<string, any> {
  const topLevel = parsedJson && typeof parsedJson === 'object' ? parsedJson : {};
  const legacy = topLevel.goalConversation && typeof topLevel.goalConversation === 'object'
    ? topLevel.goalConversation
    : {};
  const state = topLevel.state && typeof topLevel.state === 'object' ? topLevel.state : {};

  return {
    ...state,
    ...legacy,
    ...topLevel,
    understanding: topLevel.understanding ?? legacy.understanding ?? state.understanding,
    nextQuestions: topLevel.nextQuestions ?? legacy.nextQuestions ?? state.nextQuestions,
    quickReplies: topLevel.quickReplies ?? legacy.quickReplies ?? state.quickReplies,
    confirmedProposal: topLevel.confirmedProposal ?? legacy.confirmedProposal ?? state.confirmedProposal,
    structuredData: topLevel.structuredData ?? legacy.structuredData ?? state.structuredData,
    confidenceScores: topLevel.confidenceScores ?? legacy.confidenceScores ?? state.confidenceScores,
  };
}

function buildStructuredOutputErrorMessage(attemptCount: number): string {
  return `本轮结构化输出连续 ${attemptCount} 次未通过校验，状态未更新。请点击重试，再尝试一次。`;
}

/**
 * 统一协议 v2：把上一次校验失败的 violations 注入下一次重试的 user message，
 * 让模型知道哪里错了，下次怎么调整。原版只是原样重发同一份 messages，
 * 模型反复用同一错误形状回写。注入点：user content 尾部追加 retry notice。
 */
function buildRetryNotice(prevFailureType: string, prevViolations: string[]): string {
  const lines: string[] = [];
  lines.push('[上一轮结构化输出校验失败 — 请修正后重新输出]');
  lines.push(`失败类型: ${prevFailureType}`);
  if (prevViolations.length > 0) {
    lines.push('违规格条目:');
    for (const v of prevViolations) {
      lines.push(`- ${v}`);
    }
  }
  lines.push('');
  lines.push('请基于上述反馈修正输出 JSON 形态。常见修正点:');
  lines.push('- 若把 understanding 嵌进 state.understanding，请改为放到顶层（与 state 同级）');
  lines.push('- 若把 nextQuestions 嵌进 state.nextQuestions，请改为放到顶层');
  lines.push('- 不要使用 goalConversation 包装层；quickReplies / understanding / nextQuestions 等字段直接放在顶层');
  lines.push('- state 必须包含 stage / confidence / done 三个字段，不要把 understanding 塞进 state');
  lines.push('- 起草时严格按 system prompt 的输出规格，参考但不要照搬输入 payload 的嵌套形态');
  return lines.join('\n');
}

function buildGoalPromptSpec(
  maxAttempts: number,
  deltaMode = false
): PromptCallSpec<GoalPromptInput, GoalConversationAgentResult> {
  return {
    agentId: 'skill:goal-conversation',
    defaultSystemPrompt: '',
    requireActivePrompt: true,
    caller: {
      agentId: 'goal-agent',
      skillId: 'goal-conversation',
    },
        buildUserPayload: (payload) => buildGoalConversationUserPayload({
      userInput: payload.goal,
      conversationHistory: payload.conversationHistory,
      previousState: payload.previousState,
      previousUnderstanding: payload.previousUnderstanding,
      previousStage: payload.previousStage,
    }),
    prepareSystemPrompt: async (systemPrompt) => {
      if (!isPromptSupplementEnabled()) return systemPrompt;
      const { finalPrompt, supplementApplied, fieldsCovered } =
        await composePromptFromAgentRouting('goal-conversation', systemPrompt);
      if (supplementApplied) {
        logger.debug('[skill:goal-conversation] field routing supplement applied', { fieldsCovered });
        return finalPrompt;
      }
      return systemPrompt;
    },
    parseRawOutput: (rawOutput) => {
      // Delta 模式（§5.4）：state/understanding 缺席合法（缺席=不变）
      const validation = validateGoalConversationStructuredOutput(rawOutput, { deltaMode });
      if (!validation.valid || !validation.parsedJson) {
        return {
          parsed: null,
          extractedJson: null,
          failureReason: validation.failureType || 'missing_json_block',
          violations: validation.violations?.length
            ? validation.violations
            : ['结构化输出校验失败'],
        };
      }
      return {
        parsed: validation.parsedJson,
        extractedJson: JSON.stringify(validation.parsedJson),
      };
    },
    validateParsedOutput: () => ({ valid: true }),
    normalizeOutput: (_parsed, payload) => parseGoalConversationResponse(
      // parseGoalConversationResponse 需要原始 content 以保留 dialogue 抽取路径；
      // callPrompt 成功时 parsed 已校验，这里用 JSON 回放等价 raw。
      JSON.stringify(_parsed),
      payload.previousUnderstanding,
      {
        latestUserInput: payload.goal,
        previousStage: payload.previousStage,
        previousConfidence: payload.previousState?.confidence ?? payload.previousUnderstanding?.confidence ?? 0.2,
        confirmProposal: payload.confirmProposal === true,
      },
      { deltaMode }
    ),
    mapEnvelope: (output, _input, runtimeContract) => adaptGoalConversationEnvelope(output, {
      contract: runtimeContract,
      status: 'succeeded',
      reason: null,
    }),
    retryStrategy: {
      maxAttempts,
      onValidationFail: ({ failureReason, violations }) =>
        buildRetryNotice(failureReason || 'validation_failed', violations || []),
    },
  };
}

function mapAttemptsFromPromptDebug(debug: { attempts?: Array<{ attempt: number; status?: string; failureReason?: string; violations?: string[]; rawOutput?: string }> }): RetryAttemptInfo[] {
  return (debug.attempts || []).map((item) => ({
    attemptIndex: item.attempt,
    parseMode: 'none' as StructuredParseResult['parseMode'],
    structuredOutputValid: item.status === 'success',
    failureType: (item.failureReason || 'missing_json_block') as GoalStructuredFailureType,
    violations: item.violations || [],
    rawContent: item.rawOutput || '',
  }));
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
  let runtimeContract: RuntimeContract = DEFAULT_GOAL_RUNTIME_CONTRACT;

  try {
    const history = (context.conversationHistory || [])
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));
    const previousState = input.metadata?.previousState as GoalConversationStateSnapshot | undefined;
    const previousUnderstanding = input.metadata?.previousUnderstanding;

    const promptInput: GoalPromptInput = {
      goal: input.goal,
      conversationHistory: history,
      previousState,
      previousUnderstanding,
      previousStage: input.metadata?.previousStage,
      confirmProposal: input.metadata?.confirmProposal === true,
    };

    // 旧语义：maxFormatRetries=2 → 最多 3 次尝试（含首次）
    const maxAttempts = Math.max(1, (options.maxFormatRetries ?? 2) + 1);
    // Delta 试验（§5.4）：ACTIVE metadata 锚点决定是否启用增量合并
    let deltaMode = false;
    try {
      const promptConfig = await agentConfigService.getActivePrompt('skill:goal-conversation');
      deltaMode = extractDeltaOutputMode(promptConfig?.metadata);
    } catch {
      deltaMode = false;
    }
    const promptResult = await callPrompt(
      buildGoalPromptSpec(maxAttempts, deltaMode),
      promptInput,
      {
        userId,
        systemPromptOverride: options.systemPromptOverride,
      }
    );

    const attempts = mapAttemptsFromPromptDebug(promptResult.debug);
    const attemptCount = attempts.length || promptResult.debug.attempts?.length || 0;
    const actualRetryCount = Math.max(0, attemptCount - 1);
    const formatFailureCount = attempts.filter((item) => !item.structuredOutputValid).length;
    runtimeContract = promptResult.runtimeEnvelope
      ? {
          ...DEFAULT_GOAL_RUNTIME_CONTRACT,
          businessState: {
            ...DEFAULT_GOAL_RUNTIME_CONTRACT.businessState,
            ...(promptResult.runtimeEnvelope.businessState
              ? {
                  domain: promptResult.runtimeEnvelope.businessState.domain
                    || DEFAULT_GOAL_RUNTIME_CONTRACT.businessState.domain,
                }
              : {}),
          },
          contextUpdate: promptResult.runtimeEnvelope.contextUpdate
            ? {
                ...DEFAULT_GOAL_RUNTIME_CONTRACT.contextUpdate,
                mode: promptResult.runtimeEnvelope.contextUpdate.mode as any,
                stateOwner: promptResult.runtimeEnvelope.contextUpdate.stateOwner as any,
              }
            : DEFAULT_GOAL_RUNTIME_CONTRACT.contextUpdate,
        }
      : runtimeContract;

    if (promptResult.success && promptResult.output) {
      const result = promptResult.output;
      return {
        success: true,
        userVisible: result.userVisible,
        internal: result.internal,
        runtimeEnvelope: promptResult.runtimeEnvelope || buildGoalRuntimeEnvelope(result, {
          contract: runtimeContract,
          status: 'succeeded',
        }),
        renderHints: {
          component: 'goal-conversation',
          quickReplies: result.internal.ext.goalConversation.quickReplies || [],
        },
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'skill:goal-conversation',
          agentName: '目标对话 Skill',
          agentType: 'custom',
          confidence: result.internal.core.confidence,
          generatedAt: new Date().toISOString(),
        },
        debug: {
          attemptCount,
          actualRetryCount,
          formatFailureCount,
          parseMode: attempts[attempts.length - 1]?.parseMode || 'raw-json',
          failureType: 'none',
          violations: [],
          promptVersion: promptResult.debug.systemPromptVersion || 0,
          requestMessages: [
            { role: 'system', content: promptResult.debug.systemPrompt },
            { role: 'user', content: promptResult.debug.userPayload },
          ],
          attempts,
          structuredOutputValid: true,
          ...(result.deltaStats ? { delta: result.deltaStats } : {}),
        },
      };
    }

    if (options.allowInvalidStructuredOutput) {
      const { resolveEffectiveRuntimeContract } = await import('../../services/prompt-lab/resolve-runtime-contract');
      const activePrompt = await agentConfigService.getActivePrompt('skill:goal-conversation')
        || await agentConfigService.getActivePrompt('goal-conversation');
      runtimeContract = (
        await resolveEffectiveRuntimeContract('skill:goal-conversation', activePrompt, {
          archetype: 'conversational',
        })
      ).contract;

      const observedResult = parseGoalConversationResponse(
        promptResult.debug.rawModelOutput || '',
        previousUnderstanding,
        {
          latestUserInput: input.goal,
          previousStage: input.metadata?.previousStage,
          previousConfidence: previousUnderstanding?.confidence || 0.2,
          confirmProposal: input.metadata?.confirmProposal === true,
        }
      );
      return {
        success: true,
        userVisible: observedResult.userVisible,
        internal: observedResult.internal,
        runtimeEnvelope: buildGoalRuntimeEnvelope(observedResult, {
          contract: runtimeContract,
          status: 'partial',
          reason: 'observation-mode',
        }),
        renderHints: {
          component: 'goal-conversation',
          quickReplies: observedResult.internal.ext.goalConversation.quickReplies || [],
        },
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'skill:goal-conversation',
          agentName: '目标对话 Skill',
          agentType: 'custom',
          confidence: observedResult.internal.core.confidence,
          generatedAt: new Date().toISOString(),
        },
        debug: {
          attemptCount,
          actualRetryCount,
          formatFailureCount,
          parseMode: attempts[attempts.length - 1]?.parseMode || 'none',
          failureType: (attempts[attempts.length - 1]?.failureType || 'missing_json_block') as GoalStructuredFailureType,
          violations: attempts[attempts.length - 1]?.violations || [],
          promptVersion: promptResult.debug.systemPromptVersion || 0,
          requestMessages: [
            { role: 'system', content: promptResult.debug.systemPrompt },
            { role: 'user', content: promptResult.debug.userPayload },
          ],
          attempts,
          structuredOutputValid: false,
          observationMode: true,
        },
      };
    }

    const invalidInternal: GoalConversationInternal = {
      core: {
        stage: input.metadata?.previousStage === 'proposing' || input.metadata?.previousStage === 'ready'
          ? 'proposing'
          : 'understanding',
        confidence: typeof previousState?.confidence === 'number' ? previousState.confidence : 0,
        isCompleted: false,
      },
      ext: {
        goalConversation: {
          understanding: previousUnderstanding || {},
          nextQuestions: [],
          collected: previousState?.collected || {},
        },
      },
    };
    const invalidVisible = buildStructuredOutputErrorMessage(attemptCount || 1);
    // 失败路径 mapEnvelope 未跑；显式 resolve ACTIVE metadata contract（测试/观测依赖）
    const { resolveEffectiveRuntimeContract } = await import('../../services/prompt-lab/resolve-runtime-contract');
    const activePrompt = await agentConfigService.getActivePrompt('skill:goal-conversation')
      || await agentConfigService.getActivePrompt('goal-conversation');
    const resolved = await resolveEffectiveRuntimeContract('skill:goal-conversation', activePrompt, {
      archetype: 'conversational',
    });
    runtimeContract = resolved.contract;

    return {
      success: false,
      error: 'STRUCTURED_OUTPUT_INVALID',
      userVisible: invalidVisible,
      internal: invalidInternal,
      runtimeEnvelope: buildGoalRuntimeEnvelope(
        { userVisible: invalidVisible, internal: invalidInternal },
        {
          contract: runtimeContract,
          status: 'failed',
          reason: 'STRUCTURED_OUTPUT_INVALID',
        }
      ),
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'skill:goal-conversation',
        agentName: '目标对话 Skill',
        agentType: 'custom',
        confidence: typeof previousState?.confidence === 'number' ? previousState.confidence : 0,
        generatedAt: new Date().toISOString(),
      },
      debug: {
        attemptCount,
        actualRetryCount,
        formatFailureCount,
        parseMode: attempts[attempts.length - 1]?.parseMode || 'none',
        failureType: (attempts[attempts.length - 1]?.failureType
          || promptResult.error?.message
          || 'missing_json_block') as GoalStructuredFailureType,
        violations: attempts[attempts.length - 1]?.violations
          || [promptResult.error?.message || '结构化输出校验失败'],
        promptVersion: promptResult.debug.systemPromptVersion || 0,
        requestMessages: [
          { role: 'system', content: promptResult.debug.systemPrompt },
          { role: 'user', content: promptResult.debug.userPayload },
        ],
        attempts,
        structuredOutputValid: false,
      },
    };
  } catch (error: any) {
    const failedInternal: GoalConversationInternal = {
      core: {
        stage: 'understanding',
        confidence: 0,
        isCompleted: false,
      },
      ext: {
        goalConversation: {
          understanding: input.metadata?.previousUnderstanding || {},
          nextQuestions: [],
          collected: {},
        },
      },
    };
    return {
      success: false,
      error: error.message || 'Unknown error',
      userVisible: '抱歉，我刚才走神了，能再说一遍吗？',
      internal: failedInternal,
      runtimeEnvelope: buildGoalRuntimeEnvelope(
        { userVisible: '抱歉，我刚才走神了，能再说一遍吗？', internal: failedInternal },
        {
          contract: runtimeContract,
          status: 'failed',
          reason: error.message || 'Unknown error',
        }
      ),
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'skill:goal-conversation',
        agentName: '目标对话 Skill',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString(),
      },
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
      const invalidResult: GoalConversationAgentResult = {
        userVisible: result.userVisible || '',
        internal: result.internal as GoalConversationInternal,
        runtimeEnvelope: result.runtimeEnvelope as RuntimeEnvelope | undefined,
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
      if (!invalidResult.runtimeEnvelope) {
        invalidResult.runtimeEnvelope = buildGoalRuntimeEnvelope(invalidResult, {
          contract: DEFAULT_GOAL_RUNTIME_CONTRACT,
          status: 'failed',
          reason: 'STRUCTURED_OUTPUT_INVALID',
        });
      }
      return invalidResult;
    }
    throw new Error(errorMessage || 'Goal conversation agent failed');
  }

  const successResult: GoalConversationAgentResult = {
    userVisible: result.userVisible || '',
    internal: result.internal as GoalConversationInternal,
    runtimeEnvelope: result.runtimeEnvelope as RuntimeEnvelope | undefined,
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
  if (!successResult.runtimeEnvelope) {
    successResult.runtimeEnvelope = buildGoalRuntimeEnvelope(successResult, {
      contract: DEFAULT_GOAL_RUNTIME_CONTRACT,
      status: 'succeeded',
    });
  }
  return successResult;
}
