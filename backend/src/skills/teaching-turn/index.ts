import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { PromptCallSpec, type PromptCallResult } from '../../composers/types';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../../agents/protocol';
import { evaluateByCriteria, evaluateByProfile } from '../../skills/acceptance-evidence-evaluator';
import { getFallbackStrategies, normalizeStrategy, buildGuidancePrompt } from '../../skills/teaching-strategy-selector';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { buildSkillOutcome, type SkillOutcome } from '../outcome';

const AGENT_ID = 'skill:teaching-turn';

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const TEACHING_TURN_PROMPT = loadPromptFile(AGENT_ID)?.systemPrompt || '';

type MessageRole = 'user' | 'assistant' | 'system';

const ALLOWED_COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
const ALLOWED_EMOTIONAL_STATES = ['positive', 'neutral', 'frustrated', 'confused', 'bored'] as const;
const ALLOWED_KNOWLEDGE_STATUSES = ['pending', 'learning', 'mastered', 'review'] as const;
const ALLOWED_LOAD_BASIS = ['semantic', 'structure', 'pacing', 'combined', 'absent'] as const;

/** knowledge 对象的子字段：Q9 契约漂移容错时按此名单从顶层回填（见 resolveKnowledgeBlock） */
const KNOWLEDGE_SUBFIELD_KEYS = ['currentPoint', 'points', 'confirmCheck'] as const;

export interface TeachingTurnInput {
  messages: Array<{ role: MessageRole; content: string }>;
  learner: TeachingLearnerProjection;
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
    /** 该路径关联的资料（投影后的最小集合）：讲解/示例要能引用其章节或条目原文 */
    materials?: Array<{
      title?: string | null;
      sourceUrl?: string | null;
      sections?: Array<{ id?: string | null; title?: string | null }>;
      keyPoints?: Array<{ text?: string | null; cite?: string | null }>;
    }> | null;
    /**
     * 教师补充材料（活的 path 批次 E）：上一轮 control.supplement 请求采集入库的公开网络资料。
     * 引用时要向学生说明这是补充来源（非主线资料），并自然带出主题。
     */
    supplementaryMaterial?: {
      materialId: string;
      title: string;
      topic: string;
      sourceUrl?: string | null;
      excerpt: string;
    } | null;
    /**
     * 当前任务 materialRefs 的**章节原文窗口**（material-sections 取回，≤2×4K 字，2026-09-24）。
     * 讲到哪章就能看到那章原文；无引用/取回失败时为 null。
     */
    activeTaskMaterialExcerpts?: Array<{
      materialId?: string | null;
      materialName?: string | null;
      sectionTitle?: string | null;
      quote?: string | null;
      anchor?: 'quote' | 'title' | 'none';
      excerpt?: string | null;
    }> | null;
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
    learningSignal?: string | null;
    lastLessonRecap?: {
      sourceTopic?: string | null;
      topicSummary?: string | null;
      retrievalCue?: string | null;
      unresolvedPoints?: string[];
      relation?: string;
      sourceStageNumber?: number | null;
      sourceMilestoneTitle?: string | null;
      sourceTaskTitle?: string | null;
      sameTaskHistory?: {
        attemptCount?: number;
        lastStatus?: string;
        lastEndTime?: string | null;
        lastSummary?: string | null;
        lastUnresolvedPoints?: string[];
        lastActionPlan?: string[];
      } | null;
    } | null;
    /** 结构化前序学习上下文（跨节承接富化版） */
    priorLearningContext?: {
      hasPriorLearning?: boolean;
      adjacent?: {
        relation?: string;
        stageNumber?: number;
        milestoneTitle?: string;
        taskTitle?: string;
        topicSummary?: string | null;
        retrievalCue?: string | null;
        unresolvedPoints?: string[];
        actionPlan?: string[];
        newlyMastered?: string[];
        stillLearning?: string[];
      } | null;
      sameTask?: {
        attemptCount?: number;
        lastStatus?: string;
        lastSummary?: string | null;
        lastUnresolved?: string[];
        lastActionPlan?: string[];
        lastEndTime?: string | null;
      } | null;
      priorMilestoneMastery?: Array<{
        stageNumber?: number;
        title?: string;
        masteryState?: string;
        completedTasks?: number;
        totalTasks?: number;
      }>;
    } | null;
    /**
     * 诊断洞察（learner-state-review 出的"为什么卡"，已剔除被证伪的 claim）。
     * 只读参考：与课堂实况冲突时以实况为准；不得在 reply 里向学生复述内部诊断。
     */
    learnerInsights?: Array<{ type?: string; claim?: string; action?: string }> | null;
    /** 本节课理解检查点历史摘要（2026-09-17 起被消费）：未通过/跳过的点用于换表征再确认 */
    checkpointHistory?: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      recent: Array<{ title: string; passed: boolean; skipped?: boolean; understanding?: number }>;
    } | null;
    /**
     * 课内温故计划（记忆层）：本节开头要回捞的到期旧知（≤3，已按认知负担预算裁剪）。
     * 与 knowledge.points（本节知识点）物理分离——不要把 items 混进本节看板。
     */
    memoryWarmup?: {
      items?: Array<{
        conceptKey?: string;
        label?: string;
        retention?: number;
        reason?: string;
        load?: number;
        loadFactors?: string[];
        originPathTitle?: string | null;
      }>;
      budget?: number;
      usedLoad?: number;
      backlogCount?: number;
      successRate?: number | null;
      relearnSuggestions?: Array<{ conceptKey?: string; label?: string; consecutiveAgain?: number; reason?: string }>;
    } | null;
    /** 前端交互特征情报（认知负荷量测）：本轮统计 + 近轮对比，仅供判断 loadIndex */
    interactionProfile?: {
      current?: Record<string, number> | null;
      history?: Array<{
        role: string;
        timestamp: string;
        meta?: Record<string, number> | null;
        textLength: number;
      }>;
      absent?: boolean;
    } | null;
    /** 学习表现预测（任务前 learning-predictor 产出）：参考信号，非命令；低样本时不得据此改变默认策略 */
    learnerPrediction?: {
      stallRisk: number;
      predictedTone: 'smooth' | 'struggle' | 'fatigue';
      suggestedDepth: 'shallow' | 'standard' | 'deep';
      focusConcepts: string[];
      rationale: string;
      reliability?: { total: number; stallHitRate: number | null } | null;
    } | null;
    /** 任务模式：normal | productiveFailure（有效失败：先让学生挣扎，后整合） */
    taskMode?: 'normal' | 'productiveFailure';
    /** 历史误解台账（G-R-R Phase 2）：供教学回合引用已记录的结构化误解 */
    priorMisconceptions?: Array<{
      conceptKey: string;
      hypothesis: string;
      canonicalLabel: string | null;
      confidence: number;
      status: string;
      occurrenceCount: number;
    }> | null;
    /** 行为投影器（LLM-KT Behavioral Dynamics Projector）：近期回合级行为动态压缩 */
    behavioralProfile?: {
      avgUnderstanding: number | null;
      avgLoadIndex: number | null;
      avgEngagement: number | null;
      dominantEmotion: string | null;
      frustrationRate: number | null;
      knowledgeMasteryEma: number | null;
      sampleSize: number;
      /** 求助行为（2026-09-17 起被消费）：最近几轮的求助原话 + 次数，供软拦截（别直接给答案） */
      recentHelpSeeking?: string[];
      helpSeekingCount?: number;
    } | null;
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
    /**
     * 出题触发（2026-09-17）：**由代码给出**——true 时本轮必须产出 `control.checkpoint`（含答案键），
     * false/缺失时不得产出。理由：此前完全由模型自决，实测最近 60 个会话零检查点 ⇒ 独立传感器没有样本。
     */
    emitCheckpoint?: boolean;
  };
  classroomContext?: Record<string, any>;
  classroomEventContext?: Record<string, any>;
  /** 双引擎试点（内部透传）：第一段 analysis-only 的产出，注入第二段作为约束 */
  _analysisStage?: Record<string, any> | null;
  /**
   * 教学配图时机信号（**代码裁决**后显式送进来的，见 `teaching-visual.service.ts#buildVisualOpportunity`）。
   *
   * 为什么要有这个字段：实测埋在 2 万字 system prompt 里的"配图规则"会被模型忽略（三档加码都无效），
   * 而**把要求显式放进该轮输入**一次就生效。所以"何时该配图"由代码判定后走这里送进来，
   * 模型只负责"画什么"（输出 `visual`）。
   */
  visualOpportunity?: {
    suggested: boolean;
    reason: string;
    /** 给模型的显式、正向要求（原样进入载荷） */
    instruction: string;
  } | null;
}

