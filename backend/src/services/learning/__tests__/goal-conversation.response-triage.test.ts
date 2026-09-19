/**
 * goal→path 链路上的响应分诊接线（增量、默认不改行为）：
 *  - collectedData.responseTriage 落库 + 透传进 GoalPathRequest；
 *  - advisory 默认：mode !== learning_path 时提议文本追加负向出口一行；
 *  - advisory 默认：仍照常推进路径生成（零行为变化）；
 *  - gated：非学习路径结论作为待确认项，不自动推进。
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
}) {
  return {
    userVisible: overrides.userVisible ?? '这一版方向先聚焦复盘结论提炼。',
    debug: { structuredOutputValid: true },
    internal: {
      core: { stage: overrides.stage ?? 'proposing', confidence: 0.8, isCompleted: false },
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

describe('responseTriage 落库与透传', () => {
  it('advisory 默认：非学习路径时提议文本含负向出口一行，并把 responseTriage 落库', async () => {
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '这一版方向先聚焦复盘结论提炼。',
      understanding: {
        real_problem: '怕被领导否定，一想到汇报就失眠',
        primaryBlockType: 'emotion_relationship',
        blockTypeEvidence: '一想到要当众汇报就失眠',
      },
      confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
    }));

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '我试试',
      'user-1'
    );

    // 负向出口可被断言
    expect(result.userVisible).toContain('系统判断');
    expect(result.userVisible).toContain('情绪');

    // collectedData.responseTriage 落库
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.responseTriage).toEqual(expect.objectContaining({ mode: 'emotional_support' }));
    // 不破坏既有键
    expect(persisted.messages).toBeDefined();
    expect(persisted.understanding.primaryBlockType).toBe('emotion_relationship');
  });

  it('能力缺口（capability）不追加负向出口（默认零变化）', async () => {
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '这一版方向先聚焦复盘结论提炼。',
      understanding: {
        real_problem: '不知道复盘要回答哪几个问题',
        primaryBlockType: 'capability',
        recurrence: 'recurring',
        blockTypeEvidence: '每次写复盘都写不出结论',
      },
      confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
    }));

    const result = await goalConversationService.continueConversation('conv-1', '好的', 'user-1');

    expect(result.userVisible).not.toContain('系统判断');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.responseTriage).toEqual(expect.objectContaining({ mode: 'learning_path' }));
  });
});

describe('advisory 默认仍推进路径生成（零行为变化）', () => {
  it('确认提议时照常调用 runGoalAsync，并把 responseTriage 透传进 GoalPathRequest', async () => {
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '不知道复盘要回答哪几个问题' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
        responseTriage: { mode: 'combination', confidence: 'medium', reasons: [] },
      }),
    });

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '就按这个来',
      'user-1',
      { confirmProposal: true }
    );

    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    const request = mockRunGoalAsync.mock.calls[0][0];
    expect(request.responseTriage).toEqual(expect.objectContaining({ mode: 'combination' }));
    expect(result.internal.core.stage).toBe('completed');
  });
});

describe('gated 模式：非学习路径不自动推进', () => {
  it('mode !== learning_path 时改为待确认项，不调用 runGoalAsync', async () => {
    mockPlatformSettingFindUnique.mockResolvedValue({ key: 'responseTriageMode', value: 'gated' });
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '没权限，走不通审批' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
        responseTriage: { mode: 'referral', confidence: 'medium', reasons: [] },
      }),
    });

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '就按这个来',
      'user-1',
      { confirmProposal: true }
    );

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
    expect(result.userVisible).toContain('系统判断');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.responseTriagePending).toEqual(expect.objectContaining({ mode: 'referral' }));
  });

  it('再次确认（已有待确认项）即放行，照常推进路径', async () => {
    mockPlatformSettingFindUnique.mockResolvedValue({ key: 'responseTriageMode', value: 'gated' });
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '没权限，走不通审批' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
        responseTriage: { mode: 'referral', confidence: 'medium', reasons: [] },
        responseTriagePending: { mode: 'referral', confidence: 'medium', reasons: [] },
      }),
    });

    await goalConversationService.continueConversation(
      'conv-1',
      '仍然生成',
      'user-1',
      { confirmProposal: true }
    );

    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
  });
});
