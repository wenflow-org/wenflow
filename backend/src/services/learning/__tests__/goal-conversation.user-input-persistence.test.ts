/**
 * #160 回归：非结构化失败（LLM/网关/网络抖动）不得丢掉用户这一轮输入。
 *
 * 现象：旧实现只在 422（结构化失败）与成功两支写用户消息，callAI 因网关/网络抛错时
 * 用户这一轮回复在库与模型上下文里都不存在（刷新即消失），且前端「重试」会重复写入。
 * 修复：用户消息在 callAI 之前落库（落库/调用解耦），callAI 侧剔除历史末尾同内容用户消息
 * 避免重复喂入；saveMessage 的 trailing-duplicate 护栏让失败重试幂等。
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
/** true 时让 updateCollectedData（携带 stage 的提交写）连续 revision 失配 → 3 次后抛出 */
let failCollectedDataCommit = false;
const mockGoalUpdateMany = jest.fn(async ({ data }: any) => {
  if (failCollectedDataCommit && data?.stage !== undefined) return { count: 0 };
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

const USER_REPLY = '我想学会做手冲咖啡';

function buildValidResponse() {
  return {
    userVisible: '收到，我先记下这个目标。',
    debug: { structuredOutputValid: true },
    internal: {
      core: { stage: 'understanding', confidence: 0.8, isCompleted: false },
      ext: {
        goalConversation: {
          understanding: { real_problem: '想学会手冲' },
          nextQuestions: [],
          quickReplies: [],
          collected: {},
        },
      },
    },
    runtimeEnvelope: null,
  };
}

function persistedMessages(): Array<{ role: string; content: string }> {
  return (JSON.parse(conversationRecord.collectedData) as { messages: any[] }).messages;
}

function seedConversation() {
  conversationRecord = {
    id: 'conv-1',
    userId: 'user-1',
    description: '随便聊聊',
    stage: 'understanding',
    status: 'active',
    revision: 1,
    learningPathId: null,
    collectedData: JSON.stringify({
      messages: [
        { role: 'user', content: '之前说过的一句话' },
        { role: 'ai', content: '好的，我记下了' },
      ],
      understanding: {},
      stage: 'understanding',
      confidence: 0,
      collected: {},
    }),
    messages: '[]',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  seedConversation();
  failCollectedDataCommit = false;
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null);
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
});

describe('#160 非结构化失败不丢用户输入', () => {
  it('callAI 抛错（网关/网络抖动）：用户消息仍落库', async () => {
    mockExecuteSkill.mockRejectedValue(new Error('upstream gateway 502'));

    await expect(
      goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1')
    ).rejects.toThrow('upstream gateway 502');

    const messages = persistedMessages();
    expect(messages[messages.length - 1]).toEqual(expect.objectContaining({
      role: 'user',
      content: USER_REPLY,
    }));
    // 模型回合未产出 → 不落 AI 回复
    expect(messages.some((m) => m.role === 'ai' && m.content.includes('收到'))).toBe(false);
  });

  it('失败后重试同一条输入：库里不产生重复用户消息', async () => {
    mockExecuteSkill.mockRejectedValue(new Error('upstream gateway 502'));

    await expect(
      goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1')
    ).rejects.toThrow();
    await expect(
      goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1')
    ).rejects.toThrow();

    const copies = persistedMessages().filter(
      (m) => m.role === 'user' && m.content === USER_REPLY
    );
    expect(copies).toHaveLength(1);
  });

  it('本轮输入不重复喂入上下文：传给模型的 history 末尾不含刚落库的这条用户消息', async () => {
    mockExecuteSkill.mockRejectedValue(new Error('upstream gateway 502'));

    await expect(
      goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1')
    ).rejects.toThrow();

    const skillInput = mockExecuteSkill.mock.calls[0][1] as {
      input: string;
      conversationHistory: Array<{ role: string; content: string }>;
    };
    expect(skillInput.input).toBe(USER_REPLY);
    const history = skillInput.conversationHistory;
    expect(history[history.length - 1]).toEqual(
      expect.objectContaining({ role: 'assistant', content: '好的，我记下了' })
    );
    expect(history.some((m) => m.content === USER_REPLY)).toBe(false);
  });

  it('失败后重试成功：用户消息只留一条，且顺序为 用户 → 模型回复', async () => {
    mockExecuteSkill
      .mockRejectedValueOnce(new Error('upstream gateway 502'))
      .mockResolvedValueOnce(buildValidResponse());

    await expect(
      goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1')
    ).rejects.toThrow();

    await goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1');

    const messages = persistedMessages();
    expect(messages.filter((m) => m.role === 'user' && m.content === USER_REPLY)).toHaveLength(1);
    expect(messages[messages.length - 2]).toEqual(expect.objectContaining({
      role: 'user',
      content: USER_REPLY,
    }));
    expect(messages[messages.length - 1]).toEqual(expect.objectContaining({
      role: 'ai',
      content: '收到，我先记下这个目标。',
    }));
  });

  it('结构化失败（422）仍只落一条用户消息（原有兜底不回归）', async () => {
    mockExecuteSkill.mockResolvedValue({
      ...buildValidResponse(),
      debug: { structuredOutputValid: false },
    });

    await expect(
      goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1')
    ).rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_INVALID' });

    const messages = persistedMessages();
    expect(messages.filter((m) => m.role === 'user' && m.content === USER_REPLY)).toHaveLength(1);
  });

  it('AI 回合已落库后 updateCollectedData 三次冲突：重试不产生第二条同文用户消息', async () => {
    mockExecuteSkill.mockResolvedValue(buildValidResponse());
    // 用户消息与 AI 回复都写成功（独立 updateMany 提交），只有回合提交（collectedData）失配 3 次后抛出
    failCollectedDataCommit = true;

    await expect(
      goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1')
    ).rejects.toThrow('GOAL_REVISION_CONFLICT');

    // 失败时库里确实留下了 [用户, AI]（本用例的前置：护栏不能只看数组最后一条）
    const afterFailure = persistedMessages();
    expect(afterFailure.filter((m) => m.role === 'user' && m.content === USER_REPLY)).toHaveLength(1);
    expect(afterFailure[afterFailure.length - 1].role).toBe('ai');

    // 前端「重试」重发同一句
    failCollectedDataCommit = false;
    await goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1');

    const messages = persistedMessages();
    expect(messages.filter((m) => m.role === 'user' && m.content === USER_REPLY)).toHaveLength(1);
    // 上一回合未交付的 AI 回复被同一回合的重试取代，不叠加：整段历史长度仍为 4
    expect(messages.map((m) => m.role)).toEqual(['user', 'ai', 'user', 'ai']);
    expect(messages[3]).toEqual(expect.objectContaining({
      role: 'ai',
      content: '收到，我先记下这个目标。',
    }));
  });

  it('用户合法地再次发送同一句话（上一回合已提交）：照常落库，不被幂等护栏吞掉', async () => {
    mockExecuteSkill.mockResolvedValue(buildValidResponse());

    await goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1');
    await goalConversationService.continueConversation('conv-1', USER_REPLY, 'user-1');

    const messages = persistedMessages();
    expect(messages.filter((m) => m.role === 'user' && m.content === USER_REPLY)).toHaveLength(2);
    expect(messages.map((m) => m.role)).toEqual(['user', 'ai', 'user', 'ai', 'user', 'ai']);
  });
});

describe('#160 同一根因的 startConversation 实例', () => {
  function seedEmptyActiveConversation() {
    conversationRecord = {
      id: 'conv-1',
      userId: 'user-1',
      description: USER_REPLY,
      stage: 'understanding',
      status: 'active',
      revision: 1,
      learningPathId: null,
      collectedData: JSON.stringify({
        messages: [],
        understanding: {},
        stage: 'understanding',
        confidence: 0,
        collected: {},
      }),
      messages: '[]',
    };
  }

  it('callAI 抛错：首轮目标仍落库（复用未完成会话）', async () => {
    seedEmptyActiveConversation();
    mockExecuteSkill.mockRejectedValue(new Error('upstream gateway 502'));

    await expect(
      goalConversationService.startConversation('user-1', USER_REPLY)
    ).rejects.toThrow('upstream gateway 502');

    const messages = persistedMessages();
    expect(messages[messages.length - 1]).toEqual(expect.objectContaining({
      role: 'user',
      content: USER_REPLY,
    }));
  });

  it('失败后重试：首轮目标不重复落库', async () => {
    seedEmptyActiveConversation();
    mockExecuteSkill
      .mockRejectedValueOnce(new Error('upstream gateway 502'))
      .mockResolvedValueOnce(buildValidResponse());

    await expect(
      goalConversationService.startConversation('user-1', USER_REPLY)
    ).rejects.toThrow();

    await goalConversationService.startConversation('user-1', USER_REPLY);

    const messages = persistedMessages();
    expect(messages.filter((m) => m.role === 'user' && m.content === USER_REPLY)).toHaveLength(1);
    expect(messages[messages.length - 1].role).toBe('ai');
  });
});
