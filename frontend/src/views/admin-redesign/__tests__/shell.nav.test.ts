/**
 * Shell 导航渲染冒烟（J P0）：
 * 侧栏菜单必须完整渲染 manifest 全部条目（分组齐全、label/glyph 展示）、
 * 当前页高亮、点击导航正确 emit，且 live 徽章逻辑不破坏渲染。
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import Shell from '../Shell.vue';
import { MOCK_SCENES } from '../manifest';

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

function mountShell(props: { current: string; crumb?: string; release?: boolean } = { current: 'overview' }) {
  return mount(Shell, { props });
}

describe('Shell 导航', () => {
  it('渲染 manifest 全部菜单项（label 齐全）', () => {
    const wrapper = mountShell();
    const visibleScenes = MOCK_SCENES.filter((s) => !s.hidden);
    const labels = wrapper.findAll('.mshell__item-label').map((n) => n.text());
    expect(labels).toHaveLength(visibleScenes.length);
    for (const scene of visibleScenes) {
      expect(labels).toContain(scene.label);
    }
  });

  it('导航分组齐全且顺序稳定（总览为置顶入口，不进分组）', () => {
    const wrapper = mountShell();
    // 分组标题自 2026-09-27 起降级为纯文字标签（.mshell__caption），不再是可折叠按钮
    // 2026-10-27：账号与接入组撤销，组内页面并入运营
    const groups = wrapper.findAll('.mshell__caption').map((n) => n.text());
    expect(groups).toEqual(['运营', '学习', '仿真', 'Skill', '观测与排查']);
  });

  it('置顶入口（pinned）渲染在分组上方且无组标题', () => {
    const wrapper = mountShell();
    const pinnedLabels = wrapper.findAll('.mshell__pinned .mshell__item-label').map((n) => n.text());
    const pinnedScenes = MOCK_SCENES.filter((s) => s.pinned).map((s) => s.label);
    expect(pinnedLabels).toEqual(pinnedScenes);
    // pinned 项不在任何分组内
    const groupItems = wrapper.findAll('.mshell__group .mshell__item-label').map((n) => n.text());
    for (const label of pinnedScenes) {
      expect(groupItems).not.toContain(label);
    }
  });

  it('当前页菜单高亮（active class）', () => {
    const wrapper = mountShell({ current: 'skills' });
    const active = wrapper.findAll('.mshell__item--active');
    expect(active).toHaveLength(1);
    expect(active[0]!.text()).toContain('Skill 目录');
  });

  it('点击菜单项 emit navigate(id)', async () => {
    const wrapper = mountShell();
    const skills = wrapper
      .findAll('.mshell__item')
      .find((n) => n.text().includes('Skill 目录'))!;
    await skills.trigger('click');
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['skills']);
  });

  it('页面搜索匹配检索词（keywords）：搜「密钥」命中插件与系统设置', async () => {
    const wrapper = mountShell();
    await wrapper.find('.mshell__search-input').setValue('密钥');
    const hits = wrapper.findAll('.mshell__search-hit-label').map((n) => n.text());
    expect(hits).toContain('插件');
    expect(hits).toContain('系统设置');
  });

  it('执行日志角标点进带落地筛选（角标口径=近 7 天失败，落地页默认是今天）', async () => {
    const { liveNavBadges } = await import('../live');
    // 本文件把 live 域整体 mock 成可写 ref（真实模块里是 computed，类型上只读）
    const badges = liveNavBadges as unknown as { value: Record<string, string> };
    badges.value = { 'execution-logs': '3' };
    const wrapper = mountShell({ current: 'overview' });
    const badge = wrapper.find('.mshell__item-badge');
    expect(badge.exists()).toBe(true);
    await badge.trigger('click');
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['execution-logs', { range: 'week', status: 'err' }]);
    badges.value = {};
  });

  it('release 模式下展示账户区（userchip + 退出菜单）', async () => {
    const wrapper = mountShell({ current: 'overview', release: true });
    expect(wrapper.find('.mshell__userchip').exists()).toBe(true);
    await wrapper.find('.mshell__userchip').trigger('click');
    expect(wrapper.find('.mshell__user-item').text()).toContain('退出登录');
  });

  it('非 release 模式不展示管理员区', () => {
    const wrapper = mountShell({ current: 'overview' });
    expect(wrapper.find('.mshell__userchip').exists()).toBe(false);
  });

  it('非法 current 不渲染任何高亮（回退场景由 AdminConsole 处理）', () => {
    const wrapper = mountShell({ current: 'bogus' });
    expect(wrapper.findAll('.mshell__item--active')).toHaveLength(0);
  });

  it('二级页面包屑上移顶栏：传入 crumb 时渲染子页名，未传时不渲染（死 prop 已接入）', () => {
    const withCrumb = mountShell({ current: 'skills', crumb: '虚拟学习者' });
    expect(withCrumb.find('.mshell__top-title').text()).toBe('虚拟学习者');
    const without = mountShell({ current: 'overview' });
    // L1 页顶栏常显（页面名/分组），但不出现「返回上一级」钮
    expect(without.find('.mshell__top-back').exists()).toBe(false);
  });

  it('三段面包屑保留中间层：用户账号 / cs / 课堂主题（不再只显示首尾两段）', () => {
    const wrapper = mountShell({
      current: 'people',
      crumb: '用户账号 / cs / 把米勒与皮亚杰并排，写出认知革命替行为主义补上的那句「中间发生了什么」'
    });
    expect(wrapper.find('.mshell__top-sub').text()).toBe('用户账号 / cs');
    expect(wrapper.find('.mshell__top-title').text()).toBe(
      '把米勒与皮亚杰并排，写出认知革命替行为主义补上的那句「中间发生了什么」'
    );
  });

  /* 顶栏可见文本会被 CSS 省略号截断（长实体名 / 深链），完整链必须留在 title 上——
     否则悬停也读不到被截掉的那一段。 */
  it('面包屑把完整链路放进 title（父级传入的 crumbTitle 比可见文本更长时优先用它）', () => {
    const wrapper = mount(Shell, {
      props: {
        current: 'people',
        crumb: '用户账号 / cs',
        crumbTitle: '用户账号 / cs / 课堂 · 2026-11-11'
      }
    });
    expect(wrapper.find('.mshell__top-crumb').attributes('title')).toBe('用户账号 / cs / 课堂 · 2026-11-11');
    // 一级页没有更长的链：title 与屏幕上的「分组 / 页名」一致
    const l1 = mountShell({ current: 'overview' });
    expect(l1.find('.mshell__top-crumb').attributes('title')).toBe('总览 / 平台总览');
  });

  it('焦点离开搜索框后按 Esc 仍能收起结果弹层（输入框自己的 Esc 监听收不到）', async () => {
    const wrapper = mountShell();
    await wrapper.find('.mshell__search-input').setValue('成本');
    expect(wrapper.find('.mshell__search-pop').exists()).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.mshell__search-pop').exists()).toBe(false);
    expect((wrapper.find('.mshell__search-input').element as HTMLInputElement).value).toBe('');
  });
});

/* 2026-11-11 二轮：≤768 顶栏搜索按原型整块 display:none，`/` 快捷键不应再把焦点丢进隐藏控件。
   jsdom 对 display:none 元素仍允许 focus，所以这里用 matchMedia 断点模拟窄屏（与 CSS 同断点）。 */
describe('窄屏 / 搜索快捷键', () => {
  function stubMatchMedia(maxWidth768: boolean): () => void {
    const saved = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: maxWidth768 && query.includes('max-width: 768px'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia
    return () => { window.matchMedia = saved }
  }

  it('桌面：按 / 聚焦页面搜索框', async () => {
    const wrapper = mount(Shell, { props: { current: 'overview' }, attachTo: document.body })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(wrapper.find('.mshell__search-input').element)
    wrapper.unmount()
  })

  it('≤768（搜索框 display:none）：按 / 不再聚焦隐藏输入', async () => {
    const restore = stubMatchMedia(true)
    const wrapper = mount(Shell, { props: { current: 'overview' }, attachTo: document.body })
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
      await wrapper.vm.$nextTick()
      expect(document.activeElement).not.toBe(wrapper.find('.mshell__search-input').element)
    } finally {
      wrapper.unmount()
      restore()
    }
  })
});
