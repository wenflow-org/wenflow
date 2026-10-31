import type { TeachingKnowledgePointState, TeachingSessionRecord } from './TeachingSessionRepository';
import type { PromptMaterial } from '../materials/material-prompt-projection';
import type { ActiveTaskMaterialExcerpt } from '../materials/material-sections';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import type { ReviewPlan } from '../memory/review-plan.service';
export interface TeachingScenarioContext {
  userId: string;
  taskId: string;
  learningPathId: string;
  milestoneId: string;
  subject: string;
  topic: string;
  taskTitle: string;
  taskDescription: string;
  taskType: 'reading' | 'practice' | 'project' | 'quiz' | 'acquire' | 'deconstruct' | 'model' | 'execute' | 'diagnose' | 'refine' | 'consolidate';
  taskKnowledgeScope: {
    primaryConcepts: string[];
    prerequisiteConcepts: string[];
    supportingConcepts: string[];
  };
  /** 本课细粒度知识组件（kc-mapper 产出，含 kcId）：教学提示词按 KC 粒度对齐 knowledge.points 的依据 */
  taskKcs: Array<{ kcId: string; name: string; taxonomy: string }>;
  taskKnowledgeSeeds: TeachingKnowledgePointState[];
  taskProfile: {
    knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
    cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
    displayLabel: string | null;
    learningObjectives: string[];
    coreConcept: string | null;
    linkedConceptId: string | null;
    linkedConceptName: string | null;
  };
  currentTaskContext: {
    description: string | null;
    acceptanceCriteria: string | null;
  };
  teachingStrategyGuidance: {
    knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
    cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
    objectiveFocus: string[];
    coreConcept: string | null;
    explanationStyle: string;
    interactionPattern: string;
    targetDepth: string;
    preferredStrategies: string[];
    responseConstraints: string[];
  };
  cognitiveFrame: {
    currentCoreConcept: {
      id: string | null;
      name: string | null;
      description: string | null;
    };
    prerequisiteConcepts: string[];
    neighboringConcepts: string[];
    targetRelation: string | null;
    milestoneIntent: string | null;
    transferGoal: string | null;
  };
  canStartLearning: boolean;
  learningBlockedReason: string | null;
  pathProgress: {
    pathTitle: string;
    pathSummary: string | null;
    currentMilestoneTitle: string;
    currentStageNumber: number;
    currentTaskOrder: number;
    totalTasksInMilestone: number;
  };
  /** 学校体系锚（2026-09-30）：教材版本/考纲/在校进度。数据在 goal 提取的 learnerProfile 自由文本里，
   *  此前教学层从不读取（实测 64 回合 0 引用）——见 resolveSchoolAnchorForTeaching。 */
  schoolAnchor: {
    /** 学习者背景句（含教材版本与考试形式，如「使用统编版教材，考试为新高考卷题型」） */
    background: string | null;
    /** 现状自评证据句（如「同济版教材，期末闭卷」「算会算，就是不知道为啥」） */
    baselineEvidence: string | null;
  };
  /** goal 阶段产出的学习者画像摘要（叙述性理解，随 profile 持久化），供开场等场景贴合「在教谁」。
   *  无 goal 对话数据时为 null——消费方按缺省处理，不得编造背景。sourceGoal 记录画像出处目标
   *  （画像按目标一条，跨目标并集会串味），供读侧防误读、不进学生可见文案。 */
  learnerPersona?: {
    surfaceGoal: string | null;
    realProblem: string | null;
    background: string | null;
    currentLevel: string | null;
    motivation: string | null;
    sourceGoal: string | null;
  } | null;
  learningState: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  } | null;
  learnerProjection: TeachingLearnerProjection;
  /**
   * 延迟锚题（Q8）专用：**全量**已掌握概念的 lastSeenAt（键为 conceptKey/label），
   * 由权威账本 `conceptLedger` 派生、**不经 `recentConceptLedger.slice(0, 12)` 截断**。
   * 只供 `resolveAnchorProbeTarget` 消费，**不注入 LLM 提示词**（`buildTeachingTurnInput` 不转发本字段）。
   */
  anchorMasteredLastSeenAt: Record<string, string>;
  pathContext: {
    pathTitle?: string;
    pathSummary?: string | null;
    subject?: string | null;
  };
  /**
   * 该路径关联的资料（用户附件在前、联网采集在后）——**投影后的最小集合**。
   * 课堂上用于"引用资料原文/章节"（不得编造资料里没有的内容）；无资料时为 null。
   */
  materials: PromptMaterial[] | null;
  /**
   * 当前任务 materialRefs 的**章节原文窗口**（material-sections 取回，≤2 份 × ≤4K 字，2026-09-24）。
   * 「讲到哪章就能看到那章原文」；无引用/取回失败时为 null（不出现该键，行为不变）。
   */
  activeTaskMaterialExcerpts?: ActiveTaskMaterialExcerpt[] | null;
  previousSession?: {
    sessionId: string;
    messages: TeachingSessionRecord['messages'];
    knowledgePoints: TeachingSessionRecord['knowledgeState'];
  } | null;
  /** 学习者在 goal 阶段自然流露的交付形式偏好（learning_signal），供开场/教学兑现承诺 */
  learningSignal: string | null;
  /** 同一路径上前序课程的摘要，供跨节承接（"老师记得我"）。
   *  源选择按路径位置：同阶段前一任务 → 上一阶段 → 同任务历史 → 最近任意完成课 */
  lastLessonRecap: {
    sourceTopic: string | null;
    topicSummary: string | null;
    retrievalCue: string | null;
    unresolvedPoints: string[];
    /** 与当前课的位置关系，供 LLM/UI 判断怎么承接 */
    relation: 'same-milestone-prev-task' | 'prev-milestone' | 'same-task' | 'last-any';
    /** 来源课所在阶段号/标题（null = 不可得） */
    sourceStageNumber?: number | null;
    sourceMilestoneTitle?: string | null;
    sourceTaskTitle?: string | null;
    /** 同任务历史：当前任务自己学过的上一轮（用于"同任务重学接续自己的历史"） */
    sameTaskHistory?: {
      attemptCount: number;
      lastStatus: string;
      lastEndTime: string | null;
      lastSummary: string | null;
      lastUnresolvedPoints: string[];
      lastActionPlan: string[];
    } | null;
  } | null;
  /**
   * 真实侧时间信号（跨会话"时间维度"）：距上一节相关课程结束的间隔。
   * 无前序会话（或缺 endTime）时为 null——调用方应省略该字段，行为与改造前一致。
   * 消费方：AITeachingCoordinator 注入 `controls.temporalGap`，提示词据此对长间隔回归更保守。
   */
  temporalGap: TeachingTemporalGap | null;
  /** 结构化前序学习上下文（供开场 UI/承接叙事消费，lastLessonRecap 的富化版） */
  priorLearningContext: {
    hasPriorLearning: boolean;
    /** 紧邻前序（位置接续） */
    adjacent?: {
      relation: 'same-milestone-prev-task' | 'prev-milestone';
      stageNumber: number;
      milestoneTitle: string;
      taskTitle: string;
      topicSummary: string | null;
      retrievalCue: string | null;
      unresolvedPoints: string[];
      actionPlan: string[];
      newlyMastered: string[];
      stillLearning: string[];
    } | null;
    /** 当前任务自己的历史 */
    sameTask?: {
      attemptCount: number;
      lastStatus: string;
      lastSummary: string | null;
      lastUnresolved: string[];
      lastActionPlan: string[];
      lastEndTime: string | null;
    } | null;
    /** 前序阶段总体掌握（milestoneProgress 汇总） */
    priorMilestoneMastery: Array<{
      stageNumber: number;
      title: string;
      masteryState: 'unknown' | 'partial' | 'stable' | 'at-risk';
      completedTasks: number;
      totalTasks: number;
    }>;
  } | null;
  /**
   * 交互特征情报（认知负荷量测 · 前端情报层）：
   * 本轮学生输入的打字节奏统计 + 近 5 轮学生消息特征对比，缺失字段为 undefined（absent）。
   * 仅供 LLM 结合文本语义判断 loadIndex，不参与任何规则计算。
   */
  interactionProfile: {
    current: InteractionMetaRecord | null;
    history: InteractionHistoryEntry[];
    absent: boolean;
  } | null;
  /**
   * 学习表现预测（任务前，learning-predictor 产出 + 校准实证可靠性）。
   * 超时/失败/低样本时为 null——教学照常，不得因预测缺失改变行为。
   */
  learnerPrediction: LearnerPredictionContext | null;
  /** 历史误解（G-R-R Phase 2）：当前任务相关概念的活跃误解，供教学回合引用（"你上次在这里犯过类似的错"） */
  priorMisconceptions: Array<{
    conceptKey: string;
    hypothesis: string;
    canonicalLabel: string | null;
    confidence: number;
    status: string;
    occurrenceCount: number;
  }> | null;
  /**
   * 学习笔记：诊断洞察（LLM 出的"为什么卡"，已剔除被证伪的 claim）。
   * 与 learningState / learnerProjection 一样属于**只读参考**：与课堂实况冲突时以实况为准，
   * 且不得在 reply 里向学生复述这些内部诊断。
   */
  learnerInsights?: Array<{ type: string; claim: string; action: string }> | null;
  /** 任务模式：normal（默认教学）| productiveFailure（有效失败：先让学生挣扎，后整合） */
  taskMode?: 'normal' | 'productiveFailure';
  /**
   * 课内温故计划（记忆层出口）：把快到遗忘点的旧知放进**本节开头**回捞，
   * 而不是让用户额外开一节复习课（依从性：复习不需要用户做决定）。
   * 与 knowledgeState（本节知识点看板）**物理分离**——跨 path 的到期点不得混进本节清单
   * （历史事故：`2e3ca16` 因到期点串进看板被误显示为「进行中 · x%」而整体下线该机制）。
   * 为空表示本节没有到期旧知。
   */
  memoryWarmup?: ReviewPlan | null;
  /** 行为投影器（LLM-KT Behavioral Dynamics Projector）：近期回合级行为动态压缩 */
  behavioralProfile: {
    avgUnderstanding: number | null;
    avgLoadIndex: number | null;
    avgEngagement: number | null;
    dominantEmotion: string | null;
    frustrationRate: number | null;
    knowledgeMasteryEma: number | null;
    sampleSize: number;
    /** 求助行为（2026-09-17 起被消费）：最近几轮的求助原话，供提示词做软拦截（别直接给答案） */
    recentHelpSeeking?: string[];
    /** 求助次数（窗口内），用于判断"是不是在反复要答案" */
    helpSeekingCount?: number;
  } | null;
}

