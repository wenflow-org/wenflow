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

  it('默认只过滤 superseded（discarded 是用户「重新开始」的真实学习，计入）', async () => {
    await callSessions({});
    const expectedWhere = { userId: 'user-1', status: { notIn: ['superseded'] } };
    expect(teachingSessionMocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(teachingSessionMocks.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('includeInternal=1 时不过滤（需要原始全量时显式开启）', async () => {
    await callSessions({ includeInternal: '1' });
    const call = teachingSessionMocks.findMany.mock.calls[0][0];
    expect(call.where.status).toBeUndefined();
  });

  it('durationMinutes 用统一口径：跨天未收束会话封顶 30 分钟（此前会出现两万分钟）', async () => {
    teachingSessionMocks.findMany.mockResolvedValue([
      { id: 's1', taskId: null, status: 'timeout', duration: null, startTime: new Date('2026-01-01T00:00:00Z'), endTime: new Date('2026-01-18T00:00:00Z'), teachingState: null },
      { id: 's2', taskId: null, status: 'completed', duration: 42, startTime: new Date('2026-01-02T00:00:00Z'), endTime: new Date('2026-01-02T05:00:00Z'), teachingState: null },
    ]);
    const res = await callSessions({});
    const items = (res.body as any).data as Array<{ id: string; durationMinutes: number }>;
    expect(items.find((i) => i.id === 's1')?.durationMinutes).toBe(30); // 17 天 → 封顶 30
    expect(items.find((i) => i.id === 's2')?.durationMinutes).toBe(42); // 有 duration 列则优先
  });
});
