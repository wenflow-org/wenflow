import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';

export const VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS = 8000;
export const VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE = 0.8;

// File-as-Truth：运行时生效的 ACTIVE prompt 由 prompts/core/*.yaml 编译而来，
// 这里只从编译产物加载，不内嵌第二份 prompt，避免双源漂移。
export const VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT =
  loadPromptFile('skill:virtual-learner-persona-designer')?.systemPrompt || '';

export const virtualLearnerPersonaDesignerDefinition: SkillDefinition = {
  name: 'virtual-learner-persona-designer',
  displayName: '虚拟学习者身份设计器',
  version: '1.2.0',
  category: 'generation',
  description: '为虚拟学习者生成稳定身份画像，不包含故事与情境',
  inputSchema: {
    type: 'object',
    properties: {
      preferredLevels: { type: 'array' },
      candidatePersonas: { type: 'array' },
      recentPersonaHints: { type: 'array' },
      existingPersonaSeed: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      personaSeed: { type: 'object' },
    },
  },
  capabilities: ['virtual-learner-persona-design'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

function sanitizeGeneratedText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(plan|build) mode\b/gi, ' ')
    .replace(/\s*CRITICAL:\s*/gi, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeString(value: any): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const sanitized = sanitizeGeneratedText(value);
  return sanitized || null;
}

function normalizeStringArray(value: any, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const next = value
    .map((item) => normalizeString(item))
    .filter((item): item is string => !!item);
  return next.length ? Array.from(new Set(next)) : fallback;
}

function normalizeConceptArray(value: any): string[] {
  return normalizeStringArray(value).slice(0, 4);
}

function isAllowedEnum<T extends string>(value: any, allowed: T[]): value is T {
  return allowed.includes(value);
}

const DEFAULT_CANDIDATE_PERSONAS = [
  '销售主管，常被临时消息打断',
  '运营专员，最近要独立做复盘',
  '产品经理，方案总是越写越散',
  '教培老师，课后复盘全凭感觉',
  '求职转行者，自学总在开头放弃',
  '大三学生，备考节奏很乱',
  '二胎妈妈，想重新建立学习时间',
  '门店店长，排班和复盘都很碎片化',
  '客服组长，沟通记录难以整理',
  '自由职业设计师，项目切换频繁',
  '财务助理，月末报表压力大',
  '社区工作者，信息整理任务很多',
  '短视频创作者，选题和复盘混乱',
  '大学辅导员，事务多且优先级难排',
  '高中英语老师，想提升讲后总结质量',
];

const DEFAULT_RECENT_PERSONA_HINTS = [
  '避免连续生成同类职业与同类年龄段的安全模板',
  '避免称呼总是小陈/小张/小李这类重复模板',
  '优先拉开职业背景、时间条件和求助风格的分布',
];

function validatePersonaOutput(parsed: any): { valid: boolean; failureReason?: string } {
  const personaSeed = parsed?.personaSeed && typeof parsed.personaSeed === 'object' ? parsed.personaSeed : parsed;
  if (!personaSeed || typeof personaSeed !== 'object') {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: personaSeed is required' };
  }

  // 核心必填（normalize 无法推导的）：nameHint + background + age
  // 其余字段（occupation/education/adversarialPattern 等）允许缺失——
  // normalizePersonaOutput 会用 background 等推导合理默认，避免 LLM 偶发漏 1 个字段
  // 就导致整个身份失败（批量场景尤其致命）。
  const coreRequired = ['nameHint', 'background'];
  const missingFields = coreRequired.filter((field) => !normalizeString(personaSeed[field]));
  if (missingFields.length > 0) {
    return { valid: false, failureReason: `PERSONA_OUTPUT_INVALID: missing required fields: ${missingFields.join(', ')}` };
  }

  if (!Number.isFinite(Number(personaSeed.age))) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: age must be a number' };
  }

  // 概念/驱动数组：对抗行为依据（friction 引用），保持必填——缺失会让模拟器对抗失真。
  if (normalizeConceptArray(personaSeed.knownConcepts).length === 0) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: knownConcepts must contain at least one item' };
  }

  if (normalizeConceptArray(personaSeed.struggleConcepts).length === 0) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: struggleConcepts must contain at least one item' };
  }

  if (normalizeStringArray(personaSeed.personalityDrivers).length === 0) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: personalityDrivers must contain at least one item' };
  }

  if (normalizeStringArray(personaSeed.emotionalTriggers).length === 0) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: emotionalTriggers must contain at least one item' };
  }

  if (normalizeStringArray(personaSeed.failurePatterns).length === 0) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: failurePatterns must contain at least one item' };
  }

  // 枚举字段：提供时必须合法；缺失时 normalize 兜底默认值
  if (personaSeed.learningStyle !== undefined && !isAllowedEnum(personaSeed.learningStyle, ['reading', 'watching', 'doing', 'listening'])) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: learningStyle is invalid' };
  }

  if (personaSeed.availableTime !== undefined && !isAllowedEnum(personaSeed.availableTime, ['minimal', 'moderate', 'abundant'])) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: availableTime is invalid' };
  }

  if (personaSeed.techComfort !== undefined && !isAllowedEnum(personaSeed.techComfort, ['low', 'medium', 'high'])) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: techComfort is invalid' };
  }

  return { valid: true };
}

