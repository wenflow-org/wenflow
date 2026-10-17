/**
 * #52 P-26 ①：终评用收束时刻重算的快照。
 *
 * `getLatest` 有 5 分钟内存缓存 + 10 分钟投影陈旧窗口，常规回合用它避免每回合重建；
 * 收束终评必须走 `refresh`，否则「判完成时看到的掌握度」与「终评写回的掌握度」是两份快照。
 */
const mockGetLatest = jest.fn();
const mockRefresh = jest.fn();

jest.mock('../../learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: {
    getLatest: mockGetLatest,
    refresh: mockRefresh,
  },
}));

import { loadLearnerSnapshotForContext } from '../TeachingContextBuilder';

const input = {
  userId: 'u1',
  pathId: 'p1',
  milestoneId: 'm1',
  taskId: 't1',
  scope: 'teaching' as const,
};

describe('loadLearnerSnapshotForContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatest.mockResolvedValue({ id: 'cached' });
    mockRefresh.mockResolvedValue({ id: 'fresh' });
  });

  it('默认走 getLatest（常规回合复用缓存，不每回合重建）', async () => {
    await expect(loadLearnerSnapshotForContext(input)).resolves.toEqual({ id: 'cached' });
    expect(mockGetLatest).toHaveBeenCalledWith(input);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('forceLearnerSnapshotRefresh=true → 走 refresh，不碰缓存', async () => {
    await expect(loadLearnerSnapshotForContext(input, { forceLearnerSnapshotRefresh: true }))
      .resolves.toEqual({ id: 'fresh' });
    expect(mockRefresh).toHaveBeenCalledWith(input);
    expect(mockGetLatest).not.toHaveBeenCalled();
  });
});
