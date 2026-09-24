/**
 * KC 映射（kc-mapper）执行与持久化：stage-designer 全部完成后调用。
 *
 * 将认知核心与子任务分解为知识组件（KC）+ 前置依赖图，写回
 * learning_paths.aiPromptTemplate.kcAnnotation，供 teaching-turn 按 KC 粒度消费
 * （TeachingContextBuilder.resolveTaskKcsFromPath 的 taskKcs 数据源）。
 *
 * **契约事故修复（2026-09-22）**：此前这里用 `executeSkill`（返回 output 本体）
 * 却按 `executeSkillWithResult` 的 `{ success, output }` 判空，条件恒为 false——
 * KC 图每次路径生成都算完然后静默丢弃，全库 252 条路径 kcAnnotation 实测全为
 * null，"写后无读者"反变成"写没人接"。本模块统一收口到 WithResult 契约，并经
 * 注入点（callSkill/persist）可测。
 *
 * best-effort 语义（与原内联实现逐行为等价）：skill 抛错 / success:false /
 * output 为空 / 持久化失败，全部只 warn，不阻断路径生成。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { executeSkillWithResult } from '../../../skills';
import type { SkillDefinition } from '../../../skills/protocol';
import { kcMapperDefinition } from '../../../skills/kc-mapper';
import { parsePathPromptTemplate } from '../learning.helpers';
import { conceptGraphService, type MaterializeResult } from '../../learner/concept-graph.service';

export interface KcAnnotationMilestone {
  stageNumber: number;
  title: string;
  coreConcept?: string | null;
  description?: string | null;
  goal?: string | null;
}

export interface KcAnnotationSubtask {
  title: string;
  type?: string;
  linkedConcept?: string | null;
  knowledgeType?: string | null;
  cognitiveLevel?: string | null;
}

/** cognitiveCore / cognitiveDesign 均可作映射输入（模块只取 prerequisiteTree 与整体透传） */
export interface KcCognitiveCoreLike {
  prerequisiteTree?: unknown;
  [key: string]: unknown;
}

