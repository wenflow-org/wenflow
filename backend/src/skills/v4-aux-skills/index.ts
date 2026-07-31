/**
 * v4 辅助 LLM Skills（由原遗留插件/旁路迁入）
 *
 * 统一约定：
 * - 所有 handler 只经 callPrompt 调用 ACTIVE prompt（requireActivePrompt）。
 * - 失败策略遵循 core 声明：propagate 技能失败时抛错；fallback 技能返回确定性降级结果（quality='fallback'）。
 * - 调用方通过输入对象中的保留字段注入调用上下文与降级值：
 *     __prompt:    PromptCallContext 透传（requestPath/userId/retryBudget/assistantMessages/...），
 *                  另支持 callerAgentId / callerAction（写入 gateway caller）。
 *     __fallback:  LLM 失败时返回的降级输出（仅 fallback 策略技能生效；未提供时使用内置确定性降级）。
 *     __onFailure: 'throw' | 'fallback'，覆盖 core 声明的默认策略（用于必须保持既有抛出契约的调用点）。
 */
import { callPrompt } from '../../composers/prompt-composer';
import type { PromptCallContext } from '../../composers/types';
import type { SkillDefinition, SkillExecutionResult } from '../protocol';

export type AuxSkillId =
  | 'teaching-opening-generator'
  | 'session-evaluation-fallback'
  | 'learner-progress-report'
  | 'path-adjustment-generator'
  | 'goal-analysis'
  | 'generic-chat'
  | 'course-design'
  | 'skill-author'
  | 'skill-compiler'
  | 'generic-planner'
  | 'basic-extractor'
  | 'basic-evaluator'
  | 'basic-generator'
  | 'data-mapping'
  | 'goal-alignment-checker'
  | 'concept-priority';

interface AuxPlumbing extends PromptCallContext {
  callerAgentId?: string;
  callerAction?: string;
}

interface AuxSkillMeta {
  skillId: AuxSkillId;
  displayName: string;
  description: string;
  category: SkillDefinition['category'];
  /** core 声明的失败策略：propagate=抛错，fallback=确定性降级 */
  policy: 'propagate' | 'fallback';
}

const OBJECT_OUTPUT = { type: 'object', properties: {} } as const;

function definition(meta: AuxSkillMeta): SkillDefinition {
  return {
    name: meta.skillId,
    displayName: meta.displayName,
    version: '1.0.0',
    status: 'working',
    category: meta.category,
    description: meta.description,
    capabilities: [meta.skillId],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: OBJECT_OUTPUT,
    stats: { callCount: 0, successRate: 1, avgLatency: 0 },
  };
}

