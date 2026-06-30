/**
 * 虚拟学习者相关 skill 共享 schema + helper.
 * 
 * 设计目标:
 * - 5 个虚拟学习者 skill 共用同一份 persona / story / friction 类型
 * - 解决之前 persona schema 三套不一致的问题 (persona-designer 精简版 vs scenario-designer 完整版)
 * - canonical 源 = scenario-designer 的输出
 */

/* ============ Persona ============ */

export type LearningStyle = 'reading' | 'watching' | 'doing' | 'listening';
export type MotivationType = 'career' | 'interest' | 'necessity' | 'social';
export type AvailableTime = 'minimal' | 'moderate' | 'abundant';
export type TechComfort = 'low' | 'medium' | 'high';

export interface VirtualLearnerPersonalityTraits {
  verbosity?: 'terse' | 'normal' | 'verbose' | null;
  enthusiasm?: 'low' | 'normal' | 'high' | null;
  confusionStyle?: 'direct' | 'hinting' | null;
  patience?: 'low' | 'normal' | 'high' | null;
  questionStyle?: 'none' | 'clarifying' | 'challenging' | null;
  emotionalRange?: 'flat' | 'moderate' | 'expressive' | null;
}

/**
 * Canonical 学习者画像
 * 等同于 scenario-designer 输出的 personaSeed 全字段集
 */
export interface VirtualLearnerPersona {
  // 基础身份
  nameHint?: string;
  age?: number | null;
  occupation?: string;
  education?: string;
  background?: string;

  // 知识
  knownConcepts?: string[];
  struggleConcepts?: string[];

  // 学习偏好
  learningStyle?: LearningStyle | null;
  motivationType?: MotivationType | null;
  availableTime?: AvailableTime | null;
  techComfort?: TechComfort | null;
  priorAttempts?: string;

  // 稳定人格
  corePersonality?: string;
  personalityDrivers?: string[];
  communicationStyle?: string;
  motivationOrientation?: string;
  emotionalBaseline?: string;
  emotionalTriggers?: string[];
  resiliencePattern?: string;
  metacognitiveProfile?: string;
  cognitiveLoadTolerance?: string;
  selfRegulationStyle?: string;
  digitalLiteracy?: string;
  helpSeekingPattern?: string;
  adversarialPattern?: string;
  memoryRepairPattern?: string;
  behaviorBoundaries?: string[];
  learningPreferences?: string[];
  failurePatterns?: string[];
  behavioralProfileSummary?: string;
  personalityTraits?: VirtualLearnerPersonalityTraits;
}

/* ============ Story ============ */

export interface VirtualLearnerStoryProblemKnowledge {
  domainFamiliarity?: 'low' | 'medium' | 'high';
  knownConcepts?: string[];
  struggleConcepts?: string[];
  selfAssessment?: string;
  hiddenGaps?: string[];
}

export interface VirtualLearnerStory {
  id?: string;
  title?: string;
  storyOutline?: string;
  outline?: string;
  storyTriggerEvent?: string;
  triggerEvent?: string;
  visibleOpening?: string;
  pressurePoints?: string[];
  hiddenDetails?: string[];
  misdiagnosis?: string;
  behaviorHooks?: string[];
  problemKnowledge?: VirtualLearnerStoryProblemKnowledge;
  goalSeed?: any;
  disclosurePlan?: any;
  sourceType?: 'generated' | 'manual' | 'imported' | string;
}

/* ============ Friction Budget ============ */

/**
 * 控制虚拟学习者对系统的"对抗度"
 * 解决"虚拟学习者总是太合作"的问题
 *
 * - none: 完全合作, 接受所有建议, 不抱怨, 不偏题
 * - low: 偶尔有顾虑, 但基本会跟从
 * - normal: 真实人物常态, 平均 ~30% 概率触发 adversarialPattern / failurePatterns
 * - high: 强压力人物常态, ~50% 概率引发顾虑/偏题/抱怨
 * - stress_test: 极限模式, 几乎每轮都触发, 用于压测系统鲁棒性
 */
export type FrictionBudget = 'none' | 'low' | 'normal' | 'high' | 'stress_test';

export const DEFAULT_FRICTION_BUDGET: FrictionBudget = 'normal';

export interface FrictionGuidance {
  /** 0-1 浮点数, 这一轮触发对抗行为的目标概率 */
  triggerProbability: number;
  /** 对 LLM 的自然语言指令片段, 用于注入 prompt */
  promptHint: string;
}

