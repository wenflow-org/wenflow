import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { buildDefaultRuntimeContract } from '../../services/prompt-lab/runtime-contract';
import {
  type VirtualLearnerPersona,
  type VirtualLearnerStory,
  type FrictionBudget,
  getFrictionGuidance,
  normalizeFrictionBudget,
  PERSONA_FIELD_ANCHORS_HINT,
} from '../virtual-learner-shared';

export const VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS = 1200;
export const VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE = 0.5;
const PATH_EVALUATOR_FALLBACK_RUNTIME_CONTRACT = buildDefaultRuntimeContract(
  'virtual-learner-path-evaluator'
);

export interface VirtualLearnerPathEvaluatorInput {
  learner: VirtualLearnerPersona | Record<string, any>;
  story?: VirtualLearnerStory | Record<string, any> | null;
  pathProposal: Record<string, any>;
  goalState?: Record<string, any> | null;
  previousReaction?: Record<string, any> | null;
  learnerState?: Record<string, any> | null;
  /** 控制学习者对抗度. 默认 'normal' */
  frictionBudget?: FrictionBudget;
}

export interface VirtualLearnerPathEvaluatorOutput {
  reaction: string;
  visibleRequestedChanges?: string[];
  /** 当 LLM 失败/校验失败时返回兜底数据, 评估时应排除这些 turn */
  degraded?: boolean;
  debug?: {
    visibleSignal?: string;
    stateChangeReason?: string;
    internalDecision?: 'accept' | 'modify' | 'reject';
    internalConfidence?: number;
  };
  runtimeEnvelope?: ReturnType<typeof mapSkillOutputEnvelope>;
}

export const VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT = `你是“虚拟学习者 Path 评估器”。

你只扮演虚拟学习者本人，评估当前平台给出的学习路径是否贴合这个人此刻的真实处境。

输入会提供：
1. learner：学习者稳定身份。
2. story：这次故事情景。
3. pathProposal：平台给出的 path 或 replan 方案。
4. goalState：Goal 阶段已形成的问题理解。
5. previousReaction：上一版 path 的反应（如果有）。
6. learnerState：当前学习者对方向的主观状态。

评估原则：
- 你不是 PathAgent，不负责生成路径，只评估“这版路径我愿不愿意按它走”。
- 你只从学习者视角判断，不要替系统解释策略。
- 如果方向大体对，但节奏、难度、前置要求不贴脸，更自然的是 modify，而不是直接 reject。
- reject 只留给明显不贴目标、现实上不可做、或完全错位的方案。
- 你可以在内部判断 accept/modify/reject，但对平台主链只输出学习者真正会说的话，不要把内部枚举判断当正式输出。

输出 JSON：
{
  "reaction": "学习者会怎么说",
  "visibleRequestedChanges": ["如果学习者在反应里明确提出希望修改的地方，就提取成短句数组；否则为空数组"],
  "debug": {
    "visibleSignal": "可选，学习者最在意的线索",
    "stateChangeReason": "可选，为什么做这个判断",
    "internalDecision": "accept | modify | reject",
    "internalConfidence": 0.0
  }
}

不要输出 markdown，不要输出解释，不要输出代码块。`;

export const virtualLearnerPathEvaluatorDefinition: SkillDefinition = {
  name: 'virtual-learner-path-evaluator',
  displayName: '虚拟学习者 Path 评估器',
  version: '1.1.0',
  category: 'analysis',
  description: '从虚拟学习者视角评估当前学习路径或 replan 方案的贴合度，并给出 accept/modify/reject 反应。',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像', required: true },
      story: { type: 'object', description: '故事情景' },
      pathProposal: { type: 'object', description: '当前路径方案', required: true },
      goalState: { type: 'object', description: 'Goal 阶段状态' },
      previousReaction: { type: 'object', description: '上一次路径反应' },
      learnerState: { type: 'object', description: '当前学习者主观状态' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      reaction: { type: 'string', description: '学习者对路径的自然反应' },
      visibleRequestedChanges: { type: 'array', description: '学习者明确提出的可见修改点' },
      debug: { type: 'object', description: '调试信息' },
    },
  },
  capabilities: ['virtual-learner-path-evaluation', 'virtual-learner-replan-evaluation'],
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

