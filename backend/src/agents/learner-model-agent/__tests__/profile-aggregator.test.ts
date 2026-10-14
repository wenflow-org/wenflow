/**
 * ProfileAggregator 回归用例。
 *
 * 覆盖 2026-10-14 修的两处：
 *  1. 画像叙述（背景与现状/目标与动机/时间与自述）取自**最近一次已完成目标对话**，
 *     不做跨目标并集——同一学习者不同目标的背景互不相干（实测同账号并存
 *     「幼师考指南」「AI 教育平台」「和猫沟通」）。局限由 narrativeSource 透明化。
 *  2. 互动历史的 totalMessages 原先硬写 0、三个数组恒空（前端有渲染位却永不显示），
 *     现接真实数据源。
 */
import { ProfileAggregator } from '../profile-aggregator';

const mockEvidenceFindFirst = jest.fn();
const mockGoalFindFirst = jest.fn();
const mockSessionsFindMany = jest.fn();
const mockMessageGroupBy = jest.fn();
const mockMisconceptionFindMany = jest.fn();
const mockMemoryFindMany = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learner_evidence: { findFirst: (...a: unknown[]) => mockEvidenceFindFirst(...a) },
    goal_conversations: { findFirst: (...a: unknown[]) => mockGoalFindFirst(...a) },
    teaching_sessions: { findMany: (...a: unknown[]) => mockSessionsFindMany(...a) },
    teaching_session_messages: { groupBy: (...a: unknown[]) => mockMessageGroupBy(...a) },
    misconception_ledger: { findMany: (...a: unknown[]) => mockMisconceptionFindMany(...a) },
    memory_traces: { findMany: (...a: unknown[]) => mockMemoryFindMany(...a) },
  },
}));

jest.mock('../../../services/learning/learning-state.service', () => ({
  __esModule: true,
  default: {
    getAggregatedState: jest.fn(async () => null),
    getTrends: jest.fn(async () => []),
  },
}));

jest.mock('../../../services/learner/calibration.service', () => ({
  computeCalibrationBias: jest.fn(async () => 'accurate'),
}));

jest.mock('../../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const conv = (
  understanding: Record<string, unknown>,
  meta: { description?: string; completedAt?: Date | null; extra?: Record<string, unknown> } = {}
) => ({
  id: 'gc_1',
  description: meta.description ?? '',
  completedAt: meta.completedAt === undefined ? new Date('2026-10-14T02:14:32.000Z') : meta.completedAt,
  collectedData: JSON.stringify({ understanding, ...(meta.extra || {}) }),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEvidenceFindFirst.mockResolvedValue(null);
  mockGoalFindFirst.mockResolvedValue(null);
  mockSessionsFindMany.mockResolvedValue([]);
  mockMessageGroupBy.mockResolvedValue([]);
  mockMisconceptionFindMany.mockResolvedValue([]);
  mockMemoryFindMany.mockResolvedValue([]);
});