const FRICTION_TABLE: Record<FrictionBudget, FrictionGuidance> = {
  none: {
    triggerProbability: 0,
    promptHint: '【friction=none】这一轮保持完全合作，按对方的方向走，不要表达额外顾虑、不要偏题、不要质疑。'
  },
  low: {
    triggerProbability: 0.15,
    promptHint: '【friction=low】这一轮基本合作。仅当老师的建议明显与你的 emotionalTriggers / failurePatterns 触碰时，才委婉提出一个具体顾虑。不要主动偏题。'
  },
  normal: {
    triggerProbability: 0.3,
    promptHint:
      '【friction=normal】像真实人物一样回应。允许并鼓励出现以下行为之一（但同一轮最多一种，自然嵌入回复中，不要喊"我有顾虑"）：' +
      '\n  - 触发你的 adversarialPattern (例如对方建议过理想化时，提"时间不够"或"现实条件不允许")' +
      '\n  - 触发你的 failurePatterns 中某一项 (例如"我之前试过类似方法但没坚持下来")' +
      '\n  - 沿着 emotionalTriggers 表达一点情绪 (担心、防御、退缩)' +
      '\n  - 借 helpSeekingPattern 的方式追问一个具体细节而不是接受抽象建议' +
      '\n  - 偶尔短暂偏题, 联系到你 background 的一个真实场景' +
      '\n如果完全没触碰这些, 这一轮就保持正常合作。'
  },
  high: {
    triggerProbability: 0.55,
    promptHint:
      '【friction=high】你最近处境压力较大, 防御和怀疑频率高。本轮大概率触发以下之一 (允许 1-2 种同时):' +
      '\n  - 强烈表达 adversarialPattern (例: 对方说要练习, 你直接说"现在没时间")' +
      '\n  - 翻起一次 failurePatterns (例: "我两年前学这个就是这样失败的")' +
      '\n  - emotionalTriggers 被触碰时明显情绪化, 但仍然保持自己的语言风格' +
      '\n  - 反复追问同一个细节直到对方给出具体例子' +
      '\n  - 偏题去讲你 background 里的一段真实经历' +
      '\n请仍然只输出学习者自然会说的一句话, 不要标注"我现在很对抗"。'
  },
  stress_test: {
    triggerProbability: 0.85,
    promptHint:
      '【friction=stress_test 极限压测模式】本轮一定触发对抗。从以下任选 1-2 种:' +
      '\n  - 直接拒绝当前建议 (用 adversarialPattern 的方式, 例: "这不现实")' +
      '\n  - 翻 failurePatterns 的旧账质疑对方' +
      '\n  - 强烈 emotionalTriggers 情绪化' +
      '\n  - 重复追问让对方挫败' +
      '\n  - 直接转去讲一段不相关但情绪化的过往' +
      '\n仍然只输出学习者会自然说的话, 不要说"我在压测你"。'
  }
};

export function getFrictionGuidance(budget?: FrictionBudget | string | null): FrictionGuidance {
  if (!budget || !FRICTION_TABLE[budget as FrictionBudget]) {
    return FRICTION_TABLE[DEFAULT_FRICTION_BUDGET];
  }
  return FRICTION_TABLE[budget as FrictionBudget];
}

export function normalizeFrictionBudget(value: unknown): FrictionBudget {
  if (typeof value === 'string' && FRICTION_TABLE[value as FrictionBudget]) {
    return value as FrictionBudget;
  }
  return DEFAULT_FRICTION_BUDGET;
}

/**
 * 抽出 prompt 里关键的 persona 字段引用提示
 * 用于让 LLM 显式按字段决定行为而不是平均化
 */
export const PERSONA_FIELD_ANCHORS_HINT = `
请按以下字段顺序优先决定本轮回复的语言/态度/内容:
  - learner.personalityTraits.verbosity → 控制回复长度 (terse=1句, normal=1-2句, verbose=2-3句)
  - learner.personalityTraits.confusionStyle → direct=直说卡在哪 / hinting=委婉给暗示让对方猜
  - learner.personalityTraits.questionStyle → none=不提问 / clarifying=问细节 / challenging=质疑
  - learner.personalityTraits.emotionalRange → flat=克制 / moderate=自然 / expressive=明显
  - learner.helpSeekingPattern → 决定你提问的方式与门槛
  - learner.adversarialPattern → 决定你抗拒/反驳的常见说法
  - learner.emotionalTriggers → 出现这些情境时情绪化
  - learner.failurePatterns → 当对方建议触碰旧伤时, 用这些经历回应
  - story.disclosurePlan → 决定哪些信息可以暴露给老师, 哪些先保留
  - story.pressurePoints → 真实压力来源, 可以渗透在回复语气里
不要把这些字段名读出来, 让它们隐式影响回复。
`.trim();
