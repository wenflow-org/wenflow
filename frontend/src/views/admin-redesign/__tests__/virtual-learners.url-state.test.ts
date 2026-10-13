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
  it('深链 ?pill=paused 落位：该 pill 高亮（刷新 / 收藏还原）', async () => {
    const { wrapper } = await mountVl('/admin/virtual-learners?pill=paused');
    expect(pill(wrapper, '已暂停').classes()).toContain('mk-pill--active');
    expect(pill(wrapper, '全部').classes()).not.toContain('mk-pill--active');
    wrapper.unmount();
  });

  it('点「曾失败」→ URL 带上 pill=failed（可分享）', async () => {
    const { wrapper, router } = await mountVl('/admin/virtual-learners');
    await pill(wrapper, '曾失败').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.pill).toBe('failed');
    expect(pill(wrapper, '曾失败').classes()).toContain('mk-pill--active');
    wrapper.unmount();
  });

  it('点回「全部」→ URL 删掉 pill（缺省值不留在地址栏）', async () => {
    const { wrapper, router } = await mountVl('/admin/virtual-learners?pill=failed');
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
});
