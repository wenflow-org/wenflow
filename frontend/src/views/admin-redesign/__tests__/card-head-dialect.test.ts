/**
 * 卡头工具条形态守卫（2026-10-26 统一，用户「表头部分需要重新设计，包括 pill 筛选 搜索统一设计」）。
 *
 * 契约（一条卡头＝一套控件语言）：
 * 1. **维度下拉**（选一个值筛列表）一律走共享 `MkPillSelect`（`.mk-pill` + 透明原生 select）。
 *    禁止再页内私搓「胶囊内嵌下拉」——统一前 ExecLogs 有 .logs-range/.logs-agent 两份、
 *    AuditLogs 有 .al-range 一份，三段 CSS 逐字重复且字重 700/800 不一致。
 * 2. **次级动作**（列 / 筛选 / 按 ID 定位）一律「文字链 + 图标」（`.mk-link` + `.mk-adv-trigger`），
 *    描边按钮 `.mk-btn` 留给页头主操作——两级层次不能塌成「一排按钮」。
 * 3. **搜索**一律 `MkFilterSearch`（共享清空按钮 + 可访问名回落），且在右组首位。
 *
 * 这里只锁「结构性方言」，不管某个页面具体放几个 pill。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

/** 有列表卡头的页面（壳/弹窗/详情面板不在内） */
const LIST_PAGES = [
  'Users.vue',
  'TeachingSessions.vue',
  'OpsContent.vue',
  'GoalConversations.vue',
  'LearnerCenter.vue',
  'MemoryReviewOverview.vue',
  'Skills.vue',
  'ExecLogs.vue',
  'AuditLogs.vue',
  'Feedback.vue',
  'Announcements.vue',
  'Notifications.vue',
  'OpsAchievements.vue',
  'SessionSecurity.vue',
]

describe('卡头工具条形态', () => {
  it('不再有页面私搓「胶囊内嵌下拉」（私有 __pick / __v 三段式）', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      // 私有实现的特征：类名 `xx__pick` 包裹 `xx__v` 的 select
      for (const m of src.matchAll(/class="([a-z0-9-]+)__pick"/g)) {
        offenders.push(`${file}: .${m[1]}__pick`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('卡头里的原生 select 必须是 MkPillSelect 内的，不再裸挂 .mk-filter__select', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      const head = src.match(/<div class="mk-card__head"[^>]*>([\s\S]*?)\n      <\/div>/)
      if (!head) continue
      // 卡头区内出现带 .mk-filter__select 的 <select> = 裸下拉（.mk-adv 弹层内的除外）
      const advIdx = head[1].indexOf('mk-adv')
      const body = advIdx >= 0 ? head[1].slice(0, advIdx) : head[1]
      if (/<select[^>]*class="[^"]*mk-filter__select/.test(body)) {
        offenders.push(`${file}: 卡头主栏裸 select`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('「筛选」弹层触发器走共享 .mk-adv-trigger（文字链档），不再用描边小按钮', () => {
    for (const file of LIST_PAGES) {
      const src = read(file)
      if (!src.includes('advOpen')) continue
      expect(src, `${file} 的筛选触发器应为 .mk-link + .mk-adv-trigger`).not.toMatch(
        /class="mk-btn[^"]*"[\s\S]{0,120}advOpen = !advOpen/
      )
    }
  })

  it('列表卡头搜索一律走 MkFilterSearch（不手搓带「搜索」placeholder 的裸 input）', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      const head = src.match(/<div class="mk-card__head"[^>]*>([\s\S]*?)\n      <\/div>/)
      if (!head) continue
      /* 只看卡头区：弹窗里的收件人搜索（发放成就 / 发送通知）是表单字段，
         走 .mk-field__input 是正确的，不属于列表工具条。 */
      for (const m of head[1].matchAll(/<input[^>]*placeholder="([^"]*搜索[^"]*)"/g)) {
        offenders.push(`${file}: 手搓搜索框「${m[1]}」`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * 共享原语自身的守卫：胶囊内嵌下拉的「展开后看得见选项」契约。
 *
 * 闭合态靠 `color: transparent` 让原生 select 隐形（可见值由 .mk-pillselect__txt 承担），
 * 但 Chromium 用 option 的计算色画弹层 —— 不显式给 option 定色，用户点开后是一片
 * 没有文字的浮层（2026-10-26 用户走查「里面选项不可见，我无法截图到」）。
 * 同理不能用 `opacity: 0` 隐形：整层透明会把弹层一起带走。
 */
describe('胶囊内嵌下拉的原生弹层', () => {
  const css = readFileSync(
    resolve(__dirname, '../../../../src/styles/mk-primitives.css'),
    'utf8'
  )

  it('透明 select 不得整层 opacity: 0', () => {
    const block = css.match(/\.mk-pillselect__v \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(block).not.toBe('')
    expect(block).not.toMatch(/opacity:\s*0\s*;/)
  })

  it('option 必须显式给文字色（否则继承 select 的 transparent）', () => {
    const optionRule = css.match(/\.mk-pillselect__v > option \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(optionRule).toContain('color:')
    expect(optionRule).toContain('background:')
  })
})
