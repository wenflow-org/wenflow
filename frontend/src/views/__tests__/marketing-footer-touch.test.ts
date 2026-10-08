/**
 * 营销页（首页 / 愿景页）页脚触控热区护栏（2026-10-08 用户侧走查）
 *
 * 病根：两页页脚链接是纯文本内边距撑出来的小热区。390 触屏档实测——
 *   首页 .hn-foot__links a：30×34（padding 7px 2px）
 *   愿景 .vn-foot a：26×36（基础 6px 2px，≤900 档被 .vn-foot__in a { padding: 8px 0 } 压回横向 0）
 * 宽或高低于仓库「可点元素不得低于 36px」的硬线（check-mobile-spec 的 lt36 判据是宽高任一 <36）。
 * 修法：min-height 36 + 左右 5px 内边距，再用等量负外边距抵消，视觉间距不变。
 * 这里锁住「高度有下限」「横向内边距不为 0」「负外边距存在（否则行内位置会挪）」三件事。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const home = readFileSync(resolve(here, '../HomeNext.vue'), 'utf8');
const vision = readFileSync(resolve(here, '../VisionNext.vue'), 'utf8');

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleAfter(source: string, selector: string): string {
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

function decl(rule: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule);
  return m ? m[1].trim() : null;
}

/** 横向内边距（`padding: 0 5px` / `padding: 6px 2px` 两种写法都认） */
function padX(rule: string): number {
  const value = decl(rule, 'padding') ?? '';
  const parts = value.split(/\s+/);
  if (parts.length >= 2) return parseFloat(parts[1]);
  return parseFloat(decl(rule, 'padding-left') ?? '0');
}

function expectTouchGrade(rule: string, label: string): void {
  const minHeight = Number((decl(rule, 'min-height') ?? '0px').replace('px', ''));
  expect(minHeight, `${label} 高度没有 36px 下限`).toBeGreaterThanOrEqual(36);
  expect(padX(rule), `${label} 两字链接宽度不足（横向内边距为 0）`).toBeGreaterThanOrEqual(5);
  expect(decl(rule, 'margin'), `${label} 缺等量负外边距，行内视觉位置会挪`).toContain('-5px');
}

describe('营销页页脚触控热区', () => {
  it('首页页脚链接 ≥36×36', () => {
    expectTouchGrade(ruleAfter(home, '.hn-foot__links a'), '首页页脚链接');
  });

  it('愿景页页脚链接 ≥36×36，且窄屏不再把横向内边距压回 0', () => {
    expectTouchGrade(ruleAfter(vision, '.vn-foot a'), '愿景页页脚链接');
    const css = stripComments(vision);
    expect(css, '窄屏又覆写了页脚链接的内边距').not.toContain('.vn-foot__in a {');
  });
});
