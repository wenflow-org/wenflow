import prisma from '../../config/database';
import learningStateService from '../learning/learning-state.service';
import { getSceneFramingNormalizedInput, resolveNormalizedInputSnapshot, resolvePersistedNormalizedInput } from '../learning/learning.helpers';
import { extractPromptMaterials, TEACHING_MATERIAL_LIMITS, type PromptMaterial } from '../materials/material-prompt-projection';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { teachingStrategyConfig } from '../../config/pedagogy.config';
import type { TeachingKnowledgePointState, TeachingSessionRecord } from './TeachingSessionRepository';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { decideTaskDifficulty, resolveBaselineLevel } from '../learner/TaskDifficultyAdjustmentService';
import { resolveSuccessBandVerdict } from '../learner/independent-success-band.service';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { executeSkill } from '../../skills';
import { learningPredictorDefinition, type LearningPredictorOutput } from '../../skills/learning-predictor';
import { predictionCalibrationService } from '../learner/PredictionCalibrationService';
import { getActiveForConcepts } from '../learner/misconception-ledger.service';
import type { ReviewPlan } from '../memory/review-plan.service';
import { buildMasteredLastSeenAtMap } from './anchor-probe-emit';
import { logger } from '../../utils/logger';
import { conceptRegistryService } from '../learner/concept-registry.service';
import { conceptGraphService, RELATION_PREREQUISITE, RELATION_PART_OF } from '../learner/concept-graph.service';

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

/** 仅提取每条消息中可用的数值特征（meta 中的合法数字字段） */
function extractInteractionMeta(message: { meta?: InteractionMetaRecord | null }): InteractionMetaRecord | null {
  if (!message.meta || typeof message.meta !== 'object') return null;
  const meta: InteractionMetaRecord = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(message.meta)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      (meta as Record<string, number>)[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? meta : null;
}

/** 组装 interactionProfile：本轮特征 + 近 5 轮特征对比（供 LLM 判断相对异动，替代统计基线） */
function buildInteractionProfile(
  interactionMeta: InteractionMetaRecord | null | undefined,
  messages: TeachingSessionRecord['messages']
): TeachingScenarioContext['interactionProfile'] {
  const history: InteractionHistoryEntry[] = [];
  const recent = messages.slice(-6);
  for (const message of recent) {
    history.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      timestamp: message.timestamp,
      meta: extractInteractionMeta(message as { meta?: InteractionMetaRecord | null }),
      textLength: typeof message.content === 'string' ? message.content.length : 0,
    });
  }
  const current = extractInteractionMeta({ meta: interactionMeta ?? null });
  return { current, history, absent: current === null };
}

function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parsePathSummary(raw: string | null | undefined): string | null {
  const parsed = parseJsonSafe(raw);
  const summary = parsed?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
}

function parsePathPromptTemplate(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function dedupeConcepts(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeConcept(value)).filter(Boolean) as string[]));
}

function parsePathPromptTemplateCore(path: any) {
  const promptTemplate = parsePathPromptTemplate(path?.aiPromptTemplate);
  // #9 退役：统一读 cognitiveCore（旧数据需先跑 scripts/migrate-cognitive-core.ts 迁移）
  return promptTemplate?.cognitiveCore || null;
}

/** 从 kcAnnotation.taskKcLinks 解析当前任务的细粒度知识组件（KC）列表（kc-mapper 下游激活 3b） */
function resolveTaskKcsFromPath(task: any, path: any): Array<{ kcId: string; name: string; taxonomy: string }> {
  try {
    const template = path?.aiPromptTemplate ? JSON.parse(path.aiPromptTemplate) : {};
    const kcAnnotation = template?.kcAnnotation;
    if (!kcAnnotation || typeof kcAnnotation !== 'object') return [];
    const taskKcLinks = Array.isArray(kcAnnotation.taskKcLinks) ? kcAnnotation.taskKcLinks : [];
    const matched = taskKcLinks.find((link: any) => normalizeConcept(link?.taskTitle) === normalizeConcept(task?.title));
    // 字段兼容：契约是 linkedKCs，但实测弱模型/漂移模型会写成 kcIds / linkedKcIds / kcs（2026-09-22）。
    // 读取侧归一，避免"落了库但下游解析为空"的静默断链。
    const linkedKcIds = matched
      ? (Array.isArray(matched.linkedKCs) ? matched.linkedKCs
        : Array.isArray(matched.kcIds) ? matched.kcIds
        : Array.isArray(matched.linkedKcIds) ? matched.linkedKcIds
        : Array.isArray(matched.kcs) ? matched.kcs
        : [])
      : [];
    if (!matched || linkedKcIds.length === 0) return [];
    const kcGraphNodes = Array.isArray(kcAnnotation.kcGraph?.nodes) ? kcAnnotation.kcGraph.nodes : [];
    return linkedKcIds.map((kcId: any) => {
      const node = kcGraphNodes.find((n: any) => normalizeConcept(n?.kcId) === normalizeConcept(kcId));
      return {
        kcId: normalizeConcept(kcId) || String(kcId || ''),
        name: normalizeConcept(node?.name) || '',
        taxonomy: normalizeConcept(node?.taxonomy) || '',
      };
    }).filter((item: any) => item.kcId);
  } catch {
    return [];
  }
}

function resolveTaskConceptFromPath(task: any, path: any): { id: string | null; name: string | null; description: string | null } {
  const linkedConceptId = normalizeConcept((task as any).linkedConceptId || (task as any).coreConcept);
  const cognitiveCore = parsePathPromptTemplateCore(path);
  const concepts = Array.isArray(cognitiveCore?.coreConcepts) ? cognitiveCore.coreConcepts : [];

  if (linkedConceptId) {
    const matched = concepts.find((concept: any) => normalizeConcept(concept?.id) === linkedConceptId);
    if (matched) {
      return {
        id: normalizeConcept(matched.id),
        name: normalizeConcept(matched.name),
        description: normalizeConcept(matched.description)
      };
    }
  }

  return {
    id: linkedConceptId,
    name: normalizeConcept((task as any).linkedConceptName) || linkedConceptId,
    description: null
  };
}

/**
 * 取当前概念的 1-hop 图邻居名（L3 接入，best-effort）。
 *
 * 链路：概念名 → 注册表只读解析 canonical → `concept_edges` 1-hop（`direction:'in'` 前置优先）
 * → canonical 标签。任一步不可用（未回填/无图/无邻居）就返回空数组，由调用方回落旧行为。
 * **不创建概念、不写库**（读侧纪律）；失败只 warn，绝不影响开课。
 */
