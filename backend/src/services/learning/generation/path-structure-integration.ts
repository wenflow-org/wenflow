/**
 * 生成期结构修复/审计的单一入口（2026-10-24）。
 *
 * stage-enrichment 只调用这两个小函数，避免把 40+ 行结构逻辑塞回已经很大的生成器
 * （services layering 棘轮：>1000 行文件只许缩短）。
 */
import {
  auditPathStructure,
  reorderTasksForPrerequisites,
  type PathAuditKcAnnotation,
  type PathAuditResult,
} from './path-structure-audit';

export interface PathStructureStage {
  stageNumber: number;
  subtasks: Array<{ title?: unknown; description?: unknown }>;
}

/** 同阶段前置重排（原地修改 subtasks，保证 DB 与模板顺序一致）；返回重排的边数。 */
export function reorderStageTasks(
  stages: PathStructureStage[],
  kcAnnotation: PathAuditKcAnnotation | null | undefined,
): number {
  if (!kcAnnotation) return 0;
  let reorderedEdges = 0;
  for (const stage of stages) {
    const ordered = reorderTasksForPrerequisites(stage.subtasks, kcAnnotation);
    if (!ordered.changed) continue;
    stage.subtasks.splice(0, stage.subtasks.length, ...ordered.tasks);
    reorderedEdges += ordered.reorderedEdges;
  }
  return reorderedEdges;
}

/** 生成后的结构审计（只记录；跨阶段依赖不移动任务）。 */
export function auditGeneratedPath(input: {
  stages: PathStructureStage[];
  kcAnnotation: PathAuditKcAnnotation | null | undefined;
  totalMinutes: number;
  afterHours: number | null;
  delivery: string | null;
}): PathAuditResult | null {
  if (!input.kcAnnotation) return null;
  return auditPathStructure({
    kcAnnotation: input.kcAnnotation,
    tasks: input.stages.flatMap((stage) =>
      stage.subtasks.map((task, index) => ({
        title: String(task?.title || ''),
        description: String(task?.description || ''),
        stageNumber: stage.stageNumber,
        order: index,
      })),
    ),
    totalMinutes: input.totalMinutes,
    afterHours: input.afterHours,
    delivery: input.delivery,
  });
}
