/**
 * 教学组表格「方言回归」门禁（2026-10-03 单元格渲染统一批次）。
 *
 * 背景：教学组四张表（TeachingSessions/GoalConversations/学习路径=OpsContent/MemoryReview）
 * 的单元格渲染各说各话——同语义四处四貌（时间列、状态徽章、进度条、数字列），
 * 私有 CSS 与 mk-primitives 原语逐字重复。统一批次把方言收敛到共享原语后，
 * 本测试锁死退役类名，防止方言在后续迭代里长回来（对齐 .month__label 幽灵类教训）。
 *
 * 退役清单（→ 应使用的共享原语）：
 *  - ts-summary-preview → .mk-cell-sub.ts-summary
 *  - gc-summary / oc-subject → .mk-cell-text
 *  - gc-stage-cell__tl → .mk-cell-sub
 *  - mr__due-bar / mr-pct__bar / mr__strength-bar 自绘条 → .mk-minibar（data-tone）+ .mr__bar 尺寸钩子
 *  - oc-hours 双层叠写 → td.mk-num 直出
 *  - gc-row / oc-row 行点击 → table.mk-table--click（ts-row 保留：att 色条与列选择器锚点）
 *  - 页内 scoped .stageband/.sbl 拷贝 → mk-primitives 全局原语
 *
 * 匹配前剥离注释（/* *\/ 与 <!-- -->），只拦真实类使用，放过文档性提及。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES = [
  'TeachingSessions.vue',
  'GoalConversations.vue',
  'OpsContent.vue',
  'MemoryReview.vue',
] as const

const RETIRED: Array<{ cls: string; instead: string }> = [
  { cls: 'ts-summary-preview', instead: '.mk-cell-sub.ts-summary' },
  { cls: 'gc-summary', instead: '.mk-cell-text' },
  { cls: 'oc-subject', instead: '.mk-cell-text' },
  { cls: 'gc-stage-cell__tl', instead: '.mk-cell-sub' },
  { cls: 'mr__due-bar', instead: '.mk-minibar + .mr__bar' },
  { cls: 'mr-pct__bar', instead: '.mk-minibar + .mr__bar--sm' },
  { cls: 'mr__strength-bar', instead: '.mk-minibar + .mr__bar' },
  { cls: 'oc-hours', instead: 'td.mk-num 直出' },
  { cls: 'class="gc-row"', instead: 'table.mk-table--click' },
  { cls: 'class="oc-row"', instead: 'table.mk-table--click' },
]

const dir = join(__dirname, '..')

/** 剥离 CSS/HTML 注释，只对真实代码匹配（注释里的历史提及不算方言）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
}

describe('教学组表格方言回归门禁', () => {
  for (const page of PAGES) {
    it(`${page} 不再使用已退役的私有单元格方言`, () => {
      const src = stripComments(readFileSync(join(dir, page), 'utf8'))
      const offenders = RETIRED.filter((r) => src.includes(r.cls))
      expect(
        offenders.map((o) => `${o.cls}（应改用 ${o.instead}）`),
        `检测到已退役的方言类——单元格语义请走 mk-primitives 共享原语：`,
      ).toEqual([])
    })
  }

  it('stageband/sbl 不再以 scoped 拷贝存在（只允许 mk-primitives 全局定义）', () => {
    for (const page of PAGES) {
      const src = stripComments(readFileSync(join(dir, page), 'utf8'))
      // 模板使用放行（<div class="stageband">）；scoped 样式定义（.stageband {）禁止
      expect(src.includes('.stageband {'), `${page} 出现 scoped .stageband 样式定义——请使用 mk-primitives 全局原语`).toBe(false)
      expect(src.includes('.sbl {'), `${page} 出现 scoped .sbl 样式定义`).toBe(false)
    }
  })
})
