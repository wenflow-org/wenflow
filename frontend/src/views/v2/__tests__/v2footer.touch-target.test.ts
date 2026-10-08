/**
 * V2Footer 触控热区护栏（2026-10-08 用户侧走查，发现 #27 / #76）
 *
 * 病根：认证页（compact）底栏两个链接是纯文本内边距撑出来的小热区。1440 桌面档实测——
 *   品牌链接 a.v2footer__brand：136×31（高度差 5px）
 *   愿景链接 a.v2footer__link：31×35（宽、高都差）
 * 宽或高任一 <36 就踩到仓库「可点元素不得低于 36px」的硬线（measure-unit2 的 tinyTargets 判据）。
 * 同一天补过首页/愿景页页脚（f5e5fd53），认证页漏了——登录页复用同一个 V2Footer，一并覆盖。
 * 这里锁住「高度有 36px 下限」「两字链接横向也有 36px 下限」两件事。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Footer.vue'), 'utf8');

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleAfter(src: string, selector: string): string {
  const css = stripComments(src);
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

function px(rule: string, prop: string): number {
  return Number((decl(rule, prop) ?? '0px').replace('px', ''));
}

describe('V2Footer 触控热区', () => {
  it('愿景链接（v2footer__link）≥36×36', () => {
    const rule = ruleAfter(source, '.v2footer__link {');
    expect(decl(rule, 'display'), '链接得是 inline-flex 才能稳稳撑热区').toContain('inline-flex');
    expect(decl(rule, 'align-items')).toContain('center');
    expect(px(rule, 'min-height'), '高度没有 36px 下限').toBeGreaterThanOrEqual(36);
    expect(px(rule, 'min-width'), '两字链接宽度没有 36px 下限').toBeGreaterThanOrEqual(36);
  });

  it('品牌链接（v2footer__brand）高度 ≥36', () => {
    const rule = ruleAfter(source, '.v2footer__brand {');
    expect(decl(rule, 'display')).toContain('inline-flex');
    expect(decl(rule, 'align-items')).toContain('center');
    expect(px(rule, 'min-height'), '品牌链接高度没有 36px 下限').toBeGreaterThanOrEqual(36);
  });
});
