import * as path from 'path'
import { parsePromptSchema, lintPromptSchema, Archetype } from '../services/prompt-schema'
import { scanPromptFiles, type PromptFile } from '../composers/prompt-files/loader'
import { lintDeclaredSkillPromptContract } from '../services/skill-prompt-contract'
import { normalizeRuntimeContract } from '../services/prompt-lab/runtime-contract'
import { checkFiveBlockBody, checkFieldFreeze, type GateIssue } from '../services/prompt-lab/core-compiler'
import { loadCoreFile, scanCoreFiles } from '../services/prompt-lab/core-file-loader'

interface LintIssue {
  level: 'error' | 'warning'
  code: string
  message: string
}

const PROMPTS_DIR = path.resolve(__dirname, '../../../prompts')
const scan = scanPromptFiles(PROMPTS_DIR)
let compliantCount = 0
let errorFiles = 0

function toSkillId(agentId: string): string {
  return String(agentId || '').replace(/^skill:/, '').trim()
}

/** v4 编译产物校验：五块结构 + 核心文件存在性 + 字段冻结（§4.2-1/2） */
function lintV4CompiledPrompt(file: PromptFile): LintIssue[] {
  const issues: LintIssue[] = checkFiveBlockBody(file.systemPrompt).map((issue: GateIssue) => ({
    level: 'error' as const,
    code: issue.code,
    message: issue.message,
  }))
  const skillId = toSkillId(file.agentId)
  const loaded = loadCoreFile(skillId)
  if (!loaded) {
    issues.push({
      level: 'error',
      code: 'core-file-missing',
      message: `声明 coreHash 但找不到核心文件 prompts/core/${skillId}.yaml`,
    })
    return issues
  }
  if (!loaded.core) {
    for (const diagnostic of loaded.diagnostics) {
      issues.push({ level: 'error', code: `core-${diagnostic.code}`, message: diagnostic.message })
    }
    return issues
  }
  for (const issue of checkFieldFreeze(loaded.core, file.systemPrompt)) {
    issues.push({ level: 'error', code: issue.code, message: issue.message })
  }
  return issues
}

for (const file of scan.files.filter((item) => /^skill\..*\.md$/.test(path.basename(item.filePath)))) {
  const f = path.basename(file.filePath)
  const isV4 = Boolean(file.coreHash)
  const fileArchetype = (file.archetype || null) as Archetype | null
  const displayArchetype = isV4 ? 'v4' : fileArchetype

  let issues: LintIssue[]
  if (isV4) {
    // v4：frontmatter 携带 coreHash → 五块结构 + 字段冻结，不走 v2 八块校验
    issues = lintV4CompiledPrompt(file)
  } else {
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
    const result = lintPromptSchema(schema, fileArchetype, {
      inputTransport: contractLint.contract.input.transport,
      outputMedia: contractLint.contract.output.media,
    })
    issues = [
      ...result.issues,
      ...(fileArchetype === 'code-only' ? [] : schema.warnings.map((message) => ({
        level: 'warning' as const,
        code: 'SCHEMA_WARNING',
        message,
      }))),
      ...contractLint.issues,
    ]
  }

  const errs = issues.filter((i) => i.level === 'error')
  const warns = issues.filter((i) => i.level === 'warning')
  const compliant = errs.length === 0
  if (compliant) compliantCount++
  if (errs.length > 0) errorFiles++

  const tag = compliant ? 'OK ' : 'BAD'
  console.log(`[${tag}] ${f}  (archetype=${displayArchetype ?? '-'})  err=${errs.length} warn=${warns.length}`)
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

// ===== 核心文件（prompts/core/*.yaml）独立校验区 =====
const coreScan = scanCoreFiles()
let coreBad = 0
if (coreScan.files.length === 0 && coreScan.diagnostics.length === 0) {
  console.log('\n核心文件: 未发现 prompts/core/*.yaml（v4 尚未接入）')
} else {
  console.log('\n核心文件:')
  for (const core of coreScan.files) {
    console.log(`[OK ] ${core.skillId}.yaml  fields=${core.fields.length} channels=${core.channels.join(',')}`)
  }
  for (const diagnostic of coreScan.diagnostics) {
    coreBad++
    console.log(`[BAD] ${path.basename(diagnostic.filePath)}  E [${diagnostic.code}] ${diagnostic.message}`)
  }
  console.log(`核心文件合规: ${coreScan.files.length}/${coreScan.files.length + coreScan.diagnostics.length}`)
}
if (coreBad > 0) {
  errorFiles += coreBad
}

// lint 必须能阻断 CI：存在 error 级问题时以非零退出码结束
if (errorFiles > 0) {
  console.log(`\n[prompts:lint] ${errorFiles} 个文件存在 error 级问题，判定失败`)
  process.exitCode = 1
}
