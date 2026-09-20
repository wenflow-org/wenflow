#!/usr/bin/env node
/**
 * 后端路由「数据库边界」守卫（架构审计 §5 行动 #1）
 *
 * 规则：`src/routes/**`（不含测试）不得直接 import 数据库层客户端——
 *   - config/database          （主库 PrismaClient 单例）
 *   - config/system-database   （system 库 PrismaClient 单例）
 *   - generated/system-client  （system 库生成的 Prisma 客户端）
 *   - @prisma/client           （主库生成的 Prisma 客户端）
 * 路由应改为依赖 service / repository 层，否则分层形同虚设。
 *
 * 棘轮（只降不升），两个口径同时约束：
 *   1. 文件数：违规文件清单只许缩短。
 *   2. 调用处数：每个豁免文件内的数据库直连调用点（`<binding>.model...` 成员访问）
 *      计数只许下降。防止「文件清零但调用塞进剩余豁免文件」的绕行。
 *
 * 机制：
 *   1. ESLint 侧：`.eslintrc.json` 里的 `no-restricted-imports` override 对
 *      `src/routes/**` 生效；存量违例文件由同文件的 `"off"` override（{@link BASELINE_PATH} 镜像）豁免。
 *   2. 本脚本维护 `eslint-boundary-baseline.json`（排序后的存量清单 + 每文件调用处数），
 *      并保证它与 ESLint 豁免清单一致。`--update` **只允许收缩**：出现基线外的新违规
 *      或任一文件调用处数上涨都会直接失败，需先把代码下沉到 service 层。
 *
 * 用法：
 *   node scripts/check-route-db-boundary.mjs            # 校验（CI / npm run boundaries:check）
 *   node scripts/check-route-db-boundary.mjs --update   # 收敛后下调基线 + 同步 ESLint 豁免清单
 *   node scripts/check-route-db-boundary.mjs --update --allow-grow   # 仅在重建基线时使用（新增放行）
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const ROUTES = join(SRC, 'routes')
const BASELINE_PATH = join(ROOT, 'eslint-boundary-baseline.json')
const ESLINT_PATH = join(ROOT, '.eslintrc.json')

/** 被禁止在 routes 层直接引用的数据库层模块（绝对路径，比较时去掉扩展名） */
const FORBIDDEN_MODULES = [
  join(SRC, 'config', 'database'),
  join(SRC, 'config', 'system-database'),
  join(SRC, 'generated', 'system-client'),
]
/** 被禁止在 routes 层直接引用的 Prisma 生成客户端包 */
const FORBIDDEN_PACKAGES = ['@prisma/client']

const rel = (p) => posix.join(...relative(ROOT, p).split(/[\\/]/))
const norm = (p) => p.replace(/\\/g, '/').replace(/\.(ts|js|tsx|jsx)$/, '')

/** 匹配静态 import / export ... from / 动态 import() / require() */
const IMPORT_RE =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

/** 匹配完整静态 import 声明（含绑定子句），用于提取本地绑定名 */
const IMPORT_CLAUSE_RE = /^import\s+(type\s+)?([\w$*\s{},]+?)\s+from\s+['"]([^'"]+)['"]/gm

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.d.ts') &&
      !/\.(test|spec)\.ts$/.test(name)
    ) {
      out.push(p)
    }
  }
  return out
}

function isForbidden(spec, fromFile) {
  if (spec.startsWith('.')) {
    const resolved = norm(join(dirname(fromFile), spec)).replace(/\/index$/, '')
    return FORBIDDEN_MODULES.some((m) => resolved === norm(m))
  }
  return FORBIDDEN_PACKAGES.some((p) => spec === p || spec.startsWith(p + '/'))
}

/** 从一条 import 绑定子句中提取所有本地绑定名（默认导入、命名导入、别名、namespace） */
function extractBindingNames(clause) {
  const names = []
  for (const rawPart of clause.split(',')) {
    const part = rawPart.replace(/\btype\s+/g, '').replace(/[{}]/g, '').trim()
    if (!part) continue
    // `a as b` 取别名 b；`* as ns` 取 ns；普通标识符取本身
    const asMatch = part.match(/\*\s+as\s+([\w$]+)$/) || part.match(/^([\w$]+)\s+as\s+([\w$]+)$/)
    names.push(asMatch ? asMatch[asMatch.length - 1] : part)
  }
  return names.filter((n) => /^[\w$]+$/.test(n))
}

