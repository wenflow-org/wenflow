import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { PromptCallSpec, type PromptCallResult } from '../../composers/types';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../../agents/protocol';
import { evaluateByCriteria, evaluateByProfile } from '../../skills/acceptance-evidence-evaluator';
import { getFallbackStrategies, normalizeStrategy, buildGuidancePrompt } from '../../skills/teaching-strategy-selector';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { buildSkillOutcome, type SkillOutcome } from '../outcome';

const AGENT_ID = 'skill:teaching-turn';

type MessageRole = 'user' | 'assistant' | 'system';

const ALLOWED_COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
const ALLOWED_EMOTIONAL_STATES = ['positive', 'neutral', 'frustrated', 'confused'] as const;
const ALLOWED_KNOWLEDGE_STATUSES = ['pending', 'learning', 'mastered', 'review'] as const;
const ALLOWED_LOAD_BASIS = ['semantic', 'structure', 'pacing', 'combined', 'absent'] as const;

export interface TeachingTurnInput {
  messages: Array<{ role: MessageRole; content: string }>;
  learner: TeachingLearnerProjection;
  scenario: {
    subject: string;
    topic: string;
    taskTitle: string;
    taskDescription: string;
    taskType: string;
    taskProfile?: {
      knowledgeType?: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
      cognitiveLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
      displayLabel?: string | null;
      learningObjectives?: string[];
      coreConcept?: string | null;
      linkedConceptId?: string | null;
      linkedConceptName?: string | null;
    };
    currentTaskContext?: {
      description?: string | null;
      acceptanceCriteria?: string | null;
    };
    cognitiveFrame?: {
      currentCoreConcept?: {
        id?: string | null;
        name?: string | null;
        description?: string | null;
      };
      prerequisiteConcepts?: string[];
      neighboringConcepts?: string[];
      targetRelation?: string | null;
      milestoneIntent?: string | null;
      transferGoal?: string | null;
    };
    teachingStrategyGuidance?: {
      knowledgeType?: string | null;
      cognitiveLevel?: string | null;
      objectiveFocus: string[];
      coreConcept?: string | null;
      explanationStyle: string;
      interactionPattern: string;
      targetDepth: string;
      preferredStrategies: string[];
      responseConstraints: string[];
    };
    taskKnowledgeScope?: {
      primaryConcepts: string[];
      prerequisiteConcepts: string[];
      supportingConcepts?: string[];
    };
    pathTitle?: string;
    pathSummary?: string | null;
    currentMilestoneTitle?: string;
    currentStageNumber?: number;
    currentTaskOrder?: number;
    totalTasksInMilestone?: number;
    contextCompression?: {
      enabled: boolean;
      estimatedTokens: number;
      triggerTokens: number;
      recap: string | null;
    };
    pathBackgroundContext?: Record<string, any>;
    learningSignal?: string | null;
    lastLessonRecap?: {
      sourceTopic?: string | null;
      topicSummary?: string | null;
      retrievalCue?: string | null;
      unresolvedPoints?: string[];
    } | null;
    /** 前端交互特征情报（认知负荷量测）：本轮统计 + 近轮对比，仅供判断 loadIndex */
    interactionProfile?: {
      current?: Record<string, number> | null;
      history?: Array<{
        role: string;
        timestamp: string;
        meta?: Record<string, number> | null;
        textLength: number;
      }>;
      absent?: boolean;
    } | null;
  };
  knowledge: {
    points: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>;
  };
  controls?: {
    mode?: 'tutor' | 'peer' | 'debate';
    teachingControlContext?: Record<string, any>;
  };
  classroomContext?: Record<string, any>;
  classroomEventContext?: Record<string, any>;
  visibleDialogueContext?: Array<{ role: MessageRole; content: string }>;
  /** 双引擎试点（内部透传）：第一段 analysis-only 的产出，注入第二段作为约束 */
  _analysisStage?: Record<string, any> | null;
}

