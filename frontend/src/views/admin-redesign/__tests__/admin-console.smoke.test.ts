/**
 * AdminConsole 导航冒烟（J P0）：
 * 真实挂载 AdminConsole（mock 掉 API 层），验证
 * 1. boot 流程完成（loadLiveData 对 mock API 容错 → 不整页报错）
 * 2. manifest 全部菜单项（阶段 1 收敛后 14 项）逐一点击 → 路由跳转 /admin/:id + 对应页面组件真正渲染
 * 3. 深链直达 /admin/:page 渲染对应页面；非法 page 回退 /admin/overview 并修正 URL
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import AdminConsole from '../AdminConsole.vue';
import { SCENE_COMPONENTS } from '../AdminConsole.vue';
import { MOCK_SCENES } from '../manifest';
import Overview from '../Overview.vue';
import { intent, subPage } from '../store';

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
  adminPromptOpsApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
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
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

vi.mock('@/api/userCustom', () => ({
  getProjectionGrantStatus: vi.fn(async () => ({ data: {} })),
  normalizeProjectionGrant: vi.fn(() => null)
}));

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', name: 'AdminConsole', component: AdminConsole }]
  });
}

async function mountConsole(initialPath: string) {
  const router = makeRouter();
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(AdminConsole, {
    global: { plugins: [router] },
    attachTo: document.body
  });
  mountedWrappers.push(wrapper);
  await settle();
  return { wrapper, router };
}

/** 泄漏的 AdminConsole 实例会持有共享 store（subPage/intent）的存活 watcher，
    断言失败跳过 unmount 时会把残留状态写进后续用例——统一在 afterEach 兜底卸载 */
const mountedWrappers: { unmount: () => void }[] = [];
afterEach(() => {
  mountedWrappers.splice(0).forEach((w) => w.unmount());
});

