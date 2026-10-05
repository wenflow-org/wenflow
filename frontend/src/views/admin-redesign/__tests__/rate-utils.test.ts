/**
 * rate-utils（成功率口径单点）：
 * - 阈值分档：<90 红 / <97 琥珀 / 其余 ok / 无数据 muted
 * - 精度：1 位小数，99.9% 不再被 toFixed(0) 抹成 100%（P1#26）
 * - 兜底：无分母 / 非法值 → null（调用方渲染「—」，不显示 0%）
 * - tone → 页面本地类名映射（ok/muted 不着色）
 */
import { describe, expect, it } from 'vitest'
import {
  RATE_BAD_BELOW,
  RATE_WARN_BELOW,
  RATE_DECIMALS,
  RATE_THRESHOLD_NOTE,
  rateToneOf,
  successRateOf,
  successRateText,
  successRateTone,
  formatRate,
  rateToneClass,
  type RateTone,
} from '../rate-utils'

describe('rate-utils 阈值常量（四页收敛后的唯一口径）', () => {
  it('阈值 = <90 红 / <97 琥珀，精度 1 位小数，且披露文案携带三档', () => {
    expect(RATE_BAD_BELOW).toBe(90)
    expect(RATE_WARN_BELOW).toBe(97)
    expect(RATE_DECIMALS).toBe(1)
    expect(RATE_THRESHOLD_NOTE).toContain('<90% 红')
    expect(RATE_THRESHOLD_NOTE).toContain('<97% 琥珀')
    expect(RATE_THRESHOLD_NOTE).toContain('1 位小数')
  })
})

describe('rateToneOf（已知比率 → tone）', () => {
  it('边界：<90 红、[90,97) 琥珀、>=97 正常', () => {
    expect(rateToneOf(0)).toBe('bad')
    expect(rateToneOf(60)).toBe('bad')
    expect(rateToneOf(89.9)).toBe('bad')
    expect(rateToneOf(90)).toBe('warn')
    expect(rateToneOf(96.9)).toBe('warn')
    expect(rateToneOf(97)).toBe('ok')
    expect(rateToneOf(100)).toBe('ok')
  })

  it('无数据 / 非法值 → muted（「不知道」不得冒充「正常」或「异常」）', () => {
    expect(rateToneOf(null)).toBe('muted')
    expect(rateToneOf(undefined)).toBe('muted')
    expect(rateToneOf(Number.NaN)).toBe('muted')
  })
})

describe('successRateOf / successRateText / successRateTone（calls+errors 入口）', () => {
  it('99.9% 保持 99.9%（P1#26：toFixed(0) 曾把它抹成 100%）', () => {
    expect(successRateOf(1000, 1)).toBeCloseTo(99.9, 5)
    expect(successRateText(1000, 1)).toBe('99.9%')
    expect(successRateTone(1000, 1)).toBe('ok')
  })

  it('整值省略「.0」，小数保留 1 位', () => {
    expect(successRateText(150, 35)).toBe('76.7%')
    expect(successRateText(100, 0)).toBe('100%')
    expect(successRateText(100, 30)).toBe('70%')
  })

  it('无分母（calls=0）→ null / muted：不显示 0% 伪装失败', () => {
    expect(successRateOf(0, 0)).toBeNull()
    expect(successRateText(0, 0)).toBeNull()
    expect(successRateTone(0, 0)).toBe('muted')
  })

  it('异常数据钳制到 [0,100]（errors > calls 不产生负成功率）', () => {
    expect(successRateOf(10, 20)).toBe(0)
    expect(successRateText(10, 20)).toBe('0%')
  })

  it('四页旧阈值全部失效：77% 在新口径下是红不是琥珀（旧 Skills <70/<90）', () => {
    expect(successRateTone(150, 35)).toBe('bad')
  })
})

describe('formatRate（后端直发 passRate 入口，PromptEval 用）', () => {
  it('整数不带 .0，小数保留 1 位，缺失 → null', () => {
    expect(formatRate(92)).toBe('92%')
    expect(formatRate(99.9)).toBe('99.9%')
    expect(formatRate(null)).toBeNull()
    expect(formatRate(undefined)).toBeNull()
  })
})

describe('rateToneClass（tone → 页面本地类名）', () => {
  const cases: Array<[RateTone, string, string]> = [
    ['bad', 'sk-rate', 'sk-rate--bad'],
    ['warn', 'pe-result', 'pe-result--warn'],
    ['bad', 'mk-status__meta', 'mk-status__meta--bad'],
    ['ok', 'sk-rate', ''],
    ['muted', 'pe-result', ''],
  ]
  it.each(cases)('%s + %s → %s', (tone, prefix, expected) => {
    expect(rateToneClass(tone, prefix)).toBe(expected)
  })
})