function asTrimmedString(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

interface RunAuxOptions<TOutput> {
  meta: AuxSkillMeta;
  input: any;
  modelDefaults: (domain: any) => { model?: string; temperature?: number; maxTokens?: number };
  buildUserPayload: (domain: any) => any;
  normalize: (parsed: any, domain: any, fallback: any) => TOutput;
  validate?: (parsed: any) => { valid: true } | { valid: false; failureReason: string };
  /** 内置确定性降级输出；优先级低于调用方 __fallback */
  builtinFallback?: (domain: any) => TOutput;
  prepareSystemPrompt?: (systemPrompt: string, domain: any) => string;
}

async function runAux<TOutput>(opts: RunAuxOptions<TOutput>): Promise<SkillExecutionResult<TOutput>> {
  const start = Date.now();
  const {
    __prompt: rawPlumbing,
    __fallback: callerFallback,
    __onFailure: onFailureOverride,
    ...domain
  } = opts.input || {};
  const { callerAgentId, callerAction, ...promptContext } = (rawPlumbing || {}) as AuxPlumbing;
  const mode: 'throw' | 'fallback' = onFailureOverride
    || (opts.meta.policy === 'propagate' ? 'throw' : 'fallback');
  const hasCallerFallback = callerFallback !== undefined;
  const resolveFallback = (): TOutput => hasCallerFallback
    ? callerFallback
    : opts.builtinFallback
      ? opts.builtinFallback(domain)
      : (null as TOutput);

  try {
    const result = await callPrompt<any, TOutput>({
      agentId: `skill:${opts.meta.skillId}`,
      defaultSystemPrompt: '',
      requireActivePrompt: true,
      caller: { skillId: opts.meta.skillId, agentId: callerAgentId, action: callerAction },
      modelDefaults: opts.modelDefaults(domain),
      ...(opts.prepareSystemPrompt
        ? { prepareSystemPrompt: (systemPrompt: string) => Promise.resolve(opts.prepareSystemPrompt!(systemPrompt, domain)) }
        : {}),
      buildUserPayload: () => opts.buildUserPayload(domain),
      normalizeOutput: (parsed) => opts.normalize(parsed, domain, callerFallback),
      validateParsedOutput: opts.validate || ((parsed) => parsed !== undefined && parsed !== null
        ? { valid: true }
        : { valid: false, failureReason: `${opts.meta.skillId.toUpperCase().replace(/-/g, '_')}_OUTPUT_EMPTY` }),
    }, domain, promptContext);
    if (!result.success || result.output === undefined || result.output === null) {
      throw new Error(result.error?.message || `${opts.meta.skillId} failed`);
    }
    return {
      success: true,
      output: result.output,
      duration: Date.now() - start,
      quality: 'model',
      runtimeEnvelope: result.runtimeEnvelope,
      debug: result.debug,
    };
  } catch (error) {
    if (mode === 'throw') throw error;
    return {
      success: true,
      output: resolveFallback(),
      duration: Date.now() - start,
      quality: 'fallback',
    };
  }
}

// ============================================================
// Skill 元数据（policy 与 prompts/core/<skillId>.yaml 的 failurePolicy 对齐）
// ============================================================

const META: Record<AuxSkillId, AuxSkillMeta> = {
  'teaching-opening-generator': { skillId: 'teaching-opening-generator', displayName: '课堂开场交互生成器', description: '生成教学 Session 的开场 message、question 与 quickReplies', category: 'generation', policy: 'fallback' },
  'session-evaluation-fallback': { skillId: 'session-evaluation-fallback', displayName: '课程评估补全器', description: '在主课后总结缺少 evaluation 时补齐结构化评估', category: 'analysis', policy: 'fallback' },
  'learner-progress-report': { skillId: 'learner-progress-report', displayName: '学习进展报告生成器', description: '基于学习指标和信号生成简短进展反馈', category: 'analysis', policy: 'fallback' },
  'path-adjustment-generator': { skillId: 'path-adjustment-generator', displayName: '路径动态调整生成器', description: '生成可插入路径的 milestone 或 subtask', category: 'generation', policy: 'fallback' },
  'goal-analysis': { skillId: 'goal-analysis', displayName: '学习目标分析器', description: '从用户目标中提取主题、水平、重点与场景', category: 'analysis', policy: 'fallback' },
  'generic-chat': { skillId: 'generic-chat', displayName: '平台通用文本能力', description: '无更专用 Skill 时的通用文本调用能力', category: 'generation', policy: 'propagate' },
  'course-design': { skillId: 'course-design', displayName: '课程设计器', description: '为周次主题生成结构化课程任务', category: 'generation', policy: 'propagate' },
  'skill-author': { skillId: 'skill-author', displayName: 'Prompt 起草助手', description: '为新 Skill 起草 system prompt', category: 'generation', policy: 'propagate' },
  'skill-compiler': { skillId: 'skill-compiler', displayName: 'Skill Prompt 验收器', description: '执行 system prompt 并检查必填字段覆盖情况', category: 'analysis', policy: 'propagate' },
  'generic-planner': { skillId: 'generic-planner', displayName: '通用学习路径规划器', description: '为普通学习目标生成阶段化学习方案', category: 'generation', policy: 'propagate' },
  'basic-extractor': { skillId: 'basic-extractor', displayName: '内容结构化提取器', description: '提取内容摘要、知识点、链接、难度与标签', category: 'analysis', policy: 'propagate' },
  'basic-evaluator': { skillId: 'basic-evaluator', displayName: '学习质量评估器', description: '评估学习内容、答案或任务完成情况', category: 'analysis', policy: 'propagate' },
  'basic-generator': { skillId: 'basic-generator', displayName: '基础教学内容生成器', description: '生成教学讲解、代码示例、练习与常见错误分析', category: 'generation', policy: 'propagate' },
  'data-mapping': { skillId: 'data-mapping', displayName: '数据映射器', description: '将输入数据映射为目标字段结构', category: 'analysis', policy: 'propagate' },
  'goal-alignment-checker': { skillId: 'goal-alignment-checker', displayName: '路径目标对齐检查器', description: '检查学习路径与目标的对齐程度', category: 'analysis', policy: 'fallback' },
  'concept-priority': { skillId: 'concept-priority', displayName: '概念优先级调整器', description: '将实践任务升级为概念理解任务', category: 'generation', policy: 'fallback' },
};

// ============================================================
// Handlers
// ============================================================

async function teachingOpeningGeneratorHandler(input: any) {
  return runAux({
    meta: META['teaching-opening-generator'],
    input,
    modelDefaults: () => ({ temperature: 0.4, maxTokens: 1200 }),
    buildUserPayload: (d) => ({
      subject: d.subject,
      topic: d.topic,
      taskTitle: d.taskTitle,
      taskDescription: d.taskDescription,
      taskType: d.taskType,
      pathSummary: d.pathSummary,
      currentMilestoneTitle: d.currentMilestoneTitle,
      learner: d.learner,
      openingMode: d.openingMode,
      ...(d.learningSignal ? { learningSignal: d.learningSignal } : {}),
      ...(d.lastLessonRecap ? { lastLessonRecap: d.lastLessonRecap } : {}),
    }),
    normalize: (parsed, d) => ({
      message: asTrimmedString(parsed?.message),
      question: asTrimmedString(parsed?.question),
      quickReplies: Array.isArray(parsed?.quickReplies)
        ? parsed.quickReplies
            .map((item: any) => (typeof item?.text === 'string' ? { text: item.text.trim() } : null))
            .filter((item: any) => item && item.text)
            .slice(0, 3)
        : [],
      mode: ['example-first', 'predict', 'self-assess'].includes(parsed?.mode) ? parsed.mode : d.openingMode,
    }),
    validate: (parsed) => parsed
      && asTrimmedString(parsed.message)
      && asTrimmedString(parsed.question)
      && Array.isArray(parsed.quickReplies) && parsed.quickReplies.length > 0
      ? { valid: true }
      : { valid: false, failureReason: 'TEACHING_OPENING_OUTPUT_INCOMPLETE' },
  });
}

async function sessionEvaluationFallbackHandler(input: any) {
  return runAux({
    meta: META['session-evaluation-fallback'],
    input,
    modelDefaults: () => ({ temperature: 0.2, maxTokens: 1500 }),
    buildUserPayload: (d) => ({
      transcript: d.messages,
      sessionInfo: d.sessionInfo,
      knowledgePoints: d.knowledgePoints,
      knowledgeContext: d.knowledgeContext,
      learningState: d.learningState,
      sessionEvidence: d.sessionEvidence,
      sessionStructure: d.sessionStructure,
    }),
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'SESSION_EVALUATION_OUTPUT_NOT_OBJECT' },
    builtinFallback: () => null,
  });
}

