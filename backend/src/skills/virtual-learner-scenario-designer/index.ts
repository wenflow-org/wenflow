import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { logger } from '../../utils/logger';

export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS = 8000;
export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE = 0.9;

export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT = `你是一位"虚拟学习者实验样本设计师"。

你的任务是为虚拟学习者实验生成一个"稳定人物 + 一个故事"的结构化样本。
这里的核心关系是：
1. personaSeed = 稳定人物
2. story = 这个稳定人物在某个情境下暴露出来的故事切片
3. story 必须服从 persona，而不是反过来让 story 重新定义一个人

输出必须同时包含：
1. 稳定人物画像 personaSeed
2. 一个故事切片 story
3. 一致性说明 consistencyNotes

设计原则：
1. 输出必须真实，有生活感，有明确问题背景，不能像教材题干。
2. 不要只给抽象目标，要给"为什么现在要学""受什么限制""学到什么算有用"。
3. 生成 1 个故事，这个故事必须像真人会带来的"小故事"：有时间、有地点、有前因后果、有当事人自己也没完全想明白的细节。
4. 不要输出过难、过空泛、或明显不可信的组合。
5. 场景优先面向真实中文学习者实验，语气自然，细节克制。
6. 如果输入提供偏好分布，要尽量遵守，但不要机械照抄。
7. 你的输出必须只包含 1 个 JSON 对象，不要使用任何代码块标记，不要输出 markdown，不要解释。
8. 问题来源不能只来自职场。你要覆盖四类来源：工作问题、生活问题、学习问题、自我管理问题。
9. 不要连续掉进"Excel/报表/运营/市场/职场新人"这一类最常见安全模板，除非输入明确要求。
10. 不要默认所有人都是在职白领。角色可以来自学生、求职转行者、自由职业者、家长、教培老师、门店店长、客服、行政、财务、创作者、社区工作者等。
11. domain、occupation、goalType、motivationType 要尽量拉开分布，优先避免与最近样本候选重复。
12. 真人不会一口气说完整个故事，所以 story 只需要区分"首轮最可能怎么说"和"被追问后才会补的���键细节"，不要重复设计额外层级结构。
13. personaSeed 不能只是一组人口统计学字段，还要包含稳定的人格、情感、行为模式和元认知特征。
14. story 必须与 persona 保持一致：说话习惯、受挫方式、求助方式、对抗方式、遗忘修正方式必须与 personaSeed 里的对应字段对齐。
15. 你生成的每个 trait 都必须是"可在对话中观察到的"，而不是抽象空话。
16. story 不仅要给目标，还要给这个故事会优先触发哪种行为模式或情绪压力点。
17. 如果提供 existingPersonaSeed，默认是在"同一个人"上补故事，不允许偷偷换人；只能换情境、事件和表层求助表达。
18. 如果提供 existingPersonaSeed，不要重写此人的核心身份与长期行为底色；输出里的 personaSeed 只允许补空缺、做轻量对齐，不能把 occupation、corePersonality、helpSeekingPattern、adversarialPattern 等核心字段改成另一套人。
19. 如果提供 existingStoryPool，新故事必须明显避开同类 triggerEvent、visibleOpening、pressurePoints 和 behaviorHooks。
20. 所有必填字段都必须给出具体、非空、可观察的内容；不要留空，不要写“待补充/未明确/通用模板”。
21. 不要依赖系统为你补齐 persona 或 story 字段；如果你发现自己想写安全兜底句，说明这次生成还不够具体，必须重写。

可选输入：
- preferredDomains: 倾向的学习主题
- preferredGoalTypes: 倾向的目标类型
- preferredLevels: 倾向的学习起点标签（仅作弱参考）
- preferredMotivations: 倾向的动机类型
- avoidDomains: 希望避免的主题
- candidateDomains: 可供优先采样的主题池
- candidatePersonas: 可供优先采样的人物池
- recentScenarioHints: 最近已出现、应尽量避开的组合提示
- existingPersonaSeed: 现有稳定人物底稿；如果提供，优先保留此人的长期底色，不要重新造一个人
- existingStoryPool: 这个人已经有的故事；如果提供，新故事要与其拉开，不要换人，只能换情境

如果用户提供了以上变量，你必须遵守，尤其是 existingPersonaSeed / existingStoryPool。

goalType 只能是：problem_driven | foundation_building | project_based | exam_prep | interest_exploration
motivationType 只能是：career | interest | necessity | social
availableTime 只能是：minimal | moderate | abundant
techComfort 只能是：low | medium | high
verbosity 只能是：terse | normal | verbose
enthusiasm 只能是：low | normal | high
confusionStyle 只能是：direct | hinting
patience 只能是：low | normal | high
questionStyle 只能是：none | clarifying | challenging
emotionalRange 只能是：flat | moderate | expressive

分布要求（关键）：
- 至少一部分场景应该明显不是职场问题，例如：备考、带娃时间安排、健康习惯、课堂复盘、公开表达、个人财务记录、家庭信息整理、兴趣学习卡住。
- 如果没有明确偏好，优先从更广的池子里选，而不是总选数据分析、Excel、运营、市场。
- 如果 recentScenarioHints 里已经出现类似组合，尽量换一个 domain、occupation 或问题来源。

高质量要求（关键）：
- "corePersonality / emotionalBaseline / helpSeekingPattern / adversarialPattern / metacognitiveProfile" 不能退化成空泛安全模板，必须与人物职业、现实压力、失败经历和本次目标发生咬合。
- 不要反复产出"有真实顾虑""先自己试再问""担心理想化建议"这种抽象但不可区分的句子。你要说明：这个人会在什么情境下这样做、会怎么做、边界在哪里。
- story 的 "pressurePoints" 和 "behaviorHooks" 必须具体到这个情境，而不是任何 learner 都能套用的通用句。
- 如果提供了 existingPersonaSeed，就默认在"同一个人"上继续补故事；除非输入明确要求，不要改掉已有稳定画像。
- 如果提供了 existingStoryPool，新故事必须避开同类触发事件、同类开场话术和同类压力点。
- consistencyNotes 不能写成空话，要输出 2-4 条"故事与 persona 的一致性校验点"，明确说明 story 的 pressurePoints / behaviorHooks / visibleOpening 如何与 persona 的对应字段对齐。

输出格式：
{
  "personaSeed": {
    "nameHint": "人物标签",
    "age": 26,
    "occupation": "职业",
    "education": "学历",
    "background": "背景描述，2-4句",
    "knownConcepts": ["已知概念1"],
    "struggleConcepts": ["困难概念1"],
    "learningStyle": "reading",
    "motivationType": "necessity",
    "availableTime": "minimal",
    "techComfort": "medium",
    "priorAttempts": "可选，过往失败经历",
    "corePersonality": "一句话描述稳定人格底色",
    "personalityDrivers": ["2-4个长期人格驱动"],
    "communicationStyle": "沟通风格，比如先说症状、被追问后才展开",
    "motivationOrientation": "更稳定的动机偏向",
    "emotionalBaseline": "长期情感基线",
    "emotionalTriggers": ["容易引发焦虑/防御/退缩的情境"],
    "resiliencePattern": "受挫后的典型反应",
    "metacognitiveProfile": "元认知特征",
    "cognitiveLoadTolerance": "认知负荷容忍度",
    "selfRegulationStyle": "自我调节方式",
    "digitalLiteracy": "数字素养",
    "helpSeekingPattern": "求助模式",
    "adversarialPattern": "典型对抗模式",
    "memoryRepairPattern": "遗忘与纠错模式",
    "behaviorBoundaries": ["不太会做/不会主动做的事"],
    "learningPreferences": ["偏好的学习方式"],
    "failurePatterns": ["过往常见失败模式"],
    "behavioralProfileSummary": "一句话总结长期行为风格",
    "personalityTraits": {
      "verbosity": "normal",
      "enthusiasm": "normal",
      "confusionStyle": "hinting",
      "patience": "low",
      "questionStyle": "clarifying",
      "emotionalRange": "moderate"
    }
  },
  "story": {
    "title": "一个短标题",
    "sourceType": "work | life | study | self_management",
    "storyOutline": "完整的小故事，2-4句，必须有时间、地点、前因后果",
    "triggerEvent": "触发来学习的那个具体事件",
    "visibleOpening": "如果真人首轮开口，他最可能怎么说",
    "hiddenDetails": ["不太会主动说，但重要的细节"],
    "misdiagnosis": "他以为自己的问题是什么，但不一定对",
    "pressurePoints": ["这个故事会优先触发的情绪/行为压力点"],
    "behaviorHooks": ["这个故事里最可能出现的典型反应模式"],
    "problemKnowledge": {
      "domainFamiliarity": "low | medium | high",
      "knownConcepts": ["这次问题里已经会的点"],
      "struggleConcepts": ["这次问题里容易卡的点"],
      "selfAssessment": "他会怎么描述自己在这件事上的基础",
      "hiddenGaps": ["他自己未必意识到的缺口"]
    },
    "goalSeed": {
      "domain": "主题领域",
      "goalType": "problem_driven",
      "surfaceGoal": "表层目标",
      "realProblem": "真实问题",
      "motivation": "这次为什么学",
      "urgencyHint": "紧迫性线索",
      "constraints": ["限制1", "限制2"],
      "expectedOutcome": "希望达到的结果"
    },
    "disclosurePlan": {
      "opening": "首轮最可能的开场表达，1-2句话",
      "revelationTriggers": ["被追问到某个点时会说出 hiddenDetails 的触发条件"],
      "resistancePoints": ["哪些话题或建议会引发对抗/回避"],
      "idealProbe": "什么样的追问或建议最容易让他打开话匣子"
    }
  },
  "consistencyNotes": [
    "说明 story 的 pressurePoints 如何与 persona 的 emotionalTriggers 对齐",
    "说明 story 的 behaviorHooks 如何与 persona 的 helpSeekingPattern / adversarialPattern 对齐",
    "说明 story 的 visibleOpening 如何与 persona 的 communicationStyle 对齐"
  ]
}`;

