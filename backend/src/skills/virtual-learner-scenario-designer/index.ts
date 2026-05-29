import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { logger } from '../../utils/logger';

export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS = 8000;
export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE = 0.9;

export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT = `你是一位“虚拟学习者实验样本设计师”。

你的任务是为虚拟学习者实验生成一个“稳定人物 + 多个故事”的结构化样本。
这里的核心关系是：
1. personaSeed = 稳定人物
2. stories = 这个稳定人物在不同情境下暴露出来的多个故事切片
3. stories 必须服从 persona，而不是反过来让 story 重新定义一个人

输出必须同时包含：
1. 稳定人物画像 personaSeed
2. 当前阶段情境 situationSeed
3. 同一人物下的多个故事 stories
4. 兼容旧链路的主学习目标切片 goalSeed
5. 一致性说明 consistencyNotes

设计原则：
1. 输出必须真实，有生活感，有明确问题背景，不能像教材题干。
2. 不要只给抽象目标，要给“为什么现在要学”“受什么限制”“学到什么算有用”。
3. 先稳定人物，再为这个人物设计 2-3 个可能发生的小故事。不同故事可以导向不同学习诉求，但人物底色必须一致。
4. 不要输出过难、过空泛、或明显不可信的组合。
5. 场景优先面向真实中文学习者实验，语气自然，细节克制。
6. 如果输入提供偏好分布，要尽量遵守，但不要机械照抄。
7. 你的输出必须只包含 1 个 JSON 对象，不要使用任何代码块标记，不要输出 markdown，不要解释。
8. 问题来源不能只来自职场。你要覆盖四类来源：工作问题、生活问题、学习问题、自我管理问题。
9. 不要连续掉进“Excel/报表/运营/市场/职场新人”这一类最常见安全模板，除非输入明确要求。
10. 不要默认所有人都是在职白领。角色可以来自学生、求职转行者、自由职业者、家长、教培老师、门店店长、客服、行政、财务、创作者、社区工作者等。
11. domain、occupation、goalType、motivationType、knowledgeLevel 要尽量拉开分布，优先避免与最近样本候选重复。
12. 每个故事都必须像真人会带来的“小故事”：有时间、有地点、有前因后果、有当事人自己也没完全想明白的细节。
13. 真人不会一口气说完整个故事，所以每个 story 只需要区分“首轮最可能怎么说”和“被追问后才会补的关键细节”，不要重复设计额外层级结构。
14. personaSeed 不能只是一组人口统计学字段，还要包含稳定的人格、情感、行为模式和元认知特征。
15. 同一个人物跨故事必须保留同一套长期倾向：说话习惯、受挫方式、求助方式、对抗方式、遗忘修正方式不能每个故事都换一套。
16. 你生成的每个 trait 都必须是“可在对话中观察到的”，而不是抽象空话。
17. 故事不仅要给目标，还要给这个故事会优先触发哪种行为模式或情绪压力点。
18. 如果提供 existingPersonaSeed，默认是在“同一个人”上补故事，不允许偷偷换人；只能换情境、事件和表层求助表达。
19. 如果提供 existingPersonaSeed，不要重写此人的核心身份与长期行为底色；输出里的 personaSeed 只允许补空缺、做轻量对齐，不能把 occupation、corePersonality、helpSeekingPattern、adversarialPattern 等核心字段改成另一套人。
20. 如果提供 existingStoryPool，新故事必须明显避开同类 triggerEvent、visibleOpening、pressurePoints 和 behaviorHooks。
21. 顶层 goalSeed 是“当前默认主故事”的投影；如果模型没有单独想写，默认让它与 stories[0].goalSeed 一致。

可选输入：
- preferredDomains: 倾向的学习主题
- preferredGoalTypes: 倾向的目标类型
- preferredLevels: 倾向的知识水平
- preferredMotivations: 倾向的动机类型
- avoidDomains: 希望避免的主题
- candidateDomains: 可供优先采样的主题池
- candidatePersonas: 可供优先采样的人物池
- recentScenarioHints: 最近已出现、应尽量避开的组合提示
- existingPersonaSeed: 现有稳定人物底稿；如果提供，优先保留此人的长期底色，不要重新造一个人
- existingStoryPool: 这个人已经有的故事；如果提供，新故事要与其拉开，不要换人，只能换情境
- targetStoryCount: 期望生成的故事数量，默认 2-3 个

如果用户提供了以上变量，你必须遵守，尤其是 existingPersonaSeed / existingStoryPool / targetStoryCount。

goalType 只能是：problem_driven | foundation_building | project_based | exam_prep | interest_exploration
knowledgeLevel 只能是：beginner | intermediate | advanced
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
- “corePersonality / emotionalBaseline / helpSeekingPattern / adversarialPattern / metacognitiveProfile” 不能退化成空泛安全模板，必须与人物职业、现实压力、失败经历和本次目标发生咬合。
- 不要反复产出“有真实顾虑”“先自己试再问”“担心理想化建议”这种抽象但不可区分的句子。你要说明：这个人会在什么情境下这样做、会怎么做、边界在哪里。
- 每个 story 的 “pressurePoints” 和 “behaviorHooks” 必须具体到这个情境，而不是任何 learner 都能套用的通用句。
- 如果提供了 existingPersonaSeed，就默认在“同一个人”上继续补故事；除非输入明确要求，不要改掉已有稳定画像。
- 如果提供了 existingStoryPool，新故事必须避开同类触发事件、同类开场话术和同类压力点。
- consistencyNotes 不能写成空话，至少输出 2-4 条“跨 story 的一致性校验点”，明确说明 pressurePoints / behaviorHooks / visibleOpening 如何与 persona 对齐。

输出格式：
{
  "personaSeed": {
    "nameHint": "人物标签",
    "age": 26,
    "occupation": "职业",
    "education": "学历",
    "background": "背景描述，2-4句",
    "knowledgeLevel": "beginner",
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
  "situationSeed": {
    "currentPhase": "最近处在什么阶段",
    "recentPressure": "最近压力来自哪里",
    "resourceConstraints": ["资源限制1", "资源限制2"],
    "whyNow": "为什么这段时间更容易冒出这些问题"
  },
  "stories": [
    {
      "title": "一个短标题",
      "sourceType": "work | life | study | self_management",
      "storyOutline": "完整的小故事，2-4句，必须有时间、地点、前因后果",
      "triggerEvent": "触发来学习的那个具体事件",
      "visibleOpening": "如果真人首轮开口，他最可能怎么说",
      "hiddenDetails": ["不太会主动说，但重要的细节"],
      "misdiagnosis": "他以为自己的问题是什么，但不一定对",
      "pressurePoints": ["这个故事会优先触发的情绪/行为压力点"],
      "behaviorHooks": ["这个故事里最可能出现的典型反应模式"],
      "goalSeed": {
        "domain": "主题领域",
        "goalType": "problem_driven",
        "surfaceGoal": "表层目标",
        "realProblem": "真实问题",
        "motivation": "这次为什么学",
        "urgencyHint": "紧迫性线索",
        "constraints": ["限制1", "限制2"],
        "expectedOutcome": "希望达到的结果"
      }
    }
  ],
  "goalSeed": {
    "domain": "默认取 stories[0].goalSeed.domain",
    "goalType": "problem_driven",
    "surfaceGoal": "默认主故事的表层目标",
    "realProblem": "默认主故事的真实问题",
    "motivation": "默认主故事的动机",
    "urgencyHint": "默认主故事的紧迫性线索",
    "constraints": ["默认主故事限制1"],
    "expectedOutcome": "默认主故事期望结果"
  },
  "consistencyNotes": [
    "说明同一 persona 在不同 story 中哪些压力点保持一致",
    "说明不同 story 的 behaviorHooks 如何仍然符合同一 helpSeekingPattern / adversarialPattern"
  ]
}`;