async function learnerProgressReportHandler(input: any) {
  return runAux({
    meta: META['learner-progress-report'],
    input,
    modelDefaults: () => ({ temperature: 0.4, maxTokens: 1200 }),
    buildUserPayload: (d) => ({ task: d.task, metrics: d.metrics, signals: d.signals }),
    normalize: (parsed, _d, fb) => ({
      reasoning: asTrimmedString(parsed?.reasoning) || fb?.reasoning || '基于当前学习数据，你正在稳步推进学习进度。',
      suggestion: asTrimmedString(parsed?.suggestion) || fb?.suggestion || '继续保持当前学习节奏，遇到困难时先回顾前置知识点。',
    }),
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'LEARNER_PROGRESS_REPORT_OUTPUT_NOT_OBJECT' },
  });
}

async function pathAdjustmentGeneratorHandler(input: any) {
  return runAux({
    meta: META['path-adjustment-generator'],
    input,
    modelDefaults: (d) => ({ temperature: d.temperature ?? 0.7, maxTokens: d.maxTokens ?? 3000 }),
    buildUserPayload: (d) => {
      const { temperature: _t, maxTokens: _m, ...payload } = d;
      return payload;
    },
    normalize: (parsed) => parsed?.milestone || parsed?.subtask || parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'PATH_ADJUSTMENT_OUTPUT_NOT_OBJECT' },
    builtinFallback: () => null,
  });
}

