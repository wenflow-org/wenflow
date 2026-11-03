/**
 * 目标对话状态分桶（2026-11-02 P2-2）。
 *
 * 病根：stats 原先只数 total/active/completed/cancelled——failed 从来没被统计，而列表的
 * 「已取消」档实际含 cancelled / canceled / abandoned，单数一个 'cancelled' 既漏了失败档、
 * 也盖不住取消档，前端两档只能空着不显计数。分桶提到仓储层纯函数后，这里直接锁
 * 「哪些状态算哪一档」与 total 的口径。
 */
const mockPrisma = {
  goal_conversations: { groupBy: jest.fn(), count: jest.fn() },
  users: { count: jest.fn() },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));

import { bucketGoalConversationStatusCounts } from '../goal-conversation-admin.repo';

const rows = (...items: Array<[string, number]>) =>
  items.map(([status, n]) => ({ status, _count: { _all: n } }));

describe('goal-conversation-admin.repo 状态分桶', () => {
  it('取消档合并 cancelled / canceled / abandoned，失败档单列 failed', () => {
    const counts = bucketGoalConversationStatusCounts(
      rows(['active', 2], ['completed', 4], ['cancelled', 1], ['canceled', 1], ['abandoned', 2], ['failed', 3])
    );

    expect(counts).toEqual({ total: 13, active: 2, completed: 4, cancelled: 4, failed: 3 });
  });

  it('列表没有单列一档的状态（如 discarded）只进 total，不塞进任何桶', () => {
    const counts = bucketGoalConversationStatusCounts(rows(['completed', 1], ['discarded', 5]));

    expect(counts.total).toBe(6);
    expect(counts.active + counts.completed + counts.cancelled + counts.failed).toBe(1);
  });

  it('空结果与大小写混排都不炸：未知状态归 0', () => {
    expect(bucketGoalConversationStatusCounts([])).toEqual({
      total: 0,
      active: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
    });
    expect(bucketGoalConversationStatusCounts(rows(['FAILED', 2])).failed).toBe(2);
  });
});
