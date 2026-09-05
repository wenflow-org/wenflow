import {
  PathMutationConflictError,
  assertPathMutationSafe,
  buildPathReplanRangeSnapshot,
  buildPathReplanSnapshot,
  claimPathReplanRangeSnapshot,
  claimPathReplanSnapshot,
  createPathVersioningUnsupportedError,
  isPathMutationConflictError,
} from '../path-mutation-safety';

function createTx(
  tasks: Array<{ id: string; status: string; updatedAt?: Date; title?: string }>,
  options: {
    openSessions?: Array<Record<string, any>> | null;
    completedSession?: { id: string } | null;
    completedEvidence?: { id: string } | null;
  } = {}
) {
  const allTasks = tasks.map((t) => ({ title: null, ...t }));
  return {
    subtasks: {
      findMany: jest.fn().mockImplementation((args: any) => {
        // 若带 id: { in } 且非初始任务查询 → 返回任务标题
        if (args?.where?.id?.in) {
          const ids = args.where.id.in;
          return Promise.resolve(allTasks.filter((t) => ids.includes(t.id)));
        }
        return Promise.resolve(allTasks);
      })
    },
    teaching_sessions: {
      findMany: jest.fn().mockResolvedValue(options.openSessions || []),
      findFirst: jest.fn()
        .mockResolvedValueOnce(options.completedSession || null)
    },
    learner_evidence: {
      findFirst: jest.fn().mockResolvedValue(options.completedEvidence || null)
    }
  };
}

