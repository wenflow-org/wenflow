/**
 * 数据隔离后端测试：教学会话 / 目标对话 / 用户三个列表端点
 * （2026-10-21 用户拍板「没有测试，测试只是备注」）
 * - 默认口径：只排除虚拟学习者（它们归自己的域）；测试/审计账号照常计入，行内带备注标记
 * - includeTest=true：按 id 直查虚拟账号的逃生口（学习者详情），不附加用户过滤
 * - users 已删除视图（status=deleted）不应用过滤（回收站需展示全量账号以恢复）
 */

export {}

type RouteHandler = (...args: any[]) => any

// 真实用户口径的 id 扫描（utils/test-account 按 isTestAccountUser 判定）会先查一次 users：
// 与业务侧列表查询共用同一个 findMany mock，按入参形状分流，业务断言仍取 mock.calls[0]
let mockTestAccountRows: any[] = []

const tsCount = jest.fn()
const tsFindMany = jest.fn()
const gcCount = jest.fn()
const gcFindMany = jest.fn()
const usersCount = jest.fn()
const usersFindMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { count: tsCount, findMany: tsFindMany },
    // 教学会话列表的「消息数」改为库内聚合（2026-09-29，不再读 197MB 的 messages 列），
    // 这里只需给聚合查询一个空结果：本文件断言的是数据隔离过滤，不涉及计数
    $queryRaw: jest.fn().mockResolvedValue([]),
    // #105 读侧接入：行级收束观测（轨道/通道）按 taskId 查 learner_evidence——
    // 本文件断言数据隔离，给空结果即可（无收束记录 → closure=null）
    learner_evidence: { findMany: jest.fn().mockResolvedValue([]) },
    milestones: { findMany: jest.fn().mockResolvedValue([]) },
    subtasks: { findMany: jest.fn().mockResolvedValue([]) },
    goal_conversations: { count: gcCount, findMany: gcFindMany },
    users: {
      count: (...args: any[]) => usersCount(...args),
      findMany: (args: any) =>
        args?.select?.isVirtualLearner === true && !args?.where
          ? Promise.resolve(mockTestAccountRows)
          : usersFindMany(args),
    },
  },
}));

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}));

jest.mock('../../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }));
jest.mock('../../../middleware/audit-context', () => ({
  setAuditAction: jest.fn(),
  setAuditBefore: jest.fn(),
  setAuditAfter: jest.fn(),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../../services/learning/goal-conversation.service', () => ({
  generateLearningPathFromConversation: jest.fn(),
}));

import platformRouter from '../platform';
import goalConversationsRouter from '../goal-conversations';
import usersRouter from '../users';

function getRouteHandler(router: any, path: string, method: string): RouteHandler {
  const layer = router.stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.[method]
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { statusCode: 200, body: undefined, status: jest.fn() };
  res.status.mockReturnValue(res);
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  return res;
}

async function run(handler: RouteHandler, req: any): Promise<any> {
  const res = createResponse();
  await handler(req, res, jest.fn());
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认给一个测试账号，保证排除式非空（口径生效可见）
  mockTestAccountRows = [
    { id: 'u-test', name: 'e2e_ms0fz3yx', email: 'e2e_ms0fz3yx@example.com', isVirtualLearner: false },
  ];
});


describe('数据隔离（A3）：教学会话列表 GET /teaching-sessions', () => {
  const sessionRow = (over: Record<string, any> = {}) => ({
    id: 'ts-1',
    userId: 'u-real',
    taskId: null,
    milestoneId: null,
    learningPathId: null,
    subject: 'Excel',
    topic: '清洗练习',
    taskType: 'practice',
    status: 'completed',
    startTime: new Date(),
    endTime: null,
    duration: 100,
    messages: '[]',
    knowledgeState: '[]',
    wrapup: null,
    advisory: null,
    users: { id: 'u-real', name: '真实', email: 'real@example.com', isVirtualLearner: false },
    ...over,
  });

  it('默认（无 includeTest）：只排除虚拟学习者，测试账号照常计入，响应带回行标记', async () => {
    const handler = getRouteHandler(platformRouter, '/teaching-sessions', 'get');
    tsCount.mockResolvedValue(1);
    tsFindMany.mockResolvedValue([sessionRow()]);
    const res = await run(handler, { query: { limit: '100' } });

    const where = tsFindMany.mock.calls[0][0].where;
    expect(where.users).toBeDefined();
    expect(where.users.isVirtualLearner).toBe(false);
    // 测试/审计账号不再被 id 排除（2026-10-21：它们是普通账号，只是行内备注）
    expect(where.users.id).toBeUndefined();
    const countWhere = tsCount.mock.calls[0][0].where;
    expect(countWhere.users.isVirtualLearner).toBe(false);

    const items = res.body.data.items;
    expect(items[0].isVirtualLearner).toBe(false);
    expect(items[0].isTestAccount).toBe(false);
  });

  it('includeTest=true：不附加用户过滤，虚拟/测试会话显式可见并带回标记', async () => {
    const handler = getRouteHandler(platformRouter, '/teaching-sessions', 'get');
    tsFindMany.mockResolvedValue([
      sessionRow({
        userId: 'virtual_1',
        users: { id: 'virtual_1', name: '虚拟', email: 'virtual_1@test.local', isVirtualLearner: true },
      }),
      sessionRow({
        userId: 'u-shot',
        users: { id: 'u-shot', name: 'shotsnap001', email: 'shotsnap001@example.com', isVirtualLearner: false },
      }),
    ]);
    const res = await run(handler, { query: { limit: '100', includeTest: 'true' } });

    expect(tsFindMany.mock.calls[0][0].where.users).toBeUndefined();
    const items = res.body.data.items;
    expect(items[0].isVirtualLearner).toBe(true);
    expect(items[0].isTestAccount).toBe(true);
    expect(items[1].isVirtualLearner).toBe(false);
    expect(items[1].isTestAccount).toBe(true);
  });
});

