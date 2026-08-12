// login_attempts 落库测试（登录审计 P1）：
// recordLoginAttempt 双 scope、成功/失败、用户名截断、429 ACCOUNT_LOCKED 补记。
// 注意：不使用 jest.resetModules——它会重建 mock 工厂导致捕获的 jest.fn() 引用失效。
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    login_attempts: { create: jest.fn() }
  }
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import prisma from '../../config/database';
import {
  loginRateLimitMiddleware,
  recordLoginAttempt,
  resetLoginAttemptsForTests
} from '../login-rate-limit.middleware';

const create = prisma.login_attempts.create as jest.Mock;

function createResponse() {
  const res: any = {
    locals: {},
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
  return res;
}

describe('login_attempts 落库（登录审计）', () => {
  beforeEach(() => {
    create.mockReset();
    resetLoginAttemptsForTests();
  });

  it('失败登录落库（user scope）', () => {
    recordLoginAttempt('alice', '127.0.0.1', false, 'user', 'invalid_credentials');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toEqual({
      scope: 'user',
      username: 'alice',
      ip: '127.0.0.1',
      success: false,
      reason: 'invalid_credentials',
      userId: null
    });
  });

  it('成功登录落库（reason=ok）', () => {
    recordLoginAttempt('alice', '127.0.0.1', true, 'user', 'ok');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.success).toBe(true);
    expect(create.mock.calls[0][0].data.reason).toBe('ok');
  });

  it('不传 reason 时默认 null', () => {
    recordLoginAttempt('alice', '127.0.0.1', false);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.reason).toBeNull();
  });

  it('admin scope 独立标记', () => {
    recordLoginAttempt('root', '10.0.0.1', false, 'admin');

    expect(create.mock.calls[0][0].data).toMatchObject({
      scope: 'admin',
      username: 'root',
      success: false
    });
  });

  it('用户名写入前截断为 64 字符', () => {
    recordLoginAttempt('x'.repeat(200), '127.0.0.1', false);

    expect(create.mock.calls[0][0].data.username).toBe('x'.repeat(64));
  });

  it('429 ACCOUNT_LOCKED 分支补记 success=false / reason=ACCOUNT_LOCKED', () => {
    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt('locked-user', '127.0.0.1', false);
    }
    create.mockClear();

    const req: any = { body: { name: 'locked-user' }, ip: '127.0.0.1', headers: {} };
    const res = createResponse();
    loginRateLimitMiddleware(req, res, jest.fn());

    expect(res.statusCode).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      scope: 'user',
      username: 'locked-user',
      success: false,
      reason: 'ACCOUNT_LOCKED'
    });
  });
});