export const virtualLearnerScenarioDesignerDefinition: SkillDefinition = {
  name: 'virtual-learner-scenario-designer',
  displayName: '虚拟学习者场景设计器',
  version: '1.1.0',
  category: 'generation',
  description: '为虚拟学习者实验生成随机任务、目标切片与匹配画像',
  inputSchema: {
    type: 'object',
    properties: {
      preferredDomains: { type: 'array' },
      preferredGoalTypes: { type: 'array' },
      preferredLevels: { type: 'array' },
      preferredMotivations: { type: 'array' },
      avoidDomains: { type: 'array' },
      candidateDomains: { type: 'array' },
      candidatePersonas: { type: 'array' },
      recentScenarioHints: { type: 'array' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      personaSeed: { type: 'object' },
      story: { type: 'object' },
      consistencyNotes: { type: 'array' },
    },
  },
  capabilities: ['virtual-learner-scenario-design', 'persona-goal-matching'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

function normalizeString(value: any): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const sanitized = sanitizeGeneratedText(value);
  return sanitized || null;
}

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

function normalizeStringArray(value: any, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const next = value
    .map((item) => normalizeString(item))
    .filter((item): item is string => !!item);
  return next.length ? Array.from(new Set(next)) : fallback;
}

function isAllowedEnum<T extends string>(value: any, allowed: T[]): value is T {
  return allowed.includes(value);
}

function normalizeDisclosurePlan(raw: any) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    opening: normalizeString(data.opening),
    revelationTriggers: normalizeStringArray(data.revelationTriggers),
    resistancePoints: normalizeStringArray(data.resistancePoints),
    idealProbe: normalizeString(data.idealProbe)
  };
}

