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
 * 棘轮（只降不升）：
 *   1. ESLint 侧：`.eslintrc.json` 里的 `no-restricted-imports` override 对
 *      `src/routes/**` 生效；存量违例文件由同文件的 `"off"` override（{@link BASELINE_PATH} 镜像）豁免。
 *   2. 本脚本维护 `eslint-boundary-baseline.json`（排序后的存量清单），并保证它与 ESLint
 *      豁免清单一致。`--update` **只允许收缩**：出现基线外的新违规会直接失败，需先把代码
 *      下沉到 service 层，绝不允许把新违规记进基线。
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

/** 扫描当前所有违规文件（相对 backend 的 posix 路径，已排序去重） */
function scanViolations() {
  const violations = new Set()
  for (const abs of walk(ROUTES)) {
    const text = readFileSync(abs, 'utf8')
    IMPORT_RE.lastIndex = 0
    let m
    const specs = new Set()
    while ((m = IMPORT_RE.exec(text))) specs.add(m[1])
    if ([...specs].some((s) => isForbidden(s, abs))) violations.add(rel(abs))
  }
  return [...violations].sort()
}

const NOTE =
  'ESLint 数据库边界基线（棘轮：只降不升）。src/routes/**（不含测试）禁止直接 import ' +
  'config/database、config/system-database、generated/system-client、@prisma/client；' +
  '此清单为存量豁免，只能用 `npm --prefix backend run boundaries:update` 收缩，禁止新增。'

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

const current = scanViolations()

if (process.argv.includes('--update')) {
  const existing = readBaseline()
  const existingSet = new Set(existing?.violations || [])
  const allowGrow = process.argv.includes('--allow-grow')
  const added = current.filter((f) => !existingSet.has(f))

  // 棘轮：除首次初始化 / 显式 --allow-grow 外，禁止通过 --update 把新违规写进基线。
  if (existing && !allowGrow && added.length) {
    console.error(`✖ 拒绝上调基线：发现 ${added.length} 个基线外的新违规，棘轮只降不升。`)
    for (const f of added) console.error(`    ${f}`)
    console.error('  请先把这些路由的数据库访问下沉到 service/repository 层。')
    process.exit(1)
  }

  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ note: NOTE, violations: current }, null, 2) + '\n'
  )

  const eslint = readEslint()
  eslint.overrides[findExemptOverride(eslint)].files = current
  writeFileSync(ESLINT_PATH, JSON.stringify(eslint, null, 2) + '\n')

  const removed = existing ? existingSet.size - current.filter((f) => existingSet.has(f)).length : 0
  console.log(
    `✓ 已更新数据库边界基线：存量豁免 ${current.length} 个文件` +
      (removed > 0 ? `（较上次减少 ${removed} 个）` : '') +
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

if (eslintDrift.length) {
  failed = true
  console.error('\n✖ ESLint 豁免清单与基线不一致（漂移）：')
  for (const f of eslintDrift) console.error(`    ${f}`)
  console.error('  请运行 npm --prefix backend run boundaries:update 同步。')
}

if (!failed) {
  const hint = staleViolations.length
    ? `；${staleViolations.length} 个基线文件已修复，可运行 boundaries:update 下调`
    : ''
  console.log(
    `✓ 路由数据库边界守卫通过（存量豁免 ${baselineSet.size} 个，无新增）${hint}`
  )
  for (const f of staleViolations) console.log(`    （已修复待下调）${f}`)
}
process.exit(failed ? 1 : 0)
