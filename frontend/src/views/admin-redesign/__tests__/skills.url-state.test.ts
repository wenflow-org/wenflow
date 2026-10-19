/**
 * Skills 列表筛选 ↔ URL（2026-10-14 方案 B 收尾）。
 *
 * 缺陷背景：行点击从「开子页浮层」改成「跳设计页路由」后，列表组件会被卸载——此前浮层
 * 保持列表挂载所以筛选不丢，改路由后 keyword / 页码 / pill / 筛选全归零，返回列表
 * 等于从头再筛。按 house 组合式单点 learner-profile.useListQueryState 落 URL（判例
 * Users / LearnerCenter / VirtualLearners / TeachingSessions 同一单点）。
 *
 * 断言：
 *  - 改筛选 → 写 URL（只 replace，只动自己管的键，缺省值不写进 URL）
 *  - 深链 → 落位（页码不被「筛选变化回第 1 页」的 watch 拽回；各筛选轴还原到控件）
 *  - 脏值（非法 pill / 非法页码）回落默认，不把列表筛空
 *  - 二级页键 ?view=&id= 原样保留
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import Skills from '../Skills.vue';
import { dataSource, liveSkillStatsMap } from '../store';
import { liveSkillProfiles } from '../live';

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveSkillProfiles: ref([]),
    liveSkillStatsRange: ref('7d'),
    liveFailures: ref<Record<string, string>>({}),
    liveLoading: ref(false),
    refreshLiveSkills: vi.fn(async () => {}),
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  const liveSkillStatsMap = ref<Record<string, { calls: number; errors: number; avgMs: number; lastAt: string }>>({});
  return {
    dataSource: ref('live'),
    liveSkillStatsMap,
    // 与真 store 同形：live 模式下按 skillId 取统计（Skills.vue 的 cards 直接读它）
    skillStatOf: (id: string) => liveSkillStatsMap.value[id] || { calls: 0, errors: 0, avgMs: 0, lastAt: '' },
    isLive: ref(true),
    intent: { tab: '', agentFilter: '', statusFilter: '', quickAction: '' },
    investigateAgent: vi.fn(),
    openSubPage: vi.fn(),
    closeSubPage: vi.fn(),
    setSubPageLabel: vi.fn(),
    subPage: ref(null),
    liveSkillStatsRange: ref('7d')
  };
});

vi.mock('@/api/adminApi', () => {
  const apiObject = (custom?: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(custom || ({} as Record<string, unknown>), {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
        return vi.fn(async () => ({ data: { data: {} } }));
      }
    });
  return {
    adminSkillsApi: apiObject({
      getSkills: vi.fn(async () => ({ data: { data: { skills: [] } } })),
      getReconciliation: vi.fn(async () => ({ data: { data: {} } }))
    }),
    adminApiConfigApi: apiObject(),
    adminMcpApi: apiObject(),
    adminGlossaryApi: apiObject(),
    adminPlatformSettingsApi: apiObject(),
    adminCapabilityProbeApi: apiObject(),
    adminPromptOpsApi: apiObject(),
    adminPromptWorkbenchApi: apiObject(),
    adminSkillWorkbenchApi: apiObject(),
    adminAgentPromptsApi: apiObject(),
    adminFieldRoutingsApi: apiObject(),
    adminModelsApi: apiObject(),
    clearAdminSession: vi.fn(),
    markAdminSession: vi.fn(),
    hasAdminSession: vi.fn(() => true)
  };
});

vi.mock('@/api/userCustom', () => ({
  getProjectionGrantStatus: vi.fn(async () => ({ data: {} })),
  normalizeProjectionGrant: vi.fn(() => null)
}));

const TOTAL = 12;
/** 12 行：1–6 类别 teaching、7–12 standard；n=1 归属教学 Agent，其余路径 Agent；
    每 4 行一个红档（errors>0）——够翻到第 2 页（size=10）也够「仅看需关注」有命中 */
