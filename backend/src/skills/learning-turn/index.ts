import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { PromptCallSpec } from '../../composers/types';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../../agents/protocol';
import { evaluateByCriteria, evaluateByProfile } from '../../skills/acceptance-evidence-evaluator';
import { getFallbackStrategies, normalizeStrategy, buildGuidancePrompt } from '../../skills/learning-strategy-selector';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { buildSkillOutcome, type SkillOutcome } from '../outcome';

const AGENT_ID = 'skill:learning-turn';

type MessageRole = 'user' | 'assistant' | 'system';

const ALLOWED_COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
const ALLOWED_EMOTIONAL_STATES = ['positive', 'neutral', 'frustrated', 'confused'] as const;
const ALLOWED_KNOWLEDGE_STATUSES = ['pending', 'learning', 'mastered', 'review'] as const;

export interface LearningTurnInput {
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
}

export interface LearningTurnOutput {
  reply: string;
  analysis: {
    cognitiveLevel: string;
    levelScore: number;
    understanding: number;
    confusionPoints: string[];
    engagement: number;
    emotionalState: string;
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
export type LearningTurnArtifact = LearningTurnOutput;

/**
 * Phase 2 internal canonical sidecar.
 * Coordinator 仍负责知识状态合并和持久化，所以不在此阶段声明 transition。
 */
export function toLearningTurnSkillOutcome(
  artifact: LearningTurnArtifact,
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope> | null,
): SkillOutcome<LearningTurnArtifact> {
  return buildSkillOutcome({
    skillId: AGENT_ID,
    artifact,
    quality: 'model',
    runtimeEnvelope: runtimeEnvelope || null,
    transition: null,
  });
}

export const learningTurnAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '学习回合 Skill',
  version: '1.0.0',
  type: 'teaching',
  category: 'standard',
  description: '根据课堂上下文生成本轮教学回复与结构化教学状态',
  capabilities: [
    'learning-turn-generation',
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

function buildStrategyGuidancePrompt(input: LearningTurnInput): string | null {
  return buildGuidancePrompt(input.scenario.teachingStrategyGuidance);
}

function buildTaskExecutionPrompt(input: LearningTurnInput): string {
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

function deriveFallbackStrategies(input: LearningTurnInput): string[] {
  return getFallbackStrategies(input.scenario.taskProfile?.knowledgeType);
}

function filterOverlyBroadKnowledgePoints(points: Array<{ name: string; status: 'pending' | 'learning' | 'mastered' | 'review'; progress: number }>, input: LearningTurnInput) {
  const coreConcept = normalizeConceptName(input.scenario.taskProfile?.coreConcept || input.scenario.taskProfile?.linkedConceptName || '');
  const hasFinerPrimaryConcept = points.some((point) => normalizeConceptName(point.name) && normalizeConceptName(point.name) !== coreConcept);

  if (!coreConcept || !hasFinerPrimaryConcept) {
    return points;
  }

  const filtered = points.filter((point) => normalizeConceptName(point.name) !== coreConcept);
  return filtered.length > 0 ? filtered : points;
}
function normalizeOutput(parsed: Record<string, any>, input: LearningTurnInput): LearningTurnOutput {
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
    logger.warn('[LearningTurnAgent] 检测到非法 pedagogy.strategies，已自动回退到默认策略', {
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
    logger.warn('[LearningTurnAgent] completionCandidate 被验收证据门槛拦截', {
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
function normalizeCheckpoint(value: Record<string, any>): NonNullable<LearningTurnOutput['control']['checkpoint']> {
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

function buildPromptInput(input: LearningTurnInput) {
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
    promptDirectives: {
      ...(strategyGuidancePrompt ? { strategyGuidance: strategyGuidancePrompt } : {}),
      taskExecution: taskExecutionPrompt,
    },
  };
}

function evaluateAcceptanceCriteriaEvidence(input: LearningTurnInput) {
  return evaluateByCriteria({
    messages: input.messages,
    acceptanceCriteria: input.scenario.currentTaskContext?.acceptanceCriteria,
    mode: 'criteria'
  });
}

function evaluateCompletionByTaskProfile(input: LearningTurnInput) {
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

function validateLearningTurnOutput(parsed: any, input: LearningTurnInput) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, failureReason: 'LEARNING_TURN_OUTPUT_NOT_OBJECT' };
  }

  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { valid: false, failureReason: 'LEARNING_TURN_REPLY_MISSING' };
  }

  if (!parsed.analysis || typeof parsed.analysis !== 'object' || !parsed.knowledge || typeof parsed.knowledge !== 'object' || !parsed.pedagogy || typeof parsed.pedagogy !== 'object' || !parsed.control || typeof parsed.control !== 'object') {
    return { valid: false, failureReason: 'LEARNING_TURN_REQUIRED_BLOCK_MISSING' };
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
    return { valid: false, failureReason: 'LEARNING_TURN_REPLY_COMPLETION_MISMATCH' };
  }

  return { valid: true };
}

const learningTurnPromptSpec: PromptCallSpec<LearningTurnInput, LearningTurnOutput> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: '',
  requireActivePrompt: true,
  caller: {
    agentId: 'learning-agent',
    skillId: 'learning-turn',
  },
  buildUserPayload: (input) => buildPromptInput(input),
  normalizeOutput: (parsed, input) => normalizeOutput(parsed, input),
  validateParsedOutput: (parsed, input) => validateLearningTurnOutput(parsed, input),
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

export async function learningTurnAgentHandler(input: LearningTurnInput): Promise<AgentOutput> {
  try {
    const result = await callPrompt(learningTurnPromptSpec, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'LEARNING_TURN_OUTPUT_INVALID');
    }

    const output = result.output;
    const skillOutcome = toLearningTurnSkillOutcome(output, result.runtimeEnvelope);
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
          learningTurnOutcome: skillOutcome,
          promptDebug: result.debug,
        }
      },
      runtimeEnvelope: result.runtimeEnvelope,
      renderHints: {
        component: 'learning-turn'
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
  } catch (error) {
    logger.error('[LearningTurnAgent] 执行失败', { error });
    return {
      success: false,
      userVisible: '这一轮教学内容生成失败，请稍后重试。',
      error: {
        code: 'LEARNING_TURN_FAILED',
        message: error instanceof Error ? error.message : String(error)
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '教学回合 Skill',
        agentType: 'teaching',
        confidence: 0,
        generatedAt: new Date().toISOString(),
      }
    };
  }
}
