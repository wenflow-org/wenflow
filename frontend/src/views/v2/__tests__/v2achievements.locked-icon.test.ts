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

  it('锁定态标签文字用墨色，且不再自带透明度', () => {
    // 整卡 .ach-card--locked 的 0.78 已把带色相文字压到 4.5:1 以下（实测浅色档
    // --accent 2.39 / --purple-ink 2.98 / --green-ink 3.49），标签改用与卡内标题同级的墨色；
    // 类型区分交给色块底色。另：0.75 的重复压暗必须保持撤销。
    const locked = ruleFor('.ach-card__icon--locked');
    expect(decl(locked, 'opacity'), '锁定标签不该再自带透明度').toBeNull();
    const color = decl(locked, 'color');
    expect(color, '--locked 必须显式给出文字色').not.toBeNull();
    expect(color, '锁定标签必须用墨色').toMatch(/var\(--ink\)/);
    for (const tone of ['--accent', '--amber-ink', '--green-ink', '--blue-deep', '--cyan-ink']) {
      expect(color, `锁定标签不该用带色相的 ${tone}`).not.toContain(tone);
    }
    // 色块本体尺寸仍是 42×42（改文字色不该顺手改尺寸）
    const base = ruleFor('.ach-card__icon {');
    expect(decl(base, 'width')).toBe('42px');
    expect(decl(base, 'height')).toBe('42px');
  });

  it('未解锁的类型色相由色块底色保留（文字转墨色后，底色就是类型编码）', () => {
    for (const tone of ['streak', 'complete', 'mastery', 'milestone', 'social']) {
      const rule = ruleFor(`.ach-card__icon--${tone} {`);
      expect(decl(rule, 'background'), `${tone} 类型底色丢了`).toContain('color-mix(');
    }
  });

  it('五种类型色相都还在（压淡不等于删色）', () => {
    for (const tone of ['streak', 'complete', 'mastery', 'milestone', 'social']) {
      expect(ruleFor(`.ach-card__icon--${tone} {`), `${tone} 类型色丢了`).toContain('color-mix(');
    }
  });
});
