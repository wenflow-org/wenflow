process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters';

type RouteHandler = (...args: any[]) => any;
const routes: Record<string, RouteHandler> = {};

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      get: (path: string, handler: RouteHandler) => {
        routes[`GET ${path}`] = handler;
      },
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      use: jest.fn(),
    }),
  },
}));

const teachingSessionMocks = { findMany: jest.fn(), count: jest.fn() };
const subtaskMocks = { findMany: jest.fn() };

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: teachingSessionMocks,
    subtasks: subtaskMocks,
  },
}));

jest.mock('../../services/learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: jest.fn() },
}));

import '../users';

function createResponse() {
  return {
    headers: {} as Record<string, string>,
    body: undefined as any,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

async function callSessions(query: Record<string, unknown>) {
  const req: any = { user: { userId: 'user-1' }, query };
  const res = createResponse();
  await routes['GET /me/sessions'](req, res, jest.fn());
  return res;
}

describe('GET /me/sessions（学习历史：分页 + 内部会话过滤）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teachingSessionMocks.findMany.mockResolvedValue([]);
    teachingSessionMocks.count.mockResolvedValue(0);
    subtaskMocks.findMany.mockResolvedValue([]);
  });

  it('page=2 时用 skip 偏移（此前后端忽略 page，「加载更多」永远拿回同一页）', async () => {
    await callSessions({ page: '2', limit: '30' });
    expect(teachingSessionMocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 30, take: 30 }));
  });

  it('page 缺省/非法时回到第一页（skip 0）', async () => {
    await callSessions({ limit: '30' });
    expect(teachingSessionMocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 30 }));
    teachingSessionMocks.findMany.mockClear();
    await callSessions({ page: 'abc', limit: '10' });
    expect(teachingSessionMocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
  });

  it('excludeInternal=1 时列表与总数同口径过滤 discarded/superseded', async () => {
    await callSessions({ excludeInternal: '1' });
    const expectedWhere = { userId: 'user-1', status: { notIn: ['discarded', 'superseded'] } };
    expect(teachingSessionMocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(teachingSessionMocks.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('未传 excludeInternal 时保持原口径（不加 status 过滤，兼容其它页面）', async () => {
    await callSessions({});
    const call = teachingSessionMocks.findMany.mock.calls[0][0];
    expect(call.where.status).toBeUndefined();
  });
});