export interface TeachingTurnOutput {
  reply: string;
  analysis: {
    cognitiveLevel: string;
    levelScore: number;
    understanding: number;
    confusionPoints: string[];
    engagement: number;
    emotionalState: string;
    /** 合成认知负荷 0-1（LLM 基于语义+前端交互特征判断），默认 0.5 */
    loadIndex: number;
    /** 判断依据：semantic|structure|pacing|combined|absent，默认 absent */
    loadBasis: string;
  };
  knowledge: {
    currentPoint: string | null;
    points: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>;
  };
  pedagogy: {
    strategies: string[];
  };
  control: {
    isCompletionCandidate: boolean;
    shouldTriggerPeer: boolean;
    completionCandidateEvidence?: {
      hasCriteria: boolean;
      acceptanceCriteria: string | null;
      anchorTokens: string[];
      matchedTokens: string[];
      matchedRatio: number;
      learnerEvidenceExcerpt: string;
      decision: 'accepted' | 'rejected' | 'no-criteria';
      reason: string;
    };
    /** 可选理解检查点：模型在适当时机输出，由 coordinator 落库为 pendingCheckpoint */
    checkpoint?: {
      question: string;
      type: 'short_answer' | 'single_choice' | 'multi_choice';
      options?: Array<{ id: string; text: string }>;
      hint?: string;
    };
  };
}

/**
 * 已通过 raw validator 与 normalizer 的单轮教学领域产物。
 * 保留独立别名，避免将 legacy agent-output-v1 的 internal 包装误作领域模型。
 */
export type TeachingTurnArtifact = TeachingTurnOutput;

/**
 * Phase 2 internal canonical sidecar.
 * Coordinator 仍负责知识状态合并和持久化，所以不在此阶段声明 transition。
 */
export function toTeachingTurnSkillOutcome(
  artifact: TeachingTurnArtifact,
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope> | null,
): SkillOutcome<TeachingTurnArtifact> {
  return buildSkillOutcome({
    skillId: AGENT_ID,
    artifact,
    quality: 'model',
    runtimeEnvelope: runtimeEnvelope || null,
    transition: null,
  });
}

export const teachingTurnAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '教学回合 Skill',
  version: '1.0.0',
  type: 'teaching',
  category: 'standard',
  description: '根据课堂上下文生成本轮教学回复与结构化教学状态',
  capabilities: [
    'teaching-turn-generation',
    'cognitive-analysis',
    'knowledge-state-suggestion',
    'teaching-strategy-selection'
  ],
  subscribes: ['teaching:turn:requested'],
  publishes: ['teaching:turn:generated'],
  inputSchema: {
    type: 'object',
    properties: {
      messages: { type: 'array' },
      scenario: { type: 'object' },
      learner: { type: 'object' },
      knowledge: { type: 'object' },
      controls: { type: 'object' }
    },
    required: ['messages', 'scenario', 'knowledge']
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      analysis: { type: 'object' },
      knowledge: { type: 'object' },
      pedagogy: { type: 'object' },
      control: { type: 'object' }
    },
    required: ['reply', 'analysis', 'knowledge', 'pedagogy', 'control']
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};





