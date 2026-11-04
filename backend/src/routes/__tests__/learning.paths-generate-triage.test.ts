/**
 * `/paths/generate` 的分诊闸门契约（#217 / #222）。
 *
 * 本文件跑**真实**的 `resolveGoalTriageEvidenceForUser`（prisma 桩）+ **真实**的
 * `assertPathGenerationAllowed`（coordinator 的 generate 被替换成「先过闸门再返回」），
 * 只有代码之后的生成被短路。这样三条复核实测出的通路都在测试里可见：
 *  - 请求体 `understanding` 不再是放行依据；
 *  - 借自己另一场 judgeable 会话为别的目标建路径 → 拒；
 *  - 未完成会话的兜底分诊（understanding 无判定字段）→ 拒。
 */
const mockGenerate = jest.fn();
const mockFindFirst = jest.fn();

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    goal_conversations: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
  },
}));
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../middleware/api-rate-limit.middleware', () => ({
  learningPathsPollingLimiter: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: { generate: mockGenerate },
}));
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn(),
}));
jest.mock('../../services/learning/path-mutation-safety', () => ({
  isPathMutationConflictError: jest.fn(() => false),
}));

import router from '../learning';
import { assertPathGenerationAllowed } from '../../services/learning/path-generation-gate';

const WEDDING = '三个月后在婚礼上自弹自唱一首民谣吉他';
const SQL_GOAL = '下个月要参加公司内部的数据岗转岗机考，是上机写 SQL 的那种';

const BLOCKED_COLLECTED = {
  understanding: {
    platform_judgment: 'not_judgeable',
    skill_nature: 'physical_internalized',
  },
  responseTriage: { mode: 'referral', confidence: 'high', reasons: ['平台不可判定'] },
};
const JUDGEABLE_COLLECTED = {
  understanding: {
    platform_judgment: 'judgeable_output',
    skill_nature: 'tool_operation',
    primary_block_type: 'capability',
  },
  responseTriage: { mode: 'learning_path', confidence: 'high', reasons: ['阻塞类型为 capability'] },
};
/** 未完成会话：understanding 无判定字段，responseTriage 是每回合的兜底 learning_path/low。 */
const NO_VERDICT_COLLECTED = {
  understanding: { current_baseline: '只会 Excel 透视表', pain_points: ['不识谱'] },
  responseTriage: { mode: 'learning_path', confidence: 'low', reasons: ['缺少阻塞类型标注，默认按能力缺口处理'] },
};

function conversationRow(overrides: {
  description?: string | null;
  status?: string;
  collectedData?: unknown;
}) {
  return {
    description: overrides.description === undefined ? WEDDING : overrides.description,
    status: overrides.status ?? 'completed',
    collectedData: JSON.stringify(overrides.collectedData ?? BLOCKED_COLLECTED),
  };
}

function getPostHandler(path: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.post
  );
  if (!layer) throw new Error(`Route not found: ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('POST /paths/generate 分诊闸门（#217/#222）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 真实闸门，只短路闸门之后的生成。
    mockGenerate.mockImplementation((input: { goalTriage?: unknown }) => {
      assertPathGenerationAllowed(input.goalTriage as never);
      return { path: { id: 'path-1' } };
    });
  });

  it('请求体伪造 understanding 不作为放行依据，无会话凭证 → 422 且下传 null', async () => {
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: WEDDING,
        subject: '民谣吉他',
        deadlineText: '三个月后',
        // #222 的绕过面：旧实现会把这份自断言原样当权威结论。
        understanding: { platform_judgment: 'judgeable' },
      },
    }, res, next);

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      description: WEDDING,
      goalTriage: null,
    }));
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.objectContaining({
        code: 'GOAL_TRIAGE_REQUIRED',
        message: expect.stringContaining('生成学习路径前需要目标判定结论'),
      }),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('会话不存在/不属于该用户 → 422，且不生成', async () => {
    mockFindFirst.mockResolvedValue(null);
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: WEDDING,
        sourceConversationId: 'gc-not-mine',
        understanding: { platform_judgment: 'judgeable' },
      },
    }, res, next);

    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'gc-not-mine', userId: 'user-1' },
    }));
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'GOAL_TRIAGE_REQUIRED' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('服务端结论为不可判定时透出与目标会话一致的拒绝文案', async () => {
    mockFindFirst.mockResolvedValue(conversationRow({ description: WEDDING }));
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: WEDDING,
        sourceConversationId: 'gc-1793785027483_j7ry4es',
        // 即便请求体写着 judgeable，也以服务端结论为准。
        understanding: { platform_judgment: 'judgeable' },
      },
    }, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.objectContaining({
        code: 'GOAL_NOT_JUDGEABLE',
        message: expect.stringContaining('这类目标当前不会生成学习路径'),
        responseTriage: expect.objectContaining({ mode: 'referral' }),
      }),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('借用自己另一场 judgeable 会话为婚礼目标建路径 → 422（description 绑定）', async () => {
    mockFindFirst.mockResolvedValue(conversationRow({
      description: SQL_GOAL,
      collectedData: JUDGEABLE_COLLECTED,
    }));
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: WEDDING,
        sourceConversationId: 'gc_1793731239447_vo6ccdp',
      },
    }, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'GOAL_TRIAGE_REQUIRED' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('未完成会话的兜底分诊 → 422（不把「没有判定」读成「可判定」）', async () => {
    mockFindFirst.mockResolvedValue(conversationRow({
      status: 'active',
      collectedData: NO_VERDICT_COLLECTED,
    }));
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: WEDDING,
        sourceConversationId: 'gc_1793731931541_qrh8c7q',
      },
    }, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'GOAL_TRIAGE_REQUIRED' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('服务端结论可判定且目标一致时照常生成路径', async () => {
    mockFindFirst.mockResolvedValue(conversationRow({
      description: SQL_GOAL,
      collectedData: JUDGEABLE_COLLECTED,
    }));
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: SQL_GOAL,
        subject: 'SQL',
        sourceConversationId: 'gc_capability',
      },
    }, res, next);

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      description: SQL_GOAL,
      subject: 'SQL',
      goalTriage: expect.objectContaining({ understanding: JUDGEABLE_COLLECTED.understanding }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});
