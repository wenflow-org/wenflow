/**
 * goal 打字确认裁决（2026-11-08 确认动作减重）：
 * 六通道合并为两通道后的服务层行为——
 *  - UI 按钮 flag（confirmProposal:true）= 最强信号，直接推进，不再做文本否决、不再调裁决；
 *  - 打字 = proposing 阶段先过 goal-confirm-adjudicator 一次语义裁决：
 *      confirm=true → 直接推进（**不跑主对话回合**，executeSkill 零调用）；
 *      confirm=false → 落库走正常回合，由模型接住（调整/拒绝/提问）；
 *      裁决失败 → fail-open 按非确认（走正常回合）+ P3 降级留痕。
 *  - 旧的文本白名单快路径、confirmIntent hidden 布尔、拒绝否决正则全部退役（confirm-text.ts 已删）。
 */
const mockExecuteSkill = jest.fn();
const mockRunGoalAsync = jest.fn();
const mockGenerateFromGoal = jest.fn();
const mockClaimPathCoreGeneration = jest.fn();
const mockMarkActiveGenerationFailed = jest.fn();
const mockAssembleGoalHandoff = jest.fn();
const mockPlatformSettingFindUnique = jest.fn();
const mockCallPrompt = jest.fn();
const mockRecordDegradation = jest.fn();

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
// 不 mock goal-confirm-adjudicator 模块本身——mock 它的 callPrompt 依赖，
// 让「裁决失败 → 内部 catch → recordDegradation → fail-open」整条链真实走一遍。
jest.mock('../../../composers/prompt-composer', () => ({
  ...jest.requireActual('../../../composers/prompt-composer'),
  callPrompt: (...args: any[]) => mockCallPrompt(...args),
}));
jest.mock('../../../skills/degradation-telemetry', () => ({
  __esModule: true,
  recordDegradation: (...args: any[]) => mockRecordDegradation(...args),
  degradationCause: (e: unknown) => (e instanceof Error ? e.message : String(e)),
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
      core: {
        stage: overrides.stage ?? 'proposing',
        confidence: 0.8,
        isCompleted: false,
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
      messages: [{ role: 'ai', content: '这版方向先聚焦复盘结论提炼，你看哪块要调？' }],
      understanding: { real_problem: '不知道复盘要回答哪几个问题' },
      stage: 'proposing',
      confirmedProposal: { learning_direction: '复盘写作', first_deliverable: '一份能直接用的月度复盘提纲', key_stages: ['S1 复盘框架', 'S2 结论提炼'] },
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  seedProposingConversation();
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null); // 无记录 → 默认 advisory
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
});

describe('打字确认裁决（goal-confirm-adjudicator）', () => {
  it('a) 裁决 confirm=true → 直接推进，不跑主对话回合（executeSkill 零调用）', async () => {
    mockCallPrompt.mockResolvedValue({ success: true, output: { confirm: true } });

    const result = await goalConversationService.continueConversation('conv-1', '行，就照你说的办', 'user-1');

    // 关键：裁决命中即推进——主对话回合（executeSkill）一次都不跑，比旧 confirmIntent 通道快一个回合
    expect(mockCallPrompt).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    expect(result.internal.core.stage).toBe('completed');
    // 同意计量：打字确认通道 = text
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation).toEqual(expect.objectContaining({
      channel: 'text',
      refusalVetoed: false,
    }));
  });

  it('b) 裁决 confirm=false（调整/拒绝/提问）→ 落库走正常回合，由模型接住', async () => {
    mockCallPrompt.mockResolvedValue({ success: true, output: { confirm: false } });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '好，我们不着急，你想先调整哪部分？',
      stage: 'proposing',
    }));

    const result = await goalConversationService.continueConversation('conv-1', '先别，我再想想', 'user-1');

    expect(mockCallPrompt).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
    // 用户与 AI 消息都落库（普通回合链路）
    const persisted = JSON.parse(conversationRecord.collectedData);
    const roles = persisted.messages.map((m: any) => m.role);
    expect(roles).toEqual(expect.arrayContaining(['user', 'ai']));
  });

  it('c) 裁决失败 → fail-open 按非确认（走正常回合）+ P3 降级留痕，不阻塞对话', async () => {
    mockCallPrompt.mockRejectedValue(new Error('GOAL_CONFIRM_ADJUDICATOR_TIMEOUT'));
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '收到，这版方向你可以先看看，想调随时说。',
      stage: 'proposing',
    }));

    const result = await goalConversationService.continueConversation('conv-1', '随便说点什么', 'user-1');

    expect(mockRecordDegradation).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
  });

  it('d-2) #162 提案内容门禁：提案不完整（缺 first_deliverable/stages<2）→ flag 也不代签，走正常回合补提案', async () => {
    seedProposingConversation();
    conversationRecord.collectedData = JSON.stringify({
      messages: [{ role: 'ai', content: '这版方向先聚焦复盘结论提炼，你看哪块要调？' }],
      understanding: { real_problem: '不知道复盘要回答哪几个问题' },
      stage: 'proposing',
      confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
    });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '先把提案补完整：每次复盘先回答哪三个问题？',
      stage: 'proposing',
    }));

    const result = await goalConversationService.continueConversation('conv-1', '确认并生成路径', 'user-1', { confirmProposal: true });

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(result.internal.core.stage).toBe('proposing');
  });

  it('d) UI 按钮 flag → 直接推进，不调裁决（按钮是最强信号，不再做文本否决）', async () => {
    const result = await goalConversationService.continueConversation('conv-1', '确认并生成路径', 'user-1', { confirmProposal: true });

    expect(mockCallPrompt).not.toHaveBeenCalled();
    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    expect(result.internal.core.stage).toBe('completed');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation).toEqual(expect.objectContaining({
      channel: 'flag',
      refusalVetoed: false,
    }));
  });
});
