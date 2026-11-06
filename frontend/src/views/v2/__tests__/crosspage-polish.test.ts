/**
 * 三页细节修复护栏（2026-11-06 走查：知识图谱 / 学习状态 / 学习历史）
 *
 * ① 图谱：路径下拉在 ≥1600 视口向右下漂移 40~50px——.v2-page 的 zoom（1.08~1.3）让
 *    getBoundingClientRect 返回视觉坐标，弹层数值却写在缩放子树里；分离子图上下留
 *    220px 空洞、底部节点撞图例；选中节点后其它节点 0.35 太暗、名字读不出。
 * ② 状态：单日数据整图 98% 全空、唯一点贴死右壁；「近 3 天」小字与 [近7天] 切换器矛盾；
 *    复习清单空态独占 ~100px；窗口切换器 36px 大胶囊在手机换行。
 * ③ 历史：顶部 4 个 tab 拉成 1100px 巨型跑道；总计量与日历卡内「本月」统计上下重复两遍；
 *    单列时日历格子被拉成 140px 超扁长条、无学习日没有底色像渲染缺了一半。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import MkSelect from '../../../components/mk/MkSelect.vue';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

const graph = read('../../../components/mk/MkGraph.vue');
const state = read('../V2LearningState.vue');
const history = read('../V2LearningHistory.vue');
const shell = read('../../../components/user/CapabilityShell.vue');
const listbox = read('../../../components/mk/useListbox.ts');

function ruleOf(src: string, selector: string): string {
  const css = strip(src);
  const start = css.indexOf(`${selector} {`);
  expect(start, `样式里没有 ${selector} 规则`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`${selector} 声明块不配平`);
}
const has = (rule: string, re: RegExp) => re.test(rule);

describe('下拉弹层：祖先 zoom 不再把菜单推离触发框', () => {
  it('placeMenu 按累计缩放系数换算坐标（视觉坐标 ÷ scale）', async () => {
    const w = mount(MkSelect, {
      props: {
        modelValue: 'a',
        options: [
          { value: 'a', label: '行政通知起草不再被退回' },
          { value: 'b', label: '全部路径' }
        ]
      }
    });
    const trigger = w.find('.mk-select__trigger').element as HTMLElement;
    /* 模拟 .v2-page zoom:1.08：视觉宽 108 = 布局宽 100 × 1.08，视觉坐标同步偏移 */
    Object.defineProperty(trigger, 'offsetWidth', { value: 100, configurable: true });
    const gBCR = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 108, top: 54, right: 216, bottom: 88.56, width: 108, height: 34.56,
      x: 108, y: 54, toJSON: () => ({})
    } as DOMRect);

    await w.find('.mk-select__trigger').trigger('click');
    await flushPromises();

    const style = (w.find('.mk-select__menu').attributes('style') || '');
    /* left 108 ÷ 1.08 = 100（局部坐标），top 88.56 ÷ 1.08 + 4 ≈ 86 */
    expect(style).toContain('left: 100px');
    expect(style).toContain('top: 86px');
    expect(style).toContain('min-width: 100px');
    gBCR.mockRestore();
    w.unmount();
  });

  it('缩放换算读的是「视觉宽 ÷ 布局宽」，源码里不再直接用裸视觉坐标', () => {
    expect(listbox).toMatch(/rect\.width \/\s*\(el\.offsetWidth \|\| rect\.width\)/);
    expect(listbox, 'left 还在裸用视觉坐标').not.toMatch(/left: `\$\{Math\.round\(rect\.left\)\}px`/);
  });
});

describe('知识图谱：聚拢、取景与选中态', () => {
  it('向心引力抬一倍（分离子图不再隔出大空洞）', () => {
    expect(graph).toMatch(/gravity: narrow \? 0\.2 : \(denseGraph \? 0\.12 : 0\.16\)/);
  });

  it('布局稳定后 fitGraphView 自适应取景，且只在换数据时触发', () => {
    expect(strip(graph)).toContain('function fitGraphView(');
    expect(strip(graph)).toMatch(/if \(dataChanged\) fitGraphView\(\)/);
    /* 选中/换主题重建沿用用户视角：默认 padding 40，节点不撞底缘图例 */
    expect(graph).toContain('function fitGraphView(padding = 40)');
  });

  it('选中态：非关联节点 0.42、连线 0.3，选中节点只亮蓝描边', () => {
    expect(graph).toContain("dimmed === 'select' ? 0.42 : 1");
    expect(graph).toMatch(/touchesSelected \? 1 : 0\.3/);
    expect(graph).toMatch(/selectedIdRef\.value === node\.id\s*\n\s*\? '#2563eb'/);
  });
});

