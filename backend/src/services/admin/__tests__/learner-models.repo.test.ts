/**
 * 管理端学习者模型数据边界：路径作用域（2026-11-11 多路径串台修复）。
 *
 * 证据页曾出现「心理学路径下混入奶茶店的目标/路径事件与概念」：
 *  - 目标/路径域证据只按 userId 取最近 30 条，没带 pathId；
 *  - 校准记录同样只按 userId；
 *  - 画像的互动历史取最近 50 节课（跨全部路径）。
 * 这里锁住 repo 层的过滤条件：带 pathId 时必须真的写进 where，不带时保持旧的全量口径。
 */
const mockPrisma = {
  learner_evidence: { findMany: jest.fn() },
  teaching_sessions: { findMany: jest.fn(), count: jest.fn() },
  teaching_session_messages: { count: jest.fn() },
  misconception_ledger: { findMany: jest.fn() },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));

import { findCalibrationEvidence, findPathHistory } from '../learner-models.repo';

beforeEach(() => {
  mockPrisma.learner_evidence.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.teaching_sessions.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.teaching_sessions.count.mockReset().mockResolvedValue(0);
  mockPrisma.teaching_session_messages.count.mockReset().mockResolvedValue(0);
  mockPrisma.misconception_ledger.findMany.mockReset().mockResolvedValue([]);
});

describe('findCalibrationEvidence · 路径过滤', () => {
  it('带 pathId 时把路径条件写进 where', async () => {
    await findCalibrationEvidence('u1', 'lp1');
    expect(mockPrisma.learner_evidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', pathId: 'lp1' }) }),
    );
  });

  it('不传 pathId 时保持全量口径（列表页/旧调用兼容）', async () => {
    await findCalibrationEvidence('u1');
    const where = mockPrisma.learner_evidence.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('pathId');
  });
});

describe('findPathHistory · 只统计该路径的课堂/误解', () => {
  it('课堂只取 learningPathId=pathId，消息数按这些课堂聚合', async () => {
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([
      { id: 's1', duration: 10, topic: '米勒数字广度' },
      { id: 's2', duration: 20, topic: '皮亚杰守恒' },
    ]);
    mockPrisma.teaching_sessions.count.mockResolvedValue(18);
    mockPrisma.teaching_session_messages.count.mockResolvedValue(232);
    mockPrisma.misconception_ledger.findMany.mockResolvedValue([
      { canonicalLabel: '混淆流派前提' },
    ]);
    const history = await findPathHistory('u1', 'lp1');

    expect(mockPrisma.teaching_sessions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', learningPathId: 'lp1' } }),
    );
    expect(mockPrisma.teaching_session_messages.count).toHaveBeenCalledWith({
      where: { sessionId: { in: ['s1', 's2'] } },
    });
    expect(mockPrisma.misconception_ledger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          lastSessionId: { in: ['s1', 's2'] },
        }),
      }),
    );
    expect(history).toEqual(expect.objectContaining({
      learningPathId: 'lp1',
      totalSessions: 18,
      totalMessages: 232,
      avgSessionDuration: 15,
      topicsExplored: ['米勒数字广度', '皮亚杰守恒'],
      conceptsStruggled: ['混淆流派前提'],
    }));
  });

  it('该路径没有课堂：不发空 in 查询，返回空历史', async () => {
    const history = await findPathHistory('u1', 'lp2');
    expect(mockPrisma.teaching_session_messages.count).not.toHaveBeenCalled();
    expect(mockPrisma.misconception_ledger.findMany).not.toHaveBeenCalled();
    expect(history).toEqual(expect.objectContaining({
      totalSessions: 0,
      totalMessages: 0,
      topicsExplored: [],
      conceptsStruggled: [],
    }));
  });
});
