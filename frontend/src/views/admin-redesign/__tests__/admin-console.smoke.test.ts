/**
 * AdminConsole 导航冒烟（J P0）：
 * 真实挂载 AdminConsole（mock 掉 API 层），验证
 * 1. boot 流程完成（loadLiveData 对 mock API 容错 → 不整页报错）
 * 2. manifest 全部菜单项（19 项）逐一点击 → 路由跳转 /admin/:id + 对应页面组件真正渲染
 * 3. 深链直达 /admin/:page 渲染对应页面；非法 page 回退 /admin/overview 并修正 URL
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  adminBatchExperimentsApi: apiObject(),
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
  await settle();
  return { wrapper, router };
}

describe('AdminConsole 导航冒烟', () => {
  beforeEach(() => {
    // store 为模块级单例：清掉上一用例残留的跨页动线，避免污染本次挂载
    intent.scene = 'overview';
    intent.agentFilter = '';
    intent.statusFilter = '';
    intent.traceId = '';
    intent.sessionId = '';
    intent.skillDrawerId = '';
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
    wrapper.unmount();
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
});
