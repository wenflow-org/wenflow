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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** jsdom 不实现 Element.scrollTo / scrollIntoView：组件里选中 chip 会调 scrollTo（轨自身定位），
    缺失时 nextTick 回调会在落焦点之前抛错——「方向键换选后焦点仍在 chip 上」会假失败 */
beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.scrollTo = () => undefined;
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

/**
 * #23 走查护栏（2026-10-09 手机·浅色）：路径轨的滚动定位不能把「全部路径」出口推出视口。
 *
 * 病根：原实现裸调 `chip.scrollIntoView({ inline: 'center' })`，滚动容器是**所有可滚祖先**，
 * 390×844 实测把轨推到 scrollLeft=125，「全部路径（10 条）」只剩 x=-111..30（140px 里 111px
 * 在视口外）；而它是「看全貌」的唯一出口，既不在「更多」浮层里、也不在轨的另一端。探针复测：
 * 点它聚焦后连按 6 次 ←，scrollLeft 恒 101 不动，落在轨外那截根本滚不回来。
 * 组件测试摸不到布局（jsdom 没有 clientWidth），所以这里锁源码，锁住「只滚轨自身、
 * 只在整枚落在右侧之外时才滚」这两条，以及与之配套的 scroll-margin 落在最后一个 <style> 块。
 */
const sfcSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../MkGraphExplorer.vue'),
  'utf8'
);
/** 去注释后再断言「源码里没有 X」：注释里点名「为什么弃用某 API」是允许的 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('MkGraphExplorer 路径轨滚动定位（#23）', () => {
  it('不再用 chip.scrollIntoView（滚动容器含页面级祖先，会把出口推出视口）', () => {
    expect(stripComments(sfcSource)).not.toContain('scrollIntoView');
  });

  it('只滚轨自身：从 railEl 取 rect 算 scrollLeft，并钳制在轨两端内', () => {
    expect(sfcSource).toContain('rail.scrollTo');
    expect(sfcSource).toContain('rail.scrollWidth - rail.clientWidth');
    // 只在目标整枚落在可视区右侧之外时才滚——左侧一律不动（出口不会被回推）
    expect(sfcSource).toContain('left >= boxRight');
  });

  it('配套的 scroll-margin-inline 写在 ≤900 覆盖里（最后一个 <style> 块，否则被后面规则盖成死代码）', () => {
    const blocks = [...sfcSource.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const scoped = blocks[blocks.length - 1];
    const mediaIdx = scoped.indexOf('@media (max-width: 900px)');
    expect(mediaIdx, '最后一个 <style> 块里没有 ≤900 覆盖').toBeGreaterThan(-1);
    expect(scoped.slice(mediaIdx)).toContain('scroll-margin-inline');
  });
});