export interface TeachingTurnOutput {
  reply: string;
  analysis: {
    cognitiveLevel: string;
    levelScore: number;
    understanding: number;
    confusionPoints: string[];
    /** 结构化误解台账（G-R-R Phase 1）：每项含 hypothesis/evidence/confidence */
    misconceptions?: Array<{
      conceptKey: string;
      hypothesis: string;
      canonicalLabel?: string | null;
      confidence: number;
      evidence: string;
      status: string;
    }>;
    /** 回合级知识状态估计（θ−d 路由信号）：conceptMastery + 任务难度 + 建议 */
    ktEstimate?: {
      conceptMastery?: Array<{ conceptKey: string; mastery: number; evidence?: string }>;
      currentTaskDifficulty?: number;
      recommendation?: string;
    };
    /** PF 模式解法尝试台账（每轮新尝试，供整合期对比） */
    rsmAttempts?: Array<{
      method: string;
      outcome: string;
      evidence: string;
    }>;
    /** 隐藏自评信号（静默提取，供校准闭环；不改变教学行为） */
    selfAssessmentSignal?: 'high' | 'medium' | 'low';
    /** 求助行为分流（自由描述，供后台统计与软拦截） */
    helpSeekingType?: string;
    engagement: number;
    emotionalState: string;
    loadIndex: number;
    loadBasis: string;
  };
  knowledge: {
    currentPoint: string | null;
    points: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>;
    /** 可选：需要学生对当前点表态时的确认动作组（前端渲染为行动按钮；不输出则前端回退固定按钮） */
    confirmCheck?: {
      prompt: string;
      actions: Array<{ label: string; message: string }>;
    };
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
    /** 可选理解检查点：模型在适当时机输出，由 coordinator 落库为 pendingCheckpoint */
    checkpoint?: {
      question: string;
      type: 'short_answer' | 'single_choice' | 'multi_choice';
      options?: Array<{ id: string; text: string }>;
      hint?: string;
      /**
       * 答案键（2026-09-17，审计 §7 P1-1）：有了它，作答对错由**代码裁决**（独立于模型自评的传感器）。
       * - 选择题：`correctOptionIds`（必须是 options 里真实存在的 id；单选只留一个）
       * - 简答：`expectedKeywords`（1-4 条、每条 ≤40 字，须能在学生作答里直接检出的要点）
       * **绝不把答案键呈现给学生**（reply / options.text / hint 里都不得出现答案或"正确选项是…"）。
       */
      correctOptionIds?: string[];
      expectedKeywords?: string[];
    };
    /**
     * 课内温故的**结构化结果**（2026-09-17 起为结果判定的唯一通道）。
     *
     * 为什么加这个字段：此前结果只能靠"模型把温故点按原名回写进 knowledge.points"，代码再按名字匹配
     * （`extractWarmupOutcomes`）。实测两次全流程验证一次摘到、一次没摘到（本轮从零回归里
     * 温故点在消息中出现 5 次、却没进 knowledge.points）——**靠提示词依从性当传感器，约 50% 丢样本**。
     * 现在结果由本字段直接承载，代码不做名字匹配即可入库（knowledge.points 仍照写，供看板显示）。
     *
     * 召回等级按"给了多少帮助才想起来"（desirable difficulty 的观测量）：
     * - `unaided`：无提示自己说出来
     * - `with-hint`：给了一条最小提示后说出来
     * - `failed`：给了最小提示仍说不出来
     */
    warmupOutcomes?: Array<{
      /** 计划项的名字（与 scenario.memoryWarmup.items[].label 一致），与 itemIndex 至少给一个 */
      conceptKey?: string;
      /** 计划项下标（0 基）；与 conceptKey 同时给时以 itemIndex 为准 */
      itemIndex?: number;
      recall: 'unaided' | 'with-hint' | 'failed';
      /** 可选：学生原话片段（供事后核对，不进看板） */
      evidence?: string;
    }>;
    /**
     * 教师补充请求（活的 path 批次 E，可选）：主线资料没覆盖、学生明确需要外部信息时，
     * 请求编排层采集一份公开网络资料，**下一轮**注入课堂（带出处，标注"非主线补充"）。
     * 每个 session 至多请求一次；能靠主线讲清时**不要**用。
     */
    supplement?: {
      /** 缺什么（一句话主题，如"2024 年最新转速标准"） */
      topic: string;
      /** 可选：检索词（缺省用 topic） */
      query?: string | null;
    };
  };
  /**
   * 教学配图请求（可选）——owner 口径 2026-09-23：**「图片是一种特殊的文字，放在教学中」**。
   *
   * 语义：老师**临场**觉得"这里给学生看一张图会更好"时，输出本块；由**代码**决定要不要真的画
   * （开关 + 每会话上限 + fail-open，见 `services/ai-teaching/teaching-visual.service.ts`）。
   *
   * 硬边界（与既有"课堂仅文本"规则一致，只是允许附图）：
   * - `prompt` 是**画面描述**，取自当前教学内容的文字——图 = 这段文字的渲染，文本仍是唯一真相源；
   * - **文本必须脱离图也成立**：`reply` 不能依赖这张图（不写"看图就明白""照着图上做"），
   *   学生不看图也能继续；图只是辅助；
   * - 不是每轮都配：**同一个任务最多配一次**，且只在本轮内容确实"天然偏视觉"（几何/结构/流程/对比）时才用；
   * - 纯文字能说清、或图会分散注意时，**不要**输出本块。
   */
  visual?: {
    /** 画面描述（必填）：要画什么，用中文写清主体与关系 */
    prompt: string;
    /** 图的说明文字（学生可见；可空，一句话） */
    caption?: string | null;
    /** 图类型（如 示意图 / 对比图 / 流程图）；仅作润色与留痕 */
    kind?: string | null;
  } | null;
  /**
   * 课堂结构图（可选）——2026-09-27 双通道重构（owner 终审：扩散生图停用，结构类走代码渲染）。
   *
   * 语义：老师要用**结构图**把当前内容的"空间/时序/层级/对比"关系画清楚时，输出本块。
   * 由前端 mermaid 确定性渲染（毫秒级、零乱码、**图内可直接写中文标签**）——这与旧生图
   * （`visual`，禁图内字、抽象画）的本质区别：结构图的文字标注就是教学信息本身。
   *
   * 硬边界：
   * - 只画**结构类**（过程/循环、空间位置、结构装配、多对象对比、时序、层级）；
   *   定义/定理/论证/术语辨析/纯计算/背诵清单类**不要画**（用符号语言就能精确定住）；
   * - **不要用字符画**（箭头/方框/`┌─┐`）——直接输出本块；
   * - 与本轮内容一致：reply 必须脱离图也成立，图是同一信息的更直观呈现，不是新信息；
   * - 若本轮正要布置"由学生自己排出/画出该结构"的练习，本轮**不要**输出（答案泄漏，
   *   留到学生完成后的下一轮印证）；
   * - 语法必须在 mermaid 支持范围内（flowchart/sequenceDiagram/stateDiagram 等常用图型），
   *   **禁止** `%%{init}%%` 配置块、`click`、`href`（出口会被代码过滤）。
   */
  diagram?: {
    /** 渲染引擎；归一化后恒为 'mermaid'（其他值整块丢弃，见 normalizeDiagram） */
    engine: string;
    /** mermaid 源码（必填）；图内中文标签是允许且鼓励的 */
    code: string;
    /** 图下方一句说明（学生可见）；归一化后恒为 string|null */
    caption: string | null;
  } | null;
  /**
   * 位置线图（2026-09-27 双通道重构 Scope B）：**空间位置关系**的确定性渲染。
   *
   * 真实语料实证（小学追及题：把「小明在前、小红在后，两人都往右」摆成一条线）——
   * 这类内容 mermaid 的节点-边表达不了，需要自由定位原语（线段/箭头/刻度/标注）。
   * 与 diagram 分工：节点-边类（流程/时序/层级/分类）走 mermaid；**位置/距离/方向**类走本块。
   *
   * 规则：
   * - 只画"对话正在用文字描述的空间关系"（谁在哪、朝哪、隔多远），**不要**画抽象结构；
   * - `at` 用与题意一致的数值（米/格/序号都行，只要同一图内同单位）；不必等比真实比例，但顺序必须对；
   * - 标签写**学科实指**（甲/乙/小明/起点/追及点），不要写"物体 1"这类占位；
   * - 若本轮正要布置"由学生自己画位置线"的练习，本轮**不要**输出（答案泄漏）；
   * - reply 必须脱离图也成立（图是同一关系的更直观呈现）。
   */
  figure?: {
    /** 渲染引擎；归一化后恒为 'svg'（其他值整块丢弃，见 normalizeFigure） */
    engine: string;
    /** 图型；归一化后恒为 'position-line'（v1 唯一图型） */
    kind: string;
    /** 轴（数值域 + 单位 + 刻度）；归一化保证存在且覆盖所有取值 */
    axis: {
      min: number;
      max: number;
      /** 单位（如「米」「格」「秒」）；无单位则 null */
      unit: string | null;
      ticks: Array<{ at: number; label: string | null }>;
    };
    /** 线上的对象（人物/物/点）；1~6 个，按 at 升序 */
    marks: Array<{
      at: number;
      label: string;
      /** 朝向箭头：right/left/none（静态点） */
      dir: 'right' | 'left' | 'none';
    }>;
    /** 区间标注（距离/差）；0~3 条，画在轴下方 */
    spans: Array<{ from: number; to: number; label: string }>;
    /** 竖直参考线（追及点/相遇点/分界）；0~4 条 */
    guides: Array<{ at: number; label: string | null }>;
    /** 图下方一句说明（学生可见）；归一化后恒为 string|null */
    caption: string | null;
  } | null;
}

/**
 * 已通过 raw validator 与 normalizer 的单轮教学领域产物。
 * 保留独立别名，避免将 legacy agent-output-v1 的 internal 包装误作领域模型。
 */
export type TeachingTurnArtifact = TeachingTurnOutput;

/**
 * Phase 2 internal canonical sidecar.
 * Coordinator 仍负责知识状态合并和持久化，所以不在此阶段声明 transition。
 */
export function toTeachingTurnSkillOutcome(
  artifact: TeachingTurnArtifact,
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope> | null,
): SkillOutcome<TeachingTurnArtifact> {
  return buildSkillOutcome({
    skillId: AGENT_ID,
    artifact,
    quality: 'model',
    runtimeEnvelope: runtimeEnvelope || null,
    transition: null,
  });
}