async function fetchGraphNeighbors(params: {
  userId: string;
  pathId: string;
  conceptName: string | null;
  limit?: number;
}): Promise<string[]> {
  const { userId, pathId, conceptName, limit = 3 } = params;
  if (!userId || !conceptName) return [];
  try {
    const resolved = await conceptRegistryService.resolveConcept(userId, conceptName, { createIfMissing: false });
    if (!resolved) return [];
    const neighbors = await conceptGraphService.neighbors(userId, resolved.conceptId, {
      relations: [RELATION_PREREQUISITE, RELATION_PART_OF],
      direction: 'in',
      limit,
      pathId,
    });
    return neighbors.map((item) => item.label).filter((label): label is string => !!label);
  } catch (error) {
    logger.warn('[TeachingContextBuilder] 概念图邻居查询失败（best-effort，回落旧行为）', {
      userId,
      pathId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * 邻域来源优先级（纯函数，导出以便单测）：
 * ① 概念图 1-hop（有语义依据）→ ② 旧行为（取前 3 个其它 coreConcept，任意切片，图缺失时的兜底）。
 */
export function pickNeighboringConcepts(params: {
  graphNeighbors?: string[];
  coreConcepts: any[];
  currentConceptId: string | null;
  currentConceptName: string | null;
}): string[] {
  const { graphNeighbors, coreConcepts, currentConceptId, currentConceptName } = params;
  const graphNeighborList = dedupeConcepts(
    (graphNeighbors ?? [])
      .map((name) => normalizeConcept(name))
      .filter((name): name is string => !!name && name !== currentConceptName)
  );
  if (graphNeighborList.length > 0) return graphNeighborList.slice(0, 3);
  return dedupeConcepts(
    coreConcepts
      .filter((concept: any) => {
        const conceptId = normalizeConcept(concept?.id);
        const conceptName = normalizeConcept(concept?.name);
        if (!conceptId && !conceptName) return false;
        return conceptId !== currentConceptId && conceptName !== currentConceptName;
      })
      .slice(0, 3)
      .map((concept: any) => normalizeConcept(concept?.name))
  );
}

/**
 * 前置概念筛选（纯函数，导出以便单测）。
 *
 * `prerequisiteGaps` 由 `LearnerKnowledgeMemoryService` 按**本任务**的上游闭包算出，故：
 * ① `source==='graph'`（真上游前置）直接采用——不再做名字子串匹配，
 *    因为上游概念按定义就与本课概念**不同名**，子串过滤恰好会把它们全滤掉（2026-09-23 实测）；
 * ② `source==='fallback'`（图缺失时的回落，实为"本任务自身薄弱概念"）不是前置 →
 *    仅保留能与锚点（本课概念）对上的，保持旧行为。
 *
 * 兼容：旧数据可能没有 `source` 字段 → 走 ② 的旧口径。
 */
export function pickPrerequisiteConcepts(
  gaps: Array<{ label?: string; source?: 'graph' | 'fallback' }>,
  anchor: string[],
): string[] {
  return dedupeConcepts(
    gaps
      .filter((gap) => !!gap.label && (
        gap.source === 'graph'
        || anchor.some((concept) => gap.label!.includes(concept) || concept.includes(gap.label!))
      ))
      .map((gap) => gap.label),
  ).slice(0, 2);
}

function buildCognitiveFrame(params: {
  task: any;
  milestone: any;
  path: any;
  resolvedConcept: { id: string | null; name: string | null; description: string | null };
  primaryConcepts: string[];
  prerequisiteConcepts: string[];
  taskProfile: TeachingScenarioContext['taskProfile'];
  /** 1-hop 图邻居名（前置优先）；空数组 = 无图/无邻居，回落旧的"取前 3 个其它 coreConcept" */
  graphNeighbors?: string[];
}) {
  const { task, milestone, path, resolvedConcept, primaryConcepts, prerequisiteConcepts, taskProfile, graphNeighbors } = params;
  const cognitiveCore = parsePathPromptTemplateCore(path);
  const coreConcepts = Array.isArray(cognitiveCore?.coreConcepts) ? cognitiveCore.coreConcepts : [];
  const currentConceptId = normalizeConcept(resolvedConcept.id);
  const currentConceptName = normalizeConcept(resolvedConcept.name);
  // 邻域来源优先级：① 概念图 1-hop（有语义依据）→ ② 旧行为（取前 3 个其它 coreConcept，任意切片）
  const neighboringConcepts = pickNeighboringConcepts({
    graphNeighbors,
    coreConcepts,
    currentConceptId,
    currentConceptName,
  });

  const milestoneIntent = normalizeConcept(
    milestone?.goal
    || milestone?.title
    || task?.milestones?.goal
    || task?.milestones?.title
    || null
  );
  const transferGoal = task?.transferable
    ? normalizeConcept(task?.description) || currentConceptName
    : null;
  const targetRelation = normalizeConcept(resolvedConcept.description)
    || currentConceptName
    || primaryConcepts[0]
    || null;

  return {
    currentCoreConcept: {
      id: currentConceptId,
      name: currentConceptName,
      description: normalizeConcept(resolvedConcept.description),
    },
    prerequisiteConcepts,
    neighboringConcepts,
    targetRelation,
    milestoneIntent,
    transferGoal,
  } as TeachingScenarioContext['cognitiveFrame'];
}

function parseLearningObjectives(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return dedupeConcepts(parsed.map((item) => String(item)));
    }
    if (typeof parsed === 'string') {
      return dedupeConcepts([parsed]);
    }
  } catch {
    return dedupeConcepts([raw]);
  }
  return [];
}



/**
 * 本课的"知识组件种子"：kc-mapper 已经把任务↔KC 的映射落在 `kcAnnotation.taskKcLinks` 里，
 * 复用 `resolveTaskKcsFromPath`（含契约漂移归一）取出来即可，**不新增 LLM 调用**。
 *
 * 修复（2026-09-23）：本函数原为恒返回 `[]` 的空桩，而 `subtasks.learningObjectives` 全库为空
 * （实测 2037/2037），两者叠加使 `primaryConcepts` 恒为 `[]` —— 教学上下文里"本课知识范围"
 * 这一格一直是空的，并连带把 `prerequisiteConcepts` 也卡死（它按 `primaryConcepts` 过滤）。
 * 取不到 KC 时回落任务自身的 canonical 概念（`coreConcept`/`linkedConceptName`，覆盖率 100%）。
 */
export function buildTaskKnowledgeSeeds(params: {
  task: any;
  path: any;
  resolvedConcept: { id: string | null; name: string | null; description: string | null };
}): TeachingKnowledgePointState[] {
  const kcNames = resolveTaskKcsFromPath(params.task, params.path)
    .map((kc) => normalizeConcept(kc.name))
    .filter((name): name is string => !!name);
  const names = kcNames.length > 0
    ? kcNames
    : [normalizeConcept(params.resolvedConcept.name)].filter((name): name is string => !!name);
  // 去重保序；`primaryConcepts` 只取前 2，这里多留一些供后续筛选
  return dedupeConcepts(names).slice(0, 4).map((name) => ({ name, status: 'pending' as const, progress: 0 }));
}

/** 有效失败（PF）触发条件：概念性任务 + 无既定学习目标（新概念）+ 有迁移目标 + 练习/项目型 */
function determineTaskMode(
  task: any,
  persistedLearningObjectives: string[],
  cognitiveFrame: { targetRelation: string | null },
): 'normal' | 'productiveFailure' {
  const isConceptual = task.knowledgeType === 'conceptual';
  const isNewConcept = persistedLearningObjectives.length === 0;
  const hasTransferGoal = cognitiveFrame.targetRelation !== null;
  const isPracticeOrProject = task.taskType === 'practice' || task.taskType === 'project';
  if (isConceptual && isNewConcept && hasTransferGoal && isPracticeOrProject) {
    return 'productiveFailure';
  }
  return 'normal';
}

/** 真实侧长间隔阈值（天）：距上一节课达到该天数即视为"保留率下降"的长间隔回归。 */
export const DEFAULT_TEMPORAL_LONG_GAP_DAYS = 14;

/** 长间隔阈值解析：env `TEACHING_TEMPORAL_LONG_GAP_DAYS` 优先，非法/缺失回退默认值。 */
export function resolveTemporalLongGapThresholdDays(raw?: string | null): number {
  const parsed = Number(String(raw ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TEMPORAL_LONG_GAP_DAYS;
}

export interface TeachingTemporalGap {
  /** 距上一节相关课程结束的天数（保留 1 位小数） */
  daysSinceLastSession: number;
  /** 是否达到长间隔阈值（`>= thresholdDays`） */
  isLongGap: boolean;
}

/**
 * 纯函数：由"上一节相关课程 endTime"计算时间间隔信号。
 * - 无可用 endTime（null/undefined/非法）→ null（调用方省略字段，行为不变）
 * - now 早于 endTime（时钟漂移）→ 归零，不产生负数
 * - isLongGap 判定为 `>= thresholdDays`（默认 {@link DEFAULT_TEMPORAL_LONG_GAP_DAYS}）
 */
export function computeTemporalGap(
  lastSessionEndTime: Date | string | null | undefined,
  now: Date = new Date(),
  thresholdDays: number = DEFAULT_TEMPORAL_LONG_GAP_DAYS,
): TeachingTemporalGap | null {
  if (!lastSessionEndTime) return null;
  const end = lastSessionEndTime instanceof Date ? lastSessionEndTime : new Date(lastSessionEndTime);
  const endMs = end.getTime();
  if (!Number.isFinite(endMs)) return null;
  const threshold = Number.isFinite(thresholdDays) && thresholdDays > 0
    ? thresholdDays
    : DEFAULT_TEMPORAL_LONG_GAP_DAYS;
  const days = Math.max(0, (now.getTime() - endMs) / (24 * 60 * 60 * 1000));
  return {
    daysSinceLastSession: Math.round(days * 10) / 10,
    isLongGap: days >= threshold,
  };
}

/**
 * 取同一用户、同路径上**最近一节已完成课**的 endTime（排除当前进行中的会话）。
 * 供真实侧时间信号主数据源；查询异常静默降级为 null（教学照常）。
 */
export async function fetchLatestPriorSessionEndTime(params: {
  userId: string;
  learningPathId: string;
  excludeSessionId?: string | null;
}): Promise<Date | null> {
  const { userId, learningPathId, excludeSessionId } = params;
  try {
    const row = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        learningPathId,
        status: 'completed',
        endTime: { not: null },
        ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      },
      orderBy: { endTime: 'desc' },
      select: { endTime: true },
    });
    return row?.endTime ?? null;
  } catch (error) {
    logger.warn('[TeachingContext] 拉取上一节结束时间失败（静默降级）', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      learningPathId,
    });
    return null;
  }
}

