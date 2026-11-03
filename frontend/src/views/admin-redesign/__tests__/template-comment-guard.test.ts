/**
 * 模板注释守卫（2026-11-01 用户「打开 zcode 浏览器看一下」时当场抓到）。
 *
 * 判例：GoalConversations.vue 用户列里 JS 风格的 `/* … *\/` 注释缺了 HTML 注释外壳，
 * 被 Vue 当成正文渲染，整段源码注释直接印在表格单元格里，13 张截图全部带伤，
 * 而 vue-tsc / vitest 1354 条 / design:check / copy:check 一律不报——模板里的裸文本
 * 是合法的，没有任何一道门禁看得见它。
 *
 * 只认模板：`/*` 出现在 `<script>`/`<style>` 里是正常注释，出现在标签属性里（如
 * `:title="a /* b"`——虽然也没意义）不算正文。所以先剥 `<!-- -->`，再剥标签，剩下的
 * 就是会被渲染的文字与插值，这里不许出现 `/*` 或 `*\/`。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 取模板体（无 <template> 的组件跳过），去掉 HTML 注释与标签后返回逐行文字 */
function renderedTextLines(vue: string): Array<{ line: number; text: string }> {
  const m = /<template>([\s\S]*?)\n<\/template>/.exec(vue)
  if (!m) return []
  const base = vue.slice(0, m.index + m[0].indexOf(m[1])).split('\n').length
  // 注释与标签各自替换成等量换行，保住行号
  const kept = m[1]
    // 开发者文档页的 <pre>/<code> 整块是「故意展示的源码」（如 `__tests__/**/*.test.ts`），
    // 本来就该出现这些字符，先整块抹掉再判
    .replace(/<(pre|code)\b[\s\S]*?<\/\1>/g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/<[^>]*>/g, (s) => s.replace(/[^\n]/g, ' '))
  return kept.split('\n').map((text, i) => ({ line: base + i, text }))
}

describe('模板注释守卫：JS 风格注释不许漏进正文', () => {
  const files = walk(SRC)
  const leaks = files.flatMap((f) =>
    renderedTextLines(readFileSync(f, 'utf8'))
      .filter(({ text }) => /\/\*|\*\//.test(text))
      .map(({ line, text }) => `${relative(SRC, f).replace(/\\/g, '/')}:${line}  ${text.trim().slice(0, 80)}`)
  )

  it('扫过的组件数量正常（防目录遍历写错导致空扫）', () => {
    expect(files.length).toBeGreaterThan(150)
  })

  it('没有把 /* … */ 写成正文的组件', () => {
    expect(leaks).toEqual([])
  })
})
