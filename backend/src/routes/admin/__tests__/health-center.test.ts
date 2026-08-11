/**
 * 健康中心路由测试（GET /、POST /fix）
 * service 层 mock（结构/分支已在 health-center.service.test.ts 覆盖）。
 */

const mockGetReport = jest.fn();
const mockRunFix = jest.fn();

jest.mock('../../../services/health-center.service', () => ({
  getHealthCenterReport: (...args: unknown[]) => mockGetReport(...args),
  runHealthCenterFix: (...args: unknown[]) => mockRunFix(...args),
}));

import router from '../health-center';

function getRouteHandler(path: string, method: 'get' | 'post') {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('admin health-center routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET / 返回统一清单（默认走缓存；?refresh=1 强制重算）', async () => {
    const report = { generatedAt: 'x', summary: { total: 9, ok: 9, warn: 0, error: 0, fixable: 0, autoFixed: 0 }, items: [] };
    mockGetReport.mockResolvedValue(report);

    const handler = getRouteHandler('/', 'get');
    const res = createResponse();
    await handler({ query: {} }, res);
    expect(mockGetReport).toHaveBeenCalledWith(expect.anything(), { skipCache: false });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: report });

    await handler({ query: { refresh: '1' } }, res);
    expect(mockGetReport).toHaveBeenLastCalledWith(expect.anything(), { skipCache: true });
  });

  it('GET / 失败 → 500', async () => {
    mockGetReport.mockRejectedValue(new Error('boom'));
    const handler = getRouteHandler('/', 'get');
    const res = createResponse();
    await handler({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /fix 缺 id → 400', async () => {
    const handler = getRouteHandler('/fix', 'post');
    const res = createResponse();
    await handler({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRunFix).not.toHaveBeenCalled();
  });

  it('POST /fix manual 类 → 409 + 指引', async () => {
    mockRunFix.mockResolvedValue({ ok: false, id: 'w1-active', status: 409, error: 'w1-active 属人工决策类', fixHint: '指引' });
    const handler = getRouteHandler('/fix', 'post');
    const res = createResponse();
    await handler({ body: { id: 'w1-active' }, user: { userId: 'admin-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { message: 'w1-active 属人工决策类', fixHint: '指引' } });
    expect(mockRunFix).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1-active', actorId: 'admin-1' }));
  });

  it('POST /fix fixable → 200 + 修复结果', async () => {
    mockRunFix.mockResolvedValue({ ok: true, id: 'w4-corehash', fixed: true, backupDir: 'prompts/backups/health-fix/t', gitCommitHint: '需 git 提交', before: {}, after: {} });
    const handler = getRouteHandler('/fix', 'post');
    const res = createResponse();
    await handler({ body: { id: 'w4-corehash' }, user: { userId: 'admin-1' } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ id: 'w4-corehash', fixed: true }) });
  });

  it('POST /fix 执行异常 → 500', async () => {
    mockRunFix.mockRejectedValue(new Error('fix boom'));
    const handler = getRouteHandler('/fix', 'post');
    const res = createResponse();
    await handler({ body: { id: 'w4-corehash' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
