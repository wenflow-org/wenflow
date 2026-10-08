/**
 * 忘记密码页两处走查修复（2026-10-08 用户侧视觉检查）的源码锁：
 *
 * #4 提交回执只说「重置方式已生成」，没说去哪儿拿 —— 后端 auth.ts 实际走的是
 *    注册邮箱发信，回执必须点明渠道（「若该账号存在」已足够防枚举，不必连渠道一起藏）。
 * #29 输入框是页面唯一控件，却只有一条 1px 发丝线（--line 对白卡面 1.19:1），
 *    控件范围读不出来 —— 改用提深一档的 --mk-input-line。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sfc = readFileSync(resolve(here, '../V2ResetPassword.vue'), 'utf8');
const mainCss = readFileSync(resolve(here, '../../../styles/main.css'), 'utf8');

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

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

describe('忘记密码页 · 提交回执点明取回渠道', () => {
  it('回执写明发往注册邮箱并提示查收（含垃圾邮件箱）', () => {
    expect(sfc).toMatch(/若该账号存在，重置链接已发送到注册邮箱，请查收（含垃圾邮件箱）。/);
  });

  it('保留「若该账号存在」前置条件，不因点明渠道而变成账号枚举', () => {
    const notice = /notice\.value\s*=\s*'([^']+)'/.exec(sfc)?.[1] ?? '';
    expect(notice.startsWith('若该账号存在')).toBe(true);
  });
});

describe('忘记密码页 · 输入框描边读得出控件范围', () => {
  it('输入框用专用描边档，而不是发丝线 --line', () => {
    const input = ruleAfter(sfc, '.field__input');
    expect(input).toMatch(/border\s*:\s*1px solid var\(--mk-input-line\)\s*;/);
    expect(input).not.toMatch(/border\s*:\s*1px solid var\(--line\)\s*;/);
  });

  it('亮色档把输入框描边提深一档（不再是 --mk-line 的白卡面 1.19:1 发丝线）', () => {
    expect(mainCss).toMatch(/--mk-input-line:\s*#d7dde8\s*;/);
    expect(mainCss).toMatch(/:root\s*\{[^}]*--mk-input-line:\s*#d7dde8\s*;/s);
  });

  it('暗色档复用已提亮的卡片描边档（对卡面 ≥3:1），不动 --mk-line', () => {
    expect(mainCss).toMatch(/--mk-card-line:\s*#6e7075;[\s\S]{0,400}?--mk-input-line:\s*var\(--mk-card-line\)\s*;/);
  });
});
