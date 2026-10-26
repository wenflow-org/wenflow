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
import { recordDegradation } from '../degradation-telemetry';
import { findArithmeticMismatches, type ArithmeticMismatch } from '../../services/ai-teaching/teaching-arithmetic-guard';
import { normalizeForKeywordMatch } from '../../services/ai-teaching/checkpoint-shared';
import { applyObservableEvidenceGate, detectObservableEvidence } from './observable-evidence';
import type { ChatMessageContent } from '../../gateway/api-gateway/types';
import { buildVisionContent } from '../../utils/vision-content';

const AGENT_ID = 'skill:teaching-turn';

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const TEACHING_TURN_PROMPT = loadPromptFile(AGENT_ID)?.systemPrompt || '';

type MessageRole = 'user' | 'assistant' | 'system';

/** 教学配图的最小可送模型形态（#123）：url + 可选说明；日期/provider 等元数据不进提示词 */
export interface TeachingTurnMessageImage {
  url: string;
  caption?: string | null;
}

const ALLOWED_COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
const ALLOWED_EMOTIONAL_STATES = ['positive', 'neutral', 'frustrated', 'confused', 'bored'] as const;
const ALLOWED_KNOWLEDGE_STATUSES = ['pending', 'learning', 'mastered', 'review'] as const;
const ALLOWED_LOAD_BASIS = ['semantic', 'structure', 'pacing', 'combined', 'absent'] as const;

/** knowledge 对象的子字段：Q9 契约漂移容错时按此名单从顶层回填（见 resolveKnowledgeBlock） */
const KNOWLEDGE_SUBFIELD_KEYS = ['currentPoint', 'points', 'confirmCheck'] as const;

/**
 * 知识点条目的**稳定身份键**（KC 身份迁移遗留项的写入侧收口，2026-10-19）：
 * `kcId` 来自 scenario.taskKcs（kc-mapper 产出，路径内 KC 局部序号），由模型在
 * knowledge.points / analysis.ktEstimate.conceptMastery 里原样回填（契约见
 * prompts/core/teaching-turn.yaml）。模型措辞漂移时名字会变、kcId 不变——写入侧
 * 据此锚定同一概念（memory-trace.service resolveConceptIdSafe）。可选：缺省不填，
 * 行为与引入前逐字一致（回落自由文本名）。
 */
