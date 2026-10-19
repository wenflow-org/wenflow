/**
 * deleteLearningPath 级联清理契约（issue #90 方案 B：清理级联，不动 schema）
 *
 * 回归病根：该仓储曾是 `prisma.learning_paths.delete` 裸删——milestones/subtasks 由 FK
 * 级联，但 goal_conversations / teaching_sessions / virtual_sessions 的 learningPathId
 * 是**无 FK 的软指针**，删完留下指向不存在路径的悬空引用（管理端反查静默对不上）。
 * 本护栏锁：同事务「先置空三表指针、再删路径行」，且不得回退为直连裸删。
 */
const mockTx = {
  goal_conversations: { updateMany: jest.fn() },
  teaching_sessions: { updateMany: jest.fn() },
  virtual_sessions: { updateMany: jest.fn() },
  learning_paths: { delete: jest.fn() },
};

const mockPrisma = {
  $transaction: jest.fn(),
  // 裸删回归探针：仓储若回退到 prisma.learning_paths.delete 直删会被断言抓住
  learning_paths: { delete: jest.fn() },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { deleteLearningPath } from '../learning-content.repo';

describe('deleteLearningPath（#90 删路径同事务清软指针）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
    mockTx.goal_conversations.updateMany.mockResolvedValue({ count: 1 });
    mockTx.teaching_sessions.updateMany.mockResolvedValue({ count: 2 });
    mockTx.virtual_sessions.updateMany.mockResolvedValue({ count: 3 });
    mockTx.learning_paths.delete.mockResolvedValue({ id: 'lp-1' });
  });

  it('三张软指针表都按 learningPathId 置 null', async () => {
    await deleteLearningPath('lp-1');
    for (const table of [mockTx.goal_conversations, mockTx.teaching_sessions, mockTx.virtual_sessions]) {
      expect(table.updateMany).toHaveBeenCalledWith({
        where: { learningPathId: 'lp-1' },
        data: { learningPathId: null },
      });
    }
  });

  it('置空先于删行，且整体在同一个事务里', async () => {
    await deleteLearningPath('lp-1');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const lastNullAt = Math.max(
      mockTx.goal_conversations.updateMany.mock.invocationCallOrder[0],
      mockTx.teaching_sessions.updateMany.mock.invocationCallOrder[0],
      mockTx.virtual_sessions.updateMany.mock.invocationCallOrder[0],
    );
    const deleteAt = mockTx.learning_paths.delete.mock.invocationCallOrder[0];
    expect(lastNullAt).toBeLessThan(deleteAt);
  });

  it('回归：不再走裸删（直连 prisma.learning_paths.delete 零调用）', async () => {
    await deleteLearningPath('lp-1');
    expect(mockPrisma.learning_paths.delete).not.toHaveBeenCalled();
  });
});
