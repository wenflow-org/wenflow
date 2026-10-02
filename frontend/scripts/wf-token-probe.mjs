#!/usr/bin/env node
/**
 * 令牌解析快照工具（批次 A/B 零回归证明）
 *
 * 背景：把 --mk-* / --color-* 降为 var(--wf-*) 别名后，CSS 变量是动态解析的，
 * 单元测试与 design:check 都看不见「某个 token 在某个主题下解析成了什么」。
 * 本脚本静态解析全局令牌层，沿 var() 链求出每个 token 的最终字面量，
 * 分别给出亮色 / 暗色两份快照供 diff。
 *
 * 为什么必须建成「单一级联」而不是亮暗两张独立表
 * ----------------------------------------------
 * 真实 CSS 里 `:root` 的声明在**两个主题下都生效**，暗色块只是再覆盖一遍。
 * 所以暗色档的起点必须是「全部 :root 声明」+「暗色块声明」，而不是暗色块自己。
 * 2026-10-02 修的那个级联缺陷正是这一类：admin-surface.css 的 `:root` 浅色字面量
 * 在暗色下把 design-system.css 的暗色值整片盖掉——只有单一级联模型才看得见。
 *
 * 加载顺序（Vite 内联 @import 后的真实源码顺序，后声明覆盖先声明）
 * --------------------------------------------------------------
 *   1. tokens.css             :root            main.css:10（2026-10-02 新增）
 *   2. tokens.css             [dark] / .dark
 *   3. design-system.css      :root            main.css:14
 *   4. design-system.css      [dark] / .dark
 *   5. admin-surface.css      :root            main.css:17
 *   6. admin-surface.css      [dark] / .dark    2026-10-02 新增
 *   7. learning-components.css                 main.css:20
 *   8. main.css               :root            main.ts:15
 *   9. main.css               html[dark]       main.ts:15（(0,1,1) 特异性最高）
 *  10. admin-theme.css        :root            main.ts:16
 *  11. admin-theme.css        [dark] / .dark
 *
 * 特异性：:root 与 [data-theme='dark'] 同为 (0,1,0)，靠源码顺序决胜；
 * main.css 的暗色块写作 html[data-theme='dark']，(0,1,1) 高一档，故排最后。
 * 本脚本不模拟完整特异性计算，但「同权重按源码序、高权重靠后」与上表一致，
 * 足以发现别名重指向导致的解析结果漂移。
 *
 * 用法
 * ----
 *   node scripts/wf-token-probe.mjs                      # 当前工作区快照 → stdout
 *   node scripts/wf-token-probe.mjs --dir <dir>          # 从指定目录读样式（git HEAD 快照用）
 *   node scripts/wf-token-probe.mjs > after.json
 *   node scripts/wf-token-probe.mjs --diff before.json after.json
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
/** --dir <path>：从任意目录读样式文件（用于对 git HEAD 快照取「改动前」基线） */
const dirArg = process.argv.indexOf('--dir')
const STYLES = dirArg !== -1 ? process.argv[dirArg + 1] : join(ROOT, 'src', 'styles')

/**
 * 全局令牌层的**真实源码顺序**。Vite 内联 @import 后，同一文件内 :root 与暗色块
 * 保持文件内先后，文件之间按 import 位置排开。后声明覆盖先声明。
 *
 *   1. tokens.css             :root        main.css 顶部第一行 @import（2026-10-02 新增）
 *   2. tokens.css             [dark]
 *   3. design-system.css      :root        main.css @import
 *   4. design-system.css      [dark]
 *   5. admin-surface.css      :root        main.css @import（在 design-system 之后）
 *   6. admin-surface.css      [dark]       2026-10-02 新增
 *   7. learning-components.css             main.css @import
 *   8. main.css               :root        main.ts:15
 *   9. main.css               html[dark]   main.ts:15（(0,1,1)，压过所有 (0,1,0)）
 *  10. admin-theme.css        :root        main.ts:16
 *  11. admin-theme.css        [dark]
 *
 * 这个顺序不是形式主义：第 4 步在第 5 步**之前**，正是 2026-10-02 那个级联缺陷的成因——
 * design-system.css 的暗色块本来写对了，却被后加载的 admin-surface.css 的 `:root`
 * 浅色字面量整片盖掉。任何把暗色块统一排到最后的简化模型都会看不见这个 bug。
 *
 * 特异性：:root 与 [data-theme='dark'] 同为 (0,1,0)，靠源码顺序决胜；
 * 第 9 步写作 html[data-theme='dark']，(0,1,1) 高一档，故排最后。
 */