export interface TeachingTurnKnowledgePoint {
  name: string;
  /** 可选稳定键：与 scenario.taskKcs[].kcId 同值（模型原样回填；缺失即无稳定键） */
  kcId?: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

/** kcId 归一（透传而非改写）：去空白、限长；空/非字符串 → undefined（不得伪造） */
function normalizeKcId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

export interface TeachingTurnInput {
  /**
   * 对话消息（#123 起可携带课堂配图）：images 仅用于**模型可见历史**，
   * 确定性判据（evaluate* 系列）仍只读文本（见 toWireMessages）。
   */
  messages: Array<{ role: MessageRole; content: string; images?: TeachingTurnMessageImage[] }>;
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
    /** 本课细粒度知识组件（kc-mapper 产出）：提示词规则要求 knowledge.points 对齐到 KC 粒度 */
    taskKcs?: Array<{ kcId: string; name: string; taxonomy?: string }>;
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
     * anchor='semantic' = 标题/引文均未命中，由**语义召回**兜底选出的最相关原文块（2026-10-16）。
     */
    activeTaskMaterialExcerpts?: Array<{
      materialId?: string | null;
      materialName?: string | null;
      sectionTitle?: string | null;
      quote?: string | null;
      anchor?: 'quote' | 'title' | 'semantic' | 'none';
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
      /** 可选稳定键（KC 身份）：见 TeachingTurnKnowledgePoint 注释；透传，代码不改写 */
      kcId?: string;
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
    /**
     * 检查点作答回合的**代码裁决**（全量测试报告 #14）：本回合是对某个检查点的提交作答时，
     * 编排层按答案键算出对错后显式送进来（`{ passed, detail }`，detail 为未通过时缺的要点）。
     * 为什么必须送：此前裁决只用于落库与消费，不进提示词——实测模型反馈「答得对/答到了」
     * 与系统记录 passed=false 相反（15/15）。模型反馈口径必须与裁决一致（提示词规则见
     * prompts/core/teaching-turn.yaml 的 checkpointVerdict 条）。
     */
    checkpointVerdict?: {
      passed: boolean;
      detail: string | null;
    };
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
    /**
     * 回合级知识状态估计（θ−d 路由信号）：conceptMastery + 任务难度 + 建议。
     * conceptMastery 项的 kcId 与 knowledge.points 同概念一致（同一稳定键，见
     * TeachingTurnKnowledgePoint）；写入侧据此锚定概念身份（名字漂移不再分叉）。
     */
    ktEstimate?: {
      conceptMastery?: Array<{ conceptKey: string; kcId?: string; mastery: number; evidence?: string }>;
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
    points: TeachingTurnKnowledgePoint[];
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
   * 教学图（确定性 SVG 渲染）：**mermaid 画不好的那几类关系**才走这里。
   *
   * 分工（2026-10-18 扩图型）：
   * - 节点-边类（流程/时序/层级/分类）→ `diagram`（mermaid），本块不重复承担；
   * - 位置/距离/方向 → `position-line`；
   * - 二维对账/命中矩阵 → `matrix`；二维排布但每格是内容 → `grid`；
   * - 两分支对照 → `compare`；多对多映射 → `bipartite`；2×2 象限 → `quadrant`；棋盘 → `board`。
   *
   * 规则：
   * - 只画**对话正在处理的**关系，不要画本轮要学生自己产出的答案（答案泄漏）；
   * - 标签写**学科实指**（甲/乙/评分点原文/概念名），不要写"项目 1"这类占位；
   * - `caption` 写一句给学生看的话；reply 必须脱离图也成立（图是同一关系的更直观呈现）；
   * - `position-line` 用顶层字段（axis/marks/spans/guides），其余图型用 `spec`（见各图型说明）。
   */
  figure?: TeachingFigure | null;
}

/** 教学图图型：mermaid 表达不了的二维/位置/多对多关系，以及按「关系形状」分的包含/权衡/层级。 */
export type TeachingFigureKind =
  | 'position-line'
  | 'grid'
  | 'matrix'
  | 'compare'
  | 'quadrant'
  | 'bipartite'
  | 'board'
  | 'bins'
  | 'balance'
  | 'ladder'
  | 'cycle'
  | 'tree'
  | 'venn'
  | 'bullseye'
  | 'range-bar'
  | 'cartesian-plot'
  | 'concept-map'
  | 'split-compare'
  | 'state-strip';

export interface TeachingFigure {
  /** 渲染引擎；归一化后恒为 'svg'（其他值整块丢弃，见 normalizeFigure） */
  engine: string;
  /** 图型；归一化后恒为上述白名单之一 */
  kind: TeachingFigureKind;
  /**
   * 学科调色板（服务端按学习路径的 subject 盖章；模型不给也行）。
   * 只影响观感（色相/材质），不改变任何几何与语义。
   */
  palette?: 'indigo' | 'earth' | 'tech' | 'warm' | 'violet' | 'mono';
  /** 图下方一句说明（学生可见）；归一化后恒为 string|null */
  caption: string | null;
  /** position-line 专用（kind='position-line' 时由归一化保证存在） */
  axis?: {
    min: number;
    max: number;
    /** 单位（如「米」「格」「秒」）；无单位则 null */
    unit: string | null;
    ticks: Array<{ at: number; label: string | null }>;
  };
  /** 位置线上的对象（人物/物/点）；1~6 个，按 at 升序 */
  marks?: Array<{
    at: number;
    label: string;
    /** 朝向箭头：right/left/none（静态点） */
    dir: 'right' | 'left' | 'none';
  }>;
  /** 区间标注（距离/差）；0~3 条，画在轴下方 */
  spans?: Array<{ from: number; to: number; label: string }>;
  /** 竖直参考线（追及点/相遇点/分界）；0~4 条 */
  guides?: Array<{ at: number; label: string | null }>;
  /**
   * 其余图型的规格（kind≠'position-line' 时由归一化保证存在且已逐字段裁剪）：
   * - grid: {title?, rows, cols, rowLabels?, colLabels?, colWidths?, cells?[{r,c,text,mask?,ghost?,hl?,mark?}], note?}
   * - matrix: {title?, rowLabels[], colLabels[], cells?[{r,c,tone:'hit'|'miss'|'dup'|'key'}], note?, legend?}
   * - compare: {title?, left{head,sub?,items[]}, right{...}, divider?, note?, leftTone?, rightTone?}
   * - quadrant: {title?, colLabels?[2], rowLabels?[{label,sub?}], cells?[4]{title,body[],tone?,icon?}, note?}
   * - bipartite: {title?, left{head?,nodes[]}, right{head?,nodes[]}, edges?[{from,to,tone?,dash?}], note?, width?}
   * - board: {title?, pieces[]={col,rank,key}, files?, arrows?, marks?, note?, size?, panelLabel?}
   */
  spec?: Record<string, unknown>;
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
      // 可选：教学图（确定性 SVG 渲染；kind 见 TeachingTurnOutput.figure）
      // position-line 用顶层 axis/marks/spans/guides，其余图型用 spec
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

function filterOverlyBroadKnowledgePoints(points: TeachingTurnKnowledgePoint[], input: TeachingTurnInput): TeachingTurnKnowledgePoint[] {
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

  let normalizedKnowledgePoints = filterOverlyBroadKnowledgePoints(
    points.map((point: any) => ({
      name: typeof point?.name === 'string' ? point.name : '',
      // kcId 透传（不改写、不按名字推断）：模型没给就没有——写入侧据此回落自由文本名
      ...(normalizeKcId(point?.kcId) ? { kcId: normalizeKcId(point?.kcId)! } : {}),
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

  // #54 P-28：平台可观测证据门——规则 15 只是提示词，完成判定此前 100% 信任模型。
  // 离线动作 / 学生无实质发言时：不得判完成，且本轮不得把知识点升为 mastered。
  const observableEvidence = detectObservableEvidence(input.messages, reply);
  if (observableEvidence.offlineAction || !observableEvidence.substantiveUserTurn) {
    const gated = applyObservableEvidenceGate(normalizedKnowledgePoints, observableEvidence);
    const downgraded = gated.filter((point, index) => point.status !== normalizedKnowledgePoints[index].status).length;
    normalizedKnowledgePoints = gated;
    logger.warn('[TeachingTurnAgent] 可观测证据不足，本轮不推进掌握/完成', {
      taskTitle: input.scenario.taskTitle,
      offlineAction: observableEvidence.offlineAction,
      substantiveUserTurn: observableEvidence.substantiveUserTurn,
      lastUserText: observableEvidence.lastUserText,
      downgradedKnowledgePoints: downgraded,
    });
  }

  const normalizedCurrentPoint = typeof knowledge.currentPoint === 'string' && knowledge.currentPoint.trim()
    ? knowledge.currentPoint.trim()
    : null;
  const currentPointRemovedByFilter = normalizedCurrentPoint
    && normalizeConceptName(input.scenario.taskProfile?.coreConcept || input.scenario.taskProfile?.linkedConceptName || '')
    && !normalizedKnowledgePoints.some((point) => point.name === normalizedCurrentPoint);
  // 与 return 里的 knowledge.currentPoint 同值：检查点概念归属（engine 侧）与泄漏豁免共用
  const resolvedCurrentPoint = currentPointRemovedByFilter
    ? normalizedKnowledgePoints[0]?.name || null
    : normalizedCurrentPoint;
  // 内容正确性第二刀（2026-10-08）：检查点出口的确定性筛查——题面/选项算式复算（带错题
  // 放行的伤害大于本轮不出题，命中即整题丢弃）+ 简答答案键泄漏检测（照抄可见文本即可
  // 骗过判分的要点剔除，全空降级为无标准键）。命中均打遥测，绝不阻塞课堂。
  const screenedCheckpoint = typeof control.checkpoint?.question === 'string' && control.checkpoint.question.trim()
    ? screenCheckpointOutput(control.checkpoint, reply, resolvedCurrentPoint)
    : null;
  // 完成判定（2026-08-30 改为 LLM 语义判定）：
  // 此前用 acceptanceCriteria 关键词硬匹配（evaluateByCriteria/evaluateByProfile）拦截完成信号，
  // 对口语化/创作类任务（如视频剪辑 demo 的 diagnose/refine 任务）产生系统性假阴性，
  // 学生语义上已达标但措辞不匹配即被拦截，导致回合膨胀。
  // 现在：isCompletionCandidate 由 LLM 基于对话语义自行判断（提示词 rule 18/19/21），
  // 评估器输出仅作为观测信号透传（completionCandidateEvidence），不再参与完成门禁。
  const requestedCompletionCandidate = !!control.isCompletionCandidate;
  // #54：完成判定必须有平台可观测证据（纯文本产出）。规则 15 的离线动作或空转发言不构成完成。
  const resolvedCompletionCandidate = requestedCompletionCandidate
    && !observableEvidence.offlineAction
    && observableEvidence.substantiveUserTurn;

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
      currentPoint: resolvedCurrentPoint,
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
      ...(screenedCheckpoint ? { checkpoint: screenedCheckpoint } : {}),
      ...(normalizeWarmupOutcomes(control.warmupOutcomes) ?? {}),
      ...(normalizeSupplement(control.supplement) ?? {}),
    },
    ...(normalizeVisual(parsed.visual) ?? {}),
    ...(normalizeDiagram(parsed.diagram) ?? {}),
    ...(normalizeFigureOrLog(parsed.figure) ?? {}),
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
/** 出图理由：一句话，按「为什么这里需要图 / 为什么用这个形状」写，超长截断 */
const FIGURE_WHY_MAX = 60;
const FIGURE_UNIT_MAX = 8;

/** 图型白名单（2026-10-18 扩图型；flow 不在此列——节点-边类继续走 mermaid）。 */
const FIGURE_KINDS: ReadonlySet<string> = new Set([
  'position-line',
  'grid',
  'matrix',
  'compare',
  'quadrant',
  'bipartite',
  'board',
  // 2026-10-19：按「关系形状」补三种——包含（bins）、权衡（balance）、层级（ladder）。
  // 它们与 compare 的差别不是外观，而是语义：并排≠包含，并列≠谁压得住，列表≠先后。
  'bins',
  'balance',
  'ladder',
  // 2026-10-20：按「几何隐喻」补四种——闭环（cycle）、辐射树（tree）、交集（venn）、靶盘（bullseye）。
  // 用户点名的失败模式：能一眼看出几何差别的结构被压成了白框填字（信效度画成四格文字、
  // 多对多画成打勾矩阵）。这四种让关系本身有形状，模型只负责给节点和点坐标。
  'cycle',
  'tree',
  'venn',
  'bullseye',
  // 2026-10-21：区间条（range-bar）。多组「从 A 到 B」的波动/范围并排比较——
  // 挤在一维位置线上必然把 ΔY 画成 ΔX（走查 #4~#7/#13~#15 的根因），给它自己的轨道。
  'range-bar',
  // 2026-10-23：二维科学坐标图（cartesian-plot）。函数曲线/平抛轨迹/实验数据点——
  // 手机里那节平抛课该出的「频闪等时轨迹」就是它，此前系统只能拿 grid 表格硬塞。
  'cartesian-plot',
  // 2026-10-23 晚：概念图（concept-map）。用户点破方向：要的不是「讲完一处配一张答案图」，
  // 而是把**概念本身**摆出来——要素有哪些、彼此是什么关系、从哪来、导致什么。
  'concept-map',
  // 2026-10-26：正误对比画布（split-compare）。动作诊所节奏的专属图型——
  // 把「易错做法 vs 正确做法」左右并排，delta 指出分叉在哪一步；
  // 误区纠错靠嘴说学生只能对号入座，并排一摆差异自己跳出来。
  'split-compare',
  // 2026-10-26：状态条带（state-strip）。过程类知识的三/四帧速写——
  // 每帧一个时刻/阶段，帧内几条要点，帧间箭头表示推进；
  // cycle 是回到原点的环，state-strip 是不回头的进程（握手、编译、消化、翻案）。
  'state-strip',
]);

/**
 * 已退役图型：仍留在类型与渲染器里（历史消息还要能显示），但**新的出图一律拒绝**。
 * 用户 2026-10-23 判定这四种「从视觉传达上根本不是图」：grid 是网格表、compare 是双栏列表、
 * bins 是分栏列表、ladder 是台阶列表——都只是在给句子加圆角边框。
 */
const RETIRED_FIGURE_KINDS: ReadonlySet<string> = new Set(['grid', 'compare', 'bins', 'ladder']);

/** 调色板白名单：由服务端按学科盖章，模型不给也行。 */
const FIGURE_PALETTES: ReadonlySet<string> = new Set(['indigo', 'earth', 'tech', 'warm', 'violet', 'mono']);

/**
 * 结构图规格上限：单一来源，前后端渲染器也按这个量级出图。
 * 超过上限不是"截断"而是"丢弃该条"——多出来的一定是模型把段落塞进格子。
 */
const SPEC = {
  rowsMax: 8,
  colsMax: 6,
  cellTextMax: 26,
  cellMarkMax: 4,
  titleMax: 42,
  noteMax: 160,
  labelMax: 18,
  subMax: 22,
  itemsMax: 8,
  itemTextMax: 26,
  nodesMax: 8,
  edgesMax: 14,
  piecesMax: 32,
  arrowsMax: 8,
  filesMax: 4,
  legendMax: 4,
  bodyLinesMax: 4,
  bodyLineMax: 26,
  dotsMax: 6,
} as const;

/** 棋盘棋子：大写黑方 / 小写红方（只认中国象棋七种）。 */
const BOARD_KEYS = new Set(['R', 'N', 'B', 'A', 'K', 'C', 'P', 'r', 'n', 'b', 'a', 'k', 'c', 'p']);


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
  // 有意匹配控制字符区间替换为空格（文本清洗用途），非残留控制码
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  // 超长必须留痕：直接 slice 会印出「I had dinner, then wat」这种半截句（2026-10-23 外部视觉评审实拍）
  if (text.length > max) return text.slice(0, Math.max(1, max - 1)) + '…';
  return text || null;
}

/**
 * 轴单位归一（2026-10-21 走查 #9）：单位是给学习者看的一个短词，不是注释栏。
 * 实跑里模型把「（示意，非真实数值）」塞进 unit，被截成半截括号印在左上角。
 * 只接受短单位（米/天/ms/个百分点/%/°）；含括号、逗号、空格或整句一律丢弃（返回 null）。
 * 用码点白名单而不是正则：`\uXXXX` 转义在本项目多层工具链里被吃掉过。
 */
function normalizeAxisUnit(raw: unknown): string | null {
  const text = toFigureText(raw, 12);
  if (!text) return null;
  if (text.length > 6) return null;
  const allowed = (ch: string): boolean => {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fa5) return true; // 汉字
    if (code >= 0x30 && code <= 0x39) return true; // 0-9
    if (code >= 0x41 && code <= 0x5a) return true; // A-Z
    if (code >= 0x61 && code <= 0x7a) return true; // a-z
    return ch === '%' || ch === '°' || ch === '/' || ch === '·' || ch === '.';
  };
  for (const ch of text) {
    if (!allowed(ch)) return null;
  }
  return text;
}

/**
 * 图内文本归一（严格版）：超长 → null，**不截断**。
 * 标签是教学信息本身，截成半句话比没有更糟；可选文本（tick/guide 的 label）超长则丢标签保位置。
 */
function toFigureLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // 有意匹配控制字符区间替换为空格（同上，清洗用途）
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text || text.length > max) return null;
  return text;
}

/**
 * 归一化老师给的教学图（契约见 `TeachingTurnOutput.figure`）。
 *
 * 入口只做两件事：**白名单图型** + **交给对应图型的归一化**。
 * `position-line` 沿用 2026-09-27 的既有契约（顶层 axis/marks/spans/guides）；
 * 其余图型走 `spec`，每个分支都**重建一个新对象**——模型多给的字段一律不进入渲染层
 * （前端会把 spec 直接拼进 SVG，白名单是首道防线）。
 */
/**
 * 出口包装：模型给了 figure 但归一化拒绝时**留一条 warn**。
 * 静默丢弃会让「reply 里写着『这张对照表』、消息里却没有图」变成不可观测的悬空引用——
 * 2026-10-20 实跑里整节 0 图就是靠这条日志才定位到是块被拒，而不是模型没画。
 */
function normalizeFigureOrLog(raw: unknown): { figure: NonNullable<TeachingTurnOutput['figure']> } | null {
  const result = normalizeFigure(raw);
  if (!result && raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    logger.warn('[teaching-figure] 模型给了 figure 但被归一化拒绝，本轮不出图', {
      kind: typeof record.kind === 'string' ? record.kind : null,
      keys: Object.keys(record).slice(0, 12),
      hasSpec: Boolean(record.spec),
    });
  }
  return result;
}

function normalizeFigure(raw: unknown): { figure: NonNullable<TeachingTurnOutput['figure']> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kindRaw = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
  const kind = kindRaw || 'position-line';
  if (!FIGURE_KINDS.has(kind) || !isFigureKindEnabled(kind)) return null;
  // 文字装框类图型退役（用户 2026-10-23：「这不叫图，叫制表信息」）。
  // grid/compare/bins/ladder 的本质是「带边框的排版文字」，学生读的是框里的句子，
  // 不是几何；这类内容用正文 Markdown 表格更清楚，也不该占掉一节课的出图名额。
  if (RETIRED_FIGURE_KINDS.has(kind)) {
    logger.warn('[teaching-figure] 图型已退役（文字装框类），本轮不出图', { kind });
    return null;
  }
  const caption = toFigureText(record.caption, FIGURE_CAPTION_MAX);
  const why = toFigureText(record.why, FIGURE_WHY_MAX);
  const paletteRaw = typeof record.palette === 'string' ? record.palette.trim().toLowerCase() : '';
  const palette = FIGURE_PALETTES.has(paletteRaw) ? (paletteRaw as TeachingFigure['palette']) : null;

  if (kind === 'position-line') {
    const figure = normalizePositionLineFigure(record);
    return figure ? { figure: { ...figure, caption, ...(why ? { why } : {}), ...(palette ? { palette } : {}) } } : null;
  }
  const specRaw = record.spec && typeof record.spec === 'object' ? (record.spec as Record<string, unknown>) : record;
  const spec = normalizeFigureSpec(kind as TeachingFigureKind, specRaw);
  if (!spec) return null;
  return { figure: { engine: 'svg', kind: kind as TeachingFigureKind, caption, ...(why ? { why } : {}), spec, ...(palette ? { palette } : {}) } };
}

/**
 * 出图归一化的对外入口（探针/离线评测用）。
 *
 * 与线上同一条路径：白名单 → 图型开关 → 退役图型拒绝 → 各图型字段校验。
 * 探针必须走它，否则「模型给图了」和「这张图真的能下发」是两件事。
 */
export function normalizeTeachingFigureForProbe(raw: unknown): { figure: TeachingFigure | null; reason: string } {
  if (!raw || typeof raw !== 'object') return { figure: null, reason: 'no-figure' };
  const kind = String((raw as Record<string, unknown>).kind ?? '');
  const before = RETIRED_FIGURE_KINDS.has(kind) ? 'retired-kind' : null;
  const result = normalizeFigure(raw);
  if (!result) return { figure: null, reason: before ?? 'rejected-by-normalizer' };
  return { figure: result.figure, reason: 'ok' };
}

/** 新图型灰度开关：`TEACHING_FIGURE_SPEC_DISABLED=1` 时只保留位置线（回滚用）。 */
function isFigureKindEnabled(kind: string): boolean {
  if (kind === 'position-line') return true;
  return process.env.TEACHING_FIGURE_SPEC_DISABLED !== '1';
}

/**
 * 归一化位置线图（2026-09-27 Scope B 既有契约，2026-10-18 从 normalizeFigure 拆出）。
 *
 * 规则（宁缺毋滥 + 确定性可渲染）：
 * - **必须至少有一个有效 mark**（没有对象就没有位置关系，整块丢弃）；
 * - 数值域由代码统一推导：取 axis/ticks/marks/spans/guides 的全部取值求并集，两端各留 4% 余量——
 *   模型给的 min/max 只作为单位与刻度的来源，**不得把取值挡在域外**（挡了就是画错图）；
 * - marks 按 at 升序、去重（同位置只留第一个）；spans 要求 from≠to；越界/非法项丢弃；
 * - 各数组超上限截断；标签超长丢弃该条（不截断成半句话）。
 */
function normalizePositionLineFigure(record: Record<string, unknown>): Omit<TeachingFigure, 'caption'> | null {

  const rawMarks = Array.isArray(record.marks) ? record.marks : [];
  // 三种「下方标注」的分工（2026-10-20 两轮外部视觉审校定的）：
  //   spans = 跨度/距离（A 到 B 隔多远）；
  //   group = 归类/共性（这几个点是同一类）——画成花括号，花括号的语义就是「归在一起」；
  //   tag   = 单个点的短标签。
  // 用区间线表达「同一性」会被读成跨度，用重复标签又会被读成「重复的题」——两种都试过，都不行。
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
  const unit = normalizeAxisUnit(axisRecord?.unit);
  // 位置线的轴必须是**量**（米/秒/℃/元/百分比）。
  // 「题/个/条/种/类/项/步」是计数或序号，不是可以排先后远近的量——
  // 2026-10-20 实跑里模型把「第1/2/3道题」画成了一条位置线，看着像坐标系，其实是三个并列项：
  // 这类内容该用 bins/compare，不该借位置线的壳。
  const COUNTER_UNITS = new Set([
    '题', '题号', '道', '道题', '个', '条', '种', '类', '项', '步', '次', '序号', '排名',
  ]);
  if (unit && COUNTER_UNITS.has(unit.trim())) return null;
  const ticks: Array<{ at: number; label: string | null }> = [];
  for (const item of Array.isArray(axisRecord?.ticks) ? (axisRecord?.ticks as unknown[]) : []) {
    if (!item || typeof item !== 'object') continue;
    const tick = item as Record<string, unknown>;
    const at = toFiniteNumber(tick.at);
    if (at === null) continue;
    ticks.push({ at, label: toFigureLabel(tick.label, FIGURE_LABEL_MAX) });
    if (ticks.length >= FIGURE_TICKS_MAX) break;
  }

  let group: { from: number; to: number; label: string } | null = null;
  if (record.group && typeof record.group === 'object') {
    const g = record.group as Record<string, unknown>;
    const from = toFiniteNumber(g.from);
    const to = toFiniteNumber(g.to);
    const label = toFigureText(g.label, FIGURE_SPAN_LABEL_MAX);
    if (from !== null && to !== null && from !== to && label) {
      group = { from: Math.min(from, to), to: Math.max(from, to), label };
    }
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
    ...(group ? [group.from, group.to] : []),
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

  /* 铁律 1（2026-10-21 走查 #8~#11）：时间轴上的水平线段天然读作「时长」。
     拿它去标「数值涨跌幅度」是跨量纲混画——周二到周六会被读成 4 天，而不是 0.7 个点。
     这类内容该用 range-bar / compare，不该借位置线的壳。 */
  const TIME_UNITS = new Set(['秒', '毫秒', 'ms', 's', '分', '分钟', '小时', '时', '天', '日', '周', '星期', '月', '年']);
  const MAGNITUDE_SPAN = /(幅度|涨跌|涨|跌|差值|差距|差额|百分比|个点|转化率|%)/;
  if (unit && TIME_UNITS.has(unit.trim().toLowerCase()) && spans.some((s) => MAGNITUDE_SPAN.test(s.label))) {
    return null;
  }

  /* 铁律 2（走查 #10/#11）：只有「最高/最低」两个锚点、没有真实刻度、还挂一条跨度线——
     实际是一条伪装成位置线的区间条，图上没有任何可核对的信息，整块丢弃。 */
  const RANGE_EDGE = /(最高|最低|最大|最小)/;
  const edgeMarks = dedupedMarks.filter((m) => RANGE_EDGE.test(m.label));
  if (dedupedMarks.length < 3 && ticks.length === 0 && spans.length >= 1 && edgeMarks.length >= 2) {
    return null;
  }

  return {
    engine: 'svg',
    kind: 'position-line',
    axis,
    marks: dedupedMarks,
    spans,
    ...(group ? { group } : {}),
    guides,
  };
}

/* ---------------- 结构图规格归一化（2026-10-18 扩图型） ---------------- */

function toBoundedInt(value: unknown, min: number, max: number): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  const i = Math.trunc(n);
  return i >= min && i <= max ? i : null;
}

function toStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    // 模型常把条目写成 {"label": "…"}（bins/compare 示例就是对象形态）；
    // 只认字符串会把整栏条目清空，导致整张图被归一化拒绝（2026-10-22 真课丢图）。
    const raw = item && typeof item === 'object'
      ? (item as Record<string, unknown>).label ?? (item as Record<string, unknown>).text ?? (item as Record<string, unknown>).value
      : item;
    const text = toFigureLabel(raw, maxLen);
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 定长标签列表：按声明的列数/行数补空串。
 * 不能直接用 toStringList —— 它会丢掉缺失项，导致后面的标签整体左移
 * （2026-10-23 外部视觉评审实拍：3 列表格只给 2 个列标题，第二个标题落到了第一列上）。
 */
function toStringListFixed(value: unknown, count: number, maxLen: number): string[] {
  const filled = toStringList(value, count, maxLen);
  while (filled.length < count) filled.push('');
  return filled;
}

function normalizeTone(value: unknown, allowed: readonly string[]): string | null {
  const tone = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.includes(tone) ? tone : null;
}

/** 颜色只认十六进制：spec 会被前端拼进 SVG 属性，这是首道注入防线。 */
function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : null;
}

/** 虚线只认「数字 + 空格/逗号」：同上，属性注入的首道防线。 */
function normalizeDash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9][0-9\s,.]{0,18}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeFigureSpec(kind: TeachingFigureKind, raw: Record<string, unknown>): Record<string, unknown> | null {
  switch (kind) {
    case 'matrix':
      return normalizeMatrixSpec(raw);
    case 'quadrant':
      return normalizeQuadrantSpec(raw);
    case 'bipartite':
      return normalizeBipartiteSpec(raw);
    case 'board':
      return normalizeBoardSpec(raw);
    case 'balance':
      return normalizeBalanceSpec(raw);
    case 'cycle':
      return normalizeCycleSpec(raw);
    case 'tree':
      return normalizeTreeSpec(raw);
    case 'venn':
      return normalizeVennSpec(raw);
    case 'bullseye':
      return normalizeBullseyeSpec(raw);
    case 'range-bar':
      return normalizeRangeBarSpec(raw);
    case 'cartesian-plot':
      return normalizeCartesianPlotSpec(raw);
    case 'concept-map':
      return normalizeConceptMapSpec(raw);
    case 'split-compare':
      return normalizeSplitCompareSpec(raw);
    case 'state-strip':
      return normalizeStateStripSpec(raw);
    default:
      return null;
  }
}

/**
 * 焦点：只允许「哪一行/哪一列/哪一侧」，不允许模型指定颜色或自由坐标。
 * `bounds` 是表格的真实行列数（不含上界）：越界焦点会指向不存在的行/列，
 * 保留下来只会让前端白算一次高亮，直接丢掉。
 */
function normalizeFocus(
  raw: unknown,
  allowed: readonly string[],
  bounds?: { rows?: number; cols?: number },
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['row', 'col'] as const) {
    if (!allowed.includes(key)) continue;
    const limit = bounds?.[key === 'row' ? 'rows' : 'cols'];
    if (limit !== undefined && limit < 1) continue;
    const n = toBoundedInt(record[key], 0, limit !== undefined ? limit - 1 : 15);
    if (n !== null) out[key] = n;
  }
  const side = normalizeSide(record.side, allowed);
  if (side) out.side = side;
  return Object.keys(out).length ? out : null;
}

function normalizeSide(value: unknown, allowed: readonly string[]): string | null {
  const side = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.includes(side) ? side : null;
}


/** balance：两边各自的分量（weight 由代码换算成倾角，模型只给数）。 */
function normalizeBalanceSide(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const side = value as Record<string, unknown>;
  const head = toFigureLabel(side.head, SPEC.labelMax);
  if (!head) return null;
  const items = toStringList(side.items, SPEC.itemsMax, SPEC.itemTextMax);
  const sub = toFigureText(side.sub, SPEC.subMax);
  const weight = toBoundedInt(side.weight, 0, 10);
  return { head, items, ...(sub ? { sub } : {}), ...(weight !== null ? { weight } : {}) };
}

function normalizeBalanceSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const left = normalizeBalanceSide(raw.left);
  const right = normalizeBalanceSide(raw.right);
  if (!left || !right) return null;
  if (!(left.items as unknown[]).length || !(right.items as unknown[]).length) return null;
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  const pivotLabel = toFigureText(raw.pivotLabel, SPEC.subMax);
  const focus = normalizeSide(raw.focus, ['left', 'right']);
  return {
    left,
    right,
    ...(pivotLabel ? { pivotLabel } : {}),
    ...(focus ? { focus } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * split-compare（2026-10-26）：正误并排对比画布。
 *
 * 为什么单独一种图型：纠错语境下学生要看的不是「正确的抽象描述」，而是
 * **自己的做法和正确做法差在哪一步**——左右并排、行行对齐，delta 一句话点破分叉点。
 * 这是「动作诊所」节奏（diagnose/refine 任务）的专属图型，也是误区预判（misconceptionHints）
 * 的首选载体；compare 是双栏列表（已退役），split-compare 的两栏是**同一动作的两种走法**，
 * 行与行之间有对应关系，不是两段文字。
 *
 * 约束：left/right 必填（head ≤18 字，rows 1~4，每行 label 必填 ≤18 字、sub 可选 ≤22 字）；
 * delta 可选（label ≤22 字，at 为 1-based 行号、越界丢弃）；tone 只认四种。
 */
function normalizeSplitCompareSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const normalizePanel = (panelRaw: unknown): Record<string, unknown> | null => {
    if (!panelRaw || typeof panelRaw !== 'object') return null;
    const panel = panelRaw as Record<string, unknown>;
    const head = toFigureLabel(panel.head, SPEC.labelMax);
    if (!head) return null;
    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(panel.rows) ? panel.rows : []) {
      if (!item || typeof item !== 'object' || rows.length >= 4) continue;
      const row = item as Record<string, unknown>;
      const label = toFigureLabel(row.label, SPEC.labelMax);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const sub = toFigureText(row.sub, SPEC.subMax);
      const tone = normalizeTone(row.tone, ['ok', 'warn', 'accent', 'neutral']);
      rows.push({
        label,
        ...(sub ? { sub } : {}),
        ...(tone ? { tone } : {}),
      });
    }
    if (!rows.length) return null;
    const tone = normalizeTone(panel.tone, ['ok', 'warn', 'accent', 'neutral']);
    return { head, rows, ...(tone ? { tone } : {}) };
  };
  const left = normalizePanel(raw.left);
  const right = normalizePanel(raw.right);
  if (!left || !right) return null;
  // 两栏内容完全相同 = 不是对比（外盲评 V4 #2：两侧代码一字不差，学生看不到差异）
  const leftSeq = (left.rows as Array<Record<string, unknown>>).map((r) => r.label).join('');
  const rightSeq = (right.rows as Array<Record<string, unknown>>).map((r) => r.label).join('');
  if (leftSeq === rightSeq) return null;
  // at 是 1-based 行号，超过两栏最大行数就是指向不存在的行——高亮会落空，直接丢
  const rowCount = Math.max((left.rows as unknown[]).length, (right.rows as unknown[]).length);
  let delta: Record<string, unknown> | null = null;
  if (raw.delta && typeof raw.delta === 'object') {
    const deltaRaw = raw.delta as Record<string, unknown>;
    const deltaLabel = toFigureText(deltaRaw.label, SPEC.subMax);
    if (deltaLabel) {
      const at = toFiniteNumber(deltaRaw.at);
      delta = { label: deltaLabel, ...(at !== null && at >= 1 && at <= rowCount ? { at: Math.floor(at) } : {}) };
    }
  }
  const title = toFigureText(raw.title, SPEC.titleMax);
  return {
    left,
    right,
    ...(delta ? { delta } : {}),
    ...(title ? { title } : {}),
  };
}

/**
 * state-strip（2026-10-26）：状态条带——不回头的进程分帧速写。
 *
 * 为什么单独一种图型：过程类知识（三次握手、编译四步、消化流程、翻案时间线）的
 * 本体是「状态随阶段推进」，cycle 画成环会误导（它不回原点），cartesian 又没有
 * 离散阶段轴。条带帧间箭头就是「下一步」，帧内要点是该时刻的状态快照。
 *
 * 约束：frames 2~5（label ≤18 字），每帧 items 0~3 条（≤18 字）；同一条目跨帧
 * 复用由模型自己重写（渲染不做状态对齐）；note ≤160 字；tone 只认四种。
 */
function normalizeStateStripSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const frames: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.frames) ? raw.frames : []) {
    if (!item || typeof item !== 'object' || frames.length >= 5) continue;
    const frame = item as Record<string, unknown>;
    const label = toFigureLabel(frame.label, SPEC.labelMax);
    if (!label) continue;
    const items: string[] = [];
    const seen = new Set<string>();
    for (const rawItem of Array.isArray(frame.items) ? frame.items : []) {
      if (items.length >= 3) break;
      const text = typeof rawItem === 'string' ? toFigureLabel(rawItem, SPEC.labelMax) : null;
      if (!text || seen.has(text)) continue;
      seen.add(text);
      items.push(text);
    }
    const tone = normalizeTone(frame.tone, ['ok', 'warn', 'accent', 'neutral']);
    frames.push({ label, items, ...(tone ? { tone } : {}) });
  }
  if (frames.length < 2) return null;
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  return {
    frames,
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

/** ladder：2~6 级台阶，state 决定实心/描边/虚线。 */
/**
 * range-bar（2026-10-21）：多组「从 A 到 B」的区间并排比较。
 *
 * 为什么单独一种图型：位置线只有一根轴，把「新组 3.1~3.8」「旧组 2.9~3.6」「均值差 0.5」
 * 挤到同一根线上，模型只能把 ΔY 画成 ΔX——落在现实中就是「周二到周六 = 0.7 个点」这种
 * 数学上自相矛盾的图（外审走查 #4~#7/#13~#15）。区间有自己的轨道：每条一行，长度就是区间。
 *
 * 契约：rows 2~4 条（label 必填、from/to 必为数字且不相等，顺序由代码归一）；
 * unit 走短单位白名单；marks 最多 2 个参考点（如「汇报的均值差」）；tone 只认四种。
 */
function normalizeRangeBarSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const rows: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.rows) ? raw.rows : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = toFigureLabel(row.label, SPEC.labelMax);
    if (!label) continue;
    const a = toFiniteNumber(row.from);
    const b = toFiniteNumber(row.to);
    if (a === null || b === null || a === b) continue;
    const tone = normalizeTone(row.tone, ['ok', 'warn', 'accent', 'neutral']);
    rows.push({
      label,
      from: Math.min(a, b),
      to: Math.max(a, b),
      ...(tone ? { tone } : {}),
    });
    if (rows.length >= 4) break;
  }
  if (rows.length < 2) return null;

  const marks: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.marks) ? raw.marks : []) {
    if (!item || typeof item !== 'object') continue;
    const mark = item as Record<string, unknown>;
    const at = toFiniteNumber(mark.at);
    if (at === null) continue;
    const label = toFigureText(mark.label, SPEC.subMax);
    marks.push({ at, ...(label ? { label } : {}) });
    if (marks.length >= 2) break;
  }

  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  const unit = normalizeAxisUnit(raw.unit);
  return {
    rows,
    ...(marks.length ? { marks } : {}),
    ...(unit ? { unit } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * concept-map：概念图（2026-10-23 用户定调：要概念可视化，不是出题）。
 *
 * 与其它图型的区别：节点不是「这一轮提到的对象」，而是**知识结构里的概念要素**
 * （概念/过程/量/条件），边不是「指向」，而是**有名字的关系**（产生/供给/构成/依赖/导致/对比）。
 * 学生看图是在建立知识结构，不是在核对某个答案。
 *
 * 约束：
 * - 节点 2~10 个、边 1~14 条；边必须两端都在节点里（悬空边丢弃）；
 * - 每条边**必须有关系名**（≤10 字）——没有名字的线只是连线，不是知识；
 * - 允许 layer（0~3）指定层级，缺省由渲染器按最长路径自动分层。
 */
function normalizeConceptMapSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const nodes: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    const id = toFigureLabel(node.id, 24);
    const label = toFigureLabel(node.label, SPEC.labelMax);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const sub = toFigureText(node.sub, SPEC.subMax);
    const tone = normalizeTone(node.tone, ['accent', 'ok', 'warn', 'neutral']);
    const layer = toBoundedInt(node.layer, 0, 3);
    nodes.push({ id, label, ...(sub ? { sub } : {}), ...(tone ? { tone } : {}), ...(layer !== null ? { layer } : {}) });
    if (nodes.length >= 10) break;
  }
  if (nodes.length < 2) return null;

  const edges: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!item || typeof item !== 'object') continue;
    const edge = item as Record<string, unknown>;
    const from = toFigureLabel(edge.from, 24);
    const to = toFigureLabel(edge.to, 24);
    const label = toFigureLabel(edge.label, 10);
    if (!from || !to || !label || from === to || !seen.has(from) || !seen.has(to)) continue;
    const tone = normalizeTone(edge.tone, ['accent', 'ok', 'warn', 'neutral']);
    const dash = normalizeDash(edge.dash);
    edges.push({ from, to, label, ...(tone ? { tone } : {}), ...(dash ? { dash } : {}) });
    if (edges.length >= 14) break;
  }
  if (!edges.length) return null;

  // 没有任何边连到的节点是孤岛：概念图里它既不属于结构也不解释什么，剪掉。
  const used = new Set<string>();
  for (const e of edges) {
    used.add(String(e.from));
    used.add(String(e.to));
  }
  const kept = nodes.filter((n) => used.has(String(n.id)));
  if (kept.length < 2) return null;

  const title = toFigureText(raw.title, SPEC.titleMax);
  const readout = toFigureText(raw.takeaway, SPEC.noteMax);
  return {
    nodes: kept,
    edges,
    ...(title ? { title } : {}),
    ...(readout ? { takeaway: readout } : {}),
  };
}

