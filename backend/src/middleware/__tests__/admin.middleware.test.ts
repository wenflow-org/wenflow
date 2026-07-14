process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters';

import jwt from 'jsonwebtoken';
import { adminMiddleware } from '../admin.middleware';

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
  const secret = process.env.JWT_SECRET as string;

  it('拒绝不带管理员声明的有效 JWT', async () => {
    const token = jwt.sign({ userId: 'user-1', email: 'user@example.com', isAdmin: false }, secret, {
      algorithm: 'HS256'
    });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { message: '需要管理员权限' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('接受带管理员声明的 HS256 JWT', async () => {
    const token = jwt.sign({ userId: 'admin-1', email: 'admin@example.com', isAdmin: true }, secret, {
      algorithm: 'HS256'
    });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = createResponse();
    const next = jest.fn();

    await adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ userId: 'admin-1', email: 'admin@example.com', isAdmin: true });
  });
});
