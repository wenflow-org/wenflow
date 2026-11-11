/**
 * AdminConsole 导航冒烟（J P0）：
 * 真实挂载 AdminConsole（mock 掉 API 层），验证
 * 1. boot 流程完成（loadLiveData 对 mock API 容错 → 不整页报错）
 * 2. manifest 全部菜单项（阶段 1 收敛后 14 项）逐一点击 → 路由跳转 /admin/:id + 对应页面组件真正渲染
 * 3. 深链直达 /admin/:page 渲染对应页面；未知 page **先提示「未知管理页」再回退 /admin/overview**
 *    （2026-11-09 走查修正记录：这条曾被误读成「静默落总览」，其实有 toast 与 URL 归一）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import AdminConsole from '../AdminConsole.vue';
import { SCENE_COMPONENTS, LIST_SCROLL_MEMORY, listScrollKeyOf } from '../AdminConsole.vue';
import { MOCK_SCENES } from '../manifest';
import Overview from '../Overview.vue';
import { intent, subPage, openSubPage, closeSubPage } from '../store';

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

/* 未知 page 的告知走 toast：mock 掉以便断言「不是静默改写 URL」（2026-11-09 走查修正记录） */
const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));
vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: toastWarning }
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
  beforeEach(async () => {
    // store 为模块级单例：清掉上一用例残留的跨页动线，避免污染本次挂载
    intent.scene = 'overview';
    intent.agentFilter = '';
    intent.statusFilter = '';
    intent.traceId = '';
    intent.sessionId = '';
    intent.quickAction = '';
    subPage.value = null;
    LIST_SCROLL_MEMORY.clear();
    // 冲掉上一用例卸载后仍排队的 subPage watcher（否则它会把旧实体的来源写进下一用例）
    await nextTick();
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
    // 隐藏场景（hidden: true，如运营术语表）不进侧栏，由顶栏帮助按钮跳转——不计入菜单遍历
    const sidebarScenes = MOCK_SCENES.filter((s) => !s.hidden);
    expect(items).toHaveLength(sidebarScenes.length);

    for (const scene of sidebarScenes) {
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

  /* 2026-11-09 走查修正记录：这一条曾被读成「未知 /admin/* 静默落总览、无提示」而误判为缺陷。
     实际这里已经有出口——toast 命名了错的那一段，再把 URL 归一成 /admin/overview
     （见 AdminConsole 的 URL → scene watch）。测试把两件事都锁住，避免再被读成静默回退。 */
  it('未知 page：提示「未知管理页」并回退 overview（不是静默改写 URL）', async () => {
    const { wrapper, router } = await mountConsole('/admin/not-a-page');
    await settle();
    expect(toastWarning).toHaveBeenCalledWith('未知管理页「not-a-page」，已回到总览');
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

  it('深链 ?view=skill&id= 打开 Skill 详情二级页（设计页已平铺进本页，2026-10-15）', async () => {
    const { wrapper, router } = await mountConsole('/admin/skills?view=skill&id=teaching-turn');
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({ view: 'skill', id: 'teaching-turn' });
    expect(subPage.value).toMatchObject({ view: 'skill', id: 'teaching-turn' });
    // 详情组件走 asyncPage（delay:200），等异步 chunk 挂载；渲染的是 Skill 详情页本体（根 .mk-page.skd）
    await vi.waitFor(() => expect(wrapper.find('.mk-page.skd').exists()).toBe(true), { timeout: 15000 });
    // 外壳保留：侧栏导航在
    expect(wrapper.find('nav[aria-label="管理导航"]').exists()).toBe(true);
  });

  /* 详情页不是模态：Esc 的第一下应该只把焦点从输入框里退出来。
     否则在详情页的自筛框里按 Esc 会直接退回列表，看起来像「搜索把内容弄丢了」。 */
  it('详情页内焦点在输入框时 Esc 只退出输入，第二次才退出详情', async () => {
    const { wrapper } = await mountConsole('/admin/people?view=user&id=user_abc');
    await settle();
    await vi.waitFor(() => expect(wrapper.find('.mk-page.ld').exists()).toBe(true), { timeout: 15000 });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(subPage.value, '焦点在输入框时 Esc 不得退出详情').not.toBeNull();
    // 输入框已失焦：第二下 Esc 才走「返回上级」
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(subPage.value).toBeNull();
    input.remove();
  });

  /* 2026-11-11 二轮可用性：列表滚到第 30 行 → 进详情 → 返回，列表应回到原位置。
     jsdom 没有布局，「可滚动」用自有 scrollTop 属性模拟；回填由 nextTick + rAF 重试完成。 */
  it('列表滚动位置在详情往返后恢复（同 scene、同 query）', async () => {
    const { wrapper } = await mountConsole('/admin/people');
    await settle();
    await vi.waitFor(
      () => expect(wrapper.find('.mshell__content > .mk-page').exists()).toBe(true),
      { timeout: 10000 }
    );
    const listPage = wrapper.find('.mshell__content > .mk-page').element as HTMLElement;
    Object.defineProperty(listPage, 'scrollTop', { configurable: true, writable: true, value: 420 });

    openSubPage('user', 'user_abc');
    await settle();
    expect(subPage.value).toMatchObject({ view: 'user', id: 'user_abc' });
    expect([...LIST_SCROLL_MEMORY.values()], '打开详情时应记下列表位置').toContainEqual({ page: 420, table: 0 });

    closeSubPage();
    await settle();
    await vi.waitFor(() => {
      const back = wrapper.find('.mshell__content > .mk-page').element as HTMLElement | undefined;
      expect(back, '返回后列表页应重新挂载').toBeTruthy();
      if (back && !Object.prototype.hasOwnProperty.call(back, 'scrollTop')) {
        Object.defineProperty(back, 'scrollTop', { configurable: true, writable: true, value: 0 });
      }
      expect(back!.scrollTop).toBe(420);
    }, { timeout: 4000 });
  });

  it('详情打开期间列表 query 变了 → 返回不回填旧滚动位置', async () => {
    const { wrapper, router } = await mountConsole('/admin/people');
    await settle();
    await vi.waitFor(
      () => expect(wrapper.find('.mshell__content > .mk-page').exists()).toBe(true),
      { timeout: 10000 }
    );
    const listPage = wrapper.find('.mshell__content > .mk-page').element as HTMLElement;
    Object.defineProperty(listPage, 'scrollTop', { configurable: true, writable: true, value: 420 });

    openSubPage('user', 'user_abc');
    await settle();
    // 同一 scene 下筛选项变了：返回的是另一份列表，不该回到旧位置
    await router.push({ path: '/admin/people', query: { view: 'user', id: 'user_abc', q: 'abc' } });
    await settle();

    const scrollSetter = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    closeSubPage();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      scrollSetter.mock.calls.some(([v]) => v === 420),
      'query 变化后不得把旧位置写回新列表'
    ).toBe(false);
    scrollSetter.mockRestore();
  });

  it('记忆 key：只剔除二级页参数，列表自己的筛选/页签保留', () => {
    // 打开时记的是列表 URL；关闭后等路由收干净再比对同一个 key（详情落点页签随关闭被 URL 同步收走）
    expect(listScrollKeyOf('people', { view: 'learner', id: 'u1', tab: 'evidence', q: 'a' })).toBe(
      listScrollKeyOf('people', { q: 'a', tab: 'evidence' })
    );
    expect(listScrollKeyOf('people', { fromView: 'skill', fromId: 's', q: 'a' })).toBe(
      listScrollKeyOf('people', { q: 'a' })
    );
    // 列表自己的页签属于筛选状态：换 tab 不能复用滚动位置
    expect(listScrollKeyOf('ops-hub', { tab: 'feedback' })).not.toBe(
      listScrollKeyOf('ops-hub', { tab: 'achievements' })
    );
    // 筛选参数参与 key（顺序无关）
    expect(listScrollKeyOf('people', { q: 'a', pill: 'online' })).toBe(
      listScrollKeyOf('people', { pill: 'online', q: 'a' })
    );
  });

  /* 2026-10-18 用户走查：列表条目一律落「概览」不匹配列表主题 → 二级页带落点页签。
     落点必须与 view/id 同一次 push 并进 URL（刷新/深链保持），关闭二级页时随详情一起收，
     否则列表 URL 上留一个无主的 ?tab=。 */  it('二级页落点页签：openSubPage 带 tab 并进 URL，closeSubPage 时随 view/id 一起收（learner 专有）', async () => {
    const { router } = await mountConsole('/admin/learner-state');
    await settle();
    openSubPage('learner', 'user_abc', { tab: 'evidence' });
    await settle();
    expect(subPage.value).toMatchObject({ view: 'learner', id: 'user_abc', tab: 'evidence' });
    expect(router.currentRoute.value.query).toMatchObject({ view: 'learner', id: 'user_abc', tab: 'evidence' });
    closeSubPage();
    await settle();
    expect(subPage.value).toBeNull();
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    expect(router.currentRoute.value.query.view).toBeUndefined();
    expect(router.currentRoute.value.query.id).toBeUndefined();
  });

  /* 2026-11-11：课堂刷新后 from 丢失 → 面包屑只剩「用户账号 / 路径名」，返回落用户列表。
     来源页持久化进 URL（fromView/fromId/fromLabel），刷新/深链/前进后退都能恢复；
     关闭二级页时随 view/id 一起收，不留在列表 URL 上。 */
  it('openSubPage 带 from：来源写进 URL，关闭后随详情一起收（不污染列表 URL）', async () => {
    const { router } = await mountConsole('/admin/people?view=user&id=user_abc');
    await settle();
    openSubPage('session-real', 'ts_1', { from: { view: 'user', id: 'user_abc', label: 'cs' } });
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({
      view: 'session-real', id: 'ts_1',
      fromView: 'user', fromId: 'user_abc', fromLabel: 'cs'
    });
    closeSubPage();
    await settle();
    expect(subPage.value).toMatchObject({ view: 'user', id: 'user_abc', label: 'cs' });
    expect(router.currentRoute.value.query).toMatchObject({ view: 'user', id: 'user_abc' });
    expect(router.currentRoute.value.query.fromView).toBeUndefined();
    expect(router.currentRoute.value.query.fromId).toBeUndefined();
    expect(router.currentRoute.value.query.fromLabel).toBeUndefined();
  });

  it('刷新/深链带 from*：subPage.from 恢复，返回回到学习者详情而不是用户列表', async () => {
    const { router } = await mountConsole(
      '/admin/people?view=session-real&id=ts_1&fromView=user&fromId=user_abc&fromLabel=cs'
    );
    await settle();
    expect(subPage.value).toMatchObject({
      view: 'session-real', id: 'ts_1',
      from: { view: 'user', id: 'user_abc', label: 'cs' }
    });
    closeSubPage();
    await settle();
    expect(subPage.value).toMatchObject({ view: 'user', id: 'user_abc', label: 'cs' });
    expect(router.currentRoute.value.query).toMatchObject({ view: 'user', id: 'user_abc' });
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

  /* 跨页跳转可带目标页预筛（2026-10-26 导航收口）：侧栏角标把「近 7 天失败」的口径带进
     执行日志，落地即筛、可刷新可分享。2026-10-31 起页面默认档 = 近 7 天，range=week
     属默认值不再写 URL（filterSnapshot 只存非默认值）；status=err 非默认仍落 URL。 */
  it('侧栏导航携带的落地筛选进 URL（执行日志 ?status=err；range=week 为默认档不写）', async () => {
    const { wrapper, router } = await mountConsole('/admin/overview');
    await settle();
    await nextTick();
    wrapper.findComponent({ name: 'Shell' }).vm.$emit('navigate', 'execution-logs', { range: 'week', status: 'err' });
    await settle();
    expect(router.currentRoute.value.params.page).toBe('execution-logs');
    expect(router.currentRoute.value.query).toMatchObject({ status: 'err' });
    expect(router.currentRoute.value.query.range).toBeUndefined();
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
