/**
 * #97 / P-73「Admin/Projection 权限边界」——全路由 × Method 权限中间件矩阵
 *
 * 做法（静态、不起服务、不连库）：把 registerRoutes 挂到真实 express app 上，
 * 枚举 app 层 router stack 得到每个挂载点的中间件链，再递归枚举各 router 内部
 * 的 route × method，拼出「Method + 完整路径 + 链」矩阵逐条断言。
 *
 * 为什么要有这道门：`bootstrap/routers.ts` 用一份 `adminRouteMiddleware` 常量挂载
 * 34 个 admin 子路由，任何一处漏展开（写成 `app.use('/api/admin/xxx', routes)`）
 * 都会静默生成「无鉴权/admin 越权」端点，编译与功能测试都不会红。
 * 本文件末尾的「检测器自证」用合成 app 造一条漏挂链，确认矩阵真的会红。
 *
 * 已知有据豁免（非漏挂，逐条断言各自链）：
 * - `/api/admin/audit-logs`：审计查询本身不入审计，故不过 adminAuditMiddleware，其余四重照常；
 * - `/api/admin-auth`：管理员登录端点，未认证场景，只过 adminAccessRestrictMiddleware。
 */
import express from 'express';
import { registerRoutes } from '../routers';
import { acpContextMiddleware } from '../../middleware/acp-context.middleware';
import { adminAccessRestrictMiddleware } from '../../middleware/admin-access-restrict.middleware';
import { adminAuthMiddleware } from '../../middleware/auth.middleware';
import { adminMiddleware } from '../../middleware/admin.middleware';
import { adminAuditMiddleware } from '../../middleware/admin-audit.middleware';

// acpContextMiddleware 是工厂返回的匿名函数，无法用模块身份比对；包一层打标签，
// 断言「第五重是 acpContextMiddleware('admin')」而不是恰好排在最后的一个函数。
jest.mock('../../middleware/acp-context.middleware', () => {
  const actual = jest.requireActual('../../middleware/acp-context.middleware') as {
    acpContextMiddleware: (entry: string) => unknown;
  };
  return {
    ...actual,
    acpContextMiddleware: (entry: string) => {
      const fn = actual.acpContextMiddleware(entry);
      (fn as { __acpSourceEntry?: string }).__acpSourceEntry = entry;
      return fn;
    }
  };
});

interface ExpressLayerHandle {
  (...args: unknown[]): unknown;
  stack?: ExpressLayer[];
  __acpSourceEntry?: string;
}

interface ExpressLayer {
  name: string;
  handle: ExpressLayerHandle;
  regexp: RegExp & { fast_slash?: boolean };
  route?: { path: string; methods: Record<string, boolean> };
}

interface Mount {
  path: string;
  chain: ExpressLayerHandle[];
  router: ExpressLayerHandle;
}

interface MatrixEntry {
  method: string;
  path: string;
  tags: string[];
}

interface RouteAudit {
  mounts: Mount[];
  matrix: MatrixEntry[];
}

/** express Layer 不保留原始挂载字符串，从 regexp 反解（`^\/api\/admin\/x\/?(?=\/|$)` → `/api/admin/x`） */
function decodeLayerPath(layer: ExpressLayer): string {
  if (layer.regexp.fast_slash) return '';
  const source = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '');
  return source.replace(/\\\//g, '/');
}

function isRouterHandle(handle: ExpressLayerHandle): boolean {
  return Array.isArray(handle?.stack);
}

/** 从 app 层 stack 里切出「挂载点 = 前置同路径中间件链 + 末尾 router」 */
function collectMounts(app: express.Express): Mount[] {
  const stack = (app as unknown as { _router: { stack: ExpressLayer[] } })._router.stack;
  const mounts: Mount[] = [];
  stack.forEach((layer, index) => {
    if (layer.route || !isRouterHandle(layer.handle)) return;
    const chain: ExpressLayerHandle[] = [];
    for (let i = index - 1; i >= 0; i -= 1) {
      const prev = stack[i];
      if (prev.route || String(prev.regexp) !== String(layer.regexp)) break;
      chain.unshift(prev.handle);
    }
    mounts.push({ path: decodeLayerPath(layer), chain, router: layer.handle });
  });
  return mounts;
}

/** 递归枚举 router 内所有 route × method（含子 router 的嵌套挂载） */
function collectRoutes(router: ExpressLayerHandle, prefix = ''): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const routePath = layer.route.path === '/' ? '' : layer.route.path;
      for (const method of Object.keys(layer.route.methods).filter((m) => layer.route?.methods[m])) {
        routes.push({ method: method.toUpperCase(), path: `${prefix}${routePath}` || '/' });
      }
      continue;
    }
    if (isRouterHandle(layer.handle)) {
      routes.push(...collectRoutes(layer.handle, `${prefix}${decodeLayerPath(layer)}`));
    }
  }
  return routes;
}

/** 链上每个中间件的可读标签（顺带把「是否就是那个函数」的比对结果编码进标签） */
function tagMiddleware(handle: ExpressLayerHandle): string {
  if (handle === adminAccessRestrictMiddleware) return 'access-restrict';
  if (handle === adminAuthMiddleware) return 'auth';
  if (handle === adminMiddleware) return 'admin';
  if (handle === adminAuditMiddleware) return 'audit';
  const acpEntry = handle.__acpSourceEntry;
  if (acpEntry) return `acp:${acpEntry}`;
  return `unknown:${handle?.name || 'anonymous'}`;
}

