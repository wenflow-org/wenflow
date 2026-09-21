#!/usr/bin/env node
/**
 * 设计系统守卫（ADMIN_PAGE_TEMPLATES.md 阶段 0 门禁）
 *
 * 八条规则：
 *  1) mk- 前缀类禁止在页面 scoped 内定义
 *     —— mk- 前缀 = 全局原语，只有 src/styles/*.css（含 mk-primitives.css）与原语组件可以定义。
 *        在页面里定义会让"全局原语"事实上分裂成每页一套（审计 §附 A #13）。
 *  2) 模板中引用的 mk-* 类必须已定义
 *     —— 防止幽灵类：mk-btn--block / mk-card__note / mk-link--active 曾零定义却被引用，
 *        渲染成无样式元素且无人发现（审计 §附 A #7 #8）。
 *  3) 硬编码 hex 色值不得超过基线（棘轮机制：只降不升）
 *     —— 治理面 = 页面 scoped 块 + **admin 原语层 CSS**（mk-primitives.css / main.css / admin-*.css）。
 *        基线存于 scripts/design-system-baseline.json。
 *  4) 页面不得手写 .mk-empty 结构（用 MkEmptyState）
 *  5) 页面不得手写加载态（用 MkLoading）
 *  6) 页面不得自搓骨架 shimmer（用 .mk-skeleton）
 *  7) 页面 scoped 里定义了、但全 src 都没用到的类（死 CSS）——棘轮：不超过基线
 *     —— 规则 1/2 只覆盖 mk- 前缀，.ud-* 这类页面前缀的死类无人管（⑮ 的 18 条死 4K
 *        规则是手工 grep 出来的）。清单在基线里，**只降不升**。
 *  8) var(--mk-*) 引用的 token 必须已定义（且 admin 侧不得引用 EP 桥变量 --el-*）
 *     —— 防「静默降级」：引用一个不存在的 token 时，浏览器会采用 var() 的兜底值
 *        （通常是没有暗色适配的硬编码色），页面照常渲染、CI 全绿，问题极难发现。
 *        本仓一度有 16 处（DayTimeline 用了 --mk-text-muted / --mk-danger / --mk-border
 *        这类不存在的名字，且整个文件没有暗色适配）。有意留白的「可覆盖钩子」
 *        （--mk-empty-min-h 等）登记在 TOKEN_HOOK_WHITELIST。
 *
 * 用法：
 *   node scripts/check-design-system.mjs            # 检查（CI / npm run design:check）
 *   node scripts/check-design-system.mjs --update   # 重写硬编码色值基线
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const BASELINE_PATH = join(ROOT, 'scripts', 'design-system-baseline.json')

const ADMIN_PREFIX = 'src/views/admin-redesign/'
const MK_PREFIX = 'src/components/mk/'
/** 中立原语层 CSS（由 admin-redesign/shared.css 迁出，仍由 admin 入口懒加载） */
const MK_PRIMITIVES_CSS = posix.join('src', 'styles', 'mk-primitives.css')

/** 允许定义 mk- 前缀类的文件（全局原语层） */
const PRIMITIVE_FILES = [
  MK_PRIMITIVES_CSS,
  ...readdirSync(join(SRC, 'styles'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => posix.join('src', 'styles', f)),
]

/**
 * 原语层组件：允许在自己的 scoped 内定义 mk- 类。
 * 判定依据——这些是"被页面复用"的构件，而非页面：
 *   - Mk*.vue（MkKpi / MkStatStrip / MkEmptyState / MkChart / MkCols / MkFilterSearch …），
 *     自 admin-redesign/ 迁至中立的 src/components/mk/
 *   - 外壳与全站通用控件（Shell / Pagination / SkeletonTable / 状态与图标徽章 / 确认层）
 * 页面（admin 各场景与详情页）不在此列 → 不允许新增 mk- 类。
 */
const PRIMITIVE_VUE = new Set([
  'Shell.vue', 'Confirm.vue', 'Pagination.vue', 'SkeletonTable.vue',
  'RunStateBadge.vue', 'RunStageBar.vue', 'AchIcon.vue', 'DataScopeToggle.vue',
])
const isPrimitiveLayer = (relPath) => {
  const base = relPath.split('/').pop()
  return PRIMITIVE_VUE.has(base) || /^Mk[A-Z]/.test(base)
}
/** 本守卫治理的目录：admin-redesign 页面 + 中立原语层组件（Mk*.vue 迁出后仍在治理面内） */
const isGoverned = (relPath) => relPath.startsWith(ADMIN_PREFIX) || relPath.startsWith(MK_PREFIX)

const rel = (p) => posix.join(...relative(ROOT, p).split(/[\\/]/))

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walk(p, out)
    } else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

