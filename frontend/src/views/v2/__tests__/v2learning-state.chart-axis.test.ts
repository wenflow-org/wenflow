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
const flat = css.replace(/\s+/g, ' ');

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

describe('学习状态趋势图反挤压（2026-10-08 用户：容易挤压）', () => {
  it('图区有高度下限：SVG 是 760×240 拉满宽度，390 档自然高度只有 104px', () => {
    const svg = ruleAfter('.ff-chart svg');
    const minHeight = Number((decl(svg, 'min-height') ?? '0px').replace('px', ''));
    expect(minHeight, '图区又被压回宽度 × 0.316 的自然高度').toBeGreaterThanOrEqual(180);
    expect(decl(svg, 'height')).toBe('auto');
  });

  it('首尾刻度会向外探半个字高，图区上下必须留白（否则撞上图例/信息行）', () => {
    const chart = ruleAfter('.ff-chart {');
    // margin 简写：1 值=四边；2 值=上下/左右；3 值=上/左右/下；4 值=上/右/下/左
    const parts = (decl(chart, 'margin') ?? '').trim().split(/\s+/).map((v) => parseFloat(v));
    const top = parts[0] ?? 0;
    const bottom = parts.length >= 3 ? (parts[2] ?? 0) : (parts[0] ?? 0);
    expect(top, '图区上方没有留白，首刻度会压到图例').toBeGreaterThanOrEqual(8);
    expect(bottom, '图区下方没有留白，末刻度会压到信息行').toBeGreaterThanOrEqual(8);
  });

  it('阈值文字不再浮在图内（自带 surface 底会压住曲线），改为图例里的虚线项', () => {
    expect(flat, '阈值标签又回到图内浮层了').not.toContain('.ff-zonetag');
    expect(flat, '阈值标签容器又回到图内浮层了').not.toContain('.ff-zones');
    expect(flat, '图内不该再有阈值标签节点').not.toContain('class="ff-zonetag"');
    expect(flat, '图例里缺少阈值项').toContain('.ff-legend__zone');
    // 分隔符必须是 DOM 真实文本：::before 生成内容不进 DOM，读屏会念成连读
    expect(flat, '阈值分隔符又退回 ::before 了').not.toContain('b + b::before');
    expect(flat, '阈值分隔符应该是 DOM 里的真实文本').toContain('ff-legend__sep');
    // 虚线本体留在图内（保留信息）
    expect(flat).toContain('ff-zone');
  });
});
