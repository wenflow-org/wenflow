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
    shortId: (id: string) => id.slice(0, 8),
    liveAutopilotConcurrency: ref({ used: 0, limit: 10, queued: 0 }),
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
  it('无数据时：状态条精简，分区筛选计数全 0（无「创建中」旧叫法）', async () => {
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const bar = wrapper.find('.mk-status');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain('共 0 人');
    // 结论区（方向 A）：可点数字即筛选，状态计数从状态条移到 .vl-kpis
    const kpis = wrapper.find('.vl-kpis');
    expect(kpis.exists()).toBe(true);
    expect(kpis.text()).toContain('运行中0');
    expect(kpis.text()).toContain('已暂停0');
    expect(kpis.text()).toContain('需关注0');
    expect(kpis.text()).not.toContain('创建中');
    wrapper.unmount();
  });

  it('有数据时：状态条活动会话按全量口径（running + created，已失败含 abandoned）', async () => {
    liveVirtualSessionStats.value = { created: 1, running: 2, failed: 3, abandoned: 1, completed: 0, total: 7 };
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const kpis = wrapper.find('.vl-kpis');
    expect(kpis.exists()).toBe(true);
    // 活动会话 = running 2 + created 1 = 3（全量口径，含卡死）
    expect(kpis.text()).toContain('活动会话3');
    wrapper.unmount();
  });

  it('manifest 导航中虚拟学习者归入「学习者」组（仿真定位提示；2026-09-04 收敛单条目分组）', () => {
    const scene = MOCK_SCENES.find((s) => s.id === 'virtual-learners');
    expect(scene).toBeDefined();
    expect(scene!.group).toBe('学习者');
  });
});