function prime() {
  dataSource.value = 'live';
  liveSkillProfiles.value = Array.from({ length: TOTAL }, (_, i) => {
    const n = i + 1;
    const id = `skill-${String(n).padStart(2, '0')}`;
    const teaching = n <= 6;
    const agentId = n === 1 ? 'teaching-agent' : 'path-agent';
    return {
      id,
      name: n <= 2 ? `教学技能 ${n}` : `技能 ${n}`,
      category: teaching ? 'teaching' : 'standard',
      agentId,
      agentName: agentId === 'teaching-agent' ? '教学 Agent' : '路径 Agent'
    };
  }) as never;
  liveSkillStatsMap.value = Object.fromEntries(
    Array.from({ length: TOTAL }, (_, i) => {
      const n = i + 1;
      const red = n % 4 === 0;
      return [`skill-${String(n).padStart(2, '0')}`, { calls: 100, errors: red ? 40 : 0, avgMs: 1200, lastAt: '刚刚' }];
    })
  );
}

async function mountAt(url: string): Promise<{ w: ReturnType<typeof mount>; router: Router }> {
  prime();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/:page?', component: { template: '<div />' } },
      { path: '/admin/skills/:agentId+', component: { template: '<div />' } }
    ]
  });
  await router.push(url);
  await router.isReady();
  const w = mount(Skills, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return { w, router };
}

const pillOf = (w: ReturnType<typeof mount>, label: string) =>
  w.findAll('.mk-pill').find((p) => p.text().startsWith(label))!;

describe('Skills 列表筛选 ↔ URL', () => {
  it('改筛选写 URL：只写非缺省值，且不动别人的键（?view=&id= 保留）', async () => {
    const { w, router } = await mountAt('/admin/skills?view=skill&id=skill-a');
    expect(router.currentRoute.value.query.q).toBeUndefined();

    await w.find('input.mk-filter__input').setValue('教学');
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe('教学');
    expect(router.currentRoute.value.query.view).toBe('skill');
    expect(router.currentRoute.value.query.id).toBe('skill-a');
    // 缺省值不写：pill 默认 all、页码默认 1、size 默认 15
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    expect(router.currentRoute.value.query.page).toBeUndefined();
    expect(router.currentRoute.value.query.size).toBeUndefined();

    // 点「仅看需关注」→ ?pill=attn
    await pillOf(w, '仅看需关注').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.pill).toBe('attn');
    w.unmount();
  });

  it('深链落位：?page=2&size=10 还原页码与页大小，且不被「筛选变化回第 1 页」拽回', async () => {
    const { w, router } = await mountAt('/admin/skills?page=2&size=10');
    expect(w.text()).toContain('第 2 / 2 页');
    expect((w.find('.mk-pagination__size').element as HTMLSelectElement).value).toBe('10');
    // 落位后不回写脏值：URL 上仍是 2 / 10
    expect(router.currentRoute.value.query.page).toBe('2');
    expect(router.currentRoute.value.query.size).toBe('10');
    w.unmount();
  });

  it('深链落位：?q=&pill=&cat=&agent= 四条筛选轴全部还原到控件', async () => {
    const { w } = await mountAt('/admin/skills?q=教学&pill=attn&cat=teaching&agent=path-agent');
    expect((w.find('input.mk-filter__input').element as HTMLInputElement).value).toBe('教学');
    expect(pillOf(w, '仅看需关注').attributes('aria-pressed')).toBe('true');
    // 筛选弹层里的两个下拉
    await w.find('.mk-adv > button').trigger('click');
    await nextTick();
    expect((w.find('#skillAgentFilter').element as HTMLSelectElement).value).toBe('path-agent');
    expect((w.find('select[aria-label="按类别筛选"]').element as HTMLSelectElement).value).toBe('teaching');
    w.unmount();
  });

  it('脏值回落：非法 pill 当缺省、非法页码 / 页大小回落默认（不把列表筛空）', async () => {
    const { w, router } = await mountAt('/admin/skills?pill=zzz&page=abc&size=0');
    expect(pillOf(w, '全部').attributes('aria-pressed')).toBe('true');
    expect(w.text()).toContain('共 12 条 · 第 1 / 1 页');
    // 脏值被清出 URL，不留一个说不通的状态
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    expect(router.currentRoute.value.query.page).toBeUndefined();
    expect(router.currentRoute.value.query.size).toBeUndefined();
    w.unmount();
  });

  it('点「清除筛选」把 q / pill / cat / agent 一并从 URL 摘掉', async () => {
    const { w, router } = await mountAt('/admin/skills?q=教学&pill=attn&cat=teaching');
    await w.find('.mk-link').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBeUndefined();
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    expect(router.currentRoute.value.query.cat).toBeUndefined();
    w.unmount();
  });
});