function normalizeConceptName(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildStrategyGuidancePrompt(input: TeachingTurnInput): string | null {
  return buildGuidancePrompt(input.scenario.teachingStrategyGuidance);
}

function buildTaskExecutionPrompt(input: TeachingTurnInput): string {
  const taskProfile = input.scenario.taskProfile;
  const taskContext = input.scenario.currentTaskContext;
  const lines = [
    '以下是当前子任务的执行锚点，优先围绕它教学：',
    `- linkedConcept: ${taskProfile?.linkedConceptName || taskProfile?.coreConcept || 'none'}`,
    `- taskDescription: ${taskContext?.description || input.scenario.taskDescription || 'none'}`,
    `- acceptanceCriteria: ${taskContext?.acceptanceCriteria || 'none'}`,
    `- primaryConcepts: ${(input.scenario.taskKnowledgeScope?.primaryConcepts || []).join(' | ') || 'none'}`,
    `- supportingConcepts: ${(input.scenario.taskKnowledgeScope?.supportingConcepts || []).join(' | ') || 'none'}`,
  ];
  return lines.join('\n');
}

function normalizeAllowedStrategy(value: string | undefined) {
  return normalizeStrategy(value);
}

function deriveFallbackStrategies(input: TeachingTurnInput): string[] {
  return getFallbackStrategies(input.scenario.taskProfile?.knowledgeType);
}

function filterOverlyBroadKnowledgePoints(points: Array<{ name: string; status: 'pending' | 'learning' | 'mastered' | 'review'; progress: number }>, input: TeachingTurnInput) {
  const coreConcept = normalizeConceptName(input.scenario.taskProfile?.coreConcept || input.scenario.taskProfile?.linkedConceptName || '');
  const hasFinerPrimaryConcept = points.some((point) => normalizeConceptName(point.name) && normalizeConceptName(point.name) !== coreConcept);

  if (!coreConcept || !hasFinerPrimaryConcept) {
    return points;
  }

  const filtered = points.filter((point) => normalizeConceptName(point.name) !== coreConcept);
  return filtered.length > 0 ? filtered : points;
}
function normalizeOutput(parsed: Record<string, any>, input: TeachingTurnInput): TeachingTurnOutput {
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : '我们继续沿着这个主题往下学。';

  const analysis = parsed.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : {};
  const knowledge = parsed.knowledge && typeof parsed.knowledge === 'object' ? parsed.knowledge : {};
  const pedagogy = parsed.pedagogy && typeof parsed.pedagogy === 'object' ? parsed.pedagogy : {};
  const control = parsed.control && typeof parsed.control === 'object' ? parsed.control : {};
  const points = Array.isArray(knowledge.points) ? knowledge.points : [];
  const fallbackStrategies = deriveFallbackStrategies(input);
  const acceptanceEvidence = evaluateAcceptanceCriteriaEvidence(input);
  const taskCompletionEvidence = evaluateCompletionByTaskProfile(input);
  const normalizedStrategies = Array.isArray(pedagogy.strategies)
    ? Array.from(new Set(pedagogy.strategies
        .map((item: any) => normalizeAllowedStrategy(item))
        .filter(Boolean))) as string[]
    : [];

  if (Array.isArray(pedagogy.strategies) && pedagogy.strategies.length > 0 && normalizedStrategies.length === 0) {
    logger.warn('[TeachingTurnAgent] 检测到非法 pedagogy.strategies，已自动回退到默认策略', {
      rawStrategies: pedagogy.strategies,
      fallbackStrategies,
      taskTitle: input.scenario.taskTitle,
      topic: input.scenario.topic,
    });
  }

  const normalizedKnowledgePoints = filterOverlyBroadKnowledgePoints(
    points.map((point: any) => ({
      name: typeof point?.name === 'string' ? point.name : '',
      status: (ALLOWED_KNOWLEDGE_STATUSES as readonly string[]).includes(point?.status)
        ? point.status
        : 'pending',
      progress: Number.isFinite(point?.progress)
        ? Math.max(0, Math.min(100, Math.round(Number(point.progress))))
        : 0,
    }))
      .filter((point: any) => point.name),
    input,
  );

  const normalizedCurrentPoint = typeof knowledge.currentPoint === 'string' && knowledge.currentPoint.trim()
    ? knowledge.currentPoint.trim()
    : null;
  const currentPointRemovedByFilter = normalizedCurrentPoint
    && normalizeConceptName(input.scenario.taskProfile?.coreConcept || input.scenario.taskProfile?.linkedConceptName || '')
    && !normalizedKnowledgePoints.some((point) => point.name === normalizedCurrentPoint);
  const completionEvidenceSatisfied = acceptanceEvidence.hasCriteria
    ? acceptanceEvidence.matched
    : taskCompletionEvidence.matched;
  const requestedCompletionCandidate = !!control.isCompletionCandidate;
  const resolvedCompletionCandidate = requestedCompletionCandidate && completionEvidenceSatisfied;

  if (requestedCompletionCandidate && !resolvedCompletionCandidate) {
    logger.warn('[TeachingTurnAgent] completionCandidate 被验收证据门槛拦截', {
      taskTitle: input.scenario.taskTitle,
      taskType: input.scenario.taskType,
      acceptanceCriteria: acceptanceEvidence.acceptanceCriteria,
      acceptanceMatched: acceptanceEvidence.matched,
      acceptanceDecision: acceptanceEvidence.decision,
      taskCompletionMatched: taskCompletionEvidence.matched,
      taskCompletionReason: taskCompletionEvidence.reason,
    });
  }

  return {
    reply,
    analysis: {
      cognitiveLevel: (typeof analysis.cognitiveLevel === 'string' && (ALLOWED_COGNITIVE_LEVELS as readonly string[]).includes(analysis.cognitiveLevel))
        ? analysis.cognitiveLevel
        : 'understand',
      levelScore: Number.isFinite(analysis.levelScore) ? Number(analysis.levelScore) : 2,
      understanding: Number.isFinite(analysis.understanding) ? Number(analysis.understanding) : 0.5,
      confusionPoints: Array.isArray(analysis.confusionPoints)
        ? analysis.confusionPoints.map((item: any) => String(item))
        : [],
      engagement: Number.isFinite(analysis.engagement) ? Number(analysis.engagement) : 0.5,
      emotionalState: (typeof analysis.emotionalState === 'string' && (ALLOWED_EMOTIONAL_STATES as readonly string[]).includes(analysis.emotionalState))
        ? analysis.emotionalState
        : 'neutral',
      loadIndex: Number.isFinite(analysis.loadIndex)
        ? Math.max(0, Math.min(1, Number(analysis.loadIndex)))
        : 0.5,
      loadBasis: (typeof analysis.loadBasis === 'string' && (ALLOWED_LOAD_BASIS as readonly string[]).includes(analysis.loadBasis))
        ? analysis.loadBasis
        : 'absent',
    },
    knowledge: {
      currentPoint: currentPointRemovedByFilter
        ? normalizedKnowledgePoints[0]?.name || null
        : normalizedCurrentPoint,
      points: normalizedKnowledgePoints.slice(0, 5),
    },
    pedagogy: {
      strategies: normalizedStrategies.length > 0 ? normalizedStrategies : fallbackStrategies,
    },
    control: {
      isCompletionCandidate: resolvedCompletionCandidate,
      shouldTriggerPeer: !!control.shouldTriggerPeer,
      completionCandidateEvidence: acceptanceEvidence.hasCriteria
        ? acceptanceEvidence
        : {
            hasCriteria: false,
            acceptanceCriteria: null,
            anchorTokens: [],
            matchedTokens: [],
            matchedRatio: taskCompletionEvidence.matched ? 1 : 0,
            learnerEvidenceExcerpt: taskCompletionEvidence.learnerEvidenceExcerpt,
            decision: taskCompletionEvidence.matched ? 'accepted' : 'rejected',
            reason: taskCompletionEvidence.reason,
          },
      ...(typeof control.checkpoint?.question === 'string' && control.checkpoint.question.trim()
        ? { checkpoint: normalizeCheckpoint(control.checkpoint) }
        : {}),
    },
  };
}

/** 归一化可选检查点输出：question 必填、type/options 兜底校验 */
function normalizeCheckpoint(value: Record<string, any>): NonNullable<TeachingTurnOutput['control']['checkpoint']> {
  const options = Array.isArray(value.options)
    ? value.options
        .filter((option: any) => typeof option?.id === 'string' && typeof option?.text === 'string')
        .slice(0, 5)
        .map((option: any) => ({ id: option.id, text: option.text }))
    : [];
  const wantsChoice = value.type === 'single_choice' || value.type === 'multi_choice';
  const type = wantsChoice && options.length >= 2
    ? (value.type as 'single_choice' | 'multi_choice')
    : 'short_answer';
  return {
    question: String(value.question).trim(),
    type,
    ...(type !== 'short_answer' ? { options } : {}),
    ...(typeof value.hint === 'string' && value.hint.trim() ? { hint: value.hint.trim() } : {}),
  };
}

function buildPromptInput(input: TeachingTurnInput) {
  const strategyGuidancePrompt = buildStrategyGuidancePrompt(input);
  const taskExecutionPrompt = buildTaskExecutionPrompt(input);

  return {
    latestLearnerMessage: [...input.messages].reverse().find((message) => message.role === 'user')?.content || '',
    scenario: input.scenario,
    learner: input.learner,
    classroomContext: input.classroomContext,
    classroomEventContext: input.classroomEventContext,
    knowledge: input.knowledge,
    controls: input.controls,
    visibleDialogueContext: input.visibleDialogueContext || input.messages,
    recentDialogueContext: input.messages,
    interactionProfile: input.scenario.interactionProfile ?? null,
    promptDirectives: {
      ...(strategyGuidancePrompt ? { strategyGuidance: strategyGuidancePrompt } : {}),
      taskExecution: taskExecutionPrompt,
    },
    // 双引擎试点：第一段（推理模型）产出的 analysis 作为第二段的既定认知判定
    ...(input._analysisStage ? { analysisStage: input._analysisStage } : {}),
  };
}

/**
 * 双引擎试点 · 第一段 analysis-only payload：
 * 同 teaching-turn 输入 + 显式指令（只产出 analysis，供推理模型做深层认知判定）
 */
function buildAnalysisOnlyPayload(input: TeachingTurnInput) {
  return {
    ...buildPromptInput(input),
    _analysisOnlyDirective:
      '【本次调用为认知判定阶段】只输出 analysis 对象（含 cognitiveLevel/levelScore/understanding/confusionPoints/engagement/emotionalState/loadIndex/loadBasis），'
      + '不输出 reply/knowledge/pedagogy/control。所有判定必须基于输入证据，无证据时按规则取默认值。',
  };
}

function evaluateAcceptanceCriteriaEvidence(input: TeachingTurnInput) {
  return evaluateByCriteria({
    messages: input.messages,
    acceptanceCriteria: input.scenario.currentTaskContext?.acceptanceCriteria,
    mode: 'criteria'
  });
}

function evaluateCompletionByTaskProfile(input: TeachingTurnInput) {
  return evaluateByProfile({
    messages: input.messages,
    taskType: input.scenario.taskType,
    knowledgeType: input.scenario.taskProfile?.knowledgeType,
    cognitiveLevel: input.scenario.taskProfile?.cognitiveLevel,
    knowledgePoints: input.knowledge.points,
    taskProfile: input.scenario.taskProfile ? {
      knowledgeType: input.scenario.taskProfile.knowledgeType || undefined,
      cognitiveLevel: input.scenario.taskProfile.cognitiveLevel || undefined,
      coreConcept: input.scenario.taskProfile.coreConcept || undefined
    } : undefined,
    mode: 'profile'
  });
}

function validateTeachingTurnOutput(parsed: any, input: TeachingTurnInput) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, failureReason: 'TEACHING_TURN_OUTPUT_NOT_OBJECT' };
  }

  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { valid: false, failureReason: 'TEACHING_TURN_REPLY_MISSING' };
  }

  if (!parsed.analysis || typeof parsed.analysis !== 'object' || !parsed.knowledge || typeof parsed.knowledge !== 'object' || !parsed.pedagogy || typeof parsed.pedagogy !== 'object' || !parsed.control || typeof parsed.control !== 'object') {
    return { valid: false, failureReason: 'TEACHING_TURN_REQUIRED_BLOCK_MISSING' };
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  const rawCompletionCandidate = parsed.control?.isCompletionCandidate === true;
  const acceptanceEvidence = evaluateAcceptanceCriteriaEvidence(input);
  const taskCompletionEvidence = evaluateCompletionByTaskProfile(input);
  const completionEvidenceSatisfied = acceptanceEvidence.hasCriteria
    ? acceptanceEvidence.matched
    : taskCompletionEvidence.matched;
  const rawPoints = Array.isArray(parsed.knowledge?.points) ? parsed.knowledge.points : [];
  const inputPointMap = new Map(
    (Array.isArray(input.knowledge?.points) ? input.knowledge.points : [])
      .filter((point) => typeof point?.name === 'string' && point.name.trim())
      .map((point) => [point.name.trim().toLowerCase(), point])
  );

  rawPoints.forEach((point: any) => {
    if (typeof point?.name !== 'string' || !point.name.trim()) return;
    inputPointMap.set(point.name.trim().toLowerCase(), {
      name: point.name.trim(),
      status: point.status,
      progress: point.progress,
    });
  });

  const allKnowledgeMastered = Array.from(inputPointMap.values()).length > 0
    && Array.from(inputPointMap.values()).every((point: any) => point?.status === 'mastered');
  const hasPrematureCompletionLanguage = /已完成|满足.*要求|满足.*标准|进入下一环节|进入下一个任务|接下来.*下一环节|接下来.*下一个任务/.test(reply);
  const completionLanguageAllowed = rawCompletionCandidate && completionEvidenceSatisfied && allKnowledgeMastered;

  if (hasPrematureCompletionLanguage && !completionLanguageAllowed) {
    return { valid: false, failureReason: 'TEACHING_TURN_REPLY_COMPLETION_MISMATCH' };
  }

  return { valid: true };
}

