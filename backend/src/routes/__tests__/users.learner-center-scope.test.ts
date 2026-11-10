/**
 * #176-2 回归 ①：`/me/learner-center` 的 global 口径不得写出 `global:<pathId>` 悬空行。
 *
 * 病灶（修复前）：路由在无 pathId 时补一条 active 路径，但 scope 仍是 'global'，
 * 于是 projectionKey = `learner-snapshot-v1:<user>:global:<pathId>:...`。
 * 列表页读的是 `global:global` / `path:<pathId>`（listForAdmin 的 `anchored ? 'path' : 'global'`），
 * 这条行永远没人读，每次刷新还会在另一个键上双写。
 *
 * 这里用**真实** LearnerSnapshotRefreshService（只 mock 快照构建与 prisma），
 * 直接断言写出去的 projectionKey——这才是「有没有产生悬空行」的字面口径。
 */
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters';

type RouteHandler = (...args: any[]) => any;
const routes: Record<string, RouteHandler> = {};

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      get: (path: string, handler: RouteHandler) => {
        routes[`GET ${path}`] = handler;
      },
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      use: jest.fn(),
    }),
  },
}));

const learningPathsFindFirst = jest.fn();
const projectionsUpsert = jest.fn();
const projectionsFindUnique = jest.fn();

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findFirst: (...args: any[]) => learningPathsFindFirst(...args) },
    learner_projections: {
      findUnique: (...args: any[]) => projectionsFindUnique(...args),
      upsert: (...args: any[]) => projectionsUpsert(...args),
    },
  },
}));

jest.mock('../../services/learner/LearnerSnapshotService', () => ({
  learnerSnapshotService: {
    getSnapshot: jest.fn(async () => ({
      snapshotVersion: 'learner-snapshot-v1',
      scope: { mode: 'global' },
      freshness: { generatedAt: new Date().toISOString(), confidence: 0.5 },
    })),
  },
}));

import '../users';

function createResponse() {
  return {
    body: undefined as any,
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

async function callLearnerCenter(query: Record<string, unknown>) {
  const req: any = { user: { userId: 'user-1' }, query };
  const res = createResponse();
  await routes['GET /me/learner-center'](req, res, jest.fn());
  return res;
}

function writtenProjectionKeys(): string[] {
  return projectionsUpsert.mock.calls.map(([args]) => args.where.projectionKey);
}

describe('GET /me/learner-center：#176-2 快照作用域键', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    projectionsFindUnique.mockResolvedValue(null);
    projectionsUpsert.mockResolvedValue({});
  });

  it('无 pathId 但补了 active 路径：按 path 口径落键，不产生 global:<pathId> 行', async () => {
    learningPathsFindFirst.mockResolvedValue({ id: 'p-act' });

    await callLearnerCenter({});

    const keys = writtenProjectionKeys();
    expect(keys).toEqual(['learner-snapshot-v1:user-1:path:p-act:none:none']);
    expect(keys.some((key) => key.includes(':global:p-act:'))).toBe(false);
  });

  it('没有 active 路径：保持 global 口径（global:global，不是 global:<pathId>）', async () => {
    learningPathsFindFirst.mockResolvedValue(null);

    await callLearnerCenter({});

    expect(writtenProjectionKeys()).toEqual(['learner-snapshot-v1:user-1:global:global:none:none']);
  });

  it('显式 scope=teaching 不被自动补路径改写', async () => {
    learningPathsFindFirst.mockResolvedValue({ id: 'p-act' });

    await callLearnerCenter({ scope: 'teaching' });

    // teaching 分支本来就不补路径；键里 scope 段保持 teaching
    expect(learningPathsFindFirst).not.toHaveBeenCalled();
    expect(writtenProjectionKeys()).toEqual(['learner-snapshot-v1:user-1:teaching:global:none:none']);
  });
});
