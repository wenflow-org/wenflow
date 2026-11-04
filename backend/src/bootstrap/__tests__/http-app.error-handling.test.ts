/**
 * 错误处理中间件契约（#215）：413 响应体不得回吐堆栈/服务器绝对路径，
 * 且请求体超限要单独映射为 413 / PAYLOAD_TOO_LARGE，而不是通用 500 / INTERNAL_ERROR。
 * 用真实 express + 临时端口（不依赖 supertest，与 readyz 测试同风格）。
 */
import express from 'express';
import { AddressInfo } from 'net';
import { registerErrorHandlers } from '../http-app';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.post('/echo', (_req, res) => res.json({ ok: true }));
  app.get('/boom', () => {
    throw new Error('boom-internal');
  });
  registerErrorHandlers(app);
  return app;
}

async function request(
  app: express.Express,
  init: { method: string; path: string; body?: string }
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${init.path}`, {
      method: init.method,
      headers: { 'content-type': 'application/json' },
      body: init.body
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('错误处理契约（#215）', () => {
  it('请求体超限 → 413 / PAYLOAD_TOO_LARGE，且响应不含 stack / 绝对路径', async () => {
    // 约 3MB 的合法 JSON，超过 2mb 上限
    const big = JSON.stringify({ data: 'x'.repeat(3 * 1024 * 1024) });
    const { status, body } = await request(buildApp(), { method: 'POST', path: '/echo', body: big });

    expect(status).toBe(413);
    expect(body.success).toBe(false);
    expect(body.error.status).toBe(413);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.stack).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('node_modules');
    expect(JSON.stringify(body)).not.toMatch(/[A-Za-z]:\\\\/);
  });

  it('未预期错误 → 500 / INTERNAL_ERROR，响应不含 stack', async () => {
    const { status, body } = await request(buildApp(), { method: 'GET', path: '/boom' });

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.stack).toBeUndefined();
    // 非生产环境仍保留可读的 message（不含堆栈）
    expect(body.error.message).toBe('boom-internal');
  });
});