export const teachingTurnAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '教学回合 Skill',
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
      control: { type: 'object' },
      // 可选：老师临场请求的一张教学配图（图 = 一段文字的渲染；见 TeachingTurnOutput.visual）。
      // 2026-09-27 起扩散生图默认停用（owner 终审，设计文档 §九），该块保留但不再生成图片。
      visual: { type: 'object' },
      // 可选：课堂结构图（mermaid 代码，前端确定性渲染；见 TeachingTurnOutput.diagram）
      diagram: { type: 'object' },
      // 可选：位置线图（空间位置关系，确定性 SVG 渲染；见 TeachingTurnOutput.figure）
      figure: { type: 'object' }
    },
    required: ['reply', 'analysis', 'knowledge', 'pedagogy', 'control']
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};





function normalizeConceptName(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildStrategyGuidancePrompt(input: TeachingTurnInput): string | null {
  return buildGuidancePrompt(input.scenario.teachingStrategyGuidance);
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

function normalizeAllowedStrategy(value: string | undefined) {
  return normalizeStrategy(value);
}

function deriveFallbackStrategies(input: TeachingTurnInput): string[] {
  return getFallbackStrategies(input.scenario.taskProfile?.knowledgeType);
}

function filterOverlyBroadKnowledgePoints(points: Array<{ name: string; status: 'pending' | 'learning' | 'mastered' | 'review'; progress: number }>, input: TeachingTurnInput) {
  const coreConcept = normalizeConceptName(input.scenario.taskProfile?.coreConcept || input.scenario.taskProfile?.linkedConceptName || '');
  const hasFinerPrimaryConcept = points.some((point) => normalizeConceptName(point.name) && normalizeConceptName(point.name) !== coreConcept);

  if (!coreConcept || !hasFinerPrimaryConcept) {
    return points;
  }

  const filtered = points.filter((point) => normalizeConceptName(point.name) !== coreConcept);
  return filtered.length > 0 ? filtered : points;
}
/**
 * Q9 契约漂移容错：模型偶发把 knowledge 的子字段（currentPoint / points / confirmCheck）平铺到顶层，
 * 而不是包在 `knowledge` 对象里（field-hit-rate 审计实测漂移，多为输出格式抖动，非第二套契约）。
 * 这里把它们回填进 `knowledge`：正常嵌套形态优先，平铺键仅在嵌套缺失该键时兜底——
 * 避免因整块知识看板被静默丢弃而丢失课堂状态。不改变正常输出语义。
 */
function resolveKnowledgeBlock(parsed: Record<string, any>): Record<string, any> {
  const nested = parsed.knowledge && typeof parsed.knowledge === 'object' && !Array.isArray(parsed.knowledge)
    ? parsed.knowledge
    : {};
  const block: Record<string, any> = { ...nested };
  for (const key of KNOWLEDGE_SUBFIELD_KEYS) {
    if (block[key] === undefined && parsed[key] !== undefined) block[key] = parsed[key];
  }
  return block;
}

function normalizeOutput(parsed: Record<string, any>, input: TeachingTurnInput): TeachingTurnOutput {
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : '我们继续沿着这个主题往下学。';

  const analysis = parsed.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : {};
  const knowledge = resolveKnowledgeBlock(parsed);
  const pedagogy = parsed.pedagogy && typeof parsed.pedagogy === 'object' ? parsed.pedagogy : {};
  const control = parsed.control && typeof parsed.control === 'object' ? parsed.control : {};
  const points = Array.isArray(knowledge.points) ? knowledge.points : [];
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

  const normalizedKnowledgePoints = filterOverlyBroadKnowledgePoints(
    points.map((point: any) => ({
      name: typeof point?.name === 'string' ? point.name : '',
      status: (ALLOWED_KNOWLEDGE_STATUSES as readonly string[]).includes(point?.status)
        ? point.status
        : 'pending',
      progress: Number.isFinite(point?.progress)
        ? Math.max(0, Math.min(100, Math.round(Number(point.progress))))
        : 0,
    }))
      .filter((point: any) => point.name),
    input,
  );

  const normalizedCurrentPoint = typeof knowledge.currentPoint === 'string' && knowledge.currentPoint.trim()
    ? knowledge.currentPoint.trim()
    : null;
  const currentPointRemovedByFilter = normalizedCurrentPoint
    && normalizeConceptName(input.scenario.taskProfile?.coreConcept || input.scenario.taskProfile?.linkedConceptName || '')
    && !normalizedKnowledgePoints.some((point) => point.name === normalizedCurrentPoint);
  // 完成判定（2026-08-30 改为 LLM 语义判定）：
  // 此前用 acceptanceCriteria 关键词硬匹配（evaluateByCriteria/evaluateByProfile）拦截完成信号，
  // 对口语化/创作类任务（如视频剪辑 demo 的 diagnose/refine 任务）产生系统性假阴性，
  // 学生语义上已达标但措辞不匹配即被拦截，导致回合膨胀。
  // 现在：isCompletionCandidate 由 LLM 基于对话语义自行判断（提示词 rule 18/19/21），
  // 评估器输出仅作为观测信号透传（completionCandidateEvidence），不再参与完成门禁。
  const requestedCompletionCandidate = !!control.isCompletionCandidate;
  const resolvedCompletionCandidate = requestedCompletionCandidate;

  // 观测信号：规则判定（关键词匹配）结果，仅用于与 LLM 判定对比，不参与完成门禁
  const completionEvidenceSatisfied = acceptanceEvidence.hasCriteria
    ? acceptanceEvidence.matched
    : taskCompletionEvidence.matched;

  // 观测：LLM 语义判定与规则判定（关键词匹配）的分歧，用于评估"LLM 判定方案"的收敛质量
  if (requestedCompletionCandidate && !completionEvidenceSatisfied) {
    logger.warn('[TeachingTurnAgent] completionCandidate 与规则证据判定分歧（观测信号，不再拦截）', {
      taskTitle: input.scenario.taskTitle,
      taskType: input.scenario.taskType,
      acceptanceCriteria: acceptanceEvidence.acceptanceCriteria,
      acceptanceMatched: acceptanceEvidence.matched,
      acceptanceDecision: acceptanceEvidence.decision,
      taskCompletionMatched: taskCompletionEvidence.matched,
      taskCompletionReason: taskCompletionEvidence.reason,
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
      confusionPoints: resolveConfusionPoints(analysis.confusionPoints, analysis.misconceptions),
      ...(normalizeMisconceptions(
        analysis.misconceptions,
        [...(input.messages || [])].reverse().find((message) => message?.role === 'user')?.content || '',
      )),
      ...(normalizeKtEstimate(analysis.ktEstimate)),
      ...(normalizeRsmAttempts(analysis.rsmAttempts)),
      ...(normalizeSelfAssessmentSignal(analysis.selfAssessmentSignal)),
      ...(normalizeHelpSeekingType(analysis.helpSeekingType)),
      engagement: Number.isFinite(analysis.engagement) ? Number(analysis.engagement) : 0.5,
      emotionalState: (typeof analysis.emotionalState === 'string' && (ALLOWED_EMOTIONAL_STATES as readonly string[]).includes(analysis.emotionalState))
        ? analysis.emotionalState
        : 'neutral',
      loadIndex: Number.isFinite(analysis.loadIndex)
        ? Math.max(0, Math.min(1, Number(analysis.loadIndex)))
        : 0.5,
      loadBasis: (typeof analysis.loadBasis === 'string' && (ALLOWED_LOAD_BASIS as readonly string[]).includes(analysis.loadBasis))
        ? analysis.loadBasis
        : 'absent',
    },
    knowledge: {
      currentPoint: currentPointRemovedByFilter
        ? normalizedKnowledgePoints[0]?.name || null
        : normalizedCurrentPoint,
      points: normalizedKnowledgePoints.slice(0, 5),
      ...(normalizeConfirmCheck(knowledge.confirmCheck)),
    },
    pedagogy: {
      strategies: normalizedStrategies.length > 0 ? normalizedStrategies : fallbackStrategies,
    },
    control: {
      isCompletionCandidate: resolvedCompletionCandidate,
      shouldTriggerPeer: !!control.shouldTriggerPeer,
      completionCandidateEvidence: acceptanceEvidence.hasCriteria
        ? acceptanceEvidence
        : {
            hasCriteria: false,
            acceptanceCriteria: null,
            anchorTokens: [],
            matchedTokens: [],
            matchedRatio: taskCompletionEvidence.matched ? 1 : 0,
            learnerEvidenceExcerpt: taskCompletionEvidence.learnerEvidenceExcerpt,
            decision: taskCompletionEvidence.matched ? 'accepted' : 'rejected',
            reason: taskCompletionEvidence.reason,
          },
      ...(typeof control.checkpoint?.question === 'string' && control.checkpoint.question.trim()
        ? { checkpoint: normalizeCheckpoint(control.checkpoint) }
        : {}),
      ...(normalizeWarmupOutcomes(control.warmupOutcomes) ?? {}),
      ...(normalizeSupplement(control.supplement) ?? {}),
    },
    ...(normalizeVisual(parsed.visual) ?? {}),
    ...(normalizeDiagram(parsed.diagram) ?? {}),
    ...(normalizeFigure(parsed.figure) ?? {}),
  };
}

const FIGURE_MARKS_MAX = 6;
const FIGURE_SPANS_MAX = 3;
const FIGURE_GUIDES_MAX = 4;
const FIGURE_TICKS_MAX = 8;
/** 图内文本上限：标签是教学信息，超长说明模型没在"画图"而是在"写段落"——宁缺毋滥 */
const FIGURE_LABEL_MAX = 16;
const FIGURE_SPAN_LABEL_MAX = 24;
const FIGURE_CAPTION_MAX = 200;
const FIGURE_UNIT_MAX = 8;

/** 数值字段归一：只认有限数（含数字字符串）；其余 → null */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 图内文本归一：去控制字符、裁长、空串归 null（用于可选文本：caption/unit） */
function toFigureText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return text || null;
}

/**
 * 图内文本归一（严格版）：超长 → null，**不截断**。
 * 标签是教学信息本身，截成半句话比没有更糟；可选文本（tick/guide 的 label）超长则丢标签保位置。
 */
function toFigureLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text || text.length > max) return null;
  return text;
}