const teachingTurnPromptSpec: PromptCallSpec<TeachingTurnInput, TeachingTurnOutput> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: '',
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'teaching-turn',
  },
  buildUserPayload: (input) => buildPromptInput(input),
  normalizeOutput: (parsed, input) => normalizeOutput(parsed, input),
  validateParsedOutput: (parsed, input) => validateTeachingTurnOutput(parsed, input),
  mapEnvelope: (output, _input, runtimeContract) => {
    const isCompletion = !!output.control?.isCompletionCandidate;
    const phase = isCompletion ? 'completion-candidate' : 'turn-generated';
    return adaptToRuntimeEnvelope({
      contract: runtimeContract,
      artifact: output,
      phase,
      status: 'succeeded',
      confidence: 0.8,
      isTerminal: isCompletion,
      nextAction: isCompletion ? 'finalize-or-advance' : 'continue-turn',
      nextState: {
        stage: phase,
        isCompletionCandidate: isCompletion,
        shouldTriggerPeer: !!output.control?.shouldTriggerPeer,
        knowledge: output.knowledge,
        pedagogy: output.pedagogy,
      },
    });
  },
    retryStrategy: {
    maxAttempts: 2,
    onValidationFail: ({ failureReason }) => `上一次输出未通过校验，原因是：${failureReason}。请重新输出一个严格 JSON，特别注意：1) knowledge.points 要围绕当前任务、验收标准和最近课堂对话动态生成，不要偏题；2) pedagogy.strategies 只能使用允许的枚举；3) 保持当前任务的 core concept 与 target relation 不偏移。`,
  },
};

