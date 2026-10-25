/**
 * 运行预算独立成「预算」页签（2026-10-21 用户「运行预算不放在画像里面，单独开一个 tab」）。
 *
 * 配置回答的是「下次跑用什么默认值」，与画像（这个人是谁）不是一件事；混在画像页里
 * 要和画像字段/能力维度/学习状态读数一起往下滚才能找到。用 ?raw 白盒断言（同
 * virtual-profile.timeline-card-copy 判例）：这里锁的是页签集合与模板条件。
 */
import { describe, expect, it } from 'vitest'
import Source from '../VirtualProfile.vue?raw'

function budgetBlock(): string {
  const start = Source.indexOf("activeTab === 'budget'")
  return Source.slice(start, Source.indexOf('</section>', start))
}

describe('VirtualProfile · 运行预算页签', () => {
  it('页签集合里有「预算」，且排在画像之后', () => {
    expect(Source).toContain("| 'budget'")
    const tabsBlock = Source.slice(Source.indexOf('const tabs = computed'), Source.indexOf('const hasToolbar'))
    expect(tabsBlock).toContain("label: '预算'")
    expect(tabsBlock.indexOf("label: '画像'")).toBeLessThan(tabsBlock.indexOf("label: '预算'"))
  })

  it('运行预算卡挂在新页签上，不再挂在画像页签', () => {
    const block = budgetBlock()
    expect(block).toContain('运行预算')
    expect(block).toContain('保存预算')
    // 画像页签下不应再有预算卡
    const profileSections = Source.split('activeTab === \'profile\'').slice(1)
    for (const chunk of profileSections) {
      expect(chunk.slice(0, 400)).not.toContain('保存预算')
    }
  })

  it('没有可跑的会话时不出这个页签（虚拟学习者已下线）', () => {
    expect(Source).toContain('isLive.value ? [{ key: \'budget\' as const, label: \'预算\' }] : []')
  })
})
