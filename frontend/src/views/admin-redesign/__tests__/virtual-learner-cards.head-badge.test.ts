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

  /* 2026-11-07 用户「200 张卡片印着 200 个『想』字」：首字头像整块撤除，
     横向空间全部还给标题（标题是卡头里唯一可伸缩项）。勾选框保留且不参与压缩。 */
  it('首字头像已撤；勾选框不参与压缩，标题吃满剩余宽度', () => {
    expect(Source).not.toContain('vlc-avatar')
    expect(rule('.vlc-card__pick')).toContain('flex: none')
    expect(rule('.vlc-card__name')).toContain('flex: 1 1 auto')
  })

  /* 来源徽标从卡头移入卡脚的一行底栏（2026-11-07「三行台阶合一」）：
     卡脚里的徽章同样要能收缩省略，长来源词不许把按钮挤出去。 */
  it('卡脚标签行可换行且能收缩，按钮固定不缩', () => {
    expect(rule('.vlc-card__tags')).toContain('flex-wrap: wrap')
    expect(rule('.vlc-card__derive')).toContain('flex: none')
  })

  /* 2026-11-04 评审：1920 下卡墙列更窄，长概念名被压到 161px 单行省略，只剩半句。
     名称/开场白改折行截断（最多两行），不再单行 ellipsis。 */
  it('长文本折行截断：名称与开场白最多两行（-webkit-line-clamp: 2）', () => {
    expect(rule('.vlc-card__name')).toContain('-webkit-line-clamp: 2')
    expect(rule('.vlc-card__opening')).toContain('-webkit-line-clamp: 2')
  })
})
