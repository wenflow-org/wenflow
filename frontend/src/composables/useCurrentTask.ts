import { computed, type Ref } from 'vue';

/** 任务行最小可用面（两页各自宽进严出：详情页用原始 task 对象，学习台用归一化结果） */
export interface CurrentTaskLike {
  id: string;
  title?: string;
  displayLabel?: string;
  description?: string;
  estimatedMinutes?: number;
  taskType?: string;
  status?: string;
}

/** 归一化后的「当前任务」：页面对外只依赖这个形状 */
export interface CurrentTask {
  id: string;
  title: string;
  desc: string;
  minutes?: number;
  kind: string;
  status: string;
}

/**
 * 「现在该学哪一课」的唯一挑选规则（决策链同源）。
 *
 * 规则：全局第一个 in_progress；否则全局第一个 todo（含无状态）；否则 null。
 *
 * 两个约束不能违反：
 * 1. 必须全局扫描、不能按周/阶段提前返回——周1 还有 todo、周2 已有 in_progress 时，
 *    正确选项是周2 那节（接着学），按周提前返回会选成周1 的旧任务；
 * 2. 调用方必须传入按路径顺序拍平的 task 列表（详情页 stages.flatMap，
 *    学习台 weeks.flatMap），顺序即学习顺序。
 *
 * 行类型宽松（两页传进来的都是Record<string, any> 原始行，字段缺失按下面口径兜底）。
 */
export function pickCurrentTask<T extends { id?: string; status?: string }>(list: readonly T[]): T | null {
  const inProgress = list.find((t) => t.status === 'in_progress');
  if (inProgress) return inProgress;
  return list.find((t) => t.status === 'todo' || !t.status) ?? null;
}

/** 原始 task 行 → 页面展示形状（标题/描述/分钟/类型各取一处） */
export function normalizeCurrentTask<T extends CurrentTaskLike>(t: T | null | undefined): CurrentTask | null {
  if (!t?.id) return null;
  return {
    id: t.id,
    title: t.title || t.displayLabel || '',
    desc: t.description || '',
    minutes: t.estimatedMinutes,
    kind: t.displayLabel || t.taskType || '任务',
    status: t.status || 'todo',
  };
}

/** 组合式入口：传入拍平的任务列表 ref，得到归一化当前任务 */
export function useCurrentTask<T extends { id?: string; status?: string; title?: string; displayLabel?: string; description?: string; estimatedMinutes?: number; taskType?: string }>(list: Ref<readonly T[]>) {
  return computed<CurrentTask | null>(() => normalizeCurrentTask(pickCurrentTask(list.value) as CurrentTaskLike | null));
}
