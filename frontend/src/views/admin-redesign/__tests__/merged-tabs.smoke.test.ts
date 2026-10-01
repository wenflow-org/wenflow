/**
 * 合并宿主页冒烟（2026-09-04 导航收敛）：
 * - People（用户与学习者：账号/学习状态 tab + ?tab= 深链 + intent quickAction 新建用户直达）
 * - Sessions（学习会话：教学会话/目标对话/学习路径 tab + ?tab= 深链）
 * - OpsHub（通知与公告：公告/站内通知 tab + ?tab= 深链；2026-09-19 由已下线的 Messages 宿主承接）
 * - ExecLogs（执行日志）+ TokenCost（成本分析，2026-09-29 拆回独立页 token-cost）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import People from '../People.vue';
import GoalConversations from '../GoalConversations.vue';
import OpsHub from '../OpsHub.vue';
import ExecLogs from '../ExecLogs.vue';
import Users from '../Users.vue';
import LearnerCenter from '../LearnerCenter.vue';
import TeachingSessions from '../TeachingSessions.vue';
import OpsContent from '../OpsContent.vue';
import Announcements from '../Announcements.vue';
import Notifications from '../Notifications.vue';
import TokenCost from '../TokenCost.vue';
import { intent } from '../store';

/** API 层整体 mock：任意方法返回 { data: {} }（空数据成功响应），函数型导出为 noop/成功 */
const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminNotificationsApi: apiObject(),
  // TokenCost 渲染需要 totals 结构（状态条色调推导 + 非空才渲染 KPI 栅格），mock 真实载荷
  adminTokenCostApi: {
    getSummary: vi.fn(async () => ({ data: { data: { days: 7, includeTest: false, totals: { tokens: 1200, promptTokens: 1000, completionTokens: 200, calls: 12, failed: 0, usd: null, pricingKnown: false, pricedCalls: 0, callsMissingPricing: 12 }, trend: [] } } })),
    getBySkill: vi.fn(async () => ({ data: { data: [] } })),
    getByUser: vi.fn(async () => ({ data: { data: [] } })),
    getByModel: vi.fn(async () => ({ data: { data: [] } }))
  },
  adminLearningContentApi: apiObject(),
  // OpsHub 宿主页的待办聚合会打这两个（此前只测 Messages 宿主时不需要）
  adminFeedbackApi: apiObject(),
  adminDevtoolsApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

function mockRouter(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/:page?', component: { template: '<div />' } },
      // 与真实路由同款的拆页重定向（2026-09-29）：/admin/sessions 合并宿主 URL → 对应独立页
      {
        path: '/admin/sessions',
        redirect: (to) => {
          const tab = typeof to.query.tab === 'string' ? to.query.tab : '';
          if (tab === 'conversations') return { path: '/admin/goal-conversations' };
          if (tab === 'paths') return { path: '/admin/learning-paths' };
          return { path: '/admin/teaching-sessions' };
        }
      }
    ],
  });
  const ready = router.push(initialPath).then(() => router.isReady());
  return { router, ready };
}

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

/**
 * 点击视图切换 pill（OpsHub 等仍用 pills 的宿主页）。
 * pill 文本带计数徽章（如「站内通知」），按 .mk-pill 定位 + includes 匹配标签。
 */
async function clickPill(w: ReturnType<typeof mount>, label: string) {
  const btn = w.findAll('.mk-pill').find((b) => b.text().includes(label));
  expect(btn, `未找到视图切换 pill：${label}`).toBeTruthy();
  await btn!.trigger('click');
}

/**
 * 点击视图切换 tab（People 2026-10-01 起改原型 .tabs 下划线页签，非胶囊）。
 */
async function clickTab(w: ReturnType<typeof mount>, label: string) {
  const btn = w.findAll('.tab').find((b) => b.text().includes(label));
  expect(btn, `未找到视图切换 tab：${label}`).toBeTruthy();
  await btn!.trigger('click');
}