/**
 * 拉取前序课程摘要（跨节承接数据源），按路径位置选择：
 * 1) 同 milestone 前一任务（同阶段内顺序接续）
 * 2) 上一 milestone 最近完成课（跨阶段接续）
 * 3) 当前任务自己的历史（同任务重学，attemptCount ≥ 2 才有）
 * 4) 回退：同路径最近完成课（原行为，但带 relation='last-any'）
 * 只取轻量字段，任何异常都静默降级为 null，不影响开课主流程。
 */
export async function fetchPriorLearningRecap(params: {  userId: string;
  learningPathId: string;
  currentMilestoneId: string;
  currentTaskId: string;
  currentStageNumber: number;
  milestoneTitle: string;
}): Promise<{
  recap: TeachingScenarioContext['lastLessonRecap'];
  sameTaskSessions: number;
  /** 实际被选为 recap 源的那节课的 endTime（时间信号的兜底源；无 recap 时为 null） */
  lastSourceEndTime: Date | null;
}> {
  const {
    userId,
    learningPathId,
    currentMilestoneId,
    currentTaskId,
    currentStageNumber,
    milestoneTitle,
  } = params;
  const empty = (): { recap: null; sameTaskSessions: 0; lastSourceEndTime: null } =>
    ({ recap: null, sameTaskSessions: 0, lastSourceEndTime: null });

  try {
    // 同路径阶段顺序
    const pathMilestones = await prisma.milestones.findMany({
      where: { learningPathId },
      orderBy: { stageNumber: 'asc' },
      select: { id: true, stageNumber: true, title: true },
    });
    if (!pathMilestones.length) return empty();
    const currentIdx = pathMilestones.findIndex((m) => m.id === currentMilestoneId);
    const prevMilestone = currentIdx > 0 ? pathMilestones[currentIdx - 1] : null;

    // 当前 milestone 内前一任务（不含当前）
    const tasksInMilestone = await prisma.subtasks.findMany({
      where: { milestoneId: currentMilestoneId, userId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true },
    });
    const currentTaskPos = tasksInMilestone.findIndex((t) => t.id === currentTaskId);
    const prevTaskInMilestone = currentTaskPos > 0 ? tasksInMilestone[currentTaskPos - 1] : null;

    // 同任务历史（当前任务自己学过的所有终态会话）
    const sameTaskSessions = await prisma.teaching_sessions.findMany({
      where: {
        userId,
        taskId: currentTaskId,
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { endTime: 'desc' },
      select: { topic: true, wrapup: true, endTime: true, status: true },
    });
    const sameTaskLatest = sameTaskSessions[0] || null;
    const sameTaskWrapup = sameTaskLatest ? parseJsonSafe(sameTaskLatest.wrapup as any) : null;
    const sameTaskUnresolved = sameTaskWrapup
      ? (Array.isArray(sameTaskWrapup.knowledgeItems)
          ? (sameTaskWrapup.knowledgeItems as any[])
              .filter((item: any) => item && typeof item.name === 'string' && item.name.trim() && item.status !== 'mastered')
              .map((item: any) => String(item.name).trim())
              .slice(0, 3)
          : [])
      : [];
    const sameTaskActionPlan = sameTaskWrapup && Array.isArray(sameTaskWrapup.actionPlan)
      ? sameTaskWrapup.actionPlan.filter((item: any) => typeof item === 'string' && item.trim()).slice(0, 3)
      : [];

    // 从教学会话里提取 recap 数据
    const toRecap = (session: any, relation: TeachingScenarioContext['lastLessonRecap']['relation']) => {
      const wrapup = session.wrapup ? parseJsonSafe(session.wrapup) : null;
      if (!wrapup) return null;
      const actionPlan = Array.isArray(wrapup.actionPlan)
        ? wrapup.actionPlan.filter((item: any) => typeof item === 'string' && item.trim())
        : [];
      const knowledgeItems = Array.isArray(wrapup.knowledgeItems) ? wrapup.knowledgeItems : [];
      const unresolvedPoints = knowledgeItems
        .filter((item: any) => item && typeof item.name === 'string' && item.name.trim() && item.status !== 'mastered')
        .map((item: any) => String(item.name).trim())
        .slice(0, 3);
      return {
        sourceTopic: typeof session.topic === 'string' && session.topic.trim() ? session.topic.trim() : null,
        topicSummary: typeof wrapup.topicSummary === 'string' && wrapup.topicSummary.trim() ? wrapup.topicSummary.trim() : null,
        retrievalCue: actionPlan[0] || null,
        unresolvedPoints,
        relation,
        sameTaskHistory: relation === 'same-task'
          ? {
              attemptCount: sameTaskSessions.length,
              lastStatus: sameTaskLatest?.status || '',
              lastEndTime: sameTaskLatest?.endTime?.toISOString?.() || null,
              lastSummary: (typeof wrapup.topicSummary === 'string' && wrapup.topicSummary.trim()) ? wrapup.topicSummary.trim() : null,
              lastUnresolvedPoints: unresolvedPoints,
              lastActionPlan: actionPlan.slice(0, 3),
            }
          : undefined,
      };
    };

    // 候选源：同 milestone 前一任务（同路径最近完成课，且属于前一任务）
    // → 上一 milestone 最近完成课 → 同任务历史 → 全路径最近完成课
    const prevTaskSessions = prevTaskInMilestone
      ? await prisma.teaching_sessions.findFirst({
          where: {
            userId,
            learningPathId,
            taskId: prevTaskInMilestone.id,
            status: 'completed',
            wrapup: { not: null },
          },
          orderBy: { endTime: 'desc' },
          select: { topic: true, wrapup: true, endTime: true },
        })
      : null;
    if (prevTaskSessions) {
      const recap = toRecap(prevTaskSessions, 'same-milestone-prev-task');
      if (recap) {
        return {
          recap: {
            ...recap,
            sourceStageNumber: currentStageNumber,
            sourceMilestoneTitle: milestoneTitle,
            sourceTaskTitle: prevTaskInMilestone?.title || null,
          },
          sameTaskSessions: sameTaskSessions.length,
          lastSourceEndTime: prevTaskSessions.endTime ?? null,
        };
      }
    }

    // 上一 milestone：取该 milestone 下最近完成课
    if (prevMilestone) {
      const prevMsRecentTaskIds = await prisma.subtasks.findMany({
        where: { milestoneId: prevMilestone.id, userId },
        select: { id: true },
      });
      const prevMsSessions = prevMsRecentTaskIds.length
        ? await prisma.teaching_sessions.findFirst({
            where: {
              userId,
              learningPathId,
              taskId: { in: prevMsRecentTaskIds.map((t: any) => t.id) },
              status: 'completed',
              wrapup: { not: null },
            },
            orderBy: { endTime: 'desc' },
            select: { topic: true, wrapup: true, endTime: true },
          })
        : null;
      if (prevMsSessions) {
        const recap = toRecap(prevMsSessions, 'prev-milestone');
        if (recap) {
          return {
            recap: {
              ...recap,
              sourceStageNumber: prevMilestone.stageNumber,
              sourceMilestoneTitle: prevMilestone.title,
              sourceTaskTitle: null,
            },
            sameTaskSessions: sameTaskSessions.length,
            lastSourceEndTime: prevMsSessions.endTime ?? null,
          };
        }
      }
    }

    // 同任务历史（第二/多次学同一任务）
    if (sameTaskSessions.length > 0 && sameTaskWrapup) {
      const recap = toRecap(sameTaskLatest, 'same-task');
      if (recap) {
        return {
          recap: {
            ...recap,
            sourceStageNumber: currentStageNumber,
            sourceMilestoneTitle: milestoneTitle,
            sourceTaskTitle: null,
          },
          sameTaskSessions: sameTaskSessions.length,
          lastSourceEndTime: sameTaskLatest?.endTime ?? null,
        };
      }
    }

    // 回退：同路径最近完成课（排除当前任务，原行为）
    const lastEnded = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        learningPathId,
        taskId: { not: currentTaskId },
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { endTime: 'desc' },
      select: { topic: true, wrapup: true, endTime: true },
    });
    if (lastEnded) {
      const recap = toRecap(lastEnded, 'last-any');
      if (recap) {
        return { recap, sameTaskSessions: sameTaskSessions.length, lastSourceEndTime: lastEnded.endTime ?? null };
      }
    }
    return { recap: null, sameTaskSessions: sameTaskSessions.length, lastSourceEndTime: null };
  } catch (error) {
    logger.warn('[TeachingContext] 拉取前序课程摘要失败（静默降级）', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      learningPathId,
    });
    return empty();
  }
}

