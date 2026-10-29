/**
 * 「虚拟学习者」列表重入刷新（M-6，2026-10-29 夜审）：
 * 列表吃 AdminConsole boot() 的一次性数据，卡库派生成功后跳转过来（组件重挂载）不会重拉，
 * 新实例要手动刷新才出现，第一眼读作「创建失败」。修复 = CardDeriveDialog 落成即
 * markVirtualsMutated，本页挂载时若列表数据早于最近一次创建则单域重拉一次（无轮询）。
 * （./live 与 ./store 整体 mock，与 virtual-learners.active-runs.test.ts 同一套马具。）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import VirtualLearners from '../VirtualLearners.vue';
import { liveVirtuals, refreshLiveVirtuals, virtualsStaleAfterMutation } from '../live';
import type { VirtualLearnerRow } from '../virtualLearnersTypes';

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveVirtuals: ref([]),
    liveVirtualsTotal: ref(0),
    liveVirtualSessionStats: ref({ created: 0, running: 0, failed: 0, abandoned: 0, completed: 0, total: 0 }),
    liveVirtualStaleCount: ref(0),
    liveVirtualRunStats: ref({
      profileCount: 0,
      totalSessions: 0,
      created: 0,
      running: 0,
      failed: 0,
      abandoned: 0,
      completed: 0,
      completionRate: 0,
      failureRate: 0,
      staleCount: 0,
      maxStaleMins: 0,
      avgDurationMs: 0,
      reclaimThresholdMs: 30 * 60 * 1000
    }),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveVirtualStatsLoading: ref(false),
    liveVirtualStatsError: ref(''),
    retryLiveVirtualStats: vi.fn(async () => {}),
    liveCreateVirtual: vi.fn(async () => 'vl-new'),
    liveDeleteVirtual: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    refreshLiveVirtuals: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    shortId: (id: string) => id.slice(0, 8),
    liveAutopilotConcurrency: ref({ used: 0, limit: 10, queued: 0 }),
    virtualsStaleAfterMutation: vi.fn(() => false),
    markVirtualsMutated: vi.fn(),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    isLive: ref(true),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
    openSubPage: vi.fn()
  };
});

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    generatePersona: vi.fn(async () => ({ data: {} })),
    getVirtualLearnerStories: vi.fn(async () => ({ data: { data: { stories: [] } } })),
    startVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
    startBlackboxVirtualSession: vi.fn(async () => ({ data: { data: { id: 's' } } })),
    terminateVirtualSessions: vi.fn(async () => ({ data: {} })),
    autopilotStart: vi.fn(async () => ({ data: {} })),
    autopilotStop: vi.fn(async () => ({ data: {} })),
    reclaimStaleVirtualSessions: vi.fn(async () => ({ data: {} })),
    getVirtualLabSettings: vi.fn(async () => ({ data: { data: {} } }))
  }
}));

function baseRow(overrides: Partial<VirtualLearnerRow>): VirtualLearnerRow {
  return {
    id: 'p1',
    name: '沈舟',
    goal: '吃透分布式一致性',
    storyCount: 2,
    pathCount: 2,
    sessions: 5,
    runningCount: 0,
    pausedCount: 0,
    failedCount: 0,
    abandonedCount: 0,
    stalledCount: 0,
    runningSessionIds: [],
    pausedSessionIds: [],
    currentStage: 'learn',
    stageProgress: null,
    createdAt: '2026-10-01T00:00:00Z',
    created: '18 天前',
    tags: [],
    ...overrides
  } as VirtualLearnerRow;
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push('/admin/virtual-learners');
  await router.isReady();
  const w = mount(VirtualLearners, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe('VirtualLearners 挂载重入刷新（M-6）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveVirtuals.value = [baseRow({ id: 'p-old', name: '旧实例' })] as unknown as typeof liveVirtuals.value;
    (virtualsStaleAfterMutation as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('数据早于最近一次创建 → 挂载即单域重拉（新实例不再等手动刷新）', async () => {
    (virtualsStaleAfterMutation as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const w = await mountPage();
    expect(refreshLiveVirtuals).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it('无创建标记（数据同新鲜或更新）→ 不重拉，命中既有缓存语义', async () => {
    const w = await mountPage();
    expect(refreshLiveVirtuals).not.toHaveBeenCalled();
    w.unmount();
  });
});
