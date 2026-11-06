/**
 * 172-1：goal stage 的单一权威源。
 *
 * 病灶：模型自报 ready 被平台回落 proposing 时（continueConversation 的降级落点），
 * 只改 `data.stage='proposing'`，不同步 `data.runtimeNextState` /
 * `data.runtimeEnvelope.contextUpdate.nextState`（这两个是同一轮模型自报值的快照，
 * 见 updateCollectedData）。而 buildPreviousState 的优先级是 `next.stage || data.stage`，
 * 下一轮 `previousStage` 又读回 `ready` → goal skill 的 ready floor 0.95 把
 * confidence 抬到 ≥0.95，降级形同虚设。
 *
 * 修复后：① 降级时三处 stage 一起改写；② previousStage 只认 data.stage / 会话 stage 列。
 */
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

const UNDERSTANDING = {
  surface_goal: '学会用 Python 自动合并三个平台的订单表',
  real_problem: '每周手工合并两个多小时且容易出错',
  available_resources: { time_horizon: '一个月', time_budget: '每天 1 小时' },
  success_criteria: { observable_result: '能自己独立跑通一次周报合并' },
};

/** 模型自报 ready：core.stage 与 runtimeEnvelope.businessState.phase 一致报 ready。 */
function buildSelfReportedReadyResponse(stage: 'ready' | 'proposing' = 'ready') {
  return {
    userVisible: '我们聊得差不多了，可以开始学了。',
    debug: { structuredOutputValid: true },
    internal: {
      core: { stage, confidence: 0.96, isCompleted: false },
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
        phase: stage,
        status: 'succeeded',
        confidence: 0.96,
        isTerminal: false,
        nextAction: null,
        reason: null,
      },
      contextUpdate: {
        mode: 'state-refresh',
        stateOwner: 'model',
        nextState: {
          stage,
          confidence: 0.96,
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

beforeEach(() => {
  jest.clearAllMocks();
  seedConversation({});
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null);
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
  mockExecuteSkill.mockResolvedValue(buildSelfReportedReadyResponse('ready'));
});

describe('172-1 goal stage 单一权威源', () => {
  it('模型自报 ready 降级：runtimeNextState 与 runtimeEnvelope 快照三处 stage 同步为 proposing', async () => {
    const result = await goalConversationService.continueConversation(
      'conv-1',
      '我先想想，你继续说',
      'user-1'
    );

    expect(result.internal.core.stage).toBe('proposing');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.stage).toBe('proposing');
    // 快照同步（修复前这里是 'ready'，下一轮 previousStage 会被反向覆盖）
    expect(persisted.runtimeNextState.stage).toBe('proposing');
    expect(persisted.runtimeEnvelope.contextUpdate.nextState.stage).toBe('proposing');
  });

  it('相邻两轮：第二轮喂给 skill 的 previousStage 不得出现 ready', async () => {
    // 第 1 轮：模型自报 ready → 平台回落 proposing（并同步快照）
    await goalConversationService.continueConversation('conv-1', '我先想想，你继续说', 'user-1');

    // 第 2 轮：模型正常报 proposing
    mockExecuteSkill.mockResolvedValue(buildSelfReportedReadyResponse('proposing'));
    await goalConversationService.continueConversation('conv-1', '那我先看看你把目标说清楚没有', 'user-1');

    const round2Payload = mockExecuteSkill.mock.calls[1][1];
    expect(round2Payload.previousStage).toBe('proposing');
    expect(round2Payload.previousStage).not.toBe('ready');
    expect(round2Payload.previousState.stage).toBe('proposing');
  });

  it('历史脏数据（data.stage=proposing 但快照仍是 ready）：previousStage 仍取 proposing', async () => {
    // 模拟修复前落库的会话：stage 已降级，快照留了模型自报的 ready
    seedConversation({
      runtimeNextState: { stage: 'ready', confidence: 0.96, understanding: {}, collected: {} },
      runtimeEnvelope: {
        businessState: { phase: 'ready' },
        contextUpdate: { nextState: { stage: 'ready', confidence: 0.96 } },
      },
    }, 'proposing');
    mockExecuteSkill.mockResolvedValue(buildSelfReportedReadyResponse('proposing'));

    await goalConversationService.continueConversation('conv-1', '继续', 'user-1');

    const payload = mockExecuteSkill.mock.calls[0][1];
    expect(payload.previousStage).toBe('proposing');
    expect(payload.previousState.stage).toBe('proposing');
  });
});