/**
 * cartesian-plot：二维科学坐标图（2026-10-23）。
 *
 * 为什么必须补这个图型：平抛课被画成 5 张文字表格、光合曲线被画成网格——
 * 因为渲染器里没有「横轴 x、纵轴 y、曲线、等时刻辅助线」这套东西，模型只能把公式塞进格子。
 * 这里不追求通用绘图库，只收课堂上真正需要的四样：曲线（折线/抛物线/一次函数/散点）、
 * 等值辅助线、点上的矢量箭头、落点标注。
 *
 * 约束（与其它图型一致：宁缺毋滥）：
 * - 轴必须有确定区间（min<max）；刻度由代码生成，模型只给「希望在哪里标」，越界即丢；
 * - 系列最多 3 条、每条最多 1 个表达式或 40 个点——课堂图不是数据面板；
 * - 表达式用 a/b/c（抛物线 y=ax²+bx+c）或 k/b（一次函数）承载，由渲染器按轴域采样，
 *   模型不必（也不许）自己列几十个点，否则它就会开始编数。
 */
function normalizeCartesianPlotSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const axisOf = (value: unknown, labelMax: number) => {
    if (!value || typeof value !== 'object') return null;
    const axis = value as Record<string, unknown>;
    const min = toFiniteNumber(axis.min);
    const max = toFiniteNumber(axis.max);
    if (min === null || max === null || !(max > min)) return null;
    const label = toFigureText(axis.label, labelMax);
    const ticksRaw = Array.isArray(axis.ticks) ? axis.ticks : [];
    const ticks = ticksRaw
      .map((t) => toFiniteNumber(t))
      .filter((t): t is number => t !== null && t >= min && t <= max)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .sort((a, b) => a - b)
      .slice(0, 8);
    return { min, max, ...(label ? { label } : {}), ...(ticks.length ? { ticks } : {}) };
  };
  const x = axisOf(raw.x, SPEC.labelMax);
  const y = axisOf(raw.y, SPEC.labelMax);
  if (!x || !y) return null;
  // V6 双轴：y2 只在存在 right 轴系列时才生效（孤立 y2 是模型笔误，丢掉）
  const y2 = axisOf(raw.y2, SPEC.labelMax);

  const series: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.series) ? raw.series : []) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    // 系列名是图例，不是几何标签：放宽到 26 字并按 … 截断，而不是整条系列作废。
    // 2026-10-23 广度扫测：滴定曲线的系列名写成了「0.1 mol/L HCl 用 0.1 mol/L NaOH 滴定」(35 字)，
    // 18 字上限把整张图判死，学生什么都没看到。
    const name = toFigureText(s.name, 26);
    if (!name) continue;
    const tone = normalizeTone(s.tone, ['accent', 'ok', 'warn', 'neutral']) || undefined;
    const formRaw = typeof s.form === 'string' ? s.form.trim().toLowerCase() : '';
    // 频闪点先解析：既可能是附加在曲线上的点，也可能是曲线本身的采样点（只有它没 points 时）
    const dotPointsEarly: Array<[number, number]> = [];
    if (Array.isArray(s.dotPoints)) {
      for (const raw of s.dotPoints) {
        if (!Array.isArray(raw) || raw.length < 2) continue;
        const dx = toFiniteNumber(raw[0]);
        const dy = toFiniteNumber(raw[1]);
        if (dx === null || dy === null) continue;
        dotPointsEarly.push([dx, dy]);
        if (dotPointsEarly.length >= 24) break;
      }
    }
    const out: Record<string, unknown> = { name, form: formRaw === 'scatter' ? 'scatter' : formRaw === 'parabola' ? 'parabola' : formRaw === 'linear' ? 'linear' : formRaw === 'bars' ? 'bars' : 'points' };
    if (out.form === 'parabola') {
      const a = toFiniteNumber(s.a);
      const b = toFiniteNumber(s.b);
      const c = toFiniteNumber(s.c);
      if (a === null || b === null || c === null || a === 0) continue;
      out.a = a;
      out.b = b;
      out.c = c;
    } else if (out.form === 'linear') {
      const k = toFiniteNumber(s.k);
      const b = toFiniteNumber(s.b);
      if (k === null || b === null) continue;
      out.k = k;
      out.b = b;
    } else {
      const points: Array<[number, number]> = [];
      for (const p of Array.isArray(s.points) ? s.points : []) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const px = toFiniteNumber(p[0]);
        const py = toFiniteNumber(p[1]);
        if (px === null || py === null) continue;
        points.push([px, py]);
        if (points.length >= 40) break;
      }
      // 只给 dotPoints、没给 points 的曲线：把 dotPoints 当作曲线顶点（并保留为频闪点）。
      // 2026-10-23 广度扫测：滴定曲线把 15 个采样点全写进 dotPoints，模型被整条判死后学生看不到图。
      if (!points.length && dotPointsEarly.length) {
        for (const raw of dotPointsEarly) points.push(raw);
      }
      const minPoints = out.form === 'scatter' || out.form === 'bars' ? 1 : 2;
      if (points.length < minPoints) continue;
      out.points = points;
      if (s.dots === true) out.dots = true;
    }
    // 频闪点：曲线用 form=parabola/linear 表达，等时刻位置另给 dotPoints——
    // 这样「曲线 + 每一拍的点」仍是**同一个系列**（同一颜色、一条图例），
    // 不会让学生以为点和线是两回事（外审 2026-10-23：两条同名系列色几乎一样，分不清）。
    if (Array.isArray(s.dotPoints) && s.dotPoints.length) {
      const dots: Array<[number, number]> = [];
      for (const p of s.dotPoints) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const dx = toFiniteNumber(p[0]);
        const dy = toFiniteNumber(p[1]);
        if (dx === null || dy === null) continue;
        dots.push([dx, dy]);
        if (dots.length >= 24) break;
      }
      if (dots.length) out.dotPoints = dots;
    }
    if (tone) out.tone = tone;
    // 双轴：只有右侧确实有轴（y2 有效）才保留 axis:'right'，否则退回左轴
    if (y2 && (s as Record<string, unknown>).axis === 'right') out.axis = 'right';
    series.push(out);
    if (series.length >= 3) break;
  }
  if (!series.length) return null;

  const guides: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.guides) ? raw.guides : []) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    const axis = g.axis === 'x' ? 'x' : g.axis === 'y' ? 'y' : null;
    const at = toFiniteNumber(g.at);
    const bounds = axis === 'x' ? x : axis === 'y' ? y : null;
    if (!axis || at === null || !bounds || at < bounds.min || at > bounds.max) continue;
    const label = toFigureLabel(g.label, SPEC.subMax);
    guides.push({ axis, at, ...(label ? { label } : {}) });
    if (guides.length >= 6) break;
  }

  const vectors: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.vectors) ? raw.vectors : []) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const at = Array.isArray(v.at) ? v.at : null;
    const px = at ? toFiniteNumber(at[0]) : null;
    const py = at ? toFiniteNumber(at[1]) : null;
    const dx = toFiniteNumber(v.dx);
    const dy = toFiniteNumber(v.dy);
    if (px === null || py === null || dx === null || dy === null) continue;
    if (dx === 0 && dy === 0) continue;
    const label = toFigureLabel(v.label, SPEC.subMax);
    vectors.push({ at: [px, py], dx, dy, ...(label ? { label } : {}) });
    if (vectors.length >= 6) break;
  }

  // 落点/关键点标注：只标老师这一轮真的要学生看的那一两个点，多了就是贴纸。
  const marks: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.marks) ? raw.marks : []) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const at = Array.isArray(m.at) ? m.at : null;
    const px = at ? toFiniteNumber(at[0]) : null;
    const py = at ? toFiniteNumber(at[1]) : null;
    const label = toFigureLabel(m.label, SPEC.subMax);
    if (px === null || py === null || !label) continue;
    const tone = normalizeTone(m.tone, ['accent', 'ok', 'warn', 'neutral']);
    marks.push({ at: [px, py], label, ...(tone ? { tone } : {}) });
    if (marks.length >= 4) break;
  }

  // 面积：v-t 图下的位移、需求/供给曲线围出的剩余、函数与 x 轴围成的面积——
  // 这类「面积就是答案」的课没有阴影就只剩一条线（广度扫测 #3 判词：学生要看见的是面积）。
  const areas: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.areas) ? raw.areas : []) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const from = toFiniteNumber(a.from);
    const to = toFiniteNumber(a.from2 ?? a.to);
    if (from === null || to === null || from === to) continue;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi <= x.min || lo >= x.max) continue;
    const seriesName = toFigureText(a.series, SPEC.labelMax);
    // series2：两条曲线之间的夹心填充（人口出生/死亡率之差、供需剩余）。给了两名就忽略 baseline。
    const series2Name = toFigureText(a.series2, SPEC.labelMax);
    const base = series2Name ? null : toFiniteNumber(a.baseline);
    const label = toFigureLabel(a.label, SPEC.subMax);
    const tone = normalizeTone(a.tone, ['accent', 'ok', 'warn', 'neutral']);
    areas.push({
      from: Math.max(lo, x.min),
      to: Math.min(hi, x.max),
      ...(seriesName ? { series: seriesName } : {}),
      ...(series2Name ? { series2: series2Name } : {}),
      ...(base !== null ? { baseline: base } : {}),
      ...(label ? { label } : {}),
      ...(tone ? { tone } : {}),
    });
    if (areas.length >= 3) break;
  }

  // xBand：纵向高亮带（滴定突跃区间、均衡价格邻域）。给「看这一段」一个色块，
  // 不再让模型用文字标签硬指——2026-10-24 外审 #5 的修法。
  const bands: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.bands) ? raw.bands : []) {
    if (!item || typeof item !== 'object') continue;
    const bnd = item as Record<string, unknown>;
    const from = toFiniteNumber(bnd.from);
    const to = toFiniteNumber(bnd.to);
    if (from === null || to === null || from === to) continue;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi <= x.min || lo >= x.max) continue;
    const label = toFigureLabel(bnd.label, SPEC.subMax);
    const tone = normalizeTone(bnd.tone, ['accent', 'ok', 'warn', 'neutral']);
    bands.push({
      from: Math.max(lo, x.min),
      to: Math.min(hi, x.max),
      ...(label ? { label } : {}),
      ...(tone ? { tone } : {}),
    });
    if (bands.length >= 3) break;
  }

  const title = toFigureText(raw.title, SPEC.titleMax);
  const rightSeries = series.some((sv) => sv.axis === 'right');
  return {
    x,
    y,
    ...(y2 && rightSeries ? { y2 } : {}),
    series,
    ...(guides.length ? { guides } : {}),
    ...(bands.length ? { bands } : {}),
    ...(areas.length ? { areas } : {}),
    ...(vectors.length ? { vectors } : {}),
    ...(marks.length ? { marks } : {}),
    ...(title ? { title } : {}),
  };
}

