// P2 管理员会话校验测试：admin_sessions 查表 + 403 吊销语义 + fail-open + legacy 放行 + lastSeen 节流
import { adminMiddleware } from '../admin.middleware';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findFirst: jest.fn() },
    admin_sessions: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn() }
}));

import prisma from '../../config/database';
import { logger } from '../../utils/logger';

const usersFindFirst = prisma.users.findFirst as jest.Mock;
const sessionsFindUnique = prisma.admin_sessions.findUnique as jest.Mock;
const sessionsUpdate = prisma.admin_sessions.update as jest.Mock;
const loggerWarn = logger.warn as jest.Mock;

const JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters';
import jwt from 'jsonwebtoken';

function signAdminToken(jti?: string): string {
  const payload: Record<string, unknown> = { userId: 'admin-1', email: 'admin@example.com', isAdmin: true };
  if (jti) payload.jti = jti;
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
}

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

function adminReq(jti?: string) {
  return {
    user: { userId: 'admin-1', email: 'admin@example.com', isAdmin: true, sessionType: 'admin' },
    headers: { authorization: `Bearer ${signAdminToken(jti)}` }
  };
}

describe('adminMiddleware 会话校验（P2）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usersFindFirst.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', isAdmin: true });
    sessionsFindUnique.mockResolvedValue({
      id: 's-1',
      jti: 'jti-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });
    sessionsUpdate.mockResolvedValue({});
  });

  it('会话已吊销 → 403 会话已吊销或过期', async () => {
    sessionsFindUnique.mockResolvedValue({
      id: 's-1',
      jti: 'jti-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000)
    });
    const req: any = adminReq('jti-1');
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { message: '会话已吊销或过期' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('会话已过期 → 403 会话已吊销或过期', async () => {
    sessionsFindUnique.mockResolvedValue({
      id: 's-1',
      jti: 'jti-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000)
    });
    const req: any = adminReq('jti-1');
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('会话记录不存在（被删/伪造 jti）→ 403', async () => {
    sessionsFindUnique.mockResolvedValue(null);
    const req: any = adminReq('ghost-jti');
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('会话有效 → 放行并更新 lastSeenAt', async () => {
    const req: any = adminReq('jti-1');
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(sessionsFindUnique).toHaveBeenCalledWith({ where: { jti: 'jti-1' } });
    expect(sessionsUpdate).toHaveBeenCalledWith({
      where: { jti: 'jti-1' },
      data: { lastSeenAt: expect.any(Date) }
    });
  });

  it('lastSeenAt 60s 节流：同 jti 连续两次请求只落库一次', async () => {
    const req1: any = adminReq('jti-throttle');
    const req2: any = adminReq('jti-throttle');
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req1, res, next);
    await adminMiddleware(req2, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(sessionsUpdate).toHaveBeenCalledTimes(1);
  });

  it('legacy Token（无 jti）→ 放行且不查会话表', async () => {
    const req: any = adminReq();
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(sessionsFindUnique).not.toHaveBeenCalled();
  });

  it('查表失败（DB 错误）→ fail-open 放行并告警', async () => {
    sessionsFindUnique.mockRejectedValue(new Error('db down'));
    const req: any = adminReq('jti-1');
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('fail-open'),
      expect.any(Error)
    );
  });
});
