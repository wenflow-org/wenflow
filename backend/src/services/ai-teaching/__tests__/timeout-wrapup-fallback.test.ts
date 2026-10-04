/**
 * 超时兜底学习记录口径（全量测试报告 #1/#6）：
 * - timeout 会话只有确定性模板兜底（无 evaluation、无指标、不发 lesson:completed 域事件）；
 * - 零学员消息的会话（msgs=1/users=0）不写「学习记录」，仍做终态清理（pending 检查点）；
 * - 有学员消息的照旧写兜底 wrapup + 温故回写，duration 有 1 分钟下限。
 */
const mockUpdateMany = jest.fn();
const mockGetById = jest.fn();
const mockApplyWarmupExtraction = jest.fn(async () => undefined);
const mockOutboxCreate = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { updateMany: mockUpdateMany },
    // lesson:completed 域事件只在正常收束链发出；兜底路径断言零写入
    domain_event_outbox: { create: mockOutboxCreate },
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

describe('applyTimeoutWrapupFallback 课末记录口径（报告 #1/#6）', () => {
  it('零证据兜底记录显式用例（msgs=1、users=0）→ 不写 wrapup，仅终态清理（pending 检查点被清）', async () => {
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

  it('有学员消息 → 确定性模板兜底（summary-only、evaluation=null、无指标），不发 lesson:completed', async () => {
    mockGetById.mockResolvedValue(timeoutSession([
      { role: 'assistant', content: '我们开始吧', timestamp: new Date(Date.now() - 10 * 60_000).toISOString() },
      { role: 'user', content: '好的', timestamp: new Date(Date.now() - 9 * 60_000).toISOString() },
    ]));

    await applyTimeoutWrapupFallback('sess-1');

    const data = mockUpdateMany.mock.calls[0][0].data;
    const wrapup = JSON.parse(String(data.wrapup));
    expect(wrapup.status).toBe('summary-only');
    expect(wrapup.sources).toEqual({ summary: 'timeout-fallback', evaluation: 'failed' });
    // 无 evaluation、无课堂指标、无要点/行动项——确定性模板不冒充模型总结
    expect(wrapup.evaluation).toBeNull();
    expect(wrapup.summary.evaluationHighlights).toBeNull();
    expect(wrapup.summary.keyTakeaways).toEqual([]);
    expect(wrapup.summary.actionPlan).toEqual([]);
    expect(wrapup.evidence.avgUnderstanding).toBeNull();
    expect(wrapup.evidence.avgEngagement).toBeNull();
    expect(wrapup.evidence.emotionalSignals).toEqual({ positive: 0, neutral: 0, frustrated: 0, confused: 0 });
    expect(wrapup.summary.summaryVersion).toBe('v2');
    // 兜底路径不得发出 lesson:completed 域事件（对照：completed 438/450 走 model 正式总结并带事件）
    expect(mockOutboxCreate).not.toHaveBeenCalled();
    expect(mockApplyWarmupExtraction).toHaveBeenCalledTimes(1);
  });

  it('单条学员消息 → 活跃时长取下限 1 分钟', async () => {
    mockGetById.mockResolvedValue(timeoutSession([
      { role: 'assistant', content: '我们开始吧', timestamp: new Date(Date.now() - 60_000).toISOString() },
      { role: 'user', content: '好的', timestamp: new Date(Date.now() - 60_000).toISOString() },
    ]));

    await applyTimeoutWrapupFallback('sess-1');

    const wrapup = JSON.parse(String(mockUpdateMany.mock.calls[0][0].data.wrapup));
    expect(wrapup.duration).toBe(1);
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
