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
