/**
 * 路径重排的 KC 同步域（#168 / #192）。
 *
 * 重排重建任务后必须与生成链（stage-enrichment）同口径补齐三样东西，否则「调整本阶段」
 * 会让新任务丢了 canonical 身份与教学侧消费的 sidecar：
 *   ① subtasks.conceptId（图谱/掌握度 join 的键）——事务外预解析（SQLite 事务持写锁，
 *      事务内再写 concepts/aliases 会撞锁，见 stage-enrichment 同段注释）；
 *   ② aiPromptTemplate.materialRefs.byTask / misconceptionHints.byTask（按新 subtaskId）；
 *   ③ aiPromptTemplate.kcAnnotation（taskKcLinks / conceptKcs / kcGraph）+ 概念图重物化，
 *      否则新任务在 teaching 侧 resolveTaskKcsFromPath 恒为空（旧任务的死链还留在模板里）。
 * 每个新任务分配稳定 taskKey（「阶段-序号」），随 kc-mapper 输入下发并要求逐字回显，
 * 落库时据它把 taskKcLinks 绑到真实 subtasks.id（issue #179 的既有做法）。
 *
 * 本模块只承载上述「预解析 + 合并 + 重物化」逻辑，service 只负责在正确的时点调用：
 * 事务外 prepare → 事务内 reset/record/merge → 事务提交后 materialize。
 */
import { logger } from '../../../utils/logger';
import { executeSkillWithResult } from '../../../skills';
import { kcMapperDefinition } from '../../../skills/kc-mapper';
import { resolveTaskConcept } from '../learning.helpers';
import { conceptRegistryService } from '../../learner/concept-registry.service';
import { conceptGraphService } from '../../learner/concept-graph.service';
import { buildPathSandboxPool, checkAgentSandboxRefs } from '../../sandbox-resolver.service';
import { normalizeConceptKey } from '../../memory/concept-key';
import {
  bindKcLinksToSubtaskIds,
  mergeKcStageAnnotation,
  type KcAnnotation,
} from '../generation/kc-annotation';

/** 一次重排阶段的 KC 同步上下文（事务可能重试，收集器在事务内 reset 后重建）。 */
export interface ReplanKcSync {
  resolvedConcepts: ReturnType<typeof resolveTaskConcept>[];
  canonicalConceptIdsByName: Map<string, string>;
  stageKcAnnotation: KcAnnotation | null;
  cognitiveCore: any;
  taskKeyOf: (index: number) => string;
  subtaskIdByTaskKey: Map<string, string>;
  materialRefsByTask: Record<string, any[]>;
  misconceptionHintsByTask: Record<string, any[]>;
  /** 仅在本次真的合并了新 KC 输出时非空，供事务提交后重物化概念图 */
  kcAnnotationForGraph: KcAnnotation | null;
}

/**
 * 事务外准备：解析 canonical 概念身份、跑 kc-mapper、做沙盘 ref 对账。
 * 都是 best-effort——失败只告警，不阻断重排（conceptId 留空 / 沿用既有 kcAnnotation）。
 */
