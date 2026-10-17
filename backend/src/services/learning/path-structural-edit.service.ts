/**
 * 路径结构编辑执行器（#64 P-39，2026-10-17）。
 *
 * 背景：学习者在课堂/路径页只能等 AI 重排（`requestPathReplan`），没有「插一个任务 / 延长任务 /
 * 缩短任务」的手动执行入口；同时「谁定义任务顺序」有两套来源（模型输出顺序 vs `subtasks.order`）
 * 未统一。本模块给出唯一执行器与唯一顺序权威：
 *
 * - **顺序权威 = `milestones.subtasks.order`**（同阶段内 0..n-1 连续）。插入/删除后在本事务内
 *   重排，读侧一律按 order 排序，不再依赖模型输出的数组次序。
 * - 只允许改**进行中的路径**与**未开始/进行中但无开放课堂**的任务；已完成任务冻结。
 * - 结构编辑不调 LLM、不重写任务正文；插入的任务是用户/运营给的纯数据。
 *
 * 与 replan 的分工：replan 是「AI 建议 + 确认后批量重排」；本模块是「用户明确的手动微调」，
 * 两者都经过 path-mutation-safety 的开放课堂检查，语义不重叠。
 */
import prisma from '../../config/database';
import { withTransaction } from '../../utils/with-transaction';
import { assertPathMutationSafe, PathMutationConflictError } from './path-mutation-safety';

export type PathStructuralEditInput =
  | {
      op: 'insert_task';
      pathId: string;
      userId: string;
      milestoneId: string;
      /** 插入到该任务之后；缺省 = 阶段末尾 */
      afterTaskId?: string;
      title: string;
      description?: string;
      taskType?: string;
      estimatedMinutes?: number;
      cognitiveLoad?: 'low' | 'medium' | 'high';
      learningObjectives?: string[];
    }
  | {
      op: 'extend_task' | 'shrink_task';
      pathId: string;
      userId: string;
      taskId: string;
      deltaMinutes: number;
    }
  | {
      op: 'delete_task';
      pathId: string;
      userId: string;
      taskId: string;
    };

export interface PathStructuralEditResult {
  op: PathStructuralEditInput['op'];
  pathId: string;
  milestoneId: string;
  /** 编辑后的阶段任务（按 order 升序） */
  tasks: Array<{
    id: string;
    title: string;
    order: number;
    status: string;
    estimatedMinutes: number;
  }>;
}

/**
 * 本模块用到的事务客户端形状（只列实际调用的方法）。
 * 用结构性类型而不是 any：换 Prisma 版本/改调用时编译期能发现，且 lint 不放行裸 any。
 */
type StructuralEditTaskRow = {
  id: string;
  title: string;
  order: number;
  status: string;
  estimatedMinutes: number;
  milestoneId: string;
};
type StructuralEditTx = {
  milestones: { findFirst(args: unknown): Promise<{ id: string } | null> };
  subtasks: {
    findMany(args: unknown): Promise<StructuralEditTaskRow[]>;
    findFirst(args: unknown): Promise<StructuralEditTaskRow | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
  };
  teaching_sessions: { findMany(args: unknown): Promise<unknown[]>; findFirst(args: unknown): Promise<unknown> };
  learner_evidence: { findFirst(args: unknown): Promise<unknown> };
};

const MIN_TASK_MINUTES = 5;
const MAX_TASK_MINUTES = 600;

function normalizeMinutes(value: unknown, fallback = 30): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_TASK_MINUTES, Math.max(MIN_TASK_MINUTES, Math.round(parsed)));
}

function normalizeTitle(value: unknown): string {
  const title = String(value || '').trim();
  if (!title) {
    throw new PathMutationConflictError('任务标题不能为空', 'PATH_STRUCTURAL_EDIT_TITLE_REQUIRED');
  }
  return title.slice(0, 120);
}

async function loadEditableTask(
  tx: StructuralEditTx,
  pathId: string,
  taskId: string,
): Promise<{ id: string; milestoneId: string; status: string; estimatedMinutes: number; title: string }> {
  const task = await tx.subtasks.findFirst({
    where: { id: taskId, milestones: { learningPathId: pathId } },
    select: { id: true, milestoneId: true, status: true, estimatedMinutes: true, title: true },
  });
  if (!task) {
    throw new PathMutationConflictError('任务不存在或不属于该路径', 'PATH_STRUCTURAL_EDIT_TASK_NOT_FOUND');
  }
  if (task.status === 'completed') {
    throw new PathMutationConflictError(
      '已完成的任务不能修改（保留历史结算口径）',
      'PATH_STRUCTURAL_EDIT_TASK_COMPLETED',
    );
  }
  return task;
}

async function reindexTaskOrder(tx: StructuralEditTx, milestoneId: string): Promise<void> {
  const tasks = await tx.subtasks.findMany({
    where: { milestoneId },
    orderBy: { order: 'asc' },
    select: { id: true, order: true },
  });
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index].order === index) continue;
    await tx.subtasks.update({ where: { id: tasks[index].id }, data: { order: index } });
  }
}

async function listMilestoneTasks(tx: StructuralEditTx, milestoneId: string): Promise<PathStructuralEditResult['tasks']> {
  const tasks = await tx.subtasks.findMany({
    where: { milestoneId },
    orderBy: { order: 'asc' },
    select: { id: true, title: true, order: true, status: true, estimatedMinutes: true },
  });
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    order: task.order,
    status: task.status,
    estimatedMinutes: task.estimatedMinutes,
  }));
}