/**
 * 双引擎试点 · 第一段 analysis-only spec（推理模型深层认知判定）：
 * 复用 teaching-turn 的 ACTIVE prompt，payload 追加 analysis-only 指令；失败降级单段。
 */
const teachingAnalysisPromptSpec: PromptCallSpec<TeachingTurnInput, TeachingTurnOutput> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: '',
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'teaching-turn',
  },
  buildUserPayload: (input) => buildAnalysisOnlyPayload(input),
  normalizeOutput: (parsed) => ({ ...parsed }),
  validateParsedOutput: (parsed) => {
    if (!parsed || typeof parsed !== 'object' || !parsed.analysis || typeof parsed.analysis !== 'object') {
      return { valid: false, failureReason: 'TEACHING_TURN_ANALYSIS_MISSING' };
    }
    return { valid: true };
  },
  retryStrategy: {
    maxAttempts: 1,
  },
};

export async function teachingTurnAgentHandler(input: TeachingTurnInput): Promise<AgentOutput> {
  // 双引擎试点（feature flag 默认关）：WENFLOW_TWO_STAGE_TEACHING=1 时先 reasoning 产 analysis，再 chat 产 reply
  if (process.env.WENFLOW_TWO_STAGE_TEACHING === '1') {
    try {
      const analysisResult = await callPrompt(teachingAnalysisPromptSpec, input);
      if (analysisResult.success && analysisResult.output?.analysis) {
        const fullResult = await callPrompt(teachingTurnPromptSpec, {
          ...input,
          _analysisStage: analysisResult.output.analysis,
        });
        return buildTeachingOutcome(fullResult, input);
      }
      logger.warn('[TeachingTurnAgent] 双引擎第一段失败，降级单段');
    } catch (error) {
      logger.warn('[TeachingTurnAgent] 双引擎异常，降级单段', { error });
    }
  }
  const result = await callPrompt(teachingTurnPromptSpec, input);
  return buildTeachingOutcome(result, input);
}

function buildTeachingOutcome(
  result: PromptCallResult<TeachingTurnOutput>,
  input: TeachingTurnInput
): AgentOutput {
  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'TEACHING_TURN_OUTPUT_INVALID');
  }

  const output = result.output;
  const skillOutcome = toTeachingTurnSkillOutcome(output, result.runtimeEnvelope);
  return {
    success: true,
    userVisible: output.reply,
    internal: {
      core: {
        stage: 'turn-completed',
        confidence: 0.8,
        isCompleted: output.control.isCompletionCandidate,
      },
      ext: {
        teaching: output,
        // Internal canonical sidecar. Keep `teaching` unchanged for legacy consumers.
        teachingTurnOutcome: skillOutcome,
        promptDebug: result.debug,
      }
    },
    runtimeEnvelope: result.runtimeEnvelope,
    renderHints: {
      component: 'teaching-turn'
    },
    schemaVersion: 'agent-output-v1',
    metadata: {
      agentId: AGENT_ID,
      agentName: '教学回合 Skill',
      agentType: 'teaching',
      confidence: 0.8,
      generatedAt: new Date().toISOString(),
    }
  };
}
