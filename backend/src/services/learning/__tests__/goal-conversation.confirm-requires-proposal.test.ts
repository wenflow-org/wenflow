/**
 * #162：确认通道不得为「空提案」代签。
 *
 * 病灶：goal-conversation.service 的确认分支条件只有 `stage === 'proposing' && confirmProposal`，
 * 从不校验 `data.confirmedProposal` 的内容。模型某轮没产出提案时，用户点确认/回「就按这个来」
 * 也会直接 bindGeneratingPath → 生成一条 confirmedProposal=null 的路径（「还没够就开始建路径」）。
 *
 * 修复后：没有可用提案（learning_direction / first_deliverable / key_stages>=2）时，
 * 确认被降级为普通回合——不建路径、不落学习路径，由模型先把提案补出来。
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

/** 模型在本轮只回「请先确认这版方向」，没有产出 confirmedProposal。 */
function buildResponseWithoutProposal(overrides: { confirmedProposal?: any; stage?: string } = {}) {
  return {
    userVisible: '这一版先聚焦两段：先把明细合起来，再做汇总。先确认这个方向。',
    debug: { structuredOutputValid: true },
    internal: {
      core: { stage: overrides.stage ?? 'proposing', confidence: 0.85, isCompleted: false },
      ext: {
        goalConversation: {
          understanding: {
            surface_goal: '学会用 Python 自动合并三个平台的订单表',
            real_problem: '每周手工合并两个多小时且容易出错',
            available_resources: { time_horizon: '一个月', time_budget: '每天 1 小时' },
            success_criteria: { observable_result: '能自己独立跑通一次周报合并' },
          },
          nextQuestions: [],
          quickReplies: [],
          collected: {},
          ...(overrides.confirmedProposal ? { confirmedProposal: overrides.confirmedProposal } : {}),
        },
      },
    },
    runtimeEnvelope: null,
  };
}

function seedProposingConversation(collectedData: Record<string, unknown>) {
  conversationRecord = {
    id: 'conv-1',
    userId: 'user-1',
    description: '合并三个平台的订单表',
    stage: 'proposing',
    status: 'active',
    revision: 1,
    learningPathId: null,
    collectedData: JSON.stringify({
      messages: [{ role: 'user', content: '合并三个平台的订单表' }],
      understanding: {
        surface_goal: '学会用 Python 自动合并三个平台的订单表',
        real_problem: '每周手工合并两个多小时且容易出错',
        available_resources: { time_horizon: '一个月', time_budget: '每天 1 小时' },
        success_criteria: { observable_result: '能自己独立跑通一次周报合并' },
      },
      stage: 'proposing',
      confirmedProposal: null,
      structuredData: null,
      confidenceScores: null,
      ...collectedData,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  seedProposingConversation({});
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null);
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
  mockExecuteSkill.mockResolvedValue(buildResponseWithoutProposal());
});

describe('#162 确认通道要求提案非空', () => {
  it('confirmedProposal=null + confirmProposal:true → 不生成路径（不进入 completed、不 claim run）', async () => {
    const result = await goalConversationService.continueConversation(
      'conv-1',
      '就按这个来，确认',
      'user-1',
      { confirmProposal: true }
    );

    // 关键：生成链路一次都不能被触发
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(mockGenerateFromGoal).not.toHaveBeenCalled();
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(result.internal.core.stage).not.toBe('completed');
    expect(result.internal.core.isCompleted).toBe(false);
    // 本次确认没有被当成「已确认」落库
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.learningPath ?? null).toBeNull();
    expect(persisted.lastConfirmation?.confirmed ?? false).toBe(false);
  });

  it('confirmedProposal 半截（只有方向、没有阶段）→ 同样不生成路径', async () => {
    seedProposingConversation({
      confirmedProposal: { learning_direction: '先合表再汇总', first_deliverable: '一张周报', key_stages: [] },
    });

    await goalConversationService.continueConversation('conv-1', '确认', 'user-1', { confirmProposal: true });

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
  });

  it('提案齐备 + confirmProposal:true → 照旧走生成链路（门禁不误伤正常确认）', async () => {
    seedProposingConversation({
      confirmedProposal: {
        learning_direction: '从明细合并到汇总报告的自动化',
        first_deliverable: '一张能交付的周报',
        key_stages: ['字段对齐', '合并去重', '分组汇总'],
        out_of_scope: [],
      },
    });

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '就按这个来，确认',
      'user-1',
      { confirmProposal: true }
    );

    expect(mockClaimPathCoreGeneration).toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('completed');
    expect(result.internal.core.isCompleted).toBe(true);
  });
});
