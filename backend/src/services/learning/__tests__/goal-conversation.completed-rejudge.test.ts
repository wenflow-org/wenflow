/**
 * completed 硬阻断会话的补充说明重判（2026-10-29 H-1/H-2、M-10/M-11 修复回归）：
 *  - 硬阻断终局（存档 triage referral × not_judgeable/physical_internalized）的 completed 会话，
 *    /reply 的补充说明不再 0 秒重放旧文案，而是追加进对话并重新分诊；
 *  - 重判通过 → 复用确认链路生成路径并回写 learningPathId，同一会话不重复建路；
 *  - 重判仍拦 → 返回更新后的拒绝文案（不再承诺式的旧话术）；
 *  - 非硬阻断终局的普通 completed 会话行为保持不变（不回归）。
 */
const mockExecuteSkill = jest.fn();
const mockRunGoalAsync = jest.fn();
const mockClaimPathCoreGeneration = jest.fn();
const mockMarkActiveGenerationFailed = jest.fn();
const mockAssembleGoalHandoff = jest.fn();
const mockPlatformSettingFindUnique = jest.fn();

/** goal_conversations 行的最小形状（模拟整包读改写） */
interface ConversationRow {
  id: string;
  userId: string;
  description: string;
  stage: string;
  status: string;
  revision: number;
  learningPathId: string | null;
  collectedData: string;
  messages: string;
  completedAt?: Date | null;
}

/** learning_paths 行的最小形状（验证「同一会话只允许一条活路径」；#228 用例额外带 lifecycle 推导字段） */
interface PathRow {
  id: string;
  status: string;
  userId?: string;
  aiGenerated?: boolean;
  aiPromptTemplate?: string | null;
  updatedAt?: Date;
  activeGenerationRun?: Record<string, unknown> | null;
  milestones?: Array<{ stageNumber: number; subtasks: Array<{ id: string }> }>;
}

let conversationRecord: ConversationRow;
const pathStore = new Map<string, PathRow>();

type RowPatch = {
  collectedData?: unknown;
  messages?: unknown;
  learningPathId?: unknown;
  status?: unknown;
  stage?: unknown;
  completedAt?: unknown;
  revision?: unknown;
};

function applyRowUpdate(data: RowPatch | undefined) {
  if (!data) return;
  if (data.collectedData !== undefined) conversationRecord.collectedData = data.collectedData as string;
  if (data.messages !== undefined) conversationRecord.messages = data.messages as string;
  if (data.learningPathId !== undefined) conversationRecord.learningPathId = data.learningPathId as string | null;
  if (data.status !== undefined) conversationRecord.status = data.status as string;
  if (data.stage !== undefined) conversationRecord.stage = data.stage as string;
  if (data.completedAt !== undefined) conversationRecord.completedAt = data.completedAt as Date;
  if (data.revision && typeof data.revision === 'object') conversationRecord.revision += 1;
}

const mockGoalUpdate = jest.fn(async ({ data }: { data: RowPatch }) => {
  applyRowUpdate(data);
  return conversationRecord;
});
const mockGoalUpdateMany = jest.fn(async ({ data }: { data: RowPatch }) => {
  applyRowUpdate(data);
  return { count: 1 };
});
const mockGoalFindUnique = jest.fn(async () => conversationRecord);
const mockGoalFindFirst = jest.fn(async () => conversationRecord);

const goalTxView = {
  goal_conversations: {
    findUnique: async () => conversationRecord,
    update: mockGoalUpdate,
    updateMany: mockGoalUpdateMany,
  },
};

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: async (cb: (tx: typeof goalTxView) => unknown) => cb(goalTxView),
    goal_conversations: {
      findFirst: mockGoalFindFirst,
      findUnique: mockGoalFindUnique,
      update: mockGoalUpdate,
      updateMany: mockGoalUpdateMany,
    },
    learning_paths: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string } }) =>
        pathStore.get(where?.id ?? '') || null),
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        pathStore.get(where?.id ?? '') || null),
      create: jest.fn(async ({ data }: { data: { id: string; status?: string } }) => {
        const row: PathRow = { id: data.id, status: data.status || 'generating' };
        pathStore.set(data.id, row);
        return row;
      }),
    },
  },
}));

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_settings: {
      findUnique: (...args: unknown[]) => mockPlatformSettingFindUnique(...args),
    },
  },
}));