describe('画像叙述：单对话观测 + 出处', () => {
  it('背景与现状取自最近一次已完成对话；不跨目标并集', async () => {
    mockGoalFindFirst.mockResolvedValue(
      conv(
        {
          background_experience: '幼儿园在职人员（参加园内考试）',
          pain_points: ['之前完全没接触过这份指南', '时间很紧'],
          current_baseline: { level: 'beginner' },
        },
        { description: '我想学3-6岁儿童发展指南，最近要考试了' }
      )
    );

    const { profile } = await new ProfileAggregator().aggregateProfile('u1');

    expect(profile.narrativeInsights.backgroundContextNote).toContain('幼儿园在职人员');
    expect(profile.narrativeInsights.backgroundContextNote).toContain('当前自述水平：beginner');
    expect(profile.narrativeInsights.backgroundContextNote).toContain('时间很紧');
    expect(profile.narratives?.painPoints).toEqual(['之前完全没接触过这份指南', '时间很紧']);
    // 只查一条（findFirst），不拉全量做并集
    expect(mockGoalFindFirst).toHaveBeenCalledTimes(1);
  });

  it('narrativeSource 带上出处：目标描述与完成时间（归一为 ISO）', async () => {
    mockGoalFindFirst.mockResolvedValue(
      conv({ real_problem: '想通过园内考试' }, { description: '我想学3-6岁儿童发展指南，最近要考试了' })
    );

    const { profile } = await new ProfileAggregator().aggregateProfile('u1');

    expect(profile.narrativeSource).toEqual({
      conversationId: 'gc_1',
      goalTitle: '我想学3-6岁儿童发展指南，最近要考试了',
      completedAt: '2026-10-14T02:14:32.000Z',
    });
  });

  it('对话没有描述时给出占位标题（不渲染空标签）', async () => {
    mockGoalFindFirst.mockResolvedValue(conv({}, { description: '   ' }));
    const { profile } = await new ProfileAggregator().aggregateProfile('u1');
    expect(profile.narrativeSource?.goalTitle).toBe('（该次目标对话未填写描述）');
  });

  it('目标理解证据优先于 collectedData（保持既有语义）', async () => {
    mockEvidenceFindFirst.mockResolvedValue({
      payload: JSON.stringify({ understanding: { real_problem: '来自证据的真实问题' } }),
    });
    mockGoalFindFirst.mockResolvedValue(conv({ real_problem: '来自对话的问题' }));

    const { profile } = await new ProfileAggregator().aggregateProfile('u1');

    expect(profile.narrativeInsights.goalNarrative).toBe('来自证据的真实问题');
  });

  it('learner_background 的复用基础并入优势', async () => {
    mockGoalFindFirst.mockResolvedValue(
      conv({}, { extra: { learner_background: { reusableFoundations: ['会做表格'] } } })
    );

    const { profile } = await new ProfileAggregator().aggregateProfile('u1');

    expect(profile.derivedInsights.strengths).toContain('可复用基础：会做表格');
  });

  it('无证据也无已完成对话：全默认画像且 narrativeSource 为 null', async () => {
    const { profile } = await new ProfileAggregator().aggregateProfile('u1');
    expect(profile.narrativeInsights.backgroundContextNote).toBe('背景信息还不充分，后续需要结合学习表现继续补齐。');
    expect(profile.narrativeSource).toBeNull();
    expect(profile.history.totalSessions).toBe(0);
  });
});

describe('互动历史真实计数', () => {
  it('总消息数=侧表计数+旧列回退；主题/概念来自真实数据源', async () => {
    mockSessionsFindMany.mockImplementation((args: { select?: Record<string, unknown> }) =>
      Promise.resolve(
        args?.select && 'messages' in args.select
          ? [{ messages: JSON.stringify([{ role: 'user' }, { role: 'assistant' }]) }] // s3 无侧表行 → 旧列
          : [
              { id: 's1', duration: 10, topic: '分层推题' },
              { id: 's2', duration: 0, topic: '分层推题' },
              { id: 's3', duration: 6, topic: '观测与推断' },
            ]
      )
    );
    mockMessageGroupBy.mockResolvedValue([
      { sessionId: 's1', _count: { _all: 5 } },
      { sessionId: 's2', _count: { _all: 3 } },
    ]);
    mockMisconceptionFindMany.mockResolvedValue([
      { canonicalLabel: '混淆时间线与适用范围' },
      { canonicalLabel: '事实推断混写' },
    ]);
    mockMemoryFindMany.mockResolvedValue([{ label: '标注时间估算依据' }, { label: '建立限时练习记录' }]);

    const { profile } = await new ProfileAggregator().aggregateProfile('u1');

    expect(profile.history.totalMessages).toBe(10); // 5 + 3 + 旧列 2
    expect(profile.history.totalSessions).toBe(3);
    expect(profile.history.avgSessionDuration).toBeCloseTo(16 / 3, 5);
    expect(profile.history.topicsExplored).toEqual(['分层推题', '观测与推断']); // 去重且保序
    expect(profile.history.conceptsStruggled).toEqual(['混淆时间线与适用范围', '事实推断混写']);
    expect(profile.history.conceptsMastered).toEqual(['标注时间估算依据', '建立限时练习记录']);
  });

  it('无会话时互动历史回落默认值（不查消息/概念）', async () => {
    const { profile } = await new ProfileAggregator().aggregateProfile('u1');
    expect(profile.history.totalMessages).toBe(0);
    expect(mockMessageGroupBy).not.toHaveBeenCalled();
    expect(mockMisconceptionFindMany).not.toHaveBeenCalled();
  });
});
