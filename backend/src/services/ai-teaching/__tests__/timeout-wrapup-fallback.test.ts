/**
 * 超时兜底学习记录（全量测试报告 #6）：零学员消息的会话不写「学习记录」，
 * 仍做终态清理（pending 检查点）；有学员消息的照旧写兜底 wrapup + 温故回写。
 */
const mockUpdateMany = jest.fn();
const mockGetById = jest.fn();
const mockApplyWarmupExtraction = jest.fn(async () => undefined);

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { updateMany: mockUpdateMany },
  },
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
  applyWarmupExtractionForSession: mockApplyWarmupExtraction,
}));

jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository');
  return { ...actual, teachingSessionRepository: { getById: mockGetById } };
});

import { applyTimeoutWrapupFallback } from '../teaching-session-ops';

function timeoutSession(messages: Array<{ role: string; content: string; timestamp: string }>) {
  return {
    id: 'sess-1',
    status: 'timeout',
    wrapup: null,
    messages,
    knowledgeState: [{ name: '概念A', status: 'learning', progress: 40 }],
    teachingState: {
      pendingCheckpoint: { checkpointId: 'cp-1' },
      sessionArtifacts: { pendingCheckpoint: { checkpointId: 'cp-2' } },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe('applyTimeoutWrapupFallback 零证据抑制（报告 #6）', () => {
  it('0 条学员消息 → 不写 wrapup，仅终态清理（pending 检查点被清）', async () => {
    mockGetById.mockResolvedValue(timeoutSession([
      { role: 'assistant', content: '同学你好', timestamp: new Date(Date.now() - 60_000).toISOString() },
    ]));

    await applyTimeoutWrapupFallback('sess-1');

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const data = mockUpdateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('wrapup');
    const state = JSON.parse(String(data.teachingState));
    expect(state.pendingCheckpoint).toBeUndefined();
    expect(state.sessionArtifacts.pendingCheckpoint).toBeUndefined();
    expect(mockApplyWarmupExtraction).not.toHaveBeenCalled();
  });

  it('有学员消息 → 照旧写兜底 wrapup（summary-only）并回写温故', async () => {
    mockGetById.mockResolvedValue(timeoutSession([
      { role: 'assistant', content: '我们开始吧', timestamp: new Date(Date.now() - 10 * 60_000).toISOString() },
      { role: 'user', content: '好的', timestamp: new Date(Date.now() - 9 * 60_000).toISOString() },
    ]));

    await applyTimeoutWrapupFallback('sess-1');

    const data = mockUpdateMany.mock.calls[0][0].data;
    const wrapup = JSON.parse(String(data.wrapup));
    expect(wrapup.status).toBe('summary-only');
    expect(wrapup.sources.summary).toBe('timeout-fallback');
    expect(mockApplyWarmupExtraction).toHaveBeenCalledTimes(1);
  });

  it('已有正式总结（guarded.count=0）→ 整体跳过', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockGetById.mockResolvedValue(timeoutSession([
      { role: 'user', content: '好的', timestamp: new Date().toISOString() },
    ]));

    await applyTimeoutWrapupFallback('sess-1');

    expect(mockApplyWarmupExtraction).not.toHaveBeenCalled();
  });
});