async function goalAnalysisHandler(input: any) {
  return runAux({
    meta: META['goal-analysis'],
    input,
    modelDefaults: () => ({ maxTokens: 2000, temperature: 0.2 }),
    buildUserPayload: (d) => ({
      goal: d.goal,
      currentLevel: d.currentLevel ?? null,
      timePerDay: d.timePerDay ?? null,
    }),
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'GOAL_ANALYSIS_OUTPUT_NOT_OBJECT' },
    builtinFallback: (d) => ({
      subject: String(d.goal || '学习目标'),
      level: ['beginner', 'intermediate', 'advanced'].includes(d.currentLevel) ? d.currentLevel : 'beginner',
      focus: [],
      context: '',
      confidence: 0.5,
    }),
  });
}

async function genericChatHandler(input: any) {
  return runAux<string>({
    meta: META['generic-chat'],
    input,
    modelDefaults: (d) => ({ model: d.model, temperature: d.temperature, maxTokens: d.maxTokens }),
    prepareSystemPrompt: (systemPrompt, d) => d.systemPrompt
      ? `${systemPrompt}\n\n【调用方系统指令】\n${d.systemPrompt}`
      : systemPrompt,
    buildUserPayload: (d) => d.message ?? '',
    normalize: (parsed) => (typeof parsed === 'string' ? parsed : String(parsed || '')),
    validate: (parsed) => typeof parsed === 'string' && parsed.length > 0
      ? { valid: true }
      : { valid: false, failureReason: 'GENERIC_CHAT_OUTPUT_EMPTY' },
  });
}

async function courseDesignHandler(input: any) {
  return runAux({
    meta: META['course-design'],
    input,
    modelDefaults: (d) => ({ model: d.model, temperature: 0.7, maxTokens: 4000 }),
    buildUserPayload: (d) => {
      const { model: _m, ...params } = d;
      return params;
    },
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'COURSE_DESIGN_OUTPUT_NOT_OBJECT' },
  });
}

async function skillAuthorHandler(input: any) {
  return runAux<string>({
    meta: META['skill-author'],
    input,
    modelDefaults: () => ({ maxTokens: 2400, temperature: 0.5 }),
    buildUserPayload: (d) => d,
    normalize: (parsed) => (typeof parsed === 'string' ? parsed : String(parsed?.systemPrompt || '')),
    validate: (parsed) => typeof parsed === 'string' && parsed.trim()
      ? { valid: true }
      : { valid: false, failureReason: 'SKILL_AUTHOR_EMPTY_OUTPUT' },
  });
}

async function skillCompilerHandler(input: any) {
  return runAux({
    meta: META['skill-compiler'],
    input,
    modelDefaults: (d) => ({
      model: d.modelOverride,
      maxTokens: d.maxTokensOverride || 2000,
      temperature: d.temperatureOverride ?? 0.3,
    }),
    buildUserPayload: (d) => d,
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'SKILL_COMPILER_OUTPUT_NOT_OBJECT' },
  });
}

async function genericPlannerHandler(input: any) {
  return runAux({
    meta: META['generic-planner'],
    input,
    modelDefaults: (d) => ({ model: d.model, temperature: d.temperature, maxTokens: d.maxTokens }),
    buildUserPayload: (d) => d.input ?? d,
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'GENERIC_PLANNER_OUTPUT_NOT_OBJECT' },
  });
}

async function basicExtractorHandler(input: any) {
  return runAux({
    meta: META['basic-extractor'],
    input,
    modelDefaults: (d) => ({ model: d.model, temperature: d.temperature, maxTokens: d.maxTokens }),
    buildUserPayload: (d) => ({ input: d.input, analysisPrompt: d.analysisPrompt }),
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'BASIC_EXTRACTOR_OUTPUT_NOT_OBJECT' },
  });
}

