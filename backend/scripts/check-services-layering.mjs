#!/usr/bin/env node
/**
 * 后端服务层分层棘轮守卫（#76）
 *
 * 背景：`src/services` 现 338 个文件 / 91.9k 行，`routes/admin/virtual-learners.ts` 曾长到 4102 行
 * （已按声明簇拆成 4 个子文件，入口 42 行）。拆分本身不防复发——本守卫用两条「只降不升」规则防止：
 *
 * 规则 A（方向倒置，零容忍）：`src/services/**` 不得 import `src/routes/**` 或 `src/middleware/**`。
 *   服务层不能反向依赖 HTTP 传输层；静态 import / 动态 import() / require() 都算。
 *
 * 规则 B（超大文件棘轮）：`src/services/**` 与 `src/routes/**` 下单个非测试 .ts 文件
 *   超过 LINE_BUDGET 行必须登记在基线里，且只许缩短；未登记的新文件超限直接失败。
 *   基线更新 `--update` 只允许收缩（删除/变小），新增条目需显式 `--allow-grow` 并说明理由——
 *   让「再长一个 4000 行文件」成为一次有意识的评审动作，而不是顺手产物。
 *
 * 用法：
 *   node scripts/check-services-layering.mjs            # 校验（CI / npm run layering:check）
 *   node scripts/check-services-layering.mjs --update   # 代码拆小后下调基线（只许收缩）
 *   node scripts/check-services-layering.mjs --update --allow-grow   # 重建基线（新增放行，慎用）
 *   node scripts/check-services-layering.mjs --selftest # 纯函数自测，不读仓库
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const BASELINE_PATH = join(ROOT, 'services-layering-baseline.json')
const LINE_BUDGET = 1000

const rel = (p) => posix.join(...relative(ROOT, p).split(/[\\/]/))
const ARGV = new Set(process.argv.slice(2))
const UPDATE = ARGV.has('--update')
const ALLOW_GROW = ARGV.has('--allow-grow')
const SELFTEST = ARGV.has('--selftest')

/** 递归收集源码文件（跳过测试与声明文件） */
export function walkSources(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'generated') continue
      walkSources(p, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

/** 匹配静态 import / export ... from / 动态 import() / require() */
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

/** 服务层对 HTTP 层（routes/middleware）的运行时导入（相对路径解析后判定） */
export function findDirectionViolations(files, readFile = (p) => readFileSync(p, 'utf8')) {
  const violations = []
  const httpDirs = [`${SRC.replace(/\\/g, '/')}/routes`, `${SRC.replace(/\\/g, '/')}/middleware`]
  for (const file of files) {
    const abs = resolve(file)
    const text = readFile(abs)
    IMPORT_RE.lastIndex = 0
    let m
    while ((m = IMPORT_RE.exec(text))) {
      const spec = m[1]
      if (!spec.startsWith('.')) continue
      const target = join(dirname(abs), spec).replace(/\\/g, '/').replace(/\.(ts|js|tsx|jsx)$/, '').replace(/\/index$/, '')
      if (httpDirs.some((dir) => target.startsWith(dir))) {
        violations.push({ file: rel(abs), spec })
      }
    }
  }
  return violations
}

/** 统计源码行数（文件末尾无换行时 split 会少一行，统一按换行符数+1 计算） */
export function countLines(text) {
  return text.split('\n').length
}

/** 找出所有超过预算的文件（用于基线重建与校验） */
export function findOversize(files, budget = LINE_BUDGET, readFile = (p) => readFileSync(p, 'utf8')) {
  const result = {}
  for (const file of files) {
    const lines = countLines(readFile(file))
    if (lines > budget) result[rel(file)] = lines
  }
  return result
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { lineBudget: LINE_BUDGET, oversize: {}, note: '' }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

function writeBaseline(next) {
  const sorted = {}
  for (const key of Object.keys(next.oversize).sort()) sorted[key] = next.oversize[key]
  const payload = {
    lineBudget: next.lineBudget,
    note: next.note || '单个非测试 .ts 文件 > lineBudget 行必须登记且只许缩短；--update 只允许收缩（#76）',
    oversize: sorted,
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

function selftest() {
  const cases = []
  const fakeFiles = ['src/services/a.ts']
  const readA = () => `import x from '../routes/learning';\nimport y from '../middleware/auth';\nimport z from './ok';`
  const v = findDirectionViolations(fakeFiles, readA)
  cases.push(['routes 导入被识别', v.length === 2], ['middleware 导入被识别', v.some((x) => x.spec.includes('middleware'))])
  const clean = findDirectionViolations(['src/services/b.ts'], () => `import z from '../utils/logger';`)
  cases.push(['同层/工具导入不误报', clean.length === 0])
  cases.push(['行数统计', countLines('a\nb\nc') === 3])
  const over = findOversize(['src/services/c.ts'], 2, () => '1\n2\n3')
  cases.push(['超预算被识别', over['src/services/c.ts'] === 3])
  const under = findOversize(['src/services/d.ts'], 3, () => '1\n2\n3')
  cases.push(['等于预算不告警', Object.keys(under).length === 0])
  let failed = 0
  for (const [name, ok] of cases) {
    console.log(`${ok ? '✓' : '✗'} ${name}`)
    if (!ok) failed += 1
  }
  if (failed) {
    console.error(`[layering] 自测失败 ${failed} 例`)
    process.exit(1)
  }
  console.log('[layering] 自测通过')
}

function main() {
  if (SELFTEST) return selftest()

  const serviceFiles = walkSources(join(SRC, 'services'))
  const routeFiles = walkSources(join(SRC, 'routes'))
  const directionViolations = findDirectionViolations(serviceFiles)

  const baseline = loadBaseline()
  const budget = baseline.lineBudget || LINE_BUDGET
  const currentOversize = findOversize([...serviceFiles, ...routeFiles], budget)
  const previous = baseline.oversize || {}

  const sizeViolations = []
  for (const [file, lines] of Object.entries(currentOversize)) {
    const allowed = previous[file]
    if (allowed === undefined) {
      sizeViolations.push(`${file} 新增超 ${budget} 行文件（${lines} 行，未登记基线）`)
    } else if (lines > allowed) {
      sizeViolations.push(`${file} 从基线 ${allowed} 行涨到 ${lines} 行（只许缩短）`)
    }
  }

  if (UPDATE) {
    const nextOversize = { ...currentOversize }
    const problems = []
    if (!ALLOW_GROW) {
      for (const [file, lines] of Object.entries(nextOversize)) {
        const allowed = previous[file]
        if (allowed === undefined) problems.push(`${file}（${lines} 行）不在旧基线上；确需登记请加 --allow-grow`)
        else if (lines > allowed) problems.push(`${file} 由 ${allowed} 涨到 ${lines} 行；只许缩短`)
      }
    }
    if (problems.length) {
      console.error('[layering] 基线只允许收缩，拒绝更新：')
      for (const p of problems) console.error(`  - ${p}`)
      process.exit(1)
    }
    writeBaseline({ lineBudget: budget, oversize: nextOversize, note: baseline.note })
    const shrunk = Object.keys(previous).filter((f) => nextOversize[f] === undefined || nextOversize[f] < previous[f])
    console.log(`[layering] 基线已更新：${Object.keys(previous).length} → ${Object.keys(nextOversize).length} 项` +
      (shrunk.length ? `（收缩：${shrunk.join(', ')}）` : ''))
    return
  }

  const totals = [...serviceFiles, ...routeFiles]
  const totalLines = totals.reduce((sum, file) => sum + countLines(readFileSync(file, 'utf8')), 0)
  console.log(
    `[layering] services ${serviceFiles.length} 文件 / routes ${routeFiles.length} 文件；` +
      `合计 ${totalLines} 行；>${budget} 行文件 ${Object.keys(currentOversize).length} 个（基线 ${Object.keys(previous).length} 个）`
  )

  if (directionViolations.length === 0 && sizeViolations.length === 0) {
    console.log('[layering] ✓ 分层守卫通过（services 无反向 HTTP 依赖；超大文件未增长）')
    return
  }
  if (directionViolations.length) {
    console.error('[layering] 服务层反向依赖 HTTP 层（services→routes/middleware）：')
    for (const v of directionViolations) console.error(`  - ${v.file} → ${v.spec}`)
  }
  if (sizeViolations.length) {
    console.error('[layering] 超大文件棘轮失败：')
    for (const v of sizeViolations) console.error(`  - ${v}`)
  }
  process.exit(1)
}

main()