/**
 * 归一化老师给的位置线图（契约见 `TeachingTurnOutput.figure`，2026-09-27 Scope B）。
 *
 * 规则（宁缺毋滥 + 确定性可渲染）：
 * - 只认 `kind: position-line`（缺省视为 position-line；其他图型整块丢弃）；
 * - **必须至少有一个有效 mark**（没有对象就没有位置关系，整块丢弃）；
 * - 数值域由代码统一推导：取 axis/ticks/marks/spans/guides 的全部取值求并集，两端各留 4% 余量——
 *   模型给的 min/max 只作为单位与刻度的来源，**不得把取值挡在域外**（挡了就是画错图）；
 * - marks 按 at 升序、去重（同位置只留第一个）；spans 要求 from≠to；越界/非法项丢弃；
 * - 各数组超上限截断；标签超长丢弃该条（不截断成半句话）。
 */
function normalizeFigure(raw: unknown): { figure: NonNullable<TeachingTurnOutput['figure']> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
  if (kind && kind !== 'position-line') return null;

  const rawMarks = Array.isArray(record.marks) ? record.marks : [];
  const marks: Array<{ at: number; label: string; dir: 'right' | 'left' | 'none' }> = [];
  for (const item of rawMarks) {
    if (!item || typeof item !== 'object') continue;
    const mark = item as Record<string, unknown>;
    const at = toFiniteNumber(mark.at);
    const label = toFigureLabel(mark.label, FIGURE_LABEL_MAX);
    if (at === null || !label) continue;
    const dirRaw = typeof mark.dir === 'string' ? mark.dir.trim().toLowerCase() : '';
    const dir = dirRaw === 'right' || dirRaw === 'left' ? dirRaw : 'none';
    marks.push({ at, label, dir });
    if (marks.length >= FIGURE_MARKS_MAX) break;
  }
  if (!marks.length) return null;

  const axisRecord = record.axis && typeof record.axis === 'object' ? (record.axis as Record<string, unknown>) : null;
  const unit = toFigureText(axisRecord?.unit, FIGURE_UNIT_MAX);
  const ticks: Array<{ at: number; label: string | null }> = [];
  for (const item of Array.isArray(axisRecord?.ticks) ? (axisRecord?.ticks as unknown[]) : []) {
    if (!item || typeof item !== 'object') continue;
    const tick = item as Record<string, unknown>;
    const at = toFiniteNumber(tick.at);
    if (at === null) continue;
    ticks.push({ at, label: toFigureLabel(tick.label, FIGURE_LABEL_MAX) });
    if (ticks.length >= FIGURE_TICKS_MAX) break;
  }

  const spans: Array<{ from: number; to: number; label: string }> = [];
  for (const item of Array.isArray(record.spans) ? (record.spans as unknown[]) : []) {
    if (!item || typeof item !== 'object') continue;
    const span = item as Record<string, unknown>;
    const from = toFiniteNumber(span.from);
    const to = toFiniteNumber(span.to);
    const label = toFigureLabel(span.label, FIGURE_SPAN_LABEL_MAX);
    if (from === null || to === null || from === to || !label) continue;
    spans.push({ from: Math.min(from, to), to: Math.max(from, to), label });
    if (spans.length >= FIGURE_SPANS_MAX) break;
  }

  const guides: Array<{ at: number; label: string | null }> = [];
  for (const item of Array.isArray(record.guides) ? (record.guides as unknown[]) : []) {
    if (!item || typeof item !== 'object') continue;
    const guide = item as Record<string, unknown>;
    const at = toFiniteNumber(guide.at);
    if (at === null) continue;
    guides.push({ at, label: toFigureLabel(guide.label, FIGURE_LABEL_MAX) });
    if (guides.length >= FIGURE_GUIDES_MAX) break;
  }

  // 数值域 = 所有取值的并集（模型的 min/max 不得把取值挡在域外）
  const allValues = [
    ...marks.map((m) => m.at),
    ...ticks.map((t) => t.at),
    ...spans.flatMap((s) => [s.from, s.to]),
    ...guides.map((g) => g.at),
    toFiniteNumber(axisRecord?.min),
    toFiniteNumber(axisRecord?.max),
  ].filter((v): v is number => v !== null);
  if (!allValues.length) return null;
  const lo = Math.min(...allValues);
  const hi = Math.max(...allValues);
  // 单点/零宽域：给一个人造跨度，否则除零（刻度仍是诚实的最小刻度）
  const pad = hi > lo ? (hi - lo) * 0.04 : Math.max(Math.abs(hi) * 0.1, 1);
  const axis = { min: lo - pad, max: hi + pad, unit, ticks };

  const dedupedMarks = marks
    .sort((a, b) => a.at - b.at)
    .filter((mark, index, list) => index === 0 || mark.at !== list[index - 1].at);
  const caption = toFigureText(record.caption, FIGURE_CAPTION_MAX);

  return {
    figure: {
      engine: 'svg',
      kind: 'position-line',
      axis,
      marks: dedupedMarks,
      spans,
      guides,
      caption,
    },
  };
}

/**
 * 归一化老师请求的课堂结构图（契约见 `TeachingTurnOutput.diagram`，2026-09-27 双通道重构）。
 *
 * 规则（宁缺毋滥）：
 * - 只认 mermaid（缺省 engine 视为 mermaid；其他引擎值 → 整块丢弃）；
 * - `code` 非空才保留；剥掉模型习惯包的 ```mermaid 围栏；裁行过滤后超过长度上限 → 丢弃
 *   （截断必然产生坏语法，丢弃比截断诚实）；
 * - **出口过滤危险/干扰指令**：`%%{` 配置块、`click`、`href` 整行剔除——
 *   前端 securityLevel:'strict' 是二道防线，这里是首道（纵深防御）；
 * - `caption` 裁长；空串归 null。
 */
function normalizeDiagram(raw: unknown): { diagram: NonNullable<TeachingTurnOutput['diagram']> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const engine = typeof record.engine === 'string' ? record.engine.trim().toLowerCase() : '';
  if (engine && engine !== 'mermaid') return null;
  let code = typeof record.code === 'string' ? record.code.trim() : '';
  if (!code) return null;
  code = code.replace(/^```(?:mermaid)?[ \t]*\r?\n/i, '').replace(/\r?\n?```[ \t]*$/, '');
  const filtered = code
    .split('\n')
    .filter((line) => !/^\s*%%\{/.test(line) && !/^\s*click\b/i.test(line) && !/^\s*href\b/i.test(line))
    .join('\n')
    .trim();
  if (!filtered || filtered.length > 1500) return null;
  const caption = typeof record.caption === 'string' ? record.caption.trim().slice(0, 200) : '';
  return { diagram: { engine: 'mermaid', code: filtered, caption: caption || null } };
}

/**
 * 归一化教师补充请求（活的 path 批次 E）。
 * 宁缺毋滥：topic 非空才保留；query 裁长；编排层做真正裁决（每 session 至多一次、
 * 主线未覆盖才准用），模型只负责把"缺什么"说清楚。
 */
function normalizeSupplement(value: unknown): { supplement: { topic: string; query: string | null } } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const topic = typeof record.topic === 'string' ? record.topic.trim().slice(0, 80) : '';
  if (!topic) return null;
  const query = typeof record.query === 'string' && record.query.trim()
    ? record.query.trim().slice(0, 120)
    : null;
  return { supplement: { topic, query } };
}

/**
 * 归一化老师请求的教学配图（契约见 `TeachingTurnOutput.visual`）。
 *
 * 规则（与其它可选输出同风格：宁缺毋滥）：
 * - `prompt` 非空才保留（空/非字符串 → 整块丢弃，不编造）；
 * - `caption` / `kind` 裁长；空串归一成 null；
 * - 单张（本字段天然只有一张），真正的"要不要画"由代码闸门裁决（服务侧）。
 */
function normalizeVisual(raw: unknown): { visual: NonNullable<TeachingTurnOutput['visual']> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim().slice(0, 800) : '';
  if (!prompt) return null;
  const caption = typeof record.caption === 'string' ? record.caption.trim().slice(0, 200) : '';
  const kind = typeof record.kind === 'string' ? record.kind.trim().slice(0, 40) : '';
  return { visual: { prompt, caption: caption || null, kind: kind || null } };
}

/**
 * 归一化课内温故的结构化结果（契约见 TeachingTurnOutput.control.warmupOutcomes）。
 * 规则（与其它可选输出的归一化同风格：宁缺毋滥，不编造）：
 * - 每条必须能定位到计划项（`itemIndex` 非负整数，或非空 `conceptKey`），否则丢弃；
 * - `recall` 只认三值（大小写/空格容错）；缺失或非法 → 丢弃该条（**不默认猜成一个等级**）；
 * - 去重（同一下标/键只留第一条）；最多 5 条（温故上限 3 个点，留冗余）。
 */
