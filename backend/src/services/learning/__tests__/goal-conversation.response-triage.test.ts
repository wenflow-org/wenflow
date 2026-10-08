/**
 * goal→path 链路上的响应分诊接线（增量、默认不改行为）：
 *  - collectedData.responseTriage 落库 + 透传进 GoalPathRequest；
 *  - advisory 默认：分诊结论**只落库/遥测**，不写进面向用户的 reply（提示词明令 hidden 信号不宣布）；
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
  it('advisory 默认：非学习路径结论只落库/遥测，不写进用户可见文本', async () => {
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

    // hidden 信号不向用户宣布：reply 原样返回，平台不再替它附加「系统判断」行
    expect(result.userVisible).not.toContain('系统判断');
    expect(result.userVisible).toBe('这一版方向先聚焦复盘结论提炼。');

    // 但分诊结论照常落库（遥测/后续确认提议读取）
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

  it('提示词口径（snake_case）同样触发分诊与负向出口（锁定 prompt↔分诊契约）', async () => {
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '这一版方向先聚焦坡道起步。',
      understanding: {
        real_problem: '一上坡就熄火，不敢开了',
        primary_block_type: 'emotion_relationship',
        recurrence: 'recurring',
        block_type_evidence: '一想到上坡就手心出汗，怕再熄火',
      },
      confirmedProposal: { learning_direction: '坡道起步', key_stages: ['S1'] },
    }));

    const result = await goalConversationService.continueConversation('conv-1', '我试试', 'user-1');

    expect(result.userVisible).not.toContain('系统判断');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.responseTriage).toEqual(expect.objectContaining({ mode: 'emotional_support' }));
    expect(persisted.understanding.primary_block_type).toBe('emotion_relationship');
  });

  it('第二轴：capability + support_need=emotional → combination（有真实可学缺口也出负向出口）', async () => {
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '这一版方向先聚焦对焦与光线。',
      understanding: {
        real_problem: '拍孙子时只会直接按大圆钮、不知先点脸对焦，被孙子一句"这拍的啥呀"否定后不敢再拍',
        primary_block_type: 'capability',
        recurrence: 'recurring',
        block_type_evidence: '缺对焦概念与操作；被否定后信心受挫、怕再拍糊',
        support_need: 'emotional',
      },
      confirmedProposal: { learning_direction: '手机摄影基础操作', key_stages: ['S1'] },
    }));

    const result = await goalConversationService.continueConversation('conv-1', '我试试', 'user-1');

    expect(result.userVisible).not.toContain('系统判断');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.responseTriage).toEqual(expect.objectContaining({ mode: 'combination' }));
    // 真实可学缺口不被丢弃：仍照常推进路径生成
    expect(persisted.understanding.primary_block_type).toBe('capability');
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

describe('显式拒绝不得代签（2026-10-08 真人面守门，R6 P1-12 镜像）', () => {
  it('flag=true 但文本明示犹豫 → 不生成路径，走普通模型回合', async () => {
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

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '再想想吧',
      'user-1',
      { confirmProposal: true }
    );

    // C 轨探针 C 实锤过的路径：旧代码当轮生成路径；现在拒绝文本压过 flag
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
    // 同意计量落库（拍板 #2）：否决事件可查询（channel=flag-vetoed-by-text + refusalVetoed）
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation).toEqual(expect.objectContaining({
      channel: 'flag-vetoed-by-text',
      refusalVetoed: true,
      replyPreview: '再想想吧',
    }));
    expect(persisted.confirmationLog).toHaveLength(1);
  });

  it('C 轨探针原文「再让我考虑一下。今天先不生成。」→ 全段扫描命中否决（此前末段锚定被打穿）', async () => {
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

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '再让我考虑一下。今天先不生成。',
      'user-1',
      { confirmProposal: true }
    );

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.internal.core.stage).toBe('proposing');
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation.channel).toBe('flag-vetoed-by-text');
  });

  it('flag=true 且确认文本 → 照常生成（首选通道不受影响）+ 计量 channel=flag', async () => {
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '不知道复盘要回答哪几个问题' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
      }),
    });

    await goalConversationService.continueConversation(
      'conv-1',
      '就按这个来',
      'user-1',
      { confirmProposal: true }
    );

    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation).toEqual(expect.objectContaining({
      channel: 'flag',
      refusalVetoed: false,
    }));
  });

  it('自然语言确认（无 flag）→ 照常生成 + 计量 channel=text', async () => {
    seedConversation({
      stage: 'proposing',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '不知道复盘要回答哪几个问题' },
        confirmedProposal: { learning_direction: '复盘写作', key_stages: ['S1'] },
      }),
    });

    await goalConversationService.continueConversation('conv-1', '就按这个来，确认', 'user-1');

    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(conversationRecord.collectedData);
    expect(persisted.lastConfirmation).toEqual(expect.objectContaining({
      channel: 'text',
      refusalVetoed: false,
    }));
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

describe('executeSkill 会话 envelope（非流式路径 conversationId 双写）', () => {
  it('第三参 contextEnvelope 带 session.conversationId（缓存亲和/遥测口径统一）', async () => {
    seedConversation({
      stage: 'understanding',
      collectedData: JSON.stringify({
        messages: [],
        understanding: { real_problem: '想学吉他', primaryBlockType: 'capability', blockTypeEvidence: '不会' },
      }),
    });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '好的。',
      understanding: { real_problem: '想学吉他', primaryBlockType: 'capability', blockTypeEvidence: '不会' },
    }));

    await goalConversationService.continueConversation('conv-1', '继续', 'user-1');

    const call = mockExecuteSkill.mock.calls[mockExecuteSkill.mock.calls.length - 1];
    expect(call[2]?.contextEnvelope?.session).toEqual(expect.objectContaining({
      sessionId: 'conv-1',
      conversationId: 'conv-1',
    }));
  });
});
