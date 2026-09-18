/**
 * 记忆保持曲线纯函数测试（Q2 记忆看板）：
 * buildMemoryRetentionChartOption 必须无副作用、空数据不抛错，且把后端 retention-series
 * 的曲线正确映射为 ECharts option（x 轴采样日、y 轴 0-1、每条概念一条线）。
 */
import { describe, expect, it } from 'vitest';
import {
  MEMORY_CURVE_COLORS,
  buildMemoryRetentionChartOption,
  memoryCurveColor,
  type MemoryCurveConcept,
} from '../VirtualProfile.vue';

interface OptionShape {
  xAxis?: { data?: string[] };
  yAxis?: { min?: number; max?: number; axisLabel?: { formatter?: (value: number) => string } };
  series?: Array<{
    name?: string;
    type?: string;
    data?: number[];
    lineStyle?: { color?: string };
    itemStyle?: { color?: string };
  }>;
}

function asOption(value: unknown): OptionShape {
  return value as OptionShape;
}

function concept(overrides: Partial<MemoryCurveConcept> = {}): MemoryCurveConcept {
  return {
    name: '离开前翻页立好',
    label: '离开前翻页立好',
    bucket: 'due',
    curve: {
      days: [0, 1, 3, 7, 14, 30],
      retention: [1, 0.9, 0.75, 0.55, 0.35, 0.2],
      elapsedDays: 3,
      currentRetention: 0.75,
    },
    ...overrides,
  };
}

describe('buildMemoryRetentionChartOption（记忆保持曲线）', () => {
  it('空数据返回可渲染的空 option（不抛错）', () => {
    const option = asOption(buildMemoryRetentionChartOption([]));
    expect(option.series).toEqual([]);
    expect(option.xAxis?.data).toEqual([]);
    expect(option.yAxis?.min).toBe(0);
    expect(option.yAxis?.max).toBe(1);
  });

  it('每条概念一条平滑折线，data 与后端 curve.retention 对齐', () => {
    const option = asOption(
      buildMemoryRetentionChartOption([
        concept(),
        concept({
          name: '最小重启动作',
          label: '最小重启动作',
          bucket: 'mastered',
          curve: { days: [0, 1, 3, 7, 14, 30], retention: [1, 0.95, 0.9, 0.85, 0.8, 0.7], elapsedDays: 1, currentRetention: 0.95 },
        }),
      ])
    );
    expect(option.series).toHaveLength(2);
    expect(option.series?.[0]).toMatchObject({ type: 'line', name: '离开前翻页立好' });
    expect(option.series?.[0].data).toEqual([1, 0.9, 0.75, 0.55, 0.35, 0.2]);
    expect(option.series?.[1].data).toEqual([1, 0.95, 0.9, 0.85, 0.8, 0.7]);
  });

  it('x 轴把采样日 [0,1,3,7,14,30] 映射为「刚复习 / 第N天」', () => {
    const option = asOption(buildMemoryRetentionChartOption([concept()]));
    expect(option.xAxis?.data).toEqual(['刚复习', '第1天', '第3天', '第7天', '第14天', '第30天']);
  });

  it('y 轴固定 0-1，轴标签按百分比展示', () => {
    const option = asOption(buildMemoryRetentionChartOption([concept()]));
    expect(option.yAxis?.min).toBe(0);
    expect(option.yAxis?.max).toBe(1);
    expect(option.yAxis?.axisLabel?.formatter?.(0.75)).toBe('75%');
  });

  it('缺 label 时回退 name；缺 curve.retention 时给空数组（不抛错）', () => {
    const option = asOption(
      buildMemoryRetentionChartOption([
        concept({ label: null }),
        { name: '无曲线', curve: { days: [], retention: undefined as unknown as number[], elapsedDays: 0, currentRetention: 0 } },
      ])
    );
    expect(option.series?.[0].name).toBe('离开前翻页立好');
    expect(option.series?.[1].name).toBe('无曲线');
    expect(option.series?.[1].data).toEqual([]);
  });
});

describe('memoryCurveColor（图例与曲线同序取色）', () => {
  it('按索引取色并循环', () => {
    expect(memoryCurveColor(0)).toBe(MEMORY_CURVE_COLORS[0]);
    expect(memoryCurveColor(MEMORY_CURVE_COLORS.length)).toBe(MEMORY_CURVE_COLORS[0]);
  });

  it('构建器为每条线使用与图例一致的配色', () => {
    const option = asOption(buildMemoryRetentionChartOption([concept(), concept({ name: 'B', label: 'B' })]));
    expect(option.series?.[0].lineStyle?.color).toBe(memoryCurveColor(0));
    expect(option.series?.[1].lineStyle?.color).toBe(memoryCurveColor(1));
  });
});
