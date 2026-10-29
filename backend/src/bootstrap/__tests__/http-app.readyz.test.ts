/**
 * /readyz 生命周期门控集成测试（#143）：端口先于初始化绑定后，readyz 必须按 lifecycle
 * 状态报未就绪——starting → 503（且不做 DB 巡检）、ready → 巡检结果、draining → 503。
 * 用真实 express + 临时端口（无 supertest 依赖）。
 */
import { AddressInfo } from 'net';
import { createHttpApp } from '../http-app';
import { ApplicationLifecycle } from '../../services/application-lifecycle.service';
import type { ReadinessService, ReadinessResult } from '../../services/readiness.service';

const ALL_OK: ReadinessResult = {
  ready: true,
  checks: {
    mainDatabase: 'ok',
    systemDatabase: 'ok',
    corePrompts: 'ok',
    aiConfiguration: 'ok',
    fieldRouting: 'ok',
    gatewayRegistry: 'ok'
  }
};

function buildApp(lifecycle: ApplicationLifecycle, check: jest.Mock) {
  return createHttpApp({ lifecycle, readinessService: { check } as unknown as ReadinessService });
}

/** /readyz 响应体（只声明断言用到的字段；多余字段由 toMatchObject 容忍） */
interface ReadyzResponseBody {
  status?: string;
  reason?: string;
  checks?: ReadinessResult['checks'];
}

async function requestReadyz(app: ReturnType<typeof createHttpApp>): Promise<{ status: number; body: ReadyzResponseBody }> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    return { status: response.status, body: (await response.json()) as ReadyzResponseBody };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('/readyz 生命周期门控（#143）', () => {
  it('starting（markReady 之前）→ 503 reason=starting，且不做 DB 巡检', async () => {
    const lifecycle = new ApplicationLifecycle();
    const check = jest.fn().mockResolvedValue(ALL_OK);
    const result = await requestReadyz(buildApp(lifecycle, check));

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: 'not_ready', reason: 'starting' });
    expect(check).not.toHaveBeenCalled();
  });

  it('ready + 巡检通过 → 200 ready，带回 checks', async () => {
    const lifecycle = new ApplicationLifecycle();
    lifecycle.markReady();
    const check = jest.fn().mockResolvedValue(ALL_OK);
    const result = await requestReadyz(buildApp(lifecycle, check));

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ready');
    expect(result.body.checks).toEqual(ALL_OK.checks);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('ready 但 DB 巡检不过 → 503 not_ready，checks 原样透出', async () => {
    const lifecycle = new ApplicationLifecycle();
    lifecycle.markReady();
    const degraded: ReadinessResult = { ready: false, checks: { ...ALL_OK.checks, mainDatabase: 'failed' } };
    const check = jest.fn().mockResolvedValue(degraded);
    const result = await requestReadyz(buildApp(lifecycle, check));

    expect(result.status).toBe(503);
    expect(result.body.status).toBe('not_ready');
    expect(result.body.checks.mainDatabase).toBe('failed');
  });

  it('draining → 503 reason=draining，不做 DB 巡检', async () => {
    const lifecycle = new ApplicationLifecycle();
    lifecycle.markReady();
    const check = jest.fn().mockResolvedValue(ALL_OK);
    const app = buildApp(lifecycle, check);

    await lifecycle.shutdown('test', { httpServer: null, stopSchedulers: () => undefined, databases: [] });

    const result = await requestReadyz(app);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: 'not_ready', reason: 'draining' });
    expect(check).not.toHaveBeenCalled();
  });
});
