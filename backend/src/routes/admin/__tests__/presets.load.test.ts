/**
 * 平台预置端点契约（#91 / P-67「一键加载」）
 *
 * `GET /api/admin/presets` 只读总览；`POST /api/admin/presets` 幂等同步（一键加载）。
 * 本测试只锁路由层的请求/响应契约与错误映射，DB 语义在 service/seeder 层验证；
 * service 整体 mock，确保路由层不直接碰数据库（边界守卫同款约束）。
 */
// 保持本文件为模块：require-only 风格的测试若落回全局脚本作用域，
// 顶层 router 会与同目录其他测试文件的全局声明撞名（CI TS2451，本地 ts-jest 缓存会掩盖）。
export {};

const mockOverview = jest.fn();
const mockLoad = jest.fn();

jest.mock('../../../services/virtual-lab/builtin-preset-load.service', () => ({
  __esModule: true,
  getBuiltinPresetOverview: (...args: unknown[]) => mockOverview(...args),
  loadBuiltinVirtualLearners: (...args: unknown[]) => mockLoad(...args),
}));

const OVERVIEW = {
  file: 'D:/repo/virtual-learners/presets.yaml',
  fileVersion: 4,
  loaderDiagnostics: [],
  presets: [
    {
      presetKey: 'gaokao-science',
      presetVersion: 5,
      nameHint: '孙浩',
      goal: '理综提分',
      scope: 'in_scope',
      sourceType: 'study',
      goalType: 'exam_prep',
      coverageAxes: ['study', 'exam_prep'],
      fixtureMaterialCount: 0,
      state: 'not-loaded',
      instance: null,
    },
  ],
  summary: { definitions: 1, loaded: 0, missing: 1, upgradable: 0, rolledBack: 0, drifted: 0 },
};

type RouteHandler = (req: unknown, res: unknown) => unknown;
interface RouteLayer {
  route?: { path: string; methods?: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
}
interface RouterLike {
  stack: RouteLayer[];
}
interface ResponseLike {
  status: jest.Mock;
  json: jest.Mock;
}

function getRouteHandler(router: RouterLike, path: string, method: string): RouteHandler {
  const layer = router.stack.find(
    (item) => item.route?.path === path && item.route?.methods?.[method],
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse(): ResponseLike {
  const res = {} as ResponseLike;
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/**
 * 路由在 beforeAll 里按需装载（模块装载时才解析 mock factory，早于常量初始化会踩 TDZ）。
 */
let router: RouterLike;

beforeAll(() => {
  router = (require('../presets') as { default: RouterLike }).default;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/admin/presets（预置总览，只读）', () => {
  it('返回 service 总览：success + data 透传（定义条数/实例对齐状态/汇总）', async () => {
    mockOverview.mockResolvedValue(OVERVIEW);
    const handler = getRouteHandler(router, '/', 'get');
    const res = createResponse();

    await handler({}, res);

    expect(mockOverview).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.presets[0].presetKey).toBe('gaokao-science');
    expect(body.data.presets[0].state).toBe('not-loaded');
    expect(body.data.summary.missing).toBe(1);
  });

  it('service 抛错 → 500 + success:false（不把失败画成空总览）', async () => {
    mockOverview.mockRejectedValue(new Error('db down'));
    const handler = getRouteHandler(router, '/', 'get');
    const res = createResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].error).toContain('db down');
  });
});

describe('POST /api/admin/presets（一键加载，幂等同步）', () => {
  it('返回 seeder 结果 + 同步后快照：created/updated/skipped/versionAhead/errors/overview', async () => {
    mockLoad.mockResolvedValue({
      mode: 'synced',
      version: 4,
      created: ['gaokao-science'],
      updated: [],
      skipped: ['work-pm-01'],
      drifted: [],
      versionAhead: ['life-03'],
      errors: [{ presetKey: 'study-09', message: 'boom' }],
      definitionVersion: 4,
      overview: OVERVIEW,
    });
    const handler = getRouteHandler(router, '/', 'post');
    const res = createResponse();

    await handler({}, res);

    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.created).toEqual(['gaokao-science']);
    expect(body.data.versionAhead).toEqual(['life-03']);
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.overview.summary.definitions).toBe(1);
  });

  it('service 抛错 → 500 + success:false（加载失败必须显式失败，不静默成功）', async () => {
    mockLoad.mockRejectedValue(new Error('sync exploded'));
    const handler = getRouteHandler(router, '/', 'post');
    const res = createResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].error).toContain('sync exploded');
  });
});
