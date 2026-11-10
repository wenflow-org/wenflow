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
 * 规则 B（超大文件守卫，分级）：
 *   B1 绝对硬顶：单个非测试 .ts 文件超过 HARD_CAP 行直接失败，`--allow-grow` **不放行**，必须拆。
 *      「再长一个 4000 行文件」由这一条挡住，不靠逐文件棘轮。
 *   B2 容差带：已登记的 >LINE_BUDGET 文件较基线可增长 max(TOLERANCE_MIN, 1%) 行，只告警不失败。
 *      加几行注释/小修复不该逼人改基线。
 *   B3 登记：超过容差才需 `--update --allow-grow`；未登记的新文件超 LINE_BUDGET 直接失败。
 *   基线更新 `--update` 只允许收缩；`--allow-grow` 时 note 由脚本按提交与增长清单自动生成，
 *   不再手写长篇说明（历史 note 保留）。
 *
 * 用法：
 *   node scripts/check-services-layering.mjs            # 校验（CI / npm run layering:check）
 *   node scripts/check-services-layering.mjs --update   # 代码拆小后下调基线（只许收缩）
 *   node scripts/check-services-layering.mjs --update --allow-grow   # 登记增长（note 自动生成）
 *   node scripts/check-services-layering.mjs --selftest # 纯函数自测，不读仓库
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const BASELINE_PATH = join(ROOT, 'services-layering-baseline.json')
const LINE_BUDGET = 1000
/** B1 绝对硬顶：超过即失败，--allow-grow 也不放行（必须拆分）。 */
const HARD_CAP = 2500
/** B2 容差带：已登记文件允许的增长，取 max(下限, 基线比例)。 */
const TOLERANCE_MIN = 20
const TOLERANCE_RATIO = 0.01

/** 已登记文件允许增长的行数（不含基线本身）。 */
export function growthTolerance(baselineLines) {
  return Math.max(TOLERANCE_MIN, Math.ceil(baselineLines * TOLERANCE_RATIO))
}

/**
 * 单个文件的体积判定（纯函数，供自测）。
 * @returns {{level:'hard'|'violation'|'warn'|'ok', message:string}}
 */
export function evaluateSize(file, lines, baselineLines, budget = LINE_BUDGET, hardCap = HARD_CAP) {
  if (lines > hardCap) {
    return { level: 'hard', message: `${file} ${lines} 行，超过硬顶 ${hardCap} 行（必须拆分；--allow-grow 不放行）` }
  }
  if (baselineLines === undefined) {
    if (lines > budget) return { level: 'violation', message: `${file} 新增超 ${budget} 行文件（${lines} 行，未登记基线）` }
    return { level: 'ok', message: '' }
  }
  const tol = growthTolerance(baselineLines)
  if (lines > baselineLines + tol) {
    return {
      level: 'violation',
      message: `${file} 从基线 ${baselineLines} 行涨到 ${lines} 行（容差 ${tol} 行，超出 ${lines - baselineLines - tol} 行；确需增长请 --update --allow-grow）`,
    }
  }
  if (lines > baselineLines) {
    return { level: 'warn', message: `${file} 较基线 +${lines - baselineLines} 行（在容差 ${tol} 行内，不失败）` }
  }
  return { level: 'ok', message: '' }
}

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
    note: next.note || `单个非测试 .ts 文件 > ${next.lineBudget} 行必须登记；超过硬顶 ${HARD_CAP} 行必须拆分（--allow-grow 不放行）。已登记文件可有 max(${TOLERANCE_MIN} 行, ${TOLERANCE_RATIO * 100}%) 容差，超出才需 --update --allow-grow（note 自动生成）。`,
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

  // B2 容差带
  cases.push(['容差下限恒为 20 行', growthTolerance(500) === 20])
  cases.push(['容差：1800 行基线仍取下限 20', growthTolerance(1800) === 20])
  cases.push(['容差按 1% 放大（5000 → 50）', growthTolerance(5000) === 50])
  cases.push(['容差内增长只告警', evaluateSize('x.ts', 1815, 1800).level === 'warn'])
  cases.push(['恰好用尽容差不失败', evaluateSize('x.ts', 1820, 1800).level === 'warn'])
  cases.push(['超出容差 1 行即失败', evaluateSize('x.ts', 1821, 1800).level === 'violation'])
  cases.push(['收缩不告警', evaluateSize('x.ts', 1700, 1800).level === 'ok'])
  cases.push(['未登记且超预算失败', evaluateSize('x.ts', 1200, undefined).level === 'violation'])
  cases.push(['未登记但在预算内通过', evaluateSize('x.ts', 900, undefined).level === 'ok'])

  // B1 绝对硬顶
  cases.push(['超过硬顶即使已登记也失败', evaluateSize('x.ts', 2501, 2501).level === 'hard'])
  cases.push(['恰好等于硬顶不失败', evaluateSize('x.ts', 2500, 2500).level === 'ok'])
  cases.push(['硬顶判定不因基线而放行', evaluateSize('x.ts', 2501, 1000).level === 'hard'])

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

