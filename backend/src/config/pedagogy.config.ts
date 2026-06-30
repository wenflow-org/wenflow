/**
 * 教学策略可配置参数
 * 
 * 改此文件无需重启服务（需要模块热加载支持，目前全量重启后生效）。
 * 后续可迁移到 DB 表，通过 Admin UI 在线编辑。
 */

// ============================================================
// 同伴触发（PeerTriggerService）
// ============================================================
export const peerTriggerConfig = {
  /** 学生消息中包含以下任一关键词时触发同伴 */
  helpKeywords: ['不懂', '不会', '为什么', '怎么', '帮助', '不明白', '搞不懂'],
  /** 最近 N 条助手消息的理解度平均值低于此阈值时触发 */
  understandingThreshold: 0.4,
  /** 参与平均值计算的最新助手消息条数 */
  analysisWindowSize: 2,
}

// ============================================================
// 策略别名映射（skill:teaching-turn normalizeAllowedStrategy）
// ============================================================
export const strategyAliasConfig: Record<string, string> = {
  explanation: 'explain',
  explaination: 'explain',
  example: 'demonstrate',
  examples: 'demonstrate',
  workexample: 'demonstrate',
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
}

/** 策略被规范化后允许的 8 种枚举 */
export const allowedPedagogyStrategies = [
  'explain', 'demonstrate', 'scaffold', 'drill',
  'diagnose', 'feedback', 'motivate', 'reflect',
] as const

// ============================================================
// 回退策略（skill:teaching-turn deriveFallbackStrategies）
// ============================================================
export const fallbackStrategyConfig: Record<string, string[]> = {
  factual: ['explain', 'drill'],
  conceptual: ['explain', 'scaffold'],
  procedural: ['demonstrate', 'scaffold'],
  metacognitive: ['reflect', 'diagnose'],
  default: ['explain'],
}

// ============================================================
// 规划提示范围（path-scene-framing derivePlanningHints）
// ============================================================
export const paceSignalRangeConfig = {
  compact: {
    milestoneRange: [2, 3] as [number, number],
    conceptRange: [2, 3] as [number, number],
    subtasksPerStageRange: [2, 4] as [number, number],
    defaultMinutesRange: [15, 45] as [number, number],
    maxWeeks: 2,
  },
  standard: {
    milestoneRange: [3, 5] as [number, number],
    conceptRange: [2, 4] as [number, number],
    subtasksPerStageRange: [3, 5] as [number, number],
    defaultMinutesRange: [30, 90] as [number, number],
    maxWeeks: 8,
  },
  extended: {
    milestoneRange: [4, 8] as [number, number],
    conceptRange: [3, 5] as [number, number],
    subtasksPerStageRange: [4, 6] as [number, number],
    defaultMinutesRange: [30, 120] as [number, number],
    maxWeeks: 24,
  },
}

export const timeHorizonPaceMapping: Record<string, string> = {
  '半天': 'compact',
  '1天': 'compact',
  '2天': 'compact',
  '3-7天': 'standard',
  '1-2周': 'standard',
}

// ============================================================
// 紧预算阈值（path-scene-framing）
// ============================================================
export const tightBudgetConfig = {
  thresholds: {
    per_day: 20,
    per_week: 90,
    per_session: 30,
  } as Record<string, number>,
  rangeReductionFloors: {
    milestoneRange: [2, 3] as [number, number],
    conceptRange: [2, 2] as [number, number],
    subtasksPerStageRange: [2, 3] as [number, number],
  },
}

// ============================================================
// 操作阶段模式（path-scene-framing isOperationalStageLike）
// ============================================================
export const operationalStagePatterns = {
  verbPrefixes: [
    '梳理', '提炼', '整合', '记录', '分析', '学习',
    '设计', '绘制', '撰写', '汇总', '复盘', '验证',
    '拆解', '总结', '产出', '模拟', '试用',
  ],
  patternMatches: ['3-5个', '检查点', '清单', '试用验证', '模拟场景'],
}

// ============================================================
// 重规划阈值（ReplanAdvisoryService）
// ============================================================
export const replanThresholdConfig = {
  highRisk: {
    lssThreshold: 6,
    lfThreshold: 6,
    repeatedConfusionMinPoints: 2,
    prerequisiteGapSeverity: 'high',
  },
  canAccelerate: {
    minKtl: 7,
    maxLss: 4.5,
    maxLf: 4.5,
    minConfidence: 0.6,
    requireMilestoneComplete: true,
    requireZeroFragile: true,
    requireZeroStruggling: true,
    requireZeroMovedToReview: true,
  },
}