describe('数据隔离（A3）：目标对话列表 GET /goal-conversations', () => {
  const convRow = (over: Record<string, any> = {}) => ({
    id: 'gc-1',
    userId: 'u-real',
    status: 'active',
    stage: 'understanding',
    description: '目标',
    collectedData: '{}',
    createdAt: new Date(),
    users: { id: 'u-real', name: '真实', email: 'real@example.com', isVirtualLearner: false },
    ...over,
  });

  it('默认（无 includeTest）：只排除虚拟学习者（软删也排除）', async () => {
    const handler = getRouteHandler(goalConversationsRouter, '/', 'get');
    gcFindMany.mockResolvedValue([convRow()]);
    await run(handler, { query: {} });

    const where = gcFindMany.mock.calls[0][0].where;
    expect(where.users).toBeDefined();
    expect(where.users.isVirtualLearner).toBe(false);
    expect(where.users.deletedAt).toBeNull();
    expect(where.users.id).toBeUndefined();
    expect(gcCount.mock.calls[0][0].where.users).toBeDefined();
  });

  it('includeTest=true：不过滤，虚拟对话显式可见并带回标记', async () => {
    const handler = getRouteHandler(goalConversationsRouter, '/', 'get');
    gcFindMany.mockResolvedValue([
      convRow({
        userId: 'virtual_1',
        users: { id: 'virtual_1', name: '虚拟', email: 'virtual_1@test.local', isVirtualLearner: true },
      }),
    ]);
    const res = await run(handler, { query: { includeTest: 'true' } });

    expect(gcFindMany.mock.calls[0][0].where.users).toBeUndefined();
    const conv = res.body.data.conversations[0];
    expect(conv.isVirtualLearner).toBe(true);
    expect(conv.isTestAccount).toBe(true);
  });
});

describe('数据隔离（A3）：用户列表 GET /users', () => {
  const userRow = (over: Record<string, any> = {}) => ({
    id: 'u-real',
    name: '真实',
    email: 'real@example.com',
    isAdmin: false,
    isVirtualLearner: false,
    xp: 0,
    currentLevel: 'L1',
    lastLoginAt: null,
    createdAt: new Date(),
    deletedAt: null,
    _count: { learning_paths: 0, teaching_sessions: 0 },
    ...over,
  });

  it('默认：列表只排除虚拟学习者；测试账号照常列出并带回 isTestAccount 备注标记', async () => {
    const handler = getRouteHandler(usersRouter, '/', 'get');
    usersFindMany.mockResolvedValue([userRow()]);
    const res = await run(handler, { query: { limit: '50' } });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.isVirtualLearner).toBe(false);
    // 不再有 id notIn（测试/审计账号是普通账号，2026-10-21 拍板）
    expect(where.id).toBeUndefined();
    expect(usersCount.mock.calls[0][0].where.isVirtualLearner).toBe(false);

    expect(res.body.data.users[0].isTestAccount).toBe(false);
  });

  it('账号页没有视角参数：includeTest 也不再放虚拟学习者进来（它归自己的域）', async () => {
    const handler = getRouteHandler(usersRouter, '/', 'get');
    usersFindMany.mockResolvedValue([userRow()]);
    await run(handler, { query: { limit: '50', includeTest: 'true' } });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.isVirtualLearner).toBe(false);
    expect(where.id).toBeUndefined();
  });

  it('status=deleted（回收站）：即使无 includeTest 也不加过滤（恢复入口需全量账号）', async () => {
    const handler = getRouteHandler(usersRouter, '/', 'get');
    usersFindMany.mockResolvedValue([userRow({ deletedAt: new Date(), name: 'qa_delete_test_x' })]);
    await run(handler, { query: { limit: '50', status: 'deleted' } });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toEqual({ not: null });
    expect(where.isVirtualLearner).toBeUndefined();
    expect(where.id).toBeUndefined();
  });
});