function styleBlocks(text) {
  return [...text.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map((m) => ({
    scoped: /scoped/.test(m[1]),
    css: m[2],
  }))
}

function templatePart(text) {
  const end = text.search(/<script/)
  return end === -1 ? text : text.slice(0, end)
}

/* ---------- 已定义的 mk-* 原语集合 ---------- */
function collectDefinedPrimitives() {
  const defined = new Set()
  for (const relPath of PRIMITIVE_FILES) {
    const abs = join(ROOT, relPath)
    if (!existsSync(abs)) continue
    const css = readFileSync(abs, 'utf8')
    for (const m of css.matchAll(/\.(mk-[a-zA-Z0-9_-]+)/g)) defined.add(m[1])
  }
  return defined
}


const vueFiles = [...walk(join(SRC, 'views')), ...walk(join(SRC, 'components', 'mk'))]

/**
 * 规则 8 的 token 字典：全 src 里声明的 `--mk-*`（定义面取全量，引用面再收窄）。
 * 引用面收窄到 admin-redesign + 原语层 mk/ + src/styles，与规则 3 一致。
 */
const definedTokens = new Set()
// 定义面 = 原语 CSS（mk-primitives.css + src/styles/*.css）+ 全部 .vue（页面可定义局部自定义属性）
for (const p of [...PRIMITIVE_FILES.map((r) => join(ROOT, r)), ...walk(SRC)]) {
  if (!existsSync(p)) continue
  for (const m of readFileSync(p, 'utf8').matchAll(/--(mk-[a-zA-Z0-9-]+)\s*:/g)) definedTokens.add(m[1])
}

/**
 * 有意留白的「可覆盖钩子」：文档明确写了"页面可覆盖 … 调整"，未定义是设计而非 bug。
 * （若将来新增同类钩子，请在此登记，否则规则 8 会把它当 bug 报出来。）
 */
const TOKEN_HOOK_WHITELIST = new Set(['mk-empty-min-h', 'mk-skel-card-min', 'mk-skel-cols'])

/**
 * 规则 7 的"用过"语料：**整个 src** 下 .vue 的模板 + 脚本（去掉 style 块）拼接而成。
 * 刻意用全局语料而不是单文件自查：
 *   - 原语/子组件的修饰类常由**父页面**通过 class 落到子组件根元素上（如 mk-kpi--linked-on）；
 *   - 也可能由 admin 之外的界面（views/v2、共享组件）施加。
 * 只查本文件会把这类跨文件使用误判为死 CSS。代价是"同名类在别处出现"会漏报 ——
 * 对"防死 CSS"这个目标，保守优于激进。
 */
const usageCorpus = walk(SRC)
  .map((abs) => readFileSync(abs, 'utf8').replace(/<style[\s\S]*?<\/style>/g, ''))
  .join('\n')

/**
 * 动态类名前缀：`` `x--${tone}` `` / `'x--' + tone` 这类"字面量 + 插值"的写法，
 * 全站都在用（ach-icon-- / an-sev-- / mk-badge--role- …）。
 * 只取字面量前缀来做 startsWith 判定 —— 比"去掉末段再模糊匹配"精确得多：
 * 后者会把 probe-dead 这种名字误判成"用过"（因为语料里恰好存在 probe-）。
 */
const dynamicClassPrefixes = [
  ...[...usageCorpus.matchAll(/`([^`$]*)\$\{/g)].map((m) => m[1].split(/\s+/).pop()),
  ...[...usageCorpus.matchAll(/'([^']*-)'\s*\+/g)].map((m) => m[1]),
].filter((p) => /^[a-zA-Z][a-zA-Z0-9_-]*--?$/.test(p))

const defined = collectDefinedPrimitives()
// 非 scoped 的 <style> 全局生效；原语层组件的 scoped 定义也算已定义（它就是原语本身）
for (const abs of vueFiles) {
  const primitive = isPrimitiveLayer(rel(abs))
  for (const { scoped, css } of styleBlocks(readFileSync(abs, 'utf8'))) {
    if (scoped && !primitive) continue
    for (const m of css.matchAll(/\.(mk-[a-zA-Z0-9_-]+)/g)) defined.add(m[1])
  }
}
/** 动态类名前缀（mk-badge--${x}）→ 允许用前缀匹配 */
const definedPrefixes = [...defined]

