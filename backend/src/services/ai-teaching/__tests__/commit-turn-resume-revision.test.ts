/**
 * #216：复用开课（会话恢复）不是回合提交——
 * ① 不得空转递增 revision（否则客户端乐观锁持有的 revision 与真实状态脱节）；
 * ② session_events 记 session.resumed 并带上当前 revision，而不是「turn.committed / revision=null」。
 * 默认（回合）路径保持 revision+1 与 turn.committed 不变。
 */
const mockTx = {
  teaching_sessions: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  teaching_session_messages: {
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    createMany: jest.fn(async () => ({ count: 0 })),
  },
  subtasks: { updateMany: jest.fn(async () => ({ count: 0 })) },
  session_events: { create: jest.fn(async () => ({})) },
};
const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { $transaction: mockTransaction },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { teachingSessionRepository } from '../TeachingSessionRepository';

const basePayload = {
  messages: [],
  messagesBaseCount: 0,
  knowledgeState: [],
  teachingState: { sessionArtifacts: { resumedAt: '2026-11-04T00:00:00.000Z' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.teaching_sessions.updateMany.mockResolvedValue({ count: 1 });
  mockTx.teaching_sessions.update.mockResolvedValue({});
  mockTx.teaching_sessions.findUnique.mockImplementation(async (args: any) => {
    if (args?.select?.revision) return { revision: 7 };
    if (args?.select?.messages) return { messages: null };
    return null;
  });
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
});

describe('commitTurnState 复用开课语义（#216）', () => {
  it('eventKind=session.resumed → 不推进 revision，事件记 session.resumed 且带当前 revision', async () => {
    await teachingSessionRepository.commitTurnState('sess1', 'op1', {
      ...basePayload,
      eventKind: 'session.resumed',
    } as never);

    const data = mockTx.teaching_sessions.updateMany.mock.calls[0][0].data;
    expect(data.revision).toBeUndefined();

    const event = (mockTx.session_events.create.mock.calls as any)[0][0].data;
    expect(event.kind).toBe('session.resumed');
    expect(event.revision).toBe(7);
  });

  it('默认回合提交 → 仍推进 revision 并记 turn.committed（行为不变）', async () => {
    await teachingSessionRepository.commitTurnState('sess1', 'op1', basePayload as never);

    const data = mockTx.teaching_sessions.updateMany.mock.calls[0][0].data;
    expect(data.revision).toEqual({ increment: 1 });

    const event = (mockTx.session_events.create.mock.calls as any)[0][0].data;
    expect(event.kind).toBe('turn.committed');
  });
});