/**
 * 留白槽位（2026-10-20）：模型只标「这一格留给学生」，不填答案。
 * 课上直接填好答案的图会把思考步骤替学生做完——用户点名的失败模式。
 * `?` / `？` / `待定` / `mask:true` 都归一成同一个占位符 `?`，渲染层画成虚线待填。
 */
function normalizeSlot(value: unknown, mask: unknown, max: number): string | null {
  if (mask === true) return '?';
  const text = toFigureLabel(value, max);
  if (!text) return null;
  if (text === '?' || text === '？' || text === '待定' || text === '…') return '?';
  return text;
}

/** cycle：3~6 个节点首尾相接（阶段回流），一个可选的环心说明。 */
function normalizeCycleSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const nodes: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    const label = normalizeSlot(node.label, node.mask, SPEC.labelMax);
    if (!label) continue;
    const sub = toFigureText(node.sub, SPEC.subMax);
    const tone = normalizeTone(node.tone, ['accent', 'ok', 'warn']);
    nodes.push({ label, ...(sub ? { sub } : {}), ...(tone ? { tone } : {}), ...(label === '?' ? { mask: true } : {}) });
    if (nodes.length >= 6) break;
  }
  if (nodes.length < 3) return null;
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  const center = toFigureText(raw.center, SPEC.subMax);
  return {
    nodes,
    ...(center ? { center } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

/** tree：一个根长出 2~6 个分支，每个分支最多挂两条要点（第三条一定是在写段落）。 */
function normalizeTreeSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const rootRaw = (raw.root && typeof raw.root === 'object' ? raw.root : {}) as Record<string, unknown>;
  const rootLabel = toFigureLabel(rootRaw.label, SPEC.labelMax);
  if (!rootLabel) return null;
  const rootSub = toFigureText(rootRaw.sub, SPEC.subMax);
  const branches: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.branches) ? raw.branches : []) {
    if (!item || typeof item !== 'object') continue;
    const branch = item as Record<string, unknown>;
    const label = normalizeSlot(branch.label, branch.mask, SPEC.labelMax);
    if (!label) continue;
    const sub = toFigureText(branch.sub, SPEC.subMax);
    const tone = normalizeTone(branch.tone, ['accent', 'ok', 'warn']);
    const items: string[] = [];
    for (const rawItem of Array.isArray(branch.items) ? branch.items : []) {
      const text = typeof rawItem === 'string' ? normalizeSlot(rawItem, null, SPEC.itemTextMax) : null;
      if (text) items.push(text);
      if (items.length >= 2) break;
    }
    branches.push({
      label,
      ...(sub ? { sub } : {}),
      ...(items.length ? { items } : {}),
      ...(tone ? { tone } : {}),
      ...(label === '?' ? { mask: true } : {}),
    });
    if (branches.length >= 6) break;
  }
  if (branches.length < 2) return null;
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  return {
    root: { label: rootLabel, ...(rootSub ? { sub: rootSub } : {}) },
    branches,
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

/** venn：两个概念的重叠区（易混/边界）。两侧各 2~4 条例子，交集最多 2 条短例。 */
function normalizeVennSide(value: unknown, itemsMax: number): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const side = value as Record<string, unknown>;
  const head = toFigureLabel(side.head, SPEC.labelMax);
  if (!head) return null;
  const items = toStringList(side.items, itemsMax, SPEC.itemTextMax);
  return { head, ...(items.length ? { items } : {}) };
}

function normalizeVennSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const left = normalizeVennSide(raw.left, 4);
  const right = normalizeVennSide(raw.right, 4);
  if (!left || !right) return null;
  const overlap = normalizeVennSide(raw.overlap, 2);
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  return {
    left,
    right,
    ...(overlap ? { overlap } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * bullseye：2×2 靶盘，点坐标取 [-1,1]（0,0 = 靶心）。
 * 坐标只做一次 clamp：越界的点会被画到靶外，看起来像"数据错了"，不如直接夹回边缘。
 */
function normalizeBullseyeSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const colLabels = toStringList(raw.colLabels, 2, SPEC.labelMax);
  if (colLabels.length < 2) return null;
  const rowLabels: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.rowLabels) ? raw.rowLabels : []) {
    const record = (item && typeof item === 'object' ? item : { label: item }) as Record<string, unknown>;
    const label = toFigureLabel(record.label, SPEC.labelMax);
    if (!label) continue;
    const sub = toFigureText(record.sub, SPEC.subMax);
    rowLabels.push({ label, ...(sub ? { sub } : {}) });
    if (rowLabels.length >= 2) break;
  }
  if (rowLabels.length < 2) return null;
  const cells: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.cells) ? raw.cells : []) {
    if (!item || typeof item !== 'object') continue;
    const cell = item as Record<string, unknown>;
    const title = toFigureLabel(cell.title, SPEC.labelMax);
    if (!title) continue;
    const desc = toFigureText(cell.desc, SPEC.noteMax);
    const tone = normalizeTone(cell.tone, ['ok', 'warn', 'accent', 'neutral']);
    const dots: number[][] = [];
    for (const dot of Array.isArray(cell.dots) ? cell.dots : []) {
      if (!Array.isArray(dot) || dot.length < 2) continue;
      const x = Number(dot[0]);
      const y = Number(dot[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      dots.push([Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))]);
      if (dots.length >= 12) break;
    }
    cells.push({ title, ...(desc ? { desc } : {}), ...(tone ? { tone } : {}), ...(dots.length ? { dots } : {}) });
    if (cells.length >= 4) break;
  }
  if (cells.length < 4) return null;
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  return {
    colLabels,
    rowLabels,
    cells,
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}


