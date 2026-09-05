/**
 * 虚拟学习者定位调整（D1）测试：
 * - 页面头部注记「仿真数据生成器」定位说明（管理面操作不面向真实用户）
 * - 虚拟会话占比注记：读 liveVirtualSessionStats.total 全量口径展示
 * - manifest 导航标签改为「虚拟学习者（仿真）」
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import VirtualLearners from '../VirtualLearners.vue';
import { liveVirtuals, liveVirtualSessionStats } from '../live';
import { MOCK_SCENES } from '../manifest';

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
      reclaimThresholdMs: 0
    }),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveCreateVirtual: vi.fn(async () => 'vl-new'),
    liveDeleteVirtual: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    /* VL 列表页使用共享 <Pagination> 页码器（依赖 live.totalPagesOf） */
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
    reclaimStaleVirtualSessions: vi.fn(async () => ({ data: {} }))
  }
}));

beforeEach(() => {
  liveVirtuals.value = [];
  liveVirtualSessionStats.value = { created: 0, running: 0, failed: 0, abandoned: 0, completed: 0, total: 0 };
});

describe('虚拟学习者定位（D1）', () => {
  it('无数据时：状态条精简 + 仿真概览显示「仿真空闲」结论（统计不渲染）', async () => {
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const bar = wrapper.find('.mk-status');
    expect(bar.exists()).toBe(true);
    // 状态条回归「标题+总量+操作」：不再含分区统计
    expect(bar.text()).toContain('共 0 人');
    expect(bar.text()).not.toContain('创建中');
    // 仿真概览只显示结论头（无数据时不渲染无意义统计）
    expect(wrapper.find('.mk-overview').exists()).toBe(true);
    expect(wrapper.text()).toContain('仿真空闲');
    expect(wrapper.find('.mk-overview__kpis').exists()).toBe(false);
    wrapper.unmount();
  });

  it('有数据时：仿真概览 KPI + 运行详情透出全量口径数值（liveVirtualSessionStats 驱动；已失败含 abandoned）', async () => {
    liveVirtualSessionStats.value = { created: 1, running: 2, failed: 3, abandoned: 1, completed: 0, total: 7 };
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const dash = wrapper.find('.mk-overview');
    expect(dash.exists()).toBe(true);
    expect(dash.text()).toContain('创建中 1');
    expect(dash.text()).toContain('运行中 2');
    expect(dash.text()).toContain('已失败 4');
    expect(dash.text()).toContain('仿真运行中');
    wrapper.unmount();
  });

  it('manifest 导航中虚拟学习者归入「学习者」组（仿真定位提示；2026-09-04 收敛单条目分组）', () => {
    const scene = MOCK_SCENES.find((s) => s.id === 'virtual-learners');
    expect(scene).toBeDefined();
    expect(scene!.group).toBe('学习者');
  });
});