function normalizePersonaOutput(raw: any) {
  const personaSeed = raw?.personaSeed && typeof raw.personaSeed === 'object' ? raw.personaSeed : raw || {};
  const selfAwarenessPattern = normalizeString(personaSeed.selfAwarenessPattern);
  const planningFollowThroughRaw = normalizeString(personaSeed.planningFollowThrough);
  const overloadReactionRaw = normalizeString(personaSeed.overloadReaction);

  // 校验枚举 helper
  const enumOrNull = <T extends string>(value: any, allowed: T[]): T | null =>
    (allowed.includes(value as T) ? (value as T) : null)

  // 必填字段智能兜底：LLM 偶发漏字段（尤其 adversarialPattern/occupation 这类"难"字段），
  // 若直接返回 null → validate 整体失败 → 整个身份被放弃（批量场景尤其致命）。
  // 用已有字段推导合理默认，保证身份能生成（该字段后续可人工补全/重生成）。
  const occupationRaw = normalizeString(personaSeed.occupation);
  const backgroundRaw = normalizeString(personaSeed.background);
  const helpSeekingRaw = normalizeString(personaSeed.helpSeekingPattern);
  const failurePatternsRaw = normalizeStringArray(personaSeed.failurePatterns);
  const emotionalTriggersRaw = normalizeStringArray(personaSeed.emotionalTriggers);
  const struggleRaw = normalizeConceptArray(personaSeed.struggleConcepts);
  const corePersonalityRaw = normalizeString(personaSeed.corePersonality);
  const emotionalBaselineRaw = normalizeString(personaSeed.emotionalBaseline);

  const occupation = occupationRaw
    || (backgroundRaw ? backgroundRaw.split(/[，,。；;]/)[0].slice(0, 20) : null)
    || '职场学习者';
  const education = normalizeString(personaSeed.education) || (backgroundRaw ? '在职学习' : '自学');
  const background = backgroundRaw || `${occupation}，日常学习时间有限，希望高效补上实用技能`;
  const corePersonality = corePersonalityRaw || '务实、目标导向，遇到困难先自己尝试再求助';
  const emotionalBaseline = emotionalBaselineRaw || '情绪平稳，压力大时略显焦虑但不外露';
  const helpSeekingPattern = helpSeekingRaw || '先自己琢磨，实在不行才向老师或同事求助';
  const adversarialPattern = normalizeString(personaSeed.adversarialPattern)
    || (failurePatternsRaw.length ? `遇到挫折时容易${failurePatternsRaw[0]}，需要引导回到正轨` : '遇到困难时容易回避或拖延，需要明确的小步骤引导')
    || '遇到困难时容易回避或拖延，需要明确的小步骤引导';
  const selfAwareness = selfAwarenessPattern || '清楚自己的短板，但不太会拆解成可执行的小目标';
  const planningFollowThrough = planningFollowThroughRaw || '计划容易立，执行容易打折，需要外部节奏推着走';
  const overloadReaction = overloadReactionRaw || '信息一多就容易乱，需要把任务拆小';
  const memoryRepairPattern = normalizeString(personaSeed.memoryRepairPattern) || '学过的东西容易忘，需要结合实例反复练习';
  const behavioralProfileSummary = normalizeString(personaSeed.behavioralProfileSummary)
    || `${occupation}，${corePersonality}；遇到${struggleRaw.length ? struggleRaw.join('、') : '学习困难'}时${adversarialPattern}。`;
  const knownConcepts = normalizeConceptArray(personaSeed.knownConcepts);
  const struggleConcepts = normalizeConceptArray(personaSeed.struggleConcepts);
  const learningStyle = isAllowedEnum(personaSeed.learningStyle, ['reading', 'watching', 'doing', 'listening']) ? personaSeed.learningStyle : 'doing';
  const availableTime = isAllowedEnum(personaSeed.availableTime, ['minimal', 'moderate', 'abundant']) ? personaSeed.availableTime : 'moderate';
  const techComfort = isAllowedEnum(personaSeed.techComfort, ['low', 'medium', 'high']) ? personaSeed.techComfort : 'medium';

  // 补齐 scenario-designer 完整 schema 中的关键字段, 让两个 skill 互通
  // (LLM 没生成时 fallback 默认值, 让下游 simulator 至少能识别字段名)
  const motivationType = enumOrNull(personaSeed.motivationType, ['career', 'interest', 'necessity', 'social'] as const) || 'career'
  const personalityTraitsRaw = personaSeed.personalityTraits || {}
  const personalityTraits = {
    verbosity: enumOrNull(personalityTraitsRaw.verbosity, ['terse', 'normal', 'verbose'] as const) || 'normal',
    enthusiasm: enumOrNull(personalityTraitsRaw.enthusiasm, ['low', 'normal', 'high'] as const) || 'normal',
    confusionStyle: enumOrNull(personalityTraitsRaw.confusionStyle, ['direct', 'hinting'] as const) || 'direct',
    patience: enumOrNull(personalityTraitsRaw.patience, ['low', 'normal', 'high'] as const) || 'normal',
    questionStyle: enumOrNull(personalityTraitsRaw.questionStyle, ['none', 'clarifying', 'challenging'] as const) || 'clarifying',
    emotionalRange: enumOrNull(personalityTraitsRaw.emotionalRange, ['flat', 'moderate', 'expressive'] as const) || 'moderate',
  }

  return {
    personaSeed: {
      nameHint: normalizeString(personaSeed.nameHint) || occupation,
      age: Math.max(18, Math.min(60, Number(personaSeed.age))),
      occupation,
      education,
      background,
      knownConcepts: knownConcepts.length ? knownConcepts : ['基础概念'],
      struggleConcepts: struggleConcepts.length ? struggleConcepts : ['方法不清晰'],
      learningStyle,
      availableTime,
      techComfort,
      corePersonality,
      emotionalBaseline,
      helpSeekingPattern,
      adversarialPattern,
      selfAwarenessPattern: selfAwareness,
      planningFollowThrough,
      overloadReaction,
      memoryRepairPattern,
      behavioralProfileSummary,
      // Backfill legacy field names so existing profile pages and session logic can keep working.
      metacognitiveProfile: normalizeString(personaSeed.metacognitiveProfile) || selfAwareness,
      selfRegulationStyle: normalizeString(personaSeed.selfRegulationStyle) || planningFollowThrough,
      cognitiveLoadTolerance: normalizeString(personaSeed.cognitiveLoadTolerance) || overloadReaction,
      // 补齐 scenario-designer 完整 schema 的字段 (兼容 simulator 的 friction 引用)
      motivationType,
      personalityDrivers: normalizeStringArray(personaSeed.personalityDrivers, ['完成当前学习目标']),
      emotionalTriggers: emotionalTriggersRaw.length ? emotionalTriggersRaw : ['遇到挫折'],
      failurePatterns: failurePatternsRaw.length ? failurePatternsRaw : ['半途而废'],
      personalityTraits,
      // 与 scenario-designer canonical 字段集对齐（可选，LLM 生成即保留）
      priorAttempts: normalizeString(personaSeed.priorAttempts) || undefined,
      communicationStyle: normalizeString(personaSeed.communicationStyle),
      motivationOrientation: normalizeString(personaSeed.motivationOrientation),
      resiliencePattern: normalizeString(personaSeed.resiliencePattern),
      digitalLiteracy: normalizeString(personaSeed.digitalLiteracy),
      behaviorBoundaries: normalizeStringArray(personaSeed.behaviorBoundaries),
      learningPreferences: normalizeStringArray(personaSeed.learningPreferences),
    }
  };
}

