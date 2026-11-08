/**
 * 172-1 回归：降级回合的 confidence 必须落回 proposing 档。
 *
 * 病灶：`STAGE_MINIMUMS.ready = 0.95`，模型自报 ready 时 confidence 被抬到 ≥0.95；平台把
 * stage 回落成 proposing 后，confidence 仍沿用 ready 档值 → 出现「stage=proposing 且
 * confidence≥0.95」的矛盾组合（stage 的结构性双源已由 goal-conversation.stage-authority 收口，
 * 只剩置信度口径）。
 *
 * 修复口径（B）：降级时把 confidence 重算进 proposing 档（0.75~0.94，上界严格低于 ready 下界
 * 0.95，两档不重叠），并同步改写 data / runtimeNextState / runtimeEnvelope 三处副本。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const mockExecuteSkill = jest.fn();
const mockRunGoalAsync = jest.fn();
const mockGenerateFromGoal = jest.fn();
const mockClaimPathCoreGeneration = jest.fn();
const mockMarkActiveGenerationFailed = jest.fn();
const mockAssembleGoalHandoff = jest.fn();
const mockPlatformSettingFindUnique = jest.fn();

let conversationRecord: any;

const mockGoalFindFirst = jest.fn(async () => conversationRecord);
const mockGoalFindUnique = jest.fn(async () => conversationRecord);
const mockGoalUpdateMany = jest.fn(async ({ data }: any) => {
  if (data?.collectedData) conversationRecord.collectedData = data.collectedData;
  if (data?.messages) conversationRecord.messages = data.messages;
  if (data?.stage) conversationRecord.stage = data.stage;
  return { count: 1 };
});
const mockGoalUpdate = jest.fn(async ({ data }: any) => {
  if (data?.collectedData) conversationRecord.collectedData = data.collectedData;
  return conversationRecord;
});

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: async (cb: any) => cb({
      goal_conversations: {
        findUnique: async () => conversationRecord,
        update: mockGoalUpdate,
        updateMany: mockGoalUpdateMany,
      },
    }),
    goal_conversations: {
      findFirst: mockGoalFindFirst,
      findUnique: mockGoalFindUnique,
      update: mockGoalUpdate,
      updateMany: mockGoalUpdateMany,
    },
    learning_paths: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: data.id, status: 'generating' })),
    },
  },
}));

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_settings: {
      findUnique: (...args: any[]) => mockPlatformSettingFindUnique(...args),
    },
  },
}));

jest.mock('../../../skills', () => ({
  __esModule: true,
  executeSkill: (...args: any[]) => mockExecuteSkill(...args),
}));
jest.mock('../../../skills/goal-conversation', () => ({
  __esModule: true,
  goalConversationAgentDefinition: { id: 'goal-conversation' },
}));
jest.mock('../../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: {
    runGoalAsync: (...args: any[]) => mockRunGoalAsync(...args),
    generateFromGoal: (...args: any[]) => mockGenerateFromGoal(...args),
  },
}));
jest.mock('../../field-dispatcher', () => ({
  __esModule: true,
  assembleGoalHandoff: (...args: any[]) => mockAssembleGoalHandoff(...args),
}));
jest.mock('../../learning/goal-path-visible-summary', () => ({
  __esModule: true,
  buildGoalPathVisibleSummary: jest.fn(() => ({})),
}));
jest.mock('../../learning/learning.service', () => ({
  __esModule: true,
  default: {
    claimPathCoreGeneration: (...args: any[]) => mockClaimPathCoreGeneration(...args),
    markActiveGenerationFailed: (...args: any[]) => mockMarkActiveGenerationFailed(...args),
  },
}));
jest.mock('../../sandbox-resolver.service', () => ({
  __esModule: true,
  checkAgentSandboxRefsFromContext: jest.fn(async () => undefined),
}));
jest.mock('../../../events/contracts', () => ({
  __esModule: true,
  createDomainEvent: jest.fn((input: any) => input),
}));
jest.mock('../../../events/outbox.repository', () => ({
  __esModule: true,
  enqueueDomainEvent: jest.fn(async () => undefined),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import goalConversationService from '../goal-conversation.service';
import * as materialSummaries from '../goal-material-summaries.service';

const UNDERSTANDING = {
  surface_goal: '学会用 Python 自动合并三个平台的订单表',
  real_problem: '每周手工合并两个多小时且容易出错',
  available_resources: { time_horizon: '一个月', time_budget: '每天 1 小时' },
  success_criteria: { observable_result: '能自己独立跑通一次周报合并' },
};

/** 模型自报 ready/completed，confidence 取 ready 档值（≥0.95）。 */
function buildSelfReportedResponse(options: {
  stage: 'ready' | 'completed' | 'proposing';
  confidence: number;
}) {
  return {
    userVisible: '我们聊得差不多了，可以开始学了。',
    debug: { structuredOutputValid: true },
    internal: {
      core: { stage: options.stage, confidence: options.confidence, isCompleted: false },
      ext: {
        goalConversation: {
          understanding: UNDERSTANDING,
          nextQuestions: [],
          quickReplies: [],
          collected: {},
        },
      },
    },
    runtimeEnvelope: {
      artifact: { reply: '我们聊得差不多了，可以开始学了。' },
      businessState: {
        domain: 'goal',
        phase: options.stage,
        status: 'succeeded',
        confidence: options.confidence,
        isTerminal: false,
        nextAction: null,
        reason: null,
      },
      contextUpdate: {
        mode: 'state-refresh',
        stateOwner: 'model',
        nextState: {
          stage: options.stage,
          confidence: options.confidence,
          understanding: UNDERSTANDING,
          collected: {},
          confirmedProposal: null,
          structuredData: null,
          confidenceScores: null,
        },
      },
    },
  };
}

