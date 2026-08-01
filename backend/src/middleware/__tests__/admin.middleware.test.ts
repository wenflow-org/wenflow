import { adminMiddleware } from '../admin.middleware';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findUnique: jest.fn() }
  }
}));

import prisma from '../../config/database';

const findUnique = prisma.users.findUnique as jest.Mock;

function createResponse() {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return response;
}

describe('adminMiddleware', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('拒绝普通用户身份', async () => {
    const req: any = {
      user: { userId: 'user-1', email: 'user@example.com', isAdmin: false }
    };
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { message: '需要管理员权限' } });
    expect(next).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('拒绝投影视角，即使请求身份带有管理员声明', async () => {
    const req: any = {
      user: {
        userId: 'target-user',
        email: 'target-user@projection.local',
        isAdmin: true,
        projection: { active: true, targetUserId: 'target-user' }
      }
    };
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: { message: '投影视角不允许访问管理员接口' }
    });
    expect(next).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('拒绝数据库中已被降权的管理员', async () => {
    findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      isAdmin: false
    });
    const req: any = {
      user: { userId: 'admin-1', email: 'admin@example.com', isAdmin: true, sessionType: 'admin' }
    };
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { message: '管理员权限已失效' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('接受 JWT 声明和数据库状态均有效的管理员', async () => {
    findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'current-admin@example.com',
      isAdmin: true
    });
    const req: any = {
      user: { userId: 'admin-1', email: 'stale-email@example.com', isAdmin: true, sessionType: 'admin' }
    };
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: { id: true, email: true, isAdmin: true }
    });
    expect(req.user).toEqual({
      userId: 'admin-1',
      email: 'current-admin@example.com',
      isAdmin: true,
      sessionType: 'admin'
    });
  });
});
