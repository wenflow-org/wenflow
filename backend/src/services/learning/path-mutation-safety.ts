export type PathMutationKind = 'replace-path' | 'replace-tasks' | 'replan-stage' | 'delete-path';

export interface PathMutationScope {
  milestoneId?: string;
  /** 多阶段重排：涉及的一组里程碑（乐观锁按范围校验） */
  milestoneIds?: string[];
  /** 显式整建（用户主动整条重建）：允许存在已完成任务（历史保留），仍拦截进行中任务与未结束课堂 */
  allowCompleted?: boolean;
  /** 用户刚通过「一键清场」放弃的课堂（已完成+wrapup 但仍允许被本次重排覆盖），
   *  仅限调用方显式声明（clearance 返回的 sessionId），用于完成「放弃→重排同一任务」闭环 */
  ignoreCompletedSessionIds?: string[];
}

export interface PathReplanSnapshot {
  milestoneId: string;
  milestoneStatus: string;
  milestoneUpdatedAt: Date;
  tasks: Array<{
    id: string;
    status: string;
    updatedAt: Date;
  }>;
}

/** 多阶段重排快照：对一组连续未完成阶段的乐观锁（取代逐阶段 claim 多次写库） */
export interface PathReplanRangeSnapshot {
  milestoneIds: string[];
  milestones: Array<{
    milestoneId: string;
    milestoneStatus: string;
    milestoneUpdatedAt: Date;
    tasks: Array<{
      id: string;
      status: string;
      updatedAt: Date;
    }>;
  }>;
}

const OPEN_TEACHING_SESSION_STATUSES = ['initializing', 'active', 'paused', 'timeout', 'finalizing'] as const;

const PATH_MUTATION_MESSAGES: Record<PathMutationKind, string> = {
  'replace-path': '学习路径已有学习进度，不能覆盖重新生成',
  'replace-tasks': '学习路径已有学习进度，不能重新生成阶段任务',
  'replan-stage': '学习路径仍有进行中的任务，不能调整后续阶段',
  'delete-path': '学习路径已有学习进度，不能删除'
};

export class PathMutationConflictError extends Error {
  readonly status = 409;

  constructor(
    message: string,
    readonly code: string,
    readonly details?: {
      /** 挡路课堂清单（PATH_MUTATION_HAS_OPEN_SESSION 时附带，供前端列出/一键收尾） */
      sessions?: Array<{
        sessionId: string;
        taskId: string;
        taskTitle: string | null;
        status: string;
        revision: number;
        topic: string | null;
        updatedAt: string | null;
      }>;
    }
  ) {
    super(message);
    this.name = 'PathMutationConflictError';
  }
}

export function createPathVersioningUnsupportedError(): PathMutationConflictError {
  return new PathMutationConflictError(
    '当前暂不支持创建学习路径新版本，请选择覆盖当前路径',
    'PATH_VERSIONING_NOT_SUPPORTED'
  );
}

export function isPathMutationConflictError(error: unknown): error is PathMutationConflictError {
  return error instanceof PathMutationConflictError
    || (typeof error === 'object'
      && error !== null
      && (error as any).status === 409
      && typeof (error as any).code === 'string'
      && (error as any).code.startsWith('PATH_'));
}

export function buildPathReplanSnapshot(milestone: any): PathReplanSnapshot {
  return {
    milestoneId: milestone.id,
    milestoneStatus: milestone.status,
    milestoneUpdatedAt: new Date(milestone.updatedAt),
    tasks: (milestone.subtasks || [])
      .map((task: any) => ({
        id: task.id,
        status: task.status,
        updatedAt: new Date(task.updatedAt),
      }))
      .sort((left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)),
  };
}

/** 构建多阶段重排快照（需按 stageNumber 升序传入） */
export function buildPathReplanRangeSnapshot(milestones: any[]): PathReplanRangeSnapshot {
  const entries = (milestones || []).map((milestone) => ({
    milestoneId: milestone.id,
    milestoneStatus: milestone.status,
    milestoneUpdatedAt: new Date(milestone.updatedAt),
    tasks: (milestone.subtasks || [])
      .map((task: any) => ({
        id: task.id,
        status: task.status,
        updatedAt: new Date(task.updatedAt),
      }))
      .sort((left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)),
  }));
  return {
    milestoneIds: entries.map((entry) => entry.milestoneId),
    milestones: entries,
  };
}

