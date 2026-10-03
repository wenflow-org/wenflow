/**
 * 虚拟学习者列表「方言回归」门禁（2026-10-03 按新标准体系重排批次）。
 *
 * 背景：VirtualLearners 表格单元格此前自说自话——倾向列私有截断类、故事池计数套
 * 绿色徽章、卡死列徽章复读列头（「卡死 2」在「卡死」列下）、空闲态私有字体档、
 * 名称格 strong 上挂 flex（被 .mk-cell-main strong 的 display:block 高特异性压制，
 * 布局全靠裸 inline 流巧合成立）、整行 pointer 光标但行点击早已退役（假承诺）。
 * 统一批次收敛到共享原语后，本测试锁死退役方言（对齐 teaching-tables.dialect 同款）。
 *
 * 退役清单（→ 应使用的共享原语/结构）：
 *  - vl-goal → .mk-cell-text--wrap（长句两行截断，见下；空值档仍用 .mk-na）
 *  - vl-run → .mk-na（空闲态单通道）
 *  - vl-name / vl-name__text → 头像外置 + .mk-cell-main（strong 截断由原语承担）
 *  - mk-cell-main vl-cell（合一写法）→ .vl-cell 外层 flex + 内层 .mk-cell-main
 *  - 故事池计数徽章（mk-badge--ok/--muted 二选一）→ td.mk-num 数字直出 + title 口径
 *  - 卡死徽章「卡死 N」→ td.mk-num 数字直出（不复读列头）
 *  - vl-row / mk-table--click → 行不可点击：入口=名称格 vl-cell--click，
 *    整行 pointer 光标是对「点了没反应」的假承诺
 *
 * 匹配前剥离注释（/* *\/ 与 <!-- -->），只拦真实类使用，放过文档性提及。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RETIRED: Array<{ cls: string; instead: string }> = [
  { cls: 'vl-goal', instead: '.mk-cell-text--wrap（两行截断；空值档 .mk-na）' },
  { cls: 'vl-run--idle', instead: '.mk-na（空闲态）' },
  { cls: 'class="vl-run"', instead: '.mk-na（空闲态）' },
  { cls: 'vl-name', instead: '头像外置 + .mk-cell-main（strong 截断由原语承担）' },
  { cls: 'mk-cell-main vl-cell', instead: '.vl-cell 外层 flex + 内层 .mk-cell-main' },
  { cls: ": 'mk-badge--muted'", instead: 'td.mk-num 数字直出 + title 口径（计数不吃彩色徽章）' },
  { cls: '卡死 {{', instead: 'td.mk-num 数字直出（不复读列头）' },
  { cls: 'class="vl-row"', instead: '无行级方言（行不可点击）' },
  { cls: 'mk-table--click', instead: '行不可点击：入口=名称格 vl-cell--click，整行 pointer 是假承诺' },
]

const dir = join(__dirname, '..')

/** 剥离 CSS/HTML 注释，只对真实代码匹配（注释里的历史提及不算方言）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
}

describe('虚拟学习者列表方言回归门禁', () => {
  it('VirtualLearners.vue 不再使用已退役的私有单元格方言', () => {
    const src = stripComments(readFileSync(join(dir, 'VirtualLearners.vue'), 'utf8'))
    const offenders = RETIRED.filter((r) => src.includes(r.cls))
    expect(
      offenders.map((o) => `${o.cls}（应改用 ${o.instead}）`),
      `退役方言复现：${offenders.map((o) => o.cls).join(', ')}`
    ).toEqual([])
  })

  it('共享原语 .mk-cell-text 必须自带 display（裸 inline 上 max-width/overflow 不生效）', () => {
    const css = readFileSync(join(dir, '../../styles/mk-primitives.css'), 'utf8')
    const rule = css.match(/\.mk-cell-text \{[^}]*\}/)?.[0] ?? ''
    expect(rule, '.mk-cell-text 规则缺失').not.toBe('')
    expect(rule).toContain('display: inline-block')
    expect(rule).toContain('text-overflow: ellipsis')
  })

  it('长句列用两行档 .mk-cell-text--wrap，且 min/max 成对给出', () => {
    // 单行 nowrap 会把 46 字倾向切成读不出意思的 19 字（2026-10-03 用户报障）；
    // 只给 max-width 时 auto 布局会把这列压到比 nowrap 更窄（实测 154px），
    // 故 min-width 必须显式给出（原型 .tbl td.wrap 同款 min 220px）。
    const css = readFileSync(join(dir, '../../styles/mk-primitives.css'), 'utf8')
    const rule = css.match(/\.mk-cell-text--wrap \{[^}]*\}/)?.[0] ?? ''
    expect(rule, '.mk-cell-text--wrap 规则缺失').not.toBe('')
    expect(rule).toContain('-webkit-line-clamp: 2')
    expect(rule).toContain('white-space: normal')
    expect(rule).toMatch(/min-width:\s*\d/)
    expect(rule).toMatch(/max-width:\s*\d/)
    // 长句列必须消费两行档，而不是退回单行 nowrap
    const src = readFileSync(join(dir, 'VirtualLearners.vue'), 'utf8')
    expect(src).toContain('mk-cell-text--wrap')
  })
})
