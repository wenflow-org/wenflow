/**
 * VirtualLearners 筛选 ↔ URL（2026-10-13 运营走查 O2）。
 *
 * 实测缺陷：点「曾失败5」筛到 5 条，URL 仍是裸 /admin/virtual-learners —— 刷新 / 分享 /
 * 收藏都还原不了这次筛选，也发不出去。改为与 用户与学习者 / 学习状态 同一组合式单点
 * （learner-profile.ts useListQueryState，pill 哨兵随之从 '' 统一为 'all'）。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import VirtualLearners from '../VirtualLearners.vue';
import { liveVirtuals } from '../live';

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveVirtuals: ref([]),
    liveVirtualsTotal: ref(0),
    liveVirtualSessionStats: ref({ created: 0, running: 0, failed: 0, abandoned: 0, completed: 0, total: 0 }),
    liveVirtualStaleCount: ref(0),
    liveVirtualRunStats: ref({
      profileCount: 0, totalSessions: 0, created: 0, running: 0, failed: 0, abandoned: 0,
      completed: 0, completionRate: 0, failureRate: 0, staleCount: 0, maxStaleMins: 0,
      avgDurationMs: 0, reclaimThresholdMs: 0
    }),
    liveVirtualStatsLoading: ref(false),
    liveVirtualStatsError: ref(''),
    retryLiveVirtualStats: vi.fn(async () => {}),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveCreateVirtual: vi.fn(async () => 'vl-new'),
    liveDeleteVirtual: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    refreshLiveVirtuals: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    shortId: (id: string) => id.slice(0, 8),
    liveAutopilotConcurrency: ref({ used: 0, limit: 10, queued: 0 }),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return { isLive: ref(true), intent: { agentFilter: '', statusFilter: '', quickAction: '' }, openSubPage: vi.fn() };
});

vi.mock('@/api/adminApi', () => {
  const proxy = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: { data: {} } }));
      }
    });
  return {
    adminVirtualLearnersApi: proxy(),
    adminVirtualLearnerCardsApi: proxy(),
    adminVirtualLabApi: proxy(),
    clearAdminSession: vi.fn(),
    markAdminSession: vi.fn(),
    hasAdminSession: vi.fn(() => true)
  };
});

async function mountVl(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div />' } }] });
  await router.push(url);
  await router.isReady();
  const wrapper = mount(VirtualLearners, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  return { wrapper, router };
}

function pill(wrapper: ReturnType<typeof mount>, label: string) {
  const b = wrapper.findAll('button.mk-pill').find((x) => x.text().startsWith(label));
  if (!b) throw new Error(`pill not found: ${label}`);
  return b;
}

describe('VirtualLearners · 筛选 ↔ URL', () => {
  /* 2026-10-24 修正：容量治理（并发上限 / VL 专属 RPM / 日期模拟）2026-10-21 已迁到
     「模型与接入 · 虚拟学习者」页签；旧深链 tab=routing 会落到调用策略/调用健康，目标控件不在屏上。 */
  it('并发 / 速率 KPI 点击 → 跳「模型与接入 · 虚拟学习者」页签', async () => {
    const { wrapper, router } = await mountVl('/admin/virtual-learners');
    const kpi = (label: string) => wrapper.findAll('.mk-kpi').find((k) => k.find('.mk-kpi__label').text().trim() === label)!;
    await kpi('并发').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/api-config');
    expect(router.currentRoute.value.query.tab).toBe('virtual');
    wrapper.unmount();
  });

  it('深链 ?pill=stalled 落位：该 pill 高亮（刷新 / 收藏还原）', async () => {
    const { wrapper } = await mountVl('/admin/virtual-learners?pill=stalled');
    expect(pill(wrapper, '停滞').classes()).toContain('mk-pill--active');
    expect(pill(wrapper, '全部').classes()).not.toContain('mk-pill--active');
    wrapper.unmount();
  });

  it('异常列「只看有异常」：本地开关，不占用 pill，筛掉没有失败/无响应的行', async () => {
    // 空列表会走 MkEmptyState（无表格），先铺两行：一行有异常、一行干净
    const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
      id, name, goal: 'g', storyCount: 1, pathCount: 0, sessions: 1,
      runningCount: 0, pausedCount: 0, failedCount: 0, abandonedCount: 0, stalledCount: 0,
      runningSessionIds: [], currentStage: null, stageProgress: null,
      createdAt: '2026-10-01T00:00:00Z', ...extra
    });
    (liveVirtuals as { value: unknown[] }).value = [row('a', '有异常', { failedCount: 2 }), row('b', '干净的')];
    const { wrapper, router } = await mountVl('/admin/virtual-learners');
    const filter = wrapper.find('.vl-th-filter');
    expect(filter.exists()).toBe(true);
    expect(filter.attributes('aria-pressed')).toBe('false');
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    await filter.trigger('click');
    await flushPromises();
    expect(wrapper.find('.vl-th-filter').classes()).toContain('vl-th-filter--on');
    expect(wrapper.find('.vl-th-filter').attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.text()).toContain('有异常');
    expect(wrapper.text()).not.toContain('干净的');
    // 不是 pill：URL 不写筛选，刷新后回到「全部」
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    wrapper.unmount();
    (liveVirtuals as { value: unknown[] }).value = [];
  });

  it('点回「全部」→ URL 删掉 pill（缺省值不留在地址栏）', async () => {
    const { wrapper, router } = await mountVl('/admin/virtual-learners?pill=stalled');
    await pill(wrapper, '全部').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    wrapper.unmount();
  });

  it('搜索词也进 URL（q），刷新 / 返回不丢', async () => {
    const { wrapper, router } = await mountVl('/admin/virtual-learners');
    const input = wrapper.find('input[placeholder*="搜索名称"]');
    await input.setValue('备考');
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe('备考');
    wrapper.unmount();
  });
})

describe('VirtualLearners · KPI 三态（2026-10-14 KPI 审计：失败不得伪装成健康）', () => {
  it('列表拉取失败时「并发」显不可用 + bad 调，不把初值画成 0/10 的 ok 绿', async () => {
    // 并发数由**列表** GET 写入（live.ts:1642），列表失败时它保持初值 {used:0,limit:10}；
    // 若该卡不判三态，就会渲染成「0/10」+ ok 绿调 = 假健康。statsState 已并入
    // liveFailures.virtuals 正是为这一类兜底，本用例锁住「卡确实接上了它」。
    const live = await import('../live');
    (live.liveFailures as { value: Record<string, string> }).value = { virtuals: 'boom' };
    const { wrapper } = await mountVl('/admin/virtual-learners');
    const kpi = wrapper.findAll('.mk-kpi').find((k) => k.text().includes('并发'));
    expect(kpi, '并发 KPI 未渲染').toBeTruthy();
    expect(kpi!.text()).toContain('不可用');
    expect(kpi!.text()).not.toContain('0/10');
    expect(kpi!.classes()).toContain('mk-kpi--bad');
    (live.liveFailures as { value: Record<string, string> }).value = {};
    wrapper.unmount();
  });
});
