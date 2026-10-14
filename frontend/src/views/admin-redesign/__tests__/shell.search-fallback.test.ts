/**
 * 顶栏搜索：无页面命中时的转搜出口（2026-10-13 运营走查 O1）。
 *
 * 实测缺陷：搜「孙浩」（库里真实存在的虚拟学习者）→「没有匹配的页面」。顶栏搜索只索引
 * 页面名，而运营最常搜的是实体（人 / 路径 / 调用）——该文案容易被读成「平台上没有这个人」。
 * 现在无结果时说明搜索范围，并给三条实体列表页的深链（关键词跟着走，落地即筛好）。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import Shell from '../Shell.vue';

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: { logout: vi.fn(async () => ({ data: {} })) },
  clearAdminSession: vi.fn()
}));

vi.mock('../live', () => ({
  loadLiveData: vi.fn(async () => undefined),
  liveLoading: ref(false),
  liveNavBadges: ref<Record<string, string>>({}),
  alarmNavBadges: new Set<string>([])
}));

async function mountShellAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div />' } }] });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(Shell, { props: { current: 'overview', release: true }, global: { plugins: [router] } });
  return { wrapper, router };
}

describe('顶栏搜索 · 转搜出口', () => {
  it('有页面命中时不出现转搜出口', async () => {
    const { wrapper } = await mountShellAt('/admin/overview');
    await wrapper.find('.mshell__search-input').setValue('成本');
    await flushPromises();
    expect(wrapper.text()).toContain('成本分析');
    expect(wrapper.findAll('.mshell__search-fallback')).toHaveLength(0);
    wrapper.unmount();
  });

  it('搜人名（无页面命中）→ 说明范围 + 三条转搜出口', async () => {
    const { wrapper } = await mountShellAt('/admin/overview');
    await wrapper.find('.mshell__search-input').setValue('孙浩');
    await flushPromises();
    expect(wrapper.text()).toContain('没有匹配的页面');
    expect(wrapper.text()).toContain('只覆盖页面名称');
    const fallbacks = wrapper.findAll('.mshell__search-fallback');
    expect(fallbacks).toHaveLength(3);
    expect(fallbacks.map((f) => f.text())).toEqual([
      '用户与学习者：搜「孙浩」',
      '学习路径：搜「孙浩」',
      '执行日志：搜「孙浩」'
    ]);
    wrapper.unmount();
  });

  it('点出口 → 跳到对应列表页并带上关键词（可继续深链 / 收藏）', async () => {
    const { wrapper, router } = await mountShellAt('/admin/overview');
    await wrapper.find('.mshell__search-input').setValue('孙浩');
    await flushPromises();
    await wrapper.findAll('.mshell__search-fallback')[0].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/people');
    expect(router.currentRoute.value.query.q).toBe('孙浩');
    // 搜索弹层随之关闭（不留悬浮态）
    expect(wrapper.findAll('.mshell__search-fallback')).toHaveLength(0);
    wrapper.unmount();
  });

  it('搜索词原样编码（含空格 / 特殊字符不破 URL）', async () => {
    const { wrapper, router } = await mountShellAt('/admin/overview');
    await wrapper.find('.mshell__search-input').setValue('a b&c');
    await flushPromises();
    await wrapper.findAll('.mshell__search-fallback')[2].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/execution-logs');
    expect(router.currentRoute.value.query.q).toBe('a b&c');
    wrapper.unmount();
  });
});