async function basicEvaluatorHandler(input: any) {
  return runAux({
    meta: META['basic-evaluator'],
    input,
    modelDefaults: (d) => ({ model: d.model, temperature: d.temperature, maxTokens: d.maxTokens }),
    buildUserPayload: (d) => ({ input: d.input, evalContext: d.evalContext }),
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'BASIC_EVALUATOR_OUTPUT_NOT_OBJECT' },
  });
}

async function basicGeneratorHandler(input: any) {
  return runAux({
    meta: META['basic-generator'],
    input,
    modelDefaults: (d) => ({ model: d.model, temperature: d.temperature, maxTokens: d.maxTokens }),
    buildUserPayload: (d) => ({ input: d.input, learningContext: d.learningContext }),
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'BASIC_GENERATOR_OUTPUT_NOT_OBJECT' },
  });
}

async function dataMappingHandler(input: any) {
  return runAux({
    meta: META['data-mapping'],
    input,
    modelDefaults: (d) => ({ model: d.model, temperature: d.temperature, maxTokens: d.maxTokens }),
    buildUserPayload: (d) => ({
      mappingType: d.mappingType,
      sourceData: d.sourceData,
      targetSchema: d.targetSchema,
      mappingPrompt: d.mappingPrompt,
    }),
    normalize: (parsed) => parsed?.mapped || parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'DATA_MAPPING_OUTPUT_NOT_OBJECT' },
  });
}

async function goalAlignmentCheckerHandler(input: any) {
  return runAux({
    meta: META['goal-alignment-checker'],
    input,
    modelDefaults: () => ({ temperature: 0.3, maxTokens: 3000 }),
    buildUserPayload: (d) => ({ path: d.path, goal: d.goal, userContext: d.userContext, pathSummary: d.pathSummary }),
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'GOAL_ALIGNMENT_OUTPUT_NOT_OBJECT' },
  });
}

async function conceptPriorityHandler(input: any) {
  return runAux({
    meta: META['concept-priority'],
    input,
    modelDefaults: () => ({ temperature: 0.3, maxTokens: 3000 }),
    buildUserPayload: (d) => ({ tasks: d.tasks, priorityContext: d.priorityContext, signal: d.signal }),
    normalize: (parsed) => ({
      upgradedTasks: Array.isArray(parsed?.upgradedTasks) ? parsed.upgradedTasks : [],
      upgradeReasons: Array.isArray(parsed?.upgradeReasons) ? parsed.upgradeReasons : [],
      confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0.7,
    }),
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'CONCEPT_PRIORITY_OUTPUT_NOT_OBJECT' },
  });
}

// ============================================================
// 注册表
// ============================================================

export const auxSkillDefinitions: SkillDefinition[] = Object.values(META).map(definition);

export const auxSkillDefinitionMap: Record<AuxSkillId, SkillDefinition> = Object.fromEntries(
  auxSkillDefinitions.map((def) => [def.name as AuxSkillId, def]),
) as Record<AuxSkillId, SkillDefinition>;

export const auxSkillHandlers: Record<AuxSkillId, (input: any) => Promise<SkillExecutionResult<any>>> = {
  'teaching-opening-generator': teachingOpeningGeneratorHandler,
  'session-evaluation-fallback': sessionEvaluationFallbackHandler,
  'learner-progress-report': learnerProgressReportHandler,
  'path-adjustment-generator': pathAdjustmentGeneratorHandler,
  'goal-analysis': goalAnalysisHandler,
  'generic-chat': genericChatHandler,
  'course-design': courseDesignHandler,
  'skill-author': skillAuthorHandler,
  'skill-compiler': skillCompilerHandler,
  'generic-planner': genericPlannerHandler,
  'basic-extractor': basicExtractorHandler,
  'basic-evaluator': basicEvaluatorHandler,
  'basic-generator': basicGeneratorHandler,
  'data-mapping': dataMappingHandler,
  'goal-alignment-checker': goalAlignmentCheckerHandler,
  'concept-priority': conceptPriorityHandler,
};