jest.mock('../../../skills', () => ({
  __esModule: true,
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
}));
jest.mock('../../../skills/goal-conversation', () => ({
  __esModule: true,
  goalConversationAgentDefinition: { id: 'goal-conversation' },
}));
jest.mock('../../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: {
    runGoalAsync: (...args: unknown[]) => mockRunGoalAsync(...args),
    generateFromGoal: jest.fn(),
  },
}));
jest.mock('../../field-dispatcher', () => ({
  __esModule: true,
  assembleGoalHandoff: (...args: unknown[]) => mockAssembleGoalHandoff(...args),
}));
jest.mock('../../learning/goal-path-visible-summary', () => ({
  __esModule: true,
  buildGoalPathVisibleSummary: jest.fn(() => ({})),
}));
jest.mock('../../learning/learning.service', () => ({
  __esModule: true,
  default: {
    claimPathCoreGeneration: (...args: unknown[]) => mockClaimPathCoreGeneration(...args),
    markActiveGenerationFailed: (...args: unknown[]) => mockMarkActiveGenerationFailed(...args),
  },
}));
jest.mock('../../sandbox-resolver.service', () => ({
  __esModule: true,
  checkAgentSandboxRefsFromContext: jest.fn(async () => undefined),
}));
jest.mock('../../../events/contracts', () => ({
  __esModule: true,
  createDomainEvent: jest.fn((input: unknown) => input),
}));
jest.mock('../../../events/outbox.repository', () => ({
  __esModule: true,
  enqueueDomainEvent: jest.fn(async () => undefined),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import goalConversationService from '../goal-conversation.service';
import prisma from '../../../config/database';

/** 供断言用的 prisma mock 引用（learning_paths.create 由 jest.mock 工厂注入） */
const prismaMock = prisma as unknown as { learning_paths: { create: jest.Mock } };

/** 硬阻断终局的存档状态（模拟 confirmProposal 分支硬阻断落库后的 collectedData） */
const BLOCKED_UNDERSTANDING = {
  surface_goal: '学会手冲咖啡',
  real_problem: '冲出来的咖啡喝不出风味层次',
  platform_judgment: 'not_judgeable',
  skill_nature: 'physical_internalized',
};

const BLOCKED_TRIAGE = {
  mode: 'referral',
  confidence: 'high',
  reasons: ['平台不可判定（not_judgeable）× 纯感官/肢体内化技能：转线下真人指导，不建学习路径'],
};

/** 重判通过时模型给出的新 understanding（用户把目标改成了可判定的知识本身） */
const REJUDGED_UNDERSTANDING = {
  surface_goal: '学会手冲咖啡的冲煮方法',
  real_problem: '想系统学注水手法、粉水比与萃取判断这些知识',
  platform_judgment: 'judgeable_output',
  skill_nature: 'knowledge_structure',
  primary_block_type: 'capability',
  recurrence: 'recurring',
  block_type_evidence: '想掌握注水手法与粉水比的可验证方法',
};

interface GoalCore {
  stage?: string;
  confidence?: number;
  isCompleted?: boolean;
  learningPath?: { id: string; status: string } | null;
}

interface GoalEnvelope {
  core: GoalCore;
  ext?: { goalConversation?: { understanding?: Record<string, unknown>; responseTriage?: { mode: string }; [key: string]: unknown } };
}

function buildAiResponse(overrides: { userVisible?: string; understanding?: Record<string, unknown>; stage?: string }) {
  return {
    userVisible: overrides.userVisible ?? '好的，我重新理解一下你的目标。',
    debug: { structuredOutputValid: true },
    internal: {
      core: { stage: overrides.stage ?? 'understanding', confidence: 0.85, isCompleted: false },
      ext: {
        goalConversation: {
          understanding: overrides.understanding ?? BLOCKED_UNDERSTANDING,
          nextQuestions: [],
          quickReplies: [],
          collected: {},
        },
      },
    },
    runtimeEnvelope: null,
  };
}

/** 一份内容完备、可被 hasConfirmableProposal 放行的提案（重判通过后要生成路径的前提） */
const CONFIRMABLE_PROPOSAL = {
  learning_direction: '先掌握注水手法与粉水比，再练萃取判断',
  first_deliverable: '一杯按参数冲出的手冲咖啡与记录',
  key_stages: ['器具与参数认知', '注水手法练习', '萃取判断复盘'],
  out_of_scope: [],
};

function seedBlockedCompletedConversation(overrides: { confirmedProposal?: unknown } = {}) {
  conversationRecord = {
    id: 'conv-1',
    userId: 'user-1',
    description: '学会手冲咖啡',
    stage: 'completed',
    status: 'completed',
    revision: 10,
    learningPathId: null,
    collectedData: JSON.stringify({
      messages: [
        { role: 'user', content: '学会手冲咖啡' },
        { role: 'user', content: '就按这个方案来' },
      ],
      understanding: BLOCKED_UNDERSTANDING,
      stage: 'completed',
      confidence: 0.82,
      collected: {},
      responseTriage: BLOCKED_TRIAGE,
      ...(overrides.confirmedProposal !== undefined ? { confirmedProposal: overrides.confirmedProposal } : {}),
    }),
    messages: '[]',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  pathStore.clear();
  seedBlockedCompletedConversation();
  mockAssembleGoalHandoff.mockResolvedValue(null);
  mockPlatformSettingFindUnique.mockResolvedValue(null); // 无记录 → 默认 advisory
  mockClaimPathCoreGeneration.mockResolvedValue('run-1');
  mockMarkActiveGenerationFailed.mockResolvedValue(undefined);
});

describe('completed 硬阻断会话：补充说明重判通过', () => {
  it('追加新消息进对话并重新分诊，通过后按确认链路生成路径并回写 learningPathId', async () => {
    // #162：重判通过只是撤掉分诊闸门，生成路径还要求会话里有一份可确认的提案。
    // 这里先备上完整提案——若缺了它，下面「通过后生成」的断言就会落到「回到 proposing」上。
    seedBlockedCompletedConversation({ confirmedProposal: CONFIRMABLE_PROPOSAL });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '明白，你想学的是可判定的冲煮知识本身。',
      understanding: REJUDGED_UNDERSTANDING,
    }));

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '其实我想学的是注水手法和粉水比这些知识本身',
      'user-1'
    );

    // 新消息真的被读取（模型重判回合发生），不再是 0 秒短路
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);

    // 返回成功与新生成的路径（占位 generating 态）
    expect(result.userVisible).toContain('正在生成');
    const internal = result.internal as GoalEnvelope;
    expect(internal.core.stage).toBe('completed');
    expect(internal.core.learningPath).toEqual({ id: expect.any(String), status: 'generating' });

    // learningPathId 回写 + 状态语义干净（completed 会话保持终态语义并绑定路径）
    const pathId = internal.core.learningPath?.id as string;
    expect(conversationRecord.learningPathId).toBe(pathId);
    expect(conversationRecord.status).toBe('completed');
    expect(conversationRecord.stage).toBe('completed');

    // 补充说明在库有痕迹（M-10「零痕迹」修复）：用户消息 + 模型回合都落库
    const persisted = JSON.parse(conversationRecord.collectedData) as {
      messages: Array<{ role: string; content: string }>;
      responseTriage: { mode: string };
    };
    const lastUser = persisted.messages[persisted.messages.length - 2];
    expect(lastUser).toEqual(expect.objectContaining({ role: 'user', content: '其实我想学的是注水手法和粉水比这些知识本身' }));
    expect(persisted.messages[persisted.messages.length - 1].role).toBe('ai');

    // 分诊按新 understanding 重算落库，并透传进路径生成请求
    expect(persisted.responseTriage).toEqual(expect.objectContaining({ mode: 'learning_path' }));
    const request = mockRunGoalAsync.mock.calls[0][0] as { responseTriage: { mode: string }; sourceConversationId: string };
    expect(request.responseTriage).toEqual(expect.objectContaining({ mode: 'learning_path' }));
    expect(request.sourceConversationId).toBe('conv-1');
  });

  it('重复补充说明不重复建路：已绑路径后返回已有路径（同一会话只允许一条活路径）', async () => {
    // 首次补充说明要能生成路径，同样需要完整提案（#162 后置门禁）
    seedBlockedCompletedConversation({ confirmedProposal: CONFIRMABLE_PROPOSAL });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({ understanding: REJUDGED_UNDERSTANDING }));
    await goalConversationService.continueConversation('conv-1', '其实我想学的是知识本身', 'user-1');
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    const boundPathId = conversationRecord.learningPathId;
    expect(boundPathId).toBeTruthy();

    mockExecuteSkill.mockClear();
    mockRunGoalAsync.mockClear();
    prismaMock.learning_paths.create.mockClear();

    const second = await goalConversationService.continueConversation('conv-1', '再补充一点：每天能练半小时', 'user-1');

    // 不再触发重判（LLM）、不再新建/绑定路径
    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(prismaMock.learning_paths.create).not.toHaveBeenCalled();
    expect(conversationRecord.learningPathId).toBe(boundPathId);

    // 返回已有路径的完成文案（#228 语义订正：这条占位路径的权威 status 仍是 generating，
    // 旧断言写死「已经生成」正是在锁定「路径还在生成却宣称已生成」的缺陷行为）
    expect(second.userVisible).toBe(
      '已收到确认，学习路径正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。',
    );
    const internal = second.internal as GoalEnvelope;
    expect(internal.core.learningPath).toEqual(expect.objectContaining({ id: boundPathId }));
  });
});

