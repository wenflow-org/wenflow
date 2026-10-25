/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内省 express router/mock 形状（对齐同目录既有豁免先例） */
/**
 * POST /paths/:id/retry-generation —— 重试路径生成（failed/停滞运营救援）契约测试
 *
 * 口径（与会话级 POST /admin/virtual-learners/sessions/:sessionId/retry-path-generation 同一守卫）：
 * 1. 路径不存在 → 404
 * 2. 无关联虚拟会话（真人路径/会话未建）→ 失败态回退 goal 画像重建；非失败态 409
 * 3. 守卫放行（core）→ HTTP 200 + data.retryType=core，且按 learningPathId 解析出的
 *    最新虚拟会话 id 代发（runLeasedExclusive 租约内）
 * 4. 守卫拒绝（未失败/已完成）→ HTTP 200 + success:false + 中文原因透传
 * 5. 非管理员 → 403
 */
const mockFindLearningPathById = jest.fn();
const mockFindFirst = jest.fn();
const mockRunLeasedExclusive = jest.fn();
const mockRetryPathGeneration = jest.fn();
const mockCheckIsAdmin = jest.fn();
const mockRegenerateFromGoal = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
  },
}));

jest.mock('../../../services/admin/learning-content.repo', () => ({
  __esModule: true,
  findLearningPathsForAdmin: jest.fn(),
  countLearningPathsWhere: jest.fn(),
  findLearningPathDetail: jest.fn(),
  findLearningPathById: (...args: unknown[]) => mockFindLearningPathById(...args),
  archiveLearningPath: jest.fn(),
  restoreLearningPath: jest.fn(),
  findLearningPathWithMilestoneCount: jest.fn(),
  deleteLearningPath: jest.fn(),
  getLearningContentStats: jest.fn(),
  // 「重试生成」取最新虚拟会话已下沉到仓储（routes 层不得直连 DB）——把仓储入参还原成
  // 原来的 prisma 查询形状转给同一个 mockFindFirst，断言口径不变
  findLatestVirtualSessionForPath: (learningPathId: string) => mockFindFirst({
    where: { learningPathId },
    orderBy: { createdAt: 'desc' },
  }),
}));

jest.mock('../../../coordinators/simulation.coordinator', () => ({
  __esModule: true,
  default: {
    runLeasedExclusive: (...args: unknown[]) => mockRunLeasedExclusive(...args),
    retryPathGeneration: (...args: unknown[]) => mockRetryPathGeneration(...args),
  },
}));

jest.mock('../../../services/admin-access.service', () => ({
  checkIsAdmin: (...args: unknown[]) => mockCheckIsAdmin(...args),
}));

jest.mock('../../../services/learning/path-regeneration.service', () => ({
  __esModule: true,
  regeneratePathCoreFromStoredGoal: (...args: unknown[]) => mockRegenerateFromGoal(...args),
}));

