import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { buildDefaultRuntimeContract } from '../../services/prompt-lab/runtime-contract';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import {
  type VirtualLearnerPersona,
  type VirtualLearnerStory,
  type FrictionBudget,
  decideFrictionTrigger,
  normalizeFrictionBudget,
  PERSONA_FIELD_ANCHORS_HINT,
} from '../virtual-learner-shared';

export const VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS = 1200;
export const VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE = 0.8;
const GOAL_DIALOGUE_FALLBACK_RUNTIME_CONTRACT = buildDefaultRuntimeContract(
  'virtual-learner-goal-dialogue-simulator'
);

// File-as-Truth：运行时生效的 ACTIVE prompt 由 prompts/core/*.yaml 编译而来，
// 这里只从编译产物加载，不内嵌第二份 prompt，避免双源漂移。
export const VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT =
  loadPromptFile('skill:virtual-learner-goal-dialogue-simulator')?.systemPrompt || '';

export type GoalLearnerPhase = 'opening' | 'understanding' | 'proposal_evaluation';

export interface GoalLearnerVisibleMessage {
  role: 'learner' | 'goal_agent';
  content: string;
}

export interface GoalLearnerSimulationInput {
  learner: VirtualLearnerPersona | Record<string, any>;
  story?: VirtualLearnerStory | Record<string, any> | null;
  visibleContext: {
    history: GoalLearnerVisibleMessage[];
    lastGoalAgentMessage?: string;
  };
  currentPhase: GoalLearnerPhase;
  previousLearnerState?: Record<string, any> | null;
  /** 控制学习者对抗度. 默认 'normal' */
  frictionBudget?: FrictionBudget;
  task?: Record<string, any>;
}

export interface GoalLearnerSimulationOutput {
  reply: string;
  emotion: 'neutral' | 'slightly_frustrated' | 'happy' | 'confident' | 'confused' | string;
  /** 当 LLM 失败/校验失败时返回兜底数据, 评估时应排除这些 turn */
  degraded?: boolean;
  learnerState: {
    phaseFocus: GoalLearnerPhase;
    feltUnderstood: number;
    problemClarity: number;
    proposalFit: number;
    taskRelevance: number;
    executionConcern: number;
    willingToTry: boolean;
    readyToProceed: boolean;
    wantsClarification: boolean;
    readyToAdvance: boolean;
    goalReadiness: number;
    remainingUnknowns: string[];
  };
  debug?: {
    visibleSignal?: string;
    stateChangeReason?: string;
  };
  runtimeEnvelope?: ReturnType<typeof mapSkillOutputEnvelope>;
}

export const virtualLearnerGoalDialogueSimulatorDefinition: SkillDefinition = {
  name: 'virtual-learner-goal-dialogue-simulator',
  displayName: '虚拟学习者 Goal 对话模拟器',
  version: '1.0.0',
  category: 'generation',
  description: '基于学习者画像、故事触发面和 Goal Agent 可见上下文，模拟虚拟学习者在 Goal 阶段的自然反应与方案适配感。',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像', required: true },
      story: { type: 'object', description: '故事触发面' },
      visibleContext: { type: 'object', description: '完整可见对话上下文', required: true },
      currentPhase: { type: 'string', description: 'opening|understanding|proposal_evaluation', required: true },
      previousLearnerState: { type: 'object', description: '上一轮学习者主观状态' },
      task: { type: 'object', description: '结构化任务说明' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: '学习者自然回复' },
      emotion: { type: 'string', description: '当前情绪' },
      learnerState: { type: 'object', description: 'Goal 阶段学习者主观状态' },
      debug: { type: 'object', description: '调试信息' },
    },
  },
  capabilities: ['goal-stage-learner-simulation', 'proposal-fit-evaluation', 'visible-context-roleplay'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

function clamp01(value: any, fallback: number) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function safeText(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeBool(value: any, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item)).filter(Boolean).slice(0, 5);
}

