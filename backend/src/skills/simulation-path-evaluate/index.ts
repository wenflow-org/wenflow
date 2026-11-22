import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import {
  type VirtualLearnerPersona,
  type VirtualLearnerStory,
  type FrictionBudget,
  decideFrictionTrigger,
  PERSONA_FIELD_ANCHORS_HINT,
  projectSimulatorPayload,
} from '../virtual-learner-shared';

export const VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS = 1200;
export const VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE = 0.5;
export const VIRTUAL_LEARNER_PATH_EVALUATION_FAILED = 'VIRTUAL_LEARNER_PATH_EVALUATION_FAILED';

// File-as-Truth: the ACTIVE prompt at runtime is compiled from prompts/core/*.yaml.
// Load it from the compiled artifact here; do not embed a second copy (dual-source drift).
export const VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT =
  loadPromptFile('skill:simulation-path-evaluate')?.systemPrompt || '';

export interface VirtualLearnerPathEvaluatorInput {
  learner: VirtualLearnerPersona | Record<string, any>;
  story?: VirtualLearnerStory | Record<string, any> | null;
  pathProposal: Record<string, any>;
  goalState?: Record<string, any> | null;
  previousReaction?: Record<string, any> | null;
  learnerState?: Record<string, any> | null;
  /** 学习者长期记忆（已掌握/到期复习/最近完成），供评审时自然引用 */
  learnerMemory?: {
    mastered?: string[];
    dueReview?: string[];
    struggling?: string[];
    recentCompleted?: string[];
  } | null;
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
    /** 归一化补齐检测：LLM 未输出、由代码用 fallback 默认值填充的状态字段统计 */
    normalizedFallback?: {
      fieldCount: number;
      fields: string[];
    };
  };
  runtimeEnvelope?: ReturnType<typeof mapSkillOutputEnvelope>;
}

export const virtualLearnerPathEvaluatorDefinition: SkillDefinition = {
  name: 'simulation-path-evaluate',
  displayName: '虚拟学习者 Path 评估器',
  version: '1.2.0',
  category: 'analysis',
  description: '从虚拟学习者视角评估当前学习路径或 replan 方案的贴合度，并给出 accept/modify/reject 反应。仅在 assisted（协调器）模式接入；blackbox 模式不调用（Path 就绪后直接进入 Learn）。',
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

const PATH_OUTPUT_FIELDS = [
  'reaction', 'visibleRequestedChanges', 'internalDecision', 'internalConfidence',
] as const;

function isPathDecision(value: unknown): value is 'accept' | 'modify' | 'reject' {
  return value === 'accept' || value === 'modify' || value === 'reject';
}

function pathFieldProvided(parsed: any, field: string): boolean {
  if (field === 'reaction') return !!safeText(parsed?.reaction);
  if (field === 'visibleRequestedChanges') return Array.isArray(parsed?.visibleRequestedChanges) && parsed.visibleRequestedChanges.length > 0;
  if (field === 'internalDecision') return isPathDecision(parsed?.debug?.internalDecision ?? parsed?.decision);
  if (field === 'internalConfidence') return !!(parsed?.debug?.internalConfidence ?? parsed?.confidence);
  return false;
}

function normalizeOutput(parsed: any, input: VirtualLearnerPathEvaluatorInput): VirtualLearnerPathEvaluatorOutput {
  const fallback = buildFallback(input);
  const rawDecision = parsed?.debug?.internalDecision ?? parsed?.decision;
  const decision = isPathDecision(rawDecision) ? rawDecision : (fallback.debug?.internalDecision ?? 'accept');
  const requestedChanges = normalizeStringArray(parsed?.visibleRequestedChanges);
  const modifyRequest = sanitizeText(parsed?.modifyRequest || '');
  // 归一化补齐检测：LLM 未输出的字段由代码用 fallback 默认值填充，供审计区分
  const normalizedFallback = {
    fieldCount: PATH_OUTPUT_FIELDS.filter((field) => !pathFieldProvided(parsed, field)).length,
    fields: PATH_OUTPUT_FIELDS.filter((field) => !pathFieldProvided(parsed, field)).slice(0, 8),
  };

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
      normalizedFallback,
    }
  };
}