function normalizeWarmupOutcomes(
  value: unknown,
): { warmupOutcomes: NonNullable<TeachingTurnOutput['control']['warmupOutcomes']> } | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(['unaided', 'with-hint', 'failed']);
  const seen = new Set<string>();
  const items: NonNullable<TeachingTurnOutput['control']['warmupOutcomes']> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, any>;
    const index = Number.isInteger(entry.itemIndex) && entry.itemIndex >= 0 ? Number(entry.itemIndex) : undefined;
    const conceptKey = typeof entry.conceptKey === 'string' ? entry.conceptKey.trim().slice(0, 200) : '';
    if (index === undefined && !conceptKey) continue;
    const recall = typeof entry.recall === 'string' ? entry.recall.trim().toLowerCase() : '';
    if (!allowed.has(recall)) continue;
    const dedupeKey = index !== undefined ? `i:${index}` : `k:${conceptKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push({
      ...(index !== undefined ? { itemIndex: index } : {}),
      ...(conceptKey ? { conceptKey } : {}),
      recall: recall as 'unaided' | 'with-hint' | 'failed',
      ...(typeof entry.evidence === 'string' && entry.evidence.trim()
        ? { evidence: entry.evidence.trim().slice(0, 200) }
        : {}),
    });
    if (items.length >= 5) break;
  }
  return items.length > 0 ? { warmupOutcomes: items } : null;
}

/** 归一化可选检查点输出：question 必填、type/options 兜底校验 */
function normalizeCheckpoint(value: Record<string, any>): NonNullable<TeachingTurnOutput['control']['checkpoint']> {
  const options = Array.isArray(value.options)
    ? value.options
        .filter((option: any) => typeof option?.id === 'string' && typeof option?.text === 'string')
        .slice(0, 5)
        .map((option: any) => ({ id: option.id, text: option.text }))
    : [];
  const wantsChoice = value.type === 'single_choice' || value.type === 'multi_choice';
  const type = wantsChoice && options.length >= 2
    ? (value.type as 'single_choice' | 'multi_choice')
    : 'short_answer';
  // 答案键（2026-09-17，审计 §7 P1-1「独立传感器」）：只在校验得住时才留下——
  // 选择题的 id 必须真实存在于 options（否则是模型编的，宁可没有键，也不要做错误的代码裁决）；
  // 简答要点限 1-4 条、每条 ≤40 字。键**不下发给学生**（coordinator 侧负责剥离）。
  const optionIds = new Set(options.map((option) => option.id));
  const correctOptionIds = type !== 'short_answer' && Array.isArray(value.correctOptionIds)
    ? Array.from(new Set(value.correctOptionIds
        .filter((id: any) => typeof id === 'string' && optionIds.has(id))
        .map((id: string) => id.trim())
        .filter(Boolean)))
    : [];
  if (type === 'single_choice' && correctOptionIds.length > 1) correctOptionIds.length = 1;
  const expectedKeywords = type === 'short_answer' && Array.isArray(value.expectedKeywords)
    ? value.expectedKeywords
        .filter((keyword: any) => typeof keyword === 'string' && keyword.trim())
        .map((keyword: string) => keyword.trim().slice(0, 40))
        .slice(0, 4)
    : [];
  return {
    question: String(value.question).trim(),
    type,
    ...(type !== 'short_answer' ? { options } : {}),
    ...(correctOptionIds.length > 0 ? { correctOptionIds } : {}),
    ...(expectedKeywords.length > 0 ? { expectedKeywords } : {}),
    ...(typeof value.hint === 'string' && value.hint.trim() ? { hint: value.hint.trim() } : {}),
  };
}

/** 引文逐字核对用的空白归一（与 `material-refs.ts#isQuoteVerbatim` 同口径）。 */
function normalizeForQuote(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * evidence 必须是**学生本轮原话的逐字片段**（2026-09-23 采纳外部评审建议）。
 *
 * 为什么从"提示词建议"升级为"代码硬约束"：此前只在规则里要求"evidence 必须引用学生本轮原话
 * （不可定位则不输出该项）"，但归一化只做了 `trim().slice(0,300)`——**模型修饰过的"引文"照样落库**，
 * 误解台账的证据链就虚了。这里照本仓既有做法（`material-refs.ts#isQuoteVerbatim`）逐字核对，
 * **核对不过就丢弃该条**（宁缺勿编：没有可定位的证据，就不该断言学生有这个误解）。
 */
export function isVerbatimEvidence(evidence: unknown, learnerMessage: unknown): boolean {
  const quote = normalizeForQuote(evidence);
  if (quote.length < 2) return false;
  const haystack = normalizeForQuote(learnerMessage);
  if (!haystack) return false;
  return haystack.includes(quote);
}

/** 归一化结构化误解台账（G-R-R Phase 1）：过滤缺证据项 + **evidence 逐字核对**，置信度收敛到 0|25|50|75|100 五档 */
function normalizeMisconceptions(value: any, learnerMessage = ''): { misconceptions?: NonNullable<TeachingTurnOutput['analysis']['misconceptions']> } {
  if (!Array.isArray(value) || value.length === 0) return {};
  const mapped = value
    .filter((item: any) => item && typeof item?.hypothesis === 'string' && item.hypothesis.trim())
    .slice(0, 8)
    .map((item: any) => ({
      conceptKey: typeof item.conceptKey === 'string' ? item.conceptKey.trim().slice(0, 120) : '',
      hypothesis: String(item.hypothesis).trim().slice(0, 300),
      canonicalLabel: typeof item.canonicalLabel === 'string' && item.canonicalLabel.trim()
        ? item.canonicalLabel.trim().slice(0, 200)
        : null,
      confidence: [0, 25, 50, 75, 100].includes(Number(item.confidence)) ? Number(item.confidence) : 50,
      evidence: typeof item.evidence === 'string' ? item.evidence.trim().slice(0, 300) : '',
      status: item.status === 'confirmed' || item.status === 'addressed' ? String(item.status) : 'suspected',
    }));
  // 逐字核对：evidence 定位不到学生原话 → 丢弃该条（不是清空 evidence，而是整条不要）
  const items = mapped.filter((item: any) => isVerbatimEvidence(item.evidence, learnerMessage));
  if (items.length < mapped.length) {
    logger.warn('[TeachingTurnAgent] 误解台账 evidence 逐字核对未通过，已丢弃', {
      reported: mapped.length,
      kept: items.length,
      dropped: mapped.length - items.length,
    });
  }
  return items.length > 0 ? { misconceptions: items } : {};
}

/** confusionPoints 归一化：LLM 直接输出时优先采用（向后兼容）；未输出时由 normalize 后的 misconceptions 派生（消除双写） */
function resolveConfusionPoints(rawConfusionPoints: any, rawMisconceptions: any): string[] {
  const direct = Array.isArray(rawConfusionPoints)
    ? rawConfusionPoints.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 5)
    : [];
  if (direct.length > 0) return direct;
  const normalized = normalizeMisconceptions(rawMisconceptions);
  if (!normalized.misconceptions?.length) return [];
  const derived = normalized.misconceptions
    .map((m) => m.canonicalLabel || m.conceptKey)
    .filter(Boolean) as string[];
  return Array.from(new Set(derived)).slice(0, 5);
}

/** 归一化确认动作组（knowledge.confirmCheck）：恰好 2 个动作、字段限长；不合法返回空 */
function normalizeConfirmCheck(value: any): { confirmCheck?: NonNullable<TeachingTurnOutput['knowledge']['confirmCheck']> } {
  if (!value || typeof value !== 'object') return {};
  const rawActions = Array.isArray(value.actions) ? value.actions : [];
  const actions = rawActions
    .filter((a: any) => a && typeof a?.label === 'string' && a.label.trim() && typeof a?.message === 'string' && a.message.trim())
    .slice(0, 2)
    .map((a: any) => ({
      label: String(a.label).trim().slice(0, 12),
      message: String(a.message).trim().slice(0, 120),
    }));
  if (actions.length !== 2) return {};
  return {
    confirmCheck: {
      prompt: typeof value.prompt === 'string' ? value.prompt.trim().slice(0, 40) : '',
      actions,
    },
  };
}

/** 归一化回合级知识状态估计（θ−d 路由信号）：数值钳制、推荐值白名单 */
function normalizeKtEstimate(value: any): { ktEstimate?: NonNullable<TeachingTurnOutput['analysis']['ktEstimate']> } {
  if (!value || typeof value !== 'object') return {};
  const conceptMastery = Array.isArray(value.conceptMastery)
    ? value.conceptMastery
        .filter((item: any) => item && typeof item?.conceptKey === 'string' && item.conceptKey.trim())
        .slice(0, 5)
        .map((item: any) => ({
          conceptKey: String(item.conceptKey).trim().slice(0, 120),
          mastery: Number.isFinite(Number(item.mastery)) ? Math.max(0, Math.min(1, Number(item.mastery))) : 0.5,
          evidence: typeof item.evidence === 'string' ? item.evidence.trim().slice(0, 200) : undefined,
        }))
    : undefined;
  const result: NonNullable<TeachingTurnOutput['analysis']['ktEstimate']> = {};
  if (conceptMastery && conceptMastery.length > 0) result.conceptMastery = conceptMastery;
  if (Number.isFinite(Number(value.currentTaskDifficulty))) {
    result.currentTaskDifficulty = Math.max(0, Math.min(1, Number(value.currentTaskDifficulty)));
  }
  if (typeof value.recommendation === 'string' && ['consolidate', 'advance', 'challenge', 'scaffold'].includes(value.recommendation)) {
    result.recommendation = value.recommendation;
  }
  return Object.keys(result).length > 0 ? { ktEstimate: result } : {};
}

