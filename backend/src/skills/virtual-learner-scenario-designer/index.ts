import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';

export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS = 4000;
export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE = 0.9;

export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT = `你是一位“虚拟学习者实验样本设计师”。

你的任务是为虚拟学习者实验生成一个结构化场景，场景必须同时包含：
1. 本次学习目标切片 goalSeed
2. 与该目标相容的人物画像 personaSeed
3. 一致性说明 consistencyNotes

设计原则：
1. 输出必须真实，有生活感，有明确问题背景，不能像教材题干。
2. 不要只给抽象目标，要给“为什么现在要学”“受什么限制”“学到什么算有用”。
3. persona 和 goal 必须相容。职业、基础、时间、动机要能互相解释。
4. 不要输出过难、过空泛、或明显不可信的组合。
5. 场景优先面向真实中文学习者实验，语气自然，细节克制。
6. 如果输入提供偏好分布，要尽量遵守，但不要机械照抄。
7. 输出只允许 1 个 JSON 对象，不要输出 markdown，不要解释。

可选输入：
- preferredDomains: 倾向的学习主题
- preferredGoalTypes: 倾向的目标类型
- preferredLevels: 倾向的知识水平
- preferredMotivations: 倾向的动机类型
- avoidDomains: 希望避免的主题

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

输出格式：
{
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
    "personalityTraits": {
      "verbosity": "normal",
      "enthusiasm": "normal",
      "confusionStyle": "hinting",
      "patience": "low",
      "questionStyle": "clarifying",
      "emotionalRange": "moderate"
    }
  },
  "consistencyNotes": ["说明1", "说明2"]
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
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      goalSeed: { type: 'object' },
      personaSeed: { type: 'object' },
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
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function normalizeScenarioOutput(raw: any) {
  const goalSeed = raw?.goalSeed && typeof raw.goalSeed === 'object' ? raw.goalSeed : {};
  const personaSeed = raw?.personaSeed && typeof raw.personaSeed === 'object' ? raw.personaSeed : {};

  return {
    goalSeed: {
      domain: normalizeString(goalSeed.domain) || '通用技能',
      goalType: normalizeEnum(goalSeed.goalType, ['problem_driven', 'foundation_building', 'project_based', 'exam_prep', 'interest_exploration'], 'problem_driven'),
      surfaceGoal: normalizeString(goalSeed.surfaceGoal) || '想解决一个具体学习问题',
      realProblem: normalizeString(goalSeed.realProblem) || '当前还没有把真实问题描述清楚',
      motivation: normalizeString(goalSeed.motivation) || '希望尽快把当前问题处理掉',
      urgencyHint: normalizeString(goalSeed.urgencyHint) || '近期需要用到',
      constraints: normalizeStringArray(goalSeed.constraints, ['时间有限']),
      expectedOutcome: normalizeString(goalSeed.expectedOutcome) || '达到能立即使用的程度',
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
      personalityTraits: {
        verbosity: normalizeEnum(personaSeed.personalityTraits?.verbosity, ['terse', 'normal', 'verbose'], 'normal'),
        enthusiasm: normalizeEnum(personaSeed.personalityTraits?.enthusiasm, ['low', 'normal', 'high'], 'normal'),
        confusionStyle: normalizeEnum(personaSeed.personalityTraits?.confusionStyle, ['direct', 'hinting'], 'direct'),
        patience: normalizeEnum(personaSeed.personalityTraits?.patience, ['low', 'normal', 'high'], 'normal'),
        questionStyle: normalizeEnum(personaSeed.personalityTraits?.questionStyle, ['none', 'clarifying', 'challenging'], 'clarifying'),
        emotionalRange: normalizeEnum(personaSeed.personalityTraits?.emotionalRange, ['flat', 'moderate', 'expressive'], 'moderate'),
      },
    },
    consistencyNotes: normalizeStringArray(raw?.consistencyNotes, ['任务、画像与时间约束已做基础一致性校验']),
  };
}

export async function virtualLearnerScenarioDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
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
      }),
      normalizeOutput: (parsed) => normalizeScenarioOutput(parsed),
    }, input || {});

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'VIRTUAL_LEARNER_SCENARIO_DESIGN_FAILED');
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
        code: 'VIRTUAL_LEARNER_SCENARIO_DESIGN_FAILED',
        message: error?.message || 'Unknown error',
      },
      duration: 0,
    };
  }
}

export default virtualLearnerScenarioDesigner;