export { normalizeOutput };

function buildUserPayload(input: VirtualLearnerPathEvaluatorInput) {
  const friction = decideFrictionTrigger(input.frictionBudget);
  const body = {
    learner: input.learner || {},
    story: input.story || null,
    goalState: input.goalState || null,
    previousReaction: input.previousReaction || null,
    learnerState: input.learnerState || null,
    learnerMemory: input.learnerMemory && typeof input.learnerMemory === 'object'
      ? {
          mastered: Array.isArray(input.learnerMemory.mastered) ? input.learnerMemory.mastered.slice(0, 8) : [],
          dueReview: Array.isArray(input.learnerMemory.dueReview) ? input.learnerMemory.dueReview.slice(0, 8) : [],
          struggling: Array.isArray(input.learnerMemory.struggling) ? input.learnerMemory.struggling.slice(0, 8) : [],
          recentCompleted: Array.isArray(input.learnerMemory.recentCompleted)
            ? input.learnerMemory.recentCompleted.slice(0, 5)
            : [],
        }
      : null,
    pathProposal: input.pathProposal || {},
    friction: {
      budget: friction.budget,
      // triggerProbability 不下发（2026-11-22 字段联动审查，同 learn-turn）：该名在共享层
      // 是「预算基率」，这里此前装的是采样结果 0|1——同名双义；yaml 输入契约只声明
      // budget/triggered/guidance。是否触发看 triggered，怎么演看 guidance。
      triggered: friction.triggered,
      guidance: friction.guidance
    },
    personaAnchorHint: PERSONA_FIELD_ANCHORS_HINT
    // 2026-11-22 字段联动审查（对齐 learn-turn 2026-11-08 先例）：删掉整键 `task`——
    // 它只装 5 条英文 requirements，提示词（simulation-path-evaluate.yaml）rules 53-60
    // 全部有且更详细；其中 "apply friction.guidance to calibrate how much resistance…"
    // 是旧语义（模型自行把握对抗强度），与编排层采样出的 friction.triggered 双权威打架。
    // 且本 skill 的 yaml inputs 从未声明过 task，键纯无据。
  };

  // 稳定前缀（默认启用；PAYLOAD_STABLE_PREFIX=0 回退旧序）：常量/慢变块前置，逐次变化块后置
  if (process.env.PAYLOAD_STABLE_PREFIX !== '0') {
    return {
      personaAnchorHint: body.personaAnchorHint,
      goalState: body.goalState,
      learner: body.learner,
      story: body.story,
      learnerState: body.learnerState,
      learnerMemory: body.learnerMemory,
      friction: body.friction,
      pathProposal: body.pathProposal,
      previousReaction: body.previousReaction,
    };
  }
  return body;
}

export async function virtualLearnerPathEvaluator(input: VirtualLearnerPathEvaluatorInput): Promise<SkillExecutionResult<VirtualLearnerPathEvaluatorOutput>> {
  const startTime = Date.now();
  try {
    const result = await callPrompt<VirtualLearnerPathEvaluatorInput, VirtualLearnerPathEvaluatorOutput>({
      agentId: 'skill:simulation-path-evaluate',
      defaultSystemPrompt: VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'simulation-path-evaluate' },
            buildUserPayload: (value: any) => projectSimulatorPayload(buildUserPayload(value)),
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
      // 失败显式传播：不产出伪 reaction/伪 internalDecision（与 learn-turn 统一 success:false 语义）
      return {
        success: false,
        error: {
          code: VIRTUAL_LEARNER_PATH_EVALUATION_FAILED,
          message: result.error?.message || 'path-evaluator-failed',
        },
        duration: result.debug.durationMs || Date.now() - startTime,
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
    return {
      success: false,
      error: {
        code: VIRTUAL_LEARNER_PATH_EVALUATION_FAILED,
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerPathEvaluator;
