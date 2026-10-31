/**
 * deadline 落后定时评估（2026-10-22 审计 P2）：
 * 不访问状态页的学习者也必须被评估；只有 reasonCodes 含 deadline_pace_behind 才通知。
 */
const mockFindMany = jest.fn();
const mockRefresh = jest.fn();
const mockNotify = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learning_paths: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));
jest.mock('../LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: (...args: unknown[]) => mockRefresh(...args) },
}));
jest.mock('../deadline-notify.service', () => ({
  notifyDeadlineBehindOnce: (...args: unknown[]) => mockNotify(...args),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { evaluateDeadlinePaceOnce } from '../deadline-pace-scheduler';

const path = {
  id: 'lp-1',
  userId: 'u1',
  title: '路径一',
  deadline: new Date('2026-12-01T00:00:00.000Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([path]);
  mockRefresh.mockResolvedValue({ replanSignal: { reasonCodes: ['deadline_pace_behind'] } });
  mockNotify.mockResolvedValue({ sent: true });
});

describe('evaluateDeadlinePaceOnce', () => {
  it('扫描有 deadline 的活跃真实用户路径，落后时走既有去重通知', async () => {
    const result = await evaluateDeadlinePaceOnce(new Date('2026-10-22T00:00:00.000Z'));

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'active',
        deadline: { not: null },
        users: { isVirtualLearner: false },
      }),
    }));
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      pathId: 'lp-1',
      deadline: path.deadline,
    }));
    expect(result).toEqual({ scanned: 1, behind: 1, notified: 1, failed: 0 });
  });

  it('未落后（无 deadline_pace_behind）→ 不通知', async () => {
    mockRefresh.mockResolvedValue({ replanSignal: { reasonCodes: ['review_due'] } });

    const result = await evaluateDeadlinePaceOnce();

    expect(mockNotify).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, behind: 0, notified: 0, failed: 0 });
  });

  it('单条路径评估失败不阻断其他路径', async () => {
    mockFindMany.mockResolvedValue([path, { ...path, id: 'lp-2' }]);
    mockRefresh.mockRejectedValueOnce(new Error('db timeout'));

    const result = await evaluateDeadlinePaceOnce();

    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(1);
  });
});
