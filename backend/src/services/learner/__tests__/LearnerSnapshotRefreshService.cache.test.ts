/**
 * #176-2 回归 ②/③：快照内存缓存的失效入口与容量上限。
 *
 * 病灶（修复前）：`cache` 是裸 Map + 5 分钟 TTL——没有条数上限、没有主动失效入口
 * （删除只发生在同 key 过期与列表分支顺带清理）。调用方清了画像缓存后，由旧画像
 * 算出的快照仍会在 TTL 内被返回；长跑进程里缓存条目只增不减。
 */
export {}

const projectionsFindUnique = jest.fn();
const projectionsUpsert = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learner_projections: {
      findUnique: (...args: any[]) => projectionsFindUnique(...args),
      upsert: (...args: any[]) => projectionsUpsert(...args),
    },
  },
}));

jest.mock('../LearnerSnapshotService', () => ({
  learnerSnapshotService: { getSnapshot: jest.fn() },
}));

// 用 require 而非 import：避免 import 提升导致 mock 工厂在 jest.fn() 初始化前被求值（TDZ）
const {
  learnerSnapshotRefreshService,
  LEARNER_SNAPSHOT_CACHE_MAX_ENTRIES,
} = require('../LearnerSnapshotRefreshService');
const { learnerSnapshotService } = jest.requireMock('../LearnerSnapshotService');

const snapshotFor = (userId: string) => ({
  snapshotVersion: 'learner-snapshot-v1',
  scope: { userId, mode: 'global' },
  freshness: { generatedAt: new Date().toISOString(), confidence: 0.5 },
});
const snapshotOf = learnerSnapshotService.getSnapshot as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  projectionsFindUnique.mockResolvedValue(null);
  projectionsUpsert.mockResolvedValue({});
  snapshotOf.mockImplementation(async (input: { userId: string }) => snapshotFor(input.userId));
});

describe('#176-2 invalidate(userId)：清画像缓存时同源失效快照缓存', () => {
  it('invalidate 后下一次 get 必须重算，其他用户的缓存不受影响', async () => {
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-a', scope: 'global' });
    expect(snapshotOf).toHaveBeenCalledTimes(1);

    // 命中缓存：不重算
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-a', scope: 'global' });
    expect(snapshotOf).toHaveBeenCalledTimes(1);

    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-b', scope: 'global' });
    expect(snapshotOf).toHaveBeenCalledTimes(2);

    learnerSnapshotRefreshService.invalidate('u-inv-a');

    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-a', scope: 'global' });
    expect(snapshotOf).toHaveBeenCalledTimes(3);

    // 只清指定用户：u-inv-b 仍在缓存
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-b', scope: 'global' });
    expect(snapshotOf).toHaveBeenCalledTimes(3);
  });

  it('同一用户的多个作用域键一起失效（path / teaching / global）', async () => {
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-multi', pathId: 'p1', scope: 'path' });
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-multi', pathId: 'p1', taskId: 't1', scope: 'teaching' });
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-multi', scope: 'global' });
    expect(snapshotOf).toHaveBeenCalledTimes(3);

    learnerSnapshotRefreshService.invalidate('u-inv-multi');

    await learnerSnapshotRefreshService.getLatest({ userId: 'u-inv-multi', pathId: 'p1', scope: 'path' });
    expect(snapshotOf).toHaveBeenCalledTimes(4);
  });
});

describe('#176-2 缓存条数上限（LRU）', () => {
  it('超过上限按最久未用淘汰，最近的仍在缓存', async () => {
    const total = LEARNER_SNAPSHOT_CACHE_MAX_ENTRIES + 10;
    for (let i = 0; i < total; i += 1) {
      await learnerSnapshotRefreshService.getLatest({ userId: `u-lru-${i}`, scope: 'global' });
    }
    expect((learnerSnapshotRefreshService as any).cache.size).toBe(LEARNER_SNAPSHOT_CACHE_MAX_ENTRIES);

    const callsBefore = snapshotOf.mock.calls.length;
    // 最久未用的 u-lru-0 已被淘汰 → 再取要重算
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-lru-0', scope: 'global' });
    expect(snapshotOf.mock.calls.length).toBe(callsBefore + 1);
    // 最近写入的仍在缓存 → 不重算
    await learnerSnapshotRefreshService.getLatest({ userId: `u-lru-${total - 1}`, scope: 'global' });
    expect(snapshotOf.mock.calls.length).toBe(callsBefore + 1);
  }, 60000);
});

describe('#176-2 复核：invalidate 必须管住持久化投影（只删内存键＝空转）', () => {
  /** 一行「失效前落地」的持久化投影：仍在 10 分钟窗口内，但早于 invalidate */
  const persistedRow = (snapshot: unknown, ageMs: number) => ({
    projectionKey: 'unused',
    payload: JSON.stringify(snapshot),
    lastEventId: 'evt-1',
    generatedAt: new Date(Date.now() - ageMs),
  });

  it('invalidate 后不得读回窗口内、失效前落地的持久化载荷', async () => {
    projectionsFindUnique.mockResolvedValue(persistedRow({ ...snapshotFor('u-wm-a'), marker: 'old-profile' }, 30_000));

    learnerSnapshotRefreshService.invalidate('u-wm-a');
    const got = (await learnerSnapshotRefreshService.getLatest({ userId: 'u-wm-a', scope: 'global' })) as any;

    expect(got.marker).toBeUndefined();
    expect(snapshotOf).toHaveBeenCalledTimes(1);
  });

  it('未失效时仍走持久化窗口（水位不能把缓存打穿）', async () => {
    projectionsFindUnique.mockResolvedValue(persistedRow({ ...snapshotFor('u-wm-b'), marker: 'persisted' }, 30_000));

    const got = (await learnerSnapshotRefreshService.getLatest({ userId: 'u-wm-b', scope: 'global' })) as any;

    expect(got.marker).toBe('persisted');
    expect(snapshotOf).not.toHaveBeenCalled();
  });

  it('refresh 的事件去重也不能绕过水位（画像变更不产生事件 id）', async () => {
    projectionsFindUnique.mockResolvedValue(persistedRow({ ...snapshotFor('u-wm-c'), marker: 'old-profile' }, 30_000));

    learnerSnapshotRefreshService.invalidate('u-wm-c');
    const got = (await learnerSnapshotRefreshService.refresh({
      userId: 'u-wm-c',
      scope: 'global',
      lastEventId: 'evt-1',
    })) as any;

    expect(got.marker).toBeUndefined();
    expect(snapshotOf).toHaveBeenCalledTimes(1);
  });

  it('invalidate 之后同一用户重算出的新快照可以正常复用（水位只挡失效前的）', async () => {
    projectionsFindUnique.mockResolvedValue(null);

    learnerSnapshotRefreshService.invalidate('u-wm-d');
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-wm-d', scope: 'global' });
    await learnerSnapshotRefreshService.getLatest({ userId: 'u-wm-d', scope: 'global' });

    expect(snapshotOf).toHaveBeenCalledTimes(1);
  });
});