function normalizeProblemKnowledge(raw: any) {
  const data = raw && typeof raw === 'object' ? raw : {}
  return {
    domainFamiliarity: isAllowedEnum(data.domainFamiliarity, ['low', 'medium', 'high']) ? data.domainFamiliarity : null,
    knownConcepts: normalizeStringArray(data.knownConcepts),
    struggleConcepts: normalizeStringArray(data.struggleConcepts),
    selfAssessment: normalizeString(data.selfAssessment),
    hiddenGaps: normalizeStringArray(data.hiddenGaps)
  }
}

function normalizeStory(raw: any) {
  const goalSeed = raw?.goalSeed && typeof raw.goalSeed === 'object' ? raw.goalSeed : {};

  return {
    id: normalizeString(raw?.id) || undefined,
    title: normalizeString(raw?.title),
    sourceType: isAllowedEnum(raw?.sourceType, ['work', 'life', 'study', 'self_management']) ? raw.sourceType : null,
    storyOutline: normalizeString(raw?.storyOutline),
    triggerEvent: normalizeString(raw?.triggerEvent),
    visibleOpening: normalizeString(raw?.visibleOpening),
    hiddenDetails: normalizeStringArray(raw?.hiddenDetails),
    misdiagnosis: normalizeString(raw?.misdiagnosis),
    pressurePoints: normalizeStringArray(raw?.pressurePoints),
    behaviorHooks: normalizeStringArray(raw?.behaviorHooks),
    problemKnowledge: normalizeProblemKnowledge(raw?.problemKnowledge),
    goalSeed: {
      domain: normalizeString(goalSeed.domain),
      goalType: isAllowedEnum(goalSeed.goalType, ['problem_driven', 'foundation_building', 'project_based', 'exam_prep', 'interest_exploration']) ? goalSeed.goalType : null,
      surfaceGoal: normalizeString(goalSeed.surfaceGoal),
      realProblem: normalizeString(goalSeed.realProblem),
      motivation: normalizeString(goalSeed.motivation),
      urgencyHint: normalizeString(goalSeed.urgencyHint),
      constraints: normalizeStringArray(goalSeed.constraints),
      expectedOutcome: normalizeString(goalSeed.expectedOutcome)
    },
    disclosurePlan: normalizeDisclosurePlan(raw?.disclosurePlan)
  };
}