/** 归一化 PF 解法尝试台账：过滤缺方法描述的项，outcome 收敛到四值 */
function normalizeRsmAttempts(value: any): { rsmAttempts?: NonNullable<TeachingTurnOutput['analysis']['rsmAttempts']> } {
  if (!Array.isArray(value) || value.length === 0) return {};
  const items = value
    .filter((item: any) => item && typeof item?.method === 'string' && item.method.trim())
    .slice(0, 6)
    .map((item: any) => ({
      method: String(item.method).trim().slice(0, 200),
      outcome: ['stuck', 'partial', 'wrong', 'success'].includes(item?.outcome) ? String(item.outcome) : 'partial',
      evidence: typeof item?.evidence === 'string' ? item.evidence.trim().slice(0, 300) : '',
    }));
  return items.length > 0 ? { rsmAttempts: items } : {};
}

/** 归一化隐藏自评信号：只接受 high|medium|low，其余丢弃 */
function normalizeSelfAssessmentSignal(value: any): { selfAssessmentSignal?: NonNullable<TeachingTurnOutput['analysis']['selfAssessmentSignal']> } {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return { selfAssessmentSignal: value };
  }
  return {};
}

/** 归一化求助行为分流：自由描述（放宽枚举约束），截断限长；空值丢弃 */
function normalizeHelpSeekingType(value: any): { helpSeekingType?: string } {
  if (typeof value !== 'string') return {};
  const t = value.trim().slice(0, 120);
  return t ? { helpSeekingType: t } : {};
}

/**
 * 上线载荷里的对话历史：只保留 角色 / 内容 / 时间（走查 B-3）。
 *
 * 此前每条消息的 `analysis`（理解度/困惑点/情绪/负荷…）随历史一起进载荷，但
 * **teaching-turn 的规则与代码都不读历史消息的 analysis** —— 规则里的
 * `analysis.*`（第 87/104/108/109 条）指的是**本轮要产出的** analysis，
 * 上一轮的分析另走 `analysisStage`（双引擎试点）单独字段。
 * 而 `session-wrapup` 的输入是**另处组装**且明确声明"含 analysis 标注"，
 * 因此不受此处影响。
 * 收益：逐条 analysis 让单轮 prompt 多出约 1–2k tokens（首轮实测 ~14.5k），
 * 裁掉可降 TTFT；不影响模型可见的对话文本。
 * 时间戳同样不发：skill 的输入契约就是 `{ role, content }`，且 prompt 未引用
 * 消息时间（节奏信息走 `interactionProfile` 的 idleMsBefore 等更精确的字段）。
 */
