/**
 * 概览「概念掌握」卡去重（2026-10-20 用户拍板）：
 * 逐概念明细（可迁移 / 误解风险 / 证据数）已并入图谱页签的节点详情，
 * 本卡只留结论行与「去图谱逐个查看」入口——同一份概念事实只有一个落点。
 *
 * 同时锁住结论行按**全量**台账报数：原先明细列表截前 24 条，
 * 结论行跟着只数 24（实测某学习者台账 41 条），撤列表后不能再少报。
 */
import { describe, expect, it } from 'vitest'
import Source from '../LearnerDetail.vue?raw'

function overviewConceptCard(): string {
  const start = Source.indexOf('<h3 class="mk-card__title">概念掌握</h3>')
  const card = Source.slice(start, Source.indexOf('</section>', start))
  // 注释里会提到「逐概念明细」说明去处，判据只看真实标记
  return card.replace(/<!--[\s\S]*?-->/g, '')
}

describe('LearnerDetail · 概念掌握卡只留结论行', () => {
  it('不再出现「逐概念明细」折叠与逐条概念列表', () => {
    const card = overviewConceptCard()
    expect(card).toContain('mk-section__conclusion')
    expect(card).not.toContain('逐概念明细')
    expect(card).not.toContain('<details')
    expect(card).not.toContain('ld-bar__risk')
    expect(card).not.toContain('v-for="c in conceptBars"')
  })

  it('给出图谱入口（概念事实的新落点可被发现）', () => {
    const card = overviewConceptCard()
    expect(card).toContain('去图谱逐个查看 →')
    expect(card).toContain("tab = 'graph'")
  })

  it('台账不再截前 24 条：结论行按全量报数', () => {
    expect(Source).not.toContain('.slice(0, 24)')
    // 图谱拿到的是同一份台账（按概念名索引）
    expect(Source).toContain(':concept-facts="conceptFacts"')
    expect(Source).toContain('const conceptFacts = computed<Record<string, MkGraphConceptFacts>>')
  })
})