describe('学习状态：单日折线图与卡头紧凑化', () => {
  it('「近 N 天」可见小字撤除（与 [近7天] 切换器矛盾），读屏口径保留', () => {
    const live = strip(state);
    expect(live).not.toContain('drawnSpanLabel');
    expect(live, '实画天数读屏口径仍在').toContain('近 ${activeSeries.value.length} 天');
  });

  it('右缘 36px 内边距，末点不再贴死右边框；单点居中', () => {
    expect(state).toMatch(/const RIGHT_INSET = 36;/);
    expect(state).toContain('const plotX1 = chartW - chartPad - RIGHT_INSET;');
    expect(state).toContain('const x = n === 1 ? plotX0 + usableW / 2 : plotX0 + step * i;');
  });

  it('前置无数据日画 0 基准虚线连至今日数据点', () => {
    expect(strip(state)).toContain('const leadPaths = computed');
    expect(strip(state)).toContain('class="ff-lead ff-lead--lsb"');
    expect(has(ruleOf(state, '.ff-lead'), /stroke-dasharray:\s*4 4/)).toBe(true);
  });

  it('窗口切换器是 26px 紧凑分段控件（不再换行独占一行）', () => {
    const item = ruleOf(state, '.seg__item');
    expect(has(item, /min-height:\s*26px/)).toBe(true);
    expect(has(item, /border-radius:\s*6px/)).toBe(true);
    expect(has(item, /font-size:\s*12px/)).toBe(true);
  });

  it('PC 三张 KPI 按内容收紧靠左（不再三等分拉满 350px）', () => {
    expect(has(ruleOf(state, '.kpis__grid'), /display:\s*flex/)).toBe(true);
    expect(has(ruleOf(state, '.kpi'), /flex:\s*0 0 auto/)).toBe(true);
  });

  it('复习清单空态落在卡头右侧，body 只在有必要时渲染', () => {
    const live = strip(state);
    expect(live).not.toContain('rlist__empty');
    expect(live).toContain('v-else-if="!reviewLoading && !reviewLoadFailed && !reviewRows.length"');
    expect(live).toContain('v-if="reviewLoading || reviewLoadFailed || reviewRows.length" class="band__body"');
  });

  it('学习偏好默认折叠（details 无 open 属性）', () => {
    expect(state).toMatch(/<details v-if="preferenceItems\.length && hasAnyLoad" class="card band sidecard pref-fold">/);
  });
});

describe('学习历史：Tab 栏、双栏与格子', () => {
  it('分段器 fit-content 左对齐（8px 圆角 / 36 高档），右侧有页面级插槽', () => {
    const seg = ruleOf(shell, '.uc__seg');
    expect(has(seg, /display:\s*inline-grid/)).toBe(true);
    expect(has(seg, /border-radius:\s*8px/)).toBe(true);
    expect(strip(shell)).toContain('<slot name="seg-right" />');
  });

  it('总计量移进 Tab 栏同一行（正文里不再单摆一行重复统计）', () => {
    const live = strip(history);
    expect(live).toContain('<template #seg-right>');
    /* 正文 grid 里不再有 stats 行（只在插槽里出现一次） */
    const body = live.slice(live.indexOf('class="history__body"'));
    expect(body).not.toContain('class="history__stats"');
  });

  it('≥1024 左月历 38% + 右列表 62% 双栏', () => {
    const css = strip(history);
    const desk = css.slice(css.indexOf('@media (min-width: 1024px)'));
    expect(desk, '双栏规则缺失').toMatch(/grid-template-columns:\s*minmax\(0, 38fr\)\s+minmax\(0, 62fr\)/);
    expect(desk).toMatch(/\.history__month\s*\{[^}]*grid-column:\s*1/);
    expect(desk).toMatch(/\.history__body > \.history__list\s*\{[^}]*grid-column:\s*2/);
  });

  it('无学习日有可见浅底（ink 4%），不再像渲染缺一半', () => {
    expect(history).toMatch(/\.lg--0, \.mday--h0 \{ background: color-mix\(in srgb, var\(--ink\) 4%, transparent\)/);
  });

  it('记录行状态标签与动作链接同一行（全宽度口径）', () => {
    const aside = ruleOf(history, '.history__aside');
    expect(has(aside, /flex-direction:\s*row/)).toBe(true);
    /* 旧「窄屏才横排」的例外规则已并入基础规则 */
    expect(strip(history)).not.toMatch(/\.history__aside\s*\{[^}]*flex-direction:\s*column/);
  });
});