describe('path mutation safety', () => {
  it('blocks replacement when completed or in-progress tasks exist', async () => {
    const completedTx = createTx([{ id: 'task-1', status: 'completed' }]);
    const inProgressTx = createTx([{ id: 'task-2', status: 'in_progress' }]);

    await expect(assertPathMutationSafe(completedTx, 'path-1', 'replace-path'))
      .rejects.toMatchObject({ status: 409, code: 'PATH_MUTATION_HAS_LEARNING_PROGRESS' });
    await expect(assertPathMutationSafe(inProgressTx, 'path-1', 'replace-tasks'))
      .rejects.toMatchObject({ status: 409, code: 'PATH_MUTATION_HAS_LEARNING_PROGRESS' });
    expect(completedTx.teaching_sessions.findFirst).not.toHaveBeenCalled();
  });

  it('preserves completed tasks during stage replanning but blocks an in-progress task', async () => {
    const completedTx = createTx([{ id: 'task-1', status: 'completed' }]);
    await expect(assertPathMutationSafe(completedTx, 'path-1', 'replan-stage')).resolves.toBeUndefined();

    const inProgressTx = createTx([{ id: 'task-2', status: 'in_progress' }]);
    await expect(assertPathMutationSafe(inProgressTx, 'path-1', 'replan-stage'))
      .rejects.toMatchObject({ code: 'PATH_MUTATION_HAS_LEARNING_PROGRESS' });
  });

  it('blocks every mutation while a recoverable teaching session is open', async () => {
    const tx = createTx(
      [{ id: 'task-1', status: 'todo', title: '任务一' }],
      { openSessions: [{ id: 'session-1', taskId: 'task-1', status: 'active', revision: 3, topic: null, updatedAt: null }] }
    );

    await expect(assertPathMutationSafe(tx, 'path-1', 'delete-path'))
      .rejects.toMatchObject({
        status: 409,
        code: 'PATH_MUTATION_HAS_OPEN_SESSION',
        details: { sessions: [{ sessionId: 'session-1', taskId: 'task-1', taskTitle: '任务一', status: 'active', revision: 3 }] }
      });
    expect(tx.teaching_sessions.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['initializing', 'active', 'paused', 'timeout', 'finalizing'] },
        OR: [
          { learningPathId: 'path-1' },
          { taskId: { in: ['task-1'] } }
        ]
      },
      select: {
        id: true,
        taskId: true,
        status: true,
        revision: true,
        topic: true,
        updatedAt: true
      }
    });
  });

  it('allows untouched paths and returns a stable versioning conflict', async () => {
    const tx = createTx([{ id: 'task-1', status: 'todo' }]);
    await expect(assertPathMutationSafe(tx, 'path-1', 'replace-path')).resolves.toBeUndefined();

    const error = createPathVersioningUnsupportedError();
    expect(error).toBeInstanceOf(PathMutationConflictError);
    expect(isPathMutationConflictError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 409,
      code: 'PATH_VERSIONING_NOT_SUPPORTED'
    });
  });

  it('blocks completed classroom evidence even when the task is still todo', async () => {
    const tx = createTx([{ id: 'task-1', status: 'todo' }], {
      completedSession: { id: 'session-1' }
    });

    await expect(assertPathMutationSafe(tx, 'path-1', 'replace-path'))
      .rejects.toMatchObject({ code: 'PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE' });
  });

  it('blocks projected lesson evidence without a matching session row', async () => {
    const tx = createTx([{ id: 'task-1', status: 'todo' }], {
      completedEvidence: { id: 'evidence-1' }
    });

    await expect(assertPathMutationSafe(tx, 'path-1', 'delete-path'))
      .rejects.toMatchObject({ code: 'PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE' });
  });

  it('scopes replan evidence checks to tasks that would be replaced', async () => {
    const tx = createTx([
      { id: 'done-task', status: 'completed' },
      { id: 'todo-task', status: 'todo' }
    ]);

    await expect(assertPathMutationSafe(tx, 'path-1', 'replan-stage', { milestoneId: 'milestone-1' }))
      .resolves.toBeUndefined();
    expect(tx.teaching_sessions.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: { in: ['initializing', 'active', 'paused', 'timeout', 'finalizing'] },
        OR: [{ taskId: { in: ['todo-task'] } }]
      },
      select: {
        id: true,
        taskId: true,
        status: true,
        revision: true,
        topic: true,
        updatedAt: true
      }
    });
  });

  it('allowCompleted → replace-path 放行已完成任务与已完成课堂（显式整建）', async () => {
    // 有 completed 任务 + 有已完成课堂记录：默认 replace-path 拦截，allowCompleted=true 时放行
    const tx = createTx([{ id: 'task-1', status: 'completed' }], {
      openSessions: [],
      completedSession: { id: 'session-1' },
    });

    await expect(assertPathMutationSafe(tx, 'path-1', 'replace-path', { allowCompleted: true }))
      .resolves.toBeUndefined();
    // 放行时 open-session 已查（findMany 空），提前返回不再查 completedSession/evidence
    expect(tx.teaching_sessions.findMany).toHaveBeenCalledTimes(1);
    expect(tx.teaching_sessions.findFirst).not.toHaveBeenCalled();
  });

  it('allowCompleted 不适用于进行中任务与未结束课堂（整建仍需先收尾）', async () => {
    const inProgressTx = createTx([{ id: 'task-2', status: 'in_progress' }]);
    await expect(assertPathMutationSafe(inProgressTx, 'path-1', 'replace-path', { allowCompleted: true }))
      .rejects.toMatchObject({ status: 409, code: 'PATH_MUTATION_HAS_LEARNING_PROGRESS' });

    const openSessionTx = createTx([{ id: 'task-1', status: 'todo' }], { openSessions: [{ id: 'session-1', taskId: 'task-1', status: 'active', revision: 1, topic: null, updatedAt: null }] });
    await expect(assertPathMutationSafe(openSessionTx, 'path-1', 'replace-path', { allowCompleted: true }))
      .rejects.toMatchObject({ status: 409, code: 'PATH_MUTATION_HAS_OPEN_SESSION' });
  });

  it('claims an unchanged replan snapshot and rejects task changes', async () => {
    const updatedAt = new Date('2026-07-19T12:00:00.000Z');
    const snapshot = buildPathReplanSnapshot({
      id: 'milestone-1',
      status: 'active',
      updatedAt,
      subtasks: [{ id: 'task-1', status: 'todo', updatedAt }]
    });
    const tx = {
      milestones: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      subtasks: {
        findMany: jest.fn().mockResolvedValue([{ id: 'task-1', status: 'todo', updatedAt }])
      }
    };

    await expect(claimPathReplanSnapshot(tx, snapshot)).resolves.toBeUndefined();

    tx.subtasks.findMany.mockResolvedValueOnce([{ id: 'task-1', status: 'completed', updatedAt }]);
    await expect(claimPathReplanSnapshot(tx, snapshot))
      .rejects.toMatchObject({ code: 'PATH_REPLAN_SNAPSHOT_CHANGED' });
  });

  it('builds a range snapshot from consecutive milestones and rejects drift on any of them', async () => {
    const t0 = new Date('2026-07-19T12:00:00.000Z');
    const t1 = new Date('2026-07-20T12:00:00.000Z');
    const snapshot = buildPathReplanRangeSnapshot([
      { id: 'ms-2', status: 'active', updatedAt: t0, subtasks: [{ id: 'a', status: 'todo', updatedAt: t0 }] },
      { id: 'ms-3', status: 'active', updatedAt: t1, subtasks: [{ id: 'b', status: 'todo', updatedAt: t1 }] },
    ]);
    expect(snapshot.milestoneIds).toEqual(['ms-2', 'ms-3']);

    const tx = {
      milestones: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 1 })   // ms-2
          .mockResolvedValueOnce({ count: 1 }),  // ms-3
      },
      subtasks: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 'a', status: 'todo', updatedAt: t0 }])
          .mockResolvedValueOnce([{ id: 'b', status: 'todo', updatedAt: t1 }]),
      },
    };
    await expect(claimPathReplanRangeSnapshot(tx, snapshot)).resolves.toBeUndefined();

    // ms-3 任务漂移 → 冲突
    tx.milestones.updateMany
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    tx.subtasks.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: 'a', status: 'todo', updatedAt: t0 }])
      .mockResolvedValueOnce([{ id: 'b', status: 'completed', updatedAt: t1 }]);
    await expect(claimPathReplanRangeSnapshot(tx, snapshot))
      .rejects.toMatchObject({ code: 'PATH_REPLAN_SNAPSHOT_CHANGED' });
  });

  it('assertPathMutationSafe supports a milestoneIds range and scopes evidence to non-completed tasks within it', async () => {
    const tx = createTx([
      { id: 'done-1', status: 'completed' },
      { id: 'todo-2', status: 'todo' },
      { id: 'todo-3', status: 'todo' },
    ]);
    await expect(assertPathMutationSafe(tx, 'path-1', 'replan-stage', { milestoneIds: ['ms-2', 'ms-3'] }))
      .resolves.toBeUndefined();
    expect(tx.teaching_sessions.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: { in: ['initializing', 'active', 'paused', 'timeout', 'finalizing'] },
        OR: [{ taskId: { in: ['todo-2', 'todo-3'] } }]
      },
      select: {
        id: true,
        taskId: true,
        status: true,
        revision: true,
        topic: true,
        updatedAt: true
      }
    });
  });
});
