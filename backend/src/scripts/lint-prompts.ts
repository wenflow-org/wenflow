import * as path from 'path'
import { parsePromptSchema, lintPromptSchema, Archetype } from '../services/prompt-schema'
import { scanPromptFiles } from '../composers/prompt-files/loader'
import { lintDeclaredSkillPromptContract } from '../services/skill-prompt-contract'
import { normalizeRuntimeContract } from '../services/prompt-lab/runtime-contract'

const PROMPTS_DIR = path.resolve(__dirname, '../../../prompts')
const scan = scanPromptFiles(PROMPTS_DIR)
let compliantCount = 0
let errorFiles = 0

for (const file of scan.files.filter((item) => /^skill\..*\.md$/.test(path.basename(item.filePath)))) {
  const f = path.basename(file.filePath)
  const archetype = (file.archetype || null) as Archetype | null
  const schema = parsePromptSchema(file.systemPrompt)
  const runtimeContract = file.runtimeContract === undefined
    ? undefined
    : normalizeRuntimeContract(file.runtimeContract, {
        skillId: file.agentId,
        archetype: file.archetype,
      })
  const contractLint = lintDeclaredSkillPromptContract(file.promptContract, {
    skillId: file.agentId,
    archetype: file.archetype,
    runtimeContract,
  })
  const result = lintPromptSchema(schema, archetype, {
    inputTransport: contractLint.contract.input.transport,
    outputMedia: contractLint.contract.output.media,
  })
  const issues = [
    ...result.issues,
    ...(archetype === 'code-only' ? [] : schema.warnings.map((message) => ({
      level: 'warning' as const,
      code: 'SCHEMA_WARNING',
      message,
    }))),
    ...contractLint.issues,
  ]
  const errs = issues.filter((i) => i.level === 'error')
  const warns = issues.filter((i) => i.level === 'warning')
  const compliant = errs.length === 0
  if (compliant) compliantCount++
  if (errs.length > 0) errorFiles++

  const tag = compliant ? 'OK ' : 'BAD'
  console.log(`[${tag}] ${f}  (archetype=${archetype ?? '-'})  err=${errs.length} warn=${warns.length}`)
  for (const i of issues) {
    console.log(`      ${i.level === 'error' ? 'E' : 'w'} [${i.code}] ${i.message}`)
  }
}

for (const diagnostic of scan.diagnostics) {
  errorFiles++
  console.log(`[BAD] ${path.basename(diagnostic.filePath)}  E [${diagnostic.code}] ${diagnostic.message}`)
}

const total = scan.files.filter((item) => /^skill\..*\.md$/.test(path.basename(item.filePath))).length + scan.diagnostics.length
console.log(`\n合规(无 error): ${compliantCount}/${total}   有 error 的文件: ${errorFiles}`)