/**
 * 取**上一节课**留下的「连续受挫轮数」（§4.5 情感闭环：受挫 → 降档/减速的信号化）。
 *
 * 数据源：`teachingState.learnerStateContext.frustratedStreak`（回合级计算、随会话状态持久化）。
 * 防御式只读：任何缺失/非法都按 0（= 不降档），避免"读不到"被误当成"受挫"。
 *
 * @internal 导出供单测
 */
export function readRecentFrustrationStreak(previousSession: unknown): number {
  const raw = (previousSession as { teachingState?: unknown } | null | undefined)?.teachingState;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 0;
    }
  }
  const streak = (parsed as { learnerStateContext?: { frustratedStreak?: unknown } } | null | undefined)
    ?.learnerStateContext?.frustratedStreak;
  const n = Number(streak);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 汇总前序阶段掌握（供 priorLearningContext.priorMilestoneMastery）。
 *
 * 只保留**确有前序进展**的阶段（completedTasks > 0）：全新学习者的当前路径上
 * 所有阶段都是 `completedTasks: 0 / masteryState: 'unknown'`，若照单全收，
 * `priorLearningContext` 会恒为真值，开场就会凭空声称
 * 「前面关于 X 的基础已经建立好」（走查 P3 实测）。
 *
 * @internal 导出供单测锁定上述口径
 */
