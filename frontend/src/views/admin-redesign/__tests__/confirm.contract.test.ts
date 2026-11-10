/**
 * 二次确认弹窗 · 单源与文案契约（2026-11-10 全站走查）。
 *
 * 现状盘点（用户问「这类二次确认弹窗哪里有，设计统一了吗」）：
 *   - 实现只有一份：Confirm.vue + useConfirm.ts，App.vue 里单例挂载（Teleport 到 body），
 *     admin、v2 用户页、学习页共用同一枚；101 处 askConfirm 调用，40 个文件；
 *   - 没有任何页面复制过 .mk-confirm 标记，也没有原生 window.confirm 残留。
 *
 * 视觉已统一，但文案此前是四套句式并存：标题带问号、正文末尾再问「确定继续？」、
 * 按钮写「确认删除（不可恢复）」、同是「发布」在公告页是蓝底、在 Skill 页是红底。
 * 这里把口径钉死（规则同 useConfirm.ts 文档注释）：
 *   1. 标题 = 动作名：不带 ?/？/。，不以「确认」开头；
 *   2. 正文：句末不再提问（按钮就是提问）；
 *   3. 按钮 = 裸动词：不带「确认」前缀、不在括号里补充后果。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') continue
    if (p.endsWith('.vue')) out.push(p)
    else if (!name.includes('.')) walk(p, out)
  }
  return out
}

const VUE_FILES = walk(SRC)
const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/')

interface Site {
  file: string
  line: number
  /** askConfirm({...}) 的原始片段：模板字面量里嵌模板（`${a ? `x` : ''}`）会让
      字符串截取在内部反引号处截断，正文规则只在这个片段上做「句末复读」判断 */
  raw: string
  title?: string
  message?: string
  confirmText?: string
}

function literal(body: string, key: string): string | undefined {
  const m = body.match(new RegExp(key + '\\s*:\\s*([\'"`])((?:\\\\.|(?!\\1).)*)\\1', 's'))
  return m ? m[2] : undefined
}

function confirmSites(): Site[] {
  const sites: Site[] = []
  for (const p of VUE_FILES) {
    const s = readFileSync(p, 'utf8')
    for (const m of s.matchAll(/askConfirm\(\{/g)) {
      const start = (m.index ?? 0) + m[0].length
      const seg = s.slice(start, start + 1200)
      const end = seg.indexOf('})')
      const body = seg.slice(0, end === -1 ? 700 : end)
      sites.push({
        file: rel(p),
        line: s.slice(0, m.index).split('\n').length,
        raw: body,
        title: literal(body, 'title'),
        message: literal(body, 'message'),
        confirmText: literal(body, 'confirmText'),
      })
    }
  }
  return sites
}

const SITES = confirmSites()

describe('二次确认弹窗：只有一份实现', () => {
  it('单例挂载在 App.vue，页面不再各自 import 副本', () => {
    const app = readFileSync(join(SRC, 'App.vue'), 'utf8')
    expect(app).toContain('MockConfirm')
    const importers = VUE_FILES.filter((p) => rel(p) !== 'App.vue' && p.includes('Confirm.vue') && !p.includes('useConfirm'))
      .filter((p) => readFileSync(p, 'utf8').match(/import\s+MockConfirm\s+from\s+['"].*Confirm\.vue/))
    expect(importers.map(rel)).toEqual([])
  })

  it('.mk-confirm 视觉标记只在 Confirm.vue 里定义（没有页面复制弹窗）', () => {
    const owners = VUE_FILES.filter((p) => /class="mk-confirm/.test(readFileSync(p, 'utf8'))).map(rel)
    expect(owners).toEqual(['views/admin-redesign/Confirm.vue'])
  })

  it('没有原生 window.confirm / prompt 残留', () => {
    const bad = VUE_FILES.filter((p) => /window\.(confirm|prompt)\s*\(/.test(readFileSync(p, 'utf8'))).map(rel)
    expect(bad).toEqual([])
  })

  it('结构契约：alertdialog + 头部盾形图标 + 取消左 / 动作右', () => {
    const src = readFileSync(join(SRC, 'views/admin-redesign/Confirm.vue'), 'utf8')
    expect(src).toContain('role="alertdialog"')
    expect(src).toContain('aria-modal="true"')
    expect(src).toContain('mk-confirm__icon--danger')
    // 危险档 → mk-btn--danger；普通档 → mk-btn--primary（颜色语义跟着 danger 走）
    expect(src).toContain("confirmState.danger ? 'mk-btn--danger' : 'mk-btn--primary'")
    // 取消在左、确认在右
    expect(src.indexOf('settleConfirm(false)')).toBeLessThan(src.indexOf('@click="confirm"'))
  })
})

describe('二次确认弹窗：文案契约', () => {
  it('扫到全部调用点（数量骤降说明正则失效，而不是弹窗被删）', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(95)
    expect(SITES.filter((s) => s.title).length).toBeGreaterThanOrEqual(80)
  })

  it('标题 = 动作名：不带问号/句号，不以「确认」开头', () => {
    const bad = SITES.filter((s) => s.title && (/[?？。]\s*$/.test(s.title) || /^确认/.test(s.title)))
    expect(bad.map((s) => `${s.file}:${s.line}  ${s.title}`)).toEqual([])
  })

  it('正文句末不再提问（按钮就是提问）', () => {
    /* 「确认删除「X」？」可以出现在正文首行（它点名对象）；被禁的是说完后果再补一刀：
       「……不可撤销。确定继续？」。故判据 = 句号/逗号之后跟一段短问句。 */
    const tailQ = /[。！，,]\s*(确定|确认|是否)[^。！？?]{0,12}[？?]/
    const bad = SITES.filter((s) => tailQ.test(s.raw))
    expect(bad.map((s) => `${s.file}:${s.line}`)).toEqual([])
  })

  it('确认按钮 = 裸动词：不带「确认」前缀、不在括号里补后果', () => {
    const bad = SITES.filter((s) => s.confirmText && (/^确认/.test(s.confirmText) || /[（(]/.test(s.confirmText)))
    expect(bad.map((s) => `${s.file}:${s.line}  ${s.confirmText}`)).toEqual([])
  })
})
