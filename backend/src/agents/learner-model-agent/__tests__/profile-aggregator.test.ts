/* eslint-disable @typescript-eslint/no-explicit-any -- 测试桩动态访问私有方法，形状随实现演进 */
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
    // 2026-11-09 走查修：level 枚举不再原样透出，按全站等级词汇出中文
    expect(profile.narrativeInsights.backgroundContextNote).toContain('当前自述水平：入门');
    expect(profile.narrativeInsights.backgroundContextNote).not.toContain('beginner');
    expect(profile.narrativeInsights.backgroundContextNote).toContain('时间很紧');
    // 段间拼接不再出现「。；」这种句读连排（各段自带句末「。」）
    expect(profile.narrativeInsights.backgroundContextNote).not.toMatch(/[。；]\s*；/);
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

  // issue #196：knowledge-background 合并分支随其唯一写入方（learner.coordinator）退役而删除；
  // dataType 已收窄为 applyUpdate 实际落地的三种（types.ts），本用例以存量非法字面量验证
  // 运行期防御分支仍显式判失败（不再静默写回）。
  it('applyUpdate 对未支持的 dataType 返回失败（不再静默写回）', async () => {
    mockGoalFindFirst.mockResolvedValue(conv({}));

    const result = await new ProfileAggregator().applyUpdate('u1', {
      agentId: 'test',
      timestamp: new Date().toISOString(),
      dataType: 'behavioral' as any,
      data: {},
      confidence: 0.5,
    });

    expect(result).toEqual({ success: false, changes: [] });
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

describe('P1-2 画像已掌握概念不得吃 KT 幽灵痕', () => {
  it('查询条件带 extractionCount>0，只把真正提取过的痕迹当掌握证据', async () => {
    mockMemoryFindMany.mockResolvedValue([{ label: '真实提取过的概念' }]);

    const labels = await (new ProfileAggregator() as any).fetchMasteredConcepts('u1');
    const query = mockMemoryFindMany.mock.calls.at(-1)![0] as { where: Record<string, unknown> };

    expect(labels).toEqual(['真实提取过的概念']);
    expect(query.where).toMatchObject({
      userId: 'u1',
      masteryScore: { gte: 0.8 },
      extractionCount: { gt: 0 },
    });
  });
});

/* 2026-11-02 P1-8：画像页要逐格区分「实测」与「初始默认值」，只靠「证据为空」一个全局条件
   会把同卡里两种来源一起标错（有目标对话但没上过课时，认知/偏好来自对话、行为基线仍是默认）。 */
describe('画像字段来源 profileSources', () => {
  it('无任何数据：各段来源为空（界面逐格标默认值）', async () => {
    const { sources } = await new ProfileAggregator().aggregateProfile('u1');
    expect(sources).toEqual({
      cognitive: [],
      behavioral: [],
      learning: [],
      preferences: [],
      emotional: [],
      history: [],
      curriculumControls: [],
      derivedInsights: [],
    });
  });

  it('只有目标对话：认知/偏好/情绪按对话字段记来源；行为基线与其派生读数仍算默认', async () => {
    mockGoalFindFirst.mockResolvedValue(
      conv({
        cognitive_profile: { thinking_style: 'practical', metacognition_level: 'high' },
        learning_style: { preferred_format: 'practice', theory_vs_practice: 'practice-first' },
        emotional_profile: { confidence_level: 'anxious' },
      })
    );

    const { sources } = await new ProfileAggregator().aggregateProfile('u1');

    expect(sources.cognitive).toContain('thinkingStyle');
    expect(sources.cognitive).toContain('metacognitionLevel');
    expect(sources.cognitive).not.toContain('confusionPattern');
    // 对话里没给时间预算时 sessionLength 是 inferSessionLength 的兜底值，不算实测
    expect(sources.preferences).toEqual(['preferredStyle', 'theoryVsPractice']);
    expect(sources.emotional).toEqual(['confidenceLevel']);
    expect(sources.behavioral).toEqual([]);
    expect(sources.learning).toEqual([]);
    expect(sources.history).toEqual([]);
    expect(sources.derivedInsights).not.toContain('learningVelocity');
    expect(sources.derivedInsights).not.toContain('optimalSessionLength');
    expect(sources.derivedInsights).toContain('recommendedDifficulty');
    expect(sources.derivedInsights).toContain('suggestedApproach');
  });
});