export function buildPriorMilestoneMastery(learnerSnapshot: any): TeachingScenarioContext['priorLearningContext'] extends infer _ ? NonNullable<TeachingScenarioContext['priorLearningContext']>['priorMilestoneMastery'] : never {
  const progress = learnerSnapshot?.knowledgeMemory?.currentPath?.milestoneProgress;
  if (!Array.isArray(progress)) return [];
  return progress
    .filter((item: any) =>
      item
      && typeof item.stageNumber === 'number'
      && typeof item.masteryState === 'string'
      && Number(item.completedTasks) > 0
    )
    .map((item: any) => ({
      stageNumber: item.stageNumber,
      title: typeof item.title === 'string' ? item.title : '',
      masteryState: item.masteryState,
      completedTasks: typeof item.completedTasks === 'number' ? item.completedTasks : 0,
      totalTasks: typeof item.totalTasks === 'number' ? item.totalTasks : 0,
    }));
}

function buildTeachingStrategyGuidance(taskProfile: TeachingScenarioContext['taskProfile']) {  const knowledgeType = taskProfile.knowledgeType;
  const cognitiveLevel = taskProfile.cognitiveLevel;
  const objectiveFocus = taskProfile.learningObjectives.slice(0, 4);
  const coreConcept = taskProfile.coreConcept;

  const knowledgeGuidance = knowledgeType && teachingStrategyConfig.byKnowledgeType[knowledgeType]
    ? teachingStrategyConfig.byKnowledgeType[knowledgeType]
    : {
        explanationStyle: teachingStrategyConfig.defaults.explanationStyle,
        interactionPattern: teachingStrategyConfig.defaults.interactionPattern,
        preferredStrategies: teachingStrategyConfig.defaults.preferredStrategies,
        responseConstraints: [] as string[],
      };

  const levelGuidance = cognitiveLevel && teachingStrategyConfig.byCognitiveLevel[cognitiveLevel]
    ? teachingStrategyConfig.byCognitiveLevel[cognitiveLevel]
    : {
        targetDepth: teachingStrategyConfig.defaults.targetDepth,
        responseConstraints: [] as string[],
      };

  return {
    knowledgeType,
    cognitiveLevel,
    objectiveFocus,
    coreConcept,
    explanationStyle: knowledgeGuidance.explanationStyle,
    interactionPattern: knowledgeGuidance.interactionPattern,
    targetDepth: levelGuidance.targetDepth,
    preferredStrategies: knowledgeGuidance.preferredStrategies,
    responseConstraints: [
      ...knowledgeGuidance.responseConstraints,
      ...levelGuidance.responseConstraints,
    ],
  };
}

/**
 * 从路径模板（`learning_paths.aiPromptTemplate`）里取回该路径关联的资料，并投影成课堂用的最小集合。
 *
 * 数据位置：`sceneFraming.normalizedInput.resources.materials`（优先），回退持久化快照。
 * 无资料 → null（提示词里不出现该键，课堂行为与原先完全一致）。
 */
export function resolvePathMaterialsForTeaching(aiPromptTemplate: string | null | undefined): PromptMaterial[] | null {
  const parsed = parsePathPromptTemplate(aiPromptTemplate || null);
  if (!parsed) return null;
  // 持久化形态有三种（历史演进）：sceneFraming.normalizedInput / 顶层 normalizedInput /
  // normalizedInputSnapshot.normalizedInput。逐个尝试，命中即返回（都拿不到 → null）。
  const snapshot = resolveNormalizedInputSnapshot(parsed);
  const candidates: unknown[] = [
    getSceneFramingNormalizedInput(parsed.sceneFraming),
    resolvePersistedNormalizedInput(parsed),
    snapshot,
    (snapshot as any)?.normalizedInput,
  ];
  for (const candidate of candidates) {
    const materials = extractPromptMaterials({ normalizedInput: candidate }, TEACHING_MATERIAL_LIMITS);
    if (materials) return materials;
  }
  return null;
}

