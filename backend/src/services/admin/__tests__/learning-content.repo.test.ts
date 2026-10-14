/**
 * 管理端学习路径列表「最近活动」取值口径（2026-10-14 用户纠偏「列表排序改用真实钟列」）
 *
 * 病根：虚拟学习者的日期模拟把 `learning_paths.updatedAt` 写成模拟日（通常是未来日期），
 * 列表直接按 updatedAt 排序会让虚拟路径霸榜、真实学习者永沉底，前端 timeAgo 还会把未来时间
 * 渲染成「刚刚」。本护栏锁：`lastActivityAt` 只取真墙钟锚点 —— future updatedAt 被丢弃，
 * 名下会话 createdAt 参与取值；且 orderBy 不再走 updatedAt。
 */
const mockPrisma = {
  learning_paths: { findMany: jest.fn() },
  teaching_sessions: { groupBy: jest.fn() },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));

import { findLearningPathsForAdmin } from '../learning-content.repo';

const row = (id: string, createdAt: string, updatedAt: string) => ({
  id,
  title: `path ${id}`,
  subject: null,
  status: 'active',
  difficulty: 'beginner',
  estimatedHours: 10,
  totalMilestones: 1,
  completedMilestones: 0,
  aiGenerated: true,
  createdAt: new Date(createdAt),
  updatedAt: new Date(updatedAt),
  deadline: null,
  users: { id: 'u1', name: 'n', email: 'e', isVirtualLearner: true },
  milestones: [],
  _count: { milestones: 0 },
});

beforeEach(() => {
  mockPrisma.learning_paths.findMany.mockReset();
  mockPrisma.teaching_sessions.groupBy.mockReset();
  mockPrisma.teaching_sessions.groupBy.mockResolvedValue([]);
});

describe('findLearningPathsForAdmin · 真墙钟「最近活动」', () => {
  it('orderBy 走真墙钟 createdAt，不按 updatedAt（虚拟路径的 updatedAt 是模拟钟写的未来日期）', async () => {
    mockPrisma.learning_paths.findMany.mockResolvedValue([]);
    await findLearningPathsForAdmin({}, 0, 10);
    expect(mockPrisma.learning_paths.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    );
  });

  it('未来 updatedAt（模拟钟产物）被丢弃，回落 createdAt', async () => {
    const future = new Date(Date.now() + 30 * 24 * 3600e3).toISOString();
    mockPrisma.learning_paths.findMany.mockResolvedValue([row('lp1', '2026-10-13T00:00:00Z', future)]);

    const [p] = await findLearningPathsForAdmin({}, 0, 10);
    expect(p.lastActivityAt?.toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('名下会话 createdAt（真墙钟）晚于 createdAt 时参与取值', async () => {
    const future = new Date(Date.now() + 30 * 24 * 3600e3).toISOString();
    mockPrisma.learning_paths.findMany.mockResolvedValue([row('lp1', '2026-10-13T00:00:00Z', future)]);
    mockPrisma.teaching_sessions.groupBy.mockResolvedValue([
      { learningPathId: 'lp1', _max: { createdAt: new Date('2026-10-13T08:00:00Z') } },
    ]);

    const [p] = await findLearningPathsForAdmin({}, 0, 10);
    expect(p.lastActivityAt?.toISOString()).toBe('2026-10-13T08:00:00.000Z');
  });

  it('非未来 updatedAt（真墙钟）保留，取最大值为最近活动', async () => {
    mockPrisma.learning_paths.findMany.mockResolvedValue([row('lp1', '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z')]);

    const [p] = await findLearningPathsForAdmin({}, 0, 10);
    expect(p.lastActivityAt?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});
