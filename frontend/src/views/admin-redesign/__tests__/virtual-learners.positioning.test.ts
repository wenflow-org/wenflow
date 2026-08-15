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
    errMsg: (e: unknown) => String(e)
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
  it('页面头部展示「仿真数据生成器」定位说明（管理面操作不面向真实用户）', async () => {
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const note = wrapper.find('.vl-position');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain('仿真数据生成器');
    expect(note.text()).toContain('跑真实学习流程');
    expect(note.text()).toContain('不面向真实用户');
    wrapper.unmount();
  });

  it('虚拟会话占比注记：展示全量虚拟会话数（liveVirtualSessionStats.total）', async () => {
    liveVirtualSessionStats.value = { created: 1, running: 2, failed: 3, abandoned: 1, completed: 0, total: 7 };
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    expect(wrapper.find('.vl-position__stats').text()).toContain('当前虚拟会话 7 个');
    wrapper.unmount();
  });

  it('manifest 导航标签已标注「仿真」，提示定位（与真实用户管理区分）', () => {
    const scene = MOCK_SCENES.find((s) => s.id === 'virtual-learners');
    expect(scene).toBeDefined();
    expect(scene!.label).toContain('仿真');
  });
});