/** kc-mapper 的 LLM 输出（契约字段 + 宽松索引签名，容忍 prompt 演进新增字段） */
export interface KcAnnotation {
  conceptKcs?: Array<Record<string, unknown>>;
  taskKcLinks?: Array<Record<string, unknown>>;
  gapCoverage?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 按 key 去重合并数组（后者覆盖同 key 项）。 */
function unionByKey<T extends Record<string, unknown>>(previous: T[], incoming: T[], keyOf: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = keyOf(item);
    if (!key) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function stableKeyOf(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const record = item as Record<string, unknown>;
  return String(record.kcId ?? record.taskTitle ?? record.conceptId ?? record.name ?? '');
}

/**
 * 渐进式设计的 KC 增量合并（活的 path 批次 D3）：把**单阶段**的 kc-mapper 输出合并进
 * 既有标注。顶层字段（conceptKcs/taskKcLinks/kcGraph）保持与 v1 相同形状的**并集**——
 * 读侧（TeachingContextBuilder.resolveTaskKcsFromPath 按 taskTitle 匹配）零改动兼容；
 * `byStage` 额外保留每阶段快照（渐进审计与未来按阶段读取）；v1 旧标注（无 version）
 * 首次合并时整体快照进 `byStage.legacy`，避免阶段归属不明的内容被静默丢弃。
 * 合并是纯函数：幂等（同输入重复合并结果不变）、不丢其他阶段的条目。
 */
export function mergeKcStageAnnotation(
  current: KcAnnotation | null | undefined,
  stageNumber: number,
  stageOutput: KcAnnotation
): KcAnnotation {
  const previous: KcAnnotation = current && typeof current === 'object' ? current : {};
  const previousByStage = previous.byStage && typeof previous.byStage === 'object'
    ? (previous.byStage as Record<string, KcAnnotation>)
    : {};
  const byStage: Record<string, KcAnnotation> = { ...previousByStage };
  if (previous.version !== 2 && (previous.conceptKcs?.length || previous.taskKcLinks?.length)) {
    // v1 → v2 升级：旧整包无阶段归属，快照为 legacy 供追溯（读侧并集仍含其条目）
    byStage.legacy = previous;
  }
  byStage[String(stageNumber)] = stageOutput;

  const previousGraph = previous.kcGraph && typeof previous.kcGraph === 'object'
    ? (previous.kcGraph as Record<string, unknown>)
    : {};
  const incomingGraph = stageOutput.kcGraph && typeof stageOutput.kcGraph === 'object'
    ? (stageOutput.kcGraph as Record<string, unknown>)
    : {};
  const previousNodes = Array.isArray(previousGraph.nodes) ? previousGraph.nodes as Array<Record<string, unknown>> : [];
  const incomingNodes = Array.isArray(incomingGraph.nodes) ? incomingGraph.nodes as Array<Record<string, unknown>> : [];
  const previousEdges = Array.isArray(previousGraph.edges) ? previousGraph.edges as Array<Record<string, unknown>> : [];
  const incomingEdges = Array.isArray(incomingGraph.edges) ? incomingGraph.edges as Array<Record<string, unknown>> : [];

  return {
    ...previous,
    version: 2,
    byStage,
    conceptKcs: unionByKey(previous.conceptKcs || [], stageOutput.conceptKcs || [], stableKeyOf),
    taskKcLinks: unionByKey(previous.taskKcLinks || [], stageOutput.taskKcLinks || [], (item) =>
      `${stableKeyOf(item)}::${Array.isArray(item?.linkedKCs) ? (item.linkedKCs as unknown[]).map(String).sort().join(',') : ''}`),
    kcGraph: {
      ...previousGraph,
      nodes: unionByKey(previousNodes, incomingNodes, (node) => String(node?.kcId ?? '')),
      edges: unionByKey(previousEdges, incomingEdges, (edge) =>
        `${edge.from ?? ''}->${edge.to ?? ''}:${edge.type ?? ''}`),
    },
    ...(stageOutput.gapCoverage ? { gapCoverage: stageOutput.gapCoverage } : {}),
  };
}

/** 已解析 aiPromptTemplate 的最小视图 */
export interface KcAnnotationTemplate {
  cognitiveCore?: KcCognitiveCoreLike | null;
  cognitiveDesign?: KcCognitiveCoreLike | null;
  [key: string]: unknown;
}

/** 与 executeSkillWithResult 的返回契约对齐的最小形状（缺失即视为无输出） */
export interface KcSkillResult {
  success: boolean;
  output?: KcAnnotation | null;
  quality?: string;
}

export interface KcAnnotationParams {
  pathId: string;
  /** 日志关联用（可选） */
  userId?: string;
  /** 已解析的 aiPromptTemplate（取 cognitiveCore / cognitiveDesign 作映射输入） */
  template: KcAnnotationTemplate | null;
  milestones: KcAnnotationMilestone[];
  subtasks: KcAnnotationSubtask[];
  /** 测试注入：skill 调用（默认 executeSkillWithResult） */
  callSkill?: (definition: unknown, input: unknown) => Promise<KcSkillResult>;
  /** 测试注入：落库回调（默认读-合并-写回 aiPromptTemplate） */
  persist?: (pathId: string, kcAnnotation: KcAnnotation) => Promise<void>;
  /** 测试注入：概念图物化（默认 conceptGraphService.materializePathGraph） */
  materialize?: (params: {
    userId: string; pathId: string; kcAnnotation: KcAnnotation; cognitiveCore: KcCognitiveCoreLike | null;
  }) => Promise<MaterializeResult>;
}

/**
 * 默认落库：读当前模板为基底、只覆盖 kcAnnotation，避免并发写互相覆盖。
 *
 * 导出供**身份迁移**复用（`src/scripts/kc-identity-migrate.ts`）：迁移必须先拿到模型输出、
 * 据此登记别名，再把**同一份**标注落库——kc-mapper 是 temperature 0.3，重跑一次名字就会变，
 * 别名与落库标注必须同源，否则登记的别名指向一批不存在的名字。
 */
export async function persistKcAnnotationToPath(pathId: string, kcAnnotation: KcAnnotation): Promise<void> {
  const currentPath = await prisma.learning_paths.findUnique({
    where: { id: pathId },
    select: { aiPromptTemplate: true },
  });
  const currentTemplate = parsePathPromptTemplate(currentPath?.aiPromptTemplate || null);
  await prisma.learning_paths.update({
    where: { id: pathId },
    data: {
      aiPromptTemplate: JSON.stringify({ ...(currentTemplate || {}), kcAnnotation }),
      updatedAt: new Date(),
    },
  });
}

/**
 * 执行 KC 映射并持久化。返回落库的标注（失败/无输出返回 null，调用方无需判空分支）。
 */
export async function mapAndPersistKcAnnotation(params: KcAnnotationParams): Promise<KcAnnotation | null> {
  const { pathId, userId, template, milestones, subtasks, callSkill, persist, materialize } = params;
  const cognitiveCore: KcCognitiveCoreLike | null = template?.cognitiveCore || template?.cognitiveDesign || null;

  let kcAnnotation: KcAnnotation | null = null;
  try {
    const runSkill: (definition: unknown, input: unknown) => Promise<KcSkillResult> =
      callSkill ?? ((definition, input) => executeSkillWithResult(definition as SkillDefinition, input));
    const kcResult = await runSkill(kcMapperDefinition, {
      cognitiveCore,
      milestones: milestones.map((m) => ({
        stageNumber: m.stageNumber,
        title: m.title,
        coreConcept: m.coreConcept,
        description: m.description,
        goal: m.goal,
      })),
      subtasks: subtasks.map((t) => ({
        title: t.title,
        type: t.type,
        linkedConcept: t.linkedConcept,
        knowledgeType: t.knowledgeType,
        cognitiveLevel: t.cognitiveLevel,
      })),
      prerequisiteTree: cognitiveCore?.prerequisiteTree || null,
    });

    if (kcResult?.success && kcResult?.output) {
      kcAnnotation = kcResult.output;
      logger.info('[kc-mapper] KC 映射完成', {
        userId,
        pathId,
        kcCount: kcAnnotation?.conceptKcs?.length || 0,
      });
    } else {
      logger.warn('[kc-mapper] 映射无有效输出（best-effort，跳过持久化）', {
        pathId,
        quality: kcResult?.quality ?? null,
      });
    }
  } catch (kcError) {
    logger.warn('[kc-mapper] 映射失败（best-effort，不阻断路径生成）', {
      userId,
      pathId,
      error: kcError instanceof Error ? kcError.message : String(kcError),
    });
  }

  if (!kcAnnotation) return null;

  try {
    await (persist || persistKcAnnotationToPath)(pathId, kcAnnotation);
    logger.info('[kc-mapper] KC 映射已持久化到 aiPromptTemplate', {
      pathId,
      kcCount: kcAnnotation?.conceptKcs?.length || 0,
      taskKcLinkCount: kcAnnotation?.taskKcLinks?.length || 0,
    });

    // 概念图物化（L2）：把 kcGraph.edges（前置）与 conceptKcs 嵌套（part_of）搬进 concept_edges。
    // 独立 try：图物化失败不得影响已成功的 JSON 落库（best-effort，与整体语义一致）。
    if (userId) {
      try {
        const runMaterialize = materialize ?? ((p) => conceptGraphService.materializePathGraph(p));
        const graph = await runMaterialize({ userId, pathId, kcAnnotation, cognitiveCore });
        logger.info('[kc-mapper] 概念图已物化到 concept_edges', { pathId, ...graph });
      } catch (graphError) {
        logger.warn('[kc-mapper] 概念图物化失败（best-effort，不阻断路径生成）', {
          pathId,
          error: graphError instanceof Error ? graphError.message : String(graphError),
        });
      }
    } else {
      logger.warn('[kc-mapper] 缺 userId，跳过概念图物化', { pathId });
    }
  } catch (persistError) {
    logger.warn('[kc-mapper] KC 映射持久化失败（best-effort，不阻断路径生成）', {
      userId,
      pathId,
      error: persistError instanceof Error ? persistError.message : String(persistError),
    });
  }

  return kcAnnotation;
}
