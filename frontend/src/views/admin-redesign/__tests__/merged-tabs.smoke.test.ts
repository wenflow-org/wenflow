/**
 * 合并宿主页冒烟（2026-09-04 导航收敛）：
 * - People（用户与学习者：账号/学习状态 tab + ?tab= 深链 + 命令面板新建用户直达）
 * - Sessions（学习会话：教学会话/目标对话/学习路径 tab + ?tab= 深链）
 * - Messages（通知与公告：公告/站内通知 tab + ?tab= 深链）
 * - ExecLogs（执行日志：成本分析 tab 嵌入 TokenCost）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import People from '../People.vue';
import GoalConversations from '../GoalConversations.vue';
import Messages from '../Messages.vue';
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
  // TokenCost 渲染需要 totals 结构（状态条色调推导），mock 真实载荷
  adminTokenCostApi: {
    getSummary: vi.fn(async () => ({ data: { data: { days: 7, includeTest: false, totals: { tokens: 0, promptTokens: 0, completionTokens: 0, calls: 0, failed: 0 }, trend: [] } } })),
    getBySkill: vi.fn(async () => ({ data: { data: [] } })),
    getByUser: vi.fn(async () => ({ data: { data: [] } })),
    getByModel: vi.fn(async () => ({ data: { data: [] } }))
  },
  adminLearningContentApi: apiObject(),
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
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  const ready = router.push(initialPath).then(() => router.isReady());
  return { router, ready };
}

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
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

    await w.findAll('button').find((b) => b.text() === '学习状态')!.trigger('click');
    await settle();
    expect(w.findComponent(LearnerCenter).exists()).toBe(true);
    expect(w.findComponent(Users).exists()).toBe(false);
    expect(router.currentRoute.value.query.tab).toBe('state');
    w.unmount();
  });

  it('People：深链 /admin/people?tab=state 直达学习状态；命令面板 quickAction 强制账号 tab + 弹新建', async () => {
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

  it('Sessions：默认目标对话 tab；切「教学会话」→ TeachingSessions + ?tab=teaching；「学习路径」→ OpsContent', async () => {
    const { router, ready } = mockRouter('/admin/sessions');
    await ready;
    const w = mount(GoalConversations, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(OpsContent).exists()).toBe(false);
    expect(w.findComponent(TeachingSessions).exists()).toBe(false);

    await w.findAll('button').find((b) => b.text() === '教学会话')!.trigger('click');
    await settle();
    expect(w.findComponent(TeachingSessions).exists()).toBe(true);
    expect(router.currentRoute.value.query.tab).toBe('teaching');

    await w.findAll('button').find((b) => b.text() === '学习路径')!.trigger('click');
    await settle();
    expect(w.findComponent(OpsContent).exists()).toBe(true);
    expect(router.currentRoute.value.query.tab).toBe('paths');
    w.unmount();
  });

  it('Sessions：深链 /admin/sessions?tab=paths + intent.tab 直达（运营中心「管理 →」）', async () => {
    const { router, ready } = mockRouter('/admin/sessions?tab=paths');
    await ready;
    const w = mount(GoalConversations, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(OpsContent).exists()).toBe(true);
    w.unmount();

    intent.tab = 'teaching';
    const { router: r2, ready: ready2 } = mockRouter('/admin/sessions');
    await ready2;
    const w2 = mount(GoalConversations, { global: { plugins: [r2] } });
    await settle();
    expect(w2.findComponent(TeachingSessions).exists()).toBe(true);
    w2.unmount();
  });

  it('Messages：默认公告 tab（Announcements）；切「站内通知」→ Notifications + ?tab=inapp', async () => {
    const { router, ready } = mockRouter('/admin/messages');
    await ready;
    const w = mount(Messages, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(Announcements).exists()).toBe(true);
    expect(w.findComponent(Notifications).exists()).toBe(false);

    await w.findAll('button').find((b) => b.text() === '站内通知')!.trigger('click');
    await settle();
    expect(w.findComponent(Notifications).exists()).toBe(true);
    expect(router.currentRoute.value.query.tab).toBe('inapp');
    w.unmount();
  });

  it('ExecLogs：深链 /admin/execution-logs?tab=cost 渲染 TokenCost（成本分析 tab）', async () => {
    const { router, ready } = mockRouter('/admin/execution-logs?tab=cost');
    await ready;
    const w = mount(ExecLogs, { global: { plugins: [router] } });
    await settle();
    expect(w.findComponent(TokenCost).exists()).toBe(true);
    w.unmount();
  });
});