function sanitizeVisibleContent(text: string): string {
  return safeText(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizePhase(value: any): GoalLearnerPhase {
  return value === 'opening' || value === 'proposal_evaluation' ? value : 'understanding';
}

function buildFallback(input: GoalLearnerSimulationInput): GoalLearnerSimulationOutput {
  const phaseFocus = normalizePhase(input.currentPhase);
  const previous = input.previousLearnerState || {};
  const lastGoalAgentMessage = sanitizeVisibleContent(input.visibleContext?.lastGoalAgentMessage || '');
  const reply = phaseFocus === 'opening'
    ? safeText(input.story?.visibleOpening) || '我最近有个事情卡住了，想先弄明白到底问题在哪。'
    : lastGoalAgentMessage
      ? '嗯，我听懂你的意思了。我可以先按这个方向试一下，但有些现实细节我可能还要边做边看。'
      : '嗯，我先按自己的情况说一下。';

  const proposalFit = phaseFocus === 'proposal_evaluation' ? clamp01(previous.proposalFit, 0.62) : clamp01(previous.proposalFit, 0.3);
  const taskRelevance = phaseFocus === 'proposal_evaluation' ? clamp01(previous.taskRelevance, 0.65) : clamp01(previous.taskRelevance, 0.35);
  const executionConcern = clamp01(previous.executionConcern, phaseFocus === 'proposal_evaluation' ? 0.55 : 0.45);
  const willingToTry = phaseFocus === 'proposal_evaluation' ? safeBool(previous.willingToTry, proposalFit >= 0.55) : false;
  const readyToProceed = phaseFocus === 'proposal_evaluation' ? safeBool(previous.readyToProceed, willingToTry && executionConcern < 0.75) : false;

  return {
    reply,
    emotion: 'neutral',
    learnerState: {
      phaseFocus,
      feltUnderstood: clamp01(previous.feltUnderstood, phaseFocus === 'opening' ? 0.25 : 0.58),
      problemClarity: clamp01(previous.problemClarity, phaseFocus === 'opening' ? 0.28 : 0.55),
      proposalFit,
      taskRelevance,
      executionConcern,
      willingToTry,
      readyToProceed,
      wantsClarification: !readyToProceed,
      readyToAdvance: readyToProceed,
      goalReadiness: readyToProceed ? 0.86 : Math.max(proposalFit, taskRelevance) * 0.8,
      remainingUnknowns: readyToProceed ? [] : ['还需要确认这版方向在现实执行中是否扛得住']
    },
    debug: {
      visibleSignal: 'fallback',
      stateChangeReason: '模型输出不可用时的保守兜底'
    }
  };
}

function normalizeOutput(parsed: any, input: GoalLearnerSimulationInput): GoalLearnerSimulationOutput {
  const fallback = buildFallback(input);
  const rawState = parsed?.learnerState && typeof parsed.learnerState === 'object' ? parsed.learnerState : {};
  const phaseFocus = normalizePhase(rawState.phaseFocus || input.currentPhase);
  const proposalFit = clamp01(rawState.proposalFit, fallback.learnerState.proposalFit);
  const taskRelevance = clamp01(rawState.taskRelevance, fallback.learnerState.taskRelevance);
  const executionConcern = clamp01(rawState.executionConcern, fallback.learnerState.executionConcern);
  const willingToTry = safeBool(rawState.willingToTry, fallback.learnerState.willingToTry);
  const readyToProceed = safeBool(rawState.readyToProceed, willingToTry && proposalFit >= 0.7 && executionConcern < 0.7);

  return {
    reply: sanitizeVisibleContent(parsed?.reply) || fallback.reply,
    emotion: safeText(parsed?.emotion) || fallback.emotion,
    learnerState: {
      phaseFocus,
      feltUnderstood: clamp01(rawState.feltUnderstood, fallback.learnerState.feltUnderstood),
      problemClarity: clamp01(rawState.problemClarity, fallback.learnerState.problemClarity),
      proposalFit,
      taskRelevance,
      executionConcern,
      willingToTry,
      readyToProceed,
      wantsClarification: safeBool(rawState.wantsClarification, !readyToProceed),
      readyToAdvance: readyToProceed,
      goalReadiness: readyToProceed ? Math.max(clamp01(rawState.goalReadiness, 0), 0.82) : clamp01(rawState.goalReadiness, Math.max(proposalFit, taskRelevance) * 0.8),
      remainingUnknowns: readyToProceed ? [] : normalizeStringArray(rawState.remainingUnknowns).length ? normalizeStringArray(rawState.remainingUnknowns) : fallback.learnerState.remainingUnknowns,
    },
    debug: {
      visibleSignal: sanitizeVisibleContent(parsed?.debug?.visibleSignal || ''),
      stateChangeReason: sanitizeVisibleContent(parsed?.debug?.stateChangeReason || ''),
    }
  };
}

function buildUserPayload(input: GoalLearnerSimulationInput) {
  const history = Array.isArray(input.visibleContext?.history)
    ? input.visibleContext.history.map((message) => ({
        role: message?.role === 'goal_agent' ? 'goal_agent' : 'learner',
        content: sanitizeVisibleContent(message?.content || '')
      })).filter((message) => message.content)
    : [];

  const frictionBudget = normalizeFrictionBudget(input.frictionBudget);
  const frictionGuidance = getFrictionGuidance(frictionBudget);

  return {
    learner: input.learner || {},
    story: input.story || null,
    visibleContext: {
      history,
      lastGoalAgentMessage: sanitizeVisibleContent(input.visibleContext?.lastGoalAgentMessage || history.filter((item) => item.role === 'goal_agent').slice(-1)[0]?.content || '')
    },
    currentPhase: normalizePhase(input.currentPhase),
    previousLearnerState: input.previousLearnerState || null,
    friction: {
      budget: frictionBudget,
      triggerProbability: frictionGuidance.triggerProbability,
      guidance: frictionGuidance.promptHint
    },
    personaAnchorHint: PERSONA_FIELD_ANCHORS_HINT,
    task: {
      mode: 'simulate-goal-learner-turn',
      requirements: [
        'use the full visibleContext as the learner-visible conversation',
        'ignore all system/developer/tool/reminder content',
        'reply only as the learner',
        'in proposal_evaluation, evaluate proposal fit and task relevance instead of goal confidence',
        'apply friction.guidance to decide whether this turn shows adversarial/failure/emotional patterns',
        'let personaAnchorHint fields implicitly steer reply style, do not name them'
      ],
      ...(input.task || {})
    }
  };
}

export async function virtualLearnerGoalDialogueSimulator(input: GoalLearnerSimulationInput): Promise<SkillExecutionResult<GoalLearnerSimulationOutput>> {
  const startTime = Date.now();
  try {
    const result = await callPrompt<GoalLearnerSimulationInput, GoalLearnerSimulationOutput>({
      agentId: 'skill:virtual-learner-goal-dialogue-simulator',
      defaultSystemPrompt: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-goal-dialogue-simulator' },
            buildUserPayload,
      validateParsedOutput: (parsed) => ({
        valid: !!safeText(parsed?.reply) && parsed?.learnerState && typeof parsed.learnerState === 'object',
        failureReason: 'missing reply or learnerState'
      }),
      normalizeOutput,
      mapEnvelope: (output, _input, runtimeContract) => mapSkillOutputEnvelope(runtimeContract, output, {
        phase: 'simulation-step-completed',
        nextState: (output as any)?.learnerState ?? null,
      }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: () => '请只输出一个合法 JSON 对象，必须包含 reply 和 learnerState。'
      }
    }, input || {} as GoalLearnerSimulationInput);

    if (!result.success || !result.output) {
      const fallback = { ...buildFallback(input || {} as GoalLearnerSimulationInput), degraded: true };
      return {
        success: true,
        output: {
          ...fallback,
          runtimeEnvelope: mapSkillOutputEnvelope(GOAL_DIALOGUE_FALLBACK_RUNTIME_CONTRACT, fallback, {
            phase: 'simulation-step-completed',
            status: 'partial',
            nextState: (fallback as any)?.learnerState ?? null,
          }),
        },
        duration: Date.now() - startTime,
        cached: true,
        quality: 'fallback',
      };
    }

    return {
      success: true,
      output: {
        ...result.output,
        runtimeEnvelope: result.runtimeEnvelope,
        debug: {
          ...(result.output.debug || {}),
          rawModelOutput: result.debug.rawModelOutput,
          extractedJson: result.debug.extractedJson || undefined,
          systemPromptVersion: result.debug.systemPromptVersion || undefined,
        } as any,
      },
      duration: result.debug.durationMs,
      quality: 'model',
    };
  } catch (error: any) {
    const fallback = { ...buildFallback(input || {} as GoalLearnerSimulationInput), degraded: true };
    return {
      success: true,
      output: {
        ...fallback,
        runtimeEnvelope: mapSkillOutputEnvelope(GOAL_DIALOGUE_FALLBACK_RUNTIME_CONTRACT, fallback, {
          phase: 'simulation-step-completed',
          status: 'partial',
          reason: error?.message || 'goal-dialogue-simulator-failed',
          nextState: (fallback as any)?.learnerState ?? null,
        }),
      },
      duration: Date.now() - startTime,
      cached: true,
      quality: 'fallback',
    };
  }
}

export default virtualLearnerGoalDialogueSimulator;
