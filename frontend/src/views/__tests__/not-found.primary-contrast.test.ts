import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../NotFound.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleAfter(selector: string): string {
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

describe('404 主按钮深色主题文字对比', () => {
  it('使用语义 on-primary 文字色，避免亮蓝底上固定白字对比不足', () => {
    const primary = ruleAfter('.nf-btn--primary {');
    expect(decl(primary, 'color')).toBe('var(--wf-text-on-primary)');
    expect(decl(primary, 'background')).toBe('var(--color-primary, #2f6ae0)');
  });
});
