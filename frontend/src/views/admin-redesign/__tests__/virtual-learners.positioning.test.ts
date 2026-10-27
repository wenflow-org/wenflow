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
import { liveVirtuals, liveVirtualSessionStats, liveVirtualRunStats } from '../live';
import { MOCK_SCENES } from '../manifest';
import { filterOption } from './filter-controls';

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
    /* P1#19 运行统计三态导出（本页消费 live 层 loading/error/retry） */
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
  it('状态条已退役：生命周期筛选在卡头维度下拉，计数全 0（无「创建中」旧叫法）', async () => {
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    // 2026-10-04 页头状态条整体退役（教学会话同款判例）：复读的「共 N 人」随条删除
    expect(wrapper.find('.mk-status').exists()).toBe(false);
    // 2026-10-27 统一：生命周期是维度下拉，计数在 option 文案里
    const countOf = (label: string) => filterOption(wrapper as never, '状态', label).text()
    expect(countOf('运行中')).toBe('运行中（0）')
    expect(countOf('停滞')).toBe('停滞（0）')
    expect(countOf('已停止')).toBe('已停止（0）')
    expect(wrapper.find('.mk-card--fill .mk-card__head .mk-pills').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('曾失败');
    expect(wrapper.text()).not.toContain('创建中');
    wrapper.unmount();
  });

  it('活动会话按全量会话口径（running + created）进完成率卡 title（副行只留口径）', async () => {
    // 2026-10-15：与完成率卡同源（/stats，F20 口径已扣 autopilot=stopped）；不再读列表 sessionStats
    liveVirtualRunStats.value = { ...liveVirtualRunStats.value, running: 2, created: 1 };
    const wrapper = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    /* 活动会话 = running 2 + created 1 = 3：原状态条读数先迁进完成率卡 hint，2026-10-19
       用户走查「KPI hint 在报读数」后再往下沉一级——读数进 title 长释，副行留口径短语 */
    expect(wrapper.find('.mk-status').exists()).toBe(false);
    const completion = wrapper.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text().trim() === '完成率（全部会话）');
    expect(completion!.find('.mk-kpi__hint').exists()).toBe(false);
    expect(completion!.attributes('title')).toContain('活动会话 3');
    wrapper.unmount();
  });

  it('manifest 导航中仿真组收敛为两个职责页（实例 + 身份池；批量实验 2026-10-04 下线）', () => {
    const scene = MOCK_SCENES.find((s) => s.id === 'virtual-learners');
    expect(scene).toBeDefined();
    // 2026-10-26 组名与总览状态条同词（「仿真 · 仿真空闲」）
    expect(scene!.group).toBe('仿真');
    const groupIds = MOCK_SCENES.filter((s) => s.group === '仿真').map((s) => s.id);
    expect(groupIds).toEqual(['virtual-learners', 'virtual-learner-cards']);
    expect(MOCK_SCENES.find((s) => s.id === 'batch-experiments')).toBeUndefined();
  });
});
