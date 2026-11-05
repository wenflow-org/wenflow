/**
 * #159 回归：模型某轮未复述 confirmedProposal 时，响应不得丢掉已持久化的提案。
 *
 * 现象：落库侧 updateCollectedData 是「字段缺席保留旧值」，而响应侧此前只取本轮模型输出。
 * 模型在 proposing 阶段只回澄清/答探测题、没再复述 confirmedProposal 时，响应里该字段为空，
 * 前端据此清空 → 提案卡与确认入口消失。修复后响应用持久化快照补齐（仅字段缺席时）。
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

const PERSISTED_PROPOSAL = {
  learning_direction: '复盘写作',
  first_deliverable: '一份能提交的月度复盘',
  key_stages: ['结论先行', '证据支撑'],
  out_of_scope: ['排版美化'],
};

/**
 * 本轮模型只回澄清、未复述 confirmedProposal（键缺席=undefined，模拟 skill delta 缺席语义）。
 * structuredData / confidenceScores 同样缺席。
 */
function buildResponseWithoutProposal() {
  return {
    userVisible: '再确认一下：你每周大概能投入几小时？',
    debug: { structuredOutputValid: true },
    internal: {
      core: { stage: 'proposing', confidence: 0.8, isCompleted: false },
      ext: {
        goalConversation: {
          understanding: { real_problem: '月度复盘写不好' },
          nextQuestions: ['每周能投入几小时？'],
          quickReplies: [],
          collected: {},
        },
      },
    },
    runtimeEnvelope: null,
  };
}

function seedProposingConversation() {
  conversationRecord = {
    id: 'conv-1',
    userId: 'user-1',
    description: '月度复盘写不好',
    stage: 'proposing',
    status: 'active',
    revision: 1,
    learningPathId: null,
    collectedData: JSON.stringify({
      messages: [{ role: 'user', content: '月度复盘写不好' }],
      understanding: { real_problem: '月度复盘写不好' },
      stage: 'proposing',
      confirmedProposal: PERSISTED_PROPOSAL,
      structuredData: { learner: { identity: '职场人' } },
      confidenceScores: { overall: 0.7 },
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  seedProposingConversation();
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null);
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
});

describe('#159 响应回填已持久化的 confirmedProposal', () => {
  it('上一轮有提案、本轮模型不复述：响应里 confirmedProposal 非空（修复前为空）', async () => {
    mockExecuteSkill.mockResolvedValue(buildResponseWithoutProposal());

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '这个阶段为什么要学语法？',
      'user-1'
    );

    const ext = result.internal.ext.goalConversation;
    expect(ext.confirmedProposal).toBeTruthy();
    expect(ext.confirmedProposal).toEqual(expect.objectContaining({
      learning_direction: '复盘写作',
      key_stages: ['结论先行', '证据支撑'],
    }));
    // 同类持久化字段一并回填（同一缺失机制）
    expect(ext.structuredData).toEqual(expect.objectContaining({ learner: { identity: '职场人' } }));
    expect(ext.confidenceScores).toEqual(expect.objectContaining({ overall: 0.7 }));
  });

  it('模型本轮明确给出新提案：以本轮为准，不被持久化旧值覆盖', async () => {
    const fresh = {
      learning_direction: '复盘写作（新版）',
      first_deliverable: '新版手册',
      key_stages: ['A', 'B'],
      out_of_scope: [],
    };
    mockExecuteSkill.mockResolvedValue({
      ...buildResponseWithoutProposal(),
      internal: {
        core: { stage: 'proposing', confidence: 0.85, isCompleted: false },
        ext: {
          goalConversation: {
            understanding: { real_problem: '月度复盘写不好' },
            nextQuestions: [],
            quickReplies: [],
            collected: {},
            confirmedProposal: fresh,
          },
        },
      },
    });

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '这个阶段为什么要学语法？',
      'user-1'
    );

    const ext = result.internal.ext.goalConversation;
    expect(ext.confirmedProposal.learning_direction).toBe('复盘写作（新版）');
  });
});
