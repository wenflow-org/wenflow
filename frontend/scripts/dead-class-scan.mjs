/**
 * 死规则扫描：找出某 CSS 文件里「定义了但全仓 .vue 从未引用」的类选择器。
 *
 * 为什么不能用子串匹配
 * --------------------
 * `corpus.includes('btn--primary')` 会被 `mk-btn--primary` 命中，
 * `corpus.includes('btn')` 会被 `mk-btn` 命中——本仓大量使用 mk-/wf- 前缀，
 * 子串匹配会把几乎所有规则误判成「在用」。必须按类名词边界匹配。
 *
 * 用法：node scripts/dead-class-scan.mjs <css 相对 src 的路径>
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const target = process.argv[2] || 'styles/design-system.css'

/** 收集 .vue 的「模板 + 脚本」语料（去掉 style 块——那是定义面不是使用面） */
let corpus = ''
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('.vue')) {
      corpus += readFileSync(p, 'utf8').replace(/<style[\s\S]*?<\/style>/g, '') + '\n'
    }
  }
})(SRC)

/** 类名按词边界出现才算「在用」：前后都不能接 [a-zA-Z0-9_-] */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isUsed = (cls) =>
  new RegExp(`(?<![a-zA-Z0-9_-])${escapeRe(cls)}(?![a-zA-Z0-9_-])`).test(corpus)

const css = readFileSync(join(SRC, target), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** 剥掉令牌块：:root / [data-theme=..] / .dark —— 它们不是「类选择器」 */
const body = css
  .replace(/:root\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
  .replace(/\[data-theme[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
  .replace(/\.dark\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

const classes = new Set()
for (const m of body.matchAll(/([^{}]+)\{/g)) {
  for (const c of m[1].matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) classes.add(c[1])
}

const dead = [...classes].filter((c) => !isUsed(c)).sort()
const alive = [...classes].filter((c) => isUsed(c)).sort()

console.log(`文件：${target}`)
console.log(`类选择器 ${classes.size} 个 · 在用 ${alive.length} · 零消费 ${dead.length}\n`)
if (alive.length) console.log('在用：', alive.map((c) => '.' + c).join('  '))
if (dead.length) console.log('\n零消费（死规则）：\n  ' + dead.map((c) => '.' + c).join('\n  '))