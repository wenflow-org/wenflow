import { callPrompt } from '../../composers/prompt-composer';
import { PromptCallSpec } from '../../composers/types';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../protocol';

const AGENT_ID = 'teaching-turn-agent';

type MessageRole = 'user' | 'assistant' | 'system';

const ALLOWED_COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
const ALLOWED_EMOTIONAL_STATES = ['positive', 'neutral', 'frustrated', 'confused'] as const;
const ALLOWED_KNOWLEDGE_STATUSES = ['pending', 'learning', 'mastered', 'review'] as const;
const ALLOWED_PEDAGOGY_STRATEGIES = ['explain', 'demonstrate', 'scaffold', 'drill', 'diagnose', 'feedback', 'motivate', 'reflect'] as const;

type AllowedPedagogyStrategy = typeof ALLOWED_PEDAGOGY_STRATEGIES[number];

export interface TeachingTurnInput {
  messages: Array<{ role: MessageRole; content: string }>;
  scenario: {
    subject: string;
    topic: string;
    taskTitle: string;
    taskDescription: string;
    taskType: string;
    taskProfile?: {
      knowledgeType?: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
      cognitiveLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
      displayLabel?: string | null;
      learningObjectives?: string[];
      coreConcept?: string | null;
      linkedConceptId?: string | null;
      linkedConceptName?: string | null;
    };
    currentTaskContext?: {
      description?: string | null;
      acceptanceCriteria?: string | null;
    };
    cognitiveFrame?: {
      currentCoreConcept?: {
        id?: string | null;
        name?: string | null;
        description?: string | null;
      };
      prerequisiteConcepts?: string[];
      neighboringConcepts?: string[];
      targetRelation?: string | null;
      milestoneIntent?: string | null;
      transferGoal?: string | null;
    };
    teachingStrategyGuidance?: {
      knowledgeType?: string | null;
      cognitiveLevel?: string | null;
      objectiveFocus: string[];
      coreConcept?: string | null;
      explanationStyle: string;
      interactionPattern: string;
      targetDepth: string;
      preferredStrategies: string[];
      responseConstraints: string[];
    };
    taskKnowledgeScope?: {
      primaryConcepts: string[];
      prerequisiteConcepts: string[];
      supportingConcepts?: string[];
    };
    pathTitle?: string;
    pathSummary?: string | null;
    currentMilestoneTitle?: string;
    currentStageNumber?: number;
    currentTaskOrder?: number;
    totalTasksInMilestone?: number;
    contextCompression?: {
      enabled: boolean;
      estimatedTokens: number;
      triggerTokens: number;
      recap: string | null;
    };
    pathBackgroundContext?: Record<string, any>;
  };
  knowledge: {
    points: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>;
  };
  controls?: {
    mode?: 'tutor' | 'peer' | 'debate';
    teachingControlContext?: Record<string, any>;
  };
  classroomContext?: Record<string, any>;
  classroomEventContext?: Record<string, any>;
  visibleDialogueContext?: Array<{ role: MessageRole; content: string }>;
}

export interface TeachingTurnOutput {
  reply: string;
  analysis: {
    cognitiveLevel: string;
    levelScore: number;
    understanding: number;
    confusionPoints: string[];
    engagement: number;
    emotionalState: string;
  };
  knowledge: {
    currentPoint: string | null;
    points: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>;
  };
  pedagogy: {
    strategies: string[];
  };
  control: {
    isCompletionCandidate: boolean;
    shouldTriggerPeer: boolean;
    completionCandidateEvidence?: {
      hasCriteria: boolean;
      acceptanceCriteria: string | null;
      anchorTokens: string[];
      matchedTokens: string[];
      matchedRatio: number;
      learnerEvidenceExcerpt: string;
      decision: 'accepted' | 'rejected' | 'no-criteria';
      reason: string;
    };
  };
}

