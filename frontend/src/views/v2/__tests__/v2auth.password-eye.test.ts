/**
 * 登录 / 注册「显示密码」按钮热区护栏（2026-10-08 用户侧视觉检查）
 *
 * 两个页面的 .field__eye 都是 34×34px，低于仓库自己那条硬线「任何可点元素不低于 36px」。
 * 之所以一直没被门禁抓到：mobile:spec 的量测清单里没有 /login 与 /register，
 * 这两页从未进入过四类指标的度量范围。这里用样式断言把它补进护栏。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

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

const px = (v: string | null): number => {
  const m = /^([\d.]+)px$/.exec(v ?? '');
  if (!m) throw new Error(`不是 px 值：${v}`);
  return Number(m[1]);
};

const MIN_TARGET = 36;

describe.each([
  ['登录', readFileSync(resolve(here, '../V2Login.vue'), 'utf8')],
  ['注册', readFileSync(resolve(here, '../V2Register.vue'), 'utf8')],
])('%s页：显示密码按钮不破 36px 热区地板', (_label, sfc) => {
  it('.field__eye 宽高都不低于 36px', () => {
    const eye = ruleAfter(sfc as string, '.field__eye');
    const w = px(
      new RegExp('(?:^|[;{\\s])width\\s*:\\s*([^;]+);').exec(eye)?.[1]?.trim() ?? null,
    );
    const h = px(
      new RegExp('(?:^|[;{\\s])height\\s*:\\s*([^;]+);').exec(eye)?.[1]?.trim() ?? null,
    );
    expect(w, `宽度 ${w} < ${MIN_TARGET}`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(h, `高度 ${h} < ${MIN_TARGET}`).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('输入框右内边距仍给按钮留出位置（按钮放大后不压到输入文字）', () => {
    const input = ruleAfter(sfc as string, '.field__pwd .field__input');
    const right = px(
      new RegExp('(?:^|[;{\\s])padding-right\\s*:\\s*([^;]+);').exec(input)?.[1]?.trim() ?? null,
    );
    expect(right, 'padding-right 必须大于按钮宽度，否则文字会钻到按钮下面').toBeGreaterThan(MIN_TARGET);
  });
});
