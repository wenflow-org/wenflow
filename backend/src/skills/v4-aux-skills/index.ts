/**
 * v4 辅助 LLM Skills（由原遗留插件/旁路迁入）
 *
 * 统一约定：
 * - 所有 handler 只经 callPrompt 调用 ACTIVE prompt（requireActivePrompt）。
 * - 失败策略遵循 core 声明：propagate 技能失败时抛错；fallback 已退役（2026-08-11），
 *   存量 fallback 值防御性按 propagate 处理（见 resolveDefaultFailureMode）。
 * - 调用方通过输入对象中的保留字段注入调用上下文与显式兜底：
 *     __prompt:    PromptCallContext 透传（requestPath/userId/retryBudget/assistantMessages/...），
 *                  另支持 callerAgentId / callerAction（写入 gateway caller）。
 *     __fallback:  调用方显式注入的确定性兜底值（属调用方决策，不是系统降级；未提供时无降级）。
 *     __onFailure: 'throw' | 'fallback'，覆盖 core 声明的默认策略（用于必须保持既有抛出契约的调用点）。
 */
import { callPrompt } from '../../composers/prompt-composer';
import { currentTeachingSessionId } from '../../services/ai-teaching/teaching-session-context';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import type { PromptCallContext } from '../../composers/types';
import type { SkillDefinition, SkillExecutionResult } from '../protocol';
import { agentConfigService } from '../../services/agentConfig.service';
import { resolveEffectivePromptContract } from '../../services/prompt-lab/resolve-prompt-contract';
import { logger } from '../../utils/logger';

export type AuxSkillId =
  | 'teaching-opening-generator'
  | 'learner-progress-report'
  | 'skill-author'
  | 'skill-compiler'
  | 'learner-state-review'
  | 'concept-consolidator'
  | 'concept-load-estimator'
  | 'replan-attribution'
  | 'triage-judge';

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const AUX_SKILL_PROMPTS: Record<AuxSkillId, string> = {
  'teaching-opening-generator': loadPromptFile('skill:teaching-opening-generator')?.systemPrompt || '',
  'learner-progress-report': loadPromptFile('skill:learner-progress-report')?.systemPrompt || '',
  'skill-author': loadPromptFile('skill:skill-author')?.systemPrompt || '',
  'skill-compiler': loadPromptFile('skill:skill-compiler')?.systemPrompt || '',
  'learner-state-review': loadPromptFile('skill:learner-state-review')?.systemPrompt || '',
  'concept-consolidator': loadPromptFile('skill:concept-consolidator')?.systemPrompt || '',
  'concept-load-estimator': loadPromptFile('skill:concept-load-estimator')?.systemPrompt || '',
  'replan-attribution': loadPromptFile('skill:replan-attribution')?.systemPrompt || '',
  'triage-judge': loadPromptFile('skill:triage-judge')?.systemPrompt || '',
};

interface AuxPlumbing extends PromptCallContext {
  callerAgentId?: string;
  callerAction?: string;
}

interface AuxSkillMeta {
  skillId: AuxSkillId;
  displayName: string;
  description: string;
  category: SkillDefinition['category'];
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

/**
 * 把「文本动作选项」的多种模型表述收敛为 `{ text }[]`：
 * - `{ text: string }` → 规范化
 * - `string` 简写 → `{ text }`（模型常直接把 quickReplies 写成 string[]）
 * 非法/空项丢弃，最多保留 3 个。
 */
function coerceTextOptions(value: any): Array<{ text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any): { text: string } | null => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { text } : null;
      }
      if (item && typeof item === 'object' && typeof item.text === 'string') {
        const text = item.text.trim();
        return text ? { text } : null;
      }
      return null;
    })
    .filter((item: { text: string } | null): item is { text: string } => item !== null)
    .slice(0, 3);
}

