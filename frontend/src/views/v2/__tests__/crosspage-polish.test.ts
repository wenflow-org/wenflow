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
const paths = read('../V2LearningPaths.vue');
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
    /* 2026-11-09：换数据时先复位「用户动过视角」标记再取景；纯 resize 走 RO 那条分支 */
    expect(strip(graph)).toMatch(/if \(dataChanged\) \{\s*userRoamed = false\s*fitGraphView\(\)/);
    expect(graph).toContain('function fitGraphView(padding = 48)');
    /* 画布角落有可点的缩放控件（+/−/⟲），⟲ 回 fitView 初始档 */
    expect(strip(graph)).toMatch(/resetView: \(\) => \{\s*userRoamed = false\s*fitGraphView\(48\)/);
  });

  it('选中态：非关联节点 0.42、连线 0.3，选中节点只亮蓝描边', () => {
    expect(graph).toContain("dimmed === 'select' ? 0.42 : 1");
    expect(graph).toMatch(/touchesSelected \? 1 : 0\.3/);
    expect(graph).toMatch(/selectedIdRef\.value === node\.id\s*\n\s*\? '#2563eb'/);
  });
});

describe('知识图谱容器与顶距（2026-11-07 走查/二次/三次）：同档宽度、标题行、黄金画布高', () => {
  /* 2026-11-07 三次走查（用户裁决「以学习状态为全站标准模板」）：
     上一版是「组件内 880 + ≥1680 拓 1360」的老阶梯，在 1280/1536 下只占 54~89%，
     与邻页不齐；现改为与状态页完全同档——共享 v2.css 的 min(92vw, 1360px)。 */
  it('容器不再自钉宽度：交给 v2.css 的 min(92vw,1360) 统一档', () => {
    const rule = ruleOf(km, '.km__main');
    expect(has(rule, /max-width:\s*880px/), '本地仍钉着 880，与状态页的 1360 档不齐').toBe(false);
    expect(has(rule, /max-width:\s*none/), '不许退回全幅无帽').toBe(false);
    expect(has(rule, /width:\s*100%/)).toBe(true);
    expect(has(rule, /margin:\s*0 auto/)).toBe(true);
    expect(strip(v2css), 'v2.css 的弹性容器没覆盖到页面 main').toContain('.v2-page > main[class]:not(.entry):not(.work)');
    /* 三个自管宽度的壳必须排除（2026-11-07 用户报「登录怎么跑左侧去了」）：
       auth/ob 是满宽盒 + 内部居中，削宽后盒子贴左 → 整页左移；
       docs 自带 780 阅读列，被顶掉后正文拉到 1360。 */
    expect(strip(v2css), '认证/引导壳没排除，登录页会被推到左边').toContain(':not(.auth__main):not(.ob__main):not(.docs-main)');
  });

  it('恢复可见标题行：h1 与副标题同 .state__head 解剖', () => {
    /* 5 个主 Tab 切换时不能只有本页没有标题行（重心跳动） */
    expect(km).toContain('class="km__head"');
    expect(km).toMatch(/<h1>知识图谱<\/h1>/);
    expect(km).not.toMatch(/<h1 class="visually-hidden">知识图谱<\/h1>/);
    const head = ruleOf(km, '.km__head');
    expect(has(head, /display:\s*flex/)).toBe(true);
    const h1 = ruleOf(km, '.km__head h1');
    expect(has(h1, /font-size:\s*22px/)).toBe(true);
    expect(has(h1, /font-weight:\s*800/)).toBe(true);
  });

  it('顶部呼吸与卡片内边距同状态页：24/28/48', () => {
    const rule = ruleOf(km, '.km__main');
    expect(has(rule, /padding:\s*24px 28px 48px/)).toBe(true);
  });

  it('画布高走 flex 自适应（height="100%"），不再按 DPI 推固定像素', () => {
    /* 2026-11-10 用户裁决「改成自适应」：4K 缩放下 100dvh − 282 这类固定量总会差几像素。
       现在卡片吃掉剩余高度，链路 .km → .km__main → .km__card → .mk-ge → .mk-ge__card
       → .mk-ge__body(1fr) → .mk-ge__canvas → .mk-graph(height:100%)，全部 flex。 */
    expect(km).toContain('height="100%"');
    expect(km, '不许再按视口减固定像素算画布高').not.toMatch(/height="clamp\(\d+px, calc\(100dvh/);
    const css = strip(km);
    for (const sel of ['.km {', '.km__main {', '.km__card {']) {
      expect(css, `缺少自适应链路节点 ${sel}`).toContain(sel);
    }
    expect(css).toMatch(/\.km__card :deep\(\.mk-ge__body\) \{[^}]*grid-template-rows: minmax\(0, 1fr\)/);
    /* 2026-11-10 用户补一句「不喜欢完全贴底，还是留一点空间」：卡片底边不吃到页脚，
       桌面档留一档 margin 从剩余高度里扣（页面总高仍=视口，不产生滚动）。 */
    expect(css).toMatch(/\.km__card \{[^}]*margin-bottom: 2[0-9]px/);
    const narrow = strip(km).slice(strip(km).indexOf('@media (max-width: 1100px)'));
    expect(narrow, '移动档不该再改画布高度变量（高度已由 prop 的 clamp 统一）').not.toMatch(/--km-h-floor:/);
  });

  it('单条路径也显示路径归属：静态标签（不是假下拉）', () => {
    expect(explorer).toContain('mk-ge__pathonly');
    expect(explorer).toContain('当前路径');
    /* 多条仍走下拉 */
    expect(explorer).toContain('showPathRail && paths.length > 1');
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

describe('学习路径页头（2026-11-07）：与知识图谱同构，空态上方有文案', () => {
  /* 2026-11-05 曾以「顶栏已写页名」为由把页头整块删掉，结果空态页顶部只剩一块居中图标，
     与知识图谱并排看秃一截（用户「我喜欢图谱的空态设计，上面有点文案」）。
     这里双向锁死：页头必须在，且解剖必须与 .km__head 同档。 */
  it('可见 h1 + 副标题，解剖对齐 .km__head', () => {
    expect(paths).toContain('class="paths__head"');
    expect(paths).toMatch(/<h1>学习路径<\/h1>/);
    const head = ruleOf(paths, '.paths__head');
    expect(has(head, /display:\s*flex/)).toBe(true);
    expect(has(head, /padding-bottom:\s*2px/)).toBe(true);
    const h1 = ruleOf(paths, '.paths__head h1');
    expect(has(h1, /font-size:\s*22px/)).toBe(true);
    expect(has(h1, /font-weight:\s*800/)).toBe(true);
    const sub = ruleOf(paths, '.paths__head p');
    expect(has(sub, /font-size:\s*13px/)).toBe(true);
    /* 与图谱的对照：两边 h1 都是 22/800，副标题都是 13px（只比声明块，不比选择器名） */
    const decls = (rule: string) => rule.slice(rule.indexOf('{'));
    expect(decls(ruleOf(km, '.km__head h1'))).toBe(decls(ruleOf(paths, '.paths__head h1')));
    expect(decls(ruleOf(km, '.km__head p'))).toBe(decls(ruleOf(paths, '.paths__head p')));
  });

  it('页头是 main 的首个子元素：加载 / 失败 / 空态三种情况下都在', () => {
    const stripped = strip(paths);
    const tpl = stripped.slice(0, stripped.indexOf('<script'));
    const head = tpl.indexOf('paths__head');
    expect(head).toBeGreaterThan(tpl.indexOf('main class="paths__main"'));
    /* 放在 loading 之前 = 三种状态（loading / loadError / 列表与空态）共用同一页头 */
    expect(head).toBeLessThan(tpl.indexOf('paths__loading'));
  });

  it('空态说明句不再折出单字孤行（36ch ≈ 21 个汉字）', () => {
    /* 原句 23 字，末行只剩「径。」——用户会在截图里直接看到这个孤字。
       这里只锁「别写回那句」，折行本身由浏览器决定，不做像素断言。 */
    expect(paths).not.toContain('规划一个目标，问流会把它变成可执行的学习路径。');
    expect(paths).toContain('问流会把你规划的目标拆成可执行的阶段与任务，再带你逐步学下去。');
  });
});