function seedConversation(collectedData: Record<string, unknown>, stage = 'understanding') {
  conversationRecord = {
    id: 'conv-1',
    userId: 'user-1',
    description: '合并三个平台的订单表',
    stage,
    status: 'active',
    revision: 1,
    learningPathId: null,
    collectedData: JSON.stringify({
      messages: [{ role: 'user', content: '合并三个平台的订单表' }],
      understanding: UNDERSTANDING,
      stage,
      confirmedProposal: null,
      structuredData: null,
      confidenceScores: null,
      ...collectedData,
    }),
  };
}

/** proposing 档区间（与 skills/goal-conversation 的档位表同口径；上界严格低于 ready 下界 0.95）。 */
const PROPOSING_MIN = 0.75;
const PROPOSING_MAX = 0.94;

/**
 * skill 层的真实档位表（本套件 mock 了 ../../../skills/goal-conversation 只留 definition，
 * 这里用 requireActual 取真值，锁住「服务层降级口径」与「skill 归一档位」不漂移）。
 */
const ACTUAL_BANDS = (jest.requireActual('../../../skills/goal-conversation') as {
  GOAL_STAGE_CONFIDENCE_BANDS: Record<string, { min: number; max: number }>;
}).GOAL_STAGE_CONFIDENCE_BANDS;

beforeEach(() => {
  jest.clearAllMocks();
  seedConversation({});
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null);
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
  mockExecuteSkill.mockResolvedValue(buildSelfReportedResponse({ stage: 'ready', confidence: 0.96 }));
});

