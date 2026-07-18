import {
  assertGenerationRunFence,
  assertStageTasksPresent,
  calculateStageProgress,
  claimExpiredGenerationRun,
  createAndClaimPathGenerationRun,
  getSafeGenerationErrorMessage,
  isStageDesignStale,
  resolveGenerationRetry,
} from '../path-generation-status';

describe('path generation status', () => {
  const now = new Date('2026-07-16T12:00:00.000Z').getTime();

  it('marks pending or processing stage design stale after four minutes', () => {
    expect(isStageDesignStale({
      stageDesign: 'processing',
      updatedAt: '2026-07-16T11:55:59.000Z',
      lastStageDesignRetryAt: null
    }, new Date('2026-07-16T11:59:00.000Z'), now)).toBe(true);
  });

  it('keeps recent stage design and terminal states non-stale', () => {
    expect(isStageDesignStale({
      stageDesign: 'pending',
      updatedAt: '2026-07-16T11:57:00.000Z',
      lastStageDesignRetryAt: null
    }, new Date('2026-07-16T11:50:00.000Z'), now)).toBe(false);
    expect(isStageDesignStale({
      stageDesign: 'failed',
      updatedAt: '2026-07-16T11:00:00.000Z',
      lastStageDesignRetryAt: null
    }, new Date('2026-07-16T11:00:00.000Z'), now)).toBe(false);
  });

  it('routes retries by the real failed or stale phase', () => {
    expect(resolveGenerationRetry('failed', null, {
      id: 'core-run',
      phase: 'core',
      status: 'failed',
      retryAllowed: true,
    }, new Date(), now)).toMatchObject({ allowed: true, retryType: 'core', reason: 'failed' });

    expect(resolveGenerationRetry('active', null, {
      id: 'stage-run',
      phase: 'stageDesign',
      status: 'processing',
      leaseExpiresAt: '2026-07-16T11:59:00.000Z',
    }, new Date(), now)).toMatchObject({ allowed: true, retryType: 'stageDesign', reason: 'stale' });

    expect(resolveGenerationRetry('active', { stageDesign: 'succeeded' }, null, new Date(), now))
      .toMatchObject({ allowed: false, retryType: null });
    expect(resolveGenerationRetry('active', { stageDesign: 'failed' }, {
      id: 'completed-core-run',
      phase: 'core',
      status: 'succeeded'
    }, new Date(), now)).toMatchObject({ allowed: true, retryType: 'stageDesign', reason: 'failed' });
  });

  it('calculates per-stage progress and rejects zero-task stages', () => {
    expect(calculateStageProgress(1, 3)).toEqual({ completedItems: 1, totalItems: 3, progress: 33 });
    expect(calculateStageProgress(3, 3)).toEqual({ completedItems: 3, totalItems: 3, progress: 100 });
    expect(() => assertStageTasksPresent(2, [])).toThrow('PATH_STAGE_DESIGN_EMPTY_TASKS:2');
    expect(() => assertStageTasksPresent(2, [{ title: 'task' }])).not.toThrow();
  });

  it('does not expose provider errors through generation status', () => {
    expect(getSafeGenerationErrorMessage('core', 'failed', 'PATH_GENERATION_CORE_FAILED'))
      .toBe('路径主结构生成失败，可以重新生成主结构。');
    expect(getSafeGenerationErrorMessage('stageDesign', 'failed', 'PATH_STAGE_DESIGN_ZERO_TASKS'))
      .toBe('部分阶段没有生成有效任务，可以重新准备阶段任务。');
    expect(getSafeGenerationErrorMessage('stageDesign', 'processing', null)).toBeNull();
  });

  it('fences a stale run so it cannot submit after a newer run becomes active', async () => {
    const tx = {
      learning_paths: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      path_generation_runs: {
        findFirst: jest.fn().mockResolvedValue({ id: 'old-run' })
      }
    };

    await expect(assertGenerationRunFence(tx, 'path-1', 'old-run')).rejects.toThrow('GENERATION_RUN_FENCED');
    expect(tx.learning_paths.findFirst).toHaveBeenCalledWith({
      where: { id: 'path-1', activeGenerationRunId: 'old-run' },
      select: { id: true }
    });
  });

  it('cancels the old run and atomically claims a new active run', async () => {
    const claimedAt = new Date('2026-07-16T12:00:00.000Z');
    const tx = {
      learning_paths: {
        findUnique: jest.fn().mockResolvedValue({ id: 'path-1', activeGenerationRunId: 'old-run' }),
        update: jest.fn().mockResolvedValue({ id: 'path-1' })
      },
      path_generation_runs: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockResolvedValue({ id: 'new-run', status: 'queued' })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx))
    };

    const run = await createAndClaimPathGenerationRun(prisma, {
      runId: 'new-run',
      pathId: 'path-1',
      phase: 'core',
      retryType: 'core',
      now: claimedAt
    });

    expect(tx.path_generation_runs.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'old-run', status: { in: ['queued', 'processing'] } },
      data: expect.objectContaining({ status: 'cancelled', errorCode: 'SUPERSEDED' })
    }));
    expect(tx.learning_paths.update).toHaveBeenCalledWith({
      where: { id: 'path-1' },
      data: {
        activeGenerationRunId: 'new-run',
        status: 'generating',
        updatedAt: claimedAt
      }
    });
    expect(run).toMatchObject({ id: 'new-run', status: 'processing', startedAt: claimedAt });
  });

  it('claims an expired active run with the lease condition in the same transaction', async () => {
    const expiredAt = new Date('2026-07-16T12:00:00.000Z');
    const tx = {
      path_generation_runs: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      learning_paths: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx))
    };

    await expect(claimExpiredGenerationRun(prisma, {
      runId: 'expired-run',
      pathId: 'path-1',
      expiredAt,
      now: expiredAt
    })).resolves.toBe(true);

    expect(tx.path_generation_runs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'expired-run',
        learningPathId: 'path-1',
        learningPath: { activeGenerationRunId: 'expired-run' },
        OR: [
          { leaseExpiresAt: { lte: expiredAt } },
          { status: 'processing', leaseExpiresAt: null }
        ]
      }),
      data: expect.objectContaining({
        status: 'failed',
        errorCode: 'GENERATION_LEASE_EXPIRED'
      })
    }));
  });

  it('does not recover a run that renewed its lease after the stale scan', async () => {
    const tx = {
      path_generation_runs: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      learning_paths: {
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx))
    };

    await expect(claimExpiredGenerationRun(prisma, {
      runId: 'renewed-run',
      pathId: 'path-1',
      expiredAt: new Date('2026-07-16T12:00:00.000Z')
    })).resolves.toBe(false);
    expect(tx.learning_paths.updateMany).not.toHaveBeenCalled();
  });
});
