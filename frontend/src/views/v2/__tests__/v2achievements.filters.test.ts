/**
 * 成就页筛选分组护栏（2026-10-08 用户侧视觉检查）
 *
 * 病根：状态筛选（全部/已解锁/未解锁）与类型筛选（里程碑/连续学习/…）同款胶囊、
 * 同一排连续排列、没有任何分组线索，而两组是正交维度且可叠加生效——
 * 390 与 1440 两档截图都被读成「一排单选按钮」。
 *
 * 修法：两组各包一层 role="group" 并各带一个 12px 小标签（状态 / 类型）。
 * 本护栏锁住「分组存在」「标签是 12px」「按钮的 44px 热区没被这次改动带走」。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Achievements.vue'), 'utf8');

type TplProp = { name?: string; value?: { content?: string } };
type TplNode = { type: number; tag?: string; props?: TplProp[]; children?: TplNode[] };

const classOf = (n: TplNode): string =>
  ((n.props || []).find((p) => p.name === 'class')?.value?.content || '').trim();
const attrOf = (n: TplNode, name: string): string | null =>
  (n.props || []).find((p) => p.name === name)?.value?.content ?? null;

function nodesWithClass(root: TplNode, cls: string): TplNode[] {
  const found: TplNode[] = [];
  const walk = (n: TplNode) => {
    if (n.type === 1 && classOf(n).split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(root);
  return found;
}

function flattenText(n: TplNode): string {
  if (n.type === 2) return ((n as unknown as { content?: string }).content || '').trim();
  return (n.children || []).map(flattenText).join('');
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
function ruleAfter(selector: string): string {
  const css = stripComments(source);
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
const decl = (rule: string, prop: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;

describe('成就页：两组筛选要能分辨', () => {
  const { descriptor, errors } = parse(source);

  it('状态组与类型组各自成组，且各带一个可见标签', () => {
    expect(errors).toEqual([]);
    const root = descriptor.template?.ast as unknown as TplNode;
    const groups = nodesWithClass(root, 'filter-group');
    expect(groups.length, '筛选没有分组：两排同款胶囊会被读成同一组').toBe(2);
    const labels = groups.map((g) => flattenText(g));
    expect(labels[0]).toContain('状态');
    expect(labels[1]).toContain('类型');
    for (const g of groups) {
      expect(attrOf(g, 'role'), '缺 role=group，读屏也分不出两组').toBe('group');
      expect(attrOf(g, 'aria-label') ?? '', '缺 aria-label，辅助技术读不出分组语义').not.toBe('');
    }
  });

  it('分组标签不低于 12px（compact 档也不破字号下限）', () => {
    const label = ruleAfter('.filter-group__label');
    const size = Number(/^([\d.]+)px$/.exec(decl(label, 'font-size') ?? '')?.[1] ?? 0);
    expect(size, `标签字号 ${size} < 12`).toBeGreaterThanOrEqual(12);
  });

  it('胶囊按钮的 44px 热区没被这次改动带走', () => {
    expect(decl(ruleAfter('.filter '), 'min-height')).toBe('44px');
  });
});
