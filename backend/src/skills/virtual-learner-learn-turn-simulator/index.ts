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
import type { EpistemicGrounding } from '../virtual-learner-epistemic-grounding';

export const VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS = 800;
export const VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE = 0.7;
export const VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED = 'VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED';

// File-as-Truth: the ACTIVE prompt at runtime is compiled from prompts/core/*.yaml.
// Load it from the compiled artifact here; do not embed a second copy (dual-source drift).
export const VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT =
  loadPromptFile('skill:virtual-learner-learn-turn-simulator')?.systemPrompt || '';

export type LearnLearnerPhase = 'trying' | 'blocked' | 'verifying' | 'ready_to_close';

export interface LearnLearnerVisibleMessage {
  role: 'learner' | 'teacher';
  content: string;
}

export interface LearnLearnerSimulationInput {
  learner: VirtualLearnerPersona | Record<string, any>;
  story?: VirtualLearnerStory | Record<string, any> | null;
  visibleContext: {
    history: LearnLearnerVisibleMessage[];
    lastTeacherMessage?: string;
  };
  currentPhase: LearnLearnerPhase;
  previousLearnerState?: Record<string, any> | null;
  currentTask?: {
    title?: string | null;
    milestoneTitle?: string | null;
    /** 当前 task 的验收标准：学习者自评“是否达成”时以此为对照，与教师侧判据对齐 */
    acceptanceCriteria?: string | null;
    description?: string | null;
  } | null;
  knowledgeSnapshot?: Array<{
    name: string;
    status?: string;
    progress?: number;
  }>;
  /** 学习者记忆（已掌握/到期复习/最近完成事项），供模拟器自然引用“我记得/我之前做过” */
  learnerMemory?: {
    mastered?: string[];
    dueReview?: string[];
    struggling?: string[];
    recentCompleted?: string[];
  } | null;
  /** 本轮认知判决（物理两阶段第一段产出，硬约束） */
  epistemicGrounding?: EpistemicGrounding | null;
  /** 控制学习者对抗度. 默认 'normal' */
  frictionBudget?: FrictionBudget;
  /**
   * 当前待作答的理解检查点（不含答案键）。有值时应按人设给出 `checkpointAnswer`，
   * 而不是继续闲聊——平台在待答检查点未消费前不会出下一题。
   */
  pendingCheckpoint?: {
    id: string;
    type: 'single_choice' | 'multi_choice' | 'short_answer';
    question: string;
    options?: Array<{ id: string; text: string }>;
    allowSkip?: boolean;
  } | null;
  /**
   * 日期模拟的时间上下文（**可选**，仅日期模拟开启时注入）。
   * 注意：此前只声明在 yaml / 调用方，payload 未透传 → 对应的 "temporalContext" 规则是死的。
   */
  temporalContext?: {
    simulatedNow?: string;
    simulatedDay?: string;
    dayIndex?: number;
    timezone?: string;
    sinceLastSessionDays?: number | null;
  } | null;
  /**
   * 代码裁决的"这次还能不能想起来"观测（Q4）：对到期复习点的**概率化提取**结果。
   * 模拟器据此人设化表达（CLEAR 顺畅、VAGUE 含糊/舌尖、CONFUSED 记成别的、FAILED 记不得）。
   */
  memoryRecall?: Array<{
    conceptKey: string;
    status: 'CLEAR' | 'VAGUE' | 'CONFUSED' | 'FAILED';
    outputConceptKey?: string;
  }> | null;
}