/** 事务内校验多阶段快照未漂移（任一段/任务变化即冲突） */
export async function claimPathReplanRangeSnapshot(
  tx: any,
  snapshot: PathReplanRangeSnapshot,
  now = new Date()
): Promise<void> {
  for (const entry of snapshot.milestones) {
    if (entry.milestoneStatus === 'completed') {
      throw new PathMutationConflictError(
        '已完成阶段不能追加新的待办任务',
        'PATH_REPLAN_MILESTONE_COMPLETED'
      );
    }
    const claimed = await tx.milestones.updateMany({
      where: {
        id: entry.milestoneId,
        status: entry.milestoneStatus,
        updatedAt: entry.milestoneUpdatedAt,
      },
      data: { updatedAt: now }
    });
    if (claimed.count !== 1) {
      throw new PathMutationConflictError(
        '阶段或任务状态已变化，请刷新后重新调整',
        'PATH_REPLAN_SNAPSHOT_CHANGED'
      );
    }
    const currentTasks = await tx.subtasks.findMany({
      where: { milestoneId: entry.milestoneId },
      select: { id: true, status: true, updatedAt: true },
      orderBy: { id: 'asc' }
    });
    const unchanged = currentTasks.length === entry.tasks.length
      && currentTasks.every((task: any, index: number) => {
        const previous = entry.tasks[index];
        return task.id === previous.id
          && task.status === previous.status
          && new Date(task.updatedAt).getTime() === previous.updatedAt.getTime();
      });
    if (!unchanged) {
      throw new PathMutationConflictError(
        '阶段或任务状态已变化，请刷新后重新调整',
        'PATH_REPLAN_SNAPSHOT_CHANGED'
      );
    }
  }
}

export async function claimPathReplanSnapshot(
  tx: any,
  snapshot: PathReplanSnapshot,
  now = new Date()
): Promise<void> {
  if (snapshot.milestoneStatus === 'completed') {
    throw new PathMutationConflictError(
      '已完成阶段不能追加新的待办任务',
      'PATH_REPLAN_MILESTONE_COMPLETED'
    );
  }

  const claimed = await tx.milestones.updateMany({
    where: {
      id: snapshot.milestoneId,
      status: snapshot.milestoneStatus,
      updatedAt: snapshot.milestoneUpdatedAt,
    },
    data: { updatedAt: now }
  });
  if (claimed.count !== 1) {
    throw new PathMutationConflictError(
      '阶段或任务状态已变化，请刷新后重新调整',
      'PATH_REPLAN_SNAPSHOT_CHANGED'
    );
  }

  const currentTasks = await tx.subtasks.findMany({
    where: { milestoneId: snapshot.milestoneId },
    select: { id: true, status: true, updatedAt: true },
    orderBy: { id: 'asc' }
  });
  const unchanged = currentTasks.length === snapshot.tasks.length
    && currentTasks.every((task: any, index: number) => {
      const previous = snapshot.tasks[index];
      return task.id === previous.id
        && task.status === previous.status
        && new Date(task.updatedAt).getTime() === previous.updatedAt.getTime();
    });
  if (!unchanged) {
    throw new PathMutationConflictError(
      '阶段或任务状态已变化，请刷新后重新调整',
      'PATH_REPLAN_SNAPSHOT_CHANGED'
    );
  }
}

