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
  version: '1.1.0',
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

  const requiredStringFields = [
    'nameHint',
    'occupation',
    'education',
    'background',
    'corePersonality',
    'emotionalBaseline',
    'helpSeekingPattern',
    'adversarialPattern',
    'selfAwarenessPattern',
    'planningFollowThrough',
    'overloadReaction',
    'memoryRepairPattern',
    'behavioralProfileSummary',
  ];

  const missingFields = requiredStringFields.filter((field) => !normalizeString(personaSeed[field]));
  if (missingFields.length > 0) {
    return { valid: false, failureReason: `PERSONA_OUTPUT_INVALID: missing required fields: ${missingFields.join(', ')}` };
  }

  if (!Number.isFinite(Number(personaSeed.age))) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: age must be a number' };
  }

  if (normalizeConceptArray(personaSeed.knownConcepts).length === 0) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: knownConcepts must contain at least one item' };
  }

  if (normalizeConceptArray(personaSeed.struggleConcepts).length === 0) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: struggleConcepts must contain at least one item' };
  }

  if (!isAllowedEnum(personaSeed.learningStyle, ['reading', 'watching', 'doing', 'listening'])) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: learningStyle is invalid' };
  }

  if (!isAllowedEnum(personaSeed.availableTime, ['minimal', 'moderate', 'abundant'])) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: availableTime is invalid' };
  }

  if (!isAllowedEnum(personaSeed.techComfort, ['low', 'medium', 'high'])) {
    return { valid: false, failureReason: 'PERSONA_OUTPUT_INVALID: techComfort is invalid' };
  }

  return { valid: true };
}

function normalizePersonaOutput(raw: any) {
  const personaSeed = raw?.personaSeed && typeof raw.personaSeed === 'object' ? raw.personaSeed : raw || {};
  const selfAwarenessPattern = normalizeString(personaSeed.selfAwarenessPattern);
  const planningFollowThrough = normalizeString(personaSeed.planningFollowThrough);
  const overloadReaction = normalizeString(personaSeed.overloadReaction);

  // 校验枚举 helper
  const enumOrNull = <T extends string>(value: any, allowed: T[]): T | null =>
    (allowed.includes(value as T) ? (value as T) : null)

  // 补齐 scenario-designer 完整 schema 中的关键字段, 让两个 skill 互通
  // (LLM 没生成时 fallback null, 让下游 simulator 至少能识别字段名)
  const motivationType = enumOrNull(personaSeed.motivationType, ['career', 'interest', 'necessity', 'social'] as const)
  const personalityTraitsRaw = personaSeed.personalityTraits || {}
  const personalityTraits = {
    verbosity: enumOrNull(personalityTraitsRaw.verbosity, ['terse', 'normal', 'verbose'] as const),
    enthusiasm: enumOrNull(personalityTraitsRaw.enthusiasm, ['low', 'normal', 'high'] as const),
    confusionStyle: enumOrNull(personalityTraitsRaw.confusionStyle, ['direct', 'hinting'] as const),
    patience: enumOrNull(personalityTraitsRaw.patience, ['low', 'normal', 'high'] as const),
    questionStyle: enumOrNull(personalityTraitsRaw.questionStyle, ['none', 'clarifying', 'challenging'] as const),
    emotionalRange: enumOrNull(personalityTraitsRaw.emotionalRange, ['flat', 'moderate', 'expressive'] as const),
  }

  return {
    personaSeed: {
      nameHint: normalizeString(personaSeed.nameHint),
      age: Math.max(18, Math.min(60, Number(personaSeed.age))),
      occupation: normalizeString(personaSeed.occupation),
      education: normalizeString(personaSeed.education),
      background: normalizeString(personaSeed.background),
      knownConcepts: normalizeConceptArray(personaSeed.knownConcepts),
      struggleConcepts: normalizeConceptArray(personaSeed.struggleConcepts),
      learningStyle: personaSeed.learningStyle,
      availableTime: personaSeed.availableTime,
      techComfort: personaSeed.techComfort,
      corePersonality: normalizeString(personaSeed.corePersonality),
      emotionalBaseline: normalizeString(personaSeed.emotionalBaseline),
      helpSeekingPattern: normalizeString(personaSeed.helpSeekingPattern),
      adversarialPattern: normalizeString(personaSeed.adversarialPattern),
      selfAwarenessPattern,
      planningFollowThrough,
      overloadReaction,
      memoryRepairPattern: normalizeString(personaSeed.memoryRepairPattern),
      behavioralProfileSummary: normalizeString(personaSeed.behavioralProfileSummary),
      // Backfill legacy field names so existing profile pages and session logic can keep working.
      metacognitiveProfile: normalizeString(personaSeed.metacognitiveProfile) || selfAwarenessPattern,
      selfRegulationStyle: normalizeString(personaSeed.selfRegulationStyle) || planningFollowThrough,
      cognitiveLoadTolerance: normalizeString(personaSeed.cognitiveLoadTolerance) || overloadReaction,
      // 补齐 scenario-designer 完整 schema 的字段 (兼容 simulator 的 friction 引用)
      motivationType,
      personalityDrivers: normalizeStringArray(personaSeed.personalityDrivers),
      emotionalTriggers: normalizeStringArray(personaSeed.emotionalTriggers),
      failurePatterns: normalizeStringArray(personaSeed.failurePatterns),
      personalityTraits,
    }
  };
}

export async function virtualLearnerPersonaDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:virtual-learner-persona-designer',
      defaultSystemPrompt: VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-persona-designer' },
            buildUserPayload: (payload) => ({
        preferredLevels: normalizeStringArray(payload?.preferredLevels),
        candidatePersonas: normalizeStringArray(payload?.candidatePersonas, DEFAULT_CANDIDATE_PERSONAS),
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