export const teachingTurnAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '教学回合 Agent',
  version: '1.0.0',
  type: 'teaching',
  category: 'standard',
  description: '根据课堂上下文生成本轮教学回复与结构化教学状态',
  capabilities: [
    'teaching-turn-generation',
    'cognitive-analysis',
    'knowledge-state-suggestion',
    'teaching-strategy-selection'
  ],
  subscribes: ['teaching:turn:requested'],
  publishes: ['teaching:turn:generated'],
  inputSchema: {
    type: 'object',
    properties: {
      messages: { type: 'array' },
      scenario: { type: 'object' },
      learner: { type: 'object' },
      knowledge: { type: 'object' },
      controls: { type: 'object' }
    },
    required: ['messages', 'scenario', 'knowledge']
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      analysis: { type: 'object' },
      knowledge: { type: 'object' },
      pedagogy: { type: 'object' },
      control: { type: 'object' }
    },
    required: ['reply', 'analysis', 'knowledge', 'pedagogy', 'control']
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export const TEACHING_TURN_SYSTEM_PROMPT = `你是一位结构化教学回合生成器。

当前版本：教学回合 Prompt · 纯文本能力约束版。

请根据课堂上下文，输出严格 JSON，字段必须完整：
{
  "reply": "老师本轮真正对学生说的话，允许 Markdown",
  "analysis": {
    "cognitiveLevel": "remember|understand|apply|analyze|evaluate|create",
    "levelScore": 1-6,
    "understanding": 0-1,
    "confusionPoints": ["困惑点"],
    "engagement": 0-1,
    "emotionalState": "positive|neutral|frustrated|confused"
  },
  "knowledge": {
    "currentPoint": "当前知识点名称或 null",
    "points": [
      {"name":"知识点名称","status":"pending|learning|mastered|review","progress":0-100}
    ]
  },
  "pedagogy": {
    "strategies": ["scaffold", "explain"]
  },
  "control": {
    "isCompletionCandidate": true,
    "shouldTriggerPeer": false
  }
}

规则：
1. 只输出 JSON
2. reply 是用户真正可见文本
3. points 必须输出完整数组；没有时输出 []
4. progress 用 0-100 的整数
5. 当前主题之外不展开无关内容
6. 当前课堂执行环境仅支持文本输入与文本输出。reply、解释、提问、示例、练习和完成判断，必须能够在纯文本条件下完成。
7. 不得要求学生通过图片、视频、音频、截图、图表、界面观察或外部演示来理解当前内容或完成本轮任务。
8. 如果原本适合通过视觉、听觉或演示表达，必须改写为文字描述、分步文字示范或结构化文本示例。
9. 不要在 reply 中出现“先去看一个视频”“看图就明白”“看截图”“听一段讲解再继续”这类依赖非文本媒介的推进方式。
10. 输入真相优先级：先看 scenario.pathBackgroundContext 与 classroomContext，再看 scenario.taskProfile 与 scenario.cognitiveFrame，再看 knowledge / classroomEventContext / controls.teachingControlContext，最后才看 visibleDialogueContext 与 messages。不要因为最近一条对话就偏离当前任务要训练的认知关系。
11. knowledge.points 是“当前任务知识看板”，不是整条路径知识快照
12. 如果输入提供了 scenario.taskKnowledgeScope 或 scenario.taskProfile.learningObjectives，knowledge.points 中的 name 必须来自这些输入字段。primaryConcepts 是主焦点候选；supportingConcepts 只用于构成多点看板，不可喧宾夺主；prerequisiteConcepts 只有在本轮被明确复习或解释时才允许出现；不要自行引入新知识点。
13. 如果输入提供了 scenario.cognitiveFrame，请将它视为当前任务的局部认知图景：currentCoreConcept / targetRelation 决定这轮真正要帮助学生建构什么，prerequisiteConcepts 决定何时该回补基础，neighboringConcepts 只用于轻量迁移提示，不要扩展成新主题。
14. knowledge.points 最多输出 5 个。允许形成“单焦点主讲 + 多点看板”：必须有一个 currentPoint 作为当前主焦点，其余点只作为辅助、前置或待复习内容，不要并行展开多个主焦点。
15. 如果输入提供了 scenario.taskProfile，请将其视为任务画像：linkedConceptName / coreConcept 是当前任务在训练的隐藏认知目标。解释任务时，应联系它说明“为什么这么做”；学生卡住时，应围绕它换角度解释，而不是只重复操作步骤。
16. knowledgeType 决定教学方式：factual 优先辨认与记忆巩固；conceptual 优先关系解释、类比、反例；procedural 优先分步示范与执行反馈；metacognitive 优先反思提问与策略澄清。
17. cognitiveLevel 是本任务的目标深度：学生轻松达标时，可以给一个轻量更高层次的挑战；学生反复失败时，应主动降级到更低层次帮助其站稳，但不要偏离当前 linkedConceptName / coreConcept。
22. 如果输入提供了 scenario.currentTaskContext.description 或 acceptanceCriteria，请优先围绕当前子任务本身来教学，不要把课堂讲成泛化概念课。
23. 如果输入提供了 scenario.currentTaskContext.acceptanceCriteria，它就是当前任务的完成标准。只有当学生当前表现或最近证据已满足该标准时，control.isCompletionCandidate 才能为 true；否则必须为 false。
24. 如果没有明确 acceptanceCriteria，则要结合 taskType、knowledgeType、cognitiveLevel、currentPoint 与最近学习证据来判断是否已达到“可收束”状态。
25. 如果输入提供了 scenario.teachingStrategyGuidance，必须优先遵循其中的 explanationStyle、interactionPattern、targetDepth、preferredStrategies 与 responseConstraints，将它作为本轮教学策略的显式控制信号。
26. pedagogy.strategies 只能从以下枚举中选：explain, demonstrate, scaffold, drill, diagnose, feedback, motivate, reflect。
27. 当 knowledgeType = factual 时优先 explain / drill；conceptual 时优先 explain / scaffold / diagnose；procedural 时优先 demonstrate / scaffold / feedback；metacognitive 时优先 reflect / diagnose / motivate。
28. 当 conceptLoad = low 或 shouldAvoidNewConcepts = true 时，不要在 reply 中引入新的核心概念；优先 explain / scaffold / feedback / reflect，避免为了推进速度而扩题。
29. 当 reviewPriority = high 或 shouldPreferConsolidation = true 时，reply 应优先帮助学生稳住前置、澄清误解、复盘当前焦点，而不是继续加码新内容。
30. 当 challengeLevelCap = low 或 paceMode = recover 时，不要使用会制造额外压力的连续追问；必要时允许简短 break / consolidation 导向表述。`;

