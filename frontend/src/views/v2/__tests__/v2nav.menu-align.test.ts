/**
 * 账户菜单的左对齐护栏（2026-10-08，390 实测）
 *
 * 病根：主题切换项是 22px 的键帽芯片（.v2nav__menu-theme-icon），其余四项是 15px 线图标。
 * 图标槽不等宽时，那四行的文字比「切换到亮色模式」左移 7px（实测 235.7 vs 242.7），
 * 菜单里最显眼的一处错行。补 3.5px 对称边距后，15px 图标落在与芯片同宽的 22px 槽里，
 * 五项文字同落 242.7，图标墨迹中心也同落 223.65。
 *
 * 附带：菜单头内边距原为 10px，比菜单项的 12px 还窄，名字左缘（210.7）比图标列左缘（212.7）
 * 靠左 2px。改为与菜单项同值后，名字落回图标列那条竖线（212.7）。
 *
 * 本护栏锁两件事：
 *  1) 菜单头左右内边距 = 菜单项内边距（同一左栏，不许再各写各的）；
 *  2) 行内图标补齐到 22px 槽：模板里的菜单项图标是 15px，CSS 给 3.5px 对称边距，
 *     15 + 3.5×2 必须等于主题芯片宽度——三者任一改动都会让文字再次错行。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Nav.vue'), 'utf8');

type TplProp = {
  name?: string;
  value?: { content?: string };
  arg?: { content?: string };
  exp?: { content?: string };
};
type TplNode = {
  type: number;
  tag?: string;
  props?: TplProp[];
  children?: TplNode[];
};
const classOf = (n: TplNode): string =>
  ((n.props || []).find((p) => p.name === 'class')?.value?.content || '').trim();
/** 取属性值：`:size="15"` 在 SFC AST 里是 name='bind' + arg.content='size' + exp.content='15'，
    静态属性才是 name='size'。两种都要认，否则读到的永远是 0 个。 */
const propOf = (n: TplNode, name: string): string | null => {
  for (const p of n.props || []) {
    if (p.name === name) return p.value?.content ?? null;
    if (p.name === 'bind' && p.arg?.content === name) return p.exp?.content ?? null;
  }
  return null;
};

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 按选择器取声明块。不用「选择器 + 空格 + {」精确匹配：分组选择器会跨行，
    且工作区是 CRLF，换行符写死在断言里会假失败。改为定位选择器后找紧随的 { 并配平。 */
function ruleAfter(cssRaw: string, selector: string): string {
  const css = stripComments(cssRaw);
  const start = css.indexOf(selector);
  expect(start, `样式里没有 ${selector}`).toBeGreaterThan(-1);
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

function decl(rule: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule);
  return m ? m[1].trim() : null;
}

const px = (v: string | null): number => {
  if (v === '0') return 0;
  const m = /^(-?[\d.]+)px$/.exec(v ?? '');
  if (!m) throw new Error(`不是 px 值：${v}`);
  return Number(m[1]);
};

describe('账户菜单：图标列与菜单头共用一条左栏', () => {
  const { descriptor, errors } = parse(source);
  const root = descriptor.template?.ast as unknown as TplNode | undefined;

  it('菜单头左右内边距与菜单项一致（名字落在图标列那条竖线上）', () => {
    const head = ruleAfter(source, '.v2nav__menu-head');
    const item = ruleAfter(source, '.v2nav__menu a');
    const headPad = (decl(head, 'padding') || '').split(/\s+/).map(px);
    const itemPad = (decl(item, 'padding') || '').split(/\s+/).map(px);
    expect(headPad.length, '.v2nav__menu-head 没读到 padding').toBeGreaterThanOrEqual(2);
    expect(itemPad.length).toBeGreaterThanOrEqual(2);
    // padding: 上下 左右 → 左右取第 2 个值
    expect(headPad[1], '菜单头左右内边距与菜单项不一致，名字会比图标列偏出').toBe(itemPad[1]);
  });

  it('行内图标补齐到与主题芯片同宽（15 + 3.5×2 = 22）', () => {
    expect(errors).toEqual([]);
    const menuNode = (() => {
      let found: TplNode | undefined;
      const walk = (n: TplNode) => {
        if (n.type === 1 && classOf(n).split(/\s+/).includes('v2nav__menu')) found = n;
        (n.children || []).forEach(walk);
      };
      if (root) walk(root);
      return found;
    })();
    expect(menuNode, '模板里找不到 .v2nav__menu').toBeTruthy();

    // :size 落在行内图标组件上（UserRound/Trophy/…），不在行节点本身，要往下收
    const collectSizes = (n: TplNode, out: string[] = []): string[] => {
      const s = propOf(n, 'size');
      if (s !== null) out.push(s);
      (n.children || []).forEach((c) => collectSizes(c, out));
      return out;
    };
    const rows = menuNode!.children || [];
    const themeRow = rows.find((r) => classOf(r).includes('v2nav__menu-theme'));
    expect(themeRow, '模板里找不到 .v2nav__menu-theme').toBeTruthy();

    const rowSizes = rows.filter((r) => r !== themeRow).flatMap((r) => collectSizes(r));
    expect(rowSizes.length, '菜单项里没读到图标尺寸').toBeGreaterThanOrEqual(4);
    expect(new Set(rowSizes), '菜单项图标尺寸不一致').toEqual(new Set(['15']));
    expect(new Set(collectSizes(themeRow!)), '主题芯片图标不是 14px').toEqual(new Set(['14']));

    const slot = ruleAfter(source, '.v2nav__menu a > svg');
    const margin = (decl(slot, 'margin') || '').split(/\s+/).map(px);
    // margin: 上下 左右 —— 两值形式本身就保证左右对称；写成四值就可能不对称
    expect(margin.length, '图标槽的 margin 不是两值形式，左右可能不对称').toBe(2);

    const chip = ruleAfter(source, '.v2nav__menu-theme-icon');
    const chipW = px(decl(chip, 'width'));
    expect(
      Number(rowSizes[0]) + margin[1] * 2,
      '图标 + 两侧边距 != 主题芯片宽度：五项文字会再次错行'
    ).toBe(chipW);
  });
});
