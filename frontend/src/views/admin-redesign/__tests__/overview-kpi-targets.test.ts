/**
 * 总览 KPI 跳转（2026-10-24 层级审计）：目标按稳定 key 匹配，不按数组下标/可变展示名。
 * - 今日成功率 → 执行日志「失败 + 今天」（卡面读今日失败，落地页同口径）
 * - 今日调用 → 执行日志「今天」
 * - 用户活跃 → 用户与学习者；目标对话 → 目标对话
 * - 页头「运营中心」入口 → ops-hub
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import Overview from '../Overview.vue';
import { liveOverviewFull } from '../live';
import { intent } from '../store';

const { apiObject } = vi.hoisted(() => ({
  apiObject: () =>
    new Proxy({} as Record<string, unknown>, {
      get: (target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('@/api/adminApi', () => ({
  adminDashboardApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminMemoryReviewApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminMemoryTracesApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject()
}));

async function mountOverview() {
  liveOverviewFull.value = null;
  const wrapper = mount(Overview);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

function kpiCard(wrapper: ReturnType<typeof mount>, label: string) {
  const el = wrapper.findAll('button.mk-kpi').find((x) => x.find('.mk-kpi__label').text() === label);
  if (!el) throw new Error(`kpi card not found: ${label}`);
  return el;
}

describe('总览 KPI 跳转目标', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intent.scene = '';
    intent.tab = '';
    intent.statusFilter = '';
    intent.timeRange = '';
    intent.agentFilter = '';
    intent.errorCategory = '';
    intent.sessionId = '';
    intent.traceId = '';
    intent.traceFocus = false;
  });

  it('四张真实口径 KPI 带稳定 key（跳转不依赖顺序/展示名）', async () => {
    await mountOverview();
    expect(liveOverviewFull.value?.kpis.map((k) => k.key)).toEqual([
      'todayCalls',
      'todaySuccessRate',
      'activeUsers',
      'goalConversations'
    ]);
  });

  it('今日成功率 → 执行日志，预筛失败 + 今天', async () => {
    const w = await mountOverview();
    await kpiCard(w, '今日成功率').trigger('click');
    expect(intent.scene).toBe('execution-logs');
    expect(intent.statusFilter).toBe('err');
    expect(intent.timeRange).toBe('today');
  });

  it('今日调用 → 执行日志，时间窗今天', async () => {
    const w = await mountOverview();
    await kpiCard(w, '今日调用').trigger('click');
    expect(intent.scene).toBe('execution-logs');
    expect(intent.statusFilter).toBe('');
    expect(intent.timeRange).toBe('today');
  });

  it('用户活跃 / 累计目标对话 → 各自域（总量卡与闭环阶段 1 同名不同量，卡名标出「累计」）', async () => {
    const w = await mountOverview();
    await kpiCard(w, '用户活跃').trigger('click');
    expect(intent.scene).toBe('people');
    await kpiCard(w, '累计目标对话').trigger('click');
    expect(intent.scene).toBe('goal-conversations');
    // 目标对话卡报的是总量：数值行标出「总量」口径，避免与闭环阶段 1 的「N 进行中」读成同一指标
    expect(kpiCard(w, '累计目标对话').find('.mk-kpi__num-note').text()).toBe('总量');
  });

  it('页头「运营中心」入口 → ops-hub', async () => {
    const w = await mountOverview();
    const btn = w.findAll('button').find((b) => b.text() === '运营中心');
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    expect(intent.scene).toBe('ops-hub');
  });
});

describe('状态条结论取最差子项（今日 0 调用不得输出「系统空闲」）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function seedTodayIdleWithTodos() {
    const base = liveOverviewFull.value!;
    liveOverviewFull.value = {
      ...base,
      headline: '系统空闲',
      kpis: base.kpis.map((k) =>
        k.key === 'todayCalls' ? { ...k, value: '0' } : k.key === 'todaySuccessRate' ? { ...k, value: '—', foot: '无失败' } : k
      ),
      usage: { ...base.usage, failed7d: 8 },
      actions: [{ text: 'goal-conversation 近 7 天失败 6 次（按最近 200 条调用统计）', link: '', tone: 'bad', agentId: 'goal-conversation' }],
    };
  }

  it('今日无调用但有待办 → 结论写待办条数与真实学习者近 7 天失败数，tone 转 bad', async () => {
    const w = await mountOverview();
    seedTodayIdleWithTodos();
    await nextTick();

    const title = w.find('.mk-status__title').text();
    expect(title).not.toContain('系统空闲');
    expect(title).toContain('1 项待处理');
    expect(title).toContain('真实学习者近 7 天失败 8 次');
    expect(w.find('.mk-status').classes()).toContain('mk-status--bad');
  });

  it('今日无调用且无待办 → 保留原结论（不把空闲伪造成告警）', async () => {
    const w = await mountOverview();
    await nextTick();
    expect(w.find('.mk-status__title').text()).toBe('系统空闲');
    expect(w.find('.mk-status').classes()).toContain('mk-status--muted');
  });
});

describe('总览：7 天只有 1 天有值时改一行读数（2026-10-26）', () => {
  function seedSparseGrowth() {
    const base = liveOverviewFull.value!;
    liveOverviewFull.value = {
      ...base,
      growth7d: [
        { date: '2026-10-20', newUsers: 0, activeUsers: 0 },
        { date: '2026-10-21', newUsers: 0, activeUsers: 0 },
        { date: '2026-10-22', newUsers: 0, activeUsers: 0 },
        { date: '2026-10-23', newUsers: 0, activeUsers: 0 },
        { date: '2026-10-24', newUsers: 0, activeUsers: 0 },
        { date: '2026-10-25', newUsers: 0, activeUsers: 3 },
        { date: '2026-10-26', newUsers: 0, activeUsers: 0 },
      ],
    };
  }

  it('只有 1 天有值 → 渲染一行读数，不画柱图', async () => {
    const w = await mountOverview();
    seedSparseGrowth();
    await nextTick();

    expect(w.find('.ov-active-line').text()).toContain('3');
    expect(w.find('.ov-active-line').text()).toContain('2026-10-25');
    expect(w.find('.ovbars').exists()).toBe(false);
  });

  it('≥2 天有值 → 仍画柱图', async () => {
    const w = await mountOverview();
    seedSparseGrowth();
    liveOverviewFull.value = {
      ...liveOverviewFull.value!,
      growth7d: liveOverviewFull.value!.growth7d.map((g) => (g.date === '2026-10-24' ? { ...g, activeUsers: 2 } : g)),
    };
    await nextTick();

    expect(w.find('.ov-active-line').exists()).toBe(false);
    expect(w.find('.ovbars').exists()).toBe(true);
  });
});

describe('总览：待办与闭环失败带目标页预筛（2026-10-26）', () => {
  async function mountWithRouter() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    });
    await router.push('/admin/overview');
    await router.isReady();
    liveOverviewFull.value = null;
    const w = mount(Overview, { global: { plugins: [router] } });
    await flushPromises();
    await nextTick();
    await flushPromises();
    return { w, router };
  }

  it('课后评估阶段卡有失败 → 带 ?wrap=eval-failed 落到教学会话', async () => {
    const { w, router } = await mountWithRouter();
    const base = liveOverviewFull.value!;
    liveOverviewFull.value = {
      ...base,
      wrapup: { ...base.wrapup, sampleSize: 1, evaluationFailed: 1 },
    };
    await nextTick();

    const evalStage = w.findAll('.loop__step').find((s) => s.text().includes('课后评估'))!;
    expect(evalStage.text()).toContain('1 失败');
    await evalStage.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/admin/teaching-sessions');
    expect(router.currentRoute.value.query.wrap).toBe('eval-failed');
  });

  it('待处理事项的「教学会话 →」带 ?wrap=degraded（降级总结可落地）', async () => {
    const { w, router } = await mountWithRouter();
    const base = liveOverviewFull.value!;
    liveOverviewFull.value = {
      ...base,
      wrapup: { ...base.wrapup, sampleSize: 5, summaryFallback: 2 },
    };
    await nextTick();

    const act = w.findAll('.todo-act').find((b) => b.text().includes('教学会话'))!;
    expect(act).toBeTruthy();
    await act.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/admin/teaching-sessions');
    expect(router.currentRoute.value.query.wrap).toBe('degraded');
  });
});
