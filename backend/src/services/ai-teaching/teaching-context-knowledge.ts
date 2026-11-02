/**
 * 教学上下文 · 知识结构助手（2026-10-24 架构优化批 1 自 TeachingContextBuilder.ts 迁出，逐字未改）。
 */
import type { TeachingKnowledgePointState, TeachingSessionRecord } from './TeachingSessionRepository';
import { logger } from '../../utils/logger';
import { conceptRegistryService } from '../learner/concept-registry.service';
import { conceptGraphService, RELATION_PREREQUISITE, RELATION_PART_OF } from '../learner/concept-graph.service';
import { sanitizeUserFacingText } from '../learning/user-facing-text';
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

/**
 * 任务↔KC 连接键的口径（issue #179）。
 *
 * kc-mapper 的输入标题来自 stage-designer 的**原始**标题，而 subtasks 落库前经
 * `sanitizeUserFacingText()` 收口（内部词表：回捞 → 回顾）；本函数两侧都用同一个
 * 收口再比较——只 trim/折叠空格消除不了该改写，凡是命中过词表的任务都会静默匹配不到 KC。
 * 用同一收口也让既有路径（标注里存的仍是原始标题）无需重跑生成即可对上。
 *
 * 这只是**兜底键**：写侧已在落库时为每条链接绑上稳定键 `subtasks.id`（见 stage-enrichment），
 * 读侧优先按 id 匹配（见 resolveTaskKcsFromPath）。
 */
function taskTitleKey(value: unknown): string | null {
  return normalizeConcept(sanitizeUserFacingText(value).text);
}

/** 契约是 linkedKCs，但实测弱模型/漂移模型会写成 kcIds / linkedKcIds / kcs（2026-09-22）。 */
function linkedKcIdsOf(link: any): unknown[] {
  if (!link || typeof link !== 'object') return [];
  if (Array.isArray(link.linkedKCs)) return link.linkedKCs;
  if (Array.isArray(link.kcIds)) return link.kcIds;
  if (Array.isArray(link.linkedKcIds)) return link.linkedKcIds;
  if (Array.isArray(link.kcs)) return link.kcs;
  return [];
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
    // 连接键优先用稳定键 subtasks.id（写侧落库时回填，见 stage-enrichment）；旧标注无 id 时回退标题。
    // 回退也必须**收集全部同键链接**而非取首条——同一标题的不同任务各有一条链接，
    // `find` 取首条会把别的任务的 KC 挂到本任务上（静默挂错，比丢失更难发现）。
    const taskIdKey = normalizeConcept(typeof task?.id === 'string' ? task.id : null);
    const matchedById = taskIdKey
      ? taskKcLinks.filter((link: any) => normalizeConcept(typeof link?.taskId === 'string' ? link.taskId : null) === taskIdKey)
      : [];
    const normalizedTaskTitle = taskTitleKey(task?.title);
    const matched = matchedById.length > 0
      ? matchedById
      : (normalizedTaskTitle
        ? taskKcLinks.filter((link: any) => taskTitleKey(link?.taskTitle) === normalizedTaskTitle)
        : []);
    // 同键多条时取并集（保序去重），不再只取首条
    const seenKc = new Set<string>();
    const linkedKcIds: unknown[] = [];
    for (const link of matched) {
      for (const kcId of linkedKcIdsOf(link)) {
        const key = normalizeConcept(typeof kcId === 'string' ? kcId : null);
        if (!key || seenKc.has(key)) continue;
        seenKc.add(key);
        linkedKcIds.push(kcId);
      }
    }
    if (linkedKcIds.length === 0) return [];
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


