/**
 * MkChart · 4K/2K CSS zoom 回归锁（2026-11-25 全站缩放走查）。
 *
 * 与 MkGraph.viewport.test.ts 同因：后台 `.ac` 在 2000px+ 有 zoom 1.15、3600px+ 有 1.3，
 * zrender 只认 `offsetX`（视觉 px），而 canvas 坐标系是 `chart.getWidth()` 的逻辑 px。
 * jsdom 起不了 ECharts 画布，按源码锁实现要点。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../MkChart.vue'), 'utf8');

describe('MkChart：CSS zoom 下的命中与栅格化', () => {
  it('捕获阶段把视觉坐标折回逻辑 px 写进 zrX/zrY', () => {
    expect(source).toContain('target.zrX = (clientX - rect.left) / scale');
    expect(source).toContain('target.zrY = (clientY - rect.top) / scale');
    expect(source).toContain('bindZrZoom');
  });

  it('缩放系数取自「容器视觉宽 ÷ 图表逻辑宽」，不硬编码档位', () => {
    expect(source).toContain('root.getBoundingClientRect().width / logicalW');
  });

  it('canvas 位图分辨率同时吃页面 zoom 与 DPR（否则 4K 下纯拉伸发糊）', () => {
    expect(source).toContain('resolveVisualScale(el.value)');
    expect(source).toContain('devicePixelRatio: nextDpr');
  });

  it('zoom 换档 / 换显示器后重建，并监听 visualViewport', () => {
    expect(source).toContain('syncZoom');
    expect(source).toMatch(/visualViewport\?\.addEventListener\('resize', syncZoom\)/);
  });
});
