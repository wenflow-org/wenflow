type RouteHandler = (...args: any[]) => any;

const routes: Record<string, RouteHandler> = {};

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      get: (path: string, handler: RouteHandler) => { routes[`GET ${path}`] = handler; },
      post: (path: string, handler: RouteHandler) => { routes[`POST ${path}`] = handler; },
      use: jest.fn()
    })
  }
}));

const projectionGrantMocks = {
  create: jest.fn(),
  findFirst: jest.fn(),
  updateMany: jest.fn()
};

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    projection_access_grants: projectionGrantMocks,
    $transaction: jest.fn(async (callback: RouteHandler) => callback({
      projection_access_grants: projectionGrantMocks
    }))
  }
}));

import '../user-developer';

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    }
  };
}

describe('user developer access grants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('创建新授权前撤销该用户全部 active 授权', async () => {
    const createdAt = new Date();
    projectionGrantMocks.create.mockResolvedValue({
      id: 'grant-new',
      userId: 'user-1',
      scope: 'dashboard',
      scopeDefinition: null,
      purpose: '排查问题',
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
      useCount: 0
    });
    const req: any = {
      user: { userId: 'user-1' },
      body: { scope: 'dashboard', expiresInMinutes: 60, purpose: '排查问题' }
    };
    const res = createResponse();

    await routes['POST /access-grants'](req, res);

    expect(projectionGrantMocks.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) }
      },
      data: { revokedAt: expect.any(Date) }
    });
    expect(projectionGrantMocks.create).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('grant-new');
  });

  it('拒绝用户自授 full 范围（full 仅管理员可授予）', async () => {
    const req: any = {
      user: { userId: 'user-1' },
      body: { scope: 'full', expiresInMinutes: 60 }
    };
    const res = createResponse();

    await routes['POST /access-grants'](req, res);

    expect(projectionGrantMocks.create).not.toHaveBeenCalled();
    expect(projectionGrantMocks.updateMany).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain('full 范围仅支持管理员授予');
  });

  it('撤销授权时只撤销目标授权（此前会连带撤销该用户全部 active 授权）', async () => {
    const createdAt = new Date();
    projectionGrantMocks.findFirst.mockResolvedValue({
      id: 'grant-1',
      userId: 'user-1',
      scope: 'dashboard',
      scopeDefinition: null,
      purpose: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
      useCount: 0
    });
    const req: any = {
      user: { userId: 'user-1' },
      params: { grantId: 'grant-1' }
    };
    const res = createResponse();

    await routes['POST /access-grants/:grantId/revoke'](req, res);

    expect(projectionGrantMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'grant-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) }
      },
      data: { revokedAt: expect.any(Date) }
    });
    expect(res.body.data.status).toBe('revoked');
  });
});
