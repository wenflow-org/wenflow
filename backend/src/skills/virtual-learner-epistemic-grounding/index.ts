import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { projectSimulatorPayload } from '../virtual-learner-shared';

export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_MAX_TOKENS = 800;
export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_TEMPERATURE = 0.3;
export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED = 'VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED';

// File-as-Truth: the ACTIVE prompt at runtime is compiled from prompts/core/*.yaml.
export const VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_PROMPT =
  loadPromptFile('skill:virtual-learner-epistemic-grounding')?.systemPrompt || '';

export interface EpistemicGrounding {
  sampledCorrectness: boolean;
  blockedConcept: string | null;
  errorPattern: string | null;
  masteryProb: number;
}

export interface EpistemicGroundingInput {
  learner: Record<string, any>;
  currentTask?: { title?: string | null; description?: string | null } | null;
  knowledgeSnapshot?: Array<{ name: string; status?: string; progress?: number }>;
  previousLearnerState?: Record<string, any> | null;
  /** 编排层受控错误指令（decideControlledError 采样命中时传入，判决必须服从） */
  forcedCorrectness?: { forced: boolean; targetConcept: string | null; hint: string | null } | null;
  /**
   * 学习者可见的对话上下文（P1-7）：判决"本轮能否做对当前这一步"必须看到教师本轮实际讲了什么——
   * 此前 payload 无对话历史/教师最新消息，判决对象是模型从未见过的"这一步"。
   */
  visibleContext?: {
    history?: Array<{ role?: string; content?: string }>;
    lastTeacherMessage?: string | null;
  } | null;
}

function clamp01(value: any, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function safeText(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGrounding(parsed: any): EpistemicGrounding {
  const g = parsed?.epistemicGrounding && typeof parsed.epistemicGrounding === 'object'
    ? parsed.epistemicGrounding
    : {};
  return {
    sampledCorrectness: typeof g.sampledCorrectness === 'boolean' ? g.sampledCorrectness : false,
    blockedConcept: typeof g.blockedConcept === 'string' ? g.blockedConcept.trim() || null : null,
    errorPattern: typeof g.errorPattern === 'string' ? g.errorPattern.trim() || null : null,
    masteryProb: clamp01(g.masteryProb, 0.5),
  };
}

function buildVisibleContextProjection(
  input: EpistemicGroundingInput['visibleContext']
): { history: Array<{ role: 'teacher' | 'learner'; content: string }>; lastTeacherMessage: string } | null {
  if (!input || typeof input !== 'object') return null;
  const history = Array.isArray(input.history)
    ? input.history
        .map((message) => ({
          role: message?.role === 'teacher' ? 'teacher' as const : 'learner' as const,
          content: safeText(message?.content).slice(0, 400),
        }))
        .filter((message) => message.content)
        .slice(-6)
    : [];
  const lastTeacherMessage = safeText(input.lastTeacherMessage)
    || [...history].reverse().find((message) => message.role === 'teacher')?.content
    || '';
  if (!history.length && !lastTeacherMessage) return null;
  return { history, lastTeacherMessage };
}

function buildUserPayload(input: EpistemicGroundingInput) {
  // 缓存前缀优化：learner 里逐回合被回写的概念数组（knownConcepts/struggleConcepts，含 profile 内副本）
  // 移到 payload 尾部，稳定画像（profile/learningGoal/personalityTraits 等）前置——否则首个键即变化，前缀缓存全灭
  const learnerSrc = (input.learner && typeof input.learner === 'object' ? input.learner : {}) as Record<string, any>;
  const { knownConcepts, struggleConcepts, ...learnerRest } = learnerSrc;
  const learnerProfileSrc = learnerRest.profile && typeof learnerRest.profile === 'object'
    ? { ...(learnerRest.profile as Record<string, any>) }
    : null;
  if (learnerProfileSrc) {
    delete learnerProfileSrc.knownConcepts;
    delete learnerProfileSrc.struggleConcepts;
  }
  const stableLearner: Record<string, any> = { ...learnerRest };
  if (learnerProfileSrc) stableLearner.profile = learnerProfileSrc;
  // P1-7：可见对话上下文（逐回合变化）放尾部缓存区，稳定画像仍前置
  const visibleContext = buildVisibleContextProjection(input.visibleContext);
  return {
    learner: stableLearner,
    currentTask: input.currentTask || null,
    knownConcepts: Array.isArray(knownConcepts) ? knownConcepts : [],
    struggleConcepts: Array.isArray(struggleConcepts) ? struggleConcepts : [],
    knowledgeSnapshot: Array.isArray(input.knowledgeSnapshot) ? input.knowledgeSnapshot.slice(0, 5) : [],
    previousLearnerState: input.previousLearnerState || null,
    ...(visibleContext ? { visibleContext } : {}),
    // 编排层硬指令放 payload 尾部（与逐轮变化的概念数组同区，保住稳定画像的前缀缓存）
    ...(input.forcedCorrectness?.forced ? { forcedCorrectness: input.forcedCorrectness } : {}),
  };
}

export const virtualLearnerEpistemicGroundingDefinition: SkillDefinition = {
  name: 'virtual-learner-epistemic-grounding',
  displayName: '虚拟学习者认知判决器',
  version: '1.0.0',
  category: 'generation',
  description: '基于学习者画像掌握度，对本轮能否做对当前步骤做离散认知判决（BEAGLE Strategist 段，物理两阶段第一段）。',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像（含掌握度描述）', required: true },
      currentTask: { type: 'object', description: '当前 task 信息' },
      knowledgeSnapshot: { type: 'array', description: '当前任务知识看板' },
      previousLearnerState: { type: 'object', description: '上一轮学习者主观状态' },
      visibleContext: { type: 'object', description: '学习者可见的对话上下文（history + lastTeacherMessage）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      epistemicGrounding: { type: 'object', description: '本轮认知判决（sampledCorrectness/blockedConcept/errorPattern/masteryProb）' },
    },
  },
  capabilities: ['learner-epistemic-grounding', 'competency-bias-mitigation'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

export async function virtualLearnerEpistemicGrounding(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:virtual-learner-epistemic-grounding',
      defaultSystemPrompt: VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-epistemic-grounding' },
      buildUserPayload: (value: any) => projectSimulatorPayload(buildUserPayload(value)),
      validateParsedOutput: (parsed: any) => {
        const g = parsed?.epistemicGrounding;
        const ok = g && typeof g === 'object' && typeof g.sampledCorrectness === 'boolean';
        return {
          valid: ok,
          failureReason: ok ? undefined : 'missing epistemicGrounding.sampledCorrectness',
        };
      },
      normalizeOutput: (parsed: any) => ({ epistemicGrounding: normalizeGrounding(parsed) }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) => `上一次输出失败：${failureReason}。请只返回一个完整、可解析的 JSON 对象；不要 markdown，不要代码块，不要解释。`,
      },
    }, input || {}, { userId: (input as any)?.routingUserId || undefined });

    if (!result.success || !result.output) {
      return {
        success: false,
        error: {
          code: VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED,
          message: result.error?.message || 'epistemic-grounding-failed',
        },
        duration: result.debug.durationMs || 0,
      };
    }

    return {
      success: true,
      output: {
        ...result.output,
        _debug: {
          rawModelOutput: result.debug.rawModelOutput,
          extractedJson: result.debug.extractedJson,
          userPayload: result.debug.userPayload,
          systemPromptVersion: result.debug.systemPromptVersion,
        },
      },
      duration: result.debug.durationMs,
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: VIRTUAL_LEARNER_EPISTEMIC_GROUNDING_FAILED,
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerEpistemicGrounding;