const DEFAULT_CANDIDATE_DOMAINS = [
  '番茄工作法与时间管理',
  '课堂复盘与总结',
  '需求拆解',
  '向上汇报表达',
  'SQL 基础查询',
  'Python 基础',
  'Excel 数据处理',
  '英语口语表达',
  '备考规划',
  '个人记账与财务整理',
  '亲子沟通',
  '演讲与公开表达',
  '阅读方法',
  '健身习惯建立',
  '写作与结构表达',
];

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

const DEFAULT_RECENT_SCENARIO_HINTS = [
  '避免连续生成 Excel 报表整理类场景',
  '避免连续生成 市场/运营 初学者 的组合',
  '避免连续生成 problem_driven + necessity 的单一搭配',
  '避免 nameHint 总是小陈/小张这类重复模板',
];

function normalizeScenarioOutput(raw: any) {
  const storyRaw = raw?.story && typeof raw?.story === 'object' ? raw.story : null;
  const personaSeed = raw?.personaSeed && typeof raw.personaSeed === 'object' ? raw.personaSeed : {};

  const normalizedStory = normalizeStory(storyRaw || {});

  return {
    personaSeed: {
      nameHint: normalizeString(personaSeed.nameHint),
      age: Number.isFinite(Number(personaSeed.age)) ? Math.max(18, Math.min(60, Number(personaSeed.age))) : null,
      occupation: normalizeString(personaSeed.occupation),
      education: normalizeString(personaSeed.education),
      background: normalizeString(personaSeed.background),
      knownConcepts: normalizeStringArray(personaSeed.knownConcepts),
      struggleConcepts: normalizeStringArray(personaSeed.struggleConcepts),
      learningStyle: isAllowedEnum(personaSeed.learningStyle, ['reading', 'watching', 'doing', 'listening']) ? personaSeed.learningStyle : null,
      motivationType: isAllowedEnum(personaSeed.motivationType, ['career', 'interest', 'necessity', 'social']) ? personaSeed.motivationType : null,
      availableTime: isAllowedEnum(personaSeed.availableTime, ['minimal', 'moderate', 'abundant']) ? personaSeed.availableTime : null,
      techComfort: isAllowedEnum(personaSeed.techComfort, ['low', 'medium', 'high']) ? personaSeed.techComfort : null,
      priorAttempts: normalizeString(personaSeed.priorAttempts) || undefined,
      corePersonality: normalizeString(personaSeed.corePersonality),
      personalityDrivers: normalizeStringArray(personaSeed.personalityDrivers),
      communicationStyle: normalizeString(personaSeed.communicationStyle),
      motivationOrientation: normalizeString(personaSeed.motivationOrientation),
      emotionalBaseline: normalizeString(personaSeed.emotionalBaseline),
      emotionalTriggers: normalizeStringArray(personaSeed.emotionalTriggers),
      resiliencePattern: normalizeString(personaSeed.resiliencePattern),
      metacognitiveProfile: normalizeString(personaSeed.metacognitiveProfile),
      cognitiveLoadTolerance: normalizeString(personaSeed.cognitiveLoadTolerance),
      selfRegulationStyle: normalizeString(personaSeed.selfRegulationStyle),
      digitalLiteracy: normalizeString(personaSeed.digitalLiteracy),
      helpSeekingPattern: normalizeString(personaSeed.helpSeekingPattern),
      adversarialPattern: normalizeString(personaSeed.adversarialPattern),
      memoryRepairPattern: normalizeString(personaSeed.memoryRepairPattern),
      behaviorBoundaries: normalizeStringArray(personaSeed.behaviorBoundaries),
      learningPreferences: normalizeStringArray(personaSeed.learningPreferences),
      failurePatterns: normalizeStringArray(personaSeed.failurePatterns),
      behavioralProfileSummary: normalizeString(personaSeed.behavioralProfileSummary),
      personalityTraits: {
        verbosity: isAllowedEnum(personaSeed.personalityTraits?.verbosity, ['terse', 'normal', 'verbose']) ? personaSeed.personalityTraits.verbosity : null,
        enthusiasm: isAllowedEnum(personaSeed.personalityTraits?.enthusiasm, ['low', 'normal', 'high']) ? personaSeed.personalityTraits.enthusiasm : null,
        confusionStyle: isAllowedEnum(personaSeed.personalityTraits?.confusionStyle, ['direct', 'hinting']) ? personaSeed.personalityTraits.confusionStyle : null,
        patience: isAllowedEnum(personaSeed.personalityTraits?.patience, ['low', 'normal', 'high']) ? personaSeed.personalityTraits.patience : null,
        questionStyle: isAllowedEnum(personaSeed.personalityTraits?.questionStyle, ['none', 'clarifying', 'challenging']) ? personaSeed.personalityTraits.questionStyle : null,
        emotionalRange: isAllowedEnum(personaSeed.personalityTraits?.emotionalRange, ['flat', 'moderate', 'expressive']) ? personaSeed.personalityTraits.emotionalRange : null,
      },
    },
    story: normalizedStory,
    consistencyNotes: normalizeStringArray(raw?.consistencyNotes),
  };
}