describe('completed 硬阻断会话：重判通过但无可用提案（#162 另一条入口）', () => {
  it('confirmedProposal 为空 → 不生成路径，回到 proposing，模型本轮回复原样透出', async () => {
    // 默认种子没有 confirmedProposal：重判解除硬阻断后不得代签生成
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '我先按你说的方向整理出一版提案，你确认后我再生成学习路径。',
      understanding: REJUDGED_UNDERSTANDING,
    }));

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '其实我想学的是注水手法和粉水比这些知识本身',
      'user-1'
    );

    // 关键：生成链路一次都不能被触发（不产 learning_paths 行、不 claim run、不 bind 路径）
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(prismaMock.learning_paths.create).not.toHaveBeenCalled();
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(conversationRecord.learningPathId).toBeNull();

    // 回到 proposing：可继续推进（不是 completed 终局、也不是硬阻断）
    const internal = result.internal as GoalEnvelope;
    expect(internal.core.stage).toBe('proposing');
    expect(internal.core.isCompleted).toBe(false);
    expect(internal.core.learningPath).toBeNull();
    expect((internal.core as { hardBlocked?: boolean }).hardBlocked).toBe(false);
    expect(internal.ext?.goalConversation?.responseTriage).toEqual(expect.objectContaining({ mode: 'learning_path' }));

    // 模型这一轮的回复原样交给用户（让模型先补提案，用户再确认）
    expect(result.userVisible).toBe('我先按你说的方向整理出一版提案，你确认后我再生成学习路径。');

    // 落库侧同步回到可推进态，避免下一次 /reply 又按 completed 短路
    expect(conversationRecord.stage).toBe('proposing');
    expect(conversationRecord.status).toBe('active');
  });

  it('confirmedProposal 半截（只有方向与交付物、没有阶段）→ 同样不生成路径，回到 proposing', async () => {
    seedBlockedCompletedConversation({
      confirmedProposal: { learning_direction: '先练注水手法', first_deliverable: '一杯手冲咖啡', key_stages: [] },
    });
    mockExecuteSkill.mockResolvedValue(buildAiResponse({ understanding: REJUDGED_UNDERSTANDING }));

    const result = await goalConversationService.continueConversation('conv-1', '补充说明一下', 'user-1');

    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(prismaMock.learning_paths.create).not.toHaveBeenCalled();
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    const internal = result.internal as GoalEnvelope;
    expect(internal.core.stage).toBe('proposing');
    expect(internal.core.learningPath).toBeNull();
  });
});

