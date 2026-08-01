import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { logger } from '../../utils/logger';

export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS = 8000;
export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE = 0.9;

// File-as-Truth：运行时生效的 ACTIVE prompt 由 prompts/core/*.yaml 编译而来，
// 这里只从编译产物加载，不内嵌第二份 prompt，避免双源漂移。
export const VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT =
  loadPromptFile('skill:virtual-learner-scenario-designer')?.systemPrompt || '';

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
      mapEnvelope: (output, _input, runtimeContract) => mapSkillOutputEnvelope(runtimeContract, output, {
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
