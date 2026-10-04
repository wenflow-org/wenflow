/**
 * 收束失败自愈（全量测试报告 #3）：finalization_failed 会话由 idle 巡检有界重试。
 *
 * 预算与准入口径（与 AITeachingCoordinator.retryFailedFinalizations 注释一致）：
 * - 稳定幂等键 `auto-finalize-retry:<sessionId>`：claimFinalization 的 re-claim 会自增
 *   attemptCount，天然持久化计数；
 * - attemptCount ≥ 3 放弃；最近一次失败 retryable=false 放弃；
 * - 未受理（抛错）时推进 updatedAt 做冷却，避免热循环。
 */
const mockSessionsFindMany = jest.fn();
const mockSessionsUpdateMany = jest.fn();
const mockOpsFindUnique = jest.fn();
const mockOpsFindFirst = jest.fn();
const mockFinalize = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: {
      findMany: (...args: unknown[]) => mockSessionsFindMany(...args),
      updateMany: (...args: unknown[]) => mockSessionsUpdateMany(...args),
    },
    session_finalization_operations: {
      findUnique: (...args: unknown[]) => mockOpsFindUnique(...args),
      findFirst: (...args: unknown[]) => mockOpsFindFirst(...args),
    },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../SessionFinalizationService', () => ({
  __esModule: true,
  sessionFinalizationService: { finalize: (...args: unknown[]) => mockFinalize(...args) },
}));

import { aiTeachingOrchestrator } from '../AITeachingCoordinator';

const retry = () =>
  (aiTeachingOrchestrator as unknown as { retryFailedFinalizations(): Promise<number> })
    .retryFailedFinalizations();

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    revision: 4,
    // prisma select 返回 JSON 字符串（与真实读取路径一致，锁住解析口径）
    teachingState: JSON.stringify({ sessionArtifacts: { endReason: 'idle-timeout' } }),
    ...overrides,
  };
}

afterAll(async () => {
  await aiTeachingOrchestrator.stop();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionsFindMany.mockResolvedValue([]);
  mockSessionsUpdateMany.mockResolvedValue({ count: 1 });
  mockOpsFindUnique.mockResolvedValue(null);
  mockOpsFindFirst.mockResolvedValue({
    status: 'failed',
    retryable: true,
    errorCode: 'FINALIZATION_PROVIDER_TIMEOUT',
  });
  mockFinalize.mockResolvedValue({ status: 'completed' });
});

describe('retryFailedFinalizations（报告 #3）', () => {
  it('可重试失败 → 用稳定幂等键调用一次 end_only，endReason 取自会话 artifacts', async () => {
    mockSessionsFindMany.mockResolvedValue([candidate()]);

    const retried = await retry();

    expect(retried).toBe(1);
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(mockFinalize).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      userId: 'user-1',
      action: 'end_only',
      operationId: 'auto-finalize-retry:sess-1',
      revision: 4,
      endReason: 'idle-timeout',
    });
  });

  it('记账行 attemptCount 达到上限（3）→ 不再重试', async () => {
    mockSessionsFindMany.mockResolvedValue([candidate()]);
    mockOpsFindUnique.mockResolvedValue({ status: 'failed', attemptCount: 3, retryable: true });

    const retried = await retry();

    expect(retried).toBe(0);
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it('最近一次失败 retryable=false（如持久化失败）→ 不再重试', async () => {
    mockSessionsFindMany.mockResolvedValue([candidate()]);
    mockOpsFindFirst.mockResolvedValue({
      status: 'failed',
      retryable: false,
      errorCode: 'FINALIZATION_PERSIST_FAILED',
    });

    const retried = await retry();

    expect(retried).toBe(0);
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it('候选查询限定 finalization_failed 且早于冷却窗（updatedAt.lte）', async () => {
    await retry();

    const args = mockSessionsFindMany.mock.calls[0][0];
    expect(args.where.status).toBe('finalization_failed');
    expect(args.where.updatedAt.lte).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - args.where.updatedAt.lte.getTime() - 2 * 60 * 1000)).toBeLessThan(1000);
    expect(args.take).toBe(5);
  });

  it('未受理（finalize 抛错）→ 不冒泡、推进 updatedAt 降温，endReason 兜底 manual-end', async () => {
    mockSessionsFindMany.mockResolvedValue([
      candidate({ id: 'sess-2', teachingState: '{invalid-json' }),
    ]);
    mockFinalize.mockRejectedValue(new Error('TEACHING_SESSION_REVISION_CONFLICT'));

    const retried = await retry();

    expect(retried).toBe(0);
    expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({ endReason: 'manual-end' }));
    expect(mockSessionsUpdateMany).toHaveBeenCalledWith({
      where: { id: 'sess-2' },
      data: { updatedAt: expect.any(Date) },
    });
  });
});