const MATRIX_TONES = ['hit', 'miss', 'dup', 'key'] as const;

/** matrix：二维命中矩阵（✓ / — / 叠 / ≡）——对账类课堂的核心教具。 */
function normalizeMatrixSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const rowLabels = toStringList(raw.rowLabels, SPEC.rowsMax, SPEC.labelMax);
  const colLabels = toStringList(raw.colLabels, SPEC.colsMax, SPEC.labelMax);
  if (rowLabels.length < 2 || colLabels.length < 2) return null;
  const cells: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.cells) ? raw.cells : []) {
    if (!item || typeof item !== 'object') continue;
    const cell = item as Record<string, unknown>;
    const r = toBoundedInt(cell.r, 0, rowLabels.length - 1);
    const c = toBoundedInt(cell.c, 0, colLabels.length - 1);
    const tone = normalizeTone(cell.tone, MATRIX_TONES);
    if (r === null || c === null || !tone) continue;
    cells.push({ r, c, tone });
    if (cells.length >= rowLabels.length * colLabels.length) break;
  }
  if (!cells.length) return null;
  const legend: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.legend) ? raw.legend : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const text = toFigureLabel(entry.text, SPEC.labelMax);
    const fill = normalizeHex(entry.fill);
    if (!text || !fill) continue;
    const stroke = normalizeHex(entry.stroke);
    legend.push({ text, fill, ...(stroke ? { stroke } : {}) });
    if (legend.length >= SPEC.legendMax) break;
  }
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  const focus = normalizeFocus(raw.focus, ['row', 'col'], { rows: rowLabels.length, cols: colLabels.length });
  return {
    rowLabels,
    colLabels,
    cells,
    ...(legend.length ? { legend } : {}),
    ...(focus ? { focus } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}



/** quadrant：2×2，四格各自有标题（顺序：左上、右上、左下、右下）。 */
function normalizeQuadrantSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const rawCells = Array.isArray(raw.cells) ? raw.cells : [];
  if (rawCells.length < 4) return null;
  const cells: Array<Record<string, unknown>> = [];
  for (const item of rawCells.slice(0, 4)) {
    if (!item || typeof item !== 'object') return null;
    const cell = item as Record<string, unknown>;
    const title = toFigureLabel(cell.title, SPEC.labelMax);
    if (!title) return null;
    const body = toStringList(cell.body, SPEC.bodyLinesMax, SPEC.bodyLineMax);
    const tone = normalizeTone(cell.tone, ['ok', 'warn', 'neutral', 'muted']) || 'neutral';
    const out: Record<string, unknown> = { title, body, tone };
    const icon = cell.icon;
    if (icon && typeof icon === 'object') {
      const iconRecord = icon as Record<string, unknown>;
      if (iconRecord.kind === 'target') {
        const dots: Array<[number, number]> = [];
        for (const dot of Array.isArray(iconRecord.dots) ? iconRecord.dots : []) {
          if (!Array.isArray(dot) || dot.length < 2) continue;
          const dx = toFiniteNumber(dot[0]);
          const dy = toFiniteNumber(dot[1]);
          if (dx === null || dy === null || Math.abs(dx) > 28 || Math.abs(dy) > 28) continue;
          dots.push([dx, dy]);
          if (dots.length >= SPEC.dotsMax) break;
        }
        out.icon = { kind: 'target', dots };
      }
    }
    cells.push(out);
  }
  const colLabels = toStringList(raw.colLabels, 2, SPEC.labelMax);
  const rowLabels: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.rowLabels) ? raw.rowLabels : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const label = toFigureLabel(entry.label, SPEC.labelMax);
    if (!label) continue;
    const sub = toFigureText(entry.sub, SPEC.subMax);
    rowLabels.push({ label, ...(sub ? { sub } : {}) });
    if (rowLabels.length >= 2) break;
  }
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  return {
    cells,
    ...(colLabels.length ? { colLabels } : {}),
    ...(rowLabels.length ? { rowLabels } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

function normalizeBipartiteSide(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const side = value as Record<string, unknown>;
  const nodes: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(side.nodes) ? side.nodes : []) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    const id = toFigureLabel(node.id, 24);
    const label = toFigureLabel(node.label, SPEC.labelMax);
    if (!id || !label) continue;
    const tone = normalizeTone(node.tone, ['accent', 'ok', 'warn', 'neutral']);
    nodes.push({ id, label, ...(tone ? { tone } : {}) });
    if (nodes.length >= SPEC.nodesMax) break;
  }
  if (!nodes.length) return null;
  const head = toFigureText(side.head, SPEC.subMax);
  return { nodes, ...(head ? { head } : {}) };
}

