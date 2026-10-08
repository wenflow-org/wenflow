/**
 * ToastHost 形态护栏（2026-10-08 用户侧：「以前右上角彩色那版我更习惯」）
 *
 * 形态在 25112eb6 被改成「底部居中深底胶囊」（对齐 newui 原型 .wf-toasts），
 * 本次按用户明确偏好改回右上角浅底卡片 + 语义色圆底图标。这里锁住这次回退的识别点，
 * 免得下一次「对齐原型」把它们无声改掉：
 *  1. 宿主锚在右上角（不再是 left:50% + bottom + translateX(-50%) 的底部居中）；
 *  2. 四类图标是 50% 圆底 + 语义色（--mk-green/red/amber/blue），这是「彩色」的来源；
 *  3. 卡片是 --mk-surface 浅底（不是 --mk-toast-bg 深底胶囊）；
 *  4. 入场方向跟着锚点走：自右上方滑入（底部浮层那版的向上推入已退役）；
 *  5. hover 不抬升不加投影（仓库 §0.5「友好而平」）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../ToastHost.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
const flat = css.replace(/\s+/g, ' ');

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

function decl(rule: string, prop: string): string | null {
  const match = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule);
  return match ? match[1].trim() : null;
}

describe('ToastHost 形态（右上角 + 语义色圆底图标）', () => {
  it('宿主锚在右上角，不是底部居中', () => {
    const host = ruleFor('.toast-host {');
    expect(decl(host, 'position')).toBe('fixed');
    expect(decl(host, 'right'), '右锚点丢了').toBe('20px');
    expect(decl(host, 'top') ?? '', '上锚点丢了').toContain('20px');
    expect(decl(host, 'bottom'), '又回到贴底了').toBeNull();
    expect(decl(host, 'left')).toBeNull();
    expect(decl(host, 'transform') ?? '', '底部居中那版的 translateX(-50%) 又出现了').not.toContain('translateX(-50%)');
  });

  it('四类图标是 50% 圆底 + 语义色（「彩色」的识别点）', () => {
    expect(decl(ruleFor('.toast-icon {'), 'border-radius')).toBe('50%');
    const types: Array<[string, string]> = [
      ['success', '--mk-green'],
      ['error', '--mk-red'],
      ['warning', '--mk-amber'],
      ['info', '--mk-blue'],
    ];
    for (const [type, token] of types) {
      const rule = ruleFor(`.toast-icon--${type} {`);
      expect(rule, `${type} 图标丢了语义色`).toContain(`var(${token})`);
      expect(rule, `${type} 图标丢了圆底 tint`).toContain('color-mix(');
      expect(decl(rule, 'background') ?? '', `${type} 图标没有底色`).toContain('transparent');
    }
  });

  it('卡片是浅底 surface（深底胶囊那版已退役）', () => {
    const item = ruleFor('.toast-item {');
    expect(decl(item, 'background')).toContain('var(--mk-surface)');
    expect(decl(item, 'color')).toContain('var(--mk-ink)');
    expect(flat, '卡片又用回深底胶囊 token').not.toContain('var(--mk-toast-bg)');
    expect(flat, '文字又用回深底胶囊的成对前景色').not.toContain('var(--mk-toast-fg)');
  });

  it('入场方向跟着锚点：自右上方滑入，不是自下推入', () => {
    const enterFrom = ruleFor('.toast-slide-enter-from {');
    expect(enterFrom).toContain('translateY(-12px)');
    expect(enterFrom).toContain('translateX(8px)');
    expect(decl(enterFrom, 'transform') ?? '', '又变成底部那版的自下推入了').not.toContain('translateY(10px)');
  });

  it('hover 不抬升不加投影（§0.5「友好而平」）', () => {
    expect(flat, '又给卡片加了 hover 投影').not.toContain('.toast-item:hover');
  });
});