const HEX = /#[0-9a-fA-F]{3,8}\b/g

/**
 * 规则 3 的治理面：页面 scoped 块 + **admin 原语层 CSS**。
 *
 * 为什么必须带上 CSS：`walk()` 只收 .vue，于是 mk-primitives.css / main.css / admin-*.css 里的
 * 硬编码色值**完全不在计数内** —— 原语层可以无声堆积颜色（#eef2fa / #eef5ff / #dbeafe
 * 以及一串暗色补丁就是这么来的）。原语层恰恰是设计系统的最后一道防线。
 *
 * 为什么不含应用级全局样式（design-system / tremor-theme / modern-enhancements /
 * learning-components）：它们服务整个应用（含用户侧 views/v2），纳入会计到用户侧改动，
 * 与本守卫"只管 admin-redesign、不与并行开发打架"的既有边界不符。
 */
const HEX_CSS_TARGETS = [
  MK_PRIMITIVES_CSS,
  posix.join('src', 'styles', 'main.css'),
  ...readdirSync(join(SRC, 'styles'))
    .filter((f) => f.startsWith('admin-') && f.endsWith('.css'))
    .map((f) => posix.join('src', 'styles', f)),
]

/**
 * 数一段 CSS 里的硬编码色值。
 *  - var(--token, #fallback) 的兜底是有意写法（全站通用），先剔除再数，否则基线虚高。
 *  - src/styles/* 是 token 的定义处（:root / html[data-theme]），定义行是合法值 → 剔除；
 *    mk-primitives.css 只放组件类（token 已上移至 main.css），其自定义属性是组件局部变量，
 *    **不算**合法定义 —— 否则任何颜色都能靠 `--x: #hex` 洗白。
 */