/**
 * 执行一次结构编辑。返回该阶段编辑后的任务列表（前端可原地替换，不整页刷新）。
 */
export async function applyPathStructuralEdit(input: PathStructuralEditInput): Promise<PathStructuralEditResult> {
  const path = await prisma.learning_paths.findUnique({
    where: { id: input.pathId },
    select: { id: true, userId: true, status: true },
  });
  if (!path) {
    throw new PathMutationConflictError('学习路径不存在', 'PATH_STRUCTURAL_EDIT_PATH_NOT_FOUND');
  }
  if (path.userId !== input.userId) {
    throw new PathMutationConflictError('无权访问此学习路径', 'PATH_STRUCTURAL_EDIT_FORBIDDEN');
  }
  if (path.status !== 'active') {
    throw new PathMutationConflictError(
      '只有进行中的路径可以手动调整任务',
      'PATH_STRUCTURAL_EDIT_PATH_NOT_ACTIVE',
    );
  }

  return withTransaction(async (tx) => {
    if (input.op === 'insert_task') {
      const milestone = await tx.milestones.findFirst({
        where: { id: input.milestoneId, learningPathId: input.pathId },
        select: { id: true },
      });
      if (!milestone) {
        throw new PathMutationConflictError('阶段不存在或不属于该路径', 'PATH_STRUCTURAL_EDIT_STAGE_NOT_FOUND');
      }
      // 开放课堂检查收在阶段范围：正在上课时插任务会让当轮上下文与看板错位
      await assertPathMutationSafe(tx, input.pathId, 'replan-stage', { milestoneId: input.milestoneId });

      const tasks = await tx.subtasks.findMany({
        where: { milestoneId: input.milestoneId },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      let insertIndex = tasks.length;
      if (input.afterTaskId) {
        const afterIndex = tasks.findIndex((task) => task.id === input.afterTaskId);
        if (afterIndex < 0) {
          throw new PathMutationConflictError(
            '插入位置的任务不在该阶段',
            'PATH_STRUCTURAL_EDIT_AFTER_TASK_NOT_FOUND',
          );
        }
        insertIndex = afterIndex + 1;
      }
      // 先给插入位之后的旧任务腾位（order+1），再插入，最后统一归一化
      for (let index = insertIndex; index < tasks.length; index += 1) {
        await tx.subtasks.update({
          where: { id: tasks[index].id },
          data: { order: tasks[index].order + 1 },
        });
      }
      const now = new Date();
      await tx.subtasks.create({
        data: {
          id: `st_manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          milestoneId: input.milestoneId,
          userId: input.userId,
          title: normalizeTitle(input.title),
          description: String(input.description || '').trim(),
          taskType: String(input.taskType || 'practice').trim() || 'practice',
          estimatedMinutes: normalizeMinutes(input.estimatedMinutes),
          acceptanceCriteria: '',
          order: insertIndex,
          status: 'todo',
          cognitiveLoad: input.cognitiveLoad || 'medium',
          learningObjectives: input.learningObjectives?.length
            ? JSON.stringify(input.learningObjectives.map((item) => String(item)).filter(Boolean))
            : null,
          updatedAt: now,
        },
      });
      await reindexTaskOrder(tx, input.milestoneId);
      return {
        op: input.op,
        pathId: input.pathId,
        milestoneId: input.milestoneId,
        tasks: await listMilestoneTasks(tx, input.milestoneId),
      };
    }

    const task = await loadEditableTask(tx, input.pathId, input.taskId);
    // 延长/缩短/删除都改动学习安排：有开放课堂时拒绝，避免当轮任务时长与看板不一致
    await assertPathMutationSafe(tx, input.pathId, 'replan-stage', { milestoneId: task.milestoneId });

    if (input.op === 'delete_task') {
      if (task.status !== 'todo') {
        throw new PathMutationConflictError(
          '只能删除尚未开始的任务',
          'PATH_STRUCTURAL_EDIT_DELETE_NOT_TODO',
        );
      }
      await tx.subtasks.delete({ where: { id: task.id } });
      await reindexTaskOrder(tx, task.milestoneId);
      return {
        op: input.op,
        pathId: input.pathId,
        milestoneId: task.milestoneId,
        tasks: await listMilestoneTasks(tx, task.milestoneId),
      };
    }

    const delta = Math.max(1, Math.round(Number(input.deltaMinutes)));
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new PathMutationConflictError('时长变更必须为正整数分钟', 'PATH_STRUCTURAL_EDIT_DELTA_INVALID');
    }
    const signedDelta = input.op === 'extend_task' ? delta : -delta;
    const nextMinutes = Math.min(
      MAX_TASK_MINUTES,
      Math.max(MIN_TASK_MINUTES, task.estimatedMinutes + signedDelta),
    );
    if (nextMinutes === task.estimatedMinutes) {
      throw new PathMutationConflictError(
        `任务时长已在 ${MIN_TASK_MINUTES}-${MAX_TASK_MINUTES} 分钟边界内，无法再${input.op === 'extend_task' ? '延长' : '缩短'}`,
        'PATH_STRUCTURAL_EDIT_MINUTES_AT_BOUNDARY',
      );
    }
    await tx.subtasks.update({
      where: { id: task.id },
      data: { estimatedMinutes: nextMinutes, updatedAt: new Date() },
    });
    return {
      op: input.op,
      pathId: input.pathId,
      milestoneId: task.milestoneId,
      tasks: await listMilestoneTasks(tx, task.milestoneId),
    };
  });
}