const SOURCE_ORDER = [
  { file: 'tokens.css', scope: 'root' },
  { file: 'tokens.css', scope: 'dark' },
  { file: 'design-system.css', scope: 'root' },
  { file: 'design-system.css', scope: 'dark' },
  { file: 'admin-surface.css', scope: 'root' },
  { file: 'admin-surface.css', scope: 'dark' },
  { file: 'learning-components.css', scope: 'root' },
  { file: 'main.css', scope: 'root' },
  { file: 'main.css', scope: 'dark' },
  { file: 'admin-theme.css', scope: 'root' },
  { file: 'admin-theme.css', scope: 'dark' },
]

const ROOT_RE = /:root\s*\{/g
const DARK_RE =
  /(?:html\[data-theme=['"]dark['"]\]|\[data-theme=['"]dark['"]\]|\.dark)\s*\{/g

/** 抽取一段 css 里所有匹配块的自定义属性声明 */
function extract(css, re) {
  const out = new Map()
  const rx = new RegExp(re.source, re.flags)
  let m
  while ((m = rx.exec(css)) !== null) {
    // 花括号配平，取块体
    let depth = 1
    let k = rx.lastIndex
    while (k < css.length && depth > 0) {
      if (css[k] === '{') depth += 1
      else if (css[k] === '}') depth -= 1
      k += 1
    }
    const body = css.slice(rx.lastIndex, k - 1).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const d of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      out.set(d[1], d[2].trim())
    }
  }
  return out
}

const read = (f) => {
  const p = join(STYLES, f)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/**
 * 构建单一级联表。
 * :root 的声明在**两个主题下都生效**，暗色块只是在其上再覆盖一遍，
 * 所以暗色档 = 整条源码顺序全走一遍；亮色档 = 同一条顺序但跳过所有暗色块。
 */
function cascade(withDark) {
  const table = new Map()
  const cache = new Map()
  for (const { file, scope } of SOURCE_ORDER) {
    if (scope === 'dark' && !withDark) continue
    let css = cache.get(file)
    if (css === undefined) {
      css = read(file)
      cache.set(file, css)
    }
    if (css === null) continue
    const re = scope === 'root' ? ROOT_RE : DARK_RE
    for (const [k, v] of extract(css, re)) table.set(k, v)
  }
  return table
}

/** 沿 var() 链求最终值；无法解析时返回可读的标记，便于人工判断是不是死链 */
function resolve(name, table, seen = new Set()) {
  if (!table.has(name)) return null
  if (seen.has(name)) return `CYCLE(${name})`
  seen.add(name)
  const v = table.get(name).replace(
    /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)/g,
    (_, ref, fallback) => {
      const r = resolve(ref, table, seen)
      if (r !== null && !r.startsWith('CYCLE')) return r
      return fallback !== undefined ? fallback.trim() : `UNRESOLVED(${ref})`
    }
  )
  return v.replace(/\s+/g, ' ').trim()
}

const snapshot = {}
for (const [mode, withDark] of [['light', false], ['dark', true]]) {
  const table = cascade(withDark)
  const resolved = {}
  for (const name of [...table.keys()].sort()) {
    const r = resolve(name, table)
    if (r !== null) resolved[name] = r
  }
  snapshot[mode] = resolved
}

if (process.argv.includes('--diff')) {
  const [a, b] = process.argv.filter((x) => x.endsWith('.json'))
  if (!a || !b) {
    console.error('用法：wf-token-probe.mjs --diff <before.json> <after.json>')
    process.exit(2)
  }
  const before = JSON.parse(readFileSync(a, 'utf8'))
  const after = JSON.parse(readFileSync(b, 'utf8'))
  let changes = 0
  for (const mode of ['light', 'dark']) {
    const keys = new Set([
      ...Object.keys(before[mode] || {}),
      ...Object.keys(after[mode] || {}),
    ])
    for (const k of [...keys].sort()) {
      const x = before[mode]?.[k]
      const y = after[mode]?.[k]
      if (x === y) continue
      changes += 1
      const label = mode === 'light' ? '亮色' : '暗色'
      console.log(`${label}  ${k}: ${x ?? '(无)'}  →  ${y ?? '(无)'}`)
    }
  }
  console.log(
    changes === 0 ? '\n✓ 令牌解析结果零变化' : `\n共 ${changes} 处变化`
  )
  process.exit(0)
}

console.log(JSON.stringify(snapshot, null, 2))
