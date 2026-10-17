/**
 * #64 P-39：手动结构编辑执行器契约。
 *
 * 顺序权威 = `subtasks.order`（同阶段 0..n-1）；只允许进行中的路径与未完成任务；
 * 有开放课堂时按 path-mutation-safety 的 409 语义拒绝（前端走「清场 → 重试」）。
 */
const mockPathFindUnique = jest.fn();
const mockWithTransaction = jest.fn();
const mockTx = {
  milestones: { findFirst: jest.fn() },
  subtasks: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  teaching_sessions: { findMany: jest.fn(), findFirst: jest.fn() },
  learner_evidence: { findFirst: jest.fn() },
};

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learning_paths: { findUnique: mockPathFindUnique } },
}));
jest.mock('../../../utils/with-transaction', () => ({
  withTransaction: (fn: (tx: unknown) => unknown) => mockWithTransaction(fn),
}));

import { applyPathStructuralEdit } from '../path-structural-edit.service';

const TASKS = [
  { id: 't1', order: 0, status: 'completed', estimatedMinutes: 30, title: '任务一', milestoneId: 'm1' },
  { id: 't2', order: 1, status: 'todo', estimatedMinutes: 40, title: '任务二', milestoneId: 'm1' },
];

function prime() {
  jest.clearAllMocks();
  mockPathFindUnique.mockResolvedValue({ id: 'p1', userId: 'u1', status: 'active' });
  mockWithTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockTx));
  mockTx.milestones.findFirst.mockResolvedValue({ id: 'm1' });
  mockTx.subtasks.findMany.mockResolvedValue(TASKS);
  mockTx.subtasks.findFirst.mockImplementation(({ where }: { where: { id?: string } }) =>
    Promise.resolve(TASKS.find((task) => task.id === where.id) ?? null));
  mockTx.subtasks.create.mockResolvedValue({});
  mockTx.subtasks.update.mockResolvedValue({});
  mockTx.subtasks.delete.mockResolvedValue({});
  mockTx.teaching_sessions.findMany.mockResolvedValue([]);
  mockTx.teaching_sessions.findFirst.mockResolvedValue(null);
  mockTx.learner_evidence.findFirst.mockResolvedValue(null);
}

describe('applyPathStructuralEdit', () => {
  beforeEach(prime);

  it('insert_task：插到指定任务之后，order 顺延且新任务落 todo/默认 30 分钟', async () => {
    const result = await applyPathStructuralEdit({
      op: 'insert_task',
      pathId: 'p1',
      userId: 'u1',
      milestoneId: 'm1',
      afterTaskId: 't1',
      title: '补一个例子',
    });

    expect(result.op).toBe('insert_task');
    const created = mockTx.subtasks.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      milestoneId: 'm1',
      title: '补一个例子',
      status: 'todo',
      order: 1,
      estimatedMinutes: 30,
    });
    // 原 order=1 的任务被顺延到 2
    expect(mockTx.subtasks.update).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: { order: 2 },
    });
  });

  it('extend_task / shrink_task：按 delta 调整且受 5–600 边界约束', async () => {
    await applyPathStructuralEdit({ op: 'extend_task', pathId: 'p1', userId: 'u1', taskId: 't2', deltaMinutes: 20 });
    expect(mockTx.subtasks.update).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: { estimatedMinutes: 60, updatedAt: expect.any(Date) },
    });

    mockTx.subtasks.update.mockClear();
    await applyPathStructuralEdit({ op: 'shrink_task', pathId: 'p1', userId: 'u1', taskId: 't2', deltaMinutes: 20 });
    expect(mockTx.subtasks.update).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: { estimatedMinutes: 20, updatedAt: expect.any(Date) },
    });
  });

  it('已完成任务：拒绝修改（保留历史结算口径）', async () => {
    await expect(applyPathStructuralEdit({
      op: 'shrink_task', pathId: 'p1', userId: 'u1', taskId: 't1', deltaMinutes: 10,
    })).rejects.toMatchObject({ status: 409, code: 'PATH_STRUCTURAL_EDIT_TASK_COMPLETED' });
  });

  it('非进行中的路径：拒绝', async () => {
    mockPathFindUnique.mockResolvedValue({ id: 'p1', userId: 'u1', status: 'completed' });
    await expect(applyPathStructuralEdit({
      op: 'delete_task', pathId: 'p1', userId: 'u1', taskId: 't2',
    })).rejects.toMatchObject({ status: 409, code: 'PATH_STRUCTURAL_EDIT_PATH_NOT_ACTIVE' });
  });

  it('delete_task：只允许删除 todo 任务', async () => {
    mockTx.subtasks.findFirst.mockResolvedValue({ ...TASKS[1], status: 'in_progress' });
    await expect(applyPathStructuralEdit({
      op: 'delete_task', pathId: 'p1', userId: 'u1', taskId: 't2',
    })).rejects.toMatchObject({ status: 409, code: 'PATH_STRUCTURAL_EDIT_DELETE_NOT_TODO' });
    expect(mockTx.subtasks.delete).not.toHaveBeenCalled();
  });

  it('有开放课堂：沿用 PATH_MUTATION_HAS_OPEN_SESSION，不落任何写操作', async () => {
    mockTx.teaching_sessions.findMany.mockResolvedValue([
      { id: 's1', taskId: 't2', status: 'active', revision: 3, topic: null, updatedAt: new Date() },
    ]);
    await expect(applyPathStructuralEdit({
      op: 'extend_task', pathId: 'p1', userId: 'u1', taskId: 't2', deltaMinutes: 10,
    })).rejects.toMatchObject({ status: 409, code: 'PATH_MUTATION_HAS_OPEN_SESSION' });
    expect(mockTx.subtasks.update).not.toHaveBeenCalled();
  });
});