export const virtualLearnerScenarioDesignerDefinition: SkillDefinition = {
  name: 'virtual-learner-scenario-designer',
  displayName: '虚拟学习者场景设计器',
  version: '1.0.0',
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
      goalSeed: { type: 'object' },
      personaSeed: { type: 'object' },
      situationSeed: { type: 'object' },
      stories: { type: 'array' },
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
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/<developer-reminder>[\s\S]*?<\/developer-reminder>/gi, ' ')
    .replace(/<tool-reminder>[\s\S]*?<\/tool-reminder>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/your operational mode has changed[\s\S]*$/gi, ' ')
    .replace(/you are no longer in read-only mode[\s\S]*$/gi, ' ')
    .replace(/you are permitted to make file changes[\s\S]*$/gi, ' ')
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

function normalizeEnum<T extends string>(value: any, allowed: T[], fallback: T): T {
  return allowed.includes(value) ? value : fallback;
}

function normalizeStory(raw: any, fallbackGoalSeed: any, index: number) {
  const goalSeed = raw?.goalSeed && typeof raw.goalSeed === 'object' ? raw.goalSeed : fallbackGoalSeed || {};

  return {
    id: normalizeString(raw?.id) || `story-${index + 1}`,
    title: normalizeString(raw?.title) || `故事 ${index + 1}`,
    sourceType: normalizeEnum(raw?.sourceType, ['work', 'life', 'study', 'self_management'], 'work'),
    storyOutline: normalizeString(raw?.storyOutline) || '最近在一个具体场景里遇到了卡点，但自己还没有完全想清楚问题到底出在哪。',
    triggerEvent: normalizeString(raw?.triggerEvent) || '最近一次出错或卡住的具体事件',
    visibleOpening: normalizeString(raw?.visibleOpening) || '我最近碰到个具体情况，有点卡住，不太确定该怎么处理。',
    hiddenDetails: normalizeStringArray(raw?.hiddenDetails, ['还有一些没有主动说出的限制条件']),
    misdiagnosis: normalizeString(raw?.misdiagnosis) || '先把问题归因为自己不够会，但未必抓到了真正原因',
    pressurePoints: normalizeStringArray(raw?.pressurePoints, ['近期压力会放大原本就存在的焦虑或迟疑']),
    behaviorHooks: normalizeStringArray(raw?.behaviorHooks, ['遇到关键卡点时会暴露稳定的求助或防御方式']),
    goalSeed: {
      domain: normalizeString(goalSeed.domain) || '通用技能',
      goalType: normalizeEnum(goalSeed.goalType, ['problem_driven', 'foundation_building', 'project_based', 'exam_prep', 'interest_exploration'], 'problem_driven'),
      surfaceGoal: normalizeString(goalSeed.surfaceGoal) || '想先把眼前这个问题解决掉',
      realProblem: normalizeString(goalSeed.realProblem) || '当前还没有把真实问题描述清楚',
      motivation: normalizeString(goalSeed.motivation) || '希望尽快把当前问题处理掉',
      urgencyHint: normalizeString(goalSeed.urgencyHint) || '近期需要用到',
      constraints: normalizeStringArray(goalSeed.constraints, ['时间有限']),
      expectedOutcome: normalizeString(goalSeed.expectedOutcome) || '达到能立即使用的程度'
    }
  };
}

