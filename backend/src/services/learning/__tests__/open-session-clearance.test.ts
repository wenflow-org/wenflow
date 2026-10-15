/**
 * 一键清场闭环（2026-10-15 P0-1）
 *
 * 此前 abandonBlocking 只收尾会话 + 删 lesson:completed 证据，**从不复位被打断的任务**；
 * 而 end_only 的语义是「结束课堂、不计入完成」→ 任务永久停在 in_progress，重排守卫拦它、
 * listBlocking 又只找开放会话 → 「清场 → 重试」永久 409（审计 B2：四位里三位落不了地）。
 * 修复：清场后把无开放课堂的 in_progress 任务复位回 todo；sessionIds 精确限定收尾范围。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    subtasks: { findMany: jest.fn(), updateMany: jest.fn() },
    teaching_sessions: { findMany: jest.fn(), count: jest.fn() },
    learner_evidence: { deleteMany: jest.fn() },
  },
}));
jest.mock('../../ai-teaching/TeachingSessionRepository', () => ({
  __esModule: true,
  teachingSessionRepository: {},
}));
jest.mock('../../ai-teaching/SessionFinalizationService', () => ({
  __esModule: true,
  sessionFinalizationService: { finalize: jest.fn() },
}));

import { openSessionClearanceService } from '../open-session-clearance.service';
import { sessionFinalizationService } from '../../ai-teaching/SessionFinalizationService';

const prisma = require('../../../config/database').default as {
  subtasks: { findMany: jest.Mock; updateMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock; count: jest.Mock };
  learner_evidence: { deleteMany: jest.Mock };
};
const finalize = sessionFinalizationService.finalize as jest.Mock;

const TASK = { id: 'task-1', title: '进行中的任务' };
const OPEN_SESSION = {
  id: 'session-1', taskId: 'task-1', status: 'active', revision: 3, topic: '主题', updatedAt: new Date('2026-10-14T00:00:00.000Z'),
};

function mockList(openSessions: Array<Record<string, unknown>>) {
  prisma.subtasks.findMany.mockResolvedValue([TASK]);
  prisma.teaching_sessions.findMany.mockResolvedValue(openSessions);
}

describe('abandonBlocking 的任务复位（P0-1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    finalize.mockResolvedValue({ status: 'completed' });
    prisma.learner_evidence.deleteMany.mockResolvedValue({ count: 1 });
    prisma.subtasks.updateMany.mockResolvedValue({ count: 1 });
    prisma.teaching_sessions.count.mockResolvedValue(0);
  });

  it('清场后：无其他开放课堂的 in_progress 任务复位回 todo，并在 resetTaskIds 里回报', async () => {
    mockList([OPEN_SESSION]);
    // 第一次 findMany=listBlocking（清场前），第二次=清场后再查（此时课堂已终态 → 空）
    prisma.teaching_sessions.findMany
      .mockResolvedValueOnce([OPEN_SESSION])
      .mockResolvedValueOnce([]);

    const result = await openSessionClearanceService.abandonBlocking({ pathId: 'p1', userId: 'u1' });

    expect(result.cleared).toHaveLength(1);
    expect(result.remaining).toHaveLength(0);
    expect(result.resetTaskIds).toEqual(['task-1']);
    expect(prisma.subtasks.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', userId: 'u1', status: 'in_progress' },
      data: { status: 'todo', updatedAt: expect.any(Date) }
    });
  });

  it('该任务还有其他开放课堂（多课堂任务未收完）→ 不复位', async () => {
    mockList([OPEN_SESSION]);
    prisma.teaching_sessions.findMany
      .mockResolvedValueOnce([OPEN_SESSION])
      .mockResolvedValueOnce([]);
    prisma.teaching_sessions.count.mockResolvedValue(1);

    const result = await openSessionClearanceService.abandonBlocking({ pathId: 'p1', userId: 'u1' });

    expect(result.cleared).toHaveLength(1);
    expect(result.resetTaskIds).toEqual([]);
    expect(prisma.subtasks.updateMany).not.toHaveBeenCalled();
  });

  it('已完成任务不受影响（只动 in_progress）', async () => {
    mockList([OPEN_SESSION]);
    prisma.teaching_sessions.findMany
      .mockResolvedValueOnce([OPEN_SESSION])
      .mockResolvedValueOnce([]);
    prisma.subtasks.updateMany.mockResolvedValue({ count: 0 });

    const result = await openSessionClearanceService.abandonBlocking({ pathId: 'p1', userId: 'u1' });
    expect(result.resetTaskIds).toEqual([]);
  });

  it('sessionIds 模式：只按指定课堂收尾（且限定本路径），不放大到整条路径', async () => {
    mockList([OPEN_SESSION]);
    prisma.teaching_sessions.findMany
      .mockResolvedValueOnce([OPEN_SESSION])
      .mockResolvedValueOnce([]);

    await openSessionClearanceService.abandonBlocking({ pathId: 'p1', userId: 'u1', sessionIds: ['session-1'] });

    expect(prisma.teaching_sessions.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'u1',
        id: { in: ['session-1'] },
        learningPathId: 'p1',
        status: { in: ['initializing', 'active', 'paused', 'timeout', 'finalizing'] }
      })
    }));
    // 不再按「路径全部任务」摊大饼
    const where = prisma.teaching_sessions.findMany.mock.calls[0][0].where;
    expect(where.taskId).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });
});
