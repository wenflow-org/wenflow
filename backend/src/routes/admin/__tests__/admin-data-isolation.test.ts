/**
 * 数据隔离（A3）后端测试：教学会话 / 目标对话 / 用户三个列表端点
 * - 默认「仅真实」：排除虚拟学习者与测试/审计账号（单点 utils/test-account.ts 的 REAL_USER_WHERE）
 * - includeTest=true：显式包含全量，响应带回 isVirtualLearner / isTestAccount 行标记
 * - users 已删除视图（status=deleted）不应用过滤（回收站需展示全量账号以恢复）
 */

export {}

type RouteHandler = (...args: any[]) => any

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
    milestones: { findMany: jest.fn().mockResolvedValue([]) },
    subtasks: { findMany: jest.fn().mockResolvedValue([]) },
    goal_conversations: { count: gcCount, findMany: gcFindMany },
    users: { count: usersCount, findMany: usersFindMany },
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
});

const REAL_NOT_LENGTH = 26; // email virtual_ + @test.local 结尾 + 12 前缀 email + 12 前缀 name（REAL_USER_WHERE.NOT 全长）

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

  it('默认（无 includeTest）：按 REAL_USER_WHERE 过滤用户关系，响应带回行标记', async () => {
    const handler = getRouteHandler(platformRouter, '/teaching-sessions', 'get');
    tsCount.mockResolvedValue(1);
    tsFindMany.mockResolvedValue([sessionRow()]);
    const res = await run(handler, { query: { limit: '100' } });

    const where = tsFindMany.mock.calls[0][0].where;
    expect(where.users).toBeDefined();
    expect(where.users.isVirtualLearner).toBe(false);
    expect(where.users.NOT.length).toBeGreaterThan(0);
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

  it('默认（无 includeTest）：按 STATS_USER_WHERE 过滤用户关系', async () => {
    const handler = getRouteHandler(goalConversationsRouter, '/', 'get');
    gcFindMany.mockResolvedValue([convRow()]);
    await run(handler, { query: {} });

    const where = gcFindMany.mock.calls[0][0].where;
    expect(where.users).toBeDefined();
    expect(where.users.isVirtualLearner).toBe(false);
    expect(where.users.deletedAt).toBeNull();
    expect(where.users.NOT.length).toBeGreaterThan(0);
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

  it('默认（无 includeTest）：where 含 isVirtualLearner:false 与 NOT 命名模式，响应带回 isTestAccount 标记', async () => {
    const handler = getRouteHandler(usersRouter, '/', 'get');
    usersFindMany.mockResolvedValue([userRow()]);
    const res = await run(handler, { query: { limit: '50' } });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.isVirtualLearner).toBe(false);
    expect(where.NOT.length).toBe(REAL_NOT_LENGTH);
    expect(usersCount.mock.calls[0][0].where.isVirtualLearner).toBe(false);

    expect(res.body.data.users[0].isTestAccount).toBe(false);
  });

  it('includeTest=true：不加过滤，虚拟/测试账号显式可见并带回标记', async () => {
    const handler = getRouteHandler(usersRouter, '/', 'get');
    usersFindMany.mockResolvedValue([
      userRow({ id: 'virtual_1', name: '虚拟', email: 'virtual_1@test.local', isVirtualLearner: true }),
    ]);
    const res = await run(handler, { query: { limit: '50', includeTest: 'true' } });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.isVirtualLearner).toBeUndefined();
    expect(where.NOT).toBeUndefined();
    expect(res.body.data.users[0].isVirtualLearner).toBe(true);
    expect(res.body.data.users[0].isTestAccount).toBe(true);
  });

  it('status=deleted（回收站）：即使无 includeTest 也不加过滤（恢复入口需全量账号）', async () => {
    const handler = getRouteHandler(usersRouter, '/', 'get');
    usersFindMany.mockResolvedValue([userRow({ deletedAt: new Date(), name: 'qa_delete_test_x' })]);
    await run(handler, { query: { limit: '50', status: 'deleted' } });

    const where = usersFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toEqual({ not: null });
    expect(where.isVirtualLearner).toBeUndefined();
    expect(where.NOT).toBeUndefined();
  });
});
