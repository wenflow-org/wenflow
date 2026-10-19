/**
 * 用户侧删除学习路径的级联清理（issue #90 方案 B）
 *
 * learningPathId 是无 FK 的软指针（goal_conversations / teaching_sessions / virtual_sessions）：
 * 本入口此前裸删路径行，留下悬空引用；本护栏锁「同事务先置空三表指针、再删行」，
 * 且权限/存在性守卫必须在前（无权/不存在时不得触碰任何清理与删除）。
 */
const mockPrisma = { $transaction: jest.fn() };

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../achievements/achievement.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../learner/DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { refreshInBackground: jest.fn() },
}));
jest.mock('../../learner/LearnerStateReviewService', () => ({ learnerStateReviewService: {} }));
jest.mock('../../learner/ConceptConsolidatorService', () => ({ conceptConsolidatorService: {} }));
jest.mock('../../learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: jest.fn() },
}));
jest.mock('../../learner/LearnerProgressService', () => ({ learnerProgressService: {} }));
jest.mock('../../background-task-tracker.service', () => ({
  runBackgroundTask: (_name: string, task: () => Promise<unknown>) => {
    void task().catch(() => undefined);
  },
}));
jest.mock('../../../events/outbox.repository', () => ({ enqueueDomainEvent: jest.fn() }));
jest.mock('../path-mutation-safety', () => ({
  assertPathMutationSafe: jest.fn(async () => undefined),
  PathMutationConflictError: class PathMutationConflictError extends Error {},
}));

import { deleteLearningPath } from '../tasks/task-completion.service';

function makeTx() {
  return {
    learning_paths: {
      findUnique: jest.fn(async () => ({ userId: 'u-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      delete: jest.fn(async () => ({ id: 'lp-1' })),
    },
    goal_conversations: { updateMany: jest.fn(async () => ({ count: 1 })) },
    teaching_sessions: { updateMany: jest.fn(async () => ({ count: 2 })) },
    virtual_sessions: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
}

describe('deleteLearningPath（#90 用户侧同事务清软指针）', () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
  });

  it('三张软指针表置空先于删行', async () => {
    await deleteLearningPath('lp-1', 'u-1');

    for (const table of [tx.goal_conversations, tx.teaching_sessions, tx.virtual_sessions]) {
      expect(table.updateMany).toHaveBeenCalledWith({
        where: { learningPathId: 'lp-1' },
        data: { learningPathId: null },
      });
    }
    expect(tx.learning_paths.delete).toHaveBeenCalledWith({ where: { id: 'lp-1' } });
    const lastNullAt = Math.max(
      tx.goal_conversations.updateMany.mock.invocationCallOrder[0],
      tx.teaching_sessions.updateMany.mock.invocationCallOrder[0],
      tx.virtual_sessions.updateMany.mock.invocationCallOrder[0],
    );
    expect(lastNullAt).toBeLessThan(tx.learning_paths.delete.mock.invocationCallOrder[0]);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('无权删除 → 抛错且不清理不删行（守卫在前）', async () => {
    tx.learning_paths.findUnique.mockResolvedValue({ userId: 'other' });
    await expect(deleteLearningPath('lp-1', 'u-1')).rejects.toThrow('无权删除此学习路径');
    expect(tx.goal_conversations.updateMany).not.toHaveBeenCalled();
    expect(tx.teaching_sessions.updateMany).not.toHaveBeenCalled();
    expect(tx.virtual_sessions.updateMany).not.toHaveBeenCalled();
    expect(tx.learning_paths.delete).not.toHaveBeenCalled();
  });

  it('路径不存在 → 抛错且不进入清理', async () => {
    tx.learning_paths.findUnique.mockResolvedValue(null);
    await expect(deleteLearningPath('lp-1', 'u-1')).rejects.toThrow('学习路径不存在');
    expect(tx.learning_paths.delete).not.toHaveBeenCalled();
  });
});
