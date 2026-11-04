/**
 * #211：goal 会话快照 GET 的 learningPath.status 不再回吐 collectedData 里冻结的
 * 'generating'，而是对已绑路径的会话用权威 learning_paths 鲜查状态（与 /reply 的
 * buildCompletedConversationResult 同源）。这里用最小 prisma 桩直接驱动真实 getConversation。
 */
const mockGoalFindFirst = jest.fn();
const mockPathFindFirst = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    goal_conversations: { findFirst: (...args: unknown[]) => mockGoalFindFirst(...args) },
    learning_paths: { findFirst: (...args: unknown[]) => mockPathFindFirst(...args) },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import goalConversationService from '../goal-conversation.service';

function conversationRow(overrides: {
  learningPathId: string | null;
  learningPath?: unknown;
}) {
  return {
    id: 'gc-1',
    userId: 'user-1',
    description: 'desc',
    stage: 'completed',
    status: 'completed',
    revision: 1,
    learningPathId: overrides.learningPathId,
    collectedData: JSON.stringify({
      messages: [],
      understanding: {},
      collected: {},
      ...(overrides.learningPath !== undefined ? { learningPath: overrides.learningPath } : {}),
    }),
    completedAt: new Date(),
  };
}

describe('getConversation · learningPath 状态鲜查（#211）', () => {
  beforeEach(() => {
    mockGoalFindFirst.mockReset();
    mockPathFindFirst.mockReset();
  });

  it('已绑路径：冻结 generating + 权威 active → 返回 active', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      learningPathId: 'lp-1',
      learningPath: { id: 'lp-1', status: 'generating' },
    }));
    mockPathFindFirst.mockResolvedValue({ id: 'lp-1', status: 'active' });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(mockPathFindFirst).toHaveBeenCalledWith({ where: { id: 'lp-1' } });
    expect(result.learningPath).toEqual({ id: 'lp-1', status: 'active' });
  });

  it('已绑路径但权威行不存在 → 返回 null（不回退冻结值）', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({
      learningPathId: 'lp-gone',
      learningPath: { id: 'lp-gone', status: 'generating' },
    }));
    mockPathFindFirst.mockResolvedValue(null);

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.learningPath).toBeNull();
  });

  it('未绑路径：保持原行为，不触达 learning_paths', async () => {
    mockGoalFindFirst.mockResolvedValue(conversationRow({ learningPathId: null }));

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(mockPathFindFirst).not.toHaveBeenCalled();
    expect(result.learningPath).toBeNull();
  });
});

describe('getConversation · 已完成会话的 userVisible 重建（#213）', () => {
  beforeEach(() => {
    mockGoalFindFirst.mockReset();
    mockPathFindFirst.mockReset();
  });

  it('硬阻断终局：GET 快照重建拒绝文案，不再返回硬编码的「会话详情获取成功」', async () => {
    mockGoalFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '学会手冲咖啡',
      stage: 'completed',
      status: 'completed',
      revision: 3,
      learningPathId: null,
      collectedData: JSON.stringify({
        messages: [
          { role: 'user', content: '就按这个方案来' },
          { role: 'ai', content: '（历史拒绝文案）' },
        ],
        understanding: {
          surface_goal: '学会手冲咖啡',
          platform_judgment: 'not_judgeable',
          skill_nature: 'physical_internalized',
        },
        collected: {},
        responseTriage: { mode: 'referral', confidence: 'high', reasons: [] },
      }),
      completedAt: new Date(),
    });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.userVisible).toContain('不会生成学习路径');
    expect(result.userVisible).not.toBe('会话详情获取成功');
    expect(mockPathFindFirst).not.toHaveBeenCalled();
  });

  it('进行中会话：userVisible 是最后一条 AI 消息（#221：不再是路由占位串）', async () => {
    mockGoalFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '随便聊聊',
      stage: 'proposing',
      status: 'active',
      revision: 1,
      learningPathId: null,
      collectedData: JSON.stringify({
        messages: [
          { role: 'user', content: '我想学手冲' },
          { role: 'ai', content: '先确认一下你平时用什么器具？' },
          { role: 'user', content: 'V60' },
        ],
        understanding: {},
        collected: {},
      }),
      completedAt: null,
    });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.userVisible).toBe('先确认一下你平时用什么器具？');
  });

  it('进行中会话且没有任何 AI 消息：userVisible 为 null（不落占位串）', async () => {
    mockGoalFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '随便聊聊',
      stage: 'understanding',
      status: 'active',
      revision: 1,
      learningPathId: null,
      collectedData: JSON.stringify({ messages: [], understanding: {}, collected: {} }),
      completedAt: null,
    });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.userVisible).toBeNull();
  });

  it('已完成且有路径：userVisible 返回「学习路径已生成：<名字>」', async () => {
    mockGoalFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '学会手冲咖啡',
      stage: 'completed',
      status: 'completed',
      revision: 2,
      learningPathId: 'lp-1',
      collectedData: JSON.stringify({ messages: [], understanding: {}, collected: {} }),
      completedAt: new Date(),
    });
    mockPathFindFirst.mockResolvedValue({ id: 'lp-1', status: 'active', name: '手冲咖啡入门', title: '手冲咖啡入门' });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.userVisible).toBe('学习路径已生成：手冲咖啡入门');
    expect(result.userVisible).not.toBe('会话详情获取成功');
  });

  it('已完成但路径仍在生成：userVisible 说正在生成，不说已生成（#223）', async () => {
    mockGoalFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '学会手冲咖啡',
      stage: 'completed',
      status: 'completed',
      revision: 2,
      learningPathId: 'lp-1',
      collectedData: JSON.stringify({ messages: [], understanding: {}, collected: {} }),
      completedAt: new Date(),
    });
    // 确认时绑定的占位路径：名字固定「个性化学习路径」，status=generating
    mockPathFindFirst.mockResolvedValue({ id: 'lp-1', status: 'generating', name: null, title: '个性化学习路径' });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.userVisible).toBe(
      '已收到确认，学习路径正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。',
    );
    expect(result.userVisible).not.toContain('学习路径已生成');
    // 与 /reply 同源：同一操作两处口径一致
    expect(result.learningPath).toEqual({ id: 'lp-1', status: 'generating' });
  });

  it('已完成但路径生成失败：userVisible 如实报失败，绝不说已生成（#223）', async () => {
    mockGoalFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '学会手冲咖啡',
      stage: 'completed',
      status: 'completed',
      revision: 2,
      learningPathId: 'lp-1',
      collectedData: JSON.stringify({ messages: [], understanding: {}, collected: {} }),
      completedAt: new Date(),
    });
    mockPathFindFirst.mockResolvedValue({ id: 'lp-1', status: 'failed', name: '手冲咖啡入门', title: '手冲咖啡入门' });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.userVisible).toBe('学习路径生成失败，可前往“学习路径”重试。');
    expect(result.userVisible).not.toContain('已生成');
  });

  it('已完成、无路径且非硬阻断：userVisible 为 null（不落占位串）', async () => {
    mockGoalFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '随便聊聊',
      stage: 'completed',
      status: 'completed',
      revision: 2,
      learningPathId: null,
      collectedData: JSON.stringify({ messages: [], understanding: {}, collected: {} }),
      completedAt: new Date(),
    });

    const result = await goalConversationService.getConversation('gc-1', 'user-1');

    expect(result.userVisible).toBeNull();
  });
});
