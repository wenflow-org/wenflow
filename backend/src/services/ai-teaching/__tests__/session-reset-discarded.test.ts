/**
 * 重置（discarded）课末记录口径回归（全量测试报告 #1）：
 * discarded 会话不生成课末学习记录（无 wrapup 写入），只做状态机与时间簿记
 * （status='discarded'、endTime/duration、sessionArtifacts.resetAt、清 openKey）。
 * 对照口径：completed 走 model 正式总结；timeout 走确定性模板兜底（见 timeout-wrapup-fallback.test.ts）；
 * finalization_failed 保持 wrapup=NULL 直至收束自愈（见 finalization-auto-retry.test.ts）。
 */
const mockGetById = jest.fn();
const mockClaimOperation = jest.fn();
const mockCommitLifecycleState = jest.fn();
const mockReleaseOperation = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { teaching_sessions: {} },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../skills', () => ({
  executeSkill: jest.fn(),
  peerAgentDefinition: {},
}));

jest.mock('../teaching-turn-engine', () => ({
  processStudentMessage: jest.fn(),
}));

jest.mock('../warmup-writeback', () => ({
  applyWarmupExtractionForSession: jest.fn(),
}));

jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository');
  return {
    ...actual,
    teachingSessionRepository: {
      getById: mockGetById,
      claimOperation: mockClaimOperation,
      commitLifecycleState: mockCommitLifecycleState,
      releaseOperation: mockReleaseOperation,
    },
  };
});

import { resetSession } from '../teaching-session-ops';

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    status: 'active',
    wrapup: null,
    startTime: new Date(Date.now() - 30 * 60 * 1000),
    messages: [
      { role: 'assistant', content: '我们开始吧', timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
      { role: 'user', content: '好的', timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
    ],
    knowledgeState: [],
    teachingState: { sessionArtifacts: { endReason: null } },
    revision: 7,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClaimOperation.mockResolvedValue({ operationId: 'op-reset-1', session: session() });
  mockCommitLifecycleState.mockResolvedValue(undefined);
  mockReleaseOperation.mockResolvedValue(undefined);
});

describe('resetSession 重置口径（报告 #1：discarded 无课末记录）', () => {
  it('active → discarded：状态/时间簿记齐全，不写 wrapup（不生成课末学习记录）', async () => {
    mockGetById.mockResolvedValue(session());

    const revision = await resetSession('sess-1', 'user-1', 7);

    expect(revision).toBe(8);
    expect(mockClaimOperation).toHaveBeenCalledWith(
      'sess-1',
      'reset',
      ['active', 'paused', 'timeout'],
      7,
    );
    const [, operationId, patch] = mockCommitLifecycleState.mock.calls[0];
    expect(operationId).toBe('op-reset-1');
    expect(patch.status).toBe('discarded');
    expect(patch.endTime).toBeInstanceOf(Date);
    expect(typeof patch.duration).toBe('number');
    expect(patch.duration).toBeGreaterThanOrEqual(1);
    expect(patch.clearOpenKey).toBe(true);
    // 课末记录口径：重置不产生 wrapup（报告 #1 冻结快照里 discarded 556/2438 wrapup=NULL）
    expect(patch).not.toHaveProperty('wrapup');
    const state = patch.teachingState as Record<string, any>;
    expect(Number.isFinite(Date.parse(state.sessionArtifacts.resetAt))).toBe(true);
    expect(mockReleaseOperation).not.toHaveBeenCalled();
  });

  it('已是 discarded → 幂等返回当前 revision，不再占租约', async () => {
    mockGetById.mockResolvedValue(session({ status: 'discarded' }));

    const revision = await resetSession('sess-1', 'user-1', 7);

    expect(revision).toBe(7);
    expect(mockClaimOperation).not.toHaveBeenCalled();
    expect(mockCommitLifecycleState).not.toHaveBeenCalled();
  });

  it.each(['completed', 'superseded'])('%s 会话不可重置', async (status) => {
    mockGetById.mockResolvedValue(session({ status }));

    await expect(resetSession('sess-1', 'user-1', 7)).rejects.toThrow('已结束的会话无法重置');
    expect(mockClaimOperation).not.toHaveBeenCalled();
  });

  it('提交失败 → 释放操作租约并向上抛错', async () => {
    mockGetById.mockResolvedValue(session());
    mockCommitLifecycleState.mockRejectedValue(new Error('commit failed'));

    await expect(resetSession('sess-1', 'user-1', 7)).rejects.toThrow('commit failed');

    expect(mockReleaseOperation).toHaveBeenCalledWith('sess-1', 'op-reset-1');
  });
});
