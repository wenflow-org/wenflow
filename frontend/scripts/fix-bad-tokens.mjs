#!/usr/bin/env node
/**
 * 修掉守卫规则 8 的两笔已知欠账（KNOWN_UNDEFINED 的两条）。
 *
 * 两条都是「引用了不存在的 token 且无兜底」——浏览器会把整条声明丢掉，
 * 表现是某个交互态静默失效，而 CI 全绿：
 *   · --mk-ep-primary-bg   admin-theme.css 会话校验按钮 hover：border-color /
 *     background 同时失效，hover 时按钮没有任何视觉变化
 *   · --transition-base    learning-components.css .zpd-badge 的整条 transition
 *     被丢弃，徽章没有过渡
 *
 * 修法：改用体系中确实存在、语义等价的 token。
 *   --mk-ep-primary-bg   → var(--mk-blue, #2f6ae0)。同文件相邻声明已经这么写
 *                         （--mk-blue 与 --mk-blue-bg），这里补齐即可同源。
 *   --transition-base    → var(--transition-fast)。该文件同时定义了
 *                         --transition-fast/normal/slow/bounce 四档，
 *                         --transition-base 从来不存在；徽章这类小控件
 *                         用 fast 档本就合适。
 *
 * 用法：node scripts/fix-bad-tokens.mjs          # 改文件
 *      node scripts/fix-bad-tokens.mjs --dry    # 只报告不改
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dry = process.argv.includes('--dry')

const FIXES = [
  {
    file: 'src/styles/admin-theme.css',
    find: 'var(--mk-ep-primary-bg)',
    replace: 'var(--mk-blue, #2f6ae0)',
    why: 'EP 桥变量已随 Element Plus 移除而无定义，且未写兜底 → border-color/background 整条失效',
  },
  {
    file: 'src/styles/learning-components.css',
    find: 'var(--transition-base)',
    replace: 'var(--transition-fast)',
    why: '该文件的过渡档只有 fast/normal/slow/bounce，base 从未存在；未写兜底 → 整条 transition 被丢弃',
  },
]

let touched = 0
for (const fix of FIXES) {
  const p = join(ROOT, fix.file)
  const text = readFileSync(p, 'utf8')
  if (!text.includes(fix.find)) {
    console.log(`- 跳过 ${fix.file}：未找到 ${fix.find}（可能已被其他改动修掉）`)
    continue
  }
  const n = text.split(fix.find).length - 1
  if (!dry) writeFileSync(p, text.split(fix.find).join(fix.replace), 'utf8')
  touched += n
  console.log(`${dry ? '[dry] ' : ''}${fix.file}：${n} 处 ${fix.find} → ${fix.replace}`)
  console.log(`         ${fix.why}`)
}
console.log(dry ? `\n(dry 模式，未写文件)` : `\n已修 ${touched} 处。修完请从 check-design-system.mjs 的 KNOWN_UNDEFINED 里摘除这两条。`)