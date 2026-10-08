/**
 * 学习状态趋势图 Y 轴刻度护栏（2026-10-08 用户侧走查）
 *
 * 病根：刻度列宽是图宽的 6.05%（原型 AXIS_W 46/760）。1440 档约 45px 够放「-85」，
 * 但窄屏图表只有 329px，该列仅 20px（减 right:6px 后 14px），三字刻度被折成竖排数字堆
 * （390 实测刻度框 14×24~36px），整列读不出来。修法是 nowrap：刻度向左借卡片左内边距，
 * 列宽不动。这里锁住它不被「对齐原型」的批次改回可折行。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningState.vue'), 'utf8');
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

describe('学习状态趋势图 Y 轴刻度', () => {
  it('刻度不折行（窄屏列宽只有 ~14px，可折行会把数字堆成竖排）', () => {
    const span = ruleAfter('.ff-yaxis span');
    expect(decl(span, 'white-space'), '刻度又变成可折行了').toBe('nowrap');
  });

  it('刻度列宽与右缩进保持原型口径（6.05% / right 6px），不靠改列宽来修', () => {
    const axis = ruleAfter('.ff-yaxis {');
    expect(decl(axis, 'width')).toBe('6.05%');
    expect(decl(ruleAfter('.ff-yaxis span'), 'right')).toBe('6px');
  });
});