interface RunAuxOptions<TOutput> {
  meta: AuxSkillMeta;
  input: any;
  buildUserPayload: (domain: any) => any;
  normalize: (parsed: any, domain: any, fallback: any) => TOutput;
  validate?: (parsed: any) => { valid: true } | { valid: false; failureReason: string };
  /** 契约校验前的容错归一（模型输出的等价变体 → core 声明形态）；不影响 normalize */
  coerceParse?: (parsed: any) => any;
  /** LLM 侧整轮重试（如返回非 JSON）；不传则沿用 callPrompt 默认（不重试） */
  retryStrategy?: { maxAttempts: number };
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
  // 调用方显式传入的生成参数（model/temperature/maxTokens）提升为调用点级覆盖，
  // 优先级高于 ACTIVE prompt（core params）与路由配置。
  const generationOverride = {
    ...(domain.model !== undefined && domain.model !== null ? { model: domain.model } : {}),
    ...(domain.temperature !== undefined && domain.temperature !== null ? { temperature: domain.temperature } : {}),
    ...(domain.maxTokens !== undefined && domain.maxTokens !== null ? { maxTokens: domain.maxTokens } : {}),
  };
  const hasCallerFallback = callerFallback !== undefined;
  const resolveFallback = (): TOutput => hasCallerFallback
    ? callerFallback
    : opts.builtinFallback
      ? opts.builtinFallback(domain)
      : (null as TOutput);

  try {
    const result = await callPrompt<any, TOutput>({
      agentId: `skill:${opts.meta.skillId}`,
      defaultSystemPrompt: AUX_SKILL_PROMPTS[opts.meta.skillId] || '',
      requireActivePrompt: true,
      caller: { skillId: opts.meta.skillId, agentId: callerAgentId, action: callerAction },
      ...(opts.prepareSystemPrompt
        ? { prepareSystemPrompt: (systemPrompt: string) => Promise.resolve(opts.prepareSystemPrompt!(systemPrompt, domain)) }
        : {}),
      buildUserPayload: () => opts.buildUserPayload(domain),
      normalizeOutput: (parsed) => opts.normalize(parsed, domain, callerFallback),
      ...(opts.coerceParse
        ? { coerceParsedForContract: (parsed: any) => opts.coerceParse!(parsed) }
        : {}),
      ...(opts.retryStrategy ? { retryStrategy: opts.retryStrategy } : {}),
      validateParsedOutput: opts.validate || ((parsed) => parsed !== undefined && parsed !== null
        ? { valid: true }
        : { valid: false, failureReason: `${opts.meta.skillId.toUpperCase().replace(/-/g, '_')}_OUTPUT_EMPTY` }),
    }, domain, {
      ...promptContext,
      // 会话归属兜底（审计 §5.2 P2 尾巴）：调用方没显式给 sessionId 时，用「当前教学会话」作用域的值——
      // 收束流程里的 aux skill 因此能把 LLM 成本归到那一节课（不在作用域内则为 undefined，行为同改造前）
      ...(promptContext.sessionId || !currentTeachingSessionId()
        ? {}
        : { sessionId: currentTeachingSessionId() as string }),
      ...(Object.keys(generationOverride).length > 0 ? { generationOverride } : {}),
    });
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
    // 失败策略运行时从 ACTIVE prompt（core params.failurePolicy 编译产物）解析，
    // 调用方 __onFailure 显式覆盖优先；不再在代码里维护第二份拷贝。
    const effectiveMode = onFailureOverride || await resolveDefaultFailureMode(opts.meta.skillId);
    if (effectiveMode === 'throw') throw error;
    return {
      success: true,
      output: resolveFallback(),
      duration: Date.now() - start,
      quality: 'fallback',
    };
  }
}

/**
 * 解析 skill 默认失败策略：读取 ACTIVE prompt 的 promptContract.failurePolicy。
 * 映射：retry / blocking（core retry / propagate）→ 抛错；deterministic-fallback / best-effort
 * 为已退役词表（2026-08-11 纯重试+明确失败改造后 core 无 fallback 值）——防御性兜底：
 * 若存量数据仍带这些值，按 propagate（抛错）处理并 warn，不再产出降级产物。
 * 读取失败时保守抛错（fail loud）。
 */
async function resolveDefaultFailureMode(skillId: AuxSkillId): Promise<'throw' | 'fallback'> {
  try {
    const agentId = `skill:${skillId}`;
    const promptConfig = await agentConfigService.getActivePrompt(agentId);
    const { contract } = await resolveEffectivePromptContract(agentId, promptConfig);
    if (['deterministic-fallback', 'best-effort'].includes(contract.failurePolicy)) {
      logger.warn(`[runAux] ${skillId} 的 failurePolicy=${contract.failurePolicy} 已退役（fallback 语义下线），按 propagate 抛错处理`);
      return 'throw';
    }
    return 'throw';
  } catch {
    return 'throw';
  }
}