/** bipartite：左右两列 + 连线（多对多映射；连线交叉本身就是信息）。 */
function normalizeBipartiteSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const left = normalizeBipartiteSide(raw.left);
  const right = normalizeBipartiteSide(raw.right);
  if (!left || !right) return null;
  const leftIds = new Set((left.nodes as Array<Record<string, unknown>>).map((n) => String(n.id)));
  const rightIds = new Set((right.nodes as Array<Record<string, unknown>>).map((n) => String(n.id)));
  const edges: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!item || typeof item !== 'object') continue;
    const edge = item as Record<string, unknown>;
    const from = toFigureLabel(edge.from, 24);
    const to = toFigureLabel(edge.to, 24);
    if (!from || !to) continue;
    // 允许模型把方向写反：只要一端在左、另一端在右就接受
    const forward = leftIds.has(from) && rightIds.has(to);
    const backward = rightIds.has(from) && leftIds.has(to);
    if (!forward && !backward) continue;
    const tone = normalizeTone(edge.tone, ['accent', 'ok', 'warn', 'neutral']);
    const dash = normalizeDash(edge.dash);
    edges.push({ from, to, ...(tone ? { tone } : {}), ...(dash ? { dash } : {}) });
    if (edges.length >= SPEC.edgesMax) break;
  }
  if (!edges.length) return null;
  // 没有任何连线的节点是孤岛：外审 #7/#8/#13/#14 四张二分图里，右列内层列表全悬着，
  // 学生最该看到的"两个槽位共用同一个内层"一条线都没画。连线才是这类图的信息，孤岛一律剪掉；
  // 剪完某一侧空了就没有对照关系，整张作废。
  const used = new Set<string>();
  for (const e of edges) {
    used.add(String(e.from));
    used.add(String(e.to));
  }
  const pruneSide = (side: Record<string, unknown>) =>
    (side.nodes as Array<Record<string, unknown>>).filter((n) => used.has(String(n.id)));
  const leftKept = pruneSide(left);
  const rightKept = pruneSide(right);
  if (!leftKept.length || !rightKept.length) return null;
  left.nodes = leftKept;
  right.nodes = rightKept;
  const title = toFigureText(raw.title, SPEC.titleMax);
  const note = toFigureText(raw.note, SPEC.noteMax);
  const width = toBoundedInt(raw.width, 520, 720) || 640;
  // focus：只保留两端都存在的节点 id（最多 4 个），避免模型给出不存在的 id 让渲染器画空环
  const knownIds = new Set([
    ...(left.nodes as Array<Record<string, unknown>>).map((n) => String(n.id)),
    ...(right.nodes as Array<Record<string, unknown>>).map((n) => String(n.id)),
  ]);
  const focus: string[] = [];
  for (const item of Array.isArray(raw.focus) ? raw.focus : []) {
    const id = toFigureLabel(item, 24);
    if (!id || !knownIds.has(id) || focus.includes(id)) continue;
    focus.push(id);
    if (focus.length >= 4) break;
  }
  return {
    left,
    right,
    edges,
    width,
    ...(focus.length ? { focus } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
  };
}

function normalizeBoardPoint(value: unknown): { col: number; rank: number } | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  const col = toBoundedInt(point.col, 0, 8);
  const rank = toBoundedInt(point.rank, 0, 9);
  if (col === null || rank === null) return null;
  return { col, rank };
}

