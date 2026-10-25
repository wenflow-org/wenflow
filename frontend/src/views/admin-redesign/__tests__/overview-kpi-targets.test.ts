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

  it('用户活跃 / 目标对话 → 各自域', async () => {
    const w = await mountOverview();
    await kpiCard(w, '用户活跃').trigger('click');
    expect(intent.scene).toBe('people');
    await kpiCard(w, '目标对话').trigger('click');
    expect(intent.scene).toBe('goal-conversations');
  });

  it('页头「运营中心」入口 → ops-hub', async () => {
    const w = await mountOverview();
    const btn = w.findAll('button').find((b) => b.text() === '运营中心');
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    expect(intent.scene).toBe('ops-hub');
  });
});
