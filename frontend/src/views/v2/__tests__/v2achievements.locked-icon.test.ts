/**
 * 成就页未解锁图标护栏（2026-10-08 用户侧走查）
 *
 * 病根：未解锁成就的类型图标一律落到 ach-card__icon--neutral，14 张未解锁卡的类型色被抹平——
 * 里程碑/连续/完成/掌握四种类型在锁定态完全无法区分，而「类型/状态图标要能靠语义色区分」
 * 是用户明确表达过的口径。修法：未解锁保持同一色相，只加一层 --locked 压淡，
 * 「未解锁」由卡整体 opacity 与状态行文案表态，不靠抹掉颜色。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Achievements.vue'), 'utf8');

/** 取脚本里 iconCls 的函数体 */
function iconClsBody(): string {
  const start = source.indexOf('function iconCls(');
  expect(start, '源码里找不到 iconCls').toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}

const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
const decl = (rule: string, prop: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;
function ruleFor(selector: string): string {
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

describe('成就页未解锁图标', () => {
  it('未解锁也按类型给色相（不再一律中性灰）', () => {
    const body = iconClsBody();
    expect(body, '未解锁又落回中性灰块了').not.toMatch(/'ach-card__icon--neutral'\s*:/);
    expect(body).toContain('ach-card__icon--locked');
    // 色相来自同一张类型表
    expect(body).toContain('ACH_TYPE_TONE[a.type]');
  });

  it('未解锁靠 --locked 压淡表态，且不改变色块尺寸', () => {
    const locked = ruleFor('.ach-card__icon--locked');
    const opacity = Number(decl(locked, 'opacity'));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity, '压得太狠等于又灰掉了').toBeLessThan(1);
    // 色块本体尺寸仍是 42×42（压淡不该顺手改尺寸）
    const base = ruleFor('.ach-card__icon {');
    expect(decl(base, 'width')).toBe('42px');
    expect(decl(base, 'height')).toBe('42px');
  });

  it('五种类型色相都还在（压淡不等于删色）', () => {
    for (const tone of ['streak', 'complete', 'mastery', 'milestone', 'social']) {
      expect(ruleFor(`.ach-card__icon--${tone} {`), `${tone} 类型色丢了`).toContain('color-mix(');
    }
  });
});