describe('completed 硬阻断会话：重判仍被拦', () => {
  it('返回更新后的拒绝文案（明说重判仍不通过），不建路径，用户消息照常落库', async () => {
    mockExecuteSkill.mockResolvedValue(buildAiResponse({
      userVisible: '你补充的内容我记下了。',
      understanding: BLOCKED_UNDERSTANDING, // 模型重提后仍判 not_judgeable × physical_internalized
    }));

    const result = await goalConversationService.continueConversation(
      'conv-1',
      '我真的就是想学会手冲，器具都买齐了',
      'user-1'
    );

    // 模型重判回合发生了，但不建路
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(prismaMock.learning_paths.create).not.toHaveBeenCalled();
    expect(conversationRecord.learningPathId).toBeNull();

    // 更新后的拒绝文案：明确说重判仍不通过，不再是「补充后我会重新判断」的初次话术
    expect(result.userVisible).toContain('重新判断');
    expect(result.userVisible).toContain('仍不会生成学习路径');
    expect(result.userVisible).not.toContain('直接回复这条消息补充说明');
    const internal = result.internal as GoalEnvelope;
    expect(internal.core.learningPath).toBeNull();
    expect(internal.core.stage).toBe('completed');
    // 硬阻断终局标记（2026-11-05 UX 审计 P0）：缺此标记前端会把重判拒绝当普通完成，
    // 重弹「路径已创建 · 生成中」假成功弹层（这正是阻断卡引导的补充重判退路）
    expect((internal.core as { hardBlocked?: boolean }).hardBlocked).toBe(true);
    expect(internal.ext?.goalConversation?.responseTriage).toEqual(expect.objectContaining({ mode: 'referral' }));

    // 补充说明落库（不再零痕迹），会话保持 completed 终态
    const persisted = JSON.parse(conversationRecord.collectedData) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(persisted.messages[persisted.messages.length - 2]).toEqual(expect.objectContaining({
      role: 'user',
      content: '我真的就是想学会手冲，器具都买齐了',
    }));
    // #213：重判仍被拦截的拒绝文案必须落库（就地取代模型原始回合）。
    // 此前只进返回值，GET 会按初判重建另一段文案，重载后「结论不变」这句凭空消失。
    expect(persisted.messages[persisted.messages.length - 1]).toEqual(expect.objectContaining({
      role: 'ai',
      content: expect.stringContaining('仍不会生成学习路径'),
    }));
    expect(conversationRecord.status).toBe('completed');
    expect(conversationRecord.stage).toBe('completed');
  });
});

