/**
 * 教学上下文 · 知识结构助手（2026-10-24 架构优化批 1 自 TeachingContextBuilder.ts 迁出，逐字未改）。
 */
import type { TeachingKnowledgePointState, TeachingSessionRecord } from './TeachingSessionRepository';
import { logger } from '../../utils/logger';
import { conceptRegistryService } from '../learner/concept-registry.service';
import { conceptGraphService, RELATION_PREREQUISITE, RELATION_PART_OF } from '../learner/concept-graph.service';
import type { InteractionMetaRecord, InteractionHistoryEntry, TeachingScenarioContext } from './teaching-context-types';

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
export function buildInteractionProfile(
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

export function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parsePathSummary(raw: string | null | undefined): string | null {
  const parsed = parseJsonSafe(raw);
  const summary = parsed?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
}

export function parsePathPromptTemplate(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

export function dedupeConcepts(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeConcept(value)).filter(Boolean) as string[]));
}

function parsePathPromptTemplateCore(path: any) {
  const promptTemplate = parsePathPromptTemplate(path?.aiPromptTemplate);
  // #9 退役：统一读 cognitiveCore（旧数据需先跑 scripts/migrate-cognitive-core.ts 迁移）
  return promptTemplate?.cognitiveCore || null;
}

/** 从 kcAnnotation.taskKcLinks 解析当前任务的细粒度知识组件（KC）列表（kc-mapper 下游激活 3b） */
export function resolveTaskKcsFromPath(task: any, path: any): Array<{ kcId: string; name: string; taxonomy: string }> {
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

export function resolveTaskConceptFromPath(task: any, path: any): { id: string | null; name: string | null; description: string | null } {
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
export async function fetchGraphNeighbors(params: {
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

export function buildCognitiveFrame(params: {
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

export function parseLearningObjectives(raw: string | null | undefined): string[] {
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
export function determineTaskMode(
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


