#!/usr/bin/env node
/**
 * 导出「界面中文文案语料」供语义审阅（不是门禁）。
 *
 * 关键词门禁（check-ui-copy.mjs）只能抓词典/句式反模式；「随此切换，记忆与行为基线不变」
 * 这类解释性文案每个词都合法，只能靠读者（人或大模型）按语义判断。本脚本把候选行连同
 * 文件与行号导出，交给审阅方逐条判「删 / 留」，审阅标准见 doc/ADMIN_COPY_SEMANTIC_AUDIT.md。
 *
 * 用法：
 *   node scripts/dump-ui-copy.mjs                 # JSONL → stdout
 *   node scripts/dump-ui-copy.mjs --out copy.jsonl
 *   node scripts/dump-ui-copy.mjs --dir src/views/admin-redesign
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const dirIdx = args.indexOf('--dir')
const root = path.resolve(HERE, '..')
const target = dirIdx >= 0 ? path.resolve(root, args[dirIdx + 1]) : path.resolve(root, 'src')
const outPath = outIdx >= 0 ? path.resolve(root, args[outIdx + 1]) : ''

const SKIP_DIRS = new Set(['__tests__', 'test', 'tests', 'node_modules', 'dist'])
const HAN = /[\u4e00-\u9fff]/
/* 注释不是产品文案：行首注释整行跳过；行尾注释无法可靠剥离，保留并让审阅方按上下文判断 */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|<!--|#)/

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
      walk(p, out)
    } else if (/\.(vue|ts|js)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

const rows = []
for (const file of walk(target)) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const text = line.trim()
    if (!text || !HAN.test(text) || COMMENT_LINE.test(text)) return
    rows.push({ file: rel, line: i + 1, text })
  })
}

const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
if (outPath) {
  fs.writeFileSync(outPath, body, 'utf8')
  console.log(`导出 ${rows.length} 行 → ${path.relative(root, outPath)}`)
} else {
  process.stdout.write(body)
}
