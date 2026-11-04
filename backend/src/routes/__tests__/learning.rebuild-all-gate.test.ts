/**
 * #227：空壳路径 + `regenerate?mode=rebuild-all` 不得绕过 goal 层闸门。
 *
 * 实测绕过链路（三名探路者独立复现）：`POST /paths` 用任意文本建一条 status=active、
 * 0 里程碑、无任何 goal 产物的路径 → `POST /paths/:id/regenerate?mode=rebuild-all` →
 * 200 → 轮询到 ready → 4 里程碑 / 20 任务。根因是闸门「带 existingPathId 就整条跳过唯一守卫」。
 *
 * 本文件跑**真实**的凭证解析（`resolveGoalTriageEvidenceForExistingPath`）与**真实**闸门
 * （`assertPathGenerationAllowed`），只桩掉 DB 与生成侧：
 *  - 空壳路径（模板只有显式「无 goal 判定」标记、无关联会话、无凭证）→ 422 且**零落库**
 *    （不认领 run、不下发任何 generation）；
 *  - 正常目标对话建出的路径（模板带服务端 visibleSummary 判定投影）→ 照常进入生成流程，
 *    不出现 GOAL_TRIAGE_REQUIRED（防「修过头」把合法重建也打回 422）。
 */
const mockFindUnique = jest.fn();
const mockClaimPathCoreGeneration = jest.fn();
const mockMarkActiveGenerationFailed = jest.fn();
const mockGetPathGenerationRetry = jest.fn();
const mockCreateLearningPath = jest.fn();
const mockRunGoalAsync = jest.fn();
const mockRunAsync = jest.fn();
const mockRunRebuildFromGoalAsync = jest.fn();
const mockFindGoalConversation = jest.fn();
const mockRunCount = jest.fn();

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: (...args: unknown[]) => mockFindUnique(...args), findFirst: jest.fn() },
    goal_conversations: { findFirst: (...args: unknown[]) => mockFindGoalConversation(...args) },
    path_generation_runs: { count: (...args: unknown[]) => mockRunCount(...args) },
  },
}));

jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: {
    claimPathCoreGeneration: (...args: unknown[]) => mockClaimPathCoreGeneration(...args),
    markActiveGenerationFailed: (...args: unknown[]) => mockMarkActiveGenerationFailed(...args),
    getPathGenerationRetry: (...args: unknown[]) => mockGetPathGenerationRetry(...args),
    createLearningPath: (...args: unknown[]) => mockCreateLearningPath(...args),
  },
}));

jest.mock('../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: {
    runGoalAsync: (...args: unknown[]) => mockRunGoalAsync(...args),
    runAsync: (...args: unknown[]) => mockRunAsync(...args),
    runRebuildFromGoalAsync: (...args: unknown[]) => mockRunRebuildFromGoalAsync(...args),
  },
}));

jest.mock('../../services/learning/learning-routes.repo', () => ({
  __esModule: true,
  // 路由的前置查询（路径 + 里程碑任务状态）
  findLearningPathWithMilestones: (...args: unknown[]) => mockFindUnique(...args),
  findOwnedLearningPathById: (...args: unknown[]) => mockFindUnique(...args),
  findLearningPathById: (...args: unknown[]) => mockFindUnique(...args),
  findLearningPathOwner: async (...args: unknown[]) => {
    const path = await mockFindUnique(...args);
    return path ? { userId: path.userId } : null;
  },
  // 关联目标会话（#227 凭证解析第二来源）：默认「路径没有关联会话」
  findGoalConversationForPathSummary: (...args: unknown[]) => mockFindGoalConversation(...args),
  listMilestonesWithTaskIds: async () => [],
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/api-rate-limit.middleware', () => ({
  learningPathsPollingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn((input: unknown) => input),
}));
jest.mock('../../services/learning/path-mutation-safety', () => ({
  isPathMutationConflictError: jest.fn(() => false),
}));

import router from '../learning';
import { MANUAL_PATH_PROMPT_TEMPLATE } from '../../services/learning/path-generation-gate';

