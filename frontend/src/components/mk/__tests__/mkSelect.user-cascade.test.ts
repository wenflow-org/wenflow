/**
 * MkSelect 在用户侧的级联守卫（2026-10-28）
 *
 * 现象：用户侧 `.v2-page button:where(...)` 的归零规则特异性是 (0,1,1)，
 * 压过 MkSelect 全局样式里裸 `.mk-select__trigger` 的 (0,1,0)。结果下拉在
 * 用户页面变成透明底 + 深色边框 + 16px 字体，看起来像浏览器默认控件，
 * 而 admin 页（没有这条归零）正常。
 *
 * 这里锁两条约束，任一被改回去都会重新出现「用户侧下拉像原生控件」：
 * ① 触发器基础样式至少两层选择器（.mk-select .mk-select__trigger）；
 * ② v2 按钮归零显式排除 MK 下拉触发器。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const selectCss = readFileSync(resolve(root, 'src/styles/mk-select.css'), 'utf8');
const v2Css = readFileSync(resolve(root, 'src/views/v2/v2.css'), 'utf8');

describe('MkSelect 用户侧级联', () => {
  it('触发器基础样式用两层选择器，压过 v2 的按钮归零', () => {
    expect(selectCss).toMatch(/\.mk-select \.mk-select__trigger\s*\{/);
    expect(selectCss).not.toMatch(/^\.mk-select__trigger\s*\{/m);
  });

  it('v2 按钮归零排除 MK 下拉触发器', () => {
    const start = v2Css.indexOf('.v2-page button:where');
    expect(start).toBeGreaterThan(-1);
    const rule = v2Css.slice(start, v2Css.indexOf('{', start));
    expect(rule).toContain(':not(.mk-select__trigger)');
    expect(rule).toContain(':not(.mk-pillselect)');
  });
});
