/**
 * 知识图谱路径切换：**单个下拉**（2026-11-06 §5 定稿）。
 *
 * 背景（本文件取代旧的「有界轨 + 更多（N）」护栏）：
 *  - 旧实现是图卡上方一行平铺胶囊，桌面只放得下 3 枚，其余收进「更多（N）」浮层；
 *    长路径名 + 路径数增长后，浮层会盖住下方概览面板，且同一件事（切换路径）存在
 *    轨、浮层、下拉三套控件（PC 有下拉、窄屏只有轨）。
 *  - 新设计：撤除轨与「更多」浮层，统一成一个 `MkSelect` 路径下拉，并与画布头部的
 *    统计筛选栏同栏（`.mk-ge__bar` 左端）。任何视口、任意条数都只有这一个控件。
 *
 * 本文件锁四件事，任一条挂了都意味着「路径切不了 / 又长出第二套控件」会复发：
 *  1) 结构唯一性：只有一个 combobox，且不存在 `.mk-ge__rail` / `.mk-ge__chip` /
 *     `.mk-ge__more*` 这套旧结构；
 *  2) 不再截断：10 条路径 → 11 个选项（全部路径 + 10 条），没有「更多（7）」；
 *  3) 语义/行为不变：选中 emit update:pathId（全部路径 → null）、选中项回显、
 *     无标题回落 + 重名补序号、选中当前项不重复 emit；
 *  4) 键盘不缩水：↑↓ 换项、Enter 选中、选中后焦点回到触发器；无路径/加载/错误态
 *     没有下拉（整屏三态里不出现孤立控件）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('../MkGraph.vue', () => ({
  default: {
    name: 'MkGraph',
    props: ['nodes', 'edges', 'theme', 'height', 'hideIsolated'],
    template: '<div class="stub-graph" />',
  },
  relationStyleOf: () => ({ width: 2, type: 'solid', color: '#ccc' }),
}));
vi.mock('../../ui/SkeletonLoader.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../../ui/V2ResultState.vue', () => ({ default: { template: '<div />' } }));

import MkGraphExplorer from '../MkGraphExplorer.vue';

/** jsdom 不实现 Element.scrollTo / scrollIntoView：listbox 打开时会把选中项滚进视口 */
beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.scrollTo = () => undefined;
});

const NODES = [{ id: 'c1', label: '概念一' }];

function makePaths(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `lp_${i + 1}`, title: `路径标题 ${i + 1}` }));
}

function mountExplorer(extra: Record<string, unknown> = {}) {
  return mount(MkGraphExplorer, {
    props: { nodes: NODES, edges: [], paths: makePaths(10), ...extra },
  });
}

const trigger = (w: ReturnType<typeof mountExplorer>) => w.find('.mk-ge__pathpick .mk-select__trigger');
/** 下拉的选项文案（listbox 用 v-show 常驻 DOM，展开与否都能读） */
const optionTexts = (w: ReturnType<typeof mountExplorer>) =>
  w.findAll('.mk-ge__pathpick .mk-listbox-opt').map((o) => o.text());

describe('MkGraphExplorer 路径切换：只有一个下拉（§5）', () => {
  it('旧结构整体退场：没有平铺胶囊轨、没有「更多」浮层', () => {
    const w = mountExplorer();
    expect(w.find('.mk-ge__rail').exists()).toBe(false);
    expect(w.find('.mk-ge__railrow').exists()).toBe(false);
    expect(w.find('.mk-ge__chip').exists()).toBe(false);
    expect(w.find('.mk-ge__more-panel').exists()).toBe(false);
    // 全组件只有一个路径选择控件（combobox），不再有 radiogroup 第二套
    expect(w.findAll('[role="combobox"]')).toHaveLength(1);
    expect(w.find('[role="radiogroup"]').exists()).toBe(false);
    w.unmount();
  });

  it('下拉与统计栏同栏：pathpick 位于 .mk-ge__bar 内、统计之前', () => {
    const w = mountExplorer();
    const bar = w.find('.mk-ge__bar');
    expect(bar.find('.mk-ge__pathpick').exists()).toBe(true);
    expect(bar.find('.mk-ge__stats').exists()).toBe(true);
    const html = bar.html();
    expect(html.indexOf('mk-ge__pathpick')).toBeLessThan(html.indexOf('mk-ge__stats'));
    w.unmount();
  });

  it('10 条路径全量进下拉（全部 + 10），不再截断成「全部 + 3 + 更多」', () => {
    const w = mountExplorer();
    const texts = optionTexts(w);
    expect(texts).toHaveLength(11);
    expect(texts[0]).toBe('全部路径（10 条）');
    expect(texts).toContain('路径标题 10');
    expect(texts.join(' ')).not.toContain('更多');
    w.unmount();
  });

  it('选中项回显在触发器上（全部路径 / 某条路径）', () => {
    const all = mountExplorer();
    expect(trigger(all).text()).toContain('全部路径（10 条）');
    all.unmount();

    const one = mountExplorer({ pathId: 'lp_8' });
    expect(trigger(one).text()).toContain('路径标题 8');
    one.unmount();
  });

  it('点选某条路径 emit update:pathId = 该 id；选「全部路径」emit null', async () => {
    const w = mountExplorer();
    await trigger(w).trigger('click');
    await w.findAll('.mk-ge__pathpick .mk-listbox-opt')[8].trigger('click'); // 全部 + lp_1..lp_8
    expect(w.emitted('update:pathId')?.[0]).toEqual(['lp_8']);

    const w2 = mountExplorer({ pathId: 'lp_3' });
    await trigger(w2).trigger('click');
    await w2.findAll('.mk-ge__pathpick .mk-listbox-opt')[0].trigger('click');
    expect(w2.emitted('update:pathId')?.[0]).toEqual([null]);
    w.unmount();
    w2.unmount();
  });

  it('重复选中当前路径不再 emit（避免无谓重拉）', async () => {
    const w = mountExplorer({ pathId: 'lp_2' });
    await trigger(w).trigger('click');
    await w.findAll('.mk-ge__pathpick .mk-listbox-opt')[2].trigger('click');
    expect(w.emitted('update:pathId')).toBeUndefined();
    w.unmount();
  });

  it('无标题路径回落「未命名路径」，重名补序号，不裸出 id', () => {
    const w = mount(MkGraphExplorer, {
      props: {
        nodes: NODES,
        edges: [],
        paths: [
          { id: 'lp_a', title: null },
          { id: 'lp_b', title: null },
          { id: 'lp_c', title: '有标题的路径' },
        ],
      },
    });
    const texts = optionTexts(w);
    expect(texts).toContain('未命名路径 1');
    expect(texts).toContain('未命名路径 2');
    expect(texts).not.toContain('未命名路径');
    expect(texts.join(' ')).not.toContain('lp_a');
    w.unmount();
  });
});