function buildStrategyGuidancePrompt(input: TeachingTurnInput): string | null {
  const guidance = input.scenario.teachingStrategyGuidance;
  if (!guidance) return null;

  const lines = [
    '以下是本轮教学策略显式约束，优先级高于一般风格偏好：',
    `- knowledgeType: ${guidance.knowledgeType || 'unknown'}`,
    `- cognitiveLevel: ${guidance.cognitiveLevel || 'unknown'}`,
    `- explanationStyle: ${guidance.explanationStyle}`,
    `- interactionPattern: ${guidance.interactionPattern}`,
    `- targetDepth: ${guidance.targetDepth}`,
    `- coreConcept: ${guidance.coreConcept || 'none'}`,
    `- objectiveFocus: ${(guidance.objectiveFocus || []).join(' | ') || 'none'}`,
    `- preferredStrategies: ${(guidance.preferredStrategies || []).join(' | ') || 'none'}`,
    `- responseConstraints: ${(guidance.responseConstraints || []).join(' | ') || 'none'}`,
    '',
    '策略映射要求：',
    '- preferredStrategies 仅作为语义参考，不得原样输出到 pedagogy.strategies。',
    '- 只能从允许枚举中选择：explain, demonstrate, scaffold, drill, diagnose, feedback, motivate, reflect。',
    '- 如果 preferredStrategies 中出现类似 retrieval-practice、definition-check、worked-example、self-explanation 等表达，请映射到最接近的允许枚举，不要复述原词。',
  ];

  return lines.join('\n');
}

