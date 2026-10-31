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
import { remapStageTaskReferences, repairForwardReferences } from '../path-planning-hints';

export interface PathStructureStage {
  stageNumber: number;
  subtasks: Array<{ title?: unknown; description?: unknown; type?: unknown }>;
}

/** 同阶段前置重排（原地修改 subtasks，保证 DB 与模板顺序一致）；返回重排的边数。 */
export function reorderStageTasks(
  stages: PathStructureStage[],
  kcAnnotation: PathAuditKcAnnotation | null | undefined,
): number {
  if (!kcAnnotation) return 0;
  let reorderedEdges = 0;
  for (const stage of stages) {
    // 快照重排前顺序：边重排会把任务挪位，拓扑重排时已改写的「任务 N / 上一步」
    // 引用会二次失配（R6 实证：A14 T2「用任务2标好的」自指）。挪动后必须再重映射一次。
    const before = [...stage.subtasks];
    const ordered = reorderTasksForPrerequisites(stage.subtasks, kcAnnotation);
    if (!ordered.changed) continue;
    const remapped = remapStageTaskReferences(before, ordered.tasks);
    const repaired = repairForwardReferences(remapped);
    const finalTasks = repaired.repaired.length > 0 ? repaired.tasks : remapped;
    stage.subtasks.splice(0, stage.subtasks.length, ...finalTasks);
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
