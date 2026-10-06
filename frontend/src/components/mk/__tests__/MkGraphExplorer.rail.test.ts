/**
 * 路径筛选轨「有界化」护栏（2026-10-05）。
 *
 * 病根：轨道是单行 overflow-x:auto，滚动条被显式抹掉（scrollbar-width:none +
 * ::-webkit-scrollbar{display:none}）、无渐隐无箭头。实测某账号 10 条路径、1440 视口：
 * 轨道内容 2390px / 可视 1140px（溢出 2.1 倍），11 枚 chip 只有 5 枚完整可见，最后一枚
 * 右缘 2538px —— 1248px 的内容在屏幕外且零提示。路径数只会涨，所以轨必须有界。
 *
 * 本文件锁三件事，任何一条挂了都意味着「路径多了就有点不到」会复发：
 *  1) 阈值内全量铺开、不出现「更多」（别为了整齐把 3 条路径也塞进浮层）；
 *  2) 超阈值时轨上 chip 数恒定（全部 + 3 + 更多），且「更多」计数 = 轨外路径数；
 *  3) 当前选中路径**永远在轨上**——选中项掉进「更多」就等于用户看不出自己在哪条路径。
 *
 * 阈值为什么是 3 而不是「铺满为止」：轨布局宽实测恒 1024px（`.km__main` 封顶 1180），
 * chip 上限 260px —— 3 枚最坏 948px 放得下，4 枚最坏 1216px 必然横滚（实测第 4 枚被裁一半）。
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

/** jsdom 不实现 scrollIntoView；组件里选中 chip 会调它（浏览器里的「居中」兜底定位） */
beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

const NODES = [{ id: 'c1', label: '概念一' }];

function makePaths(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `lp_${i + 1}`, title: `路径标题 ${i + 1}` }));
}

function mountRail(pathCount: number, pathId: string | null = null) {
  return mount(MkGraphExplorer, {
    props: { nodes: NODES, edges: [], paths: makePaths(pathCount), pathId },
  });
}

/** 焦点断言必须挂进 document：脱离文档的节点 focus() 不生效，activeElement 恒为 body */
function mountRailAttached(pathCount: number, pathId: string | null = null) {
  return mount(MkGraphExplorer, {
    props: { nodes: NODES, edges: [], paths: makePaths(pathCount), pathId },
    attachTo: document.body,
  });
}

const chipTexts = (w: ReturnType<typeof mountRail>) =>
  w.findAll('.mk-ge__rail .mk-ge__chip').map((c) => c.text());

