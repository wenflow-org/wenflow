/**
 * 虚拟学习者详情页七个页签的设计收口（2026-11-12 用户「各个 tab 重新看看」）。
 *
 * 锁四件在浏览器走查里实际踩到的事：
 *  1. 页签名回答「里面是什么」（运行记录 / 模拟日程 / 运行预算），不是单字缩写；
 *  2. 故事行只留一个状态：有 latestRun 时运行态徽章是唯一出口，不能再并排一个同名「已完成」；
 *  3. 主测场景为空时区分「没跑过」与「跑过但没关联场景」，不能在有 4 次运行时写「还没有运行」；
 *  4. 故事池与运行记录是同一筛选控件，选项顺序必须一致。
 *
 * 用 ?raw 白盒断言（同 virtual-profile.timeline-card-copy）：本页挂载依赖大量接口 mock，
 * 这里锁的是模板条件与页签集合。
 */
import { describe, expect, it } from 'vitest'
import Source from '../VirtualProfile.vue?raw'

describe('VirtualProfile · 页签设计', () => {
  it('页头与用户侧学习详情同源：MkDetailHero + 虚拟学习者紫色 tone', () => {
    expect(Source).toContain('<MkDetailHero')
    expect(Source).toContain('tone="learner"')
    expect(Source).not.toContain('class="mk-entity mk-entity--flat"')
  })

  it('概览按用户侧「主内容 2fr + 侧栏 1fr」排版，页级读数条不再出现', () => {
    expect(Source).toContain('class="vp-overview"')
    expect(Source).toContain('class="vp-overview__main"')
    expect(Source).toContain('class="vp-overview__side"')
    expect(Source).not.toContain('MkStatStrip')
  })

  it('七个页签用完整名字，且运行预算排在最后', () => {
    const tabsBlock = Source.slice(Source.indexOf('const tabs = computed'), Source.indexOf('const hasToolbar'))
    expect(tabsBlock).toContain("label: '运行记录'")
    expect(tabsBlock).toContain("label: '模拟日程'")
    expect(tabsBlock).toContain("label: '运行预算'")
    expect(tabsBlock).not.toContain("label: '运行',")
    expect(tabsBlock).not.toContain("label: '日程',")
  })

  it('故事行有运行时不重复渲染模板生命周期徽章', () => {
    const start = Source.indexOf('v-for="(s, i) in displayStories"')
    const block = Source.slice(start, Source.indexOf('vp-story__outline', start))
    expect(block).toContain('v-if="!s.latestRun?.sessionId"')
    expect(block).toContain('storyStatusMeta(s)')
  })

  it('主测场景空态区分「没跑过」与「跑过但未关联场景」', () => {
    expect(Source).toContain('const topSceneEmpty = computed')
    expect(Source).toContain("allRuns.value.length ? '运行还没有关联故事场景'")
    expect(Source).toContain('{{ topScene || topSceneEmpty }}')
  })

  it('故事池与运行记录筛选条顺序一致（已完成在需关注之前）', () => {
    const storyFilters = Source.slice(Source.indexOf('const storyFilterOptions'), Source.indexOf('const displayStories'))
    expect(storyFilters.indexOf("label: '已完成'")).toBeLessThan(storyFilters.indexOf("label: '需关注'"))
    const runFilters = Source.slice(Source.indexOf('const RUN_FILTERS'), Source.indexOf('] as const', Source.indexOf('const RUN_FILTERS')))
    expect(runFilters.indexOf("label: '已完成'")).toBeLessThan(runFilters.indexOf("label: '需关注'"))
  })
})
