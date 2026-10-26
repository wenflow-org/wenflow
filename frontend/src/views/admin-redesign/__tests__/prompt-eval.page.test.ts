/**
 * Prompt 评估独立页（2026-10-25 用户「拆成单页，把这个 tab 撤掉，放到组里」）。
 *
 * 2026-10-04 该页曾折入 skills 宿主页签，本次拆回独立场景并归入侧栏 Skill 组。
 * 本测试钉住拆页后宿主侧的四件事：
 *  ① 页头只有页名/副文 + 「批量跑评估」一个动作（面板经 defineExpose 驱动，running 时禁用）
 *  ② 读数带由宿主渲染在面板之上，取值经面板 kpiView 供出（面板自身不再渲染，避免双带）
 *  ③ 旧页内键 ?tab=cases|runs 在地址栏就地收敛为 ?peTab=，宿主键 ?tab= 不保留
 *  ④ 页面不再有「Skill 运行 / Prompt 评估」这类一级页签
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import PromptEval from '../PromptEval.vue';

const { getEvalCasesMock, getEvalRunsMock } = vi.hoisted(() => ({
  getEvalCasesMock: vi.fn(),
  getEvalRunsMock: vi.fn(),
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
  adminAchievementsApi: apiObject(),
  adminLearningContentApi: apiObject(),
  adminDevtoolsApi: apiObject(),
  adminApi: apiObject(),
  adminAxios: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} })),
}));

function makeRuns(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `run-${i}`,
    agentId: 'skill:goal-conversation',
    promptVersion: 1,
    promptSource: 'active',
    mode: 'eval-set',
    caseCount: 2,
    totalRuns: 2,
    summary: { passRate: 100, passedCount: 2, totalRuns: 2, repeatCount: 1 },
    durationMs: 900,
    createdAt: new Date().toISOString(),
  }));
}

async function mountPage(path = '/admin/prompt-eval') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(PromptEval, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  // 面板是 defineAsyncComponent：异步分片解析完成后才有内层页签与 kpiView。
  // 与 skills.header 同因给足预算（并行跑时解析排队 >1s），不是掩盖产品竞态。
  await vi.waitFor(() => {
    expect(wrapper.find('.pe').exists()).toBe(true);
  }, { timeout: 10000 });
  return { wrapper, router };
}

describe('Prompt 评估独立页（拆页后的宿主契约）', () => {
  beforeEach(() => {
    getEvalCasesMock.mockReset();
    getEvalRunsMock.mockReset();
    getEvalCasesMock.mockResolvedValue({
      data: {
        data: [
          { id: 'c1', name: '用例一', agentId: 'skill:goal-conversation', enabled: true, messages: [] },
          { id: 'c2', name: '用例二', agentId: 'skill:goal-conversation', enabled: false, messages: [] },
        ],
      },
    });
    getEvalRunsMock.mockResolvedValue({ data: { data: makeRuns(3) } });
  });

  it('页头：页名 + 唯一动作（有启用用例时为「批量跑评估」），不再有一级视图页签', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find('.mk-pagehead__title').text()).toBe('Prompt 评估');
    // 页头副文已删（2026-10-26 评审：复述页名 + 两个页签名）
    expect(wrapper.find('.mk-pagehead__sub').exists()).toBe(false);
    const actions = wrapper.findAll('.mk-pagehead__actions button').map((b) => b.text());
    expect(actions).toEqual(['批量跑评估']);
    // 一级页签（Skill 运行 / Prompt 评估）随拆页撤除；面板内层「评估用例/评估历史」仍在
    expect(wrapper.findAll('.skills-tabs .tab')).toHaveLength(0);
    const innerTabs = wrapper.findAll('.tabs .tab').map((t) => t.text());
    expect(innerTabs).toEqual(['评估用例', '评估历史']);
    wrapper.unmount();
  });

  it('无启用用例时页头主操作变成「新建用例」（不再是一颗点不动的灰按钮）', async () => {
    getEvalCasesMock.mockResolvedValue({
      data: { data: [{ id: 'c1', name: '停用用例', agentId: 'skill:goal-conversation', enabled: false, messages: [] }] },
    });
    const { wrapper } = await mountPage();
    await vi.waitFor(() => {
      const actions = wrapper.findAll('.mk-pagehead__actions button');
      expect(actions.map((b) => b.text())).toEqual(['新建用例']);
      expect(actions[0].attributes('disabled')).toBeUndefined();
    });
    await wrapper.find('.mk-pagehead__actions button').trigger('click');
    await flushPromises();
    // 与空态中央同一弹窗（Teleport 到 body）
    expect(document.body.querySelector('[role="dialog"][aria-label="编辑评估用例"]')).toBeTruthy();
    wrapper.unmount();
  });

  it('读数带收成一张：通过率 + 用例分母（valueNote）', async () => {
    const { wrapper } = await mountPage();
    await vi.waitFor(() => {
      const labels = wrapper.findAll('.mk-kpi-grid .mk-kpi__label').map((el) => el.text().trim());
      expect(labels).toEqual(['最近评测通过率']);
    });
    await vi.waitFor(() => {
      expect(wrapper.find('.mk-kpi-grid .mk-kpi__num').text()).toContain('100%');
      expect(wrapper.find('.mk-kpi-grid .mk-kpi__num-note').text()).toBe('用例 2 · 启用 1');
    });
    // 带在页头之下、面板之上：首个 .mk-kpi-grid 出现在 .pe 卡片之前
    const html = wrapper.html();
    expect(html.indexOf('mk-kpi-grid')).toBeLessThan(html.indexOf('class="mk-card mk-card--fill pe"'));
    wrapper.unmount();
  });

  it('旧页内键 ?tab=cases|runs 就地收敛为 ?peTab=，宿主键不保留', async () => {
    const { wrapper, router } = await mountPage('/admin/prompt-eval?tab=runs');
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query.peTab).toBe('runs');
    });
    expect(router.currentRoute.value.path).toBe('/admin/prompt-eval');
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    // 内层页签跟着落到「评估历史」
    await vi.waitFor(() => {
      const selected = wrapper.findAll('.tabs .tab').find((t) => t.attributes('aria-selected') === 'true');
      expect(selected?.text()).toBe('评估历史');
    });
    wrapper.unmount();
  });

  it('非 cases/runs 的 ?tab= 不动地址栏（不是旧键，不猜语义）', async () => {
    const { wrapper, router } = await mountPage('/admin/prompt-eval?tab=whatever');
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe('whatever');
    expect(router.currentRoute.value.query.peTab).toBeUndefined();
    wrapper.unmount();
  });
});