export function toWireMessages(
  messages: TeachingTurnInput['messages']
): Array<{ role: string; content: string }> {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

/**
 * 条件规则（A 项，2026-09-23）：编译产物里以「若输入提供 X / 如果输入提供 X / 若 classroomEventContext…」
 * 开头的规则，只在对应输入**真的存在**时才需要发送（实测 13 条 / 3,078 字 = 执行规则段的 21.7%）。
 *
 * 为什么不"逐请求删 system"：规则原本在 system **前缀**里，逐请求改动会让前缀缓存整块失效
 * （连后面 ~15.8k 的 payload 一起重算），净亏。改为：system 只留常驻规则（稳定 → 可缓存），
 * 条件规则按需注入**本来就逐回合变化**的载荷尾部（`conditionalRules`）。
 */
export interface ConditionalRule {
  /** 规则引用的输入字段路径（用于判存在） */
  key: string;
  /** 规则正文（去掉编号） */
  text: string;
}

const CONDITIONAL_RULE_LEAD = /^(?:若输入提供|如果输入提供|若 classroomEventContext)/;

/** 值条件（字段常在、但值通常不满足）：不能只判"字段存在" */
const CONDITIONAL_RULE_OVERRIDES: Record<string, (input: TeachingTurnInput) => boolean> = {
  'controls.temporalGap': (input) => (input?.controls as any)?.temporalGap?.isLongGap === true,
};

/** 从规则正文里抽出它引用的输入字段路径（如 `scenario.materials`）。 */
function extractRuleField(ruleText: string): string {
  const backticked = ruleText.match(/`([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+)`/);
  if (backticked) return backticked[1];
  const plain = ruleText.match(/(?:输入提供|输入里|输入包含)\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/);
  if (plain) return plain[1];
  const anyPath = ruleText.match(/([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_.]*)/);
  return anyPath ? anyPath[1] : '';
}

/** 路径取值（非空即存在）：数组看长度、字符串看 trim、boolean 只认 true。 */
function hasPathValue(root: unknown, path: string): boolean {
  if (!path) return false;
  let current: any = root;
  for (const segment of path.split('.')) {
    if (current == null) return false;
    current = current[segment];
  }
  if (current == null || current === false) return false;
  if (Array.isArray(current)) return current.length > 0;
  if (typeof current === 'string') return current.trim().length > 0;
  return true;
}

/**
 * 把编译产物切成「常驻提示词」与「条件规则」：条件规则从 system 里摘出（常驻部分重编号，
 * 规则之间无编号互引 → 安全），由 buildPromptInput 在对应输入存在时注入载荷尾部。
 */
export function splitConditionalRules(systemPrompt: string): { stable: string; rules: ConditionalRule[] } {
  const lines = String(systemPrompt || '').split('\n');
  const start = lines.findIndex((line) => line.trim() === '## 执行规则');
  if (start < 0) return { stable: systemPrompt, rules: [] };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const stableRules: string[] = [];
  const rules: ConditionalRule[] = [];
  let buffer: string[] | null = null;
  let bufferIsConditional = false;
  const flush = () => {
    if (!buffer) return;
    const body = buffer.join('\n');
    if (bufferIsConditional) rules.push({ key: extractRuleField(body), text: body });
    else stableRules.push(body);
    buffer = null;
  };
  for (const line of lines.slice(start + 1, end)) {
    const match = line.match(/^\d+\.\s*(.*)$/);
    if (match) {
      flush();
      bufferIsConditional = CONDITIONAL_RULE_LEAD.test(match[1]);
      buffer = [match[1]];
    } else if (buffer && line.trim()) {
      buffer.push(line); // 续行（当前产物无，保留以防规则改写为多行）
    }
  }
  flush();

  if (rules.length === 0) return { stable: systemPrompt, rules: [] };
  const rebuilt = stableRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
  const stable = [...lines.slice(0, start + 1), '', rebuilt, '', ...lines.slice(end)].join('\n');
  return { stable, rules };
}

/** 本轮适用的条件规则正文（按输入存在性判定）。 */
export function selectApplicableRules(rules: ConditionalRule[], input: TeachingTurnInput): string[] {
  return rules
    .filter((rule) => {
      const override = CONDITIONAL_RULE_OVERRIDES[rule.key];
      if (override) return override(input);
      return hasPathValue(input, rule.key);
    })
    .map((rule) => rule.text);
}

/** 编译产物里的条件规则（取自默认产物；DB ACTIVE 与 .md 同源编译，判据一致）。 */
const CONDITIONAL_RULES = splitConditionalRules(TEACHING_TURN_PROMPT).rules;

function buildPromptInput(input: TeachingTurnInput) {
  const strategyGuidancePrompt = buildStrategyGuidancePrompt(input);
  const taskExecutionPrompt = buildTaskExecutionPrompt(input);

  // KV 前缀缓存友好化：scenario 内动态子键（contextCompression/interactionProfile）挪到尾部，
  // 稳定主体（任务/路径/策略上下文）保持前置，最大化 user 内前缀命中
  const {
    interactionProfile: scenarioInteractionProfile,
    contextCompression: scenarioCompression,
    // 载荷审计（2026-09-25）：这些子键是 scenario 里的逐回合变化项（其余整课恒定），
    // 留在 scenario 体内会把稳定主体打断 → 提取到载荷尾部（见 buildTeachingTurnMessages 的分流注释）。
    // 模板里的引用路径同步改为顶层键名（core yaml 已同步）。
    behavioralProfile: scenarioBehavioralProfile,
    checkpointHistory: scenarioCheckpointHistory,
    priorMisconceptions: scenarioPriorMisconceptions,
    // 尾部已单独注入 supplementaryMaterial，scenario 体内不再重复携带
    supplementaryMaterial: scenarioSupplementaryMaterial,
    // 缓存追踪实测（2026-09-28）：memoryWarmup 是漏网的第 7 个逐回合变化子键——温故点被消费后
    // 逐回合合并回计划（teaching-warmup.ts），留在 scenario（system 消息）会让消费温故的回合
    // 整段 KV 缓存归零。提取到载荷尾部，模板引用路径同步改为顶层键名（core yaml 已同步）。
    memoryWarmup: scenarioMemoryWarmup,
    ...stableScenario
  } = input.scenario;
  // learner 唯一的动态子键：编排层逐回合改写的难度档位（baseline/adjusted/reasons/evidence）
  const { taskDifficulty, ...stableLearner } = input.learner;

  const promptDirectives = {
    ...(strategyGuidancePrompt ? { strategyGuidance: strategyGuidancePrompt } : {}),
    taskExecution: taskExecutionPrompt,
  };
  const latestLearnerMessage = [...input.messages].reverse().find((message) => message.role === 'user')?.content || '';

  // 条件规则按需注入（逐回合变化 → 必须放**载荷尾部**）：输入提供了对应字段才带
  const applicableRules = selectApplicableRules(CONDITIONAL_RULES, input);
  logger.debug('[teaching-turn] 条件规则按需注入', {
    injected: applicableRules.length,
    total: CONDITIONAL_RULES.length,
    injectedChars: applicableRules.reduce((sum, rule) => sum + rule.length, 0),
  });
  const conditionalRulesPayload = applicableRules.length > 0
    ? {
        conditionalRules:
          '【本轮适用规则】输入提供了以下字段，故以下规则生效：\n'
          + applicableRules.map((rule) => `- ${rule}`).join('\n'),
      }
    : {};

  // 试飞改造（默认启用；PAYLOAD_STABLE_PREFIX=0 回退旧序）：
  // 真实遥测显示 scenario 每回合必变（因子键 interactionProfile/contextCompression 逐回合变化），
  // 前缀在 promptDirectives 之后的 knowledge 处即断（~7.3k/15.8k）。
  // 稳定前缀版：scenario(洁) → promptDirectives → learner 前置，其余逐回合变化的键全部后置。
  // 对话上下文单键化：原 visibleDialogueContext / recentDialogueContext 同源重复，收敛为 messages
  // （与 core 输入名一致；沙盘 ref sandbox:teaching.session.messages）。
  // 2026-09-25 前缀缓存修正：对话历史**不再放进载荷**，改由 buildMessages 以真 message 发送
  // （provider 实测只复用整条消息全同的前缀段，载荷内任何变动都会连 system 的 ~10.7k 缓存一起废掉）。
  // 2026-09-25 载荷审计追加：提取 scenario.behavioralProfile / scenario.checkpointHistory /
  // learner.taskDifficulty（彼时仅存的三个载荷内动态子键）到尾部，并把 conditionalRules
  // 提到每回合必变键之前——低频键变化只牺牲其后本来不可命中的字节。
  if (process.env.PAYLOAD_STABLE_PREFIX !== '0') {
    return {
      scenario: stableScenario,
      promptDirectives,
      learner: stableLearner,
      // —— 低频变化项（churn<1）：放在每回合必变键**之前**，稳定回合可并入前缀；
      //    变化时也只牺牲其后本来就无法命中的动态键 ——
      ...conditionalRulesPayload,
      ...(taskDifficulty ? { taskDifficulty } : {}),
      // —— 以下为逐回合变化项，统一后置 ——
      controls: input.controls,
      knowledge: input.knowledge,
      classroomContext: input.classroomContext,
      classroomEventContext: input.classroomEventContext,
      ...(scenarioCheckpointHistory ? { checkpointHistory: scenarioCheckpointHistory } : {}),
      ...(scenarioBehavioralProfile ? { behavioralProfile: scenarioBehavioralProfile } : {}),
      ...(scenarioPriorMisconceptions ? { priorMisconceptions: scenarioPriorMisconceptions } : {}),
      interactionProfile: scenarioInteractionProfile ?? null,
      ...(scenarioCompression ? { contextCompression: scenarioCompression } : {}),
      latestLearnerMessage,
      ...(input._analysisStage ? { analysisStage: input._analysisStage } : {}),
      // 教学配图时机（逐回合变化 → 必须放**载荷尾部**，避免打断 KV 前缀缓存；见 buildPromptInput 注释）
      ...(input.visualOpportunity?.suggested ? { visualOpportunity: input.visualOpportunity } : {}),
      // 教师补充材料（逐回合变化 → 同样放载荷尾部）：上一轮 control.supplement 的入库成果
      ...(scenarioSupplementaryMaterial ? { supplementaryMaterial: scenarioSupplementaryMaterial } : {}),
      // 温故计划（逐回合被消费合并 → 载荷尾部；模板引用路径已同步为顶层 memoryWarmup）
      ...(scenarioMemoryWarmup ? { memoryWarmup: scenarioMemoryWarmup } : {}),
    };
  }

  return {
    scenario: {
      ...stableScenario,
      ...(scenarioCompression ? { contextCompression: scenarioCompression } : {}),
      interactionProfile: scenarioInteractionProfile,
      ...(scenarioMemoryWarmup ? { memoryWarmup: scenarioMemoryWarmup } : {}),
    },
    promptDirectives,
    knowledge: input.knowledge,
    learner: input.learner,
    controls: input.controls,
    classroomContext: input.classroomContext,
    classroomEventContext: input.classroomEventContext,
    interactionProfile: scenarioInteractionProfile ?? null,
    // 对话历史外移为真 message（见 buildTeachingTurnMessages），载荷不再重复携带
    latestLearnerMessage,
    // 双引擎试点：第一段（推理模型）产出的 analysis 作为第二段的既定认知判定
    ...(input._analysisStage ? { analysisStage: input._analysisStage } : {}),
    ...conditionalRulesPayload,
  };
}

/**
 * 双引擎试点 · 第一段 analysis-only payload：
 * 同 teaching-turn 输入 + 显式指令（只产出 analysis，供推理模型做深层认知判定）
 */
function buildAnalysisOnlyPayload(input: TeachingTurnInput) {
  return {
    ...buildPromptInput(input),
    _analysisOnlyDirective:
      '【本次调用为认知判定阶段】只输出 analysis 对象（含 cognitiveLevel/levelScore/understanding/confusionPoints/engagement/emotionalState/loadIndex/loadBasis），'
      + '不输出 reply/knowledge/pedagogy/control。所有判定必须基于输入证据，无证据时按规则取默认值。',
  };
}

function evaluateAcceptanceCriteriaEvidence(input: TeachingTurnInput) {
  return evaluateByCriteria({
    messages: toWireMessages(input.messages),
    acceptanceCriteria: input.scenario.currentTaskContext?.acceptanceCriteria,
    mode: 'criteria'
  });
}

function evaluateCompletionByTaskProfile(input: TeachingTurnInput) {
  return evaluateByProfile({
    messages: toWireMessages(input.messages),
    taskType: input.scenario.taskType,
    knowledgeType: input.scenario.taskProfile?.knowledgeType,
    cognitiveLevel: input.scenario.taskProfile?.cognitiveLevel,
    knowledgePoints: input.knowledge.points,
    taskProfile: input.scenario.taskProfile ? {
      knowledgeType: input.scenario.taskProfile.knowledgeType || undefined,
      cognitiveLevel: input.scenario.taskProfile.cognitiveLevel || undefined,
      coreConcept: input.scenario.taskProfile.coreConcept || undefined
    } : undefined,
    mode: 'profile'
  });
}

function validateTeachingTurnOutput(parsed: any, input: TeachingTurnInput) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, failureReason: 'TEACHING_TURN_OUTPUT_NOT_OBJECT' };
  }

  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { valid: false, failureReason: 'TEACHING_TURN_REPLY_MISSING' };
  }

  // Q9 契约漂移容错：knowledge 缺失时允许其子字段平铺在顶层（见 resolveKnowledgeBlock），
  // 避免模型把 knowledge 拆平时整轮被判缺块丢弃。
  const hasNestedKnowledge = !!parsed.knowledge
    && typeof parsed.knowledge === 'object'
    && !Array.isArray(parsed.knowledge);
  const hasFlatKnowledge = KNOWLEDGE_SUBFIELD_KEYS.some((key) => parsed[key] !== undefined);
  if (!parsed.analysis || typeof parsed.analysis !== 'object'
    || (!hasNestedKnowledge && !hasFlatKnowledge)
    || !parsed.pedagogy || typeof parsed.pedagogy !== 'object' || !parsed.control || typeof parsed.control !== 'object') {
    return { valid: false, failureReason: 'TEACHING_TURN_REQUIRED_BLOCK_MISSING' };
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  const rawCompletionCandidate = parsed.control?.isCompletionCandidate === true;
  // 2026-08-30：完成一致性校验不再使用关键词硬匹配（evaluateByCriteria/evaluateByProfile），
  // 改为 LLM 语义判定 + 知识硬门禁：模型说完成 + 知识点全 mastered 才允许宣布完成。
  const resolvedKnowledge = resolveKnowledgeBlock(parsed);
  const rawPoints = Array.isArray(resolvedKnowledge.points) ? resolvedKnowledge.points : [];
  const inputPointMap = new Map(
    (Array.isArray(input.knowledge?.points) ? input.knowledge.points : [])
      .filter((point) => typeof point?.name === 'string' && point.name.trim())
      .map((point) => [point.name.trim().toLowerCase(), point])
  );

  rawPoints.forEach((point: any) => {
    if (typeof point?.name !== 'string' || !point.name.trim()) return;
    inputPointMap.set(point.name.trim().toLowerCase(), {
      name: point.name.trim(),
      status: point.status,
      progress: point.progress,
    });
  });

  const allKnowledgeMastered = Array.from(inputPointMap.values()).length > 0
    && Array.from(inputPointMap.values()).every((point: any) => point?.status === 'mastered');
  const hasPrematureCompletionLanguage = /已完成|满足.*要求|满足.*标准|进入下一环节|进入下一个任务|接下来.*下一环节|接下来.*下一个任务/.test(reply);
  const completionLanguageAllowed = rawCompletionCandidate && allKnowledgeMastered;

  if (hasPrematureCompletionLanguage && !completionLanguageAllowed) {
    return { valid: false, failureReason: 'TEACHING_TURN_REPLY_COMPLETION_MISMATCH' };
  }

  return { valid: true };
}

/**
 * 消息形态层（2026-09-25 前缀缓存修正）：对话历史以**真 message** 发送——[system, …history, user(载荷)]。
 *
 * 为什么：provider 的前缀缓存只复用「整条消息完全匹配」的前缀段（受控实验实测，
 * probe-prefix-cache-semantics.ts：载荷内只改尾部 → 命中 0%；消息边界处分叉 → 96-98%）。
 * 历史原先放在 payload 内，任一逐回合字段变动都会让 [system+history] 整段缓存作废
 * （真课实测 teaching-turn 命中率仅 16.7%）。外移后相邻两回合共享全部历史 message，
 * 实测形态（D2/D3）稳态命中 96-98%。
 *
 * 角色映射：学生发言 → user，教师发言 → assistant（载荷里的 latestLearnerMessage 已含本轮输入，
 * 故历史里的最后一条学生消息不重复进 user；载荷作为最终 user message 携带逐回合状态）。
 *
 * 副作用修正（实测）：历史变成真对话后，模型有 ~88% 的首 attempt 直接用对话正文回答学生
 * （不输出 JSON，触发校验重试 = 每回合两遍模型钱，缓存收益被吃光）。故最终 user 消息
 * 尾部追加一条**常驻**输出契约指令（区别于重试提示：这不是在指责上轮出错，而是把
 * "这是结构化任务"的信号放在离输出最近的位置）。追加在载荷 JSON 之后，不进 JSON 体。
 */
