/**
 * Prompt 评估「评估历史」首屏 KPI 与列表同源（B18/F7-2 回归）。
 *
 * 缺陷：watch(..., { immediate: true }) 在 setup 中同步调用 reloadRuns()，而 RUNS_LIMIT
 * 声明在该 watch 之后 → TDZ（Cannot access 'RUNS_LIMIT' before initialization），异常被
 * reloadRuns 自身 catch 吞成 runsFailed + toast；首屏「评估历史」KPI 恒显「0 / 暂无评估记录」，
 * 切到历史页签后同一张卡才变真实条数（那时常量已初始化）。
 *
 * 本测试把「同一帧 KPI 读数 === 历史列表行数」钉住：只挂载一次、不切页签，
 * 断言 KPI 卡读数与 runs 条数同源，且 reloadRuns 真的带 RUNS_LIMIT 发起了请求。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';

const { getEvalCasesMock, getEvalRunsMock, toastErrorMock } = vi.hoisted(() => ({
  getEvalCasesMock: vi.fn(),
  getEvalRunsMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    },
  });
}

vi.mock('@/api/adminApi', () => ({
  adminPromptOpsApi: apiObject({
    getEvalCases: getEvalCasesMock,
    getEvalRuns: getEvalRunsMock,
  }),
  adminVirtualLearnersApi: apiObject(),
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject(),
  adminPromptWorkbenchApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminSkillWorkbenchApi: apiObject(),
  adminAgentPromptsApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
}));

vi.mock('@/utils/toast', () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
    info: vi.fn(),
    close: vi.fn(),
  },
}));

import PromptEvalPanel from '../PromptEvalPanel.vue';

const RUN_COUNT = 30;

function makeRuns() {
  return Array.from({ length: RUN_COUNT }, (_, i) => ({
    id: `run-${i}`,
    agentId: 'skill:goal-conversation',
    promptVersion: 3,
    promptSource: 'active',
    mode: 'eval-set',
    caseCount: 2,
    totalRuns: 2,
    summary: { passRate: 100, passedCount: 2, totalRuns: 2, repeatCount: 1 },
    durationMs: 1200,
    createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
  }));
}

async function mountPanel() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push('/admin/skills?tab=prompt-eval');
  await router.isReady();
  const wrapper = mount(PromptEvalPanel, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('Prompt 评估「评估历史」首屏 KPI 与列表同源（F7-2）', () => {
  beforeEach(() => {
    getEvalCasesMock.mockReset();
    getEvalRunsMock.mockReset();
    toastErrorMock.mockReset();
    getEvalCasesMock.mockResolvedValue({ data: { data: [] } });
    getEvalRunsMock.mockResolvedValue({ data: { data: makeRuns() } });
  });

  it('挂载即拉历史（带 RUNS_LIMIT=30），KPI 读数与历史条数同源、无 TDZ 错误', async () => {
    const wrapper = await mountPanel();

    // 首屏就发起了历史请求，且窗口上限常量可达（TDZ 会让调用根本发不出去）
    expect(getEvalRunsMock).toHaveBeenCalledTimes(1);
    expect(getEvalRunsMock).toHaveBeenCalledWith(undefined, 30);

    // 没有任何「加载历史失败」toast（TDZ 曾被 reloadRuns 自身 catch 吞成此 toast）
    expect(toastErrorMock).not.toHaveBeenCalled();

    // 同一帧里「评估历史」KPI 卡读数 === 历史条数，而不是 0
    const kpis = wrapper.findAll('.mk-kpi');
    expect(kpis.length).toBe(3);
    const historyKpi = kpis[2];
    expect(historyKpi.find('.mk-kpi__label').text()).toContain('评估历史');
    expect(historyKpi.find('.mk-kpi__num').text()).toBe(String(RUN_COUNT));
    expect(historyKpi.text()).not.toContain('暂无评估记录');

    wrapper.unmount();
  });

  it('切到「评估历史」页签后读数不变（0→30 的自愈假象消失）', async () => {
    const wrapper = await mountPanel();

    const kpiNumBefore = wrapper.findAll('.mk-kpi')[2].find('.mk-kpi__num').text();
    await wrapper.findAll('.tabs .tab')[1].trigger('click');
    await flushPromises();
    await nextTick();

    const kpiNumAfter = wrapper.findAll('.mk-kpi')[2].find('.mk-kpi__num').text();
    expect(kpiNumBefore).toBe(String(RUN_COUNT));
    expect(kpiNumAfter).toBe(String(RUN_COUNT));

    // 历史列表确实渲染出 RUN_COUNT 行
    expect(wrapper.findAll('.pe-panel table.mk-table tbody tr').length).toBe(RUN_COUNT);

    wrapper.unmount();
  });
});
