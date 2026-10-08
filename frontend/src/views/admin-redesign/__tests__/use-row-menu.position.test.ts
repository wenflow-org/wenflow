/**
 * 行菜单弹层定位回归（2026-10-08）：`.mk-menu__pop` 的 CSS 保留 `right: 0`，
 * 与内联 `left` 在 fixed + width:auto 下同时生效，会把菜单拉成两锚点之间的横条
 * （实测账号页签 ⋯ 在 x=1037 时宽 871px，应为 148px；表格最右列 x≈1845 时恰好
 * 等于 148px，所以长期没暴露）。定位算法是纯函数，这里直接覆盖边界与对齐，
 * 不依赖 DOM 时序。
 */
import { describe, expect, it } from 'vitest';
import { popPositionOf } from '../useRowMenu';

const POP = { popWidth: 148, popHeight: 48, zoom: 1 };

function box(left: number, top = 100, width = 28, height = 28) {
  return { left, top, right: left + width, bottom: top + height };
}

describe('popPositionOf 弹层定位', () => {
  it('解除 CSS right:0 约束（right:auto），否则宽度会被拉到视口右缘', () => {
    const style = popPositionOf({ ...POP, trigger: box(1037), viewportWidth: 1920, viewportHeight: 1080 });
    expect(style.position).toBe('fixed');
    expect(style.right).toBe('auto');
  });

  it('偏左触发器：菜单右缘贴触发钮右缘，不再以触发钮左缘为锚', () => {
    const trigger = box(1037);
    const style = popPositionOf({ ...POP, trigger, viewportWidth: 1920, viewportHeight: 1080 });
    const left = parseFloat(style.left);
    expect(left + POP.popWidth).toBeCloseTo(trigger.right, 5);
    // 旧实现以触发钮左缘为锚（left=1037），再叠加 CSS right:0 → 盒子宽度 = 视口右缘 - 1037 ≈ 883px
    expect(left).not.toBeCloseTo(trigger.left, 5);
  });

  it('贴近视口右缘的触发器（表格最右列）：仍落在视口内且不越界', () => {
    const trigger = box(1845);
    const style = popPositionOf({ ...POP, trigger, viewportWidth: 1920, viewportHeight: 1080 });
    const left = parseFloat(style.left);
    expect(left + POP.popWidth).toBeLessThanOrEqual(1920 - 8);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it('靠近视口左缘时贴边，不回移成负坐标', () => {
    const style = popPositionOf({ ...POP, trigger: box(0, 100, 24, 24), viewportWidth: 1920, viewportHeight: 1080 });
    expect(parseFloat(style.left)).toBeGreaterThanOrEqual(8);
  });

  it('下方空间不足时翻到触发钮上方', () => {
    const style = popPositionOf({ ...POP, trigger: box(1000, 1040), viewportWidth: 1920, viewportHeight: 1080 });
    const top = parseFloat(style.top);
    expect(top).toBeLessThanOrEqual(1040);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it('4K zoom 档：坐标按 zoom 换算回逻辑像素，菜单右缘仍不越视口', () => {
    const style = popPositionOf({
      popWidth: 148,
      popHeight: 60,
      zoom: 1.3,
      trigger: { left: 2400, top: 520, right: 2440, bottom: 556 },
      viewportWidth: 3840,
      viewportHeight: 2160
    });
    const left = parseFloat(style.left);
    expect(left + 148).toBeLessThanOrEqual(3840 - 8);
    expect(left).toBeGreaterThan(0);
  });
});