function countHardcodedHex(css, { tokenDefsAreLegal = false } = {}) {
  // 注释里的色值不渲染，不该计入（否则「解释为什么去掉某个颜色」的注释会反向抬高基线）
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '')
  s = s.replace(/var\(\s*--[a-zA-Z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, 'var()')
  if (tokenDefsAreLegal) s = s.replace(/^\s*--[a-zA-Z0-9-]+\s*:[^;]*;/gm, '')
  return (s.match(HEX) || []).length
}


const badDefinitions = [] // 规则 1
const overrides = [] // 信息：页面对既有原语的局部覆写
const nonScopedDefs = [] // 信息：非 scoped 块里定义的 mk- 类
const ghosts = [] // 规则 2
const handRolledEmpty = [] // 规则 4
const handRolledLoading = [] // 规则 5
const handRolledSkeleton = [] // 规则 6
const deadClasses = [] // 规则 7
const badTokens = [] // 规则 8
const hexCounts = {} // 规则 3

/* 规则 8：var(--mk-*) 引用的 token 必须已定义（引用面 = admin-redesign + 原语层 mk/ + src/styles） */
const tokenRefTargets = walk(SRC).filter((abs) => {
  const r = rel(abs)
  return isGoverned(r) || r.startsWith(posix.join('src', 'styles') + '/')
})
for (const abs of tokenRefTargets) {
  const relPath = rel(abs)
  const text = readFileSync(abs, 'utf8')
  const seen = new Set()
  for (const m of text.matchAll(/var\(\s*--(mk-[a-zA-Z0-9-]+)/g)) {
    const tk = m[1]
    if (definedTokens.has(tk) || TOKEN_HOOK_WHITELIST.has(tk) || seen.has(tk)) continue
    seen.add(tk)
    badTokens.push({ file: relPath, token: tk })
  }
  // admin 侧不得引用 EP 桥变量（--el-*）：那套变量随 EP 桥一起删除，引用会静默降级到兜底值
  const seenEl = new Set()
  for (const m of text.matchAll(/var\(\s*--(el-[a-zA-Z0-9-]+)/g)) {
    if (seenEl.has(m[1])) continue
    seenEl.add(m[1])
    badTokens.push({ file: relPath, token: m[1] + '（EP 桥变量）' })
  }
}

for (const abs of vueFiles) {
  const relPath = rel(abs)
  const text = readFileSync(abs, 'utf8')
  const primitiveLayer = isPrimitiveLayer(relPath)

  // 规则 1：scoped 内**新增** mk- 前缀类（覆写既有原语不算违规，另计为 override）
  for (const { scoped, css } of styleBlocks(text)) {
    const lines = css.split('\n')
    lines.forEach((line, i) => {
      const m = line.match(/^\s*\.(mk-[a-zA-Z0-9_-]+)/)
      if (!m) return
      if (defined.has(m[1])) { scoped && overrides.push({ file: relPath, line: i + 1, cls: m[1] }); return }
      if (!scoped) { nonScopedDefs.push({ file: relPath, line: i + 1, cls: m[1] }); return }
      if (primitiveLayer) return
      badDefinitions.push({ file: relPath, line: i + 1, cls: m[1] })
    })
    // 规则 3：硬编码 hex（仅统计 scoped，非 scoped 块多为自包含原语副本，另行处理）
    //   仅统计 admin-redesign 与原语层 mk/：那才是本守卫治理的面；views/v2 等用户侧界面不受此门禁约束，
    //   否则会与并行开发互相打架。
    if (scoped && isGoverned(relPath)) {
      // var(--token, #fallback) 里的 fallback 是有意兜底（全站通用写法），不是硬编码违规：
      // 先剔除再计数，否则基线被 fallback 虚高、并产生假回退。
      const hits = countHardcodedHex(css)
      if (hits) hexCounts[relPath] = (hexCounts[relPath] || 0) + hits
      // 规则 6：页面不得自搓骨架 shimmer（统一走 .mk-skeleton）
      //   特征：background-size 200%/220%（shimmer 位移）或 自定义 shimmer/skel keyframes
      if (!primitiveLayer && (/background-size:\s*2[02]0%/.test(css) || /@keyframes\s+[a-zA-Z-]*(shimmer|skel)/i.test(css))) {
        handRolledSkeleton.push({ file: relPath })
      }
    }
  }

  // 规则 2：模板引用的 mk-* 是否已定义
  const tpl = templatePart(text)
  const used = new Set()
  // (?<!--) 排除 CSS 变量引用 var(--mk-col-text)：那是自定义属性，不是类名
  for (const m of tpl.matchAll(/(?<!--)(mk-[a-zA-Z0-9_-]+)/g)) used.add(m[1])
  for (const raw of used) {
    // 模板字面量拼接（`mk-stat--${tone}`）会截出尾随 '-'，去掉再比对
    const cls = raw.replace(/-+$/, '')
    if (defined.has(cls)) continue
    if (definedPrefixes.some((d) => d.startsWith(cls + '-') || cls.startsWith(d + '-'))) continue
    ghosts.push({ file: relPath, cls: raw })
  }

  // 规则 4：页面模板不得手写 .mk-empty 结构（应使用 MkEmptyState 共用组件）
  //   \bmk-empty\b 只命中独立的 mk-empty 类 token，不会误伤 mk-empty__icon / --min
  if (!primitiveLayer && isGoverned(relPath)) {
    for (const m of tpl.matchAll(/class="([^"]*\bmk-empty\b[^"]*)"/g)) {
      handRolledEmpty.push({ file: relPath, cls: m[1] })
    }
    // 规则 5：页面模板不得手写加载态（自建 spinner 容器，或元素内的「加载中…」文案）
    //   文案检测要求前面出现过 '>' 且中间无 '<' → 只认元素文本，不会误伤
    //   :title="loading ? '加载中…' : …" 这类属性值（转换后 text="加载中…" 也不该被误判）。
    const hasSpinner = /class="[^"]*\bmk-spinner\b/.test(tpl)
    const hasText = />[^<>]*加载中…|>[^<>]*正在加载/.test(tpl)
    if (hasSpinner || hasText) {
      handRolledLoading.push({ file: relPath, spinner: hasSpinner, text: hasText })
    }
  }

  // 规则 7：页面 scoped 里定义的类，模板/脚本里从未出现 → 死 CSS
  //   规则 1/2 只覆盖 mk- 前缀；.ud-* / .ld-* 这类页面前缀的死类无人管（⑮ 那 18 条死 4K 规则
  //   就是手工 grep 出来的）。判定刻意保守：名字只要在「模板 + 脚本」文本里出现过就算用过；
  //   模板字面量拼类名（`x--${tone}`）退一步用「去掉末段的类名前缀」再匹配；跳过 :deep()。
  const seenDead = new Set()
  if (isGoverned(relPath)) for (const { scoped, css } of styleBlocks(text)) {
    if (!scoped) continue
    // 先剥注释：注释里出现的 ".css" 之类会被选择器抽取误当成类名
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of body.matchAll(/([^{}]+)\{/g)) {
      const sel = m[1]
      if (/:deep\(|::v-deep|\/deep\//.test(sel)) continue
      // 剥掉伪类/伪元素（含 :not(.x) 这类带参形式），避免把参数里的类当成"被定义"
      const cleaned = sel.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
      for (const c of cleaned.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
        const cls = c[1]
        if (usageCorpus.includes(cls)) continue
        // 动态拼出来的类（`x--${v}`）：按字面量前缀判定
        if (dynamicClassPrefixes.some((p) => cls.startsWith(p))) continue
        if (seenDead.has(cls)) continue
        seenDead.add(cls)
        deadClasses.push({ file: relPath, cls })
      }
    }
  }
}

/* ---------- 规则 9：媒体查询档位内的硬编码间距（棘轮，只降不升） ----------
   五档(1440/1920/2000/2800/3600)曾以硬编码 px 覆盖 .mk-page/.mk-status 等的
   gap/padding/min-height/radius，各档互不单调且覆盖基线 token——"布局乱糟糟"
   的系统性根源（验收 F1）。档内这类声明现在只降不升；字号放大不在本规则内。 */
const MEDIA_SPACING_RE = /(^|[;{]\s*)(gap|padding|margin)(-(top|right|bottom|left|inline|block))?\s*:\s*[^;]*\dpx/
function countMediaSpacing(css) {
  let n = 0
  const re = /@media[^{]*\{/g
  let m
  while ((m = re.exec(css)) !== null) {
    let depth = 1
    let k = re.lastIndex
    while (k < css.length && depth > 0) {
      if (css[k] === '{') depth += 1
      else if (css[k] === '}') depth -= 1
      k += 1
    }
    const block = css.slice(re.lastIndex, k - 1)
    for (const line of block.split('\n')) {
      const t = line.trim()
      if (MEDIA_SPACING_RE.test(t)) n += 1
    }
  }
  return n
}

const mediaSpacingCounts = {}
for (const relPath of HEX_CSS_TARGETS) {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) continue
  const n = countMediaSpacing(readFileSync(abs, 'utf8'))
  if (n) mediaSpacingCounts[relPath] = n
}

/* ---------- 规则 3（续）：admin 原语层 CSS 的硬编码色值 ---------- */
for (const relPath of HEX_CSS_TARGETS) {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) continue
  const n = countHardcodedHex(readFileSync(abs, 'utf8'), {
    tokenDefsAreLegal: relPath.startsWith('src/styles/') && relPath !== MK_PRIMITIVES_CSS,
  })
  if (n) hexCounts[relPath] = (hexCounts[relPath] || 0) + n
}

/* ---------- 规则 3：基线棘轮 ---------- */
const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : { hex: {}, mediaSpacing: {} }

if (process.argv.includes('--update')) {
  const deadByFile = {}
  for (const v of deadClasses) (deadByFile[v.file] ||= []).push(v.cls)
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        hex: hexCounts,
        mediaSpacing: mediaSpacingCounts,
        deadClasses: deadByFile,
        note: '硬编码 hex 色值 + 死 CSS 类基线（棘轮：只降不升）。收敛后请用 --update 下调。',
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `已更新基线：${Object.keys(hexCounts).length} 个文件、硬编码色值 ${Object.values(hexCounts).reduce((a, b) => a + b, 0)} 处；` +
      `死 CSS ${deadClasses.length} 处（${Object.keys(deadByFile).length} 个文件）`
  )
  process.exit(0)
}

const hexRegressions = []
for (const [file, n] of Object.entries(hexCounts)) {
  const base = baseline.hex?.[file] ?? 0
  if (n > base) hexRegressions.push({ file, now: n, base })
}

/* ---------- 输出 ---------- */
let failed = false

const mediaSpacingRegressions = []
for (const [file, n] of Object.entries(mediaSpacingCounts)) {
  const base = baseline.mediaSpacing?.[file] ?? 0
  if (n > base) mediaSpacingRegressions.push({ file, now: n, base })
}
if (mediaSpacingRegressions.length) {
  failed = true
  console.log(`
✖ 规则 9：媒体查询档位内的硬编码间距不得超过基线（只降不升）`)
  for (const v of mediaSpacingRegressions) console.log(`    ${v.file}: ${v.base} → ${v.now}`)
}

if (badDefinitions.length) {
  failed = true
  console.log(`\n✖ 规则 1：mk- 前缀类禁止在页面 scoped 内定义（${badDefinitions.length} 处）`)
  console.log('  mk- 前缀 = 全局原语。通用则提升到 src/styles/mk-primitives.css；页面专用请改用页面前缀。')
  for (const v of badDefinitions) console.log(`    ${v.file}:${v.line}  .${v.cls}`)
}

if (ghosts.length) {
  failed = true
  console.log(`\n✖ 规则 2：模板引用了零定义的 mk-* 类（${ghosts.length} 处）`)
  console.log('  这些类看起来像设计系统原语，实际渲染成无样式元素。')
  for (const g of ghosts) console.log(`    ${g.file}  .${g.cls}`)
}

if (handRolledEmpty.length) {
  failed = true
  console.log(`\n✖ 规则 4：页面手写了 .mk-empty 结构（${handRolledEmpty.length} 处）`)
  console.log('  空态请用共用组件 <MkEmptyState icon title description action-text min compact @action>。')
  const byFile = {}
  for (const v of handRolledEmpty) byFile[v.file] = (byFile[v.file] || 0) + 1
  for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${f}  ×${n}`)
  }
}

if (handRolledLoading.length) {
  failed = true
  console.log(`\n✖ 规则 5：页面手写了加载态（${handRolledLoading.length} 处）`)
  console.log('  加载态请用共用组件 <MkLoading text inline min>；表格骨架用 <SkeletonTable>。')
  for (const v of handRolledLoading) {
    const how = [v.spinner ? 'spinner 容器' : '', v.text ? '内联「加载中…」' : ''].filter(Boolean).join(' + ')
    console.log(`    ${v.file}  （${how}）`)
  }
}

if (handRolledSkeleton.length) {
  failed = true
  console.log(`\n✖ 规则 6：页面自搓了骨架 shimmer（${handRolledSkeleton.length} 处）`)
  console.log('  shimmer 视觉统一走 mk-primitives.css 的 .mk-skeleton（暗色与 prefers-reduced-motion 已处理）；')
  console.log('  页面只负责形状：给占位元素加 class="mk-skeleton"，保留各页的尺寸/圆角类。')
  for (const v of handRolledSkeleton) console.log(`    ${v.file}`)
}

/* ---------- 规则 7：死 CSS 棘轮 ---------- */
const deadBaseline = new Set(
  Object.entries(baseline.deadClasses || {}).flatMap(([f, cs]) => (cs || []).map((c) => `${f}|${c}`))
)
const deadRegressions = deadClasses.filter((v) => !deadBaseline.has(`${v.file}|${v.cls}`))

if (badTokens.length) {
  failed = true
  console.log(`\n✖ 规则 8：var(--mk-*) 引用了未定义的 token（${badTokens.length} 处）`)
  console.log('  这类引用会**静默降级**到 var() 的兜底值（通常是没有暗色适配的硬编码色），而 CI 全绿。')
  console.log('  确属"可覆盖钩子"的请登记进 TOKEN_HOOK_WHITELIST。')
  const byFile = {}
  for (const v of badTokens) (byFile[v.file] ||= []).push(v.token)
  for (const [f, ts] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${f}  ×${ts.length}  ${ts.join(' ')}`)
  }
}

if (deadRegressions.length) {
  failed = true
  console.log(
    `\n✖ 规则 7：新增的死 CSS 类（${deadRegressions.length} 处；基线内 ${deadClasses.length - deadRegressions.length} 处不计）`
  )
  console.log('  页面 scoped 里定义了、但全 src 的模板/脚本都没用到 → 删掉定义即可；确要保留请 --update 记账。')
  const byFile = {}
  for (const v of deadRegressions) (byFile[v.file] ||= []).push(v.cls)
  for (const [f, cs] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${f}  ×${cs.length}  ${cs.slice(0, 8).join(' ')}${cs.length > 8 ? ' …' : ''}`)
  }
}

if (hexRegressions.length) {  failed = true
  console.log(`\n✖ 规则 3：硬编码 hex 色值相对基线增加（${hexRegressions.length} 个文件）`)
  console.log('  新增配色请使用 --mk-* token；确需新增请同步下调基线（node scripts/check-design-system.mjs --update）。')
  for (const r of hexRegressions) console.log(`    ${r.file}  ${r.base} → ${r.now}`)
}

if (!failed) {
  const total = Object.values(hexCounts).reduce((a, b) => a + b, 0)
  console.log(`✓ 设计系统守卫通过（已定义原语 ${defined.size} 个；硬编码色值存量 ${total} 处于基线内）`)
}
process.exit(failed ? 1 : 0)