/** 去掉块注释与行注释（行注释剥离对字符串内 `//` 不做区分，仅影响计数口径，可接受） */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 统计某文件内数据库客户端的直连调用处数：对每个来自禁用模块的运行时绑定名，
 * 统计 `<name>.` 成员访问出现次数（import 行本身不含 `name.`，天然排除）。
 */
function countDirectCalls(text, fromFile) {
  const stripped = stripComments(text)
  const bindings = new Set()
  IMPORT_CLAUSE_RE.lastIndex = 0
  let m
  while ((m = IMPORT_CLAUSE_RE.exec(stripped))) {
    const [, typeOnly, clause, spec] = m
    if (typeOnly) continue // type-only import 无运行时调用
    if (!isForbidden(spec, fromFile)) continue
    for (const name of extractBindingNames(clause)) bindings.add(name)
  }
  let count = 0
  for (const name of bindings) {
    const re = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\s*\\.\\s*[\\w$]`, 'g')
    count += (stripped.match(re) || []).length
  }
  return count
}

/** 扫描当前所有违规文件与其直连调用处数（key 为相对 backend 的 posix 路径） */
function scanViolations() {
  const violations = new Set()
  const counts = {}
  for (const abs of walk(ROUTES)) {
    const text = readFileSync(abs, 'utf8')
    IMPORT_RE.lastIndex = 0
    let m
    const specs = new Set()
    while ((m = IMPORT_RE.exec(text))) specs.add(m[1])
    if ([...specs].some((s) => isForbidden(s, abs))) {
      const key = rel(abs)
      violations.add(key)
      counts[key] = countDirectCalls(text, abs)
    }
  }
  return { files: [...violations].sort(), counts }
}

const NOTE =
  'ESLint 数据库边界基线（棘轮：只降不升）。src/routes/**（不含测试）禁止直接 import ' +
  'config/database、config/system-database、generated/system-client、@prisma/client；' +
  'violations 为存量豁免文件，occurrences 为每文件数据库直连调用处数——两者都只能收缩，' +
  '只能用 `npm --prefix backend run boundaries:update` 下调，禁止新增。'

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

function readEslint() {
  return JSON.parse(readFileSync(ESLINT_PATH, 'utf8'))
}

/** 找到承担「存量豁免」职责的 override（rules["no-restricted-imports"] === "off"） */
function findExemptOverride(eslint) {
  const idx = (eslint.overrides || []).findIndex(
    (o) => o && o.rules && o.rules['no-restricted-imports'] === 'off'
  )
  if (idx === -1) {
    throw new Error(
      '.eslintrc.json 中找不到 no-restricted-imports="off" 的存量豁免 override，无法同步基线。'
    )
  }
  return idx
}

const { files: current, counts: currentCounts } = scanViolations()
const currentTotal = current.reduce((sum, f) => sum + currentCounts[f], 0)

if (process.argv.includes('--update')) {
  const existing = readBaseline()
  const existingSet = new Set(existing?.violations || [])
  const existingCounts = existing?.occurrences || null
  const allowGrow = process.argv.includes('--allow-grow')
  const added = current.filter((f) => !existingSet.has(f))

  // 棘轮（文件口径）：除首次初始化 / 显式 --allow-grow 外，禁止把新违规文件写进基线。
  if (existing && !allowGrow && added.length) {
    console.error(`✖ 拒绝上调基线：发现 ${added.length} 个基线外的新违规，棘轮只降不升。`)
    for (const f of added) console.error(`    ${f}`)
    console.error('  请先把这些路由的数据库访问下沉到 service/repository 层。')
    process.exit(1)
  }

  // 棘轮（处数口径）：任一存续文件的直连调用处数上涨即拒绝（旧基线无 occurrences 时不比对）。
  if (existing && existingCounts && !allowGrow) {
    const grown = current
      .filter((f) => existingCounts[f] != null && currentCounts[f] > existingCounts[f])
      .map((f) => `${f}: ${existingCounts[f]} → ${currentCounts[f]}`)
    if (grown.length) {
      console.error(`✖ 拒绝上调基线：${grown.length} 个豁免文件的数据库直连调用处数上涨（绕行下沉）：`)
      for (const g of grown) console.error(`    ${g}`)
      console.error('  新增查询请写入 service/repository 层，而不是塞进剩余豁免路由文件。')
      process.exit(1)
    }
  }

  const occurrences = {}
  for (const f of current) occurrences[f] = currentCounts[f]
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ note: NOTE, violations: current, occurrences }, null, 2) + '\n'
  )

  const eslint = readEslint()
  eslint.overrides[findExemptOverride(eslint)].files = current
  writeFileSync(ESLINT_PATH, JSON.stringify(eslint, null, 2) + '\n')

  const removed = existing ? existingSet.size - current.filter((f) => existingSet.has(f)).length : 0
  const prevTotal = existingCounts
    ? current.reduce((sum, f) => sum + (existingCounts[f] ?? 0), 0)
    : null
  console.log(
    `✓ 已更新数据库边界基线：存量豁免 ${current.length} 个文件 / ${currentTotal} 处直连调用` +
      (removed > 0 ? `（文件较上次减少 ${removed} 个）` : '') +
      (prevTotal != null && currentTotal < prevTotal ? `（调用较上次减少 ${prevTotal - currentTotal} 处）` : '') +
      '；ESLint 豁免清单已同步。'
  )
  process.exit(0)
}

/* ---------- 校验模式 ---------- */
const baseline = readBaseline()
if (!baseline) {
  console.error('✖ 找不到 eslint-boundary-baseline.json，请先运行 boundaries:update 初始化。')
  process.exit(1)
}
const baselineSet = new Set(baseline.violations || [])
const baselineCounts = baseline.occurrences || null

const eslint = readEslint()
const eslintSet = new Set(eslint.overrides[findExemptOverride(eslint)].files || [])

const newViolations = current.filter((f) => !baselineSet.has(f))
const staleViolations = [...baselineSet].filter((f) => !current.includes(f))
const eslintDrift = [
  ...current.filter((f) => !eslintSet.has(f)),
  ...[...eslintSet].filter((f) => !baselineSet.has(f)),
]

let failed = false

if (newViolations.length) {
  failed = true
  console.error(`\n✖ 新增 ${newViolations.length} 个路由数据库边界违规（基线 ${baselineSet.size} 个不计）：`)
  for (const f of newViolations) console.error(`    ${f}`)
  console.error('  routes 层禁止直接 import 数据库客户端，请下沉到 service/repository 层。')
}

if (baselineCounts) {
  const grown = current
    .filter((f) => baselineCounts[f] != null && currentCounts[f] > baselineCounts[f])
    .map((f) => `${f}: ${baselineCounts[f]} → ${currentCounts[f]}`)
  if (grown.length) {
    failed = true
    console.error(`\n✖ 豁免文件内数据库直连调用处数上涨（只降不升，禁止绕行下沉）：`)
    for (const g of grown) console.error(`    ${g}`)
    console.error('  新增查询请写入 service/repository 层，或先运行 boundaries:update 之外的下沉重构。')
  }
}

if (eslintDrift.length) {
  failed = true
  console.error('\n✖ ESLint 豁免清单与基线不一致（漂移）：')
  for (const f of eslintDrift) console.error(`    ${f}`)
  console.error('  请运行 npm --prefix backend run boundaries:update 同步。')
}

if (!failed) {
  const hints = []
  if (staleViolations.length) hints.push(`${staleViolations.length} 个基线文件已修复，可运行 boundaries:update 下调`)
  if (baselineCounts) {
    const shrunk = current
      .filter((f) => currentCounts[f] < (baselineCounts[f] ?? 0))
      .map((f) => `${f}: ${baselineCounts[f]} → ${currentCounts[f]}`)
    if (shrunk.length) {
      console.log(`  以下文件直连调用已减少，可运行 boundaries:update 下调：`)
      for (const s of shrunk) console.log(`    ${s}`)
    }
  }
  const hint = hints.length ? `；${hints.join('；')}` : ''
  console.log(
    `✓ 路由数据库边界守卫通过（存量豁免 ${baselineSet.size} 个文件 / 当前 ${currentTotal} 处直连调用，无新增）${hint}`
  )
  for (const f of staleViolations) console.log(`    （已修复待下调）${f}`)
}
process.exit(failed ? 1 : 0)