/** board：中国象棋（9 列 × 10 行）；坐标由模型给，越界即丢。 */
function normalizeBoardSpec(raw: Record<string, unknown>): Record<string, unknown> | null {
  const pieces: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.pieces) ? raw.pieces : []) {
    if (!item || typeof item !== 'object') continue;
    const piece = item as Record<string, unknown>;
    const point = normalizeBoardPoint(piece);
    const key = typeof piece.key === 'string' ? piece.key.trim() : '';
    if (!point || !BOARD_KEYS.has(key)) continue;
    const hl = normalizeTone(piece.hl, ['accent', 'warn']);
    pieces.push({ ...point, key, ...(hl ? { hl } : {}) });
    if (pieces.length >= SPEC.piecesMax) break;
  }
  if (pieces.length < 2) return null;

  const files: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.files) ? raw.files : []) {
    if (!item || typeof item !== 'object') continue;
    const file = item as Record<string, unknown>;
    const col = toBoundedInt(file.col, 0, 8);
    if (col === null) continue;
    const label = toFigureText(file.label, 10);
    const tone = normalizeTone(file.tone, ['accent', 'warn', 'ok']);
    files.push({ col, ...(label ? { label } : {}), ...(tone ? { tone } : {}) });
    if (files.length >= SPEC.filesMax) break;
  }

  const arrows: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.arrows) ? raw.arrows : []) {
    if (!item || typeof item !== 'object') continue;
    const arrow = item as Record<string, unknown>;
    const label = toFigureText(arrow.label, 10);
    const tone = normalizeTone(arrow.tone, ['accent', 'warn', 'ok']);
    const dash = normalizeDash(arrow.dash);
    const common = { ...(label ? { label } : {}), ...(tone ? { tone } : {}), ...(dash ? { dash } : {}) };
    const a1 = normalizeBoardPoint(arrow.a1);
    const a2 = normalizeBoardPoint(arrow.a2);
    if (a1 && a2) {
      arrows.push({ a1, a2, ...common });
    } else {
      const col = toBoundedInt(arrow.col, 0, 8);
      const from = toBoundedInt(arrow.from, 0, 9);
      const to = toBoundedInt(arrow.to, 0, 9);
      if (col === null || from === null || to === null || from === to) continue;
      arrows.push({ col, from, to, ...common });
    }
    if (arrows.length >= SPEC.arrowsMax) break;
  }

  const marks: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(raw.marks) ? raw.marks : []) {
    const point = normalizeBoardPoint(item);
    if (!point) continue;
    const color = normalizeHex((item as Record<string, unknown>)?.color);
    marks.push({ ...point, ...(color ? { color } : {}) });
    if (marks.length >= SPEC.arrowsMax) break;
  }

  const title = toFigureText(raw.title, SPEC.titleMax);
  const panelLabel = toFigureText(raw.panelLabel, 12);
  const note = toFigureText(raw.note, SPEC.noteMax);
  const size = toBoundedInt(raw.size, 38, 56) || 46;
  return {
    pieces,
    size,
    ...(files.length ? { files } : {}),
    ...(arrows.length ? { arrows } : {}),
    ...(marks.length ? { marks } : {}),
    ...(title ? { title } : {}),
    ...(panelLabel ? { panelLabel } : {}),
    ...(note ? { note } : {}),
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

/* ─────────────── 检查点出口内容正确性筛查（第二刀，2026-10-08） ───────────────
 * 宽域 A 轨 3/10 课 P0 的**可确定性检出**形态扩到检查点出口：
 * ① 题面/选项算式复算（findArithmeticMismatches）——带错题放行会让学生长期记住错误算式，
 *   伤害大于本轮回退为不出题（与「绝不阻塞课堂」纪律一致：丢检查点，课堂照常）；
 * ② 简答答案键泄漏（filterAnswerLeakingKeywords）——判分口径（normalizeForKeywordMatch
 *   + 同义组任一写法包含即命中）下，要点写法出现在作答前可见文本（题干/选项/hint/reply）里
 *   = 照抄即可骗过代码裁决（全量测试报告 14/15 号结论的病根），该要点剔除；全空则降级为
 *   无标准键（expectedKeywords 整字段省略 → judgeCheckpointAnswer 返回 null → model-reference）。
 * 豁免：考点即概念名（每个写法归一后都等于当前教学点名）——「说出概念名」型简答的合法形态。
 */

/** 题面与每个选项文本的算式复算（纯函数，供单测）；命中清单按出现顺序返回 */
export function findCheckpointArithmeticMismatches(
  question: string,
  options?: Array<{ id: string; text: string }>,
): ArithmeticMismatch[] {
  return [
    ...findArithmeticMismatches(question),
    ...(options ?? []).flatMap((option) => findArithmeticMismatches(option?.text)),
  ];
}

export interface AnswerKeywordLeakScreen {
  /** 泄漏剔除后仍保留的要点（原始写法，含「|」同义组） */
  keptKeywords: string[];
  /** 命中泄漏被剔除的要点（原始写法，供遥测/日志复核） */
  leakedKeywords: string[];
}

/**
 * 简答答案键泄漏检测（纯函数，供单测）。
 *
 * 口径与判分（judgeCheckpointAnswer）严格同源：要点按「|」拆同义组、normalizeForKeywordMatch
 * 归一后做包含判定。**任一**写法出现在**任一**可见文本里 → 整个要点（同义组）剔除——
 * 判分是「组内任一写法出现即满足」，学生照抄可见文本即可命中该组，留着等于白送。
 */
export function filterAnswerLeakingKeywords(params: {
  expectedKeywords: string[];
  /** 作答前学生可见文本：question / options 文本 / hint / 本轮 reply */
  visibleTexts: Array<string | null | undefined>;
  /** 检查点归属概念名（当前教学点名）：考点即概念名时豁免 */
  conceptName?: string | null;
}): AnswerKeywordLeakScreen {
  const concept = normalizeForKeywordMatch(params.conceptName);
  const haystacks = (params.visibleTexts || [])
    .map((text) => normalizeForKeywordMatch(text))
    .filter(Boolean);
  const keptKeywords: string[] = [];
  const leakedKeywords: string[] = [];
  for (const keyword of params.expectedKeywords || []) {
    const raw = String(keyword ?? '').trim();
    if (!raw) continue;
    const alternatives = raw
      .split(/[|｜]/)
      .map(normalizeForKeywordMatch)
      .filter(Boolean);
    if (alternatives.length === 0) {
      keptKeywords.push(raw);
      continue;
    }
    // 概念名豁免（严格版）：每个写法都必须就是概念名本身——「简答要求说出概念名」的
    // 合法形态，题干/回复提到被考查的概念属正当行为，不得按泄漏误杀。
    if (concept && alternatives.every((alt) => alt === concept)) {
      keptKeywords.push(raw);
      continue;
    }
    const leaked = haystacks.some((haystack) => alternatives.some((alt) => haystack.includes(alt)));
    (leaked ? leakedKeywords : keptKeywords).push(raw);
  }
  return { keptKeywords, leakedKeywords };
}

type NormalizedCheckpoint = NonNullable<TeachingTurnOutput['control']['checkpoint']>;

/**
 * 检查点出口筛查接线（normalizeOutput 调用；遥测只打标、不阻塞——最坏情况本轮回退为不出题）。
 * 返回 null = 丢弃检查点（本轮不出题）。
 */
export function screenCheckpointOutput(
  value: Record<string, any>,
  reply: string,
  conceptName?: string | null,
): NormalizedCheckpoint | null {
  const checkpoint = normalizeCheckpoint(value);
  const arithmetic = findCheckpointArithmeticMismatches(checkpoint.question, checkpoint.options);
  if (arithmetic.length > 0) {
    logger.warn('[TeachingTurnAgent] 检查点题面/选项算式复算不匹配，丢弃检查点（本轮回退为不出题）', {
      mismatches: arithmetic.map((m) => m.expr),
    });
    recordDegradation({
      source: 'ai-teaching/teaching-turn-checkpoint',
      faultCategory: 'MODEL_ARITHMETIC_MISMATCH',
      severity: 'P2_DEGRADED',
      impactedDimensions: ['checkpoint.question', 'checkpoint.options'],
      mitigationApplied: 'drop-checkpoint-skip-question-this-turn',
      rootCauseMessage: arithmetic.map((m) => m.expr).join('; '),
    });
    return null;
  }
  const keywords = checkpoint.expectedKeywords;
  if (keywords && keywords.length > 0) {
    const { keptKeywords, leakedKeywords } = filterAnswerLeakingKeywords({
      expectedKeywords: keywords,
      visibleTexts: [
        checkpoint.question,
        ...(checkpoint.options ?? []).map((option) => option.text),
        checkpoint.hint,
        reply,
      ],
      conceptName,
    });
    if (leakedKeywords.length > 0) {
      logger.warn('[TeachingTurnAgent] 简答答案键要点泄漏到学生可见文本，已剔除', {
        leaked: leakedKeywords,
        kept: keptKeywords,
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-checkpoint',
        faultCategory: 'MODEL_ANSWER_LEAK',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['checkpoint.expectedKeywords'],
        mitigationApplied: keptKeywords.length > 0 ? 'strip-leaked-keywords' : 'drop-answer-key-model-reference',
        rootCauseMessage: leakedKeywords.join('; '),
      });
      if (keptKeywords.length === 0) {
        // 全空 → 无标准键形态：expectedKeywords 整字段省略（judgeCheckpointAnswer 对
        // 无键返回 null → 调用方标 judgedBy='model-reference'，不冒充独立传感器）
        const { expectedKeywords: _dropped, ...withoutKey } = checkpoint;
        void _dropped;
        return withoutKey;
      }
      return { ...checkpoint, expectedKeywords: keptKeywords };
    }
  }
  return checkpoint;
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

/**
 * 归一化回合级知识状态估计（θ−d 路由信号）：数值钳制、推荐值白名单、kcId 透传。
 * kcId 是**稳定身份键**（可选）：原样保留（去空白/限长），不做任何按名字推断的补写——
 * 模型没回填就没有，写入侧回落自由文本名（见 memory-trace.service resolveConceptIdSafe）。
 */
function normalizeKtEstimate(value: any): { ktEstimate?: NonNullable<TeachingTurnOutput['analysis']['ktEstimate']> } {
  if (!value || typeof value !== 'object') return {};
  const conceptMastery = Array.isArray(value.conceptMastery)
    ? value.conceptMastery
        .filter((item: any) => item && typeof item?.conceptKey === 'string' && item.conceptKey.trim())
        .slice(0, 5)
        .map((item: any) => ({
          conceptKey: String(item.conceptKey).trim().slice(0, 120),
          ...(normalizeKcId(item.kcId) ? { kcId: normalizeKcId(item.kcId)! } : {}),
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

/** 单次教学回合请求里随历史回流的课堂配图上限（更早的图退化为文本） */
const MAX_HISTORY_IMAGES_PER_REQUEST = 4;

/**
 * 收集历史消息随带的课堂配图（2026-10-18 #123 视觉）：从最近的消息往回数，
 * 超过 `MAX_HISTORY_IMAGES_PER_REQUEST` 的旧图不再进请求（文本保留）。
 *
 * 为什么**不把图挂在历史 assistant 消息上**（最初的实现，实测证伪）：
 * 平台上游 zoujian 网关对 `role:'assistant'` 消息里的 image_url 内容块返回
 * 400 invalid_request（先挂起 100+s 再 400；`npm run vision:probe -- --history-image` 可复现），
 * 而挂在 user 消息上的图片块正常（`vision:probe` 两种模式对照）。因此本链改为：
 * 历史消息保持纯文本，历史配图统一附加到**本轮 user 消息**尾部（见 buildTeachingTurnMessages）。
 */
export function collectHistoryImages(messages: TeachingTurnInput['messages']): TeachingTurnMessageImage[] {
  const source = Array.isArray(messages) ? messages : [];
  const collected: TeachingTurnMessageImage[] = [];
  let budget = MAX_HISTORY_IMAGES_PER_REQUEST;
  for (let index = source.length - 1; index >= 0 && budget > 0; index -= 1) {
    const images = Array.isArray(source[index]?.images) ? source[index].images!.filter((image) => image?.url) : [];
    if (images.length === 0) continue;
    const kept = images.slice(-budget);
    collected.unshift(...kept);
    budget -= kept.length;
  }
  return collected;
}

/**

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
  // 规则 74 原文写「若输入提供 behavioralProfile」（抽键得顶层 `behavioralProfile`），但字段的**装配位置**
  // 是 `scenario.behavioralProfile`（teaching-turn-shared.ts 组 scenario 时在该键下）——缺这条覆盖时
  // hasPathValue 走顶层恒 false，规则被静默剥离，模型看不到"怎么用行为投影"（2026-10-17 实测）。
  behavioralProfile: (input) => {
    const v = input?.scenario?.behavioralProfile;
    return v != null && typeof v === 'object' && Object.keys(v as object).length > 0;
  },
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
}): Array<{ role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }> {
  // 历史外移为真 message（前缀缓存修正，2026-09-25）；形态保持纯文本（判据与缓存前缀都不动）。
  const wire = toWireMessages(args.input.messages);
  const history = wire.map((message) => ({
    role: (message.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: message.content,
  }));
  // 历史配图（#123）：统一附加到**本轮 user 消息**尾部（上游拒收 assistant 消息里的 image_url 块，
  // 见 collectHistoryImages 注释）；无图时 userContent 与改动前逐字节一致。
  const historyImages = collectHistoryImages(args.input.messages);
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

  // 历史配图归属声明（#123）：图只能挂在 user 消息上（上游拒收 assistant 里的 image_url），
  // 但实测（带图/不带图双组对照）模型会把 user 回合里的图读成"学生本轮发来的内容"，
  // 进而以"我没画过这张图"拒绝引用。归属由指令层定死，不靠模型自推。
  if (historyImages.length > 0) {
    systemContent = `${systemContent}\n\n【课堂配图说明】本轮用户消息里附有你（老师）此前发给学生的板书图`
      + '（属于课堂状态数据，不是学生本轮发来的内容）。你可以且应当直接引用图里的信息（布局、行列、颜色、宽窄等）；'
      + '不要说"我看不到图/没有图/我没画过图"。';
  }

  return [
    { role: 'system', content: systemContent },
    ...history,
    {
      role: 'user',
      content: buildUserMessageContent({ userContent, historyImages, suffix }),
    },
  ];
}

/**
 * 本轮 user 消息内容（#123）：
 * - 无历史配图 → 纯文本（`userContent` 与改动前逐字节一致，请求形态与缓存前缀都不动）；
 * - 有历史配图 → 内容块数组，**顺序为 [载荷文本, 配图标签, 图片块…, 输出契约尾]**：
 *   图片紧贴载荷（属于「课堂状态数据」的一部分）而不是落在输出契约之后——契约尾必须保持
 *   离输出最近（模型把它当"这是结构化任务"的最后一道信号；实测图放尾部会让模型把图误当成
 *   学生本轮发来的东西，出现「我没画过这张图」的错角色归因）。
 */
function buildUserMessageContent(args: {
  userContent: string;
  historyImages: TeachingTurnMessageImage[];
  suffix: string;
}): ChatMessageContent {
  if (args.historyImages.length === 0) return args.userContent;
  // userContent 此时可能已含 suffix（旧形状兜底路径）——先剥离，重新按 [载荷][图][契约尾] 组装
  const payloadText = args.suffix && args.userContent.endsWith(args.suffix)
    ? args.userContent.slice(0, -args.suffix.length)
    : args.userContent;
  const withImages = buildVisionContent(payloadText, args.historyImages, {
    label: '课堂配图：你（老师）上一轮发给学生的板书图',
    context: 'teaching-turn/history',
  });
  if (!Array.isArray(withImages)) return withImages;
  return [...withImages, { type: 'text', text: args.suffix }];
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
