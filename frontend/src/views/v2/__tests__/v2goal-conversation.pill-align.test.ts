/**
 * 移动端「目标信息」药丸与阶段导航同高的护栏（2026-10-07 实测 390 视口）
 *
 * 病根：.panel 是绝对定位的「零占位锚点带」，药丸靠 align-items:center 落在这条带的中线上；
 * 而 .chat__head 是另一条带（padding 10 + .stage-nav__item 40 + padding 10 = 60）。
 * 两条带各自居中，**只要高度不一致，药丸就会偏离阶段导航的中线**。
 * 2026-10-07 实测：.panel 写死 height:47px（早于「阶段导航抬到 40px 触控下限」那次改动），
 * 药丸中心 96.2 vs 阶段导航中心 102.7 —— 药丸比它该在的那一行高 6.5px，
 * 看起来是「浮」在阶段导航上方的孤立小卡。
 *
 * 护栏锁三件事，缺一不可（jsdom 没有布局，只能锁源码里那条可推导的等式）：
 *  1) .panel 不再写死 height —— 写死值会随 .stage-nav__item 的高度漂移（这就是本次的病因）；
 *  2) 两条带的上下 padding 相同（都取自 .chat__head 的 10px）；
 *  3) .panel__head 的 min-height 与 .stage-nav__item 的 min-height 相同 ——
 *     两条带的高度 = padding*2 + 各自子元素高度，子元素等高才是真正的等高条件。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');

/** 取出 @media (max-width: 1100px) 整块（移动端药丸规则都在这里） */
function mobileBlock(): string {
  const marker = '@media (max-width: 1100px) {';
  const start = source.indexOf(marker);
  expect(start, `文件里没有 ${marker}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${marker} 不闭合`);
}

/** 从 `.sel {` 起花括号配平，取出一条声明块 */
function ruleOf(css: string, selector: string): string {
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

/** 读一条声明的值；缺失返回 null（不抛错，缺失本身由调用方断言） */
function decl(rule: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule);
  return m ? m[1].trim() : null;
}

const px = (v: string | null): number | null => {
  if (v === null) return null;
  // 0 可以不带单位（`padding: 10px 0` 是常态写法），其余必须带 px
  if (v === '0') return 0;
  const m = /^(-?[\d.]+)px$/.exec(v);
  return m ? Number(m[1]) : null;
};

/** 上下 padding 的数值（简写四值：`a` / `a b` / `a b c` / `a b c d` 都要能读） */
function verticalPadding(rule: string): { top: number; bottom: number } | null {
  const v = decl(rule, 'padding');
  if (!v) return null;
  const parts = v.split(/\s+/).map((p) => px(p));
  if (parts.some((p) => p === null)) return null;
  const n = parts as number[];
  if (n.length === 1) return { top: n[0], bottom: n[0] };
  if (n.length === 2) return { top: n[0], bottom: n[0] };
  if (n.length === 3) return { top: n[0], bottom: n[2] };
  return { top: n[0], bottom: n[2] };
}

describe('移动端目标信息药丸：与阶段导航严格同高', () => {
  const mobile = mobileBlock();

  it('.panel 锚点带不写死 height（写死值会随阶段导航高度漂移，2026-10-07 的病根）', () => {
    const rule = ruleOf(mobile, '.panel');
    expect(
      decl(rule, 'height'),
      '.panel 写死了 height：它与 .chat__head 是两条独立居中的带，写死值一旦与阶段导航的实际高度不一致，药丸就会偏离中线'
    ).toBe('auto');
  });

  it('.panel 与 .chat__head 用同一条上下 padding', () => {
    const panelPad = verticalPadding(ruleOf(mobile, '.panel'));
    const headPad = verticalPadding(ruleOf(source, '.chat__head'));
    expect(panelPad, '.panel 没读到上下 padding').toBeTruthy();
    expect(headPad, '.chat__head 没读到上下 padding').toBeTruthy();
    expect(panelPad, `.panel 上下 padding ${JSON.stringify(panelPad)} 与 .chat__head ${JSON.stringify(headPad)} 不一致，两条带中线会错开`).toEqual(headPad);
  });

  it('.panel__head 与 .stage-nav__item 同高（两条带等高的真正条件）', () => {
    const pillH = px(decl(ruleOf(mobile, '.panel__head'), 'min-height'));
    const navH = px(decl(ruleOf(mobile, '.stage-nav__item'), 'min-height'));
    expect(pillH, '.panel__head 没读到 min-height').not.toBeNull();
    expect(navH, '.stage-nav__item 没读到 min-height').not.toBeNull();
    expect(
      pillH,
      `药丸 min-height ${pillH} ≠ 阶段导航 ${navH}：两条带的高度差会让药丸偏离中线`
    ).toBe(navH);
  });

  it('药丸自身高度 ≥36（mobile:spec 的触控下沿），且不因对齐被压回 38 以下', () => {
    const pillH = px(decl(ruleOf(mobile, '.panel__head'), 'min-height'));
    expect(pillH).not.toBeNull();
    expect(pillH!).toBeGreaterThanOrEqual(36);
  });
});
