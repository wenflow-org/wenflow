import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../v2.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function ruleAfter(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `样式里没有 ${selector}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${selector} 声明块不配平`);
}

describe('v2 主按钮文字语义色', () => {
  it('使用主题 on-primary token，避免深色主题白字对比度不足', () => {
    const rule = ruleAfter(css, '.v2-page .btn-primary');
    expect(rule).toMatch(/background\s*:\s*var\(--blue\)\s*;/);
    expect(rule).toMatch(/color\s*:\s*var\(--wf-text-on-primary\)\s*;/);
    expect(rule).not.toMatch(/color\s*:\s*#fff(?:fff)?\s*;/i);
  });
});