jest.mock('../../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../../middleware/audit-context', () => ({
  setAuditAction: jest.fn(),
  setAuditBefore: jest.fn(),
  setAuditAfter: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

jest.mock('../../../utils/test-account', () => ({
  buildRealUserWhere: async () => ({}),
}));

import router from '../learning-content';

function getPostHandler(path: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.post
  );
  if (!layer) throw new Error(`POST route not found: ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function createRequest(overrides: Record<string, any> = {}) {
  return {
    user: { userId: 'admin-1' },
    params: { id: 'path-1' },
    body: {},
    ...overrides,
  };
}

const failedPath = { id: 'path-1', userId: 'user-1', title: '失败路径', status: 'failed' };
const session = { id: 'sess-1', learningPathId: 'path-1', status: 'abandoned' };

describe('POST /paths/:id/retry-generation（重试路径生成）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckIsAdmin.mockResolvedValue(true);
    // 默认租约直通：注入 no-op assertLeaseOwned（路由 work 首行会 await 它）并回传 retry 结果
    mockRunLeasedExclusive.mockImplementation(async (_sid: string, work: (assert: () => Promise<void>) => Promise<unknown>) =>
      work(async () => {})
    );
  });

  it('非管理员 → 403', async () => {
    mockCheckIsAdmin.mockResolvedValue(false);
    const res = createResponse();
    await getPostHandler('/paths/:id/retry-generation')(createRequest(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('路径不存在 → 404', async () => {
    mockFindLearningPathById.mockResolvedValue(null);
    const res = createResponse();
    await getPostHandler('/paths/:id/retry-generation')(createRequest(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  /* 2026-10-22 修复：真人路径没有虚拟会话，此前只能 409；现在失败态回退走
     学员端「重新生成」同一条 goal 画像链路，按钮对真实路径也成立。 */
  it('无虚拟会话 + 失败态 → 回退主结构重建（goal 画像链路），200 + retryType=core', async () => {
    mockFindLearningPathById.mockResolvedValue(failedPath);
    mockFindFirst.mockResolvedValue(null);
    mockRegenerateFromGoal.mockResolvedValue({ runId: 'pgr_goal', mode: 'goal' });
    const res = createResponse();
    await getPostHandler('/paths/:id/retry-generation')(createRequest(), res);

    expect(mockRegenerateFromGoal).toHaveBeenCalledWith(failedPath);
    expect(mockRunLeasedExclusive).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { success: true, retryType: 'core', runId: 'pgr_goal', mode: 'goal' },
    });
  });

  it('无虚拟会话 + 非失败态 → 仍 409（重试不是通用重建按钮）', async () => {
    mockFindLearningPathById.mockResolvedValue({ ...failedPath, status: 'active' });
    mockFindFirst.mockResolvedValue(null);
    const res = createResponse();
    await getPostHandler('/paths/:id/retry-generation')(createRequest(), res);
    expect(mockRegenerateFromGoal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: { message: '该路径没有关联的虚拟学习会话，无法重试生成', status: 409 } })
    );
  });

  it('无虚拟会话 + 回退重建失败 → 原因透传（冲突 409）', async () => {
    mockFindLearningPathById.mockResolvedValue(failedPath);
    mockFindFirst.mockResolvedValue(null);
    const conflict = Object.assign(new Error('该路径已有进行中的生成任务'), { code: 'PATH_MUTATION_IN_PROGRESS', status: 409 });
    mockRegenerateFromGoal.mockRejectedValue(conflict);
    const res = createResponse();
    await getPostHandler('/paths/:id/retry-generation')(createRequest(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ message: '该路径已有进行中的生成任务', status: 409 }) })
    );
  });

  it('守卫放行 core → 按 learningPathId 解析最新会话代发，retryType/runId 透传', async () => {
    mockFindLearningPathById.mockResolvedValue(failedPath);
    mockFindFirst.mockResolvedValue(session);
    mockRetryPathGeneration.mockResolvedValue({ success: true, retryType: 'core', runId: 'pgr_1' });

    const res = createResponse();
    await getPostHandler('/paths/:id/retry-generation')(createRequest(), res);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { learningPathId: 'path-1' }, orderBy: { createdAt: 'desc' } })
    );
    expect(mockRunLeasedExclusive).toHaveBeenCalledWith('sess-1', expect.any(Function));
    expect(mockRetryPathGeneration).toHaveBeenCalledWith('sess-1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { success: true, retryType: 'core', runId: 'pgr_1' },
      error: undefined,
    });
  });

  it('守卫拒绝 → HTTP 200 + success:false + 中文原因透传（页面 toast 直出）', async () => {
    mockFindLearningPathById.mockResolvedValue(failedPath);
    mockFindFirst.mockResolvedValue(session);
    mockRetryPathGeneration.mockResolvedValue({ success: false, error: '当前生成任务未失败或未过期，不能重试' });

    const res = createResponse();
    await getPostHandler('/paths/:id/retry-generation')(createRequest(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      data: { success: false, error: '当前生成任务未失败或未过期，不能重试' },
      error: '当前生成任务未失败或未过期，不能重试',
    });
  });
});
