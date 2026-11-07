/**
 * 模型结构化确认意图（confirmIntent）驱动推进（2026-11-07 切片「自然语言确认改由模型判意图」）：
 *  - 快路径（UI confirmProposal 标志 / isProposalConfirmationText 文本白名单）未命中、但本轮模型
 *    结构化输出 confirmIntent===true 且文本非显式拒绝时，走与快路径同一个 advanceConfirmedProposal
 *    推进方法（不复制逻辑、不二次调用模型）。
 *  - confirmIntent 看语义不看字面：覆盖「行，就照你说的办」这类不出现「确认/按这个来」字样的确认；
 *    但本测试用「快路径白名单之外、语义仍是确认」的短语（如「我听你的安排」）来隔离验证模型信号通道，
 *    因为白名单已覆盖的短语会走快路径、不再触发本轮模型回合的 confirmIntent 分支。
 *  - confirmIntent===true 但文本明示拒绝/犹豫 → 不推进（isExplicitRefusalText 守门）。
 *  - 既有 isProposalConfirmationText / isExplicitRefusalText 用例（goal-conversation.confirm-text.test.ts）
 *    与此处互不干扰，白名单一个字不少。
 */
const mockExecuteSkill = jest.fn();
const mockRunGoalAsync = jest.fn();
const mockGenerateFromGoal = jest.fn();
const mockClaimPathCoreGeneration = jest.fn();
const mockMarkActiveGenerationFailed = jest.fn();
const mockAssembleGoalHandoff = jest.fn();
const mockPlatformSettingFindUnique = jest.fn();

// 会话状态（整包读改写模拟）
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

function buildAiResponse(overrides: {
  userVisible?: string;
  understanding?: Record<string, unknown>;
  confirmedProposal?: any;
  stage?: string;
  /** 模型结构化确认意图（hidden 布尔，可缺省）；仅在显式 true 时驱动推进 */
  confirmIntent?: boolean;
}) {
  return {
    userVisible: overrides.userVisible ?? '这一版方向先聚焦复盘结论提炼。',
    debug: { structuredOutputValid: true },
    internal: {
      core: {
        stage: overrides.stage ?? 'proposing',
        confidence: 0.8,
        isCompleted: false,
        ...(typeof overrides.confirmIntent === 'boolean' ? { confirmIntent: overrides.confirmIntent } : {}),
      },
      ext: {
        goalConversation: {
          understanding: overrides.understanding ?? {},
          nextQuestions: [],
          quickReplies: [],
          collected: {},
          confirmedProposal: overrides.confirmedProposal ?? null,
        },
      },
    },
    runtimeEnvelope: null,
  };
}

function seedConversation(overrides: Record<string, unknown> = {}) {
  conversationRecord = {
    id: 'conv-1',
    userId: 'user-1',
    description: '月度复盘写不好',
    stage: 'understanding',
    status: 'active',
    revision: 1,
    learningPathId: null,
    collectedData: JSON.stringify({
      messages: [{ role: 'user', content: '月度复盘写不好' }],
      understanding: { real_problem: '写不出结论' },
      stage: 'understanding',
    }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  seedConversation();
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null); // 无记录 → 默认 advisory
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
});

describe('模型 confirmIntent 驱动推进（快路径未命中时）', () => {
  it('a) 快路径未命中 + 模型 confirmIntent=true → 推进路径生成（与快路径同方法、不二次调模型）', async () => {
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '不知道复盘要回答哪几个问题' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
      }),
    });
    // 文本「我听你的安排」语义是确认，但不在 isProposalConfirmationText 白名单 → 快路径不命中；
    // 模型结构化输出 confirmIntent=true 触发推进。
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '好的，那我就按这版方向开始排路径了。',
      stage: 'proposing',
      confirmIntent: true,
      understanding: { real_problem: '不知道复盘要回答哪几个问题' },
      confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
    }));

    const result = await goalConversationService.continueConversation('conv-1', '我听你的安排', 'user-1');

    // 关键：仅一次模型调用（continueConversation 内唯一 callAI），推进与快路径共用 advanceConfirmedProposal
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    expect(result.internal.core.stage).toBe('completed');
    // 同意计量落地（自然语言确认通道 = text）
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation).toEqual(expect.objectContaining({
      channel: 'text',
      refusalVetoed: false,
    }));
  });

  it('a-对照) 同句但模型 confirmIntent 缺省 → 不推进，停留在 proposing', async () => {
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '不知道复盘要回答哪几个问题' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
      }),
    });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '这版方向你还有想调的地方吗？',
      stage: 'proposing',
      // 不输出 confirmIntent（缺省）
      understanding: { real_problem: '不知道复盘要回答哪几个问题' },
      confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
    }));

    const result = await goalConversationService.continueConversation('conv-1', '我听你的安排', 'user-1');

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
  });

  it('b) confirmIntent=true 但文本明示拒绝/犹豫 → 不推进（isExplicitRefusalText 守门）', async () => {
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '不知道复盘要回答哪几个问题' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
      }),
    });
    // 模型虽输出 confirmIntent=true，但用户本轮文本是明确犹豫（「先别，我再想想」），
    // 文本否决压过模型信号，不生成路径。
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '好，我们不着急，你想先调整哪部分？',
      stage: 'proposing',
      confirmIntent: true,
      understanding: { real_problem: '不知道复盘要回答哪几个问题' },
      confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
    }));

    const result = await goalConversationService.continueConversation('conv-1', '先别，我再想想', 'user-1');

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
  });

  it('b-对照) 文本拒绝 + flag=true（既有守门回归，不受影响）', async () => {
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '不知道复盘要回答哪几个问题' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
      }),
    });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '好，我们不着急，你想先调整哪部分？',
      stage: 'proposing',
    }));

    const result = await goalConversationService.continueConversation('conv-1', '再想想吧', 'user-1', { confirmProposal: true });

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation.channel).toBe('flag-vetoed-by-text');
  });
});
