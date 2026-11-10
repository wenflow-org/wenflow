/**
 * 掌握度「有读数」判据（2026-11-10 逻辑矛盾检索）：0 分是上游「没测过」的哨兵值，
 * 只有确实提取过证据时 0% 才是真的 0 分。图谱的可见性/着色/徽章/读屏文案都从这里取。
 */
import { describe, expect, it } from 'vitest'
import { hasMasterySignal } from '../graphSemantics'

describe('hasMasterySignal', () => {
  it('0 分且没有提取证据 = 未评估（档案页与图谱不再分叉）', () => {
    expect(hasMasterySignal({ masteryScore: 0, extractionCount: 0 })).toBe(false)
    expect(hasMasterySignal({ masteryScore: 0 })).toBe(false)
    expect(hasMasterySignal({ masteryScore: null, extractionCount: 0 })).toBe(false)
    expect(hasMasterySignal(null)).toBe(false)
  })

  it('0 分但有提取证据 = 真的 0%（仍算有读数）', () => {
    expect(hasMasterySignal({ masteryScore: 0, extractionCount: 3 })).toBe(true)
  })

  it('正分一律算有读数', () => {
    expect(hasMasterySignal({ masteryScore: 0.01 })).toBe(true)
    expect(hasMasterySignal({ masteryScore: 0.9, extractionCount: 0 })).toBe(true)
  })
})
