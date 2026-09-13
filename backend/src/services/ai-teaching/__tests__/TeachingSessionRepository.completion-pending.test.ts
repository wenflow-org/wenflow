const mockFindMany = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { teaching_sessions: { findMany: mockFindMany } }
}));

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

import { teachingSessionRepository } from '../TeachingSessionRepository';

function record(id: string, teachingState: Record<string, unknown>) {
  return {
    id,
    userId: 'u1',
    taskId: 't1',
    status: 'completed',
    messages: '[]',
    knowledgeState: '[]',
    teachingState: JSON.stringify(teachingState),
    revision: 3
  };
}

describe('TeachingSessionRepository.findCompletionPendingSession (P3)', () => {
  beforeEach(() => mockFindMany.mockReset());

  it('返回「完成结算自动关课、但任务未结算」的 completed 会话', async () => {
    mockFindMany.mockResolvedValue([
      record('manual', { sessionArtifacts: { endReason: 'manual-end' }, finalization: { taskCompletion: 'not_started' } }),
      record('auto', { sessionArtifacts: { endReason: 'task-completed' }, finalization: { taskCompletion: 'not_started' } })
    ]);

    const found = await teachingSessionRepository.findCompletionPendingSession('u1', 't1');

    expect(found?.id).toBe('auto');
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', taskId: 't1', status: 'completed' }
    }));
  });

  it('已结算、或用户主动「结束不结算」的会话都跳过', async () => {
    mockFindMany.mockResolvedValue([
      record('settled', { sessionArtifacts: { endReason: 'task-completed' }, finalization: { taskCompletion: 'completed' } }),
      record('manual', { sessionArtifacts: { endReason: 'manual-end' }, finalization: { taskCompletion: 'not_started' } })
    ]);

    expect(await teachingSessionRepository.findCompletionPendingSession('u1', 't1')).toBeNull();
  });

  it('没有 completed 会话时返回 null', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await teachingSessionRepository.findCompletionPendingSession('u1', 't1')).toBeNull();
  });
});