describe('合并宿主页（导航收敛 2026-09-04）', () => {
  beforeEach(() => {
    intent.scene = 'overview';
    intent.statusFilter = '';
    intent.tab = '';
    intent.quickAction = '';
  });

  it('People：默认账号 tab（Users）；切「学习状态」→ LearnerCenter + ?tab=state 写入', async () => {
    const { router, ready } = mockRouter('/admin/people');
    await ready;
    const w = mount(People, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(Users).exists()).toBe(true);
    expect(w.findComponent(LearnerCenter).exists()).toBe(false);

    await clickTab(w, '学习状态');
    await settle();
    expect(w.findComponent(LearnerCenter).exists()).toBe(true);
    expect(w.findComponent(Users).exists()).toBe(false);
    expect(router.currentRoute.value.query.tab).toBe('state');
    w.unmount();
  });

  it('People：深链 /admin/people?tab=state 直达学习状态；intent quickAction 强制账号 tab + 弹新建', async () => {
    const { router, ready } = mockRouter('/admin/people?tab=state');
    await ready;
    const w = mount(People, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(LearnerCenter).exists()).toBe(true);
    w.unmount();

    intent.quickAction = 'create-user';
    const { router: r2, ready: ready2 } = mockRouter('/admin/people?tab=state');
    await ready2;
    const w2 = mount(People, {
      global: { plugins: [r2] },
      attachTo: document.body
    });
    await settle();
    // quickAction 强转账号 tab → Users 挂载并消费 quickAction 打开新建弹窗（Teleport 到 body）
    expect(w2.findComponent(Users).exists()).toBe(true);
    expect(document.body.querySelector('.mk-modal')).toBeTruthy();
    w2.unmount();
    document.body.innerHTML = '';
  });

  it('拆页（2026-09-29）：目标对话独立页不再承载教学会话/学习路径子视图与视图切换 pills', async () => {
    const { router, ready } = mockRouter('/admin/goal-conversations');
    await ready;
    const w = mount(GoalConversations, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(OpsContent).exists()).toBe(false);
    expect(w.findComponent(TeachingSessions).exists()).toBe(false);
    expect(w.find('.gc-tabs').exists()).toBe(false);
    w.unmount();
  });

  it('拆页重定向：/admin/sessions（含旧 ?tab=）映射到对应独立页', async () => {
    const { router, ready } = mockRouter('/admin/sessions?tab=paths');
    await ready;
    expect(router.currentRoute.value.path).toBe('/admin/learning-paths');

    const { router: r2, ready: ready2 } = mockRouter('/admin/sessions?tab=conversations');
    await ready2;
    expect(r2.currentRoute.value.path).toBe('/admin/goal-conversations');

    const { router: r3, ready: ready3 } = mockRouter('/admin/sessions');
    await ready3;
    expect(r3.currentRoute.value.path).toBe('/admin/teaching-sessions');
  });

  it('OpsHub：深链 ?tab=announce 渲染 Announcements；切「站内通知」→ Notifications + ?tab=inapp', async () => {
    const { router, ready } = mockRouter('/admin/ops-hub?tab=announce');
    await ready;
    const w = mount(OpsHub, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(Announcements).exists()).toBe(true);
    expect(w.findComponent(Notifications).exists()).toBe(false);

    await clickPill(w, '站内通知');
    await settle();
    expect(w.findComponent(Notifications).exists()).toBe(true);
    expect(router.currentRoute.value.query.tab).toBe('inapp');
    w.unmount();
  });

  it('拆页（2026-09-29）：成本分析独立成 token-cost 场景，执行日志页不再内嵌 TokenCost', async () => {
    const { router, ready } = mockRouter('/admin/token-cost');
    await ready;
    const w = mount(TokenCost, { global: { plugins: [router] } });
    await settle();
    // KPI 区收编成本卡后走共享 .mk-kpi-grid（私有 .tc-overview / cost-strip 均已退役）
    const labels = w.findAll('.mk-kpi-grid .mk-kpi__label').map((c) => c.text());
    expect(labels).toContain('调用成本');
    expect(labels).toContain('总 Token');
    // 页头承担身份 + 口径（newui/admin pagehead 形态），状态条退役；不复述 KPI 数字
    const headText = w.find('.mk-pagehead').text();
    expect(headText).toContain('Token 成本');
    expect(headText).not.toContain('次调用');
    w.unmount();

    const { router: r2, ready: ready2 } = mockRouter('/admin/execution-logs');
    await ready2;
    const w2 = mount(ExecLogs, { global: { plugins: [r2] } });
    await settle();
    expect(w2.findComponent(TokenCost).exists()).toBe(false);
    w2.unmount();
  });
});