// ============================================================
// Skill 元数据（failurePolicy 运行时从 ACTIVE prompt 解析，见 resolveDefaultFailureMode）
// ============================================================

const META: Record<AuxSkillId, AuxSkillMeta> = {
  'teaching-opening-generator': { skillId: 'teaching-opening-generator', displayName: '课堂开场交互生成器', description: '生成教学 Session 的开场 message、question 与 quickReplies', category: 'generation' },
  'learner-progress-report': { skillId: 'learner-progress-report', displayName: '学习进展报告生成器', description: '基于学习指标和信号生成简短进展反馈', category: 'analysis' },
  'skill-author': { skillId: 'skill-author', displayName: 'Prompt 起草助手', description: '为新 Skill 起草 system prompt', category: 'generation' },
  'skill-compiler': { skillId: 'skill-compiler', displayName: 'Skill Prompt 验收器', description: '执行 system prompt 并检查必填字段覆盖情况', category: 'analysis' },
  'learner-state-review': { skillId: 'learner-state-review', displayName: '学习状态评审诊断器', description: '基于状态摘要与证据给出可证伪的学习状态诊断（为什么卡、下一步怎么调）', category: 'analysis' },
  'concept-consolidator': { skillId: 'concept-consolidator', displayName: '概念身份归并器', description: '判断多个知识点名字里哪些是同一个概念的不同说法，输出可执行、可审计的归并建议', category: 'analysis' },
  'concept-load-estimator': { skillId: 'concept-load-estimator', displayName: '概念负担判定器', description: '逐概念判定粒度/知识类型/检索难度档位，供温故配额按认知负担裁剪', category: 'analysis' },
  'replan-attribution': { skillId: 'replan-attribution', displayName: '路径重排归因器', description: '在阈值召回的重排建议上给出主因、方向与一条可证伪断言', category: 'analysis' },
  'triage-judge': { skillId: 'triage-judge', displayName: '需求分流判官', description: '判断真实诉求是否存在可迁移的因果心智、以及会不会反复发生（决定"要不要排路径"）', category: 'analysis' },
};

// ============================================================
// Handlers
// ============================================================

async function teachingOpeningGeneratorHandler(input: any) {
  return runAux({
    meta: META['teaching-opening-generator'],
    input,
    buildUserPayload: (d) => (process.env.PAYLOAD_STABLE_PREFIX !== '0'
      ? {
          learner: d.learner,
          openingMode: d.openingMode,
          // core rules 引用 priorLearningContext（前序承接）；caller 已传，此前漏在 payload 外
          ...(d.priorLearningContext ? { priorLearningContext: d.priorLearningContext } : {}),
          subject: d.subject,
          pathSummary: d.pathSummary,
          taskType: d.taskType,
          currentMilestoneTitle: d.currentMilestoneTitle,
          topic: d.topic,
          taskTitle: d.taskTitle,
          taskDescription: d.taskDescription,
          ...(d.learningSignal ? { learningSignal: d.learningSignal } : {}),
          ...(d.lastLessonRecap ? { lastLessonRecap: d.lastLessonRecap } : {}),
        }
      : {
          subject: d.subject,
          topic: d.topic,
          taskTitle: d.taskTitle,
          taskDescription: d.taskDescription,
          taskType: d.taskType,
          pathSummary: d.pathSummary,
          currentMilestoneTitle: d.currentMilestoneTitle,
          learner: d.learner,
          openingMode: d.openingMode,
          ...(d.priorLearningContext ? { priorLearningContext: d.priorLearningContext } : {}),
          ...(d.learningSignal ? { learningSignal: d.learningSignal } : {}),
          ...(d.lastLessonRecap ? { lastLessonRecap: d.lastLessonRecap } : {}),
        }),
    normalize: (parsed, d) => ({
      message: asTrimmedString(parsed?.message),
      question: asTrimmedString(parsed?.question),
      quickReplies: coerceTextOptions(parsed?.quickReplies),
      mode: ['example-first', 'predict', 'self-assess'].includes(parsed?.mode) ? parsed.mode : d.openingMode,
    }),
    // 模型有时把 quickReplies 写成 string[]（core 声明为 object[]）；契约校验前补成 [{ text }]，
    // 避免因表述差异整轮失败（normalize 同样兼容两种形态）。
    coerceParse: (parsed) => (parsed && typeof parsed === 'object'
      ? { ...parsed, quickReplies: coerceTextOptions(parsed.quickReplies) }
      : parsed),
    validate: (parsed) => parsed
      && asTrimmedString(parsed.message)
      // quickReplies/question/mode 可缺省（重学/收束等场景模型可合理省略动作与引导，
      // 由 message 完成开场定位）；normalize 已对缺省值做兜底
      ? { valid: true }
      : { valid: false, failureReason: 'TEACHING_OPENING_MESSAGE_MISSING' },
  });
}