/** 当前 HEAD 短 sha（仅用于 note 溯源；取不到就写 unknown，不让它影响判定）。 */
function headShort() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

/** --allow-grow 时按增长清单自动生成 note 段落，避免手写长篇说明。 */
export function appendGrowNote(note, previous, next, head = headShort(), now = new Date().toISOString().slice(0, 10)) {
  const added = Object.keys(next).filter((f) => previous[f] === undefined).map((f) => `${f} ${next[f]}（新登记）`)
  const grown = Object.keys(next).filter((f) => previous[f] !== undefined && next[f] > previous[f]).map((f) => `${f} ${previous[f]}→${next[f]}`)
  if (added.length === 0 && grown.length === 0) return note || ''
  return `${String(note || '').replace(/\s*$/, '')} ${now} --allow-grow 自动登记（HEAD ${head}）：${[...added, ...grown].join('、')}。`
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
  const sizeWarnings = []
  for (const [file, lines] of Object.entries(currentOversize)) {
    const verdict = evaluateSize(file, lines, previous[file], budget)
    if (verdict.level === 'violation' || verdict.level === 'hard') sizeViolations.push(verdict.message)
    else if (verdict.level === 'warn') sizeWarnings.push(verdict.message)
  }

  if (UPDATE) {
    const nextOversize = { ...currentOversize }
    const problems = []
    // B1 绝对硬顶：--allow-grow 也不放行
    for (const [file, lines] of Object.entries(nextOversize)) {
      if (lines > HARD_CAP) problems.push(`${file} ${lines} 行超过硬顶 ${HARD_CAP} 行；必须拆分，--allow-grow 不放行`)
    }
    if (!ALLOW_GROW) {
      for (const [file, lines] of Object.entries(nextOversize)) {
        const allowed = previous[file]
        if (allowed === undefined) problems.push(`${file}（${lines} 行）不在旧基线上；确需登记请加 --allow-grow`)
        else if (lines > allowed + growthTolerance(allowed)) problems.push(`${file} 由 ${allowed} 涨到 ${lines} 行；超出容差 ${growthTolerance(allowed)} 行，确需增长请加 --allow-grow`)
      }
    }
    if (problems.length) {
      console.error('[layering] 拒绝更新基线：')
      for (const p of problems) console.error(`  - ${p}`)
      process.exit(1)
    }
    writeBaseline({
      lineBudget: budget,
      oversize: nextOversize,
      note: ALLOW_GROW ? appendGrowNote(baseline.note, previous, nextOversize) : baseline.note,
    })
    const shrunk = Object.keys(previous).filter((f) => nextOversize[f] === undefined || nextOversize[f] < previous[f])
    console.log(`[layering] 基线已更新：${Object.keys(previous).length} → ${Object.keys(nextOversize).length} 项` +
      (shrunk.length ? `（收缩：${shrunk.join(', ')}）` : ''))
    return
  }

  const totals = [...serviceFiles, ...routeFiles]
  const totalLines = totals.reduce((sum, file) => sum + countLines(readFileSync(file, 'utf8')), 0)
  console.log(
    `[layering] services ${serviceFiles.length} 文件 / routes ${routeFiles.length} 文件；` +
      `合计 ${totalLines} 行；>${budget} 行文件 ${Object.keys(currentOversize).length} 个（基线 ${Object.keys(previous).length} 个）；硬顶 ${HARD_CAP} 行`
  )

  if (sizeWarnings.length) {
    console.log('[layering] 容差内增长（不失败）：')
    for (const w of sizeWarnings) console.log(`  · ${w}`)
  }

  if (directionViolations.length === 0 && sizeViolations.length === 0) {
    console.log('[layering] ✓ 分层守卫通过（services 无反向 HTTP 依赖；超大文件未越界）')
    return
  }
  if (directionViolations.length) {
    console.error('[layering] 服务层反向依赖 HTTP 层（services→routes/middleware）：')
    for (const v of directionViolations) console.error(`  - ${v.file} → ${v.spec}`)
  }
  if (sizeViolations.length) {
    console.error('[layering] 超大文件守卫失败：')
    for (const v of sizeViolations) console.error(`  - ${v}`)
  }
  process.exit(1)
}

main()
