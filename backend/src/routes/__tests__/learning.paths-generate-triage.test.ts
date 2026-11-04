/**
 * `/paths/generate` 的分诊闸门契约（#217）。
 *
 * 闸门本体在 `pathOrchestrator.generate`（唯一动作入口，见 path-generation-gate 单测与
 * coordinator 行为）；本文件锁定路由的两件事：
 *  1. 路由把 goal 层判定凭证（`understanding`）原样下传，缺失时下传 null——**不自行猜测**；
 *  2. 闸门抛出的两种拒绝都映射成 422，文案原样透出、不进 next()。
 */
const mockGenerate = jest.fn();

jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));
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
import {
  GoalTriageRequiredError,
  PathGenerationBlockedError,
} from '../../services/learning/path-generation-gate';

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

describe('POST /paths/generate 分诊闸门（#217）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('缺少 goal 层凭证时下传 null（不自造判定），并由闸门拒绝', async () => {
    mockGenerate.mockRejectedValue(new GoalTriageRequiredError());
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: '三个月后在婚礼上自弹自唱一首民谣吉他',
        subject: '民谣吉他',
        deadlineText: '三个月后',
      },
    }, res, next);

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      description: '三个月后在婚礼上自弹自唱一首民谣吉他',
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

  it('goal 层判定为不可判定时透出与目标会话一致的拒绝文案', async () => {
    mockGenerate.mockImplementation(() => {
      throw new PathGenerationBlockedError({
        mode: 'referral',
        confidence: 'high',
        reasons: ['平台不可判定'],
      });
    });
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: '三个月后在婚礼上自弹自唱一首民谣吉他',
        understanding: {
          platform_judgment: 'not_judgeable',
          skill_nature: 'physical_internalized',
        },
      },
    }, res, next);

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      goalTriage: {
        understanding: {
          platform_judgment: 'not_judgeable',
          skill_nature: 'physical_internalized',
        },
      },
    }));
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

  it('可判定目标照常生成路径', async () => {
    mockGenerate.mockResolvedValue({ path: { id: 'path-1' } });
    const handler = getPostHandler('/paths/generate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      body: {
        description: '三个月内掌握 SQL 查询与索引优化',
        subject: 'SQL',
        understanding: { primary_block_type: 'capability' },
      },
    }, res, next);

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      description: '三个月内掌握 SQL 查询与索引优化',
      subject: 'SQL',
      goalTriage: { understanding: { primary_block_type: 'capability' } },
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});
