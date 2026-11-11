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

/* 2026-11-02 P1-2：掌握四档原先图谱一套名（进行中/记忆偏弱/待学习）、本页概念信号一套名
   （挣扎/脆弱/未开始），同一批概念两种叫法。锁住两处都读 utils/conceptBands 单源。 */
describe('概念分档名：图谱与学习者详情同源', () => {
  it('图谱组件的统计条 / 图例 / 概览 / 徽章都取自共享标签', async () => {
    const graph = (await import('@/components/mk/MkGraphExplorer.vue?raw')).default
    for (const key of ['stable', 'learning', 'fragile', 'unknown']) {
      expect(graph).toContain(`CONCEPT_BAND_LABEL.${key}`)
    }
    // 不再在模板里手写四档名
    expect(graph).not.toContain('>记忆偏弱')
    expect(graph).not.toContain('>待学习')
  })

  it('概念信号四档的 label 取自同一份标签表', async () => {
    expect(Source).toContain("label: CONCEPT_BAND_LABEL.stable")
    expect(Source).toContain("label: CONCEPT_BAND_LABEL.learning")
    expect(Source).toContain("label: CONCEPT_BAND_LABEL.fragile")
    expect(Source).toContain("label: CONCEPT_BAND_LABEL.unknown")
    expect(Source).toContain("import { CONCEPT_BAND_LABEL } from '@/utils/conceptBands'")
  })
})

/* 2026-11-09：概念证据密度列表补数值掌握度。
   三档「迁移就绪 / 误解风险」只回答稳不稳，读不出「0.9 掉到 0.35」这种退化——
   台账现在带 masteryScore（确定性测量值），列表把它按百分数显示；缺值显示「—」、不按 0 计。
   2026-11-11 用户「这个地方设计不对 UI」：掌握从可选胶囊改为固定列（无值也占位），
   条形每行同一基线；有值但无证据时用 title 注明「模型推算」，不当成测量结果。 */
describe('概念证据密度：数值掌握度与三档标签同屏', () => {
  it('列表行显示掌握度百分数（固定列），悬停文案按是否有证据分流', () => {
    expect(Source).toContain('c.masteryPct === null')
    expect(Source).toContain(':title="masteryTitle(c)"')
    expect(Source).toContain('function masteryTitle(stat: { masteryPct: number | null; count: number })')
    // 有值无证据：明说是模型推算，避免与「0 条」并排被读成测出来的结果
    expect(Source).toContain('暂无学习证据，该掌握度为模型推算，仅供参照')
    expect(Source).toContain('const MASTERY_TOOLTIP =')
    // 说明里要讲清「三档读不出退化」这个动机，否则后人会再删掉
    expect(Source).toContain('读不出退化幅度')
  })

  it('缺 masteryScore 时 masteryPct 为 null（不拿 0 冒充「测出来是 0」）', () => {
    expect(Source).toContain('masteryPct: masteryPctOf(item)')
    expect(Source).toContain('function masteryPctOf(item: ConceptLedgerItem): number | null')
    expect(Source).toContain('if (!Number.isFinite(score) || (evidence <= 0 && score <= 0)) return null')
    // 模板侧按 null 渲染占位「—」，保证掌握列宽度稳定
    expect(Source).toContain('{{ c.masteryPct === null ? \'—\' :')
  })

  /* 2026-11-09 真数据核对（隔离实例 6 个虚拟人 / 10 条台账）：8 条是「0 证据 + 掌握度 0」，
     按数值直渲染会给出 8 个「掌握 0%」——把「根本没测」说成「测过了、很低」。
     撤回口子：SSOT 的 0 是「无有效信号」哨兵，与「测出来是 0」不可区分。 */
  it('0 证据 + 0 掌握度的行显示「—」（0 是哨兵值，不是测量结果）', () => {
    expect(Source).toContain('(evidence <= 0 && score <= 0)) return null')
    // 老快照回退走同一口径：0 也不显示
    expect(Source).toContain('Number(s.masteryScore || 0) > 0 ? Math.round(Number(s.masteryScore) * 100) : null')
  })
})
