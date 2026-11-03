/**
 * 跨阶段复读闸（2026-11-02 实测驱动；2026-11-03 从 stage-enrichment.ts 拆出）。
 *
 * 背景：`detectCrossStageFiller` 早就能算出「M1-2 与 M2-1 相似度 0.739」，但它按设计只观测不阻断，
 * 主生成路径上没有执行动作——于是「阶段 1 教非谓语动词、阶段 3 又重新排一遍同一批对话」照旧落库。
 * 这里补上执行：后一阶段若与前序阶段近似同题（titlesTooClose：≥阈值或 ≥6 字公共前缀），直接删除。
 * 与本轮预算口径收紧同向——`targetSubtasksForStage` 已是上限，删掉复读课即自然收敛到内容真实长度。
 *
 * 拆出原因：`stage-enrichment.ts` 已超基线且只许缩短（超大文件棘轮），而这一簇是自洽的一步后处理，
 * 不依赖该函数体内除 `pathId` 之外的任何状态。
 */
import { dropCrossStageDuplicates } from './stage-subtask-quality';
import { logger } from '../../../utils/logger';

/**
 * 阈值（2026-11-02）：0.72 与 `detectCrossStageFiller` 的观测阈值(0.7)同量级，
 * 略微收紧以免误删合法的「同对象第二遍带整合视角」；titlesTooClose 另含「≥6 字公共前缀/互为包含」判据。
 */
export const CROSS_STAGE_DEDUP_THRESHOLD = 0.72;

/**
 * 存量侧输入：库里已有的前序阶段任务标题。
 *
 * 追加/渐进模式下方会把 `learningPath.milestones` 过滤成本次目标阶段，过滤后内存里看不到更早阶段，
 * 所以先留一份快照，让新阶段仍能与「库里已有的前序阶段」比对（否则跨阶段闸对历史阶段失效）。
 */
export function buildExistingStageTitles(
  milestones: readonly Record<string, any>[],
): Map<number, string[]> {
  return new Map<number, string[]>(
    milestones.map((milestone) => [
      Number(milestone.stageNumber),
      (((milestone.subtasks as any[]) || [])
        .map((task) => String(task?.title || '').trim())
        .filter((title: string) => title.length > 0)),
    ]),
  );
}

/** 闸门需要的最小形状（stageDesignOutputs 的元素）。 */
export interface StageDesignLike {
  stageNumber: number;
  subtasks: any[];
}

/**
 * 执行跨阶段复读闸：就地改写 `stageDesignOutputs` 里各阶段的 subtasks，返回删除条数。
 * 返回 0 表示无复读（调用方可据此跳过后续处理，日志也只在真有删除时打）。
 */
export function applyCrossStageDedup(input: {
  pathId: string;
  existingStageTitles: Map<number, string[]>;
  stageDesignOutputs: StageDesignLike[];
}): number {
  const { pathId, existingStageTitles, stageDesignOutputs } = input;
  const designedByNumber = new Map(stageDesignOutputs.map((stage) => [stage.stageNumber, stage]));
  const dedupStages = [...new Set([
    ...existingStageTitles.keys(),
    ...designedByNumber.keys(),
  ])].sort((a, b) => a - b).map((stageNumber) => {
    const designed = designedByNumber.get(stageNumber);
    return {
      stageNumber,
      subtasks: designed
        ? designed.subtasks
        : (existingStageTitles.get(stageNumber) || []).map((title) => ({ title })),
    };
  });
  const dedup = dropCrossStageDuplicates(dedupStages, { threshold: CROSS_STAGE_DEDUP_THRESHOLD });
  if (dedup.dropped.length === 0) return 0;
  for (const stage of dedup.stages) {
    const target = designedByNumber.get(stage.stageNumber);
    if (target) target.subtasks = stage.subtasks;
  }
  logger.warn('[stage-cross-stage-dedup] 删除跨阶段复读任务', {
    pathId,
    dropped: dedup.dropped.length,
    designedTasks: stageDesignOutputs.reduce((n, stage) => n + stage.subtasks.length, 0),
    samples: dedup.dropped.slice(0, 5).map(
      (dropped) => `M${dropped.stageNumber}「${dropped.title.slice(0, 22)}」≈M${dropped.duplicateOfStage}(${dropped.similarity})`,
    ),
  });
  return dedup.dropped.length;
}