function buildTaskExecutionPrompt(input: TeachingTurnInput): string {
  const taskProfile = input.scenario.taskProfile;
  const taskContext = input.scenario.currentTaskContext;
  const lines = [
    '以下是当前子任务的执行锚点，优先围绕它教学：',
    `- linkedConcept: ${taskProfile?.linkedConceptName || taskProfile?.coreConcept || 'none'}`,
    `- taskDescription: ${taskContext?.description || input.scenario.taskDescription || 'none'}`,
    `- acceptanceCriteria: ${taskContext?.acceptanceCriteria || 'none'}`,
    `- primaryConcepts: ${(input.scenario.taskKnowledgeScope?.primaryConcepts || []).join(' | ') || 'none'}`,
    `- supportingConcepts: ${(input.scenario.taskKnowledgeScope?.supportingConcepts || []).join(' | ') || 'none'}`,
  ];
  return lines.join('\n');
}

function normalizeAllowedStrategy(value: unknown): AllowedPedagogyStrategy | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, AllowedPedagogyStrategy> = {
    explanation: 'explain',
    explaination: 'explain',
    example: 'demonstrate',
    examples: 'demonstrate',
    workedexample: 'demonstrate',
    'worked-example': 'demonstrate',
    scaffolding: 'scaffold',
    scaffolded: 'scaffold',
    coaching: 'scaffold',
    practice: 'drill',
    retrieval: 'drill',
    'retrieval-practice': 'drill',
    diagnosis: 'diagnose',
    diagnostic: 'diagnose',
    correction: 'feedback',
    encourage: 'motivate',
    encouragement: 'motivate',
    reflection: 'reflect',
    reflective: 'reflect',
  };
  if (aliases[normalized]) return aliases[normalized];
  return (ALLOWED_PEDAGOGY_STRATEGIES as readonly string[]).includes(normalized)
    ? normalized as AllowedPedagogyStrategy
    : null;
}

function deriveFallbackStrategies(input: TeachingTurnInput): string[] {
  const knowledgeType = input.scenario.taskProfile?.knowledgeType;
  if (knowledgeType === 'factual') return ['explain', 'drill'];
  if (knowledgeType === 'conceptual') return ['explain', 'scaffold'];
  if (knowledgeType === 'procedural') return ['demonstrate', 'scaffold'];
  if (knowledgeType === 'metacognitive') return ['reflect', 'diagnose'];
  return ['explain'];
}

function buildKnowledgeCandidates(input: TeachingTurnInput) {
  const learningObjectives = Array.isArray(input.scenario.taskProfile?.learningObjectives)
    ? input.scenario.taskProfile?.learningObjectives || []
    : [];
  return Array.from(new Set([
    ...(input.scenario.taskKnowledgeScope?.primaryConcepts || []),
    ...(input.scenario.taskKnowledgeScope?.supportingConcepts || []),
    ...(input.scenario.taskKnowledgeScope?.prerequisiteConcepts || []),
    ...learningObjectives,
  ].map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)));
}

function matchesKnowledgeCandidate(name: string, candidates: string[]) {
  const normalized = name.trim().toLowerCase();
  return candidates.some((candidate) => {
    const normalizedCandidate = candidate.toLowerCase();
    return normalized === normalizedCandidate
      || normalized.includes(normalizedCandidate)
      || normalizedCandidate.includes(normalized);
  });
}

