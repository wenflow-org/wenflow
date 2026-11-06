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
 * ④ 图谱二次（2026-11-07 走查）：卡贴死 sticky 导航无顶距；侧栏 [»] 绝对定位盖住
 *    16 字长标题；宽度一度改成全幅工作台（无帽满屏）被用户否掉，回到与学习状态同档
 *    （组件内 880 居中 + ≥1680 名单 1360），护栏双向锁死不许再摆到任一极端。
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
const explorer = read('../../../components/mk/MkGraphExplorer.vue');
const km = read('../V2KnowledgeMap.vue');
const v2css = read('../v2.css');
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

  it('布局稳定后 fitGraphView 自适应取景（48px 安全边距），只在换数据时触发', () => {
    expect(strip(graph)).toContain('function fitGraphView(');
    expect(strip(graph)).toMatch(/if \(dataChanged\) fitGraphView\(\)/);
    expect(graph).toContain('function fitGraphView(padding = 48)');
    /* 画布角落有可点的缩放控件（+/−/⟲），⟲ 回 fitView 初始档 */
    expect(graph).toContain('defineExpose({ zoomBy, resetView: () => fitGraphView(48) })');
  });

  it('选中态：非关联节点 0.42、连线 0.3，选中节点只亮蓝描边', () => {
    expect(graph).toContain("dimmed === 'select' ? 0.42 : 1");
    expect(graph).toMatch(/touchesSelected \? 1 : 0\.3/);
    expect(graph).toMatch(/selectedIdRef\.value === node\.id\s*\n\s*\? '#2563eb'/);
  });
});

describe('知识图谱容器与顶距（2026-11-07 走查/二次）：同档宽度、顶部呼吸、侧栏标题行', () => {
  it('宽度与学习状态同档：组件内 880 居中，≥1680 名单拓 1360', () => {
    const rule = ruleOf(km, '.km__main');
    expect(has(rule, /max-width:\s*880px/), '基线宽度偏离学习状态的 880 档').toBe(true);
    expect(has(rule, /margin:\s*0 auto/)).toBe(true);
    /* 全幅工作台方案被用户否掉（满屏太难看）——不许回退成无帽 */
    expect(has(rule, /max-width:\s*none/), '又变回全幅无帽了').toBe(false);
    expect(has(rule, /width:\s*100%/)).toBe(true);
    /* 高分屏名单必须仍收图谱页（与 .state__main 同一口径） */
    expect(strip(v2css), '图谱被摘出 1360 名单，宽屏档会与状态页不一致').toContain('.v2-page.km .km__main');
  });

  it('顶部呼吸：上下距 28/24，卡不再贴死 sticky 导航', () => {
    const rule = ruleOf(km, '.km__main');
    expect(has(rule, /padding:\s*28px 28px 24px/)).toBe(true);
  });

  it('卡高预留含卡内统计栏/图例（整卡一屏放下、页面不滚）；600px 下限；≤1100 回移动档', () => {
    expect(km).toContain('--km-h-floor, 600px');
    /* 260 = 导航 64 + 上下距 52 + 卡内 bar/图例 ~90 + 底部余白；只扣导航会把整卡顶出视口 */
    expect(km).toContain('--km-h-reserve, 260px');
    const narrow = strip(km).slice(strip(km).indexOf('@media (max-width: 1100px)'));
    expect(narrow).toMatch(/--km-h-floor:\s*560px/);
    expect(narrow).toMatch(/--km-h-reserve:\s*216px/);
  });

  it('侧栏标题行 flex 化：标题弹性折行，[»] 固定宽不再截断长标题', () => {
    const head = ruleOf(explorer, '.mk-ge__side-head');
    expect(has(head, /display:\s*flex/)).toBe(true);
    expect(has(head, /align-items:\s*flex-start/)).toBe(true);
    expect(has(head, /justify-content:\s*space-between/)).toBe(true);
    expect(has(head, /gap:\s*8px/)).toBe(true);
    const title = ruleOf(explorer, '.mk-ge__side-title');
    expect(has(title, /flex:\s*1/)).toBe(true);
    expect(has(title, /min-width:\s*0/)).toBe(true);
    expect(has(title, /word-break:\s*break-word/)).toBe(true);
    const toggle = ruleOf(explorer, '.mk-ge__side-toggle');
    expect(has(toggle, /flex:\s*none/)).toBe(true);
    expect(has(toggle, /position:\s*absolute/), '按钮又绝对定位钉右上、盖住标题了').toBe(false);
    /* 模板顺序：head 行先开、标题在左、按钮在右 */
    const tpl = explorer.slice(0, explorer.indexOf('<script'));
    expect(tpl.indexOf('mk-ge__side-head')).toBeGreaterThan(-1);
    expect(tpl.indexOf('mk-ge__side-title')).toBeGreaterThan(tpl.indexOf('mk-ge__side-head'));
    expect(tpl.indexOf('mk-ge__side-toggle')).toBeGreaterThan(tpl.indexOf('mk-ge__side-title'));
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

  it('首次学习前的空白日数值补 0（折线从 0 斜向爬升，不再只有孤点+竖虚线）', () => {
    const live = strip(state);
    expect(live).toContain('const firstWithData = days.findIndex');
    expect(live).toContain('days[i].ktl = 0;');
    /* 补 0 方案取代了上一版的 0 基准虚线 lead（实线自带起步段） */
    expect(live).not.toContain('leadPaths');
    expect(live).not.toContain('.ff-lead');
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

  it('全量统计行整行删除（与日历卡内「本月」口径读成两遍）', () => {
    const live = strip(history);
    expect(live).not.toContain('history__stats');
    expect(live).not.toContain('loadStats');
    /* 全量口径出口只剩 /learning/stats 调用也随之撤除 */
    expect(live).not.toContain("/learning/stats'");
    /* 日历卡内的「本月」口径保留（它是日历的注脚） */
    expect(live).toContain('本月 <b>{{ monthTotals.minutes }}</b> 分钟');
  });

  it('≥1024 左月历 38% + 右列表 62% 双栏', () => {
    const css = strip(history);
    const desk = css.slice(css.indexOf('@media (min-width: 1024px)'));
    expect(desk, '双栏规则缺失').toMatch(/grid-template-columns:\s*minmax\(0, 38fr\)\s+minmax\(0, 62fr\)/);
    expect(desk).toMatch(/\.history__month\s*\{[^}]*grid-column:\s*1/);
    expect(desk).toMatch(/\.history__body > \.history__list\s*\{[^}]*grid-column:\s*2/);
  });

  it('日历明暗分层：非当月压到 0.22，当月无学习日不再带底框', () => {
    expect(history).toMatch(/\.mday--outside, \.mday--future \{[^}]*opacity: 0\.22;/);
    /* h0 与未来日同一份干净底，只高亮有学习时长的日期 */
    expect(history).toMatch(/\.mday--h0 \{ background: none;/);
    expect(history).toMatch(/\.lg--0 \{ background: color-mix\(in srgb, var\(--ink\) 4%, transparent\)/);
  });

  it('记录行状态标签与动作链接同一行（全宽度口径）', () => {
    const aside = ruleOf(history, '.history__aside');
    expect(has(aside, /flex-direction:\s*row/)).toBe(true);
    /* 旧「窄屏才横排」的例外规则已并入基础规则 */
    expect(strip(history)).not.toMatch(/\.history__aside\s*\{[^}]*flex-direction:\s*column/);
  });
});