export interface LearnLearnerSimulationOutput {
  reply: string;
  emotion: 'neutral' | 'slightly_frustrated' | 'happy' | 'confident' | 'confused' | string;
  /** 当 LLM 失败/校验失败时返回兜底数据, 评估时应排除这些 turn */
  degraded?: boolean;
  learnerState: {
    phaseFocus: LearnLearnerPhase;
    taskUnderstanding: number;
    conceptualMastery: number;
    proceduralMastery: number;
    misconceptionRisk: number;
    helpSeekingReadiness: number;
    cognitiveLoad: number;
    wantsHint: boolean;
    wantsWorkedExample: boolean;
    readyForNextTask: boolean;
    remainingBlockers: string[];
  };
  learnerFeedback: {
    selfReportedTaskDone: boolean;
    satisfaction: number;
    confidence: number;
    wantsMoreHelp: boolean;
    stopAsking: boolean;
    remainingBlockers: string[];
    reason: string;
  };
  debug?: {
    visibleSignal?: string;
    stateChangeReason?: string;
    /** 归一化补齐检测：LLM 未输出、由代码用 fallback 默认值填充的状态字段统计 */
    normalizedFallback?: {
      fieldCount: number;
      learnerState: string[];
      learnerFeedback: string[];
    };
  };
  /**
   * 对 `pendingCheckpoint` 的作答草案（仅在有检查点时产出）。
   * `selectedOptionIds` 必须是题目里真实存在的选项 id；简答题用 `answerText`。
   */
  checkpointAnswer?: {
    selectedOptionIds?: string[];
    answerText?: string;
    confidence?: number;
  };
}


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

function buildFeedbackFromState(state: LearnLearnerSimulationOutput['learnerState'], reason = ''): LearnLearnerSimulationOutput['learnerFeedback'] {
  const blockers = normalizeStringArray(state.remainingBlockers);
  const confidentEnough = state.taskUnderstanding >= 0.78 && Math.max(state.conceptualMastery, state.proceduralMastery) >= 0.65;
  const wantsMoreHelp = state.wantsHint || state.wantsWorkedExample || blockers.length > 0 || state.misconceptionRisk >= 0.45;
  const selfReportedTaskDone = state.phaseFocus === 'ready_to_close' && confidentEnough && !wantsMoreHelp;

  return {
    selfReportedTaskDone,
    satisfaction: clamp01(selfReportedTaskDone ? 0.86 : state.taskUnderstanding, 0.45),
    confidence: clamp01(Math.max(state.conceptualMastery, state.proceduralMastery, state.taskUnderstanding), 0.45),
    wantsMoreHelp,
    stopAsking: selfReportedTaskDone,
    remainingBlockers: blockers,
    reason: reason || (selfReportedTaskDone ? '当前 task 已能跟上，愿意停止继续追问。' : '当前 task 仍有未完全确认的地方。')
  };
}