async function learnerProgressReportHandler(input: any) {
  return runAux({
    meta: META['learner-progress-report'],
    input,
    buildUserPayload: (d) => (process.env.PAYLOAD_STABLE_PREFIX !== '0'
      ? { signals: d.signals, metrics: d.metrics, task: d.task }
      : { task: d.task, metrics: d.metrics, signals: d.signals }),
    normalize: (parsed, _d, fb) => ({
      reasoning: asTrimmedString(parsed?.reasoning) || fb?.reasoning || '基于当前学习数据，你正在稳步推进学习进度。',
      suggestion: asTrimmedString(parsed?.suggestion) || fb?.suggestion || '继续保持当前学习节奏，遇到困难时先回顾前置知识点。',
    }),
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'LEARNER_PROGRESS_REPORT_OUTPUT_NOT_OBJECT' },
  });
}

async function skillAuthorHandler(input: any) {
  return runAux<string>({
    meta: META['skill-author'],
    input,
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
        buildUserPayload: (d) => d,
    normalize: (parsed) => parsed,
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'SKILL_COMPILER_OUTPUT_NOT_OBJECT' },
  });
}

async function learnerStateReviewHandler(input: any) {
  return runAux({
    meta: META['learner-state-review'],
    input,
    buildUserPayload: (d) => ({
      learnerDigest: d.learnerDigest,
      knowledgeDigest: d.knowledgeDigest,
      recentEvidence: Array.isArray(d.recentEvidence) ? d.recentEvidence : [],
      priorInsights: Array.isArray(d.priorInsights) ? d.priorInsights : [],
    }),
    normalize: (parsed, d) => {
      const knownEvidenceIds = new Set(
        (Array.isArray((d as any)?.recentEvidence) ? (d as any).recentEvidence : [])
          .map((entry: any) => asTrimmedString(entry?.id))
          .filter(Boolean),
      );
      const insights = (Array.isArray(parsed?.insights) ? parsed.insights : [])
        .filter((item: any) => item && asTrimmedString(item.claim))
        .map((item: any) => ({
          type: asTrimmedString(item.type) || 'strategy_fit',
          claim: asTrimmedString(item.claim),
          evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs.map((x: any) => asTrimmedString(x)).filter(Boolean) : [],
          confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : null,
          action: asTrimmedString(item.action),
        }))
        // 护栏：无证据引用即丢弃；已知证据集非空时过滤不存在的引用，过滤后为空仍丢弃
        .map((item: any) => (knownEvidenceIds.size > 0
          ? { ...item, evidenceRefs: item.evidenceRefs.filter((ref: string) => knownEvidenceIds.has(ref)) }
          : item))
        .filter((item: any) => item.evidenceRefs.length > 0)
        .slice(0, 5);
      const conceptAssessments = (Array.isArray(parsed?.conceptAssessments) ? parsed.conceptAssessments : [])
        .filter((item: any) => item && asTrimmedString(item.conceptKey))
        .slice(0, 20)
        .map((item: any) => ({
          conceptKey: asTrimmedString(item.conceptKey),
          observed: item.observed === 'not' ? 'not' : 'mastered',
          masteryBand: ['low', 'medium', 'high'].includes(item.masteryBand) ? item.masteryBand : 'medium',
          rationale: asTrimmedString(item.rationale),
          evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs.map((x: any) => asTrimmedString(x)).filter(Boolean) : [],
        }));
      const falsifiableClaims = (Array.isArray(parsed?.falsifiableClaims) ? parsed.falsifiableClaims : [])
        .filter((item: any) => item && asTrimmedString(item.claim))
        .slice(0, 3)
        .map((item: any) => ({
          claim: asTrimmedString(item.claim),
          checkOn: ['next_lesson', 'next_task', 'next_review'].includes(item.checkOn) ? item.checkOn : 'next_lesson',
          expect: asTrimmedString(item.expect),
        }));
      return { insights, conceptAssessments, falsifiableClaims, narrative: asTrimmedString(parsed?.narrative) };
    },
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'LEARNER_STATE_REVIEW_OUTPUT_NOT_OBJECT' },
  });
}

