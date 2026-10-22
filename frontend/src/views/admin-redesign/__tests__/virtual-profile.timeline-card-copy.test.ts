/**
 * 画像页「学习日程」卡文案（2026-10-20 用户走查「优化文案」）。
 *
 * 锁三点：没有会话时不报「0 个会话」也不解释口径（只给下一步）；有会话时说明只说
 * 一句「按自然日汇总…」，不再复述「只读 / 日期模拟默认关闭」这类规则；人称统一为
 * 「虚拟学习者」，不用「该虚拟人」。
 *
 * 用 ?raw 白盒断言（先例 virtual-profile.status-single / dataFlow）：本页挂载依赖大量
 * 接口 mock，而这里锁的是模板里的条件与字面量。
 */
import { describe, expect, it } from 'vitest'
import Source from '../VirtualProfile.vue?raw'

function timelineBlock(): string {
  const start = Source.indexOf("activeTab === 'timeline'")
  return Source.slice(start, Source.indexOf('</section>', start))
}

describe('VirtualProfile · 学习日程卡文案', () => {
  it('卡名是「学习日程」，不再把「日期模拟」写进标题', () => {
    const block = timelineBlock()
    expect(block).toContain('学习日程')
    expect(block).not.toContain('日程 · 日期模拟')
  })

  it('没有会话时只留空态：不报 0 个会话、不解释口径', () => {
    const block = timelineBlock()
    expect(block).toContain('v-if="!timelineSessionOptions.length"')
    expect(block).toContain('这个虚拟学习者还没有运行记录。跑一个故事后，这里会按天显示日程。')
    expect(block).not.toContain('该虚拟人')
    // 徽章与说明都挂在「有会话」分支上
    expect(block).toContain('<span v-if="timelineSessionOptions.length" class="mk-badge')
    expect(block).not.toContain('暂无可查看的会话')
  })

  it('口径只说一句「按自然日汇总」，不再复述只读与开关默认值', () => {
    const block = timelineBlock()
    expect(block).toContain('按自然日汇总所选运行的学习负担、学习状态、系统干预与难度调整。')
    expect(block).not.toContain('日期模拟默认关闭')
    expect(block).not.toContain('（只读）')
  })
})