describe('AdminConsole 导航冒烟', () => {
  beforeEach(() => {
    // store 为模块级单例：清掉上一用例残留的跨页动线，避免污染本次挂载
    intent.scene = 'overview';
    intent.agentFilter = '';
    intent.statusFilter = '';
    intent.traceId = '';
    intent.sessionId = '';
    intent.quickAction = '';
    subPage.value = null;
  });

  it('boot 完成并默认渲染 Overview（无整页错误）', async () => {
    const { wrapper } = await mountConsole('/admin/overview');
    expect(wrapper.find('.ac-error').exists()).toBe(false);
    expect(wrapper.find('.ac-boot').exists()).toBe(false);
    expect(wrapper.findComponent(Overview).exists()).toBe(true);
  });

  it('manifest 每个菜单项点击后：路由跳转 + 对应组件渲染', async () => {
    const { wrapper, router } = await mountConsole('/admin/overview');
    const items = wrapper.findAll('.mshell__item');
    expect(items).toHaveLength(MOCK_SCENES.length);

    for (const scene of MOCK_SCENES) {
      const item = wrapper.findAll('.mshell__item').find((n) => n.text().includes(scene.label));
      expect(item, `菜单项缺失：${scene.label}`).toBeDefined();
      await item!.trigger('click');
      await settle();
      expect(router.currentRoute.value.params.page, `点击「${scene.label}」路由未跳转`).toBe(scene.id);
      expect(
        wrapper.findComponent(SCENE_COMPONENTS[scene.id] as never),
        `点击「${scene.label}」对应组件未渲染`
      ).toBeTruthy();
      expect(wrapper.find('.ac-error').exists(), `「${scene.label}」页面出现整页错误`).toBe(false);
    }
  });

  it('深链直达 /admin/skills 渲染 Skill 目录', async () => {
    const { wrapper, router } = await mountConsole('/admin/skills');
    expect(router.currentRoute.value.params.page).toBe('skills');
    expect(wrapper.findComponent(SCENE_COMPONENTS.skills as never)).toBeTruthy();
  });

  it('非法 page 回退 overview 并修正 URL', async () => {
    const { wrapper, router } = await mountConsole('/admin/not-a-page');
    expect(router.currentRoute.value.path).toBe('/admin/overview');
    expect(wrapper.findComponent(Overview).exists()).toBe(true);
  });

  it('深链 /admin/overview 不被残留 intent 改写（URL 权威，QA ISSUE-001）', async () => {
    // 模拟模块级单例残留：上一次跨页意图仍是 execution-logs
    intent.scene = 'execution-logs';
    const { wrapper, router } = await mountConsole('/admin/overview');
    await settle();
    // URL 为准：scene/intent 均归一为 overview，未被历史意图改写
    expect(router.currentRoute.value.params.page).toBe('overview');
    expect(intent.scene).toBe('overview');
    expect(wrapper.findComponent(Overview).exists()).toBe(true);
  });

  it('刷新二级页深链 ?view=user&id= 不被 scene watch 误杀（subPage 存活 + URL query 保留）', async () => {
    // 根因回归：scene watch 注册晚于「URL → subPage」watch，同一 flush 里
    // 「先恢复后误杀」曾导致刷新深链卡在详情骨架屏、请求永不发出
    const { wrapper, router } = await mountConsole('/admin/people?view=user&id=user_abc');
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({ view: 'user', id: 'user_abc' });
    expect(subPage.value).toMatchObject({ view: 'user', id: 'user_abc' });
    // 详情组件走 asyncPage（delay:200），等待异步 chunk 挂载；全量跑批时机器慢，放宽超时
    await vi.waitFor(() => expect(wrapper.find('.mk-page.ld').exists()).toBe(true), { timeout: 15000 });
  });

  it('跨场景深链 push（overview → people?view=user&id=）同样存活', async () => {
    const { wrapper, router } = await mountConsole('/admin/overview');
    await router.push('/admin/people?view=user&id=user_abc');
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({ view: 'user', id: 'user_abc' });
    expect(subPage.value).toMatchObject({ view: 'user', id: 'user_abc' });
    await vi.waitFor(() => expect(wrapper.find('.mk-page.ld').exists()).toBe(true), { timeout: 15000 });
  });

  it('深链 ?view=card-import（无 id）仍打开导入卡二级页', async () => {
    // 导入卡是纯表单页、本身没有实体 id，CardImportPage 文件头写明的深链就是
    // ?view=card-import。守卫曾要求 view 与 id 同时非空，这种写法会被判成「无 id →
    // 关闭二级页」而渲染回卡墙；只有带哨兵 id 才进得去。
    const { wrapper } = await mountConsole('/admin/virtual-learner-cards?view=card-import');
    await settle();
    expect(subPage.value).toMatchObject({ view: 'card-import', id: 'new' });
    // 断言渲染的是导入表单本身，而不是回退后的卡墙：
    // 卡墙页只有「卡墙 共 20 张」，不会有导入页的 hero 标题与拖放区
    await vi.waitFor(() => expect(wrapper.text()).toContain('导入卡文档'), { timeout: 15000 });
    expect(wrapper.text()).toContain('拖入或点击选择');
  });

  it('侧栏切换场景仍关闭详情（手动切换不受深链守卫影响）', async () => {
    const { wrapper } = await mountConsole('/admin/people?view=user&id=user_abc');
    await settle();
    expect(subPage.value).not.toBeNull();
    const overviewLabel = MOCK_SCENES.find((s) => s.id === 'overview')!.label;
    const item = wrapper.findAll('.mshell__item').find((n) => n.text().includes(overviewLabel));
    expect(item).toBeDefined();
    await item!.trigger('click');
    await settle();
    expect(subPage.value).toBeNull();
  });

  /* 2026-09-29 功能走查：健康检查行「查看 →」跳 /admin/skill-workbench?skill=<id>，此前抽屉是
     唯一落点，scene watcher 无条件关抽屉等于点了没反应。
     2026-10-01 抽屉退役（原型 open-skill=go("skill") 跳页）：旧 ?skill= 深链翻译成二级页
     规范形 ?view=skill&id=<id>，由「URL → subPage」标准机制承载；普通跳转（无 query）按
     URL 权威清掉二级页。 */
  it('跨场景深链 ?skill= 翻译为技能二级页；不带 ?skill= 的场景切换清掉二级页', async () => {
    const { router } = await mountConsole('/admin/health-center');

    await router.push('/admin/skill-workbench?skill=goal-conversation');
    await settle();
    expect(router.currentRoute.value.params.page).toBe('skill-workbench');
    expect(router.currentRoute.value.query.skill).toBeUndefined();
    expect(router.currentRoute.value.query.view).toBe('skill');
    expect(router.currentRoute.value.query.id).toBe('goal-conversation');
    expect(subPage.value, '旧 ?skill= 深链要落到 SkillDetail 二级页').not.toBeNull();
    expect(subPage.value?.view).toBe('skill');
    expect(subPage.value?.id).toBe('goal-conversation');

    // 反向：目标 URL 不带 query（侧栏/普通跳转）按 URL 权威清掉二级页
    await router.push('/admin/execution-logs');
    await settle();
    expect(subPage.value).toBeNull();
  });
});