function buildTraitFallbackSeed(personaSeed: any, goalSeed: any) {
  const occupation = normalizeString(personaSeed?.occupation) || '在职学习者';
  const background = normalizeString(personaSeed?.background) || '最近在真实任务中遇到了一个需要尽快补上的问题。';
  const domain = normalizeString(goalSeed?.domain) || '通用技能';
  const motivation = normalizeString(goalSeed?.motivation) || '希望尽快把当前问题处理掉';
  const surfaceGoal = normalizeString(goalSeed?.surfaceGoal) || '想解决一个具体学习问题';

  return {
    corePersonality: `${occupation}，习惯先从眼前场景判断有没有用，不会轻易接受脱离现实的建议。`,
    communicationStyle: `${occupation}更容易先说最近一次卡住的片段，而不是主动做完整汇报。`,
    motivationOrientation: `${motivation}，比系统性掌握更在意“现在能不能先把${surfaceGoal}这件事推进”。`,
    emotionalBaseline: `${background}让他在涉及「${domain}」时更容易出现紧张、迟疑或自我怀疑。`,
    resiliencePattern: `第一次受挫时通常先自己消化，连续卡住后才会明显怀疑方法是否适合自己。`,
    metacognitiveProfile: `能感觉到自己在「${domain}」上不顺，但未必能立刻把根因说清。`,
    cognitiveLoadTolerance: `一旦信息过多或步骤太密，会先抓最表面的可执行点，后面再慢慢补理解。`,
    selfRegulationStyle: `更容易被现实截止时间推动，而不是稳定地提前拆解和复盘。`,
    digitalLiteracy: `日常工具能用，但一到陌生流程、多步骤配置或抽象方法切换就会变慢。`,
    helpSeekingPattern: `通常会先按自己的理解试一次，确认还是卡住后才会问，而且更想听贴近自己场景的例子。`,
    adversarialPattern: `如果建议听起来太理想化、太花时间，第一反应往往是先保留、先问“现实里真能这样做吗”。`,
    memoryRepairPattern: `忘了或没完全懂时，容易先用模糊说法带过，暴露后才承认自己其实没抓稳。`,
    behavioralProfileSummary: `${occupation}会带着真实限制来求助，既想推进${surfaceGoal}，又会被现实压力和过去的卡点拖住。`
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
  const goalSeed = raw?.goalSeed && typeof raw.goalSeed === 'object' ? raw.goalSeed : {};
  const personaSeed = raw?.personaSeed && typeof raw.personaSeed === 'object' ? raw.personaSeed : {};
  const situationSeed = raw?.situationSeed && typeof raw.situationSeed === 'object' ? raw.situationSeed : {};
  const storySeeds = Array.isArray(raw?.stories) ? raw.stories : [];

  const normalizedStories = storySeeds.length
    ? storySeeds.slice(0, 3).map((story, index) => normalizeStory(story, goalSeed, index))
    : [normalizeStory({ goalSeed }, goalSeed, 0)];

  const primaryGoalSeed = normalizedStories[0]?.goalSeed || {};
  const traitFallbacks = buildTraitFallbackSeed(personaSeed, goalSeed);

  return {
    goalSeed: {
      domain: normalizeString(goalSeed.domain) || primaryGoalSeed.domain || '通用技能',
      goalType: normalizeEnum(goalSeed.goalType, ['problem_driven', 'foundation_building', 'project_based', 'exam_prep', 'interest_exploration'], primaryGoalSeed.goalType || 'problem_driven'),
      surfaceGoal: normalizeString(goalSeed.surfaceGoal) || primaryGoalSeed.surfaceGoal || '想解决一个具体学习问题',
      realProblem: normalizeString(goalSeed.realProblem) || primaryGoalSeed.realProblem || '当前还没有把真实问题描述清楚',
      motivation: normalizeString(goalSeed.motivation) || primaryGoalSeed.motivation || '希望尽快把当前问题处理掉',
      urgencyHint: normalizeString(goalSeed.urgencyHint) || primaryGoalSeed.urgencyHint || '近期需要用到',
      constraints: normalizeStringArray(goalSeed.constraints, primaryGoalSeed.constraints || ['时间有限']),
      expectedOutcome: normalizeString(goalSeed.expectedOutcome) || primaryGoalSeed.expectedOutcome || '达到能立即使用的程度',
    },
    personaSeed: {
      nameHint: normalizeString(personaSeed.nameHint) || '真实学习者',
      age: Number.isFinite(Number(personaSeed.age)) ? Math.max(18, Math.min(60, Number(personaSeed.age))) : 26,
      occupation: normalizeString(personaSeed.occupation) || '在职学习者',
      education: normalizeString(personaSeed.education) || '本科',
      background: normalizeString(personaSeed.background) || '最近在真实任务中遇到了一个需要尽快补上的问题。',
      knowledgeLevel: normalizeEnum(personaSeed.knowledgeLevel, ['beginner', 'intermediate', 'advanced'], 'beginner'),
      knownConcepts: normalizeStringArray(personaSeed.knownConcepts),
      struggleConcepts: normalizeStringArray(personaSeed.struggleConcepts),
      learningStyle: normalizeEnum(personaSeed.learningStyle, ['visual', 'auditory', 'reading', 'kinesthetic'], 'reading'),
      motivationType: normalizeEnum(personaSeed.motivationType, ['career', 'interest', 'necessity', 'social'], 'necessity'),
      availableTime: normalizeEnum(personaSeed.availableTime, ['minimal', 'moderate', 'abundant'], 'minimal'),
      techComfort: normalizeEnum(personaSeed.techComfort, ['low', 'medium', 'high'], 'medium'),
      priorAttempts: normalizeString(personaSeed.priorAttempts) || undefined,
      corePersonality: normalizeString(personaSeed.corePersonality) || traitFallbacks.corePersonality,
      personalityDrivers: normalizeStringArray(personaSeed.personalityDrivers, ['希望先把眼前问题解决', '遇到不确定时会先保留判断']),
      communicationStyle: normalizeString(personaSeed.communicationStyle) || traitFallbacks.communicationStyle,
      motivationOrientation: normalizeString(personaSeed.motivationOrientation) || traitFallbacks.motivationOrientation,
      emotionalBaseline: normalizeString(personaSeed.emotionalBaseline) || traitFallbacks.emotionalBaseline,
      emotionalTriggers: normalizeStringArray(personaSeed.emotionalTriggers, ['被要求立刻表现得很会', '担心再次犯和以前类似的错']),
      resiliencePattern: normalizeString(personaSeed.resiliencePattern) || traitFallbacks.resiliencePattern,
      metacognitiveProfile: normalizeString(personaSeed.metacognitiveProfile) || traitFallbacks.metacognitiveProfile,
      cognitiveLoadTolerance: normalizeString(personaSeed.cognitiveLoadTolerance) || traitFallbacks.cognitiveLoadTolerance,
      selfRegulationStyle: normalizeString(personaSeed.selfRegulationStyle) || traitFallbacks.selfRegulationStyle,
      digitalLiteracy: normalizeString(personaSeed.digitalLiteracy) || traitFallbacks.digitalLiteracy,
      helpSeekingPattern: normalizeString(personaSeed.helpSeekingPattern) || traitFallbacks.helpSeekingPattern,
      adversarialPattern: normalizeString(personaSeed.adversarialPattern) || traitFallbacks.adversarialPattern,
      memoryRepairPattern: normalizeString(personaSeed.memoryRepairPattern) || traitFallbacks.memoryRepairPattern,
      behaviorBoundaries: normalizeStringArray(personaSeed.behaviorBoundaries, ['通常不会主动做完整汇报式表达', '没完全想清楚前不会轻易装得特别笃定']),
      learningPreferences: normalizeStringArray(personaSeed.learningPreferences, ['先给一个贴近场景的例子', '先从最小可执行的一步开始']),
      failurePatterns: normalizeStringArray(personaSeed.failurePatterns, ['开始时很想解决问题，但容易在执行几轮后松掉', '以前试过一些方法，但没有坚持到形成稳定习惯']),
      behavioralProfileSummary: normalizeString(personaSeed.behavioralProfileSummary) || traitFallbacks.behavioralProfileSummary,
      personalityTraits: {
        verbosity: normalizeEnum(personaSeed.personalityTraits?.verbosity, ['terse', 'normal', 'verbose'], 'normal'),
        enthusiasm: normalizeEnum(personaSeed.personalityTraits?.enthusiasm, ['low', 'normal', 'high'], 'normal'),
        confusionStyle: normalizeEnum(personaSeed.personalityTraits?.confusionStyle, ['direct', 'hinting'], 'direct'),
        patience: normalizeEnum(personaSeed.personalityTraits?.patience, ['low', 'normal', 'high'], 'normal'),
        questionStyle: normalizeEnum(personaSeed.personalityTraits?.questionStyle, ['none', 'clarifying', 'challenging'], 'clarifying'),
        emotionalRange: normalizeEnum(personaSeed.personalityTraits?.emotionalRange, ['flat', 'moderate', 'expressive'], 'moderate'),
      },
    },
    situationSeed: {
      currentPhase: normalizeString(situationSeed.currentPhase) || '最近正处在一个容易暴露问题的阶段',
      recentPressure: normalizeString(situationSeed.recentPressure) || '近期有更明确的任务压力或现实场景推动',
      resourceConstraints: normalizeStringArray(situationSeed.resourceConstraints, ['时间有限']),
      whyNow: normalizeString(situationSeed.whyNow) || '最近的具体事件让这个人更强烈地感到需要把问题弄明白'
    },
    stories: normalizedStories,
    consistencyNotes: normalizeStringArray(raw?.consistencyNotes, [
      '不同 story 的 pressurePoints 与 persona 的长期情绪触发点保持一致。',
      '不同 story 的 behaviorHooks 与 persona 的求助/防御方式保持一致。'
    ]),
  };
}

function preferExistingString(existingValue: any, nextValue: any) {
  return normalizeString(existingValue) || normalizeString(nextValue) || undefined;
}

function preferExistingStringArray(existingValue: any, nextValue: any, fallback: string[] = []) {
  const existing = normalizeStringArray(existingValue);
  if (existing.length) return existing;
  const next = normalizeStringArray(nextValue);
  return next.length ? next : fallback;
}

function preferExistingEnum<T extends string>(existingValue: any, nextValue: any, allowed: T[], fallback: T) {
  if (allowed.includes(existingValue)) return existingValue as T;
  if (allowed.includes(nextValue)) return nextValue as T;
  return fallback;
}

function mergeScenarioPersonaWithExisting(output: any, existingPersonaSeed: any) {
  if (!existingPersonaSeed || typeof existingPersonaSeed !== 'object') return output;

  const currentPersona = output?.personaSeed && typeof output.personaSeed === 'object' ? output.personaSeed : {};

  return {
    ...output,
    personaSeed: {
      ...currentPersona,
      nameHint: preferExistingString(existingPersonaSeed.nameHint, currentPersona.nameHint) || '真实学习者',
      age: Number.isFinite(Number(existingPersonaSeed.age))
        ? Math.max(18, Math.min(60, Number(existingPersonaSeed.age)))
        : currentPersona.age,
      occupation: preferExistingString(existingPersonaSeed.occupation, currentPersona.occupation) || '在职学习者',
      education: preferExistingString(existingPersonaSeed.education, currentPersona.education) || '本科',
      background: preferExistingString(existingPersonaSeed.background, currentPersona.background) || '最近在真实任务中遇到了一个需要尽快补上的问题。',
      knowledgeLevel: preferExistingEnum(existingPersonaSeed.knowledgeLevel, currentPersona.knowledgeLevel, ['beginner', 'intermediate', 'advanced'], 'beginner'),
      knownConcepts: preferExistingStringArray(existingPersonaSeed.knownConcepts, currentPersona.knownConcepts),
      struggleConcepts: preferExistingStringArray(existingPersonaSeed.struggleConcepts, currentPersona.struggleConcepts),
      learningStyle: preferExistingEnum(existingPersonaSeed.learningStyle, currentPersona.learningStyle, ['visual', 'auditory', 'reading', 'kinesthetic'], 'reading'),
      motivationType: preferExistingEnum(existingPersonaSeed.motivationType, currentPersona.motivationType, ['career', 'interest', 'necessity', 'social'], 'necessity'),
      availableTime: preferExistingEnum(existingPersonaSeed.availableTime, currentPersona.availableTime, ['minimal', 'moderate', 'abundant'], 'minimal'),
      techComfort: preferExistingEnum(existingPersonaSeed.techComfort, currentPersona.techComfort, ['low', 'medium', 'high'], 'medium'),
      priorAttempts: preferExistingString(existingPersonaSeed.priorAttempts, currentPersona.priorAttempts),
      corePersonality: preferExistingString(existingPersonaSeed.corePersonality, currentPersona.corePersonality),
      personalityDrivers: preferExistingStringArray(existingPersonaSeed.personalityDrivers, currentPersona.personalityDrivers),
      communicationStyle: preferExistingString(existingPersonaSeed.communicationStyle, currentPersona.communicationStyle),
      motivationOrientation: preferExistingString(existingPersonaSeed.motivationOrientation, currentPersona.motivationOrientation),
      emotionalBaseline: preferExistingString(existingPersonaSeed.emotionalBaseline, currentPersona.emotionalBaseline),
      emotionalTriggers: preferExistingStringArray(existingPersonaSeed.emotionalTriggers, currentPersona.emotionalTriggers),
      resiliencePattern: preferExistingString(existingPersonaSeed.resiliencePattern, currentPersona.resiliencePattern),
      metacognitiveProfile: preferExistingString(existingPersonaSeed.metacognitiveProfile, currentPersona.metacognitiveProfile),
      cognitiveLoadTolerance: preferExistingString(existingPersonaSeed.cognitiveLoadTolerance, currentPersona.cognitiveLoadTolerance),
      selfRegulationStyle: preferExistingString(existingPersonaSeed.selfRegulationStyle, currentPersona.selfRegulationStyle),
      digitalLiteracy: preferExistingString(existingPersonaSeed.digitalLiteracy, currentPersona.digitalLiteracy),
      helpSeekingPattern: preferExistingString(existingPersonaSeed.helpSeekingPattern, currentPersona.helpSeekingPattern),
      adversarialPattern: preferExistingString(existingPersonaSeed.adversarialPattern, currentPersona.adversarialPattern),
      memoryRepairPattern: preferExistingString(existingPersonaSeed.memoryRepairPattern, currentPersona.memoryRepairPattern),
      behaviorBoundaries: preferExistingStringArray(existingPersonaSeed.behaviorBoundaries, currentPersona.behaviorBoundaries),
      learningPreferences: preferExistingStringArray(existingPersonaSeed.learningPreferences, currentPersona.learningPreferences),
      failurePatterns: preferExistingStringArray(existingPersonaSeed.failurePatterns, currentPersona.failurePatterns),
      behavioralProfileSummary: preferExistingString(existingPersonaSeed.behavioralProfileSummary, currentPersona.behavioralProfileSummary),
      personalityTraits: {
        verbosity: preferExistingEnum(existingPersonaSeed.personalityTraits?.verbosity, currentPersona.personalityTraits?.verbosity, ['terse', 'normal', 'verbose'], 'normal'),
        enthusiasm: preferExistingEnum(existingPersonaSeed.personalityTraits?.enthusiasm, currentPersona.personalityTraits?.enthusiasm, ['low', 'normal', 'high'], 'normal'),
        confusionStyle: preferExistingEnum(existingPersonaSeed.personalityTraits?.confusionStyle, currentPersona.personalityTraits?.confusionStyle, ['direct', 'hinting'], 'direct'),
        patience: preferExistingEnum(existingPersonaSeed.personalityTraits?.patience, currentPersona.personalityTraits?.patience, ['low', 'normal', 'high'], 'normal'),
        questionStyle: preferExistingEnum(existingPersonaSeed.personalityTraits?.questionStyle, currentPersona.personalityTraits?.questionStyle, ['none', 'clarifying', 'challenging'], 'clarifying'),
        emotionalRange: preferExistingEnum(existingPersonaSeed.personalityTraits?.emotionalRange, currentPersona.personalityTraits?.emotionalRange, ['flat', 'moderate', 'expressive'], 'moderate'),
      },
    }
  };
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
    targetStoryCount: Number.isFinite(Number(input?.targetStoryCount)) ? Number(input.targetStoryCount) : null,
  };
}