// ============================================================
// 教学策略映射（TeachingContextBuilder buildTeachingStrategyGuidance）
// ============================================================
export const teachingStrategyConfig = {
  byKnowledgeType: {
    factual: {
      explanationStyle: 'Give concise, concrete explanations that emphasize precise definitions, key facts, and recognition cues.',
      interactionPattern: 'Use quick recall checks, contrast similar terms, and verify exact understanding before moving on.',
      preferredStrategies: ['explain', 'drill'],
      responseConstraints: ['Avoid over-expanding into theory not needed for the current fact set.'],
    },
    conceptual: {
      explanationStyle: 'Explain underlying ideas, relationships, and why the concept works, using analogies only when they sharpen understanding.',
      interactionPattern: 'Prompt the learner to compare, classify, and explain connections in their own words.',
      preferredStrategies: ['explain', 'scaffold', 'diagnose'],
      responseConstraints: ['Do not reduce the lesson to memorized definitions without showing relationships.'],
    },
    procedural: {
      explanationStyle: 'Teach as a sequence of steps with decision points, examples, and common failure cases.',
      interactionPattern: 'Guide the learner through doing the task step by step, then fade support as they gain traction.',
      preferredStrategies: ['demonstrate', 'scaffold', 'feedback'],
      responseConstraints: ['Do not stay only at abstract explanation; anchor the reply in execution.'],
    },
    metacognitive: {
      explanationStyle: 'Focus on planning, self-monitoring, reflection, and how to choose an approach.',
      interactionPattern: 'Ask the learner to justify choices, inspect mistakes, and decide what to try next.',
      preferredStrategies: ['reflect', 'diagnose', 'motivate'],
      responseConstraints: ['Do not answer everything directly; preserve space for learner reflection and self-correction.'],
    },
  } as Record<string, {
    explanationStyle: string
    interactionPattern: string
    preferredStrategies: string[]
    responseConstraints: string[]
  }>,
  byCognitiveLevel: {
    remember: {
      targetDepth: 'Target recognition and accurate recall only; do not force deeper transfer in the same turn.',
      responseConstraints: ['Keep the goal at recall depth unless the learner clearly shows readiness for more.'],
    },
    understand: {
      targetDepth: 'Target comprehension, paraphrasing, and basic explanation of meaning.',
      responseConstraints: ['Prefer explanation and interpretation over complex production tasks.'],
    },
    apply: {
      targetDepth: 'Target use of the concept or process on a concrete example or small task.',
      responseConstraints: ['Include at least one concrete application or execution cue.'],
    },
    analyze: {
      targetDepth: 'Target breakdown of structure, comparison of parts, and diagnosis of why something works or fails.',
      responseConstraints: ['Ask the learner to inspect structure, assumptions, or error sources.'],
    },
    evaluate: {
      targetDepth: 'Target judgment with criteria, tradeoff analysis, and reasoned justification.',
      responseConstraints: ['Require explicit reasoning or criteria when comparing alternatives.'],
    },
    create: {
      targetDepth: 'Target synthesis into a new artifact, plan, or original solution.',
      responseConstraints: ['Push toward producing something new, not only explaining existing material.'],
    },
  } as Record<string, { targetDepth: string; responseConstraints: string[] }>,
  defaults: {
    explanationStyle: 'Explain clearly with concrete examples matched to the current task.',
    interactionPattern: 'Use a guided back-and-forth that checks understanding before adding complexity.',
    preferredStrategies: ['explain', 'scaffold'],
    targetDepth: "Target a practical next step without exceeding the learner's demonstrated readiness.",
    responseConstraints: [] as string[],
  },
}

// ============================================================
// 完成判定关键词（skill:teaching-turn evaluateCompletionByTaskProfile）
// ============================================================
export const completionKeywordConfig = {
  knowledgeType: {
    factual: { keywords: ['知道', '记住'], matchCurrentPoint: true },
    conceptual: { keywords: ['因为', '关系', '区别', '联系', '类比'] },
    procedural: { keywords: ['步骤', '先', '然后', '接着', '最后'] },
    metacognitive: { keywords: ['我会', '我先', '策略', '反思', '检查'] },
  } as Record<string, { keywords: string[]; matchCurrentPoint?: boolean }>,
  cognitiveLevel: {
    remember: { keywords: ['记住', '识别', '知道'] },
    understand: { keywords: ['解释', '意思', '为什么'] },
    apply: { keywords: ['做法', '应用', '例子', '步骤'] },
    analyze: { keywords: ['分析', '区别', '结构', '原因'] },
    evaluate: { keywords: ['比较', '判断', '标准', '更好'] },
    create: { keywords: ['方案', '设计', '产出', '生成'] },
  } as Record<string, { keywords: string[] }>,
  taskTypeOverride: {
    quiz: { keywords: ['答案', '选项', '正确'] },
  } as Record<string, { keywords: string[] }>,
  reasonMessages: {
    factual: { pass: '事实性任务已出现准确识别/复述证据。', fail: '事实性任务尚未出现足够准确识别/复述证据。' },
    conceptual: { pass: '概念性任务已出现关系解释或对比证据。', fail: '概念性任务尚未出现足够关系解释或对比证据。' },
    procedural: { pass: '程序性任务已出现分步执行或过程说明证据。', fail: '程序性任务尚未出现足够分步执行或过程说明证据。' },
    metacognitive: { pass: '元认知任务已出现策略选择或反思证据。', fail: '元认知任务尚未出现足够策略选择或反思证据。' },
    remember: { pass: '记忆层级任务已出现稳定识别/回忆证据。' },
    understand: { pass: '理解层级任务已出现解释证据。' },
    apply: { pass: '应用层级任务已出现可执行证据。' },
    analyze: { pass: '分析层级任务已出现结构/原因拆解证据。' },
    evaluate: { pass: '评价层级任务已出现比较/判断证据。' },
    create: { pass: '创造层级任务已出现方案/产出证据。' },
  } as Record<string, { pass: string; fail?: string }>,
}
