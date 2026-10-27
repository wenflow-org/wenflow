/**
 * 列表单元格方言守卫（2026-10-27 用户「这种横线都不一样」「操作列各自为战」）。
 *
 * 1. 空值占位只有一种形态：`.mk-na`（faint 色、常态字重、继承单元格字号），
 *    不得套 `<b>` 变成粗横线，也不得在页面里另写颜色/字重。
 * 2. 操作列只有一套几何与控件档：`th.mk-c-act`（全局 140px、右对齐）、
 *    `.mk-actions` 内一级动作用 `.mk-link` 文字链，低频/危险动作进 ⋯ 菜单；
 *    页面不再各写 `xx-c-act` 宽度。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')
const adminVue = readdirSync(resolve(__dirname, '..')).filter((f) => f.endsWith('.vue'))
const primitives = readFileSync(join(root, 'src/styles/mk-primitives.css'), 'utf8')
const rule = (selector: string) => {
  const lit = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return primitives.match(new RegExp(`(?:^|\\n)${lit} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
}

describe('列表单元格方言', () => {
  it('空值占位：.mk-na 是唯一形态（常态字重 + faint），不再继承 <b> 的粗体', () => {
    const na = rule('.mk-na')
    expect(na).toContain('font-weight: 400')
    expect(na).toContain('var(--mk-faint)')
    expect(na).toContain('font-variant-numeric: tabular-nums')
    // 表格里可能落在 <b> 内：需要更高特异性的兜底
    expect(rule('.mk-table .mk-na')).toContain('font-weight: 400')
  })

  it('教学会话时长空值不再渲染成 <b> 粗体横线', () => {
    const src = read('TeachingSessions.vue')
    expect(src).toMatch(/<b v-if="r\.duration" class="ts-ia__dur"/)
    expect(src).toMatch(/<span v-else class="mk-na">—<\/span>/)
    expect(src).not.toMatch(/fmtDuration\(r\.duration\) : '—'/)
  })

  it('表格单元格不再内联裸横线：占位必须落在 .mk-na 上', () => {
    const offenders: string[] = []
    for (const file of adminVue) {
      for (const line of read(file).split('\n')) {
        if (!/<td\b/.test(line)) continue
        if (!/['"]—['"]/.test(line)) continue
        if (!/mk-na/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('全站操作列表头统一带 .mk-c-act，且不再有页面私有 xx-c-act 宽度', () => {
    const missing: string[] = []
    const privateWidths: string[] = []
    for (const file of adminVue) {
      const src = read(file)
      for (const m of src.matchAll(/<th\b([^>]*)>\s*操作\s*<\/th>/g)) {
        if (!/mk-c-act/.test(m[1])) missing.push(file)
      }
      if (/\b(?:gc|oc|lc|mr|u|vl|fb|ach|al)-c-act\b/.test(src)) privateWidths.push(file)
    }
    expect(missing).toEqual([])
    expect(privateWidths).toEqual([])
  })
})
