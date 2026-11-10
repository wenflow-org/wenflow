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
 * `isLocked`（2026-11-03 真人走查根因修复）：挑选**只按课次状态**是循环自证——锁定态是由
 * 「位置相对当前任务」推断的，而当前任务又由课次状态挑出。于是锁着阶段里只要有一条
 * in_progress（数据残留或异常即会出现），它就会被选中：页头「继续当前任务」指向它、点进去是
 * 「本节暂时开不了课」，而真正能学的待学课在行内反而没有入口。传入按**阶段解锁状态**得出的
 * 判定后，锁着阶段的课次不参与挑选；全部课次都被判定为锁定（整条路径还没解锁）时退回旧口径，
 * 保证不会挑出 null 让页面失去入口。
 *
 * 行类型宽松（两页传进来的都是Record<string, any> 原始行，字段缺失按下面口径兜底）。
 */
export function pickCurrentTask<T extends { id?: string; status?: string }>(
  list: readonly T[],
  isLocked?: (task: T) => boolean,
): T | null {
  const unlocked = typeof isLocked === 'function' ? list.filter((task) => !isLocked(task)) : list;
  const pool = unlocked.length > 0 ? unlocked : list;
  const inProgress = pool.find((t) => t.status === 'in_progress');
  if (inProgress) return inProgress;
  return pool.find((t) => t.status === 'todo' || !t.status) ?? null;
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

/** 组合式入口：传入拍平的任务列表 ref，得到归一化当前任务（isLocked 见 pickCurrentTask） */
export function useCurrentTask<T extends { id?: string; status?: string; title?: string; displayLabel?: string; description?: string; estimatedMinutes?: number; taskType?: string }>(list: Ref<readonly T[]>, isLocked?: (task: T) => boolean) {
  return computed<CurrentTask | null>(() => normalizeCurrentTask(pickCurrentTask(list.value, isLocked) as CurrentTaskLike | null));
}
