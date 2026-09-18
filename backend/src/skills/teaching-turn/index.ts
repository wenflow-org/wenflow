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
  };
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
function normalizeOutput(parsed: Record<string, any>, input: TeachingTurnInput): TeachingTurnOutput {
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : '我们继续沿着这个主题往下学。';

  const analysis = parsed.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : {};
  const knowledge = parsed.knowledge && typeof parsed.knowledge === 'object' ? parsed.knowledge : {};
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
      ...(normalizeMisconceptions(analysis.misconceptions)),
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
    },
  };
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

/** 归一化结构化误解台账（G-R-R Phase 1）：过滤缺证据项，置信度收敛到 0|25|50|75|100 五档 */
function normalizeMisconceptions(value: any): { misconceptions?: NonNullable<TeachingTurnOutput['analysis']['misconceptions']> } {  if (!Array.isArray(value) || value.length === 0) return {};
  const items = value
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

function buildPromptInput(input: TeachingTurnInput) {
  const strategyGuidancePrompt = buildStrategyGuidancePrompt(input);
  const taskExecutionPrompt = buildTaskExecutionPrompt(input);

  // KV 前缀缓存友好化：scenario 内动态子键（contextCompression/interactionProfile）挪到尾部，
  // 稳定主体（任务/路径/策略上下文）保持前置，最大化 user 内前缀命中
  const { interactionProfile: scenarioInteractionProfile, contextCompression: scenarioCompression, ...stableScenario } = input.scenario;

  const promptDirectives = {
    ...(strategyGuidancePrompt ? { strategyGuidance: strategyGuidancePrompt } : {}),
    taskExecution: taskExecutionPrompt,
  };
  const latestLearnerMessage = [...input.messages].reverse().find((message) => message.role === 'user')?.content || '';

  // 试飞改造（默认启用；PAYLOAD_STABLE_PREFIX=0 回退旧序）：
  // 真实遥测显示 scenario 每回合必变（因子键 interactionProfile/contextCompression 逐回合变化），
  // 前缀在 promptDirectives 之后的 knowledge 处即断（~7.3k/15.8k）。
  // 稳定前缀版：scenario(洁) → promptDirectives → learner 前置，其余逐回合变化的键全部后置。
  // 对话上下文单键化：原 visibleDialogueContext / recentDialogueContext 同源重复，收敛为 messages
  // （与 core 输入名一致；沙盘 ref sandbox:teaching.session.messages）。
  if (process.env.PAYLOAD_STABLE_PREFIX !== '0') {
    return {
      scenario: stableScenario,
      promptDirectives,
      learner: input.learner,
      // —— 以下为逐回合变化项，统一后置 ——
      controls: input.controls,
      knowledge: input.knowledge,
      classroomContext: input.classroomContext,
      classroomEventContext: input.classroomEventContext,
      interactionProfile: scenarioInteractionProfile ?? null,
      ...(scenarioCompression ? { contextCompression: scenarioCompression } : {}),
      messages: toWireMessages(input.messages),
      latestLearnerMessage,
      ...(input._analysisStage ? { analysisStage: input._analysisStage } : {}),
    };
  }

  return {
    scenario: {
      ...stableScenario,
      ...(scenarioCompression ? { contextCompression: scenarioCompression } : {}),
      interactionProfile: scenarioInteractionProfile,
    },
    promptDirectives,
    knowledge: input.knowledge,
    learner: input.learner,
    controls: input.controls,
    classroomContext: input.classroomContext,
    classroomEventContext: input.classroomEventContext,
    interactionProfile: scenarioInteractionProfile ?? null,
    messages: toWireMessages(input.messages),
    latestLearnerMessage,
    // 双引擎试点：第一段（推理模型）产出的 analysis 作为第二段的既定认知判定
    ...(input._analysisStage ? { analysisStage: input._analysisStage } : {}),
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

  if (!parsed.analysis || typeof parsed.analysis !== 'object' || !parsed.knowledge || typeof parsed.knowledge !== 'object' || !parsed.pedagogy || typeof parsed.pedagogy !== 'object' || !parsed.control || typeof parsed.control !== 'object') {
    return { valid: false, failureReason: 'TEACHING_TURN_REQUIRED_BLOCK_MISSING' };
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  const rawCompletionCandidate = parsed.control?.isCompletionCandidate === true;
  // 2026-08-30：完成一致性校验不再使用关键词硬匹配（evaluateByCriteria/evaluateByProfile），
  // 改为 LLM 语义判定 + 知识硬门禁：模型说完成 + 知识点全 mastered 才允许宣布完成。
  const rawPoints = Array.isArray(parsed.knowledge?.points) ? parsed.knowledge.points : [];
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

const teachingTurnPromptSpec: PromptCallSpec<TeachingTurnInput, TeachingTurnOutput> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: TEACHING_TURN_PROMPT,
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'teaching-turn',
  },
  buildUserPayload: (input) => buildPromptInput(input),
  normalizeOutput: (parsed, input) => normalizeOutput(parsed, input),
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
    onValidationFail: ({ failureReason }) => `上一次输出未通过校验，原因是：${failureReason}。请重新输出一个严格 JSON，特别注意：1) knowledge.points 要围绕当前任务、验收标准和最近课堂对话动态生成，不要偏题；2) pedagogy.strategies 只能使用允许的枚举；3) 保持当前任务的 core concept 与 target relation 不偏移。`,
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