export { validatePersonaOutput, normalizePersonaOutput };

export async function virtualLearnerPersonaDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:virtual-learner-persona-designer',
      defaultSystemPrompt: VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-persona-designer' },
            buildUserPayload: (payload) => ({
        preferredLevels: normalizeStringArray(payload?.preferredLevels),
        // 候选池可空：不传/空 → 自由生成（不再兜底固定 15 职业池，消除职业天花板）
        candidatePersonas: normalizeStringArray(payload?.candidatePersonas),
        recentPersonaHints: normalizeStringArray(payload?.recentPersonaHints, DEFAULT_RECENT_PERSONA_HINTS),
        existingPersonaSeed: payload?.existingPersonaSeed && typeof payload.existingPersonaSeed === 'object' ? payload.existingPersonaSeed : undefined,
      }),
      validateParsedOutput: (parsed) => validatePersonaOutput(parsed),
      normalizeOutput: (parsed) => normalizePersonaOutput(parsed),
      mapEnvelope: (output, _input, runtimeContract) => mapSkillOutputEnvelope(runtimeContract, output, {
        phase: 'completed',
        isTerminal: true,
      }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) => `请只输出一个合法 JSON 对象，必须包含完整 personaSeed，所有必填字段都要具体、非空、可观察，禁止使用模板套话或占位词。上次失败原因：${failureReason}`
      }
    }, input || {});

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'VIRTUAL_LEARNER_PERSONA_DESIGN_FAILED');
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
        code: 'VIRTUAL_LEARNER_PERSONA_DESIGN_FAILED',
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerPersonaDesigner;
