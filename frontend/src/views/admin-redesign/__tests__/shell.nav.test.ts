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
    const labels = wrapper.findAll('.mshell__item-label').map((n) => n.text());
    expect(labels).toHaveLength(MOCK_SCENES.length);
    for (const scene of MOCK_SCENES) {
      expect(labels).toContain(scene.label);
    }
  });

  it('导航分组齐全且顺序稳定（总览为置顶入口，不进分组）', () => {
    const wrapper = mountShell();
    const groups = wrapper.findAll('.mshell__group-name').map((n) => n.text());
    expect(groups).toEqual(['学习者', '仿真实验室', 'Skill 管理', '运营', '配置', '观测']);
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
    expect(active[0]!.text()).toContain('Skill 运行');
  });

  it('点击菜单项 emit navigate(id)', async () => {
    const wrapper = mountShell();
    const skills = wrapper
      .findAll('.mshell__item')
      .find((n) => n.text().includes('Skill 运行'))!;
    await skills.trigger('click');
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['skills']);
  });

  it('面包屑展示当前场景分组/名称', () => {
    const wrapper = mountShell({ current: 'execution-logs' });
    const crumbs = wrapper.findAll('.mshell__crumb-group, .mshell__crumbs strong');
    expect(crumbs.map((n) => n.text())).toEqual(['观测', '执行日志']);
  });

  it('release 模式下展示管理员区（退出按钮）', () => {
    const wrapper = mountShell({ current: 'overview', release: true });
    expect(wrapper.find('.mshell__logout').exists()).toBe(true);
  });

  it('非 release 模式不展示管理员区', () => {
    const wrapper = mountShell({ current: 'overview' });
    expect(wrapper.find('.mshell__logout').exists()).toBe(false);
  });

  it('非法 current 不渲染任何高亮（回退场景由 AdminConsole 处理）', () => {
    const wrapper = mountShell({ current: 'bogus' });
    expect(wrapper.findAll('.mshell__item--active')).toHaveLength(0);
  });
});