export async function assertPathMutationSafe(
  tx: any,
  pathId: string,
  kind: PathMutationKind,
  scope: PathMutationScope = {}
): Promise<void> {
  const milestoneFilter = scope.milestoneIds && scope.milestoneIds.length > 0
    ? { id: { in: scope.milestoneIds } }
    : (scope.milestoneId ? { id: scope.milestoneId } : {});
  const tasks = await tx.subtasks.findMany({
    where: {
      milestones: {
        learningPathId: pathId,
        ...milestoneFilter
      }
    },
    select: {
      id: true,
      status: true
    }
  });

  const blockedTaskStatuses = kind === 'replan-stage'
    ? new Set(['in_progress'])
    : scope.allowCompleted === true
      ? new Set(['in_progress'])
      : new Set(['completed', 'in_progress']);
  const blockedTask = tasks.find((task: { status: string }) => blockedTaskStatuses.has(task.status));

  if (blockedTask) {
    throw new PathMutationConflictError(
      PATH_MUTATION_MESSAGES[kind],
      'PATH_MUTATION_HAS_LEARNING_PROGRESS'
    );
  }

  const affectedTaskIds = kind === 'replan-stage'
    ? tasks.filter((task: { status: string }) => task.status !== 'completed').map((task: { id: string }) => task.id)
    : tasks.map((task: { id: string }) => task.id);
  const sessionScope = kind === 'replan-stage'
    ? affectedTaskIds.length > 0 ? [{ taskId: { in: affectedTaskIds } }] : []
    : [
        { learningPathId: pathId },
        ...(affectedTaskIds.length > 0 ? [{ taskId: { in: affectedTaskIds } }] : [])
      ];
  const openSessions = sessionScope.length > 0
    ? await tx.teaching_sessions.findMany({
        where: {
          status: { in: [...OPEN_TEACHING_SESSION_STATUSES] },
          OR: sessionScope
        },
        select: {
          id: true,
          taskId: true,
          status: true,
          revision: true,
          topic: true,
          updatedAt: true
        }
      })
    : [];

  if (openSessions.length > 0) {
    const taskIds = [...new Set(openSessions.map((s: any) => s.taskId))];
    const tasks = taskIds.length > 0
      ? await tx.subtasks.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true }
        })
      : [];
    const taskTitleById = new Map(tasks.map((t: any) => [t.id, t.title]));
    throw new PathMutationConflictError(
      '学习路径仍有未结束的课堂，请先结束课堂后再调整',
      'PATH_MUTATION_HAS_OPEN_SESSION',
      {
        sessions: openSessions.map((s: any) => ({
          sessionId: s.id,
          taskId: s.taskId,
          taskTitle: taskTitleById.get(s.taskId) || null,
          status: s.status,
          revision: s.revision,
          topic: s.topic || null,
          updatedAt: s.updatedAt?.toISOString?.() || null
        }))
      }
    );
  }

  // 显式整建（allowCompleted）：已完成的课堂/证据视为历史，允许覆盖（数据仍保留在库中）；
  // 其余场景（含 replan-stage 之外的一切）继续拦截，防止静默丢失学习记录。
  if (scope.allowCompleted === true) return;

  const ignoreIds = scope.ignoreCompletedSessionIds?.length ? scope.ignoreCompletedSessionIds : undefined;
  const completedSession = sessionScope.length > 0
    ? await tx.teaching_sessions.findFirst({
        where: {
          status: 'completed',
          wrapup: { not: null },
          ...(ignoreIds ? { id: { notIn: ignoreIds } } : {}),
          OR: sessionScope
        },
        select: { id: true }
      })
    : null;
  const evidenceScope = kind === 'replan-stage'
    ? affectedTaskIds.length > 0 ? [{ taskId: { in: affectedTaskIds } }] : []
    : [
        { pathId },
        ...(affectedTaskIds.length > 0 ? [{ taskId: { in: affectedTaskIds } }] : [])
      ];
  const completedEvidence = evidenceScope.length > 0
    ? await tx.learner_evidence.findFirst({
        where: {
          evidenceType: 'lesson:completed',
          ...(ignoreIds ? { sessionId: { notIn: ignoreIds } } : {}),
          OR: evidenceScope
        },
        select: { id: true }
      })
    : null;

  if (completedSession || completedEvidence) {
    throw new PathMutationConflictError(
      '相关学习内容已有已完成课堂记录，不能删除或覆盖',
      'PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE'
    );
  }
}