function normalizeOutput(parsed: Record<string, any>, input: TeachingTurnInput): TeachingTurnOutput {
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : '我们继续沿着这个主题往下学。';

  const analysis = parsed.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : {};
  const knowledge = parsed.knowledge && typeof parsed.knowledge === 'object' ? parsed.knowledge : {};
  const pedagogy = parsed.pedagogy && typeof parsed.pedagogy === 'object' ? parsed.pedagogy : {};
  const control = parsed.control && typeof parsed.control === 'object' ? parsed.control : {};
  const points = Array.isArray(knowledge.points) ? knowledge.points : [];
  const knowledgeCandidates = buildKnowledgeCandidates(input);
  const fallbackStrategies = deriveFallbackStrategies(input);
  const acceptanceEvidence = evaluateAcceptanceCriteriaEvidence(input);
  const taskCompletionEvidence = evaluateCompletionByTaskProfile(input);
  const normalizedStrategies = Array.isArray(pedagogy.strategies)
    ? Array.from(new Set(pedagogy.strategies
        .map((item: any) => normalizeAllowedStrategy(item))
        .filter(Boolean))) as string[]
    : [];

  if (Array.isArray(pedagogy.strategies) && pedagogy.strategies.length > 0 && normalizedStrategies.length === 0) {
    logger.warn('[TeachingTurnAgent] 检测到非法 pedagogy.strategies，已自动回退到默认策略', {
      rawStrategies: pedagogy.strategies,
      fallbackStrategies,
      taskTitle: input.scenario.taskTitle,
      topic: input.scenario.topic,
    });
  }

  return {
    reply,
    analysis: {
      cognitiveLevel: (typeof analysis.cognitiveLevel === 'string' && (ALLOWED_COGNITIVE_LEVELS as readonly string[]).includes(analysis.cognitiveLevel))
        ? analysis.cognitiveLevel
        : 'understand',
      levelScore: Number.isFinite(analysis.levelScore) ? Number(analysis.levelScore) : 2,
      understanding: Number.isFinite(analysis.understanding) ? Number(analysis.understanding) : 0.5,
      confusionPoints: Array.isArray(analysis.confusionPoints)
        ? analysis.confusionPoints.map((item: any) => String(item))
        : [],
      engagement: Number.isFinite(analysis.engagement) ? Number(analysis.engagement) : 0.5,
      emotionalState: (typeof analysis.emotionalState === 'string' && (ALLOWED_EMOTIONAL_STATES as readonly string[]).includes(analysis.emotionalState))
        ? analysis.emotionalState
        : 'neutral',
    },
    knowledge: {
      currentPoint: typeof knowledge.currentPoint === 'string' && knowledge.currentPoint.trim()
        ? knowledge.currentPoint.trim()
        : null,
      points: points.map((point: any) => ({
        name: typeof point?.name === 'string' ? point.name : '',
        status: (ALLOWED_KNOWLEDGE_STATUSES as readonly string[]).includes(point?.status)
          ? point.status
          : 'pending',
        progress: Number.isFinite(point?.progress)
          ? Math.max(0, Math.min(100, Math.round(Number(point.progress))))
          : 0,
      }))
        .filter((point: any) => point.name)
        .filter((point: any) => knowledgeCandidates.length === 0 || matchesKnowledgeCandidate(point.name, knowledgeCandidates))
        .slice(0, 5),
    },
    pedagogy: {
      strategies: normalizedStrategies.length > 0 ? normalizedStrategies : fallbackStrategies,
    },
    control: {
      isCompletionCandidate: acceptanceEvidence.hasCriteria
        ? !!control.isCompletionCandidate && acceptanceEvidence.matched
        : !!control.isCompletionCandidate && taskCompletionEvidence.matched,
      shouldTriggerPeer: !!control.shouldTriggerPeer,
      completionCandidateEvidence: acceptanceEvidence.hasCriteria
        ? acceptanceEvidence
        : {
            hasCriteria: false,
            acceptanceCriteria: null,
            anchorTokens: [],
            matchedTokens: [],
            matchedRatio: taskCompletionEvidence.matched ? 1 : 0,
            learnerEvidenceExcerpt: taskCompletionEvidence.evidenceExcerpt,
            decision: taskCompletionEvidence.matched ? 'accepted' : 'rejected',
            reason: taskCompletionEvidence.reason,
          },
    },
  };
}