function validateScenarioOutput(parsed: any): { valid: boolean; failureReason?: string } {
  const personaSeed = parsed?.personaSeed;
  const story = parsed?.story;

  if (!personaSeed || typeof personaSeed !== 'object') {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed is required' };
  }

  if (!story || typeof story !== 'object') {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story is required' };
  }

  const requiredPersonaStrings = [
    'nameHint',
    'occupation',
    'education',
    'background',
    'corePersonality',
    'emotionalBaseline',
    'helpSeekingPattern',
    'adversarialPattern',
    'metacognitiveProfile',
    'cognitiveLoadTolerance',
    'memoryRepairPattern',
    'behavioralProfileSummary',
  ];
  const missingPersonaStrings = requiredPersonaStrings.filter((field) => !normalizeString(personaSeed[field]));
  if (missingPersonaStrings.length > 0) {
    return { valid: false, failureReason: `SCENARIO_OUTPUT_INVALID: missing personaSeed fields: ${missingPersonaStrings.join(', ')}` };
  }

  if (!Number.isFinite(Number(personaSeed.age))) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.age must be a number' };
  }

  if (normalizeStringArray(personaSeed.knownConcepts).length === 0) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.knownConcepts must contain at least one item' };
  }

  if (normalizeStringArray(personaSeed.struggleConcepts).length === 0) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.struggleConcepts must contain at least one item' };
  }

  if (normalizeStringArray(personaSeed.emotionalTriggers).length === 0) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.emotionalTriggers must contain at least one item' };
  }

  if (normalizeStringArray(personaSeed.failurePatterns).length === 0) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.failurePatterns must contain at least one item' };
  }

  if (!isAllowedEnum(personaSeed.learningStyle, ['reading', 'watching', 'doing', 'listening'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.learningStyle is invalid' };
  }

  if (!isAllowedEnum(personaSeed.motivationType, ['career', 'interest', 'necessity', 'social'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.motivationType is invalid' };
  }

  if (!isAllowedEnum(personaSeed.availableTime, ['minimal', 'moderate', 'abundant'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.availableTime is invalid' };
  }

  if (!isAllowedEnum(personaSeed.techComfort, ['low', 'medium', 'high'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.techComfort is invalid' };
  }

  if (!personaSeed.personalityTraits || typeof personaSeed.personalityTraits !== 'object') {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.personalityTraits is required' };
  }

  if (!isAllowedEnum(personaSeed.personalityTraits.verbosity, ['terse', 'normal', 'verbose'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.personalityTraits.verbosity is invalid' };
  }

  if (!isAllowedEnum(personaSeed.personalityTraits.enthusiasm, ['low', 'normal', 'high'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.personalityTraits.enthusiasm is invalid' };
  }

  if (!isAllowedEnum(personaSeed.personalityTraits.confusionStyle, ['direct', 'hinting'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.personalityTraits.confusionStyle is invalid' };
  }

  if (!isAllowedEnum(personaSeed.personalityTraits.patience, ['low', 'normal', 'high'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.personalityTraits.patience is invalid' };
  }

  if (!isAllowedEnum(personaSeed.personalityTraits.questionStyle, ['none', 'clarifying', 'challenging'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.personalityTraits.questionStyle is invalid' };
  }

  if (!isAllowedEnum(personaSeed.personalityTraits.emotionalRange, ['flat', 'moderate', 'expressive'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: personaSeed.personalityTraits.emotionalRange is invalid' };
  }

  const requiredStoryStrings = ['title', 'storyOutline', 'triggerEvent', 'visibleOpening'];
  const missingStoryStrings = requiredStoryStrings.filter((field) => !normalizeString(story[field]));
  if (missingStoryStrings.length > 0) {
    return { valid: false, failureReason: `SCENARIO_OUTPUT_INVALID: missing story fields: ${missingStoryStrings.join(', ')}` };
  }

  if (normalizeStringArray(story.pressurePoints).length === 0) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.pressurePoints must contain at least one item' };
  }

  if (normalizeStringArray(story.behaviorHooks).length === 0) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.behaviorHooks must contain at least one item' };
  }

  const problemKnowledge = story.problemKnowledge;
  if (!problemKnowledge || typeof problemKnowledge !== 'object') {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.problemKnowledge is required' };
  }

  if (!isAllowedEnum(problemKnowledge.domainFamiliarity, ['low', 'medium', 'high'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.problemKnowledge.domainFamiliarity is invalid' };
  }

  if (normalizeStringArray(problemKnowledge.struggleConcepts).length === 0) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.problemKnowledge.struggleConcepts must contain at least one item' };
  }

  if (!normalizeString(problemKnowledge.selfAssessment)) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.problemKnowledge.selfAssessment is required' };
  }

  const goalSeed = story.goalSeed;
  if (!goalSeed || typeof goalSeed !== 'object') {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.goalSeed is required' };
  }

  const requiredGoalSeedStrings = ['domain', 'surfaceGoal', 'realProblem', 'motivation'];
  const missingGoalSeedStrings = requiredGoalSeedStrings.filter((field) => !normalizeString(goalSeed[field]));
  if (missingGoalSeedStrings.length > 0) {
    return { valid: false, failureReason: `SCENARIO_OUTPUT_INVALID: missing story.goalSeed fields: ${missingGoalSeedStrings.join(', ')}` };
  }

  if (!isAllowedEnum(goalSeed.goalType, ['problem_driven', 'foundation_building', 'project_based', 'exam_prep', 'interest_exploration'])) {
    return { valid: false, failureReason: 'SCENARIO_OUTPUT_INVALID: story.goalSeed.goalType is invalid' };
  }

  return { valid: true };
}

function summarizeScenarioInput(input: any) {
  return {
    preferredDomains: Array.isArray(input?.preferredDomains) ? input.preferredDomains.slice(0, 5) : [],
    preferredGoalTypes: Array.isArray(input?.preferredGoalTypes) ? input.preferredGoalTypes.slice(0, 5) : [],
    preferredLevels: Array.isArray(input?.preferredLevels) ? input.preferredLevels.slice(0, 5) : [],
    preferredMotivations: Array.isArray(input?.preferredMotivations) ? input.preferredMotivations.slice(0, 5) : [],
    candidateDomainsCount: Array.isArray(input?.candidateDomains) ? input.candidateDomains.length : 0,
    candidatePersonasCount: Array.isArray(input?.candidatePersonas) ? input.candidatePersonas.length : 0,
    hasExistingPersonaSeed: !!input?.existingPersonaSeed,
    existingStoryPoolCount: Array.isArray(input?.existingStoryPool) ? input.existingStoryPool.length : 0,
  };
}

function summarizeScenarioOutput(output: any) {
  return {
    personaNameHint: output?.personaSeed?.nameHint || null,
    personaOccupation: output?.personaSeed?.occupation || null,
    storyTitle: output?.story?.title || null,
    consistencyNotesCount: Array.isArray(output?.consistencyNotes) ? output.consistencyNotes.length : 0,
  };
}

export async function virtualLearnerScenarioDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
    logger.info('[virtual-learner-scenario-designer] 开始生成故事', {
      inputSummary: summarizeScenarioInput(input),
    });

    const result = await callPrompt<any, any>({
      agentId: 'skill:virtual-learner-scenario-designer',
      defaultSystemPrompt: VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'virtual-learner-scenario-designer' },
      modelDefaults: {
        maxTokens: VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS,
        temperature: VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE,
      },
      buildUserPayload: (payload) => ({
        preferredDomains: normalizeStringArray(payload?.preferredDomains),
        preferredGoalTypes: normalizeStringArray(payload?.preferredGoalTypes),
        preferredLevels: normalizeStringArray(payload?.preferredLevels),
        preferredMotivations: normalizeStringArray(payload?.preferredMotivations),
        avoidDomains: normalizeStringArray(payload?.avoidDomains),
        candidateDomains: normalizeStringArray(payload?.candidateDomains, DEFAULT_CANDIDATE_DOMAINS),
        candidatePersonas: normalizeStringArray(payload?.candidatePersonas, DEFAULT_CANDIDATE_PERSONAS),
        recentScenarioHints: normalizeStringArray(payload?.recentScenarioHints, DEFAULT_RECENT_SCENARIO_HINTS),
        existingPersonaSeed: payload?.existingPersonaSeed && typeof payload.existingPersonaSeed === 'object' ? payload.existingPersonaSeed : undefined,
        existingStoryPool: Array.isArray(payload?.existingStoryPool) ? payload.existingStoryPool.slice(0, 6) : undefined,
      }),
      validateParsedOutput: (parsed) => validateScenarioOutput(parsed),
      normalizeOutput: (parsed) => normalizeScenarioOutput(parsed),
      mapEnvelope: (output) => mapSkillOutputEnvelope('virtual-learner-scenario-designer', output, {
        phase: 'completed',
        isTerminal: true,
      }),
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) => `请只输出一个合法 JSON 对象，必须同时包含完整 personaSeed 与 story。所有必填字段都要具体、非空、可观察，禁止使用模板兜底句或占位词。上次失败原因：${failureReason}`
      }
    }, input || {});

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'VIRTUAL_LEARNER_SCENARIO_DESIGN_FAILED');
    }

    logger.info('[virtual-learner-scenario-designer] 生成完成', {
      systemPromptVersion: result.debug.systemPromptVersion,
      durationMs: result.debug.durationMs,
      inputSummary: summarizeScenarioInput(input),
      outputSummary: summarizeScenarioOutput(result.output),
    });

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
    logger.error('[virtual-learner-scenario-designer] 生成失败', {
      inputSummary: summarizeScenarioInput(input),
      error: error?.message || 'Unknown error',
    });

    return {
      success: false,
      error: {
        code: 'VIRTUAL_LEARNER_SCENARIO_DESIGN_FAILED',
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerScenarioDesigner;
