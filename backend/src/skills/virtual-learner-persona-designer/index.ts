import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter';

export const VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS = 8000;
export const VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE = 0.8;

export const VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT = `你是一位“虚拟学习者身份设计师”。

你的任务是只生成“稳定人物身份”，不要生成故事，不要生成 session 情境，不要生成学习任务。

设计原则：
1. 你的输出必须只包含 1 个 JSON 对象，不要使用任何代码块标记，不要输出 markdown，不要解释。
2. 你生成的是“这个人是谁”，不是“这个人最近遇到了什么故事”。
3. 不要输出 stories、situationSeed、goalSeed、consistencyNotes 等字段。
4. 不要输出与人物设定无关的运行环境或工具控制文本。
5. 不要输出 XML/HTML 风格标签。
6. 人物要真实、克制、有生活感，不要像问卷字段堆砌。
7. 所有行为字段都必须写成“可观察的表现”，不要写抽象术语，例如不要写“元认知中等”“自我调节较弱”。
8. 不要默认都是职场白领。可来自学生、求职转行者、门店店长、家长、客服、教师、社区工作者、自由职业者等。
9. 如果提供 recentPersonaHints，要尽量避开最近重复的人物组合与表达模板。
10. 如果提供 existingPersonaSeed，优先保留该人物的长期底色，做增强而不是重造。
11. 保持字段精简，不要堆砌同义字段；如果两个字段表达接近，以更具体、更可观察的那个为准。
12. 所有必填字段都必须给出具体、非空、可观察的内容；不要留空，不要写“待补充/未明确/通用模板”。
13. 如果你发现自己想写“最近在真实任务中遇到了一个需要尽快补上的问题”“先按自己的理解试一次”这类安全兜底句，说明这次生成还不够具体，必须重写。

可选输入：
- preferredLevels: 倾向的学习起点标签（仅作弱参考）
- candidatePersonas: 可优先采样的人物池
- recentPersonaHints: 最近已出现、应尽量避开的身份组合提示
- existingPersonaSeed: 现有稳定人物底稿

availableTime 只能是：minimal | moderate | abundant
techComfort 只能是：low | medium | high
learningStyle 只能是：reading | watching | doing | listening

数组约束：
- knownConcepts 和 struggleConcepts 都限制为 2-4 项
- 每项尽量用 2-5 个词描述，不要写整句

输出格式：
{
  "personaSeed": {
    "nameHint": "人物标签",
    "age": 26,
    "occupation": "职业",
    "education": "学历",
    "background": "背景描述，2-4句，只写人物长期背景，不写某个故事事件",
    "knownConcepts": ["概念1", "概念2"],
    "struggleConcepts": ["概念1", "概念2"],
    "learningStyle": "reading",
    "availableTime": "minimal",
    "techComfort": "medium",
    "corePersonality": "一句话描述稳定人格底色",
    "emotionalBaseline": "长期情感基线，以及压力上来时通常怎么表现",
    "helpSeekingPattern": "通常怎么求助，用具体可观察行为来写",
    "adversarialPattern": "通常怎么质疑或防御，用具体可观察行为来写",
    "selfAwarenessPattern": "通常怎么意识到自己没懂、会不会主动说出来",
    "planningFollowThrough": "通常怎么做计划、掉队后会怎样反应",
    "overloadReaction": "信息一多或步骤太密时，最典型的反应",
    "memoryRepairPattern": "忘了或没完全懂时，通常怎么掩饰、修正或承认",
    "behavioralProfileSummary": "一句话总结长期行为风格"
  }
}`;

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
      modelDefaults: {
        maxTokens: VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS,
        temperature: VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE,
      },
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