/**
 * 概念身份归并器：**护栏放在 normalize 里**（它有原始输入 candidates）。
 * 模型只出建议；这里保证 ① canonical/aliases 必须来自输入（不许新造概念）
 * ② 同一族只保留一条 merge ③ 数量封顶。词面相似度闸门由服务层算（那是执行策略，不是解析）。
 */
async function conceptConsolidatorHandler(input: any) {
  return runAux({
    meta: META['concept-consolidator'],
    input,
    buildUserPayload: (d) => ({
      candidates: Array.isArray(d.candidates) ? d.candidates : [],
      canonicalWhitelist: Array.isArray(d.canonicalWhitelist) ? d.canonicalWhitelist : [],
      aliasMap: d.aliasMap && typeof d.aliasMap === 'object' ? d.aliasMap : {},
    }),
    normalize: (parsed, d) => {
      const known = new Set(
        (Array.isArray(d?.candidates) ? d.candidates : [])
          .map((item: any) => asTrimmedString(item?.conceptKey))
          .filter(Boolean),
      );
      const claimed = new Set<string>();
      const merges = (Array.isArray(parsed?.merges) ? parsed.merges : [])
        .filter((item: any) => item && asTrimmedString(item.canonical))
        .map((item: any) => {
          const canonical = asTrimmedString(item.canonical);
          const aliases = Array.from(new Set(
            (Array.isArray(item.aliases) ? item.aliases : [])
              .map((x: any) => asTrimmedString(x))
              .filter((x: string) => x && x !== canonical),
          ));
          return {
            canonical,
            aliases,
            confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0,
            rationale: asTrimmedString(item.rationale),
          };
        })
        // 护栏：canonical/aliases 必须都在输入里；aliases 非空；同一 canonical 与 alias 只出现一次
        .filter((item: any) => item.aliases.length > 0
          && known.has(item.canonical)
          && item.aliases.every((alias: string) => known.has(alias)))
        .filter((item: any) => {
          const conflict = claimed.has(item.canonical) || item.aliases.some((alias: string) => claimed.has(alias));
          if (conflict) return false;
          claimed.add(item.canonical);
          item.aliases.forEach((alias: string) => claimed.add(alias));
          return true;
        })
        .slice(0, 15);

      const ambiguous = (Array.isArray(parsed?.ambiguous) ? parsed.ambiguous : [])
        .filter((item: any) => item && known.has(asTrimmedString(item.a)) && known.has(asTrimmedString(item.b)))
        .slice(0, 20)
        .map((item: any) => ({
          a: asTrimmedString(item.a),
          b: asTrimmedString(item.b),
          reason: asTrimmedString(item.reason),
        }));

      const dropCandidates = (Array.isArray(parsed?.dropCandidates) ? parsed.dropCandidates : [])
        .filter((item: any) => item && known.has(asTrimmedString(item.conceptKey)))
        .slice(0, 10)
        .map((item: any) => ({
          conceptKey: asTrimmedString(item.conceptKey),
          reason: asTrimmedString(item.reason),
        }));

      return { merges, ambiguous, dropCandidates };
    },
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'CONCEPT_CONSOLIDATOR_OUTPUT_NOT_OBJECT' },
  });
}

/**
 * 概念负担判定器：护栏同样放在 normalize（只认输入里出现过的 conceptKey，枚举兜底）。
 * LLM 只出**档位**（atomic/cluster、factual/…、low/medium/high），数值权重由
 * concept-load.service 的公式给 —— 不让模型自报分数（LEARNER_STATE_REVIEW_DESIGN §2.2）。
 */