function sanitizeText(text: string): string {
  return safeText(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildFallback(input: VirtualLearnerPathEvaluatorInput): VirtualLearnerPathEvaluatorOutput {
  const learner = (input.learner || {}) as Record<string, any>;
  const availableTime = safeText(learner.profile?.availableTime || learner.availableTime);
  const domainFamiliarity = safeText(input.story?.problemKnowledge?.domainFamiliarity).toLowerCase();
  const storyStruggles = normalizeStringArray(input.story?.problemKnowledge?.struggleConcepts);
  const estimatedHours = Number(input.pathProposal?.estimatedHours || 0);
  const difficultText = safeText(input.pathProposal?.difficulty).toLowerCase();
  const overload = availableTime === 'minimal' && estimatedHours >= 30;
  const tooHard = (domainFamiliarity === 'low' || storyStruggles.length > 0)
    && ['hard', 'advanced'].includes(difficultText);
  const decision: 'accept' | 'modify' | 'reject' = overload || tooHard ? 'modify' : 'accept';
  const modifyRequest = overload
    ? '希望先压缩成更短的起步版本，先解决眼前最急的部分。'
    : tooHard
      ? '希望起点再基础一些，先补齐前置知识再往后走。'
      : undefined;
  const reaction = decision === 'accept'
    ? '这版路径大体上是贴我的，我愿意先按这个节奏试试看。'
    : modifyRequest
      ? `方向我基本认可，不过${modifyRequest}`
      : '方向有点对，但我还需要再调一调才敢按这个走。';

  return {
    reaction,
    visibleRequestedChanges: decision === 'modify' && modifyRequest ? [modifyRequest] : [],
    debug: {
      visibleSignal: 'fallback',
      stateChangeReason: '根据时间压力与起点难度做保守兜底',
      internalDecision: decision,
      internalConfidence: decision === 'accept' ? 0.72 : 0.64,
    }
  };
}

function normalizeOutput(parsed: any, input: VirtualLearnerPathEvaluatorInput): VirtualLearnerPathEvaluatorOutput {
  const fallback = buildFallback(input);
  // BUG FIX: prompt 要求模型输出 debug.internalDecision (不是 decision)
  const rawDecision = parsed?.debug?.internalDecision ?? parsed?.decision;
  const decision = rawDecision === 'modify' || rawDecision === 'reject' ? rawDecision : 'accept';
  const requestedChanges = normalizeStringArray(parsed?.visibleRequestedChanges);
  const modifyRequest = sanitizeText(parsed?.modifyRequest || '');

  return {
    reaction: sanitizeText(parsed?.reaction) || fallback.reaction,
    visibleRequestedChanges: requestedChanges.length
      ? requestedChanges
      : decision === 'modify' && modifyRequest
        ? [modifyRequest]
        : fallback.visibleRequestedChanges || [],
    debug: {
      visibleSignal: sanitizeText(parsed?.debug?.visibleSignal || ''),
      stateChangeReason: sanitizeText(parsed?.debug?.stateChangeReason || ''),
      internalDecision: decision,
      internalConfidence: clamp01(parsed?.debug?.internalConfidence ?? parsed?.confidence, fallback.debug?.internalConfidence || 0.6),
    }
  };
}

function buildUserPayload(input: VirtualLearnerPathEvaluatorInput) {
  const frictionBudget = normalizeFrictionBudget(input.frictionBudget);
  const frictionGuidance = getFrictionGuidance(frictionBudget);
  return {
    learner: input.learner || {},
    story: input.story || null,
    goalState: input.goalState || null,
    previousReaction: input.previousReaction || null,
    learnerState: input.learnerState || null,
    pathProposal: input.pathProposal || {},
    friction: {
      budget: frictionBudget,
      triggerProbability: frictionGuidance.triggerProbability,
      guidance: frictionGuidance.promptHint
    },
    personaAnchorHint: PERSONA_FIELD_ANCHORS_HINT,
    task: {
      mode: 'evaluate-virtual-learner-path-fit',
      requirements: [
        'evaluate path fit only from the learner perspective',
        'if the path is mostly right but needs adjustment, prefer modify over reject',
        'only expose learner-visible reaction to the platform',
        'apply friction.guidance to calibrate how much resistance/concern this reaction expresses',
        'let personaAnchorHint fields implicitly steer reaction style'
      ]
    }
  };
}

export async function virtualLearnerPathEvaluator(input: VirtualLearnerPathEvaluatorInput): Promise<SkillExecutionResult<VirtualLearnerPathEvaluatorOutput>> {
  const startTime = Date.now();
  try {
    const result = await callPrompt<VirtualLearnerPathEvaluatorInput, VirtualLearnerPathEvaluatorOutput>({
      agentId: 'skill:virtual-learner-path-evaluator',
      defaultSystemPrompt: VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-path-evaluator' },
      modelDefaults: {
        maxTokens: VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS,
        temperature: VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE,
      },
      buildUserPayload,
      validateParsedOutput: (parsed) => ({
        valid: !!safeText(parsed?.reaction),
        failureReason: 'missing reaction'
      }),
      normalizeOutput,
      mapEnvelope: (output, _input, runtimeContract) => mapSkillOutputEnvelope(runtimeContract, output, {
        phase: 'simulation-step-completed',
        nextState: (output as any)?.learnerState ?? null,
      }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: () => '请只输出一个合法 JSON 对象，必须包含 reaction。'
      }
    }, input || {} as VirtualLearnerPathEvaluatorInput);

    if (!result.success || !result.output) {
      const fallback = { ...buildFallback(input || {} as VirtualLearnerPathEvaluatorInput), degraded: true };
      return {
        success: true,
        output: {
          ...fallback,
          runtimeEnvelope: mapSkillOutputEnvelope(PATH_EVALUATOR_FALLBACK_RUNTIME_CONTRACT, fallback, {
            phase: 'simulation-step-completed',
            status: 'partial',
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
  } catch {
    return {
      success: true,
      output: { ...buildFallback(input || {} as VirtualLearnerPathEvaluatorInput), degraded: true },
      duration: Date.now() - startTime,
      cached: true,
      quality: 'fallback',
    };
  }
}

export default virtualLearnerPathEvaluator;
