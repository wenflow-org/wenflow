/**
 * 账户菜单的左对齐护栏（2026-10-08 建立；2026-11-06 走查后改锁新方案）
 *
 * 2026-11-06 走查：主题切换项的 22px 键帽芯片（.v2nav__menu-theme-icon）与其余行的
 * 15px 裸线图标长得不一样（蓝底方块 vs 灰线），同菜单两种图标语言。芯片拆除，
 * 主题项与其余项完全同规格：15px 线图标 + muted 色 + 3.5px 对称边距。
 *
 * 附带：菜单头内边距与菜单项同值（名字左缘落在图标列那条竖线上）。
 *
 * 本护栏锁两件事：
 *  1) 菜单头左右内边距 = 菜单项内边距（同一左栏，不许再各写各的）；
 *  2) 六行图标全同规格：所有行内图标一律 15px、走 `> svg` 直接子选择器染色 muted、
 *     对称两值 margin——任何一行再搞特殊图标（芯片/异色/异径）都会被这里拦下。
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

  it('六行图标全同规格：一律 15px 裸线图标，芯片不得复辟', () => {
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
    const rowSizes = rows.flatMap((r) => collectSizes(r));
    expect(rowSizes.length, '菜单项里没读到图标尺寸').toBeGreaterThanOrEqual(5);
    /* 含主题切换在内的每一行都是 15px——出现任何其它尺寸即错行 */
    expect(new Set(rowSizes), '菜单行图标尺寸不一致（主题行必须与其余行同规格）').toEqual(new Set(['15']));
    /* 芯片不得复辟：包裹 span + 独立图标类都不该再出现 */
    expect(source).not.toContain('v2nav__menu-theme-icon');

    const slot = ruleAfter(source, '.v2nav__menu a > svg');
    const margin = (decl(slot, 'margin') || '').split(/\s+/).map(px);
    // margin: 上下 左右 —— 两值形式本身就保证左右对称；写成四值就可能不对称
    expect(margin.length, '图标槽的 margin 不是两值形式，左右可能不对称').toBe(2);
    expect(decl(slot, 'color')).toBe('var(--muted)');
    expect(source).toContain('.v2nav__menu button > svg {');
    expect(source).not.toContain('.v2nav__menu button svg {');
    expect(source).not.toContain('.v2nav__menu a svg,');
  });
});