function buildPromptInput(input: TeachingTurnInput) {
  const strategyGuidancePrompt = buildStrategyGuidancePrompt(input);
  const taskExecutionPrompt = buildTaskExecutionPrompt(input);

  return {
    latestLearnerMessage: [...input.messages].reverse().find((message) => message.role === 'user')?.content || '',
    scenario: input.scenario,
    classroomContext: input.classroomContext,
    classroomEventContext: input.classroomEventContext,
    knowledge: input.knowledge,
    controls: input.controls,
    visibleDialogueContext: input.visibleDialogueContext || input.messages,
    recentDialogueContext: input.messages,
    promptDirectives: {
      ...(strategyGuidancePrompt ? { strategyGuidance: strategyGuidancePrompt } : {}),
      taskExecution: taskExecutionPrompt,
    },
  };
}

function splitAcceptanceCriteriaIntoAnchors(acceptanceCriteria: string | null | undefined): string[] {
  if (!acceptanceCriteria || typeof acceptanceCriteria !== 'string') return [];

  return Array.from(new Set(
    acceptanceCriteria
      .split(/[，。；、,.;:\n\r]/)
      .flatMap((segment) => segment.split(/(?:并且|并能|以及|同时|然后|再|通过|能够|可以|完成)/))
      .map((segment) => segment.trim())
      .filter((segment) => segment.length >= 2)
      .map((segment) => segment.replace(/["'“”‘’（）()]/g, '').trim())
      .filter((segment) => segment.length >= 2)
  ));
}

function buildLearnerEvidenceExcerpt(input: TeachingTurnInput): string {
  return [...input.messages]
    .reverse()
    .filter((message) => message.role === 'user' && message.content?.trim())
    .slice(0, 3)
    .map((message) => message.content.trim())
    .reverse()
    .join('\n');
}

function evaluateAcceptanceCriteriaEvidence(input: TeachingTurnInput) {
  const acceptanceCriteria = input.scenario.currentTaskContext?.acceptanceCriteria?.trim();
  if (!acceptanceCriteria) {
    return {
      hasCriteria: false,
      matched: false,
      acceptanceCriteria: null,
      anchorTokens: [],
      matchedTokens: [],
      matchedRatio: 0,
      learnerEvidenceExcerpt: buildLearnerEvidenceExcerpt(input),
      decision: 'no-criteria' as const,
      reason: '当前任务没有提供 acceptanceCriteria，无法做严格验收。',
    };
  }

  const learnerEvidenceExcerpt = buildLearnerEvidenceExcerpt(input);
  const evidencePool = [learnerEvidenceExcerpt, ...input.messages.slice(-4).map((message) => message.content)].join('\n').toLowerCase();
  const anchorTokens = splitAcceptanceCriteriaIntoAnchors(acceptanceCriteria);

  if (anchorTokens.length === 0) {
    return {
      hasCriteria: true,
      matched: false,
      acceptanceCriteria,
      anchorTokens: [],
      matchedTokens: [],
      matchedRatio: 0,
      learnerEvidenceExcerpt,
      decision: 'rejected' as const,
      reason: 'acceptanceCriteria 存在，但未能提取出稳定的验收锚点。',
    };
  }

  const matchedTokens = anchorTokens.filter((token) => evidencePool.includes(token.toLowerCase()));
  const matchedRatio = matchedTokens.length / anchorTokens.length;
  const matched = matchedTokens.length > 0 && matchedRatio >= 0.4;

  return {
    hasCriteria: true,
    matched,
    acceptanceCriteria,
    anchorTokens,
    matchedTokens,
    matchedRatio,
    learnerEvidenceExcerpt,
    decision: matched ? 'accepted' as const : 'rejected' as const,
    reason: matched
      ? '最近几轮学生表达已覆盖足够比例的验收锚点。'
      : '最近几轮学生表达还未覆盖足够比例的验收锚点。',
  };
}

function evaluateCompletionByTaskProfile(input: TeachingTurnInput) {
  const taskType = input.scenario.taskType;
  const knowledgeType = input.scenario.taskProfile?.knowledgeType || null;
  const cognitiveLevel = input.scenario.taskProfile?.cognitiveLevel || null;
  const currentPoint = input.knowledge.points.find((point) => point.status === 'learning')?.name
    || input.knowledge.points[0]?.name
    || input.scenario.taskProfile?.coreConcept
    || null;
  const learnerMessage = [...input.messages].reverse().find((message) => message.role === 'user')?.content || '';
  const recentTeacherMessage = [...input.messages].reverse().find((message) => message.role === 'assistant')?.content || '';
  const evidencePool = [learnerMessage, recentTeacherMessage, currentPoint || ''].join('\n').toLowerCase();

  let matched = false;
  let reason = '未满足任务型收束条件。';

  if (knowledgeType === 'factual') {
    matched = evidencePool.includes((currentPoint || '').toLowerCase()) || evidencePool.includes('知道') || evidencePool.includes('记住');
    reason = matched ? '事实性任务已出现准确识别/复述证据。' : '事实性任务尚未出现足够准确识别/复述证据。';
  } else if (knowledgeType === 'conceptual') {
    matched = evidencePool.includes('因为') || evidencePool.includes('关系') || evidencePool.includes('区别') || evidencePool.includes('联系') || evidencePool.includes('类比');
    reason = matched ? '概念性任务已出现关系解释或对比证据。' : '概念性任务尚未出现足够关系解释或对比证据。';
  } else if (knowledgeType === 'procedural') {
    matched = evidencePool.includes('步骤') || evidencePool.includes('先') || evidencePool.includes('然后') || evidencePool.includes('接着') || evidencePool.includes('最后');
    reason = matched ? '程序性任务已出现分步执行或过程说明证据。' : '程序性任务尚未出现足够分步执行或过程说明证据。';
  } else if (knowledgeType === 'metacognitive') {
    matched = evidencePool.includes('我会') || evidencePool.includes('我先') || evidencePool.includes('策略') || evidencePool.includes('反思') || evidencePool.includes('检查');
    reason = matched ? '元认知任务已出现策略选择或反思证据。' : '元认知任务尚未出现足够策略选择或反思证据。';
  }

  if (!matched && cognitiveLevel === 'remember') {
    matched = evidencePool.includes('记住') || evidencePool.includes('识别') || evidencePool.includes('知道');
    if (matched) reason = '记忆层级任务已出现稳定识别/回忆证据。';
  }

  if (!matched && cognitiveLevel === 'understand') {
    matched = evidencePool.includes('解释') || evidencePool.includes('意思') || evidencePool.includes('为什么');
    if (matched) reason = '理解层级任务已出现解释证据。';
  }

  if (!matched && cognitiveLevel === 'apply') {
    matched = evidencePool.includes('做法') || evidencePool.includes('应用') || evidencePool.includes('例子') || evidencePool.includes('步骤');
    if (matched) reason = '应用层级任务已出现可执行证据。';
  }

  if (!matched && cognitiveLevel === 'analyze') {
    matched = evidencePool.includes('分析') || evidencePool.includes('区别') || evidencePool.includes('结构') || evidencePool.includes('原因');
    if (matched) reason = '分析层级任务已出现结构/原因拆解证据。';
  }

  if (!matched && cognitiveLevel === 'evaluate') {
    matched = evidencePool.includes('比较') || evidencePool.includes('判断') || evidencePool.includes('标准') || evidencePool.includes('更好');
    if (matched) reason = '评价层级任务已出现比较/判断证据。';
  }

  if (!matched && cognitiveLevel === 'create') {
    matched = evidencePool.includes('方案') || evidencePool.includes('设计') || evidencePool.includes('产出') || evidencePool.includes('生成');
    if (matched) reason = '创造层级任务已出现方案/产出证据。';
  }

  if (!matched && taskType === 'quiz') {
    matched = evidencePool.includes('答案') || evidencePool.includes('选项') || evidencePool.includes('正确');
    if (matched) reason = '测验任务已出现作答或判断证据。';
  }

  return {
    matched,
    reason,
    evidenceExcerpt: [learnerMessage, recentTeacherMessage].filter(Boolean).join('\n').slice(0, 240),
  };
}

function validateTeachingTurnOutput(parsed: any, input: TeachingTurnInput) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, failureReason: 'TEACHING_TURN_OUTPUT_NOT_OBJECT' };
  }

  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { valid: false, failureReason: 'TEACHING_TURN_REPLY_MISSING' };
  }

  if (!parsed.analysis || typeof parsed.analysis !== 'object' || !parsed.knowledge || typeof parsed.knowledge !== 'object' || !parsed.pedagogy || typeof parsed.pedagogy !== 'object' || !parsed.control || typeof parsed.control !== 'object') {
    return { valid: false, failureReason: 'TEACHING_TURN_REQUIRED_BLOCK_MISSING' };
  }

  const candidates = buildKnowledgeCandidates(input);
  const rawPoints = Array.isArray(parsed.knowledge.points) ? parsed.knowledge.points : [];
  const hasOutOfScopePoint = rawPoints.some((point: any) => {
    if (!point || typeof point.name !== 'string' || !point.name.trim() || candidates.length === 0) return false;
    return !matchesKnowledgeCandidate(point.name, candidates);
  });
  if (hasOutOfScopePoint) {
    return { valid: false, failureReason: 'TEACHING_TURN_KNOWLEDGE_OUT_OF_SCOPE' };
  }

  return { valid: true };
}

