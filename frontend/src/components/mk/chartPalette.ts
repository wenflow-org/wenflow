/**
 * Admin 图表唯一配色来源（ADMIN_VISUAL_LAYER_SPEC v2 §0.5「数字」节的执法点）。
 *
 * 背景：ECharts 不解析 CSS 变量，series/轴色只能写字面量——此前散在 Overview /
 * VirtualProfile / LearnerDetail 各页（axisLabel #8492ab、主系列 #3d7cff 各写各的）。
 * 规则：主系列蓝、轴/次要系列中性灰蓝、红只给失败/异常、琥珀只给预警；
 * 页面一律 import 本模块或直接省略（MkChart 已注册主题默认值），禁止再写字面量。
 *
 * MkChart.vue 在 init 时传入 'mk-light' / 'mk-dark' 主题（本模块注册），
 * 主题默认色会兜底所有未显式指定颜色的轴与系列。
 */

export interface MkChartPalette {
  /** 主系列（折线/柱） */
  primary: string
  /** 柱状图主系列（浅底上亮一档） */
  primaryBright: string
  /** 轴标签 / 次要系列 */
  neutral: string
  axisLine: string
  splitLine: string
  /** 失败/异常专用（不得当装饰） */
  danger: string
  /** 预警专用 */
  warn: string
  /** 正常/达成语义（折线语义系列用） */
  success: string
}

export const MK_CHART_PALETTES: Record<'light' | 'dark', MkChartPalette> = {
  light: {
    primary: '#2c63d0',
    primaryBright: '#3d7cff',
    neutral: '#8492ab',
    axisLine: 'rgba(23, 32, 51, 0.15)',
    splitLine: 'rgba(23, 32, 51, 0.06)',
    danger: '#f87171',
    warn: '#d97706',
    success: '#15803d',
  },
  dark: {
    primary: '#5b8def',
    primaryBright: '#6a9cf3',
    neutral: '#8d9aad',
    axisLine: 'rgba(230, 237, 247, 0.22)',
    splitLine: 'rgba(230, 237, 247, 0.08)',
    danger: '#f87171',
    warn: '#fbbf24',
    success: '#4ade80',
  },
}

/** ECharts 注册主题名（MkChart init 用）；主题只含「默认兜底」，页面显式色仍优先生效 */
export const MK_CHART_THEME = { light: 'mk-light', dark: 'mk-dark' } as const

/** 记忆保持曲线分类色板（多折线按概念序取模循环；自 VirtualProfile.vue 私有板上移共享，
 *  单测仍从 VirtualProfile.vue 导入——该文件 re-export 这两个名字） */
export const MEMORY_CURVE_COLORS = ['#2c63d0', '#dc2626', '#15803d', '#b7791f', '#7c3aed', '#0891b2'] as const

export function memoryCurveColor(index: number): string {
  return MEMORY_CURVE_COLORS[index % MEMORY_CURVE_COLORS.length]
}
