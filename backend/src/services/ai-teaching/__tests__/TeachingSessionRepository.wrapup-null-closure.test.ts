/**
 * #239 回归：`completed + wrapup = NULL` 是幽灵课（<2 条学生回合且 <60s）的**合法终态**。
 *
 * 旧实现在两处把「wrapup 存在」当成「收束完成」的判据：
 * - `claimFinalization(end_only)` 的 stepCompleted；
 * - `recordDirectTaskCompletion` 的前置校验。
 * 于是这类会话被反复判成「没结束」：重放 end_only 撞 STATE_CHANGED（allowedStatuses 不含
 * completed）、补记任务结算被 409 SESSION_NOT_CLOSED —— 课堂与任务一起永久卡死。
 *
 * 本文件锁的是「按 status 判定闭合」这条契约（teaching-session-lifecycle.ts 收束分支自己写的口径）。
 */
const mockTx = {
  teaching_sessions: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  session_finalization_operations: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
};
const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { findUnique: jest.fn() },
    teaching_session_messages: { findMany: jest.fn(async () => []) },
    $transaction: (...args: unknown[]) => mockTransaction(...(args as [never])),
  },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../../config/database';
import { teachingSessionRepository } from '../TeachingSessionRepository';

function ghostRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-ghost',
    userId: 'user-1',
    taskId: 'task-1',
    subject: '数学',
    topic: '分数',
    taskType: 'concept',
    mode: 'tutor',
    status: 'completed',
    messages: '[]',
    knowledgeState: '[]',
    teachingState: '{}',
    // #239 的关键特征：completed 但 wrapup 为 NULL
    wrapup: null,
    advisory: null,
    startTime: new Date('2026-11-05T00:00:00.000Z'),
    endTime: new Date('2026-11-05T00:00:19.220Z'),
    duration: 0,
    revision: 5,
    openKey: null,
    operationId: null,
    operationKind: null,
    operationLeaseExpiresAt: null,
    createdAt: new Date('2026-11-05T00:00:00.000Z'),
    updatedAt: new Date('2026-11-05T00:00:19.220Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.teaching_sessions.updateMany.mockResolvedValue({ count: 1 });
  mockTx.session_finalization_operations.findUnique.mockResolvedValue(null);
  mockTx.session_finalization_operations.findFirst.mockResolvedValue(null);
  mockTx.session_finalization_operations.create.mockResolvedValue({});
  mockTx.session_finalization_operations.updateMany.mockResolvedValue({ count: 1 });
});

describe('claimFinalization / recordDirectTaskCompletion：completed + wrapup=NULL 视为已收束（#239）', () => {
  it('end_only 重放命中 completed 幽灵课时返回 completed，而不落到 STATE_CHANGED', async () => {
    mockTx.teaching_sessions.findUnique.mockResolvedValue(ghostRecord());

    const claim = await teachingSessionRepository.claimFinalization(
      'session-ghost',
      'end_only',
      'end-op',
      'hash',
      '{"action":"end_only"}'
    );

    expect(claim.status).toBe('completed');
    // 幂等账本补行（历史行只有 end_only+deriveKey 那一行时也要能重放）
    expect(mockTx.session_finalization_operations.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'end_only', status: 'completed' }) })
    );
  });

  it('recordDirectTaskCompletion 放行 completed + wrapup=NULL 的会话（补记台账）', async () => {
    (prisma as any).teaching_sessions.findUnique.mockResolvedValue({ ...ghostRecord() });
    const claimSpy = jest
      .spyOn(teachingSessionRepository, 'claimFinalization')
      .mockResolvedValue({
        status: 'claimed',
        operationId: 'direct-task-completion:human-ui',
        leaseOwner: 'lease-1',
        session: ghostRecord() as any,
      });
    const stepSpy = jest
      .spyOn(teachingSessionRepository, 'completeFinalizationStep')
      .mockResolvedValue(ghostRecord() as any);

    await expect(
      teachingSessionRepository.recordDirectTaskCompletion('session-ghost', 'user-1', 'human-ui')
    ).resolves.toBe('completed');

    expect(claimSpy).toHaveBeenCalled();
    expect(stepSpy).toHaveBeenCalledWith(
      'session-ghost',
      'direct-task-completion:human-ui',
      'lease-1',
      'complete_task',
      expect.objectContaining({ taskCompletion: expect.objectContaining({ status: 'completed' }) })
    );
  });

  it('recordDirectTaskCompletion 仍拒绝未收束（active）的会话', async () => {
    (prisma as any).teaching_sessions.findUnique.mockResolvedValue({
      ...ghostRecord({ status: 'active', wrapup: null }),
    });
    const claimSpy = jest.spyOn(teachingSessionRepository, 'claimFinalization');

    await expect(
      teachingSessionRepository.recordDirectTaskCompletion('session-ghost', 'user-1', 'human-ui')
    ).rejects.toMatchObject({ code: 'FINALIZATION_SESSION_NOT_CLOSED' });

    expect(claimSpy).not.toHaveBeenCalled();
  });
});
