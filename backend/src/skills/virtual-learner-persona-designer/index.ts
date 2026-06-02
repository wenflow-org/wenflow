import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';

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

function normalizeEnum<T extends string>(value: any, allowed: T[], fallback: T): T {
  return allowed.includes(value) ? value : fallback;
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

function buildTraitFallbackSeed(personaSeed: any) {
  const occupation = normalizeString(personaSeed?.occupation) || '在职学习者';
  const background = normalizeString(personaSeed?.background) || '最近长期处在一种想补能力、但又总被现实琐事打断的状态。';

  return {
    corePersonality: `${occupation}，习惯先从眼前场景判断有没有用，不会轻易接受脱离现实的建议。`,
    emotionalBaseline: `${background}让他在碰到新方法或陌生要求时更容易出现紧张、迟疑或自我怀疑。`,
    helpSeekingPattern: '通常会先按自己的理解试一次，确认还是卡住后才会问，而且更想听贴近自己场景的例子。',
    adversarialPattern: '如果建议听起来太理想化、太花时间，第一反应往往是先保留、先问“现实里真能这样做吗”。',
    selfAwarenessPattern: '能感觉到自己不顺，但未必能立刻把根因说清，也不一定会第一时间承认自己没懂。',
    planningFollowThrough: '更容易被现实截止时间推动，而不是稳定地提前拆解和复盘；一旦掉队，通常先拖一拖再补。',
    overloadReaction: '一旦信息过多或步骤太密，会先抓最表面的可执行点，后面再慢慢补理解。',
    memoryRepairPattern: '忘了或没完全懂时，容易先用模糊说法带过，暴露后才承认自己其实没抓稳。',
    behavioralProfileSummary: `${occupation}会带着真实限制来求助，既想推进问题，又会被现实压力和过去的卡点拖住。`
  };
}

function normalizePersonaOutput(raw: any) {
  const personaSeed = raw?.personaSeed && typeof raw.personaSeed === 'object' ? raw.personaSeed : raw || {};
  const traitFallbacks = buildTraitFallbackSeed(personaSeed);

  return {
    personaSeed: {
      nameHint: normalizeString(personaSeed.nameHint) || '真实学习者',
      age: Number.isFinite(Number(personaSeed.age)) ? Math.max(18, Math.min(60, Number(personaSeed.age))) : 26,
      occupation: normalizeString(personaSeed.occupation) || '在职学习者',
      education: normalizeString(personaSeed.education) || '本科',
      background: normalizeString(personaSeed.background) || '最近在真实任务中遇到了一个需要尽快补上的问题。',
      knownConcepts: normalizeConceptArray(personaSeed.knownConcepts),
      struggleConcepts: normalizeConceptArray(personaSeed.struggleConcepts),
      learningStyle: normalizeEnum(personaSeed.learningStyle, ['reading', 'watching', 'doing', 'listening'], 'reading'),
      availableTime: normalizeEnum(personaSeed.availableTime, ['minimal', 'moderate', 'abundant'], 'minimal'),
      techComfort: normalizeEnum(personaSeed.techComfort, ['low', 'medium', 'high'], 'medium'),
      corePersonality: normalizeString(personaSeed.corePersonality) || traitFallbacks.corePersonality,
      emotionalBaseline: normalizeString(personaSeed.emotionalBaseline) || traitFallbacks.emotionalBaseline,
      helpSeekingPattern: normalizeString(personaSeed.helpSeekingPattern) || traitFallbacks.helpSeekingPattern,
      adversarialPattern: normalizeString(personaSeed.adversarialPattern) || traitFallbacks.adversarialPattern,
      selfAwarenessPattern: normalizeString(personaSeed.selfAwarenessPattern) || normalizeString(personaSeed.metacognitiveProfile) || traitFallbacks.selfAwarenessPattern,
      planningFollowThrough: normalizeString(personaSeed.planningFollowThrough) || normalizeString(personaSeed.selfRegulationStyle) || traitFallbacks.planningFollowThrough,
      overloadReaction: normalizeString(personaSeed.overloadReaction) || normalizeString(personaSeed.cognitiveLoadTolerance) || traitFallbacks.overloadReaction,
      memoryRepairPattern: normalizeString(personaSeed.memoryRepairPattern) || traitFallbacks.memoryRepairPattern,
      behavioralProfileSummary: normalizeString(personaSeed.behavioralProfileSummary) || traitFallbacks.behavioralProfileSummary,
      // Backfill legacy field names so existing profile pages and session logic can keep working.
      metacognitiveProfile: normalizeString(personaSeed.metacognitiveProfile) || normalizeString(personaSeed.selfAwarenessPattern) || traitFallbacks.selfAwarenessPattern,
      selfRegulationStyle: normalizeString(personaSeed.selfRegulationStyle) || normalizeString(personaSeed.planningFollowThrough) || traitFallbacks.planningFollowThrough,
      cognitiveLoadTolerance: normalizeString(personaSeed.cognitiveLoadTolerance) || normalizeString(personaSeed.overloadReaction) || traitFallbacks.overloadReaction,
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
      normalizeOutput: (parsed) => normalizePersonaOutput(parsed),
    }, input || {});

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'VIRTUAL_LEARNER_PERSONA_DESIGN_FAILED');
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
        code: 'VIRTUAL_LEARNER_PERSONA_DESIGN_FAILED',
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerPersonaDesigner;