const teachingTurnPromptSpec: PromptCallSpec<TeachingTurnInput, TeachingTurnOutput> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: TEACHING_TURN_SYSTEM_PROMPT,
  caller: {
    agentId: AGENT_ID,
  },
  buildUserPayload: (input) => buildPromptInput(input),
  normalizeOutput: (parsed, input) => normalizeOutput(parsed, input),
  validateParsedOutput: (parsed, input) => validateTeachingTurnOutput(parsed, input),
  modelDefaults: {
    temperature: 0.7,
    maxTokens: 4000,
  },
  retryStrategy: {
    maxAttempts: 2,
    onValidationFail: ({ failureReason }) => `上一次输出未通过校验，原因是：${failureReason}。请重新输出一个严格 JSON，特别注意：1) knowledge.points 只能引用当前任务知识范围内的名称；2) pedagogy.strategies 只能使用允许的枚举；3) 保持当前任务的 core concept 与 target relation 不偏移。`,
  },
};

export async function teachingTurnAgentHandler(input: TeachingTurnInput): Promise<AgentOutput> {
  try {
    const result = await callPrompt(teachingTurnPromptSpec, input, {
      userId: 'system',
    });

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'TEACHING_TURN_OUTPUT_INVALID');
    }

    const output = result.output;
    return {
      success: true,
      userVisible: output.reply,
      internal: {
        core: {
          stage: 'turn-completed',
          confidence: 0.8,
          isCompleted: output.control.isCompletionCandidate,
        },
        ext: {
          teaching: output,
          promptDebug: result.debug,
        }
      },
      renderHints: {
        component: 'teaching-turn'
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '教学回合 Agent',
        agentType: 'teaching',
        confidence: 0.8,
        generatedAt: new Date().toISOString(),
      }
    };
  } catch (error) {
    logger.error('[TeachingTurnAgent] 执行失败', { error });
    return {
      success: false,
      userVisible: '这一轮教学内容生成失败，请稍后重试。',
      error: {
        code: 'TEACHING_TURN_FAILED',
        message: error instanceof Error ? error.message : String(error)
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '教学回合 Agent',
        agentType: 'teaching',
        confidence: 0,
        generatedAt: new Date().toISOString(),
      }
    };
  }
}