describe('非硬阻断终局的普通 completed 会话：行为不回归', () => {
  it('已绑路径 → 照旧返回「学习路径已经生成」，不触发 LLM、不重复建路', async () => {
    conversationRecord.learningPathId = 'lp-existing';
    pathStore.set('lp-existing', { id: 'lp-existing', status: 'active' });

    const result = await goalConversationService.continueConversation('conv-1', '谢谢', 'user-1');

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.userVisible).toBe('学习路径已经生成，可以去查看啦！');
    const internal = result.internal as GoalEnvelope;
    expect(internal.core.learningPath).toEqual({ id: 'lp-existing', status: 'active' });
  });

  it('已绑路径但仍在阶段设计窗口 → 说「正在生成」，不再谎称已生成（#228 残余）', async () => {
    conversationRecord.learningPathId = 'lp-designing';
    // core 落库时就把 status 写成 active，而阶段设计还在跑：只看 status 会谎称「已生成」
    pathStore.set('lp-designing', {
      id: 'lp-designing',
      status: 'active',
      userId: 'user-1',
      aiGenerated: true,
      aiPromptTemplate: null,
      updatedAt: new Date(),
      milestones: [{ stageNumber: 1, subtasks: [] }],
      activeGenerationRun: {
        id: 'run-1',
        phase: 'stageDesign',
        status: 'processing',
        retryAllowed: false,
        completedItems: 0,
        totalItems: 1,
        heartbeatAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await goalConversationService.continueConversation('conv-1', '现在怎么样了', 'user-1');

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    // 与同一秒的 GET 快照逐字同源（#228：同一态两接口同一口径）
    expect(result.userVisible).toBe(
      '已收到确认，学习路径正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。',
    );
    expect(result.userVisible).not.toContain('已经生成');
    const internal = result.internal as GoalEnvelope;
    expect(internal.core.learningPath).toEqual({ id: 'lp-designing', status: 'active' });
  });

  it('无路径且存档分诊非硬阻断 → 照旧短路返回，不触发 LLM（referral 但 judgeable）', async () => {
    conversationRecord.collectedData = JSON.stringify({
      messages: [],
      understanding: { real_problem: '没权限走审批' },
      stage: 'completed',
      confidence: 0.8,
      responseTriage: { mode: 'referral', confidence: 'medium', reasons: ['现实条件为主'] },
    });

    const result = await goalConversationService.continueConversation('conv-1', '还有个问题', 'user-1');

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(result.userVisible).toBe('学习路径已经生成，可以去查看啦！');
  });

  it('无路径且无存档分诊 → 照旧短路返回，不触发 LLM', async () => {
    conversationRecord.collectedData = JSON.stringify({
      messages: [],
      understanding: { real_problem: '随便聊聊' },
      stage: 'completed',
      confidence: 0.5,
    });

    const result = await goalConversationService.continueConversation('conv-1', '在吗', 'user-1');

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(result.userVisible).toBe('学习路径已经生成，可以去查看啦！');
  });
});
