// admin-audit.middleware 单元测试：写库、黑名单、失败记录、脱敏、增强层合并
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    admin_audit_logs: { create: jest.fn() }
  }
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import prisma from '../../config/database';
import { adminAuditMiddleware } from '../../middleware/admin-audit.middleware';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../../middleware/audit-context';

const create = prisma.admin_audit_logs.create as jest.Mock;

function createRequest(overrides: Record<string, unknown> = {}): any {
  return {
    method: 'POST',
    baseUrl: '/api/admin/users',
    path: '/',
    originalUrl: '/api/admin/users/',
    body: {},
    headers: { 'user-agent': 'jest-agent' },
    ip: '127.0.0.1',
    params: {},
    user: { userId: 'admin-1', email: 'admin@example.com', isAdmin: true, sessionType: 'admin' },
    ...overrides
  };
}

function createResponse(statusCode = 200) {
  const listeners: Record<string, () => void> = {};
  const res: any = {
    locals: {},
    statusCode,
    on(event: string, cb: () => void) {
      listeners[event] = cb;
      return res;
    },
    emit(event: string) {
      listeners[event]?.();
    }
  };
  return res;
}

describe('adminAuditMiddleware', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('响应 finish 时异步写入一条操作审计记录', () => {
    const req = createRequest({ body: { email: 'a@b.com', name: 'alice' } });
    const res = createResponse();
    adminAuditMiddleware(req, res, jest.fn());
    res.emit('finish');

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      adminId: 'admin-1',
      adminName: 'admin@example.com',
      action: 'user-create',
      targetType: 'user',
      targetId: null,
      method: 'POST',
      path: '/api/admin/users/',
      statusCode: 200,
      success: true,
      ip: '127.0.0.1',
      userAgent: 'jest-agent',
      beforeJson: null,
      afterJson: null,
      requestJson: JSON.stringify({ email: 'a@b.com', name: 'alice' })
    });
    expect(data.durationMs).toEqual(expect.any(Number));
  });

  it('query 的 token/key/secret 参数与 body 密码字段脱敏', () => {
    const req = createRequest({
      method: 'GET',
      baseUrl: '/api/admin/users',
      path: '/u1',
      originalUrl: '/api/admin/users/u1?token=abc123&page=2',
      params: { id: 'u1' },
      body: { password: 'hunter2', name: 'alice' }
    });
    const res = createResponse();
    adminAuditMiddleware(req, res, jest.fn());
    res.emit('finish');

    const data = create.mock.calls[0][0].data;
    expect(data.path).toBe('/api/admin/users/u1?token=***&page=2');
    expect(data.targetId).toBe('u1');
    expect(JSON.parse(data.requestJson)).toEqual({ password: '[REDACTED]', name: 'alice' });
  });

  it('高频执行路由成功时跳过落库，失败时才记录', () => {
    const stepReq = createRequest({
      method: 'POST',
      baseUrl: '/api/admin/virtual-learners',
      path: '/sessions/s1/step',
      originalUrl: '/api/admin/virtual-learners/sessions/s1/step'
    });

    const okRes = createResponse(200);
    adminAuditMiddleware(stepReq, okRes, jest.fn());
    okRes.emit('finish');
    expect(create).not.toHaveBeenCalled();

    const failedRes = createResponse(500);
    adminAuditMiddleware(stepReq, failedRes, jest.fn());
    failedRes.emit('finish');
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.success).toBe(false);
    expect(data.statusCode).toBe(500);
  });

  it('quick-learn runs 系列同样只记录失败', () => {
    const runsReq = createRequest({
      method: 'POST',
      baseUrl: '/api/admin/virtual-quick-learn',
      path: '/p1/quick-learn/runs',
      originalUrl: '/api/admin/virtual-quick-learn/p1/quick-learn/runs'
    });

    const okRes = createResponse(200);
    adminAuditMiddleware(runsReq, okRes, jest.fn());
    okRes.emit('finish');
    expect(create).not.toHaveBeenCalled();

    const failedRes = createResponse(429);
    adminAuditMiddleware(runsReq, failedRes, jest.fn());
    failedRes.emit('finish');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.success).toBe(false);
  });

  it('未知路径回退为 method + path 原文', () => {
    const req = createRequest({
      method: 'GET',
      baseUrl: '/api/admin/platform',
      path: '/stats',
      originalUrl: '/api/admin/platform/stats'
    });
    const res = createResponse();
    adminAuditMiddleware(req, res, jest.fn());
    res.emit('finish');

    const data = create.mock.calls[0][0].data;
    expect(data.action).toBe('GET /api/admin/platform/stats');
    expect(data.targetType).toBeNull();
  });

  it('res.locals.audit 增强信息合并进同一条记录', () => {
    const req = createRequest({
      method: 'PATCH',
      baseUrl: '/api/admin/users',
      path: '/u1/role',
      originalUrl: '/api/admin/users/u1/role',
      params: { id: 'u1' }
    });
    const res = createResponse();
    adminAuditMiddleware(req, res, jest.fn());
    setAuditAction(res, 'user-role-change', { targetType: 'user', targetId: 'u1' });
    setAuditBefore(res, { id: 'u1', role: 'user', isAdmin: false });
    setAuditAfter(res, { id: 'u1', role: 'admin', isAdmin: true });
    res.emit('finish');

    const data = create.mock.calls[0][0].data;
    expect(data.action).toBe('user-role-change');
    expect(data.targetType).toBe('user');
    expect(data.targetId).toBe('u1');
    expect(data.beforeJson).toBe(JSON.stringify({ id: 'u1', role: 'user', isAdmin: false }));
    expect(data.afterJson).toBe(JSON.stringify({ id: 'u1', role: 'admin', isAdmin: true }));
  });

  it('审计写库失败仅告警，不影响主流程', () => {
    create.mockRejectedValueOnce(new Error('db down'));
    const req = createRequest();
    const res = createResponse();
    adminAuditMiddleware(req, res, jest.fn());
    expect(() => res.emit('finish')).not.toThrow();

    return Promise.resolve().then(() => {
      // fire-and-forget 的 rejection 已被 catch 吞掉（无未处理拒绝即通过）
    });
  });
});