describe('MkGraphExplorer 路径下拉的键盘与三态', () => {
  it('键盘：↓ 打开并移动、Enter 选中，焦点回到触发器', async () => {
    const w = mount(MkGraphExplorer, {
      props: { nodes: NODES, edges: [], paths: makePaths(10), pathId: 'lp_1' },
      attachTo: document.body,
    });
    const btn = trigger(w);
    expect(btn.attributes('role')).toBe('combobox');
    expect(btn.attributes('aria-expanded')).toBe('false');

    await btn.trigger('keydown', { key: 'ArrowDown' });
    expect(btn.attributes('aria-expanded')).toBe('true');
    // 打开时 activeIndex 落在当前选中项（lp_1 = 下标 1），再按一次 ↓ 到 lp_2
    await btn.trigger('keydown', { key: 'ArrowDown' });
    await btn.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:pathId')?.[0]).toEqual(['lp_2']);
    expect(document.activeElement).toBe(btn.element);
    w.unmount();
  });

  it('Esc 收起且不误选', async () => {
    const w = mountExplorer({ pathId: 'lp_1' });
    const btn = trigger(w);
    await btn.trigger('keydown', { key: 'ArrowDown' });
    await btn.trigger('keydown', { key: 'Escape' });
    expect(btn.attributes('aria-expanded')).toBe('false');
    expect(w.emitted('update:pathId')).toBeUndefined();
    w.unmount();
  });

  it('换路径触发重载（骨架顶掉图卡）后，焦点仍回到路径下拉', async () => {
    const w = mount(MkGraphExplorer, {
      props: { nodes: NODES, edges: [], paths: makePaths(10), pathId: 'lp_1' },
      attachTo: document.body,
    });
    await trigger(w).trigger('click');
    await w.findAll('.mk-ge__pathpick .mk-listbox-opt')[2].trigger('click');
    expect(w.emitted('update:pathId')?.[0]).toEqual(['lp_2']);

    // 宿主重载：loading=true 时整屏骨架替换图卡，下拉被卸载；加载结束再挂回来
    await w.setProps({ loading: true, pathId: 'lp_2' });
    expect(w.find('.mk-ge__pathpick').exists()).toBe(false);
    await w.setProps({ loading: false });
    await w.vm.$nextTick();

    expect(document.activeElement).toBe(trigger(w).element);
    w.unmount();
  });

  it('只有 1 条路径时不渲染路径下拉（没有可切换的对象）', () => {
    const w = mountExplorer({ paths: makePaths(1) });
    expect(w.find('.mk-ge__pathpick').exists()).toBe(false);
    w.unmount();
  });

  it('空态（0 节点）与加载/错误态不出现路径下拉', () => {
    const empty = mountExplorer({ nodes: [] });
    expect(empty.find('.mk-ge__pathpick').exists()).toBe(false);
    empty.unmount();

    const loading = mountExplorer({ loading: true });
    expect(loading.find('.mk-ge__pathpick').exists()).toBe(false);
    loading.unmount();

    const error = mountExplorer({ error: '知识图谱加载失败，请稍后重试。' });
    expect(error.find('.mk-ge__pathpick').exists()).toBe(false);
    error.unmount();
  });

  it('宿主接管路径视角（showPathRail=false）时不再画第二套同义控件', () => {
    const w = mountExplorer({ showPathRail: false });
    expect(w.find('.mk-ge__pathpick').exists()).toBe(false);
    w.unmount();
  });
});