function summarizeScenarioOutput(output: any) {
  return {
    personaNameHint: output?.personaSeed?.nameHint || null,
    personaOccupation: output?.personaSeed?.occupation || null,
    storyCount: Array.isArray(output?.stories) ? output.stories.length : 0,
    storyTitles: Array.isArray(output?.stories) ? output.stories.slice(0, 3).map((story: any) => story?.title || '未命名故事') : [],
    topLevelGoalDomain: output?.goalSeed?.domain || null,
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
        targetStoryCount: Number.isFinite(Number(payload?.targetStoryCount)) ? Number(payload.targetStoryCount) : undefined,
      }),
      normalizeOutput: (parsed) => normalizeScenarioOutput(parsed),
    }, input || {});

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'VIRTUAL_LEARNER_SCENARIO_DESIGN_FAILED');
    }

    const mergedOutput = mergeScenarioPersonaWithExisting(result.output, input?.existingPersonaSeed);

    logger.info('[virtual-learner-scenario-designer] 生成完成', {
      systemPromptVersion: result.debug.systemPromptVersion,
      durationMs: result.debug.durationMs,
      inputSummary: summarizeScenarioInput(input),
      outputSummary: summarizeScenarioOutput(mergedOutput),
    });

    return {
      success: true,
      output: {
        ...mergedOutput,
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