const ADMIN_FULL_CHAIN = ['access-restrict', 'auth', 'admin', 'audit', 'acp:admin'];
const ADMIN_CHAIN_WITHOUT_AUDIT = ['access-restrict', 'auth', 'admin', 'acp:admin'];
const AUDIT_LOGS_PREFIX = '/api/admin/audit-logs/';

function isAdminPath(path: string): boolean {
  return path === '/api/admin' || path.startsWith('/api/admin/');
}

/** 把 app 的全部挂载点与「Method + 完整路径 + 链」矩阵静态读出来 */
function auditRoutes(app: express.Express): RouteAudit {
  const mounts = collectMounts(app);
  const matrix = mounts.flatMap((mount) =>
    collectRoutes(mount.router).map((route) => ({
      method: route.method,
      path: `${mount.path}${route.path}`.replace(/\/{2,}/g, '/'),
      tags: mount.chain.map(tagMiddleware)
    }))
  );
  return { mounts, matrix };
}

/** 未走满五重链的 admin 路由（audit-logs 的免审计豁免单独断言） */
function fullChainOffenders(matrix: MatrixEntry[]): string[] {
  return matrix
    .filter((entry) => !`${entry.path}/`.startsWith(AUDIT_LOGS_PREFIX))
    .filter((entry) => entry.tags.join(' > ') !== ADMIN_FULL_CHAIN.join(' > '))
    .map((entry) => `${entry.method} ${entry.path} → [${entry.tags.join(', ')}]`);
}

const app = express();
registerRoutes(app);
const audit = auditRoutes(app);
const adminMounts = audit.mounts.filter((mount) => isAdminPath(mount.path));
const adminMatrix = audit.matrix.filter((entry) => isAdminPath(entry.path));

describe('admin 全路由 × Method 权限中间件矩阵（#97）', () => {
  it('枚举规模非空（防空跑：router stack 形状变了必须显式红）', () => {
    // 规模打印一次：让 CI 日志能直接看出这道矩阵覆盖了多少挂载点/路由（防空跑自证）
    console.log(
      `[admin-matrix] admin 挂载点=${adminMounts.length}，路由×Method=${adminMatrix.length}`
    );
    expect(adminMounts.length).toBeGreaterThanOrEqual(30);
    expect(adminMatrix.length).toBeGreaterThanOrEqual(200);
    const methods = new Set(adminMatrix.map((entry) => entry.method));
    expect(methods.size).toBeGreaterThanOrEqual(5);
    expect(methods.has('GET')).toBe(true);
    expect(methods.has('POST')).toBe(true);
  });

  it('每个 admin 路由 × Method 都完整经过五重链（含顺序）', () => {
    expect(fullChainOffenders(adminMatrix)).toEqual([]);
  });

  it('/api/admin/audit-logs 有据豁免审计层，其余四重照常', () => {
    const entries = adminMatrix.filter((entry) => `${entry.path}/`.startsWith(AUDIT_LOGS_PREFIX));
    expect(entries.length).toBeGreaterThan(0);
    const offenders = entries
      .filter((entry) => entry.tags.join(' > ') !== ADMIN_CHAIN_WITHOUT_AUDIT.join(' > '))
      .map((entry) => `${entry.method} ${entry.path} → [${entry.tags.join(', ')}]`);
    expect(offenders).toEqual([]);
  });

  it('/api/admin-auth 登录端点只过访问限制（未认证场景，有据豁免）', () => {
    const mount = audit.mounts.find((item) => item.path === '/api/admin-auth');
    expect(mount).toBeDefined();
    expect(mount?.chain.map(tagMiddleware)).toEqual(['access-restrict']);
    expect(collectRoutes(mount?.router as ExpressLayerHandle).length).toBeGreaterThan(0);
  });

  it('admin 链不泄漏到非 admin 挂载点（不过严）', () => {
    const leaked = audit.mounts
      .filter((mount) => !isAdminPath(mount.path) && mount.path !== '/api/admin-auth')
      .flatMap((mount) =>
        mount.chain
          .map(tagMiddleware)
          .filter((tag) => /^(access-restrict|admin|audit|acp:admin)$/.test(tag))
          .map((tag) => `${mount.path} → ${tag}`)
      );
    expect(leaked).toEqual([]);
  });

  it('检测器自证：合成一条漏挂链，矩阵必须报红（负面控制）', () => {
    const okRouter = express.Router();
    okRouter.get('/ok', (_req, res) => res.end());
    const leakRouter = express.Router();
    leakRouter.post('/leak', (_req, res) => res.end());

    const synthetic = express();
    synthetic.use(
      '/api/admin/ok',
      adminAccessRestrictMiddleware,
      adminAuthMiddleware,
      adminMiddleware,
      adminAuditMiddleware,
      acpContextMiddleware('admin'),
      okRouter
    );
    // 故意漏掉整条 admin 链：这正是本矩阵要拦住的写法
    synthetic.use('/api/admin/leak', leakRouter);

    const syntheticAudit = auditRoutes(synthetic);
    const syntheticAdminMatrix = syntheticAudit.matrix.filter((entry) => isAdminPath(entry.path));

    expect(syntheticAdminMatrix.map((entry) => entry.path).sort()).toEqual([
      '/api/admin/leak/leak',
      '/api/admin/ok/ok'
    ]);
    expect(fullChainOffenders(syntheticAdminMatrix)).toEqual(['POST /api/admin/leak/leak → []']);
  });
});
