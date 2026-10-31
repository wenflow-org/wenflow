/**
 * completeInitialization 原子性回归（2026-10-20）。
 *
 * 目标不是覆盖整条仓库，而是钉住一条不变量：**状态转 active 与开场消息落侧表必须在同一个
 * 事务客户端上执行**。此前两步分开写，第二步失败会留下「已开课但没有开场白」的半成品会话。
 *
 * 做法：mock withTransaction 直接执行回调并暴露同一个 tx；断言 appendTeachingMessages
 * 收到的 db 参数就是那个 tx，而不是全局 prisma。
 */
const mockAppendTeachingMessages = jest.fn();
const mockTx = {
  teaching_sessions: {
    updateMany: jest.fn(),
    // 事务内读 revision（session.initialized 事件要带修订号）
    findUnique: jest.fn(),
  },
  session_events: { create: jest.fn() },
};

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { findUnique: jest.fn() },
  },
}));

jest.mock('../../../utils/with-transaction', () => ({
  withTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
}));

jest.mock('../teaching-session-message-store', () => ({
  appendTeachingMessages: (...args: unknown[]) => mockAppendTeachingMessages(...args),
  commitTeachingMessages: jest.fn(),
  hydrateTeachingSessionMessages: jest.fn(),
  TeachingMessageBaseStaleError: class TeachingMessageBaseStaleError extends Error {},
}));

jest.mock('../../../events/outbox.repository', () => ({ enqueueDomainEvent: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import prisma from '../../../config/database';
import { teachingSessionRepository, TeachingSessionConflictError } from '../TeachingSessionRepository';

const sessionRow = {
  id: 'session-1',
  userId: 'user-1',
  taskId: 'task-1',
  learningPathId: null,
  milestoneId: null,
  subject: 'math',
  topic: '分数',
  taskType: 'practice',
  mode: 'tutor',
  status: 'active',
  messages: [],
  knowledgeState: '[]',
  teachingState: '{}',
  wrapup: null,
  advisory: null,
  startTime: new Date(),
  endTime: null,
  duration: null,
  revision: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const payload = {
  messages: [{ role: 'assistant' as const, content: '开场白', timestamp: '2026-10-20T00:00:00.000Z' }],
  knowledgeState: [],
  teachingState: { sessionArtifacts: {} },
};

describe('TeachingSessionRepository.completeInitialization（事务原子性）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTx.teaching_sessions.updateMany.mockResolvedValue({ count: 1 });
    mockTx.teaching_sessions.findUnique.mockResolvedValue({ revision: 2 });
    mockTx.session_events.create.mockResolvedValue({});
    (prisma.teaching_sessions.findUnique as jest.Mock).mockResolvedValue(sessionRow);
  });

  it('状态更新与开场消息使用同一个事务客户端', async () => {
    await teachingSessionRepository.completeInitialization('session-1', 'op-1', payload);

    expect(mockTx.teaching_sessions.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'session-1', status: 'initializing', operationId: 'op-1' }),
      data: expect.objectContaining({ status: 'active', operationId: null }),
    }));
    expect(mockAppendTeachingMessages).toHaveBeenCalledWith('session-1', payload.messages, mockTx);
    // 会话事件与业务同事务写（不落到全局 prisma）
    expect(mockTx.session_events.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sessionId: 'session-1', kind: 'session.initialized', status: 'ok', revision: 2 }),
    }));
  });

  it('没有开场消息时不写侧表', async () => {
    await teachingSessionRepository.completeInitialization('session-1', 'op-1', { ...payload, messages: [] });
    expect(mockAppendTeachingMessages).not.toHaveBeenCalled();
  });

  it('状态已被他人改变 → 抛冲突且不写消息（事务内失败 → 整体回滚）', async () => {
    mockTx.teaching_sessions.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      teachingSessionRepository.completeInitialization('session-1', 'op-1', payload)
    ).rejects.toBeInstanceOf(TeachingSessionConflictError);
    expect(mockAppendTeachingMessages).not.toHaveBeenCalled();
  });
});