function sanitizeVisibleContent(text: string): string {
  return safeText(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizePhase(value: any): LearnLearnerPhase {
  return value === 'blocked' || value === 'verifying' || value === 'ready_to_close' ? value : 'trying';
}

function cropReply(reply: string, phase: LearnLearnerPhase) {
  const normalized = sanitizeVisibleContent(reply);
  if (!normalized) return '';
  const parts = normalized.split(/(?<=[。！？!?])\s*|\n+/).map((item) => item.trim()).filter(Boolean);
  const sentenceLimit = phase === 'ready_to_close' ? 1 : 2;
  const charLimit = phase === 'ready_to_close' ? 48 : phase === 'blocked' ? 80 : 96;
  const shortened = parts.slice(0, sentenceLimit).join(' ');
  if (shortened.length <= charLimit) return shortened;
  return `${shortened.slice(0, Math.max(24, charLimit - 1)).trim()}…`;
}

function buildFallback(input: LearnLearnerSimulationInput): LearnLearnerSimulationOutput {
  const phaseFocus = normalizePhase(input.currentPhase);
  const previous = input.previousLearnerState || {};
  const taskTitle = safeText(input.currentTask?.title) || '当前任务';
  const reply = phaseFocus === 'blocked'
    ? '我大概知道你在说什么，但我卡在这一步，不太确定接下来该怎么做。'
    : phaseFocus === 'verifying'
      ? '我先按你的意思试一下，感觉大概能跟上。'
      : phaseFocus === 'ready_to_close'
        ? '嗯，这一步我现在基本会了，可以继续。'
        : `我先按这个方向试一下，看看 ${taskTitle} 这一步能不能做出来。`;

  const learnerState = {
    phaseFocus,
    taskUnderstanding: clamp01(previous.taskUnderstanding, phaseFocus === 'trying' ? 0.45 : phaseFocus === 'verifying' ? 0.72 : phaseFocus === 'ready_to_close' ? 0.86 : 0.36),
    conceptualMastery: clamp01(previous.conceptualMastery, phaseFocus === 'ready_to_close' ? 0.8 : 0.45),
    proceduralMastery: clamp01(previous.proceduralMastery, phaseFocus === 'ready_to_close' ? 0.82 : 0.46),
    misconceptionRisk: clamp01(previous.misconceptionRisk, phaseFocus === 'blocked' ? 0.68 : 0.32),
    helpSeekingReadiness: clamp01(previous.helpSeekingReadiness, phaseFocus === 'blocked' ? 0.75 : 0.42),
    cognitiveLoad: clamp01(previous.cognitiveLoad, phaseFocus === 'blocked' ? 0.74 : 0.42),
    wantsHint: phaseFocus === 'blocked',
    wantsWorkedExample: false,
    readyForNextTask: phaseFocus === 'ready_to_close',
    remainingBlockers: phaseFocus === 'blocked' ? ['当前步骤还没真正对上'] : []
  };

  return {
    reply: cropReply(reply, phaseFocus),
    emotion: phaseFocus === 'blocked' ? 'confused' : 'neutral',
    learnerState,
    learnerFeedback: buildFeedbackFromState(learnerState, '模型输出不可用时的保守自评'),
    debug: {
      visibleSignal: 'fallback',
      stateChangeReason: '模型输出不可用时的保守兜底'
    }
  };
}

/**
 * 检查点作答草案归一化：只在**有待答检查点**时产出；选项 id 必须是题目里真实存在的，
 * 避免模型编造 id 导致提交被判"选项无效"。
 */
function normalizeCheckpointAnswer(
  raw: any,
  checkpoint: LearnLearnerSimulationInput['pendingCheckpoint']
): LearnLearnerSimulationOutput['checkpointAnswer'] {
  if (!checkpoint) return undefined;
  const validIds = new Set((checkpoint.options || []).map((option) => option.id));
  const selected = Array.isArray(raw?.selectedOptionIds)
    ? raw.selectedOptionIds
        .map((item: any) => safeText(item))
        .filter((id: string) => validIds.has(id))
        .slice(0, 4)
    : [];
  const answerText = safeText(raw?.answerText).slice(0, 200);
  const confidence = typeof raw?.confidence === 'number' ? clamp01(raw.confidence, 0.5) : undefined;
  if (!selected.length && !answerText) return undefined;
  return {
    ...(selected.length ? { selectedOptionIds: selected } : {}),
    ...(answerText ? { answerText } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function normalizeOutput(parsed: any, input: LearnLearnerSimulationInput): LearnLearnerSimulationOutput {
  const fallback = buildFallback(input);
  const rawState = parsed?.learnerState && typeof parsed.learnerState === 'object' ? parsed.learnerState : {};
  const rawFeedback = parsed?.learnerFeedback && typeof parsed.learnerFeedback === 'object' ? parsed.learnerFeedback : {};
  const normalizedFallback = {
    fieldCount: LEARN_STATE_FIELDS.filter((field) => !(field in rawState)).length
      + LEARN_FEEDBACK_FIELDS.filter((field) => !(field in rawFeedback)).length,
    learnerState: LEARN_STATE_FIELDS.filter((field) => !(field in rawState)).slice(0, 8),
    learnerFeedback: LEARN_FEEDBACK_FIELDS.filter((field) => !(field in rawFeedback)).slice(0, 8),
  };
  const phaseFocus = normalizePhase(rawState.phaseFocus || input.currentPhase);
  const learnerState = {
    phaseFocus,
    taskUnderstanding: clamp01(rawState.taskUnderstanding, fallback.learnerState.taskUnderstanding),
    conceptualMastery: clamp01(rawState.conceptualMastery, fallback.learnerState.conceptualMastery),
    proceduralMastery: clamp01(rawState.proceduralMastery, fallback.learnerState.proceduralMastery),
    misconceptionRisk: clamp01(rawState.misconceptionRisk, fallback.learnerState.misconceptionRisk),
    helpSeekingReadiness: clamp01(rawState.helpSeekingReadiness, fallback.learnerState.helpSeekingReadiness),
    cognitiveLoad: clamp01(rawState.cognitiveLoad, fallback.learnerState.cognitiveLoad),
    wantsHint: safeBool(rawState.wantsHint, fallback.learnerState.wantsHint),
    wantsWorkedExample: safeBool(rawState.wantsWorkedExample, fallback.learnerState.wantsWorkedExample),
    readyForNextTask: safeBool(rawState.readyForNextTask, fallback.learnerState.readyForNextTask),
    remainingBlockers: normalizeStringArray(rawState.remainingBlockers).length ? normalizeStringArray(rawState.remainingBlockers) : fallback.learnerState.remainingBlockers,
  };
  const fallbackFeedback = buildFeedbackFromState(learnerState, fallback.learnerFeedback.reason);
  const feedbackBlockers = normalizeStringArray(rawFeedback.remainingBlockers);
  const wantsMoreHelp = safeBool(rawFeedback.wantsMoreHelp, fallbackFeedback.wantsMoreHelp);
  const selfReportedTaskDone = safeBool(rawFeedback.selfReportedTaskDone, fallbackFeedback.selfReportedTaskDone) && !wantsMoreHelp && feedbackBlockers.length === 0;
  const checkpointAnswer = normalizeCheckpointAnswer(parsed?.checkpointAnswer, input.pendingCheckpoint);

  return {
    reply: cropReply(parsed?.reply || fallback.reply, phaseFocus),
    emotion: safeText(parsed?.emotion) || fallback.emotion,
    learnerState,
    learnerFeedback: {
      selfReportedTaskDone,
      satisfaction: clamp01(rawFeedback.satisfaction, fallbackFeedback.satisfaction),
      confidence: clamp01(rawFeedback.confidence, fallbackFeedback.confidence),
      wantsMoreHelp,
      stopAsking: safeBool(rawFeedback.stopAsking, fallbackFeedback.stopAsking) && selfReportedTaskDone,
      remainingBlockers: feedbackBlockers,
      reason: sanitizeVisibleContent(rawFeedback.reason || fallbackFeedback.reason),
    },
    debug: {
      visibleSignal: sanitizeVisibleContent(parsed?.debug?.visibleSignal || ''),
      stateChangeReason: sanitizeVisibleContent(parsed?.debug?.stateChangeReason || ''),
      // 归一化补齐检测：LLM 未输出的状态字段由代码用 fallback 默认值填充，供审计区分
      normalizedFallback,
    },
    ...(checkpointAnswer ? { checkpointAnswer } : {}),
  };
}

const LEARN_STATE_FIELDS = [
  'phaseFocus', 'taskUnderstanding', 'conceptualMastery', 'proceduralMastery',
  'misconceptionRisk', 'helpSeekingReadiness', 'cognitiveLoad', 'wantsHint',
  'wantsWorkedExample', 'readyForNextTask', 'remainingBlockers',
] as const;

const LEARN_FEEDBACK_FIELDS = [
  'selfReportedTaskDone', 'satisfaction', 'confidence', 'wantsMoreHelp',
  'stopAsking', 'remainingBlockers', 'reason',
] as const;

export { normalizeOutput, LEARN_STATE_FIELDS, LEARN_FEEDBACK_FIELDS };

/**
 * 检查点 → payload 的**白名单投影**：只保留学习者可见字段。
 * 用白名单而非透传，确保将来契约追加答案键类字段时不会被带进给模型的输入。
 */
function projectPendingCheckpoint(checkpoint: LearnLearnerSimulationInput['pendingCheckpoint']) {
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  const options = Array.isArray(checkpoint.options)
    ? checkpoint.options
        .filter((option) => option && typeof option.id === 'string')
        .map((option) => ({ id: option.id, text: typeof option.text === 'string' ? option.text : '' }))
    : [];
  const projected: Record<string, unknown> = {
    id: typeof checkpoint.id === 'string' ? checkpoint.id : '',
    type: checkpoint.type,
    question: typeof checkpoint.question === 'string' ? checkpoint.question : '',
  };
  if (options.length) projected.options = options;
  if (checkpoint.allowSkip !== undefined) projected.allowSkip = checkpoint.allowSkip === true;
  return projected;
}

function buildUserPayload(input: LearnLearnerSimulationInput) {
  const history = Array.isArray(input.visibleContext?.history)
    ? input.visibleContext.history.map((message) => ({
        role: message?.role === 'teacher' ? 'teacher' : 'learner',
        content: sanitizeVisibleContent(message?.content || '')
      })).filter((message) => message.content).slice(-6)
    : [];

  const friction = decideFrictionTrigger(input.frictionBudget);
  const temporalContext = input.temporalContext || null;
  const pendingCheckpoint = projectPendingCheckpoint(input.pendingCheckpoint);
  const memoryRecall = Array.isArray(input.memoryRecall)
    ? input.memoryRecall
        .filter((item) => item && typeof item.conceptKey === 'string' && ['CLEAR', 'VAGUE', 'CONFUSED', 'FAILED'].includes(String(item.status)))
        .slice(0, 6)
        .map((item) => ({
          conceptKey: item.conceptKey,
          status: item.status,
          ...(item.outputConceptKey && item.outputConceptKey !== item.conceptKey
            ? { outputConceptKey: item.outputConceptKey }
            : {})
        }))
    : [];

  const body = {
    learner: input.learner || {},
    story: input.story || null,
    visibleContext: {
      history,
      lastTeacherMessage: sanitizeVisibleContent(input.visibleContext?.lastTeacherMessage || history.filter((item) => item.role === 'teacher').slice(-1)[0]?.content || '')
    },
    currentPhase: normalizePhase(input.currentPhase),
    previousLearnerState: input.previousLearnerState || null,
    currentTask: input.currentTask || null,
    knowledgeSnapshot: Array.isArray(input.knowledgeSnapshot) ? input.knowledgeSnapshot.slice(0, 5) : [],
    ...(temporalContext ? { temporalContext } : {}),
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
    epistemicGrounding: input.epistemicGrounding || null,
    ...(memoryRecall.length ? { memoryRecall } : {}),
    friction: {
      budget: friction.budget,
      triggerProbability: friction.triggered ? 1 : 0,
      triggered: friction.triggered,
      guidance: friction.guidance
    },
    personaAnchorHint: PERSONA_FIELD_ANCHORS_HINT,
    task: {
      requirements: [
        'reply only as the learner, in 1-2 short sentences',
        'apply friction.guidance to calibrate adversarial/failure/emotional patterns this turn',
        'let personaAnchorHint fields implicitly steer reply style (especially verbosity, confusionStyle, helpSeekingPattern)',
        'you may naturally reference your learnerMemory (things you previously learned or completed) when relevant, but never name the field',
        'when pendingCheckpoint is present, answer it via checkpointAnswer (pick real option ids, never invent); otherwise omit checkpointAnswer'
      ]
    },
    ...(pendingCheckpoint ? { pendingCheckpoint } : {})
  };

  // 稳定前缀（默认启用；PAYLOAD_STABLE_PREFIX=0 回退旧序）：常量/慢变块（task/personaAnchorHint/story/learner）前置，
  // 逐回合变化块后置
  if (process.env.PAYLOAD_STABLE_PREFIX !== '0') {
    return {
      task: body.task,
      personaAnchorHint: body.personaAnchorHint,
      story: body.story,
      learner: body.learner,
      currentPhase: body.currentPhase,
      previousLearnerState: body.previousLearnerState,
      currentTask: body.currentTask,
      knowledgeSnapshot: body.knowledgeSnapshot,
      ...(temporalContext ? { temporalContext } : {}),
      learnerMemory: body.learnerMemory,
      ...(memoryRecall.length ? { memoryRecall } : {}),
      epistemicGrounding: body.epistemicGrounding,
      friction: body.friction,
      visibleContext: body.visibleContext,
      ...(pendingCheckpoint ? { pendingCheckpoint } : {}),
    };
  }
  return body;
}

export const virtualLearnerLearnTurnSimulatorDefinition: SkillDefinition = {
  name: 'virtual-learner-learn-turn-simulator',
  displayName: '虚拟学习者 Learn 回合模拟器',
  version: '1.0.0',
  category: 'generation',
  description: '基于学习者画像、故事触发面与教师可见上下文，模拟虚拟学习者在 Learn 阶段的短回复与主观状态。',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像', required: true },
      story: { type: 'object', description: '故事触发面' },
      visibleContext: { type: 'object', description: '完整可见对话上下文', required: true },
      currentPhase: { type: 'string', description: 'trying|blocked|verifying|ready_to_close', required: true },
      previousLearnerState: { type: 'object', description: '上一轮学习者主观状态' },
      currentTask: { type: 'object', description: '当前 task 信息' },
      knowledgeSnapshot: { type: 'array', description: '当前任务知识看板' },
      learnerMemory: { type: 'object', description: '学习者长期记忆（已掌握/到期复习/最近完成）' },
      temporalContext: { type: 'object', description: '日期模拟时间上下文（可选）' },
      memoryRecall: { type: 'array', description: '代码裁决的到期点概率化提取结果（Q4）' },
      epistemicGrounding: { type: 'object', description: '本轮认知判决（硬约束）' },
      pendingCheckpoint: { type: 'object', description: '当前待作答的理解检查点（不含答案键）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: '学习者自然回复' },
      emotion: { type: 'string', description: '当前情绪' },
      learnerState: { type: 'object', description: 'Learn 阶段学习者主观状态' },
      learnerFeedback: { type: 'object', description: '学习者对当前 task 是否学完的自我反馈' },
      checkpointAnswer: { type: 'object', description: '对 pendingCheckpoint 的作答草案' },
      debug: { type: 'object', description: '调试信息' },
    },
  },
  capabilities: ['learn-stage-learner-simulation', 'visible-context-roleplay', 'short-teaching-reply'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

export async function virtualLearnerLearnTurnSimulator(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:virtual-learner-learn-turn-simulator',
      defaultSystemPrompt: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-learn-turn-simulator' },
            buildUserPayload: (value: any) => projectSimulatorPayload(buildUserPayload(value)),
      validateParsedOutput: (parsed: any) => {
        const replyOk = typeof parsed?.reply === 'string' && parsed.reply.trim().length > 0
        const stateOk = parsed?.learnerState && typeof parsed.learnerState === 'object'
        return {
          valid: replyOk && stateOk,
          failureReason: !replyOk ? 'missing reply' : 'missing learnerState'
        }
      },
      normalizeOutput,
      mapEnvelope: (output, _input, runtimeContract) => mapSkillOutputEnvelope(runtimeContract, output, {
        phase: 'simulation-step-completed',
        nextState: output?.learnerState ?? null,
      }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) => `上一次输出失败：${failureReason}。请只返回一个完整、可解析的 JSON 对象；不要 markdown，不要代码块，不要解释；所有字符串必须闭合。`
      },
    }, input || {});

    if (!result.success || !result.output) {
      // 失败显式传播：不产出伪 learnerState/伪 selfReportedTaskDone（与 catch 路径统一 success:false 语义）
      return {
        success: false,
        error: {
          code: VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED,
          message: result.error?.message || 'learn-turn-simulator-failed',
        },
        duration: result.debug.durationMs || 0,
      };
    }

    return {
      success: true,
      output: {
        ...result.output,
        runtimeEnvelope: result.runtimeEnvelope,
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
        code: VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED,
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerLearnTurnSimulator;
