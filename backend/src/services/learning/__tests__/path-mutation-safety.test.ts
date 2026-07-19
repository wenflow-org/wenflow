import {
  PathMutationConflictError,
  assertPathMutationSafe,
  buildPathReplanSnapshot,
  claimPathReplanSnapshot,
  createPathVersioningUnsupportedError,
  isPathMutationConflictError,
} from '../path-mutation-safety';

function createTx(
  tasks: Array<{ id: string; status: string; updatedAt?: Date }>,
  options: {
    openSession?: { id: string } | null;
    completedSession?: { id: string } | null;
    completedEvidence?: { id: string } | null;
  } = {}
) {
  return {
    subtasks: {
      findMany: jest.fn().mockResolvedValue(tasks)
    },
    teaching_sessions: {
      findFirst: jest.fn()
        .mockResolvedValueOnce(options.openSession || null)
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
    const tx = createTx([{ id: 'task-1', status: 'todo' }], { openSession: { id: 'session-1' } });

    await expect(assertPathMutationSafe(tx, 'path-1', 'delete-path'))
      .rejects.toMatchObject({ status: 409, code: 'PATH_MUTATION_HAS_OPEN_SESSION' });
    expect(tx.teaching_sessions.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: ['initializing', 'active', 'paused', 'timeout', 'finalizing'] },
        OR: [
          { learningPathId: 'path-1' },
          { taskId: { in: ['task-1'] } }
        ]
      },
      select: { id: true }
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
    expect(tx.teaching_sessions.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        status: { in: ['initializing', 'active', 'paused', 'timeout', 'finalizing'] },
        OR: [{ taskId: { in: ['todo-task'] } }]
      },
      select: { id: true }
    });
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
});
