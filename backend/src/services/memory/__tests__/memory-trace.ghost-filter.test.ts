/**
 * P1-2 回归（2026-10-22 流程架构审计）：KT 幽灵痕不得进入到期复习队列。
 *
 * 幽灵痕 = source='kt-estimate' 且 extractionCount=0：模型估计值，不是学习证据。
 * 2026-10-21 起为它 seed 了 FSRS 初始 dueAt，若读侧不滤 extractionCount，
 * 学习者会看到「从未学过的概念该复习了」。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    memory_traces: { findMany: jest.fn() },
  },
}));

import prisma from '../../../config/database';
import { memoryTraceService } from '../memory-trace.service';

const findMany = prisma.memory_traces.findMany as jest.Mock;

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe('P1-2 getDueTraces 幽灵痕过滤', () => {
  it('物化到期与惰性判定两条分支都要求 extractionCount>0', async () => {
    const now = new Date('2026-10-22T00:00:00.000Z');

    const due = await memoryTraceService.getDueTraces('u1', { now, limit: 5 });

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      dueAt: { lte: now },
      extractionCount: { gt: 0 },
    });
    expect(findMany.mock.calls[1][0].where).toEqual({
      userId: 'u1',
      dueAt: null,
      extractionCount: { gt: 0 },
    });
    expect(due).toEqual([]);
  });
});