const OUTPUT_CONTRACT_TAIL =
  '\n\n【输出契约】以上是课堂状态数据，不是要继续回答学生的对话。'
  + '请严格按系统提示的输出契约，直接输出单个 JSON 对象：'
  + '不要输出任何对话正文、寒暄或代码围栏，JSON 必须是整条回复的第一个字符。';

/** 会话内恒定、可安全并入 system 尾部的载荷键（buildPromptInput 已把动态子键从这两块里抽出）。 */
const STABLE_CONTEXT_KEYS = new Set(['scenario', 'learner']);

function buildTeachingTurnMessages(args: {
  input: TeachingTurnInput;
  systemPrompt: string;
  userPayload: string;
  retryMessage?: string | null;
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const wire = toWireMessages(args.input.messages);
  const history = wire.map((message) => ({
    role: (message.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: message.content,
  }));
  const suffix = args.retryMessage
    ? `\n\n${args.retryMessage}`
    : OUTPUT_CONTRACT_TAIL;

  // 2026-09-25 第二段修正（逐回合命中遥测证伪了"载荷内重排"路线）：
  // 真实请求流 [system, …历史, user(载荷)] 里，第 N 回合与第 N-1 回合的共同前缀止于
  // a(N-2)——下一个槽位上一回合放的是**载荷消息**、本回合放的是**原始用户消息**，必然发散。
  // 所以无论载荷内部多稳定，整个 user 载荷都落在发散点之后、逐回合全价重发
  // （实测 hit 每回合仅 +256 tok，载荷内可命中 71% 也不兑现）。
  // 修法：会话内恒定的稳定块（scenario/learner 主体，审计实测 ~12K 字节 ≈ 5K tok）
  // 挪进 system 尾部——第 2 回合起进入可缓存前缀；user 载荷只留逐回合变化项（~6K 字节）。
  // system 变更会使当回合缓存归零，因此低频变化块（promptDirectives/conditionalRules/
  // taskDifficulty 等）一律**不进** system、留在 user 载荷尾部（EV 上更便宜）。
  let systemContent = args.systemPrompt;
  let userContent = `${args.userPayload}${suffix}`;
  if (process.env.PAYLOAD_STABLE_PREFIX !== '0') {
    try {
      const parsed = JSON.parse(args.userPayload) as Record<string, unknown>;
      const stable: Record<string, unknown> = {};
      const dynamic: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        (STABLE_CONTEXT_KEYS.has(key) ? stable : dynamic)[key] = value;
      }
      // 两个稳定块齐备才分流；否则维持整体载荷在 user（旧形状/异常输入的兜底）
      if (stable.scenario && stable.learner && Object.keys(stable).length === STABLE_CONTEXT_KEYS.size) {
        systemContent = `${args.systemPrompt}\n\n【课堂稳定上下文】以下是本节课内保持不变的背景数据（任务情境与学习者画像），全程有效、与动态状态配合使用：\n${JSON.stringify(stable)}`;
        userContent = `${JSON.stringify(dynamic)}${suffix}`;
      }
    } catch {
      // userPayload 非法 JSON（不应发生）时退回整体载荷形态
    }
  }

  return [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userContent },
  ];
}

const teachingTurnPromptSpec: PromptCallSpec<TeachingTurnInput, TeachingTurnOutput> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: TEACHING_TURN_PROMPT,
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'teaching-turn',
  },
  buildUserPayload: (input) => buildPromptInput(input),
  prepareSystemPrompt: (systemPrompt) => splitConditionalRules(systemPrompt).stable,
  // 历史外移为真 message（前缀缓存修正，2026-09-25；实验依据见 buildTeachingTurnMessages）
  buildMessages: (args) => buildTeachingTurnMessages(args),
  normalizeOutput: (parsed, input) => normalizeOutput(parsed, input),
  // Q9 契约漂移容错：core fields 契约校验前把平铺的 knowledge 子字段收敛回 knowledge 对象，
  // 不改变最终业务形态（最终形态仍由 normalizeOutput 决定）。
  coerceParsedForContract: (parsed) => (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { ...parsed, knowledge: resolveKnowledgeBlock(parsed) }
    : parsed),
  validateParsedOutput: (parsed, input) => validateTeachingTurnOutput(parsed, input),
  mapEnvelope: (output, _input, runtimeContract) => {
    const isCompletion = !!output.control?.isCompletionCandidate;
    const phase = isCompletion ? 'completion-candidate' : 'turn-generated';
    return adaptToRuntimeEnvelope({
      contract: runtimeContract,
      artifact: output,
      phase,
      status: 'succeeded',
      confidence: 0.8,
      isTerminal: isCompletion,
      nextAction: isCompletion ? 'finalize-or-advance' : 'continue-turn',
      nextState: {
        stage: phase,
        isCompletionCandidate: isCompletion,
        shouldTriggerPeer: !!output.control?.shouldTriggerPeer,
        knowledge: output.knowledge,
        pedagogy: output.pedagogy,
      },
    });
  },
    retryStrategy: {
    maxAttempts: 2,
    onValidationFail: ({ failureReason }) => `上一次输出未通过校验，原因是：${failureReason}。请重新输出一个严格 JSON，特别注意：`
      // reply 是**用户可见文本**：实测（2026-09-22）模型有时只给了 knowledge/pedagogy 而漏掉 reply，
      // 导致整轮以 TEACHING_TURN_REPLY_MISSING 失败（用户看到"这节课没回应"）。这里点名要求。
      + `0) **必须包含全部顶层块**：reply（非空字符串，老师这一轮真正说给学生听的话，Markdown 文本）、analysis（对象）、`
      + `knowledge（对象，含 points 数组）、pedagogy（对象，含 strategies）、control（对象）；缺任一块整轮都会失败，不能只给其中一部分；`
      + `1) knowledge.points 要围绕当前任务、验收标准和最近课堂对话动态生成，不要偏题；`
      + `2) pedagogy.strategies 只能使用允许的枚举；`
      + `3) 保持当前任务的 core concept 与 target relation 不偏移。`,
  },
};

/**
 * 双引擎试点 · 第一段 analysis-only spec（推理模型深层认知判定）：
 * 复用 teaching-turn 的 ACTIVE prompt，payload 追加 analysis-only 指令；失败降级单段。
 */
const teachingAnalysisPromptSpec: PromptCallSpec<TeachingTurnInput, TeachingTurnOutput> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: TEACHING_TURN_PROMPT,
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'teaching-turn',
  },
  buildUserPayload: (input) => buildAnalysisOnlyPayload(input),
  prepareSystemPrompt: (systemPrompt) => splitConditionalRules(systemPrompt).stable,
  buildMessages: (args) => buildTeachingTurnMessages(args),
  normalizeOutput: (parsed) => ({ ...parsed }),
  validateParsedOutput: (parsed) => {
    if (!parsed || typeof parsed !== 'object' || !parsed.analysis || typeof parsed.analysis !== 'object') {
      return { valid: false, failureReason: 'TEACHING_TURN_ANALYSIS_MISSING' };
    }
    return { valid: true };
  },
  retryStrategy: {
    maxAttempts: 1,
  },
};

export async function teachingTurnAgentHandler(input: TeachingTurnInput): Promise<AgentOutput> {
  // 双引擎试点（feature flag 默认关）：WENFLOW_TWO_STAGE_TEACHING=1 时先 reasoning 产 analysis，再 chat 产 reply
  if (process.env.WENFLOW_TWO_STAGE_TEACHING === '1') {
    try {
      const analysisResult = await callPrompt(teachingAnalysisPromptSpec, input);
      if (analysisResult.success && analysisResult.output?.analysis) {
        const fullResult = await callPrompt(teachingTurnPromptSpec, {
          ...input,
          _analysisStage: analysisResult.output.analysis,
        });
        return buildTeachingOutcome(fullResult, input);
      }
      logger.warn('[TeachingTurnAgent] 双引擎第一段失败，降级单段');
    } catch (error) {
      logger.warn('[TeachingTurnAgent] 双引擎异常，降级单段', { error });
    }
  }
  const result = await callPrompt(teachingTurnPromptSpec, input);
  return buildTeachingOutcome(result, input);
}

function buildTeachingOutcome(
  result: PromptCallResult<TeachingTurnOutput>,
  input: TeachingTurnInput
): AgentOutput {
  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'TEACHING_TURN_OUTPUT_INVALID');
  }

  const output = result.output;
  const skillOutcome = toTeachingTurnSkillOutcome(output, result.runtimeEnvelope);
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
        // Internal canonical sidecar. Keep `teaching` unchanged for legacy consumers.
        teachingTurnOutcome: skillOutcome,
        promptDebug: result.debug,
      }
    },
    runtimeEnvelope: result.runtimeEnvelope,
    renderHints: {
      component: 'teaching-turn'
    },
    schemaVersion: 'agent-output-v1',
    metadata: {
      agentId: AGENT_ID,
      agentName: '教学回合 Skill',
      agentType: 'teaching',
      confidence: 0.8,
      generatedAt: new Date().toISOString(),
    }
  };
}
