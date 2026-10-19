/**
 * Prompt 评估「评估历史」首屏读数与列表同源（B18/F7-2 回归；2026-10-15 读数带迁宿主后改写）。
 *
 * 缺陷：watch(..., { immediate: true }) 在 setup 中同步调用 reloadRuns()，而 RUNS_LIMIT
 * 声明在该 watch 之后 → TDZ（Cannot access 'RUNS_LIMIT' before initialization），异常被
 * reloadRuns 自身 catch 吞成 runsFailed + toast；首屏「评估历史」读数恒显「0 / 暂无评估记录」，
 * 切到历史页签后同一组读数才变真实条数（那时常量已初始化）。
 *
 * 2026-10-15 用户评审：读数带原在面板内，位置不对（面板自带内层页签，带被压在页签之下）。
 * 现由 Skills 宿主在「页头之下、页签栏之上」的槽位渲染，取值经 defineExpose 的 kpiView 供出。
 * 本测试钉住两件事：① 面板首帧的 kpiView 读数即真实条数（TDZ 会让它恒 0）；
 * ② 面板自身不再渲染读数带（避免宿主 + 面板双带）。宿主侧渲染断言见 skills.header.test.ts。
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

describe('Prompt 评估「评估历史」首屏读数与列表同源（F7-2）', () => {
  beforeEach(() => {
    getEvalCasesMock.mockReset();
    getEvalRunsMock.mockReset();
    toastErrorMock.mockReset();
    getEvalCasesMock.mockResolvedValue({ data: { data: [] } });
    getEvalRunsMock.mockResolvedValue({ data: { data: makeRuns() } });
  });

  it('挂载即拉历史（带 RUNS_LIMIT=30），kpiView 读数与历史条数同源、无 TDZ 错误', async () => {
    const wrapper = await mountPanel();

    // 首屏就发起了历史请求，且窗口上限常量可达（TDZ 会让调用根本发不出去）
    expect(getEvalRunsMock).toHaveBeenCalledTimes(1);
    expect(getEvalRunsMock).toHaveBeenCalledWith(undefined, 30, undefined, undefined);

    // 没有任何「加载历史失败」toast（TDZ 曾被 reloadRuns 自身 catch 吞成此 toast）
    expect(toastErrorMock).not.toHaveBeenCalled();

    // 首帧读数即真实条数，而不是 0（0→30 的自愈假象消失）
    const kpiView = (wrapper.vm as unknown as { kpiView: { runCount: number } }).kpiView;
    expect(kpiView.runCount).toBe(RUN_COUNT);

    // 读数带已迁宿主槽位：面板自身不再渲染 .mk-kpi（否则宿主 + 面板两条带同屏）
    expect(wrapper.findAll('.mk-kpi')).toHaveLength(0);

    wrapper.unmount();
  });

  it('历史排序下推到服务端（窗口内客户端假排会漏掉窗口外记录）', async () => {
    const wrapper = await mountPanel();
    await wrapper.findAll('.tabs .tab')[1].trigger('click');
    await flushPromises();
    getEvalRunsMock.mockClear();

    const th = wrapper.findAll('.pe-panel table.mk-table thead th').find((x) => x.text().includes('耗时'));
    expect(th, '历史表缺少「耗时」排序表头').toBeTruthy();
    await th!.find('button').trigger('click');
    await flushPromises();

    expect(getEvalRunsMock).toHaveBeenLastCalledWith(undefined, 30, 'durationMs', 'desc');
    wrapper.unmount();
  });

  it('列表被排序打乱后，「最近一次评估」仍按 createdAt 取最新', async () => {
    const runs = makeRuns();
    runs[0].summary.passRate = 100;
    for (let i = 1; i < runs.length; i += 1) runs[i].summary.passRate = 50;
    // 服务端按 createdAt 升序返回：最新一条（run-0）在末行
    getEvalRunsMock.mockResolvedValue({ data: { data: [...runs].reverse() } });
    const wrapper = await mountPanel();

    const kpiView = (wrapper.vm as unknown as { kpiView: { passRateText: string } }).kpiView;
    expect(kpiView.passRateText, '读数取成了排序后的首行而非最新运行').toBe('100%');
    wrapper.unmount();
  });

  it('评估用例列排序：用例名在降序/升序间切换', async () => {
    const c = (id: string, name: string) => ({
      id, agentId: 'skill:goal-conversation', caseId: `case-${id}`, name,
      description: null, messages: [], expectations: null, enabled: true,
      createdAt: '', updatedAt: '',
    });
    getEvalCasesMock.mockResolvedValue({ data: { data: [c('1', 'B 用例'), c('2', 'A 用例')] } });
    const wrapper = await mountPanel();
    const names = () => wrapper.findAll('.pe-panel table tbody tr .mk-cell-main strong').map((x) => x.text());
    const th = wrapper.findAll('th.mk-th--sortable').find((t) => t.text().includes('用例'));
    expect(th, '用例表缺少排序表头').toBeTruthy();
    await th!.find('button').trigger('click');
    await flushPromises();
    expect(names()[0]).toBe('B 用例');
    await th!.find('button').trigger('click');
    await flushPromises();
    expect(names()[0]).toBe('A 用例');
    wrapper.unmount();
  });

  it('切到「评估历史」页签后读数不变', async () => {
    const wrapper = await mountPanel();

    const before = (wrapper.vm as unknown as { kpiView: { runCount: number } }).kpiView.runCount;
    await wrapper.findAll('.tabs .tab')[1].trigger('click');
    await flushPromises();
    await nextTick();

    const after = (wrapper.vm as unknown as { kpiView: { runCount: number } }).kpiView.runCount;
    expect(before).toBe(RUN_COUNT);
    expect(after).toBe(RUN_COUNT);

    // 历史列表确实渲染出 RUN_COUNT 行
    expect(wrapper.findAll('.pe-panel table.mk-table tbody tr').length).toBe(RUN_COUNT);

    wrapper.unmount();
  });
});
