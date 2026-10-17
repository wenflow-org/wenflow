/**
 * #118 回归：390 宽下 `/learning-state` 整页横向溢出。
 * 根因是 `.state__col` 只有 `display: grid`——隐式 auto 轨按 min-content 解算（实测 387.9px），
 * 把 354px 的容器撑破。修法是显式 `minmax(0, 1fr)`，这里钉住它别再被删掉。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../V2LearningState.vue'), 'utf8');

/** 取某个选择器的 CSS 规则（按行扫描；本文件的规则都是单层、无嵌套） */
function ruleBody(selector: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimStart().startsWith(selector) && line.includes('{'));
  expect(start, `${selector} 的 CSS 规则不存在`).toBeGreaterThan(-1);
  let text = '';
  for (let i = start; i < lines.length; i += 1) {
    text += lines[i] + '\n';
    if (lines[i].includes('}')) break;
  }
  return text;
}

describe('#118 学习状态页窄屏栅格', () => {
  it('.state__col 用显式 minmax(0,1fr) 轨道，子项可收缩', () => {
    expect(ruleBody('.state__col')).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('.state__main 同样显式单列（防止同类隐式轨道溢出）', () => {
    expect(ruleBody('.state__main')).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('不再存在「只有 display: grid; gap」的单列容器（.state__col / .state__main）', () => {
    for (const sel of ['.state__col', '.state__main']) {
      expect(ruleBody(sel), `${sel} 又退回隐式轨道`).not.toMatch(/display:\s*grid;\s*gap:/);
    }
  });
});