async function conceptLoadEstimatorHandler(input: any) {
  return runAux({
    meta: META['concept-load-estimator'],
    input,
    buildUserPayload: (d) => ({
      concepts: (Array.isArray(d.concepts) ? d.concepts : []).map((item: any) => ({
        conceptKey: asTrimmedString(item?.conceptKey),
      })).filter((item: any) => item.conceptKey),
    }),
    normalize: (parsed, d) => {
      const known = new Set(
        (Array.isArray(d?.concepts) ? d.concepts : [])
          .map((item: any) => asTrimmedString(item?.conceptKey))
          .filter(Boolean),
      );
      const granularityEnum = new Set(['atomic', 'cluster']);
      const knowledgeTypeEnum = new Set(['factual', 'conceptual', 'procedural', 'metacognitive']);
      const difficultyEnum = new Set(['low', 'medium', 'high', 'unknown']);
      const seen = new Set<string>();
      const concepts = (Array.isArray(parsed?.concepts) ? parsed.concepts : [])
        .map((item: any) => ({
          conceptKey: asTrimmedString(item?.conceptKey),
          granularity: granularityEnum.has(asTrimmedString(item?.granularity)) ? asTrimmedString(item.granularity) : 'atomic',
          knowledgeType: knowledgeTypeEnum.has(asTrimmedString(item?.knowledgeType)) ? asTrimmedString(item.knowledgeType) : 'conceptual',
          difficultyBand: difficultyEnum.has(asTrimmedString(item?.difficultyBand)) ? asTrimmedString(item.difficultyBand) : 'unknown',
          rationale: asTrimmedString(item?.rationale).slice(0, 80),
        }))
        // 护栏：只认输入里出现过的原文键，且每个键只取一条
        .filter((item: any) => item.conceptKey && known.has(item.conceptKey) && !seen.has(item.conceptKey))
        .map((item: any) => {
          seen.add(item.conceptKey);
          return item;
        })
        .slice(0, 40);
      return { concepts };
    },
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'CONCEPT_LOAD_ESTIMATOR_OUTPUT_NOT_OBJECT' },
  });
}

/**
 * 路径重排归因器：护栏 = 主因必须来自 recall.reasonCodes、方向必须来自 allowedRecommendations、
 * 证据引用必须来自输入 evidence。阈值仍是唯一召回门——本 skill 只能在召回允许的范围内选方向。
 */
async function replanAttributionHandler(input: any) {
  return runAux({
    meta: META['replan-attribution'],
    input,
    buildUserPayload: (d) => ({
      recall: {
        reasonCodes: Array.isArray(d?.recall?.reasonCodes) ? d.recall.reasonCodes : [],
        recommendation: asTrimmedString(d?.recall?.recommendation),
        priority: asTrimmedString(d?.recall?.priority),
        rationale: asTrimmedString(d?.recall?.rationale),
      },
      allowedRecommendations: Array.isArray(d?.allowedRecommendations) ? d.allowedRecommendations : [],
      evidence: Array.isArray(d?.evidence) ? d.evidence : [],
      ...(d?.pathContext ? { pathContext: d.pathContext } : {}),
    }),
    normalize: (parsed, d) => {
      const allowedReasons: string[] = (Array.isArray(d?.recall?.reasonCodes) ? d.recall.reasonCodes : [])
        .map((item: any) => asTrimmedString(item))
        .filter(Boolean);
      const allowedRecommendations: string[] = (Array.isArray(d?.allowedRecommendations) ? d.allowedRecommendations : [])
        .map((item: any) => asTrimmedString(item))
        .filter(Boolean);
      const knownEvidenceIds = new Set(
        (Array.isArray(d?.evidence) ? d.evidence : [])
          .map((item: any) => asTrimmedString(item?.id))
          .filter(Boolean),
      );
      const recommendation = asTrimmedString(parsed?.recommendation);
      const primaryReasonCode = asTrimmedString(parsed?.primaryReasonCode);
      const evidenceRefs = (Array.isArray(parsed?.evidenceRefs) ? parsed.evidenceRefs : [])
        .map((item: any) => asTrimmedString(item))
        .filter((id: string) => id && (knownEvidenceIds.size === 0 || knownEvidenceIds.has(id)));
      return {
        primaryReasonCode: allowedReasons.includes(primaryReasonCode) ? primaryReasonCode : (allowedReasons[0] || ''),
        recommendation: allowedRecommendations.includes(recommendation) ? recommendation : 'keep',
        reason: asTrimmedString(parsed?.reason).slice(0, 60),
        claim: asTrimmedString(parsed?.claim).slice(0, 80),
        checkOn: ['next_lesson', 'next_task'].includes(asTrimmedString(parsed?.checkOn)) ? asTrimmedString(parsed.checkOn) : 'next_lesson',
        expect: asTrimmedString(parsed?.expect).slice(0, 40),
        evidenceRefs,
      };
    },
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'REPLAN_ATTRIBUTION_OUTPUT_NOT_OBJECT' },
  });
}

