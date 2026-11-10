import { describe, expect, it } from 'vitest'
import { normalizeFieldValue } from '../useGoalLive'

// boundary-test-2026-09-26 A4：模型偶发把未知字段原样写成 "unknown"，字段卡直接展示了英文原值
describe('useGoalLive 字段值归一化', () => {
  it('"unknown" 任意大小写归一为空（回退「待补充」）', () => {
    expect(normalizeFieldValue('unknown')).toBe('')
    expect(normalizeFieldValue('Unknown')).toBe('')
    expect(normalizeFieldValue('  UNKNOWN  ')).toBe('')
  })

  it('正常值原样保留', () => {
    expect(normalizeFieldValue('三个月（到秋天）')).toBe('三个月（到秋天）')
    expect(normalizeFieldValue('完全没用过 Excel 公式')).toBe('完全没用过 Excel 公式')
    // 合法中文「无」是有效语义（如背景经验为无），不归一
    expect(normalizeFieldValue('无')).toBe('无')
    expect(normalizeFieldValue('  去重空白  ')).toBe('去重空白')
  })

  it('空值安全', () => {
    expect(normalizeFieldValue('')).toBe('')
    expect(normalizeFieldValue(null)).toBe('')
    expect(normalizeFieldValue(undefined)).toBe('')
  })
})