export async function prepareReplanKcSync(input: {
  userId: string;
  pathId: string;
  stageNumber: number;
  newTasks: any[];
  pathCognitiveDesign: any;
  parsedTemplate: any;
  sortedMilestones: any[];
  normalizedInput: any;
  stageDesignerInput: any;
  skipSandboxAudit: boolean;
}): Promise<ReplanKcSync> {
  const resolvedConcepts = input.newTasks.map((taskData: any) =>
    resolveTaskConcept(
      typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
      input.pathCognitiveDesign,
      typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
    )
  );
  const taskKeyOf = (index: number) => `replan-${input.stageNumber}-${index + 1}`;

  const canonicalConceptIdsByName = new Map<string, string>();
  try {
    const conceptNames = resolvedConcepts
      .map((resolved) => (resolved.conceptSource === 'linked-concept' ? resolved.linkedConceptName : null))
      .filter((name): name is string => !!name && !!name.trim());
    if (conceptNames.length > 0) {
      const resolved = await conceptRegistryService.resolveMany(input.userId, conceptNames, {
        source: 'write_time',
        level: 'concept',
        originPathId: input.pathId,
      });
      for (const [key, conceptId] of resolved) canonicalConceptIdsByName.set(key, conceptId);
    }
  } catch (error) {
    logger.warn('[path-replan] 任务概念身份预解析失败（best-effort，conceptId 留空）', {
      pathId: input.pathId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // kc-mapper：对本阶段新任务重跑映射（best-effort，失败不阻断重排）。
  // 与生成链的渐进路径同口径：输入看全路径里程碑 + 本阶段新任务，结果按阶段增量合并进
  // 既有 kcAnnotation（整包替换会抹掉其他阶段已设计的 taskKcLinks）。
  const replanCognitiveCore = input.parsedTemplate?.cognitiveCore
    || input.parsedTemplate?.cognitiveDesign
    || null;
  let stageKcAnnotation: KcAnnotation | null = null;
  const kcMapperInput = {
    cognitiveCore: replanCognitiveCore,
    milestones: input.sortedMilestones.map((m: any) => ({
      stageNumber: m.stageNumber,
      title: m.title,
      coreConcept: m.coreConceptName || m.coreConceptId,
      description: m.description,
      goal: m.goal,
    })),
    subtasks: input.newTasks.map((taskData: any, index: number) => ({
      taskKey: taskKeyOf(index),
      title: taskData.title,
      type: taskData.type,
      linkedConcept: taskData.linkedConcept,
      knowledgeType: taskData.knowledgeType,
      cognitiveLevel: taskData.cognitiveLevel,
    })),
    prerequisiteTree: (replanCognitiveCore as any)?.prerequisiteTree || null,
  };
  try {
    const kcResult = await executeSkillWithResult(kcMapperDefinition, kcMapperInput);
    stageKcAnnotation = kcResult?.success && kcResult?.output ? (kcResult.output as KcAnnotation) : null;
  } catch (error) {
    logger.warn('[path-replan] KC 映射失败（best-effort）', {
      pathId: input.pathId,
      stageNumber: input.stageNumber,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!stageKcAnnotation) {
    logger.warn('[path-replan] KC 映射无有效输出，重排后新任务将没有 taskKcLinks', {
      pathId: input.pathId,
      stageNumber: input.stageNumber,
    });
  }

  // #192：stage-designer / kc-mapper 纳入沙盘 ref 运行期对账（真实载荷即池）。
  // 多阶段重排逐阶段调用本函数，只在首个阶段做一次（与 contentSnapshot 同口径）。
  if (!input.skipSandboxAudit) {
    try {
      await checkAgentSandboxRefs(
        'stage-designer',
        'path',
        buildPathSandboxPool(input.normalizedInput || {}, input.stageDesignerInput as any),
        { includeOptional: true, warnContext: { pathId: input.pathId, boundary: 'replan', stageNumber: input.stageNumber } }
      );
      await checkAgentSandboxRefs(
        'kc-mapper',
        'path',
        buildPathSandboxPool(input.normalizedInput || {}, kcMapperInput as any),
        { warnContext: { pathId: input.pathId, boundary: 'replan', stageNumber: input.stageNumber } }
      );
    } catch {
      // 对账是观测，不影响重排
    }
  }

  // 任务级 sidecar 收集器（key = 新 subtaskId；声明在事务外，事务重试时在事务内清空重建）
  return {
    resolvedConcepts,
    canonicalConceptIdsByName,
    stageKcAnnotation,
    cognitiveCore: replanCognitiveCore,
    taskKeyOf,
    subtaskIdByTaskKey: new Map<string, string>(),
    materialRefsByTask: {},
    misconceptionHintsByTask: {},
    kcAnnotationForGraph: null,
  };
}

/** 事务开始（含重试）时清空收集器，避免重复累加 / 残留上一轮的图标注。 */
export function resetReplanSyncCollectors(sync: ReplanKcSync): void {
  for (const key of Object.keys(sync.materialRefsByTask)) delete sync.materialRefsByTask[key];
  for (const key of Object.keys(sync.misconceptionHintsByTask)) delete sync.misconceptionHintsByTask[key];
  sync.subtaskIdByTaskKey.clear();
  sync.kcAnnotationForGraph = null;
}

/** 记录单个新任务的 taskKey→subtaskId 与任务级 sidecar（资料条目 / 迷思预判）。 */
export function recordReplanTaskSidecars(
  sync: ReplanKcSync,
  index: number,
  subtaskId: string,
  taskData: any,
): void {
  sync.subtaskIdByTaskKey.set(sync.taskKeyOf(index), subtaskId);
  // 任务 → 资料条目：按 subtaskId 落进 aiPromptTemplate.materialRefs.byTask（生成链同款）
  if (Array.isArray(taskData.materialRefs) && taskData.materialRefs.length) {
    sync.materialRefsByTask[subtaskId] = taskData.materialRefs;
  }
  // 任务 → 迷思预判：规范化后按 subtaskId 落进 aiPromptTemplate.misconceptionHints.byTask
  if (Array.isArray(taskData.anticipatedMisconceptions) && taskData.anticipatedMisconceptions.length) {
    sync.misconceptionHintsByTask[subtaskId] = taskData.anticipatedMisconceptions
      .map((hint: any) => ({
        conceptKey: typeof hint?.conceptKey === 'string' ? hint.conceptKey.trim() : '',
        label: typeof hint?.label === 'string' ? hint.label.trim() : '',
        why: typeof hint?.why === 'string' ? hint.why.trim() : '',
      }))
      .filter((hint: { conceptKey: string; label: string }) => hint.conceptKey && hint.label)
      .slice(0, 2);
  }
}

/** canonical 身份（#168）：事务外预解析；未命中留 null，回填脚本可补。 */
export function resolveReplanCanonicalConceptId(
  sync: ReplanKcSync,
  linkedConceptName: string | null | undefined,
): string | null {
  return sync.canonicalConceptIdsByName.get(normalizeConceptKey(linkedConceptName)) ?? null;
}

/**
 * 事务内合并：把本阶段 sidecar / KC 标注并入模板写回补丁，并清掉被删任务的旧键与死链。
 * 返回的补丁由 service 展开进 aiPromptTemplate（只含本阶段涉及的三个键）。
 */
export function buildReplanKcAnnotationPatch(
  txParsed: any,
  sync: ReplanKcSync,
  staleTaskIds: string[],
  stageNumber: number,
): Record<string, any> {
  // 资料引用 / 迷思预判 sidecar 合并（#168）：保留其他阶段的键，清掉被删任务的旧键，
  // 写入本阶段新任务的键——此前重排只清 taskAdjustability，这两份 sidecar 会一直挂着已删
  // subtaskId 的孤儿条目，而新任务零引用（教学侧读不到资料与迷思预判）。
  const mergedMaterialRefsByTask: Record<string, any[]> = {
    ...((txParsed?.materialRefs?.byTask && typeof txParsed.materialRefs.byTask === 'object')
      ? txParsed.materialRefs.byTask
      : {}),
    ...sync.materialRefsByTask,
  };
  const mergedMisconceptionHintsByTask: Record<string, any[]> = {
    ...((txParsed?.misconceptionHints?.byTask && typeof txParsed.misconceptionHints.byTask === 'object')
      ? txParsed.misconceptionHints.byTask
      : {}),
    ...sync.misconceptionHintsByTask,
  };
  for (const staleId of staleTaskIds) {
    delete mergedMaterialRefsByTask[staleId];
    delete mergedMisconceptionHintsByTask[staleId];
  }

  // KC 标注（#168）：本阶段重映射结果按阶段增量合并（不整包替换，避免抹掉其他阶段），
  // 并把 taskKcLinks 绑到新 subtasks.id；被删任务的死链一并清掉，
  // 否则模板里持续堆积无主 taskKcLinks（读侧按 id/title 都不命中）。
  let mergedKcAnnotation: KcAnnotation | null = txParsed?.kcAnnotation || null;
  if (sync.stageKcAnnotation) {
    const merged = mergeKcStageAnnotation(
      mergedKcAnnotation,
      stageNumber,
      sync.stageKcAnnotation,
    );
    mergedKcAnnotation = bindKcLinksToSubtaskIds(merged, sync.subtaskIdByTaskKey) as KcAnnotation | null;
  }
  // 无论 kc-mapper 是否成功，被删任务的死链都要清掉（否则模板里持续堆积无主 taskKcLinks，
  // 读侧按 id/title 都不命中）。其他阶段的链接与无 taskId 的旧标注保持原样。
  if (mergedKcAnnotation && Array.isArray(mergedKcAnnotation.taskKcLinks)) {
    const staleIdSet = new Set(staleTaskIds);
    mergedKcAnnotation = {
      ...mergedKcAnnotation,
      taskKcLinks: mergedKcAnnotation.taskKcLinks.filter((link: any) => {
        const taskId = typeof link?.taskId === 'string' ? link.taskId : null;
        return !taskId || !staleIdSet.has(taskId);
      }),
    };
  }
  // 仅在本次真的合并了新 KC 输出时重物化概念图（失败时沿用既有图，不做无意义重写）
  sync.kcAnnotationForGraph = sync.stageKcAnnotation ? mergedKcAnnotation : null;

  return {
    // #168：资料引用 / 迷思预判 sidecar（按新 subtaskId 键控，已清旧键）
    ...(Object.keys(mergedMaterialRefsByTask).length
      ? {
          materialRefs: {
            ...((txParsed?.materialRefs && typeof txParsed.materialRefs === 'object')
              ? txParsed.materialRefs
              : {}),
            byTask: mergedMaterialRefsByTask,
          },
        }
      : {}),
    ...(Object.keys(mergedMisconceptionHintsByTask).length
      ? {
          misconceptionHints: {
            ...((txParsed?.misconceptionHints && typeof txParsed.misconceptionHints === 'object')
              ? txParsed.misconceptionHints
              : {}),
            byTask: mergedMisconceptionHintsByTask,
          },
        }
      : {}),
    // #168：KC 标注（taskKcLinks 已绑新 subtasks.id；conceptKcs / kcGraph 同包）
    ...(mergedKcAnnotation ? { kcAnnotation: mergedKcAnnotation } : {}),
  };
}

/**
 * #168：概念图重物化（best-effort）。kcAnnotation 已随模板落库，这里把 kcGraph 前置边与
 * conceptKcs 的 part_of 嵌套搬进 concept_edges；失败不影响已提交的重排（与生成链同口径）。
 */
export async function materializeReplanConceptGraph(
  sync: ReplanKcSync,
  input: { userId: string; pathId: string; stageNumber: number },
): Promise<void> {
  const kcAnnotation = sync.kcAnnotationForGraph;
  if (!kcAnnotation) return;
  try {
    await conceptGraphService.materializePathGraph({
      userId: input.userId,
      pathId: input.pathId,
      kcAnnotation,
      cognitiveCore: sync.cognitiveCore,
    });
  } catch (graphError) {
    logger.warn('[path-replan] 概念图重物化失败（best-effort）', {
      pathId: input.pathId,
      stageNumber: input.stageNumber,
      error: graphError instanceof Error ? graphError.message : String(graphError),
    });
  }
}