export async function buildTeachingScenarioContext(
  userId: string,
  taskId: string,
  previousSession?: TeachingSessionRecord | null,
  interactionMeta?: InteractionMetaRecord | null
): Promise<TeachingScenarioContext> {
  const task = await prisma.subtasks.findUnique({
    where: { id: taskId },
    include: {
      milestones: {
        include: {
          subtasks: {
            orderBy: { order: 'asc' },
          },
          learning_paths: true,
        }
      }
    }
  });

  if (!task || !task.milestones?.learning_paths) {
    throw new Error('任务不存在');
  }

  const path = task.milestones.learning_paths;
  if (path.userId !== userId) {
    throw new Error('无权访问此任务');
  }

  const runtimeLearningState = previousSession?.status === 'active'
    ? learningStateService.coerceMetrics(previousSession.teachingState)
    : null;
  const learningState = runtimeLearningState || await learningStateService.getCurrentState(userId);
  const learnerSnapshot = await learnerSnapshotRefreshService.getLatest({
    userId,
    pathId: path.id,
    milestoneId: task.milestoneId,
    taskId: task.id,
    scope: 'teaching',
  });
  const learnerProjection = learnerProjectionService.toTeachingProjection(learnerSnapshot, {
    // 任务级难度：由学习者状态（课内=本路径、全局=总负担）确定档位，代码判定、可审计（不用 LLM）
    taskDifficulty: decideTaskDifficulty({
      baselineLevel: resolveBaselineLevel({
        cognitiveLoad: (task as any).cognitiveLoad,
        cognitiveLevel: (task as any).cognitiveLevel,
      }),
      globalMetrics: learnerSnapshot.dynamicState.metrics,
      lessonMetrics: learnerSnapshot.dynamicState.lessonMetrics ?? null,
      learningControlState: learnerSnapshot.learningControlState,
      fatigueRisk: learnerSnapshot.dynamicState.fatigueRisk,
      recommendedPacing: learnerSnapshot.dynamicState.recommendedPacing,
      knowledgeSignals: {
        fragileCount: learnerSnapshot.knowledgeMemory.globalSignals.fragileConcepts.length,
        strugglingCount: learnerSnapshot.knowledgeMemory.globalSignals.strugglingConcepts.length,
        prerequisiteGapCount: learnerSnapshot.knowledgeMemory.currentPath?.prerequisiteGaps.length ?? 0,
      },
      // 情感（软传感器，§4.5）：取**上一节课**留下的连续受挫轮数——软传感器只允许降档/减速，
      // 服务内部把它归入 LOAD_BASED_DECREASE_REASONS（结构上不可能成为升档依据）。
      recentFrustrationStreak: readRecentFrustrationStreak(previousSession),
      // 独立成功率带（§7 P1-1）：只用**代码裁决**的检查点结果驱动档位；
      // 无样本 → hold → 退回旧的 canIncrease 口径（行为与改造前一致）
      successBand: await resolveSuccessBandVerdict(userId, { pathId: path.id }).catch(() => null),
    }),
  });
  // Q8 延迟锚题数据供给修复：从**未截断**的权威来源为所有已掌握概念派生 lastSeenAt。
  // 优先 currentPath.conceptStates（全量、正是 masteredConcepts 的出处），再并入全局账本；
  // 两条都不受 recentConceptLedger.slice(0,12)（乃至账本内部 40/60 条）截断——否则排在后面的
  // 老概念永远拿不到时间戳，延迟锚题在真实长跑中永不触发。只在此处查表（probe 保持纯函数无 I/O）。
  const anchorMasteredLastSeenAt = buildMasteredLastSeenAtMap(
    [
      ...(learnerSnapshot.knowledgeMemory.currentPath?.conceptStates ?? []),
      ...learnerSnapshot.knowledgeMemory.globalBackground.conceptLedger,
    ],
    learnerSnapshot.knowledgeMemory.globalSignals.masteredConcepts,
  );
  const resolvedConcept = resolveTaskConceptFromPath(task, path);
  const persistedLearningObjectives = parseLearningObjectives((task as any).learningObjectives);
  const taskKnowledgeSeeds = buildTaskKnowledgeSeeds({ task, path, resolvedConcept });
  const primaryConcepts = persistedLearningObjectives.length > 0
    ? persistedLearningObjectives
    : taskKnowledgeSeeds.map((point) => point.name).slice(0, 2);
  // 前置概念：`prerequisiteGaps` 本来就是按**本任务**的上游闭包算出来的，`source==='graph'` 可直接采用。
  // 回落口径（`source==='fallback'`）给的是"本任务自身薄弱概念"，不是前置 → 只保留能对上本课概念的（旧行为）。
  // 锚点不再只依赖 `primaryConcepts`：它曾恒为空，使这一格结构性永远为空（2026-09-23 修）。
  const prerequisiteAnchor = primaryConcepts.length > 0
    ? primaryConcepts
    : [normalizeConcept(resolvedConcept.name)].filter((name): name is string => !!name);
  const prerequisiteConcepts = pickPrerequisiteConcepts(
    learnerSnapshot.knowledgeMemory.currentPath?.prerequisiteGaps || [],
    prerequisiteAnchor,
  );

  const canStartLearning = previousSession?.status === 'active'
    ? true
    : path.status === 'active';
  const learningSignalRaw = (learnerSnapshot.profile as any)?.narratives?.learningSignal;
  const learningSignal = typeof learningSignalRaw === 'string' && learningSignalRaw.trim()
    ? learningSignalRaw.trim()
    : null;
  // 传入本节课（进行中）会话：行为画像/求助软拦截必须看到"本课内"的表现（18 号报告 N9）
  const behavioralProfile = await fetchBehavioralProfile(userId, previousSession);
  const milestone = task.milestones;
  const taskProfile = {
    knowledgeType: (task as any).knowledgeType || null,
    cognitiveLevel: (task as any).cognitiveLevel || null,
    displayLabel: (task as any).displayLabel || null,
    learningObjectives: primaryConcepts,
    coreConcept: resolvedConcept.name,
    linkedConceptId: resolvedConcept.id,
    linkedConceptName: resolvedConcept.name,
  } as TeachingScenarioContext['taskProfile'];
  // 概念图 1-hop 邻域（L3 接入）：优先用物化后的 concept_edges 拿"有语义依据的邻居"
  // （前置优先——教学需要先唤醒基础），图缺失/无邻居时回落旧行为（见 buildCognitiveFrame 内的兜底）。
  const graphNeighbors = await fetchGraphNeighbors({
    userId,
    pathId: path.id,
    conceptName: resolvedConcept.name,
  });
  const cognitiveFrame = buildCognitiveFrame({
    task,
    milestone,
    path,
    resolvedConcept,
    primaryConcepts,
    prerequisiteConcepts,
    taskProfile,
    graphNeighbors,
  });
  // 本课知识组件（kc-mapper 拆出的最小单元）：既是注入字段，也参与误解台账检索——
  // 台账的 conceptKey 往往就是 KC 名（教学回合按 KC 粒度报误解），只按上面三个概念槽位去查
  // 会一条都拉不到；模型看不到既往标签就只能每轮重编一个 hypothesis（实测 22 行里 6 行标签为 null）。
  const taskKcs = resolveTaskKcsFromPath(task, path);
  const supportingConcepts = dedupeConcepts([
    ...cognitiveFrame.neighboringConcepts,
    ...prerequisiteConcepts,
  ])
    // 三个槽位各占其位：本课概念（primary）与前置（prerequisite）已有自己的格子，
    // 不再重复出现在"支撑概念"里（前置恒空时看不出，前置修好后会重复）。
    .filter((concept) => !primaryConcepts.includes(concept) && !prerequisiteConcepts.includes(concept))
    .slice(0, 3);
  // 误解台账（G-R-R Phase 2）：拉取当前任务相关概念的活跃误解，注入教学上下文
  const priorMisconceptions = await getActiveForConcepts(userId, dedupeConcepts([
    ...primaryConcepts,
    ...prerequisiteConcepts,
    ...supportingConcepts,
    ...taskKcs.map((kc) => kc.name).filter((name) => !!name),
  ]), 5).then((rows) => rows.length > 0 ? rows.map((r) => ({
    conceptKey: r.conceptKey,
    hypothesis: r.hypothesis,
    canonicalLabel: r.canonicalLabel,
    confidence: r.confidence,
    status: r.status,
    occurrenceCount: r.occurrenceCount,
  })) : null);
  const orderedTasks = Array.isArray(milestone?.subtasks) ? milestone.subtasks : [];
  const currentTaskOrder = typeof (task as any).order === 'number'
    ? (task as any).order
    : Math.max(1, orderedTasks.findIndex((item: any) => item.id === task.id) + 1);

  // 前序学习上下文：按路径位置接续（同阶段前一任务 → 上一阶段 → 同任务历史 → 最近任意）
  const { recap: lastLessonRecap, sameTaskSessions, lastSourceEndTime } = await fetchPriorLearningRecap({
    userId,
    learningPathId: path.id,
    currentMilestoneId: task.milestoneId,
    currentTaskId: task.id,
    currentStageNumber: Number.isFinite(Number(milestone.stageNumber)) ? Number(milestone.stageNumber) : 1,
    milestoneTitle: milestone.title || milestone.goal || '当前阶段',
  });
  // 真实侧时间信号：优先"同路径最近一节已完成课"的 endTime；查询无果/异常时兜底用 recap 源课 endTime。
  // 无任何前序（含 endTime）→ null，调用方省略 controls.temporalGap，行为与改造前一致。
  const latestPriorSessionEndTime = await fetchLatestPriorSessionEndTime({
    userId,
    learningPathId: path.id,
    excludeSessionId: previousSession?.id ?? null,
  });
  const temporalGap = computeTemporalGap(
    latestPriorSessionEndTime ?? lastSourceEndTime,
    new Date(),
    resolveTemporalLongGapThresholdDays(process.env.TEACHING_TEMPORAL_LONG_GAP_DAYS),
  );
  const priorMilestoneMastery = buildPriorMilestoneMastery(learnerSnapshot);
  const priorLearningContext: TeachingScenarioContext['priorLearningContext'] = (lastLessonRecap || sameTaskSessions > 0 || priorMilestoneMastery.length > 0)
    ? {
        hasPriorLearning: true,
        adjacent: lastLessonRecap && (lastLessonRecap.relation === 'same-milestone-prev-task' || lastLessonRecap.relation === 'prev-milestone')
          ? {
              relation: lastLessonRecap.relation,
              stageNumber: lastLessonRecap.sourceStageNumber ?? 0,
              milestoneTitle: lastLessonRecap.sourceMilestoneTitle || '',
              taskTitle: lastLessonRecap.sourceTaskTitle || '',
              topicSummary: lastLessonRecap.topicSummary,
              retrievalCue: lastLessonRecap.retrievalCue,
              unresolvedPoints: lastLessonRecap.unresolvedPoints,
              actionPlan: lastLessonRecap.sameTaskHistory?.lastActionPlan || [],
              newlyMastered: [],
              stillLearning: lastLessonRecap.unresolvedPoints,
            }
          : null,
        sameTask: sameTaskSessions > 0 && lastLessonRecap?.relation === 'same-task'
          ? {
              attemptCount: sameTaskSessions,
              lastStatus: lastLessonRecap.sameTaskHistory?.lastStatus || 'completed',
              lastSummary: lastLessonRecap.sameTaskHistory?.lastSummary || null,
              lastUnresolved: lastLessonRecap.sameTaskHistory?.lastUnresolvedPoints || [],
              lastActionPlan: lastLessonRecap.sameTaskHistory?.lastActionPlan || [],
              lastEndTime: lastLessonRecap.sameTaskHistory?.lastEndTime || null,
            }
          : null,
        priorMilestoneMastery,
      }
    : null;

  // 诊断洞察回注（设计 §4：top-N active insights）：只读投影、不调 LLM；失败即视为无洞察。
  // 动态 import 避免与 LearnerStateReviewService 形成静态循环依赖（同 sandbox-resolver 的既有写法）。
  let learnerInsights: TeachingScenarioContext['learnerInsights'] = null;
  try {
    const { learnerStateReviewService } = await import('../learner/LearnerStateReviewService');
    const insights = await learnerStateReviewService.getActiveInsights(userId, path.id, { limit: 3 });
    if (insights.length > 0) {
      learnerInsights = insights;
      logger.info('[teaching-context] 注入活跃诊断洞察', {
        userId,
        pathId: path.id,
        count: insights.length,
        types: insights.map((item) => item.type),
      });
    }
  } catch (error) {
    logger.warn('[teaching-context] 诊断洞察注入失败（教学照常）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const context = {
    userId,
    taskId: task.id,
    learningPathId: path.id,
    milestoneId: task.milestoneId,
    subject: path.subject || '综合',
    topic: task.title,
    taskTitle: task.title,
    taskDescription: task.description || '',
    taskType: (task.taskType as 'reading' | 'practice' | 'project' | 'quiz') || 'practice',
    taskKnowledgeScope: {
      primaryConcepts,
      prerequisiteConcepts,
      supportingConcepts,
    },
    taskKcs,
    taskKnowledgeSeeds,
    taskProfile,
    currentTaskContext: {
      description: task.description || null,
      acceptanceCriteria: (task as any).acceptanceCriteria || null,
    },
    teachingStrategyGuidance: buildTeachingStrategyGuidance(taskProfile),
    cognitiveFrame,
    canStartLearning,
    learningBlockedReason: canStartLearning ? null : '学习内容还在准备中，请稍候再开始学习',
    pathProgress: {
      pathTitle: path.title || path.name || '当前学习路径',
      pathSummary: parsePathSummary(path.aiPromptTemplate),
      currentMilestoneTitle: milestone.title || milestone.goal || '当前阶段',
      currentStageNumber: Number.isFinite(Number(milestone.stageNumber)) ? Number(milestone.stageNumber) : 1,
      currentTaskOrder,
      totalTasksInMilestone: orderedTasks.length,
    },
    learningState: learningState ? {
      lss: learningState.lss,
      ktl: learningState.ktl,
      lf: learningState.lf,
      lsb: learningState.lsb,
    } : null,
    learnerProjection,
    anchorMasteredLastSeenAt,
    pathContext: {
      pathTitle: path.title || path.name,
      pathSummary: parsePathSummary(path.aiPromptTemplate),
      subject: path.subject,
    },
    // 资料 → 课堂：从路径模板里取回资料包并投影（见 resolvePathMaterialsForTeaching）
    materials: resolvePathMaterialsForTeaching(path.aiPromptTemplate),
    previousSession: previousSession ? {
      sessionId: previousSession.id,
      messages: previousSession.messages,
        knowledgePoints: previousSession.knowledgeState,
      } : null,
    learningSignal,
    lastLessonRecap,
    temporalGap,
    priorLearningContext,
    learnerInsights,
    interactionProfile: buildInteractionProfile(interactionMeta, previousSession?.messages ?? []),
    learnerPrediction: null,
    priorMisconceptions,
    taskMode: determineTaskMode(task, persistedLearningObjectives, cognitiveFrame),
    behavioralProfile,
  };

  // 学习表现预测（P2 闭环）：幂等复用 + 超时保护；结果直接进入教学上下文
  // - 已有该任务未回写的预测记录 → 复用（重试/恢复不重复调 LLM）
  // - 无 → await LLM 预测（≤8s，超时降级 null）→ 记录校准行
  // - 失败/超时 → null，教学照常
  context.learnerPrediction = await buildLearnerPrediction(userId, path.id, task.id, milestone?.id, previousSession?.id, {
    fatigueSignal: learningState ? (learningState.lf >= 6 ? 'high' : learningState.lf >= 4 ? 'medium' : 'low') : undefined,
    taskContext: {
      title: task.title,
      knowledgeType: (task as any).knowledgeType,
      learningObjectives: primaryConcepts,
    },
  });

  return context;
}

/** 预测超时（LLM 调用 3-8s，8s 封顶保证会话创建不被拖死） */
const PREDICTION_TIMEOUT_MS = 8000;
/** 实证可靠性的最低样本数：低于此值不给 reliability（防小样本误导） */
export const PREDICTION_RELIABILITY_MIN_SAMPLE = 5;

/** 幂等获取/生成学习表现预测：优先复用未回写记录，否则调 LLM 并记录（超时→null） */
async function buildLearnerPrediction(
  userId: string,
  pathId: string,
  taskId: string,
  milestoneId: string | undefined,
  sessionId: string | undefined,
  opts: {
    fatigueSignal?: 'low' | 'medium' | 'high';
    taskContext: { title: string; knowledgeType?: string; learningObjectives?: string[] };
  },
): Promise<LearnerPredictionContext | null> {
  try {
    // 1) 幂等复用：该任务已有未回写的预测 → 直接用（零 LLM 成本）
    const existing = await prisma.prediction_records.findFirst({
      where: { userId, taskId, outcome: null },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return await withReliability(userId, {
        stallRisk: existing.stallRisk,
        predictedTone: existing.predictedTone as LearnerPredictionContext['predictedTone'],
        suggestedDepth: existing.suggestedDepth as LearnerPredictionContext['suggestedDepth'],
        focusConcepts: safeParseStringArray(existing.focusConcepts),
        rationale: existing.rationale,
      });
    }

    // 2) 无记录 → LLM 预测（读取最近知识状态摘要）+ 超时保护
    const summary = await fetchLatestKnowledgeSummary(userId);
    const prediction = (await Promise.race([
      executeSkill(learningPredictorDefinition, process.env.PAYLOAD_STABLE_PREFIX !== '0'
        ? {
            fatigueSignal: opts.fatigueSignal || 'low',
            knowledgeStateSummary: summary || '无历史摘要',
            taskContext: opts.taskContext,
          }
        : {
            knowledgeStateSummary: summary || '无历史摘要',
            fatigueSignal: opts.fatigueSignal || 'low',
            taskContext: opts.taskContext,
          }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PREDICTION_TIMEOUT_MS)),
    ])) as LearningPredictorOutput | null;

    if (!prediction) return null;

    // 3) 记录校准行（await：保证 outcome 回写时能找到记录）
    await predictionCalibrationService.recordPrediction({
      userId,
      pathId,
      taskId,
      milestoneId: milestoneId || undefined,
      sessionId: sessionId || undefined,
      prediction,
      summaryEcho: summary?.slice(0, 300),
    });

    return await withReliability(userId, prediction);
  } catch (error) {
    logger.debug('[TeachingContext] 学习表现预测失败（非阻塞）', {
      userId, taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 附加实证可靠性（样本 ≥ MIN 才给，防小样本误导） */
async function withReliability(userId: string, prediction: LearningPredictorOutput): Promise<LearnerPredictionContext> {
  try {
    const stats = await predictionCalibrationService.empiricalStats(userId);
    const reliable = stats.total >= PREDICTION_RELIABILITY_MIN_SAMPLE
      ? { total: stats.total, stallHitRate: stats.stallHitRate }
      : null;
    return { ...prediction, reliability: reliable };
  } catch {
    return { ...prediction, reliability: null };
  }
}

function safeParseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** 从最近一次 session-knowledge-distilled 证据中读取知识状态摘要 */
async function fetchLatestKnowledgeSummary(userId: string): Promise<string | undefined> {
  try {
    const row = await prisma.learner_evidence.findFirst({
      where: { userId, evidenceType: 'session-knowledge-distilled' },
      orderBy: { occurredAt: 'desc' },
      select: { payload: true },
    });
    if (!row) return undefined;
    const parsed = JSON.parse(row.payload);
    return typeof parsed.knowledgeStateSummary === 'string' && parsed.knowledgeStateSummary.trim()
      ? parsed.knowledgeStateSummary.trim()
      : undefined;
  } catch { return undefined; }
}

/** 行为投影器（LLM-KT Behavioral Dynamics Projector）：近期回合级行为动态压缩 */
export async function fetchBehavioralProfile(
  userId: string,
  currentSession?: { messages?: unknown } | null,
): Promise<TeachingScenarioContext['behavioralProfile']> {
  try {
    const recentSessions = await prisma.teaching_sessions.findMany({
      where: { userId, status: 'completed' },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { messages: true },
    });
    // **本节课（进行中）的消息也必须计入**（18 号报告 N9）：求助软拦截最需要生效的场景正是
    // "本节课里连续直接要答案"，而此前只统计 status='completed' 的历史会话 → 本节课计数恒为 0。
    // 顺序按时间升序（历史由旧到新 + 本节课最后），这样 `recentHelpSeeking.slice(-5)` 取的是最近 5 条。
    const orderedMessageLists: unknown[][] = [
      ...[...recentSessions].reverse().map((session) => (Array.isArray(session.messages) ? session.messages : [])),
      ...(currentSession && Array.isArray(currentSession.messages) ? [currentSession.messages] : []),
    ];
    const allAnalysis: any[] = [];
    for (const msgs of orderedMessageLists) {
      for (const msg of msgs as any[]) {
        if (msg?.role === 'assistant' && msg?.analysis) allAnalysis.push(msg.analysis);
      }
    }
    if (allAnalysis.length === 0) return null;

    const avg = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length || 0;
    const understandings = allAnalysis.map((a) => a.understanding).filter((v) => Number.isFinite(v));
    const loadIndices = allAnalysis.map((a) => a.loadIndex).filter((v) => Number.isFinite(v));
    const engagements = allAnalysis.map((a) => a.engagement).filter((v) => Number.isFinite(v));
    const emotions = allAnalysis.map((a) => a.emotionalState).filter((v) => typeof v === 'string');
    const frustratedCount = emotions.filter((e) => e === 'frustrated').length;

    const ktEmaRows = await prisma.memory_traces.findMany({
      where: { userId, ktMasteryEma: { not: null } },
      select: { ktMasteryEma: true },
    });
    const ktMasteryAvg = ktEmaRows.length > 0
      ? ktEmaRows.reduce((sum, r) => sum + (r.ktMasteryEma ?? 0), 0) / ktEmaRows.length
      : null;

    // 主导情绪
    const emotionCounts = new Map<string, number>();
    for (const e of emotions) emotionCounts.set(e, (emotionCounts.get(e) || 0) + 1);
    let dominantEmotion: string | null = null;
    let maxCount = 0;
    for (const [e, count] of emotionCounts) { if (count > maxCount) { maxCount = count; dominantEmotion = e; } }

    // 求助行为（2026-09-17 起被消费；此前 teaching-turn 每轮产出 helpSeekingType 却没人读，审计 §5.2 P2 尾巴）：
    // 只给"最近几轮的原话 + 次数"，供提示词做**软拦截**——学生反复直接要答案时，先给最小提示/反问，
    // 而不是把答案交出去（该字段的产出方注释本就写着"供后台统计与软拦截"）。
    const helpSeeking = allAnalysis
      .map((analysis) => (typeof analysis?.helpSeekingType === 'string' ? analysis.helpSeekingType.trim() : ''))
      .filter((value) => value.length > 0);

    return {
      avgUnderstanding: understandings.length > 0 ? Math.round(avg(understandings) * 100) / 100 : null,
      avgLoadIndex: loadIndices.length > 0 ? Math.round(avg(loadIndices) * 100) / 100 : null,
      avgEngagement: engagements.length > 0 ? Math.round(avg(engagements) * 100) / 100 : null,
      dominantEmotion,
      frustrationRate: emotions.length > 0 ? Math.round((frustratedCount / emotions.length) * 100) / 100 : null,
      knowledgeMasteryEma: ktMasteryAvg !== null ? Math.round(ktMasteryAvg * 100) / 100 : null,
      sampleSize: allAnalysis.length,
      ...(helpSeeking.length > 0
        ? { recentHelpSeeking: helpSeeking.slice(-5), helpSeekingCount: helpSeeking.length }
        : {}),
    };
  } catch { return null; }
}