/**
 * 需求分流判官：LLM 只判两个观测（transferable / recurrence），
 * **档位 artifact 由代码推导**（LLM 出观测、档位由代码裁决——与 replan-attribution 同一纪律）。
 * 依据：60 例混合数据实测，blockType 与 recurrence 几乎正交，按类型分流会误杀 13 例。
 */
async function triageJudgeHandler(input: any) {
  return runAux({
    meta: META['triage-judge'],
    input,
    buildUserPayload: (d) => ({
      request: asTrimmedString(d.request),
      context: asTrimmedString(d.context),
      background: asTrimmedString(d.background),
    }),
    normalize: (parsed) => {
      const rawTransferable = parsed?.transferable;
      const transferable = rawTransferable === true ? true : rawTransferable === false ? false : null;
      const recurrenceRaw = asTrimmedString(parsed?.recurrence).toLowerCase();
      const recurrence = recurrenceRaw === 'once' || recurrenceRaw === 'recurring' ? recurrenceRaw : 'unknown';
      // 档位由代码裁决（不采信模型自造的取值）。缺省收敛到**最小产物**：
      // 未知/一次性 → 步骤卡；不确定（transferable=null）→ 一节；只有可迁移才给路径。
      // 理由：两个方向的错误代价不对称——给多了是"通胀"（7.4h 传照片课），给少了用户能自己升上来。
      const artifact = transferable === true
        ? 'path'
        : transferable === false
          ? (recurrence === 'recurring' ? 'short_course' : 'one_off')
          : 'short_course';
      const confidenceRaw = asTrimmedString(parsed?.confidence).toLowerCase();
      const positiveNumber = (v: any): number | null => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
      };
      return {
        transferable,
        recurrence,
        artifact,
        // 体量估算（课次锚）：totalSessions × sessionsLengthMin 就是体量
        totalSessions: positiveNumber(parsed?.totalSessions),
        sessionsLengthMin: positiveNumber(parsed?.sessionsLengthMin),
        evidence: asTrimmedString(parsed?.evidence).slice(0, 80),
        misdiagnosis: asTrimmedString(parsed?.misdiagnosis).slice(0, 60) || null,
        confidence: ['high', 'medium', 'low'].includes(confidenceRaw) ? confidenceRaw : 'low',
      };
    },
    // 契约容错（2026-09-21）：实测 4/10 例**整轮失败**（枚举取值不合法 / 数字给成字符串 / 返回非 JSON），
    // 失败即静默回退到"只有 availableTime 枚举"的老路 ⇒ 对 moderate/abundant 的人完全没有保护。
    // 这里在契约校验前把等价变体收敛到 core 声明形态；判据本身仍交给 normalize。
    coerceParse: (parsed: any) => {
      if (!parsed || typeof parsed !== 'object') return parsed;
      const recurrenceRaw = asTrimmedString(parsed.recurrence).toLowerCase();
      const confidenceRaw = asTrimmedString(parsed.confidence).toLowerCase();
      const num = (v: any): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      return {
        ...parsed,
        transferable: parsed.transferable === true || parsed.transferable === 'true'
          ? true
          : parsed.transferable === false || parsed.transferable === 'false'
            ? false
            : null,
        recurrence: ['once', 'recurring', 'unknown'].includes(recurrenceRaw)
          ? recurrenceRaw
          : (['daily', 'weekly', 'monthly', 'often', 'repeat', 'repeated', 'recur'].includes(recurrenceRaw)
            ? 'recurring'
            : 'unknown'),
        confidence: ['high', 'medium', 'low'].includes(confidenceRaw) ? confidenceRaw : 'low',
        totalSessions: num(parsed.totalSessions),
        sessionsLengthMin: num(parsed.sessionsLengthMin),
      };
    },
    retryStrategy: { maxAttempts: 2 },
    validate: (parsed) => parsed && typeof parsed === 'object'
      ? { valid: true }
      : { valid: false, failureReason: 'TRIAGE_JUDGE_OUTPUT_NOT_OBJECT' },
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
  'learner-progress-report': learnerProgressReportHandler,
  'skill-author': skillAuthorHandler,
  'skill-compiler': skillCompilerHandler,
  'learner-state-review': learnerStateReviewHandler,
  'concept-consolidator': conceptConsolidatorHandler,
  'concept-load-estimator': conceptLoadEstimatorHandler,
  'replan-attribution': replanAttributionHandler,
  'triage-judge': triageJudgeHandler,
};
