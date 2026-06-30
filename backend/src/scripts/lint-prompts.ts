import * as fs from 'fs'
import * as path from 'path'
import { parsePromptSchema, lintPromptSchema, Archetype } from '../services/prompt-schema'

const PROMPTS_DIR = path.resolve(__dirname, '../../../prompts')

function readFrontmatter(raw: string): { archetype: Archetype | null; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { archetype: null, body: raw }
  const fm = m[1]
  const am = fm.match(/^archetype:\s*(.+)$/m)
  const archetype = am ? (am[1].trim() as Archetype) : null
  return { archetype, body: raw.slice(m[0].length) }
}

const files = fs.readdirSync(PROMPTS_DIR).filter((f) => /^skill\..*\.md$/.test(f))
let compliantCount = 0
let errorFiles = 0

for (const f of files) {
  const raw = fs.readFileSync(path.join(PROMPTS_DIR, f), 'utf8')
  const { archetype, body } = readFrontmatter(raw)
  const schema = parsePromptSchema(body)
  const result = lintPromptSchema(schema, archetype)
  const errs = result.issues.filter((i) => i.level === 'error')
  const warns = result.issues.filter((i) => i.level === 'warning')
  if (result.compliant) compliantCount++
  if (errs.length > 0) errorFiles++

  const tag = result.compliant ? 'OK ' : 'BAD'
  console.log(`[${tag}] ${f}  (archetype=${archetype ?? '-'})  err=${errs.length} warn=${warns.length}`)
  for (const i of result.issues) {
    console.log(`      ${i.level === 'error' ? 'E' : 'w'} [${i.code}] ${i.message}`)
  }
}

console.log(`\n合规(无 error): ${compliantCount}/${files.length}   有 error 的文件: ${errorFiles}`)
