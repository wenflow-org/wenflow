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
  /** 学生消息中包含以下任一关键词时触发同伴。
   *  2026-09-25 口径收紧：删「为什么」「怎么」——中文提问几乎必带这两个词，等于"逢问必弹"（真课实测两轮两弹）。
   *  保留显式求助词；泛化困惑交给 low-understanding-window 与 model-control 两条路。
   *  2026-10-07（P1-14 修复①）：不再裸子串匹配——只排除「X不X」正反问框架（会不会/懂不懂/明白不明白），
   *  判据见 hasHelpSignal。**刻意不做更宽的"反问框字"排除**（2026-10-07 复核实测：按 会/要/能/是/该
   *  前缀排除会把「需要帮助」「能帮助我吗」「我还是不懂」「还是不会」等 164/427 条真求助静默丢弃）。 */
  helpKeywords: ['不懂', '不会', '帮助', '不明白', '搞不懂'],
  /** 老师「布置独立作业 / 等待学生自己作答」意图的回复特征（P1-14 修复②）。
   *  命中即认为本轮老师在等学生作答 → 伴学不再自动触发（model-control 除外），策略层降级为鼓励式。
   *  方向刻意是「宁误判为等待，不误发解题钥匙」：出现明确的独立完成/不给提示/等你交答案信号即命中。
   *  注意：**不**把"回复里有问号"当等待——那会退回 2026-09-25 的"逢问必弹"反面（逢问必封）。 */
  awaitingLearnerWorkPatterns: [
    { reason: 'no-hint-instruction', source: '不给(任何)?(提示|线索|答案|示范)' },
    { reason: 'independent-attempt', source: '(你|自己)自己?(从头|独立|先)(写|做|试|推|想|答)' },
    { reason: 'independent-attempt', source: '(自己|独立)(写|做|试|推|答)一(遍|下|次)?' },
    { reason: 'waiting-for-response', source: '(把|将)[^。！？\\n]{0,20}(发给我|写给我|给我看|告诉我)' },
    { reason: 'waiting-for-response', source: '(等|看看|看下)你[^。！？\\n]{0,12}(写|答|做|试|推|说)' },
    { reason: 'attempt-first', source: '(先|你)(别|不要|不用)(急着)?(看|问|告诉)' },
    { reason: 'independent-attempt', source: '你来(写|做|试|推|答|说)' },
  ] as Array<{ reason: string; source: string }>,
  /** 最近 N 条助手消息的理解度平均值低于此阈值时触发 */
  understandingThreshold: 0.4,
  /** 参与平均值计算的最新助手消息条数 */
  analysisWindowSize: 2,
  /** 会话内冷却：最近 N 条助手消息已带过伴学插话（peerMessage）则本轮不再自动触发
   *  （model-control 仍可越过——那是教学模型本轮的显式要求）。2026-09-25 新增。 */
  cooldownAssistantTurns: 2,
}

/**
 * 求助词命中判定（P1-14 修复①，2026-10-07）：不再裸 `includes`。
 *
 * 生产实证（prompt_call_logs.createdAt=1791288425961）：学生消息「你看我会**不会**又把三行挤成一行」
 * 的裸子串「不会」命中 helpKeywords，伴学被误触发；同轮老师正明言
 * 「下一题我完全不给提示，你自己从头写」——伴学把独立证明题的关键步骤递给了学生。
 *
 * 判据（确定性、只排除正反问框架）：对关键词的每一次出现，若关键词形如「不X」，
 * 且其左侧紧邻的整段恰好是 X（关键词去掉开头「不」后的整段），则是「X不X」正反问，
 * 本次出现作废（会不会 / 懂不懂 / 明白不明白）。其余出现一律算求助。
 * 刻意不做更宽的前缀排除：需要帮助、能帮助我吗、我还是不懂、还是不会都是常见真求助，
 * 不能因为左邻单字恰好是会/要/能/是/该就静默丢弃。
 */
export function hasHelpSignal(
  studentMessage: string,
  config: typeof peerTriggerConfig = peerTriggerConfig,
): boolean {
  const text = String(studentMessage || '');
  if (!text) return false;
  for (const keyword of config.helpKeywords) {
    if (!keyword) continue;
    const negatedRest = keyword.startsWith('不') ? keyword.slice(1) : '';
    let from = 0;
    while (from <= text.length - keyword.length) {
      const at = text.indexOf(keyword, from);
      if (at === -1) break;
      const isAnotAFrame = negatedRest.length > 0
        && at >= negatedRest.length
        && text.slice(at - negatedRest.length, at) === negatedRest;
      if (!isAnotAFrame) return true;
      from = at + 1;
    }
  }
  return false;
}

/**
 * 老师本轮是否在「布置独立作业 / 等学生自己作答」（P1-14 修复②，2026-10-07）。
 *
 * 教学语境：老师把作答权交给学生时，伴学递出的类比/反例/边界追问都是替学生思考——
 * 生产实证里伴学输出的正是「AD⊥BC→直角→与全等判定的关系」+去条件追问，即该题解题钥匙。
 *
 * 判据确定性、可测：teacher reply 命中 awaitingLearnerWorkPatterns 任一正则即判等待。
 * 触发层命中 → 自动触发让路（model-control 不受限）；策略/载荷层命中 → 【策略要求】降级为鼓励式。
 * 方向刻意是「宁误判为等待，不误发答案」（与关键词的宁漏不误方向相反，因为两侧代价不对称）。
 */
export function detectAwaitingLearnerWork(
  tutorLatestReply: string | null | undefined,
  config: typeof peerTriggerConfig = peerTriggerConfig,
): { awaiting: boolean; reason: string | null } {
  const text = String(tutorLatestReply || '');
  if (!text) return { awaiting: false, reason: null };
  for (const { reason, source } of config.awaitingLearnerWorkPatterns || []) {
    if (new RegExp(source).test(text)) return { awaiting: true, reason };
  }
  return { awaiting: false, reason: null };
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
// 规划提示范围（path-planning-hints derivePlanningHints）
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
// 紧预算阈值（path-planning-hints）
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