describe('172-1 降级回合的 confidence 口径', () => {
  it('proposing 档上界严格低于 ready 档下界（两档不重叠，矛盾组合不可能出现）', () => {
    expect(ACTUAL_BANDS.proposing.max).toBe(PROPOSING_MAX);
    expect(ACTUAL_BANDS.proposing.min).toBe(PROPOSING_MIN);
    expect(ACTUAL_BANDS.ready.min).toBe(0.95);
    expect(ACTUAL_BANDS.proposing.max).toBeLessThan(ACTUAL_BANDS.ready.min);
  });

  it('模型自报 ready(0.96) 降级：返回值 confidence 落进 proposing 档且不再 ≥0.95', async () => {
    const result = await goalConversationService.continueConversation(
      'conv-1',
      '我先想想，你继续说',
      'user-1'
    );

    expect(result.internal.core.stage).toBe('proposing');
    expect(result.internal.core.confidence).toBeLessThanOrEqual(PROPOSING_MAX);
    expect(result.internal.core.confidence).toBeGreaterThanOrEqual(PROPOSING_MIN);
    expect(result.internal.core.confidence).toBeLessThan(0.95);
  });

  it('降级：持久化 data / runtimeNextState / runtimeEnvelope 三处 confidence 同步为 proposing 档', async () => {
    await goalConversationService.continueConversation('conv-1', '我先想想，你继续说', 'user-1');

    const persisted = JSON.parse(conversationRecord.collectedData);
    for (const value of [
      persisted.confidence,
      persisted.runtimeNextState.confidence,
      persisted.runtimeEnvelope.contextUpdate.nextState.confidence,
    ]) {
      expect(typeof value).toBe('number');
      expect(value).toBeLessThan(0.95);
      expect(value).toBeGreaterThanOrEqual(PROPOSING_MIN);
      expect(value).toBeLessThanOrEqual(PROPOSING_MAX);
    }
    // 三处同值（不出现「权威值降了、快照还是旧值」的分叉）
    expect(persisted.runtimeNextState.confidence).toBe(persisted.confidence);
    expect(persisted.runtimeEnvelope.contextUpdate.nextState.confidence).toBe(persisted.confidence);
  });

  it('相邻两轮：第二轮喂给 skill 的 previousState.confidence 不得是 ready 档值', async () => {
    await goalConversationService.continueConversation('conv-1', '我先想想，你继续说', 'user-1');

    mockExecuteSkill.mockResolvedValue(buildSelfReportedResponse({ stage: 'proposing', confidence: 0.8 }));
    await goalConversationService.continueConversation('conv-1', '那我先看看你把目标说清楚没有', 'user-1');

    const round2Payload = mockExecuteSkill.mock.calls[1][1];
    expect(round2Payload.previousStage).toBe('proposing');
    expect(round2Payload.previousState.confidence).toBeLessThan(0.95);
    expect(round2Payload.previousState.confidence).toBeLessThanOrEqual(PROPOSING_MAX);
  });

  it('模型自报 completed 也走同一降级口径（不是只有 ready 一条路）', async () => {
    mockExecuteSkill.mockResolvedValue(buildSelfReportedResponse({ stage: 'completed', confidence: 0.97 }));

    const result = await goalConversationService.continueConversation('conv-1', '我懂了', 'user-1');

    expect(result.internal.core.stage).toBe('proposing');
    expect(result.internal.core.confidence).toBeLessThan(0.95);
    expect(result.internal.core.confidence).toBeLessThanOrEqual(PROPOSING_MAX);
  });

  it('未降级的 proposing 回合不受影响（模型自报 0.8 原样保留）', async () => {
    mockExecuteSkill.mockResolvedValue(buildSelfReportedResponse({ stage: 'proposing', confidence: 0.8 }));

    const result = await goalConversationService.continueConversation('conv-1', '继续', 'user-1');

    expect(result.internal.core.stage).toBe('proposing');
    expect(result.internal.core.confidence).toBe(0.8);
  });

  it('#176-4 接线：callAI 把 conversationId 与 surface_goal 传给资料清单收集（缓存键才成立）', async () => {
    const spy = jest.spyOn(materialSummaries, 'collectGoalUploadedMaterialSummaries');
    mockExecuteSkill.mockResolvedValue(buildSelfReportedResponse({ stage: 'proposing', confidence: 0.8 }));

    await goalConversationService.continueConversation('conv-1', '继续', 'user-1');

    expect(spy).toHaveBeenCalled();
    const options = spy.mock.calls[0][2];
    expect(options).toMatchObject({ conversationId: 'conv-1' });
    expect(options?.surfaceGoal).toBe(UNDERSTANDING.surface_goal);
    spy.mockRestore();
  });
});
