/**
 * 卡墙卡头：长标题不得把来源徽章压扁（2026-10-20 用户走查「4K 下长标题 pill 显示不正常」）。
 *
 * 病根：`.vlc-card__head .mk-badge` 曾允许 flex-shrink（0 1 auto），卡墙在 4K 列更窄时
 * 长名称会把「预置 / 合成」压成只剩圆角边的色块。徽章必须固定不缩，名称自己省略。
 */
import { describe, expect, it } from 'vitest'
import Source from '../VirtualLearnerCards.vue?raw'

function rule(selector: string): string {
  const start = Source.indexOf(`${selector} {`)
  expect(start, `缺少样式规则 ${selector}`).toBeGreaterThan(-1)
  return Source.slice(start, Source.indexOf('}', start))
}

describe('卡墙卡头 · 长标题与徽章', () => {
  it('来源徽章固定不缩（flex: 0 0 auto），名称是唯一可伸缩项', () => {
    expect(rule('.vlc-card__head .mk-badge')).toContain('flex: 0 0 auto')
    const name = rule('.vlc-card__name')
    expect(name).toContain('flex: 1 1 auto')
    expect(name).toContain('min-width: 0')
  })

  it('头像与勾选框不参与压缩，避免长标题把圆形头像挤扁', () => {
    expect(rule('.vlc-avatar')).toContain('flex: none')
    expect(rule('.vlc-card__pick')).toContain('flex: none')
  })
})