/** 预测上下文（P2 闭环：预测 + 实证可靠性一起交给教学 Agent） */
export interface LearnerPredictionContext {
  stallRisk: number;
  predictedTone: 'smooth' | 'struggle' | 'fatigue';
  suggestedDepth: 'shallow' | 'standard' | 'deep';
  focusConcepts: string[];
  rationale: string;
  /** 实证可靠性（来自校准记录，不是 LLM 自报）；样本不足（<5）为 null */
  reliability: { total: number; stallHitRate: number | null } | null;
}

/**
 * 前端交互特征（认知负荷量测）：前端在输入框聚合的统计值，随消息提交。
 * 全部为可选数值；缺失字段在 prompt 层按 absent 处理。
 */
export interface InteractionMetaRecord {
  draftMs?: number;
  idleMsBefore?: number;
  lastIdleMs?: number;
  editingCount?: number;
  deleteCount?: number;
  charsPerSentence?: number;
}

/** 近轮消息的交互特征对比条目（供 LLM 判断相对异动，替代统计基线） */
export interface InteractionHistoryEntry {
  role: 'user' | 'assistant';
  timestamp: string;
  meta?: InteractionMetaRecord | null;
  textLength: number;
}


export interface TeachingTemporalGap {
  /** 距上一节相关课程结束的天数（保留 1 位小数） */
  daysSinceLastSession: number;
  /** 是否达到长间隔阈值（`>= thresholdDays`） */
  isLongGap: boolean;
}