const WEDDING = '三个月后在婚礼上自弹自唱一首民谣吉他';

interface RouterLayer {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => unknown }>;
  };
}

function getRouteHandler(method: 'post' | 'patch', path: string) {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  const layer = stack.find(
    (item) => item.route?.path === path && item.route?.methods?.[method]
  );
  if (!layer?.route) throw new Error(`${method.toUpperCase()} route not found: ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function createResponse(): MockResponse {
  const res = { status: jest.fn(), json: jest.fn() } as MockResponse;
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

/** 有已完成任务（无 in_progress）→ 触发 rebuild-all 分支 */
const COMPLETED_TASKS = [
  {
    id: 'm-1',
    stageNumber: 1,
    status: 'active',
    subtasks: [{ id: 't-1', status: 'completed' }, { id: 't-2', status: 'todo' }],
  },
];

/** 空壳路径：POST /paths 建出来的行——只有显式「无 goal 判定」标记，没有任何 goal 产物 */
function shellPath() {
  return {
    id: 'lp_shell',
    userId: 'user-1',
    title: '婚礼弹唱计划',
    name: '婚礼弹唱计划',
    description: WEDDING,
    subject: '民谣吉他',
    status: 'active',
    activeGenerationRunId: null,
    aiPromptTemplate: MANUAL_PATH_PROMPT_TEMPLATE,
    milestones: COMPLETED_TASKS,
  };
}

/** 目标对话建出的正常路径：模板带服务端产出的判定投影 */
function goalGeneratedPath() {
  return {
    id: 'lp_goal',
    userId: 'user-1',
    title: 'TypeScript 学习',
    name: 'TypeScript 学习路径',
    description: 'TypeScript 学习',
    subject: 'TypeScript',
    status: 'active',
    activeGenerationRunId: null,
    aiPromptTemplate: JSON.stringify({
      source: 'goal',
      goalFinalPayload: {
        rawGoal: '学会 TypeScript',
        sourceConversationId: 'conv-1',
        visibleSummary: {
          surfaceGoal: '学会 TypeScript',
          platformJudgment: 'judgeable_output',
          skillNature: 'tool_operation',
        },
        conversationHistory: [],
      },
    }),
    milestones: COMPLETED_TASKS,
  };
}

describe('POST /paths/:pathId/regenerate?mode=rebuild-all 的 goal 闸门（#227）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindGoalConversation.mockResolvedValue(null);
    mockRunCount.mockResolvedValue(0);
    mockClaimPathCoreGeneration.mockResolvedValue('run-1');
    mockRunRebuildFromGoalAsync.mockImplementation(() => {});
    mockRunAsync.mockImplementation(() => {});
    mockRunGoalAsync.mockImplementation(() => {});
  });

  it('空壳路径（无 goal 产物、无关联会话、无凭证）→ 422 且零落库、零生成', async () => {
    mockFindUnique.mockResolvedValue(shellPath());
    const handler = getRouteHandler('post', '/paths/:pathId/regenerate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_shell' },
      body: { mode: 'rebuild-all' },
    }, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'GOAL_TRIAGE_REQUIRED' }),
    }));
    // 零落库：不认领 run、不下发任何 generation（里程碑自然不会产生）
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(mockRunRebuildFromGoalAsync).not.toHaveBeenCalled();
    expect(mockRunAsync).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('旧数据空壳路径（aiPromptTemplate=null）同样 422', async () => {
    mockFindUnique.mockResolvedValue({ ...shellPath(), aiPromptTemplate: null });
    const handler = getRouteHandler('post', '/paths/:pathId/regenerate');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_shell' },
      body: { mode: 'rebuild-all' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'GOAL_TRIAGE_REQUIRED' }),
    }));
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
  });

  it('目标对话建出的正常路径 → 照常进入生成流程（不出现 GOAL_TRIAGE_REQUIRED）', async () => {
    mockFindUnique.mockResolvedValue(goalGeneratedPath());
    const handler = getRouteHandler('post', '/paths/:pathId/regenerate');
    const res = createResponse();
    const next = jest.fn();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_goal' },
      body: { mode: 'rebuild-all' },
    }, res, next);

    expect(res.status).not.toHaveBeenCalledWith(422);
    expect(mockClaimPathCoreGeneration).toHaveBeenCalledWith('lp_goal', null, { allowCompleted: true });
    expect(mockRunRebuildFromGoalAsync).toHaveBeenCalledTimes(1);
    // 合法重建不进失败态：闸门放行后没有任何 markActiveGenerationFailed 调用
    expect(mockMarkActiveGenerationFailed).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ mode: 'rebuild-all' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('空壳路径 + 本次请求补服务端凭证（与路径目标一致）→ 放行进入生成', async () => {
    mockFindUnique.mockResolvedValue({ ...shellPath(), aiPromptTemplate: null });
    // 路径本身没有关联会话（learningPathId 查空）；只有本次请求带的凭证据 id 命中
    mockFindGoalConversation.mockImplementation(async (args: { where?: { id?: string } }) => (
      args?.where?.id === 'gc-wedding'
        ? {
          description: WEDDING,
          status: 'completed',
          collectedData: JSON.stringify({
            understanding: {
              surface_goal: '三个月后在婚礼上自弹自唱一首民谣',
              platform_judgment: 'judgeable_output',
              skill_nature: 'tool_operation',
              primary_block_type: 'capability',
            },
          }),
        }
        : null
    ));

    const handler = getRouteHandler('post', '/paths/:pathId/regenerate');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_shell' },
      body: { mode: 'rebuild-all', sourceConversationId: 'gc-wedding' },
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(422);
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    expect(mockRunAsync.mock.calls[0][0]).toEqual(expect.objectContaining({
      sourceConversationId: 'gc-wedding',
      existingPathId: 'lp_shell',
    }));
  });
});

describe('PATCH /paths/:pathId/retry 的 goal 闸门（#227）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindGoalConversation.mockResolvedValue(null);
    mockClaimPathCoreGeneration.mockResolvedValue('run-1');
    mockGetPathGenerationRetry.mockResolvedValue({ allowed: true, retryType: 'core', expectedActiveGenerationRunId: null });
    mockRunGoalAsync.mockImplementation(() => {});
    mockRunAsync.mockImplementation(() => {});
  });

  it('空壳路径重试（status=failed）→ 422 且零落库、零生成', async () => {
    mockFindUnique.mockResolvedValue({ ...shellPath(), status: 'failed' });
    const handler = getRouteHandler('patch', '/paths/:pathId/retry');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_shell' },
      body: {},
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'GOAL_TRIAGE_REQUIRED' }),
    }));
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(mockRunAsync).not.toHaveBeenCalled();
    expect(mockRunGoalAsync).not.toHaveBeenCalled();
  });

  it('目标对话建出的正常路径重试 → 照常进入生成流程（不出现 GOAL_TRIAGE_REQUIRED）', async () => {
    mockFindUnique.mockResolvedValue({ ...goalGeneratedPath(), status: 'failed' });
    const handler = getRouteHandler('patch', '/paths/:pathId/retry');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_goal' },
      body: {},
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(422);
    expect(mockClaimPathCoreGeneration).toHaveBeenCalledWith('lp_goal', null);
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1);
    // 合法重试不进失败态：闸门放行后没有任何 markActiveGenerationFailed 调用
    expect(mockMarkActiveGenerationFailed).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ retryType: 'core' }),
    }));
  });
});

/**
 * #227 复核补的两条防线：
 *  - 路由预检不得把 `buildGoalPathRequestFromConversation` 现算的 visibleSummary 当凭证
 *    （那个函数不看会话 status）：模板为 null + 关联会话未完成 → 必须 422；
 *  - 存量「服务端生成占位」失败路径（aiGenerated + 有 run + 无 goalFinalPayload）必须仍可救援。
 */
describe('既有路径闸门：会话状态与存量占位（#227 复核）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimPathCoreGeneration.mockResolvedValue('run-1');
    mockRunGoalAsync.mockImplementation(() => {});
    mockRunAsync.mockImplementation(() => {});
    mockRunRebuildFromGoalAsync.mockImplementation(() => {});
  });

  it('模板为 null + 关联会话未完成（无判定字段）→ 422，不因现算的 visibleSummary 放行', async () => {
    mockFindUnique.mockResolvedValue({ ...shellPath(), aiPromptTemplate: null });
    // buildGoalPathRequestFromConversation 会拿这场会话拼出 23 键 visibleSummary
    mockFindGoalConversation.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      description: WEDDING,
      stage: 'understanding',
      status: 'active',
      collectedData: JSON.stringify({
        understanding: { surface_goal: '三个月后在婚礼上自弹自唱一首民谣', real_problem: '不会弹' },
        messages: [],
      }),
    });

    const handler = getRouteHandler('post', '/paths/:pathId/regenerate');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_shell' },
      body: { mode: 'rebuild-all' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'GOAL_TRIAGE_REQUIRED' }),
    }));
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
    expect(mockRunRebuildFromGoalAsync).not.toHaveBeenCalled();
    expect(mockRunAsync).not.toHaveBeenCalled();
  });

  it('存量服务端失败占位（aiGenerated + 有 run + 仅 _generation 模板）→ 照常救援', async () => {
    mockFindUnique.mockResolvedValue({
      ...shellPath(),
      id: 'lp_legacy_failed',
      status: 'failed',
      aiGenerated: true,
      aiPromptTemplate: JSON.stringify({
        _generation: { core: 'failed', sourceConversationId: 'gc_old' },
      }),
    });
    mockRunCount.mockResolvedValue(1);
    mockFindGoalConversation.mockResolvedValue(null);

    const handler = getRouteHandler('patch', '/paths/:pathId/retry');
    mockGetPathGenerationRetry.mockResolvedValue({ allowed: true, retryType: 'core', expectedActiveGenerationRunId: null });
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_legacy_failed' },
      body: {},
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(422);
    expect(mockClaimPathCoreGeneration).toHaveBeenCalled();
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    expect(mockMarkActiveGenerationFailed).not.toHaveBeenCalled();
  });

  it('同样形状但 aiGenerated=false（手工空壳）→ 仍 422（救援档不覆盖用户建的路径）', async () => {
    mockFindUnique.mockResolvedValue({
      ...shellPath(),
      status: 'failed',
      aiGenerated: false,
      aiPromptTemplate: JSON.stringify({ _generation: { core: 'failed' } }),
    });
    mockRunCount.mockResolvedValue(1);
    mockGetPathGenerationRetry.mockResolvedValue({ allowed: true, retryType: 'core', expectedActiveGenerationRunId: null });

    const handler = getRouteHandler('patch', '/paths/:pathId/retry');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      params: { pathId: 'lp_shell' },
      body: {},
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled();
  });
});

describe('POST /paths 的 201 响应不泄露内部模板（#227 复核）', () => {
  it('手工空壳路径的 aiPromptTemplate 不随响应透出（改动前该字段是 null）', async () => {
    mockCreateLearningPath.mockResolvedValue({
      id: 'lp_new',
      userId: 'user-1',
      name: '婚礼弹唱计划',
      title: '婚礼弹唱计划',
      description: WEDDING,
      status: 'active',
      aiGenerated: false,
      activeGenerationRunId: null,
      // 库里写的内部「无 goal 判定」标记
      aiPromptTemplate: MANUAL_PATH_PROMPT_TEMPLATE,
    });

    const handler = getRouteHandler('post', '/paths');
    const res = createResponse();

    await handler({
      user: { userId: 'user-1' },
      body: { name: '婚礼弹唱计划', description: WEDDING },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.data.id).toBe('lp_new');
    expect(body.data.aiPromptTemplate).toBeUndefined();
  });
});