describe('MkGraphExplorer 路径轨的有界化', () => {
  it('阈值内（4 条）全量铺开，不出现「更多」', async () => {
    const w = mountRail(4);
    expect(chipTexts(w)).toEqual([
      '全部路径（4 条）',
      '路径标题 1',
      '路径标题 2',
      '路径标题 3',
      '路径标题 4',
    ]);
    expect(w.find('.mk-ge__chip--more').exists()).toBe(false);
    w.unmount();
  });

  it('10 条时轨上恒定 4 枚 chip + 「更多（7）」', async () => {
    const w = mountRail(10);
    expect(chipTexts(w)).toEqual([
      '全部路径（10 条）',
      '路径标题 1',
      '路径标题 2',
      '路径标题 3',
    ]);
    const more = w.find('.mk-ge__chip--more');
    expect(more.exists()).toBe(true);
    expect(more.text()).toContain('更多（7）');
    w.unmount();
  });

  it('选中项不在前 3 条时被钉进轨上，且不重复出现在「更多」里', async () => {
    const w = mountRail(10, 'lp_8');
    const texts = chipTexts(w);
    expect(texts).toContain('路径标题 8');
    // 钉选会顶掉第 3 条（路径标题 3），轨上仍是 4 枚
    expect(texts).toHaveLength(4);
    expect(texts).not.toContain('路径标题 3');
    expect(texts.filter((t) => t === '路径标题 8')).toHaveLength(1);

    await w.find('.mk-ge__chip--more').trigger('click');
    const items = w.findAll('.mk-ge__more-item').map((i) => i.text());
    expect(items).toHaveLength(7);
    expect(items).not.toContain('路径标题 8');
    w.unmount();
  });

  it('「更多」浮层列出全部轨外路径，点一条 emit update:pathId 并收起', async () => {
    const w = mountRail(10);
    await w.find('.mk-ge__chip--more').trigger('click');

    const items = w.findAll('.mk-ge__more-item');
    expect(items.map((i) => i.text())).toEqual([
      '路径标题 4',
      '路径标题 5',
      '路径标题 6',
      '路径标题 7',
      '路径标题 8',
      '路径标题 9',
      '路径标题 10',
    ]);

    await items[1].trigger('click');
    expect(w.emitted('update:pathId')?.[0]).toEqual(['lp_5']);
    expect(w.find('.mk-ge__more-panel').exists()).toBe(false);
    w.unmount();
  });

  it('轨上点 chip 直接换路径', async () => {
    const w = mountRail(10);
    await w.findAll('.mk-ge__rail .mk-ge__chip')[2].trigger('click');
    expect(w.emitted('update:pathId')?.[0]).toEqual(['lp_2']);
    w.unmount();
  });

  it('Esc 与点击浮层外都能收起「更多」', async () => {
    const w = mountRail(10);
    await w.find('.mk-ge__chip--more').trigger('click');
    expect(w.find('.mk-ge__more-panel').exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.find('.mk-ge__more-panel').exists()).toBe(false);

    await w.find('.mk-ge__chip--more').trigger('click');
    expect(w.find('.mk-ge__more-panel').exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await w.vm.$nextTick();
    expect(w.find('.mk-ge__more-panel').exists()).toBe(false);
    w.unmount();
  });

  it('轨的 radiogroup 契约不变：只有选中项 tabindex=0', async () => {
    const w = mountRail(10, 'lp_1');
    const chips = w.findAll('.mk-ge__rail .mk-ge__chip');
    expect(w.find('[role="radiogroup"]').exists()).toBe(true);
    expect(chips.filter((c) => c.attributes('tabindex') === '0')).toHaveLength(1);
    expect(chips[1].attributes('aria-checked')).toBe('true');
    expect(chips.filter((c) => c.attributes('role') === 'radio')).toHaveLength(chips.length);
    w.unmount();
  });

  /**
   * 焦点回归：父组件换路径会把整屏切成加载态、轨道连同 chip 一起卸载重建，
   * 换选后若不同步落焦点，activeElement 会掉回 body —— 键盘用户不知道自己换到了哪条。
   */
  it('轨上方向键换选后，焦点仍在新的选中 chip 上', async () => {
    const w = mountRailAttached(10, 'lp_1');
    const chips = () => w.findAll('.mk-ge__rail .mk-ge__chip');
    (chips()[1].element as HTMLElement).focus();
    expect(document.activeElement).toBe(chips()[1].element);

    await chips()[1].trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('update:pathId')?.[0]).toEqual(['lp_2']);
    // 父组件完成重载（pathId 同步回组件）——焦点必须落在这枚新 chip 上，而不是掉回 body
    await w.setProps({ pathId: 'lp_2' });
    await w.vm.$nextTick();
    const selected = w.findAll('.mk-ge__rail .mk-ge__chip').find(
      (c) => c.attributes('aria-checked') === 'true'
    );
    expect(selected?.text()).toBe('路径标题 2');
    expect(document.activeElement).toBe(selected?.element);
    w.unmount();
  });

  it('从「更多」浮层选中后，焦点落在轨上那枚 chip 上', async () => {
    const w = mountRailAttached(10);
    await w.find('.mk-ge__chip--more').trigger('click');
    await w.vm.$nextTick();
    expect(document.activeElement).toBe(w.find('.mk-ge__more-item').element);

    await w.findAll('.mk-ge__more-item')[2].trigger('click');
    expect(w.emitted('update:pathId')?.[0]).toEqual(['lp_6']);
    await w.setProps({ pathId: 'lp_6' });
    await w.vm.$nextTick();
    const selected = w.findAll('.mk-ge__rail .mk-ge__chip').find(
      (c) => c.attributes('aria-checked') === 'true'
    );
    expect(selected?.text()).toBe('路径标题 6');
    expect(document.activeElement).toBe(selected?.element);
    w.unmount();
  });
});
