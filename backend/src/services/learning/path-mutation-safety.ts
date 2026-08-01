export type PathMutationKind = 'replace-path' | 'replace-tasks' | 'replan-stage' | 'delete-path';

export interface PathMutationScope {
  milestoneId?: string;
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
    readonly code: string
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
  const tasks = await tx.subtasks.findMany({
    where: {
      milestones: {
        learningPathId: pathId,
        ...(scope.milestoneId ? { id: scope.milestoneId } : {})
      }
    },
    select: {
      id: true,
      status: true
    }
  });

  const blockedTaskStatuses = kind === 'replan-stage'
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
  const openSession = sessionScope.length > 0
    ? await tx.teaching_sessions.findFirst({
        where: {
          status: { in: [...OPEN_TEACHING_SESSION_STATUSES] },
          OR: sessionScope
        },
        select: { id: true }
      })
    : null;

  if (openSession) {
    throw new PathMutationConflictError(
      '学习路径仍有未结束的课堂，请先结束课堂后再调整',
      'PATH_MUTATION_HAS_OPEN_SESSION'
    );
  }

  const completedSession = sessionScope.length > 0
    ? await tx.teaching_sessions.findFirst({
        where: {
          status: 'completed',
          wrapup: { not: null },
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
