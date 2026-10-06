#!/usr/bin/env node
/**
 * 设计系统守卫（ADMIN_PAGE_TEMPLATES.md 阶段 0 门禁）
 *
 * 十九条规则（下列 1–8 逐条展开；9 起为后续增补，其约定集中记在文末段落里）：
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
 *  8) var(--*) 引用的自定义属性必须已定义（且 admin 侧不得引用 EP 桥变量 --el-*）
 *     —— 防「静默降级」：引用一个不存在的 token 时，浏览器会采用 var() 的兜底值
 *        （通常是没有暗色适配的硬编码色），页面照常渲染、CI 全绿，问题极难发现。
 *        本仓一度有 16 处（DayTimeline 用了 --mk-text-muted / --mk-danger / --mk-border
 *        这类不存在的名字，且整个文件没有暗色适配）。有意留白的「可覆盖钩子」
 *        （--mk-empty-min-h 等）登记在 TOKEN_HOOK_WHITELIST。
 *     2026-10-02 补两处漏网（规则本身的漏洞，不是页面问题）：
 *       ① 引用正则只看 `--mk-*`。前缀只是命名约定，不是"已定义"的证明 —— 于是
 *          --mk-ep-primary-bg 这种前缀完全正确的坏 token 反而躲过了检查。
 *       ② 引用面用 walk()，而 walk() 只收 .vue，src/styles/*.css 从来没进过引用面；
 *          两处真实 bug（--mk-ep-primary-bg / --transition-base）恰好都在 CSS 里。
 *       放宽后已定位、已排期的欠账登记在 KNOWN_UNDEFINED（照常报告、不阻断 CI），
 *       没登记过的一律「✖ 阻断」。欠账要逐条可核销，不许静默 baseline、也不许增长。
 *
 * 用法：
 *   node scripts/check-design-system.mjs            # 检查（CI / npm run design:check）
 *   node scripts/check-design-system.mjs --update   # 重写基线（hex/死CSS/圆角/阴影，棘轮只降不升）
 *
 * 规则 14/15（2026-09-25 增，棘轮）：页面 scoped 的 border-radius 只允许语言六档
 * （xs4 / sm6 / md8 / lg12 / xl16 / 胶囊999，加圆形 50% + 0，或 var(--mk-radius-*)），
 * box-shadow 只允许 none / var(--mk-shadow-*) / inset 描边 / 0 0 0 Npx 环
 * （ADMIN_VISUAL_LAYER_SPEC v4 §0.5）。2026-10-02 补 8px（= --mk-radius-md）：
 * 它是控件 / 按钮 / 输入框的标准档，此前白名单漏了它，写规范内最常见的字面量反被判违规。
 *
 * 规则 14/15 的扫描面（2026-10-02 扩，批次 E）：此前只跑在「.vue 的 scoped <style> 块」
 * 上，而 src/styles/*.css 根本不是 .vue —— 于是整片原语层从没进过圆角/阴影检查，
 * 「admin 圆角基线 0」其实是**没扫**而不是**合规**。渲染层复核在 /admin/health-center
 * 实测出 .mk-minibar 是 99px 而守卫报 0，据此把 src/styles/*.css 全量纳入。
 *
 * 规则 19（2026-10-02 增，硬失败、无基线）：档位令牌的**定义值**必须落在阶梯上。
 *  与 14/15 分工 —— 14/15 拦引用处、19 拦定义处。14/15 现在放行 var(--radius-*) 这类
 *  转发（三支别名是同一条阶梯的转发，见 isRadiusOk 注释），于是「往别名链里塞 13px」
 *  会在每一处引用上都合法通过；只有钉死链的起点才堵得住。圆角按字面比对阶梯，
 *  阴影按「全中性」判（把 rgba 通道乘 alpha 看推偏量，规范自己的 slate 阴影推偏 ≤2，
 *  彩色光晕上百）。
 *
 * 规则 17/18（2026-10-02 增，硬失败、无基线）：退役材质不得复辟。
 *  17) 主按钮底不得用「交互蓝 → 深蓝」的 135° 渐变
 *      —— 被清掉的原形是 background: linear-gradient(135deg, var(--blue), var(--blue-deep))。
 *         本设计系统的按钮材质是**平面实心**（background: var(--blue) + 白字）：渐变那 1px 深浅差
 *         在同屏同角色的按钮之间制造了两档"品牌蓝"，而"这是一枚可点的东西"本该由
 *         颜色 + 字重 + 圆角三件事说清，不需要第四种材质来加强。
 *      角度只认 125/135deg 这一族：90deg 编码的是"完成度"（进度条 / 仪表，属有意保留），
 *      100deg 是骨架 shimmer 的位移方向；两者都不是按钮材质。停用色标不是蓝的渐变（装饰洗色、
 *      柱状图填充）本规则不碰 —— 那是一条单独的、尚未定论的问题。
 *  18) 任何 backdrop-filter / -webkit-backdrop-filter 声明一律禁止（唯一豁免是字面量 none）
 *      —— tokens.css 三节「材质：平面」已写明"亚克力 / 毛玻璃整体退役，1px 发丝线就是全部质感"。
 *         毛玻璃的代价是可度量的：backdrop-filter 让元素变成一个独立的合成层，滚动时每帧都要
 *         重采样它背后的内容；长列表 / 数据表 / 聊天流（views/v2 那一侧）因此直接掉帧。
 *         而它换来的"层次"，平面语言里 1px 发丝线 + --wf-shadow-raised 已经说完了。
 *      这两条之所以是硬失败而不是棘轮：规则 3/7/14/15/16 的基线是**还款计划表**（存量太大，
 *      要跨批次逐条退场，记着"还剩多少"有意义）；而 17/18 的存量已经是 0，一份空基线不设防，
 *      反而会在 --update 时给后来人留一个"往里写点东西"的错觉。新写一处即断，不给"下批再还"的余地。
 *      扫描面刻意**不挂 isGoverned**：材质是全产品级决策，用户侧（views/v2、components、
 *      v2.css / uc.css）同样会写渐变与毛玻璃；只看治理面的话，材质能从用户侧长回来而门禁全绿。
 *      规则 18 只豁免字面量 `none`：那是"这里不挂材质"的显式声明（与干脆不写等价，
 *      tokens.css 三节注释就是这么要求的），不是一种材质；blur()/saturate()/opacity() 乃至
 *      var(--x) 都是把退役材质改个名字请回来，按名字放行等于给复辟留后门。
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const BASELINE_PATH = join(ROOT, 'scripts', 'design-system-baseline.json')

const ADMIN_PREFIX = 'src/views/admin-redesign/'
const MK_PREFIX = 'src/components/mk/'
/**
 * 用户侧治理面（2026-10-02 纳入棘轮；2026-10-03 补 `src/views/user/`）。
 * 为什么要补：批次 C/D 把 admin 收敛到 0 之后，**全部剩余漂移**都在这些从未被扫过的目录里
 * —— 治理面只覆盖 admin 时，"棘轮只降不升"对用户侧完全失效，欠账永远不会被记进基线，
 * 也就永远不会被提醒。现在它们与 admin 同等纳入棘轮（存量一次 --update 记账，之后只降不升）。
 *
 * 2026-10-03 补 `src/views/user/`：与 §7.5.6 同型的缺口 —— 渲染层审计在 AgentLogs / Settings
 * 两页实测出 `border-radius: 14px / 10px` 与手写 `0 1px 2px rgba(23,32,51,.04)`，而这两枚
 * `.vue` 因为不在本清单里，从未进过圆角/阴影/hex 检查。补入时两文件已修到 0（hex/圆角/阴影/
 * 小字号皆 0），故与 admin 一样按"存量 0 起算"，不写进基线。
 */
const USER_PREFIXES = [
  'src/views/v2/',
  'src/views/user/',
  'src/components/user/',
  'src/components/chat/',
  'src/components/learning/',
  'src/components/ui/',
]
/** 用户侧根级页面（v2 体系之外的两枚壳页）—— 单文件，按路径精确匹配 */
const USER_ROOT_VIEWS = ['src/views/HomeNext.vue', 'src/views/VisionNext.vue']
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
/**
 * 本守卫治理的目录：admin-redesign 页面 + 中立原语层组件（Mk*.vue 迁出后仍在治理面内）
 * + 用户侧界面（views/v2 + components/{user,chat,learning,ui} + HomeNext / VisionNext）。
 *
 * 边界不变式（放宽后仍然成立）：isGoverned 只放行**棘轮**类计数（3/6/7/9/10/11/13/14/15/16）
 * 与规则 8 的引用面，**不放宽**原语边界 —— 用户侧组件定义自己的页面前缀类（.uc-* / .ms-* 等）
 * 与 .mk-* 无关，PRIMITIVE_FILES 与 isPrimitiveLayer 一律不动；仓库里没有改名就能冒充
 * Mk* 原语的路径（用户侧无 Shell.vue / Pagination.vue 等同名文件）。
 */
const isGoverned = (relPath) =>
  relPath.startsWith(ADMIN_PREFIX) ||
  relPath.startsWith(MK_PREFIX) ||
  USER_PREFIXES.some((p) => relPath.startsWith(p)) ||
  USER_ROOT_VIEWS.includes(relPath)

/**
 * 「指令在目标面上可执行」的治理面 —— 棘轮规则的**子集**，不是全部。
 *
 * 为什么需要第二个谓词：规则 5 / 6 的整改建议是「改用 <MkLoading> / .mk-skeleton」，
 * 而这些原语定义在 `mk-primitives.css`，该文件只被 AdminConsole.vue 与
 * SkillDesignPage.vue **懒加载**。用户侧路由（`/v2/*` 等）从不加载它，于是
 * 用户侧页面照着报错改，会得到一段同样没有定义、同样不渲染的类名。
 *
 * 已实证的坏指令：V2LearningPage.vue:123 已经在用 `<MkLoading>`，但在 `/v2/*`
 * 下 `.mk-spinner` 与 `.mk-loading` 零命中 —— 转圈根本不显示。这是**既有缺陷**，
 * 不是守卫报出来的假问题；但它说明「用户侧也该用 MkLoading」这个建议当前是错的。
 *
 * 待产品决策（不在守卫职责内，故只登记）：
 *   (a) 把 mk-primitives.css 提为全局加载（原语层本就不专属 admin，
 *       且 ADMIN_VISUAL_LAYER_SPEC v4 §7.5 要求用户侧复用同一套原语）；
 *   (b) 用户侧自建 loading/skeleton 原语，规则 5/6 对用户侧永久关闭。
 * 决策落定前，规则 5/6 的闸门收窄到 admin，避免把坏指令扩散到 30+ 个文件。
 */
const isAdminGoverned = (relPath) =>
  relPath.startsWith(ADMIN_PREFIX) || relPath.startsWith(MK_PREFIX)

const rel = (p) => posix.join(...relative(ROOT, p).split(/[\\/]/))

/**
 * 递归收集指定后缀的文件（默认 .vue，即"页面 / 组件"这一层）。
 * node_modules 与 dist 跳过 —— 第三方 CSS（KaTeX / highlight.js 等）随之落在扫描面之外。
 * 规则 8 的**定义面**还要收 .css：自研样式表同样是 token 的定义处（tokens.css 的 --wf-*、
 * main.css 的 --mk-*、v2.css 的别名），只看 .vue 会把一整层令牌判成"未定义"。
 */
function walk(dir, out = [], ext = '.vue') {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walk(p, out, ext)
    } else if (name.endsWith(ext)) out.push(p)
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


/**
 * 扫描面（规则 1/2/3/4/5/6/7/14/15 的文件来源）：全部视图 + **受治理的组件目录**。
 * components/ 此前只收 mk/，于是 user/chat/learning/ui 下的组件**从来没进过**本守卫 ——
 * 治理面再宽，文件不进扫描面等于没纳入。这行跟着 USER_PREFIXES 走，新增目录请只改常量。
 */
const vueFiles = [
  ...new Set([
    ...walk(join(SRC, 'views')),
    ...[MK_PREFIX, ...USER_PREFIXES]
      .map((p) => join(ROOT, p))
      .filter((dir) => existsSync(dir))
      .flatMap((dir) => walk(dir)),
  ]),
]

/**
 * 规则 8 的 token 字典：**任意前缀**的自定义属性（定义面取全量，引用面再收窄）。
 * 引用面收窄到 admin-redesign + 原语层 mk/ + src/styles，与规则 3 一致。
 *
 * 定义面必须与引用面同步放宽（2026-10-02）：此前字典只收 `--mk-*`，于是 tokens.css 的
 * `--wf-*`、design-system.css 的 `--color-*`、learning-components.css 的 `--transition-*`
 * 这些同样是 token 的变量在字典里**根本不存在**。只放宽引用面会把每一个 --wf-* 引用
 * 都报成未定义 —— 误报几百条的门禁没人会看，它的输出也就失去意义了。
 */
const definedTokens = new Set()
// 定义面 = src 下自研的全部 .css + 全部 .vue。
//   .vue 之所以必须扫：页面用 :style="{ '--skl-cols': cols }" 定义局部钩子，这是本仓主流写法。
//   .css 之所以必须扫：v2.css 定义了 --bubble-ai-bg / --v2nav-bg，而 Login.vue 直接消费它们
//   （main.ts 全局 import 了 v2.css，运行时确有定义）—— 只扫 src/styles 会把这两处误报成
//   "未定义"，把真 bug 淹在假 bug 里。
//   .ts 不扫：JS/TS 里只经 setProperty 写自定义属性，不会声明 token 主体；若将来真有
//   token 定义搬进 .ts，这里要同步放行，否则会误报。
for (const p of [...walk(SRC, [], '.css'), ...walk(SRC)]) {
  if (!existsSync(p)) continue
  // 先剥注释：注释里的 `--wf-*:` 只是说明文字，不构成定义
  const text = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // 引号必须可选：局部钩子的定义落在带引号的 JS 对象键上（':style="{ '--skl-cols': cols }"'），
  //   漏掉引号会把这些**定义**当成引用，规则 8 立刻误报。
  // 捕获组不含 '--'（正则里 `--` 在括号外），所以入库时补回来：引用侧的捕获组是带 `--` 的，
  //   两边不归一化就永远对不上，会把全仓 token 一次性判成未定义。
  for (const m of text.matchAll(/['"`]?--([a-zA-Z0-9-]+)['"`]?\s*:/g)) definedTokens.add('--' + m[1])
}

/**
 * 有意留白的「可覆盖钩子」：文档明确写了"页面可覆盖 … 调整"，未定义是设计而非 bug。
 * （若将来新增同类钩子，请在此登记，否则规则 8 会把它当 bug 报出来。）
 * 键统一带 `--`：与 definedTokens / 引用侧同一形式，查表才成立（2026-10-02）。
 */
const TOKEN_HOOK_WHITELIST = new Set(['--mk-empty-min-h', '--mk-skel-card-min', '--mk-skel-cols'])

/**
 * 【已定位、已排期】的未定义 token —— 报告但不阻断（token → 一句话原因）。
 *
 * 为什么不直接消音：规则 8 的全部价值就是"未定义必须挡住 CI"，把它们悄悄写进基线，
 * 门禁就退化成永远绿的摆设，新洞也就一起放过去了。
 * 为什么还要单列一集：登记在册的几处此刻**确实是坏的**，但属独立的 CSS 修复
 * 工作流，不应让 CI 因存量长期红，真新增的问题反而被淹没。
 *
 * 所以输出分两桶：在册的「🔧 待修复」照常列出、醒目但不设 failed；不在册的「✖ 阻断」。
 * 两桶的差别就是"已登记的欠账" vs "刚冒出来的洞"——欠账逐条可核销（修掉一个少一个，
 * 修完请从本集合摘除，否则它会一直挂在报告里），新洞立刻挡住 CI。数量不许增长。
 *
 * 2026-10-02：本集合**已清空**。两笔欠账都在批次 A/B/C 期间用
 * scripts/fix-bad-tokens.mjs 修掉了（--mk-ep-primary-bg → --mk-blue、
 * --transition-base → --transition-fast）。集合保留为空而非删掉整个机制：
 * 下次出现同类问题时，登记位和「不许增长」的约束要立刻可用。
 */
const KNOWN_UNDEFINED = new Map([
  // 留空。修完的欠账请从本集合摘除——把已修好的条目留着会让报告长期挂着一盏
  // 「待修复」的灯，久而久之没人再看它。下方 stale 检查也会主动提示摘除。
])

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

/**
 * Vue <Transition> 的 name 集合（全语料扫描，含 `<Transition name="x">`、
 * `<transition name="x">`、以及 `:name="expr"` 里无法静态求值的动态写法）。
 *
 * Vue 3 的过渡钩子类由框架在过渡期间**动态挂到元素上**：写
 * `<Transition name="fade"><div/></Transition>` 时，`.fade-enter-active`、
 * `.fade-leave-from`、`.fade-move` 这些类在模板源码里一个都不会出现。
 * 规则 7「模板/脚本语料里没出现即死 CSS」对它们是结构性误报。
 */
const transitionNames = new Set(
  [...usageCorpus.matchAll(/<[Tt]ransition\b[^>]*?\bname\s*=\s*"([^"$]+)"/g)].map((m) => m[1])
)
/** Vue 约定的过渡钩子后缀段 */
const TRANSITION_HOOK_SUFFIXES =
  /-(enter|leave|appear)-(from|to|active|cancel)|-(enter|leave|appear)$|-(move|start|end)$/
const isTransitionHook = (cls) => {
  for (const n of transitionNames) {
    if (cls.startsWith(n + '-') && TRANSITION_HOOK_SUFFIXES.test(cls.slice(n.length))) return true
  }
  return false
}

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
 * 规则 3 的治理面：页面 scoped 块 + **应用级全局样式表**。
 *
 * 为什么必须带上 CSS：`walk()` 只收 .vue，于是任何 .css 里的硬编码色值**完全不在计数内** ——
 * 原语层可以无声堆积颜色（#eef2fa / #eef5ff / #dbeafe 以及一串暗色补丁就是这么来的）。
 * 原语层恰恰是设计系统的最后一道防线。
 *
 * 2026-10-02 纳入 design-system.css / learning-components.css：这两张表服务整个应用
 * （含用户侧 views/v2），此前被排除在治理面之外 —— **排除正是硬编码色在它们身上堆积的原因**。
 * 未纳入的还有 tremor-theme / modern-enhancements（同为应用级全局样式）。若将来某张表只服务
 * admin，加进来前请先确认它不会被用户侧改动波及，否则棘轮会与并行开发互相打架。
 */
const HEX_CSS_TARGETS = [
  MK_PRIMITIVES_CSS,
  posix.join('src', 'styles', 'main.css'),
  posix.join('src', 'styles', 'design-system.css'),
  posix.join('src', 'styles', 'learning-components.css'),
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
const radiusCounts = {} // 规则 14：页面 scoped 圆角档外值（棘轮）
const shadowCounts = {} // 规则 15：页面 scoped 非法 box-shadow（棘轮）

/* 规则 14/15 的白名单（ADMIN_VISUAL_LAYER_SPEC v4 §0.5）：
   圆角六档 xs4/sm6/md8/lg12/xl16 + 胶囊 999 + 圆形 50% + 0（或 var(--mk-radius-*)）。
   2026-10-02 补 8px：它就是 --mk-radius-md，控件/按钮/输入框的标准档。此前白名单漏了它，
   页面写 `border-radius: 8px`（完全合规的写法）反被记成档外值。棘轮只降不升，补档只会让
   存量计数下降，不会造出新的失败 —— 补档只有单向好处，所以该补就补。
   阴影三档：面=none、悬浮/弹层=var(--mk-shadow-*)、描边=inset 或 0 0 0 Npx 环
   （含焦点环与脉冲初始态；@keyframes 里的脉冲帧在扫描前剥离）。 */
const RADIUS_OK = new Set(['0', '4px', '6px', '8px', '12px', '16px', '999px', '50%'])
/* 2026-10-02（批次 E 尾）：把 var() 的可接受前缀从 `--mk-radius-` 放宽到三支别名。
   三支全部是**同一条阶梯的转发**（main.css 的 --radius-* → --mk-radius-* → --wf-radius-*），
   放宽不等于放水；若某天有人往这条链里插一个档外值，失败会出现在定义处而不是引用处，
   靠下面新加的「令牌取值自检」兜住，而不是靠在引用处逐个 var() 拦。 */
const isRadiusOk = (v) =>
  v.split(/\s+/).every(
    (t) => RADIUS_OK.has(t) || /^var\(--(mk|wf)-radius-/.test(t) || /^var\(--radius-/.test(t)
  )
const isShadowOk = (v) =>
  v === 'none' ||
  /^var\(--(?:mk-|wf-)?shadow-/.test(v) ||   // 注意连字符在组内：`--mk-` + `shadow-`，写成 `(mk|wf-)?shadow-` 会匹配不上 `var(--mk-shadow-*)`
  /^var\(--[\w-]*ring\b/.test(v) ||          // 焦点环 token（值就是 0 0 0 Npx 环）。规则 15 的白名单本就写明「含焦点环」，
                                              // 只是 token 名不含 shadow，前缀检查漏了它；环形取值由规则 19 的中性检查管不到
                                              // （焦点环按设计是交互蓝，不算彩色光晕），故在此显式放行。
  /^(inset\s+)?0\s+0\s+0(\s|$|,)/.test(v) ||
  /\binset\b/.test(v)
const stripKeyframes = (css) => css.replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

/* ---------- 规则 14/15（续）：src/styles/*.css 的圆角 / 阴影 ----------
   为什么现在才扫：规则 14/15 原本长在「遍历 .vue 的 scoped <style> 块」那个循环里，
   而 src/styles/*.css 根本不是 .vue，从未进过那个循环。后果不是漏了几个数——
   是**整个结论错了**：admin 的圆角基线一直是 0，被读成「admin 100% 合规」，
   可 admin 的圆角几乎全写在 mk-primitives.css 里。2026-10-02 的渲染层复核
   在 /admin/health-center 上实测出 .mk-minibar 是 99px，而守卫当时报 0。
   扩面后首次扫描即查出 4 处字面量档外（mk-primitives 99px×2、14px×1、
   admin-theme 14px×1），已当场修掉，故基线从 0 起算而不是把违规写进基线。 */
const CSS_RADIUS_TARGETS = readdirSync(join(SRC, 'styles'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => posix.join('src', 'styles', f))
for (const relPath of CSS_RADIUS_TARGETS) {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) continue
  const body = stripKeyframes(readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
  for (const m of body.matchAll(/border-radius\s*:\s*([^;}]*)/g)) {
    if (!isRadiusOk(m[1].trim())) radiusCounts[relPath] = (radiusCounts[relPath] || 0) + 1
  }
  for (const m of body.matchAll(/box-shadow\s*:\s*([^;}]*)/g)) {
    if (!isShadowOk(m[1].trim())) shadowCounts[relPath] = (shadowCounts[relPath] || 0) + 1
  }
}

/* ---------- 令牌取值自检：档位令牌的**定义**必须落在阶梯上 ----------
   上面接受 `var(--radius-*)` 这类引用，代价是引用处不再逐个求值。补这一道，
   保证「整条链的字面量起点」有且只有阶梯内的值 —— 否则往别名链里塞一个
   13px，规则 14/15 会一路绿灯放行。只查名里带 radius/shadow 的自定义属性，
   且只查字面量取值（转发 var() 的不查，它由链上另一处的定义负责）。 */
const offLadderTokenDefs = []
for (const relPath of CSS_RADIUS_TARGETS) {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) continue
  const body = stripKeyframes(readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
  for (const m of body.matchAll(/(--[\w-]*(?:radius|shadow)[\w-]*)\s*:\s*([^;}]+)/g)) {
    const [, name, raw] = m
    const v = raw.trim()
    if (v === 'none' || v.startsWith('var(')) continue          // 转发不重复判
    if (/radius/.test(name)) {
      if (!isRadiusOk(v)) offLadderTokenDefs.push({ file: relPath, name, value: v })
    } else {
      // 阴影的「三档」不是几个固定字符串（它是 0 1px 2px … 这样的自由组合），
      // 拿文本比对分不清档位。规范对阴影真正硬的那条要求是**全中性**（SPEC §0），
      // 所以这里只查染色量：把每个 rgba 通道乘上 alpha，看它最多能推偏底色多少。
      // 规范自己的 --wf-shadow-raised 用 slate rgba(15,23,42,.04/.06)，推偏 ≤2；
      // 彩色光晕（如 rgba(59,130,246,.5)）推偏上百 → 报。
      for (const one of v.split(/,(?![^(]*\))/)) {
        const m2 = one.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/]\s*([\d.]+))?/)
        if (!m2) continue
        const a = m2[4] === undefined ? 1 : +m2[4]
        const p = [+m2[1], +m2[2], +m2[3]].map((x) => x * a)
        if (Math.max(...p) - Math.min(...p) > 8) {
          offLadderTokenDefs.push({ file: relPath, name, value: v })
          break
        }
      }
    }
  }
}

/* 规则 8：var(--*) 引用的自定义属性必须已定义（引用面 = admin-redesign + 原语层 mk/ + src/styles）
   2026-10-02 放宽到任意前缀：前缀只是命名约定，不能当作"已定义"的证明 —— --mk-ep-primary-bg
   这类前缀完全正确的坏 token 正是靠这个漏洞躲过了检查。
   引用面补上 PRIMITIVE_FILES：walk() 只收 .vue，src/styles/*.css 从来没进过规则 8，
   两处真实 bug 都住在 CSS 里。（自定义属性在 :root 与组件样式里一视同仁，CSS 同样是引用面。）*/
const tokenRefTargets = [
  ...walk(SRC).filter((abs) => {
    const r = rel(abs)
    return isGoverned(r) || r.startsWith(posix.join('src', 'styles') + '/')
  }),
  ...PRIMITIVE_FILES.map((r) => join(ROOT, r)).filter((p) => existsSync(p)),
]
for (const abs of tokenRefTargets) {
  const relPath = rel(abs)
  const raw = readFileSync(abs, 'utf8')
  // 剥注释后再匹配引用：注释里的 var(--mk-fs-*)、var(--fam-*) 是说明文字，不参与解析。
  //   （不剥的话会凭空多出 `--mk-` / `--fam-` 这种"截断名"，噪声比真 bug 还多。）
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  const seen = new Set()
  for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
    const tk = m[1]
    // --el-* 交给下面那段 EP 桥检查独占：那里已是硬失败，重复报只会稀释信号
    if (tk.startsWith('--el-')) continue
    // 以 `-` 结尾 = 名字是拼出来的（`var(--wf-fs-${role})` 这类插值），不是可静态判定的
    //   token：当前仓库里剥完注释没有这种写法（唯一的 `var(--mk-fs-*)` 在注释里），
    //   留着是防御 —— 模板字符串拼 token 名是迟早会出现的写法，放行比误报划算。
    if (tk.endsWith('-')) continue
    if (definedTokens.has(tk) || TOKEN_HOOK_WHITELIST.has(tk) || seen.has(tk)) continue
    seen.add(tk)
    badTokens.push({ file: relPath, token: tk })
  }
  // admin 侧不得引用 EP 桥变量（--el-*）：那套变量随 EP 桥一起删除，引用会静默降级到兜底值。
  //   仍读原文 raw：EP 桥是硬失败，宁可多报也不放过，行为与放宽前完全一致。
  const seenEl = new Set()
  for (const m of raw.matchAll(/var\(\s*(--el-[a-zA-Z0-9-]+)/g)) {
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
      if (defined.has(m[1])) {
        if (scoped) overrides.push({ file: relPath, line: i + 1, cls: m[1] })
        return
      }
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
      // 规则 14/15：圆角 / 阴影只允许语言内的档位（SPEC v2 §0.5），存量棘轮只降不升
      if (!primitiveLayer) {
        const body = stripKeyframes(css.replace(/\/\*[\s\S]*?\*\//g, ''))
        for (const m of body.matchAll(/border-radius\s*:\s*([^;}]*)/g)) {
          if (!isRadiusOk(m[1].trim())) radiusCounts[relPath] = (radiusCounts[relPath] || 0) + 1
        }
        for (const m of body.matchAll(/box-shadow\s*:\s*([^;}]*)/g)) {
          if (!isShadowOk(m[1].trim())) shadowCounts[relPath] = (shadowCounts[relPath] || 0) + 1
        }
      }
      // 规则 6：页面不得自搓骨架 shimmer（统一走 .mk-skeleton）
      //   特征：background-size 200%/220%（shimmer 位移）或 自定义 shimmer/skel keyframes
      //   **同样仅限 admin 侧**：.mk-skeleton 定义在只对 admin 懒加载的
      //   mk-primitives.css，用户侧照本规则改会加上一段同样没有定义的类名，
      //   与规则 5 是同一个「坏指令」问题（见上文规则 5 的长注释）。
      if (!primitiveLayer && isAdminGoverned(relPath)
        && (/background-size:\s*2[02]0%/.test(css) || /@keyframes\s+[a-zA-Z-]*(shimmer|skel)/i.test(css))) {
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
  //   2026-10-06 修规则自身的漏洞：`\b` 在 `-` 前成立，于是 `mk-empty--line`
  //   （规范 §6 明文要求「筛选后 0 行的卡内列表用 .mk-empty--line」的那个修饰）
  //   反被判成手写结构——规则禁止了它自己指定的原语。MkEmptyState + class="mk-empty--line"
  //   合并后类名是 `mk-empty mk-empty--line`，按独立 token 仍会命中，故整条 class 属性
  //   只要含 `--line` 即放行（结构仍由 MkEmptyState 提供，与本规则不冲突）。
  if (!primitiveLayer && isGoverned(relPath)) {
    for (const m of tpl.matchAll(/class="([^"]*\bmk-empty\b[^"]*)"/g)) {
      if (/(^|\s)mk-empty--line(\s|$)/.test(m[1])) continue
      handRolledEmpty.push({ file: relPath, cls: m[1] })
    }
    // 规则 5：页面模板不得手写加载态（自建 spinner 容器，或元素内的「加载中…」文案）
    //   文案检测要求前面出现过 '>' 且中间无 '<' → 只认元素文本，不会误伤
    //   :title="loading ? '加载中…' : …" 这类属性值（转换后 text="加载中…" 也不该被误判）。
    //
    //   **仅限 admin 侧（isAdminGoverned，不是 isGoverned）**：
    //   .mk-spinner / .mk-loading 的定义在 mk-primitives.css，而该文件只被
    //   AdminConsole.vue 与 SkillDesignPage.vue 懒加载 —— 用户侧路由（/v2/*）
    //   从未加载过它。在这里对用户侧报「请改用 <MkLoading>」是给出**坏指令**：
    //   V2LearningPage.vue:123 已经用了 <MkLoading>，但在 /v2/* 下 .mk-spinner
    //   与 .mk-loading 两个类无样式命中，转圈根本不显示。照着报错改只会把
    //   同一个坏组件换一个地方用。
    //
    //   用户侧的正确解法不是照规则改页面，而是二选一的产品决策：
    //     (a) 把 mk-primitives.css 提为全局加载（原语层本就与 admin 无绑定，
    //         且 §7.5 要求用户侧复用同一套原语）；或
    //     (b) 用户侧自建 loading 原语，规则 5 对用户侧永久关闭。
    //   这个决策不在守卫职责内，故此处只把闸门收窄到 admin 并留登记。
    if (isAdminGoverned(relPath)) {
      const hasSpinner = /class="[^"]*\bmk-spinner\b/.test(tpl)
      const hasText = />[^<>]*加载中…|>[^<>]*正在加载/.test(tpl)
      if (hasSpinner || hasText) {
        handRolledLoading.push({ file: relPath, spinner: hasSpinner, text: hasText })
      }
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
        // Vue <Transition name="x"> 的运行时钩子类（x-enter-active / x-leave-from /
        //   x-move / x-enter-to …）由框架在过渡期间**动态挂到元素上**，模板里
        //   永远不会字面出现这些名字。按「语料里没出现」判死是结构性误报。
        //   治理面扩到用户侧后这条一次性冒出 53 条，占基线 80 条里的三分之二——
        //   把它们写进棘轮就等于把 53 个假阳性永久合法化，正是棘轮要防的失败模式。
        //   判据：名字以本文件里某个 <Transition name> 的 name 为前缀，
        //   且后缀是 Vue 约定的过渡钩子段。
        if (isTransitionHook(cls)) continue
        if (seenDead.has(cls)) continue
        seenDead.add(cls)
        deadClasses.push({ file: relPath, cls })
      }
    }
  }
}

/* ---------- 规则 9/10：媒体查询档位内的硬编码间距 / 字号（棘轮，只降不升） ----------
   五档(1440/1920/2000/2800/3600)曾以硬编码 px 覆盖 .mk-page/.mk-status 等的
   gap/padding/min-height/radius，各档互不单调且覆盖基线 token——"布局乱糟糟"
   的系统性根源（验收 F1）。档内这类声明现在只降不升。
   规则 10 是它的对称项：字号此前不在任何规则覆盖内，而档位里的字号声明有上千条，
   正是"字号体系被档位打散"（同一页 1440 有 10 个字号档、3840 变 17 个）的来源。 */
const MEDIA_SPACING_RE = /(^|[;{]\s*)(gap|padding|margin)(-(top|right|bottom|left|inline|block))?\s*:\s*[^;]*\dpx/
const MEDIA_FONT_RE = /(^|[;{]\s*)font-size\s*:\s*[^;]*\dpx/

/** 遍历所有 @media 块（含嵌套），把块内文本交给回调 */
function forEachMediaBlock(css, fn) {
  const re = /@media[^{]*\{/g
  while (re.exec(css) !== null) {
    let depth = 1
    let k = re.lastIndex
    while (k < css.length && depth > 0) {
      if (css[k] === '{') depth += 1
      else if (css[k] === '}') depth -= 1
      k += 1
    }
    fn(css.slice(re.lastIndex, k - 1))
  }
}

function countInMediaBlocks(css, re) {
  let n = 0
  forEachMediaBlock(css, (block) => {
    for (const line of block.split('\n')) {
      if (re.test(line.trim())) n += 1
    }
  })
  return n
}
const countMediaSpacing = (css) => countInMediaBlocks(css, MEDIA_SPACING_RE)
const countMediaFontSize = (css) => countInMediaBlocks(css, MEDIA_FONT_RE)

const mediaSpacingCounts = {}
const mediaFontSizeCounts = {}
for (const relPath of HEX_CSS_TARGETS) {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) continue
  const css = readFileSync(abs, 'utf8')
  const n = countMediaSpacing(css)
  if (n) mediaSpacingCounts[relPath] = n
  const f = countMediaFontSize(css)
  if (f) mediaFontSizeCounts[relPath] = f
}

/* ---------- 规则 16：基础作用域的 <12px 硬编码字号（棘轮） ----------
   规则 10 只覆盖 @media 档位内的字号；实测全 src 的 <12px 声明约 94% 落在
   基础作用域，规则 10 完全不可见（UI 审计报告 2026-09-27 P0-8①）。
   本规则把「基础作用域写死 <12px」纳入棘轮：存量按 10-11.5px 微标签登记保留
   （边界②：不单方面放大桌面微标签），但只降不升——新增一处即失败。 */
const SMALL_FONT_RE = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g

/** 剥掉所有 @media 块（含嵌套），只留基础作用域文本 */
function cssWithoutMediaBlocks(css) {
  let out = css
  let m
  while ((m = /@media[^{]*\{/.exec(out)) !== null) {
    let depth = 1
    let k = m.index + m[0].length
    while (k < out.length && depth > 0) {
      if (out[k] === '{') depth += 1
      else if (out[k] === '}') depth -= 1
      k += 1
    }
    out = out.slice(0, m.index) + out.slice(k)
  }
  return out
}

function countBaseSmallFonts(css) {
  const s = cssWithoutMediaBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''))
  let n = 0
  for (const m of s.matchAll(SMALL_FONT_RE)) {
    if (parseFloat(m[1]) < 12) n += 1
  }
  return n
}

const baseSmallFontCounts = {}
{
  // 治理面 = 全部 .vue 的 scoped 块（字号问题不限于 admin——审计范围是全前端）
  const seen = new Set()
  const allVue = [
    ...walk(join(SRC, 'views')),
    ...walk(join(SRC, 'components')),
    ...walk(SRC).filter((p) => p.endsWith('.vue')),
  ]
  for (const abs of allVue) {
    if (seen.has(abs)) continue
    seen.add(abs)
    const text = readFileSync(abs, 'utf8')
    let total = 0
    for (const { css } of styleBlocks(text)) total += countBaseSmallFonts(css)
    if (total) baseSmallFontCounts[rel(abs)] = total
  }
  // 原语层 CSS（与规则 9/10 同一治理面）
  for (const relPath of HEX_CSS_TARGETS) {
    const abs = join(ROOT, relPath)
    if (!existsSync(abs)) continue
    const n = countBaseSmallFonts(readFileSync(abs, 'utf8'))
    if (n) baseSmallFontCounts[relPath] = n
  }
}

/* ---------- 规则 11：档位字号单调性（硬失败，无基线） ----------
   响应式档位的语义是"屏幕越大越舒展"。曾出现 1920 档字号大于相邻 2000 档
   （.mk-page 15→14.5、.mk-table td 15→13.5 等 12 个类）——越大屏字越小，
   而 1440/1920/2000/2800 各档分属不同补丁、谁也没做跨档校验。
   这里对每个文件逐档解析 `选择器 { font-size: Npx }`，与「更低的最近已声明档」比较。

   两个必要的修正，否则会误报：
   1) ≥2800/≥3600 壳层叠了全局 zoom（admin-theme.css：1.15 / 1.3），页面级 3600 档
      的 px 值是**除过 zoom 的补偿值**（17×1.15 ≈ 15.5×1.3），必须换算成有效字号再比。
   2) 补偿算术会有零点几 px 的取整偏差，给 1.5% 容差，避免把"持平"报成"回退"。 */
const TIER_PX = [1440, 1920, 2000, 2800, 3600]
const TIER_ZOOM = { 1440: 1, 1920: 1, 2000: 1, 2800: 1.15, 3600: 1.3 }
const TIER_TOLERANCE = 0.985

function tierFontMap(text, px) {
  const map = new Map()
  const re = new RegExp(`@media\\s*\\(min-width:\\s*${px}px\\)\\s*\\{`, 'g')
  while (re.exec(text) !== null) {
    let depth = 1
    let k = re.lastIndex
    while (k < text.length && depth > 0) {
      if (text[k] === '{') depth += 1
      else if (text[k] === '}') depth -= 1
      k += 1
    }
    const block = text.slice(re.lastIndex, k - 1)
    for (const r of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = r[1].trim().replace(/\s+/g, ' ')
      const f = r[2].match(/font-size\s*:\s*([\d.]+)px/)
      if (f) map.set(sel, parseFloat(f[1]))
    }
  }
  return map
}

/* 角色 token：文本只有三级（SPEC §1）。档位块只覆写这三个 token，页面引用它们，
   于是"每档位几个字号档"这件事收敛成一个数得出来的量。 */
const ROLE_TOKENS = ['--mk-fs-micro', '--mk-fs-body', '--mk-fs-emphasis']
const BASE_ROLE_SCALE = { '--mk-fs-micro': 12, '--mk-fs-body': 14, '--mk-fs-emphasis': 15 }

/** 取某个档位块里声明的角色 token 值 */
function tierRoleTokens(text, px) {
  const out = {}
  const re = new RegExp(`@media\\s*\\(min-width:\\s*${px}px\\)\\s*\\{`, 'g')
  while (re.exec(text) !== null) {
    let depth = 1
    let k = re.lastIndex
    while (k < text.length && depth > 0) {
      if (text[k] === '{') depth += 1
      else if (text[k] === '}') depth -= 1
      k += 1
    }
    const block = text.slice(re.lastIndex, k - 1)
    for (const tok of ROLE_TOKENS) {
      const m = block.match(new RegExp(`${tok}\\s*:\\s*([\\d.]+)px`))
      if (m) out[tok] = parseFloat(m[1])
    }
  }
  return out
}

/** 每个文件的每档位角色尺度（未声明的档位继承更低档位；最低回落到基线） */
function roleScaleByTier(text) {
  const declared = TIER_PX.map((px) => tierRoleTokens(text, px))
  const out = {}
  let carry = { ...BASE_ROLE_SCALE }
  for (let i = 0; i < TIER_PX.length; i++) {
    carry = { ...carry, ...declared[i] }
    out[TIER_PX[i]] = { ...carry }
  }
  return out
}

const tierRegressions = []
const offScaleTierFonts = []
for (const abs of [...vueFiles.filter((p) => isGoverned(rel(p))), ...HEX_CSS_TARGETS.map((r) => join(ROOT, r))]) {
  if (!existsSync(abs)) continue
  const text = readFileSync(abs, 'utf8')
  const maps = TIER_PX.map((px) => tierFontMap(text, px))
  for (let i = 1; i < TIER_PX.length; i++) {
    for (const [sel, v] of maps[i]) {
      let prev = null
      let prevTier = null
      for (let k = i - 1; k >= 0; k--) {
        if (maps[k].has(sel)) { prev = maps[k].get(sel); prevTier = TIER_PX[k]; break }
      }
      if (prev === null) continue
      const effPrev = prev * TIER_ZOOM[prevTier]
      const effNow = v * TIER_ZOOM[TIER_PX[i]]
      if (effNow < effPrev * TIER_TOLERANCE) {
        tierRegressions.push({
          file: rel(abs), sel, prevTier, prev, tier: TIER_PX[i], now: v,
          effPrev: Math.round(effPrev * 10) / 10, effNow: Math.round(effNow * 10) / 10,
        })
      }
    }
  }

  /* 规则 11（续）：角色 token 的档位单调性——文本档现在由三个 token 承载，
     逐个选择器的扫描已覆盖不到它们，所以 token 本身也要比：有效字号（值 × zoom）非递减。 */
  {
    const scaleByTier11 = roleScaleByTier(text)
    for (const tok of ROLE_TOKENS) {
      let prev = null
      let prevTier = null
      for (const px of TIER_PX) {
        const v = scaleByTier11[px][tok]
        if (prev !== null) {
          const effPrev = prev * TIER_ZOOM[prevTier]
          const effNow = v * TIER_ZOOM[px]
          if (effNow < effPrev * TIER_TOLERANCE) {
            tierRegressions.push({
              file: rel(abs), sel: tok, prevTier, prev, tier: px, now: v,
              effPrev: Math.round(effPrev * 10) / 10, effNow: Math.round(effNow * 10) / 10,
            })
          }
        }
        prev = v
        prevTier = px
      }
    }
  }

  /* ---------- 规则 13：档位内不得再写「文本带内」的字号字面量 ----------
     SPEC §5 要求视觉层改动只发生在 token/原语层。档位块里逐个选择器写 13.5/15.5/17.5 这类
     半像素值，正是"同一页在 1440 有 6 档、3840 变 16 档"的来源（2026-09-24 收敛前实测
     588 条档位内字号声明）。现在文本只有三个角色 token，档位块只覆写 token；
     字面量只允许**展示型**（> emphasis × 1.15：KPI 数字、实体名、大标题）。 */
  const scaleByTier = roleScaleByTier(text)
  for (const px of TIER_PX) {
    const scale = scaleByTier[px]
    const emphasis = scale['--mk-fs-emphasis']
    const textBandMax = emphasis * 1.15
    const roleValues = ROLE_TOKENS.map((t) => scale[t])
    const bad = []
    for (const [sel, v] of maps[TIER_PX.indexOf(px)]) {
      if (v > textBandMax) continue // 展示型，合法
      if (roleValues.some((rv) => Math.abs(rv - v) < 0.01)) continue // 与某角色值等值，等价写法
      bad.push({ sel, v })
    }
    if (bad.length) offScaleTierFonts.push({ file: rel(abs), tier: px, emphasis, bad })
  }
}

/* ---------- 规则 12：Element Plus 选择器残留（硬失败，无基线） ----------
   EP 已从依赖里移除（frontend/package.json 无 element-plus），`.el-button` 这类选择器不再命中
   任何元素：看着像样式、实际是死规则，还会让人以为 EP 仍在用。2026-09-24 管理端巡检清掉 8 处。
   豁免：src/styles/v2.css 的按钮 reset 用 `:not(.el-button)` 排除历史类名——那是功能性子句
   （删掉反而会误伤），不是样式规则。 */
const EL_SELECTOR_RE = /\.el-[a-z0-9-]+/g
const EL_ALLOWED_FILES = new Set([posix.join('src', 'styles', 'v2.css')])
const elResidues = []
for (const abs of walk(SRC).filter((p) => p.endsWith('.vue') || p.endsWith('.css'))) {
  const relPath = rel(abs)
  if (EL_ALLOWED_FILES.has(relPath)) continue
  const text = readFileSync(abs, 'utf8')
  // 只看样式块（模板注释里提到 `.el-*` 属说明文字），并剔除 CSS 注释（注释里的选择器不渲染）
  const css = abs.endsWith('.vue')
    ? styleBlocks(text).map((b) => b.css).join('\n')
    : text
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const hits = [...new Set([...stripped.matchAll(EL_SELECTOR_RE)].map((m) => m[0]))]
  if (hits.length) elResidues.push({ file: relPath, sels: hits })
}

/* ---------- 规则 17 / 18：退役材质不得复辟（硬失败，无基线、无棘轮） ----------
   背景：2026-10-02 的四个批次把两类材质清成了全仓零 —— 主按钮的「交互蓝 → 深蓝」135° 渐变
   （原形 background: linear-gradient(135deg, var(--blue), var(--blue-deep))）与一切
   backdrop-filter 毛玻璃（tokens.css 三节已登记"亚克力 / 毛玻璃整体退役，1px 发丝线就是全部质感"）。

   为什么不棘轮：规则 3/7/14/15/16 的基线是**还款计划表** —— 存量太大，要跨批次逐条退场，
   记着"还剩多少"有意义。而这两条存量已经是 0，一份空基线不设防，只会在 --update 时给后来人
   留一个"往里写点东西"的错觉。于是直接硬失败：新写一处即断，不给"下批再还"的余地。

   为什么扫描面不挂 isGoverned：材质是**全产品级**决策，本守卫的治理面（ADMIN_PREFIX + MK_PREFIX）
   只是 admin-redesign 与原语层，用户侧 views/v2、共享 components、v2.css / uc.css 同样会写渐变与
   毛玻璃。只看治理面的话，材质能从用户侧长回来而门禁全绿 —— 那才是这条规则最容易被绕过的地方。

   为什么先剥注释：清理批次把"原来是什么"写进了注释（批次 D 涉及的 12 个文件里就有 15 处
   `backdrop-filter: blur(…) 已删` 这类说明）。注释记录历史正是我们要的，剥掉再匹配，
   与 countHardcodedHex 同一手法；否则这 15 条"已删"会被自己报成违规，门禁当天就得被关掉。 */

/** 一个文件的可扫描 CSS 面：.vue 只取 <style> 块（scoped 与否都算数，材质写在哪块里都是材质），
    .css 全文。与规则 12 的取面方式一致，不另立一套。 */
function cssSurfaceOf(abs) {
  const text = readFileSync(abs, 'utf8')
  return abs.endsWith('.vue') ? styleBlocks(text).map((b) => b.css).join('\n') : text
}

/** rgb()/rgba() → #rrggbb。不归一化的话"蓝色 hex"白名单只管得住 hex 写法，同一个按钮渐变换成
    rgba(47, 106, 224, 1) 就整个绕过去了 —— 门禁的强度不该取决于作者手滑写了哪种记法。 */
function normalizeRgbToHex(css) {
  return css.replace(/\brgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^)]*)?\)/gi,
    (whole, r, g, b) => {
      const ch = [r, g, b].map((x) => +x)
      if (ch.some((v) => v > 255)) return whole // 不是合法色值，原样留着
      return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
    })
}

/* 规则 17 的三个判据。
   角度：只认 125/135deg 这一族（1[23]5deg）。90deg 是进度条/仪表（在语义上编码"完成度"，属有意保留），
         100deg 是骨架 shimmer 的位移方向（`linear-gradient(\n 100deg, …)` 跨行写也拦得住，因为
         参数取的是整个函数体）；180deg 是上下方向的浅色叠层。都不是按钮材质。
         已知边界：105/115/145deg 同样能画出这盏高光，但不在本判据内 —— 换角度是刻意的手笔，
         而本仓存量里没有这类写法，先按"误报零容忍"的口径收窄。
   蓝色 token：--blue / --blue-deep / --color-primary / --mk-blue / --wf-color-primary
         （`\b` 收尾，避免 --blueprint 这类同前缀名字被算进来；var(--blue, #2f6ae0) 这种带兜底的
         写法天然命中，因为只看名字）。
   蓝色 hex：退役批次用过的七枚蓝（#2f6ae0 / #1f57cc / #3478f6 / #2c63d0 / #4d8bf8 / #5b8def /
         #5a94f8），尾部允许两位的 alpha 位。
   已知边界：--mk-graph-blue-ink 这类图谱专用蓝不在名单里，它本来也不是"交互蓝"，不算漏网。

   两条 blue 正则必须带 g 标志：`.match()` 只在 /g/ 时返回**全部**命中，否则只给第一处 ——
   不带 g 时 (token 1 + hex 1) 恒 ≤ 2，"两枚蓝"的判据就退化成"token 与 hex 各碰巧各来一处"，
   而 --blue → --blue-deep 这种两个都是 token 的原形反被判为 0 处。写法同上面的 HEX。 */
const GRADIENT_BUTTON_ANGLE_RE = /^\s*1[23]5deg\b/
const BLUE_TOKEN_RE = /--(?:blue|blue-deep|color-primary|mk-blue|wf-color-primary)\b/g
const BLUE_HEX_RE = /#(?:2f6ae0|1f57cc|3478f6|2c63d0|4d8bf8|5b8def|5a94f8)(?:[0-9a-fA-F]{2})?\b/g

/** 取一段声明值里的每个 linear-gradient(...) 的实参（括号配对，color-mix 的嵌套括号不会截断） */
function gradientArgsList(value) {
  const out = []
  const re = /linear-gradient\(/gi
  let m
  while ((m = re.exec(value)) !== null) {
    let depth = 1
    let k = re.lastIndex
    while (k < value.length && depth > 0) {
      if (value[k] === '(') depth += 1
      else if (value[k] === ')') depth -= 1
      k += 1
    }
    out.push(value.slice(re.lastIndex, k - 1))
    re.lastIndex = k
  }
  return out
}

const gradientButtons = [] // 规则 17
const backdropFilters = [] // 规则 18
for (const abs of [...walk(SRC), ...walk(SRC, [], '.css')]) {
  const relPath = rel(abs)
  const css = normalizeRgbToHex(cssSurfaceOf(abs).replace(/\/\*[\s\S]*?\*\//g, ''))

  // 规则 17：background / background-image 上的蓝→深蓝 135° 渐变
  //   值用 [^;{}]* 取，因此 `background:\n  linear-gradient(…)` 这类换行写法也收得到。
  for (const d of css.matchAll(/(?:^|[;{])\s*(?:background-image|background)\s*:\s*([^;{}]*)/g)) {
    for (const args of gradientArgsList(d[1])) {
      if (!GRADIENT_BUTTON_ANGLE_RE.test(args)) continue
      // 判据是「≥2 枚蓝色色标」，不是「≥1 枚」。原形有两个色标（--blue → --blue-deep），也就是一盏高光；
      //   清理之后仓库里仍存活的 135° 渐变全是**单侧带蓝**的洗色（blue 7% → accent 5% /
      //   rgba(77,139,248,.14) → accent 8%），一枚蓝，它们是暗色态下的悬浮底色、不是按钮材质。
      //   按"一枚蓝就算"的宽松判据会把这三处全报成违规 —— 门禁一旦有假阳性，就没人再看它的输出。
      //   取"两枚蓝"的代价是三色标里只有一枚蓝的情况会漏（现实中不存在），可接受。
      const blueStops = (args.match(BLUE_TOKEN_RE) || []).length + (args.match(BLUE_HEX_RE) || []).length
      if (blueStops < 2) continue
      gradientButtons.push({ file: relPath, at: `linear-gradient(${args.replace(/\s+/g, ' ').trim()})` })
    }
  }

  // 规则 18：backdrop-filter / -webkit-backdrop-filter 一律禁止，唯一个字面量 none 放行。
  //   none 是"这里不挂材质"的显式声明，与干脆不写等价（tokens.css 三节注释就是这么要求的）；
  //   `!important` 也放过 —— 它改的是层叠优先级，不是材质本身。
  for (const d of css.matchAll(/(?:^|[;{])\s*(-webkit-)?backdrop-filter\s*:\s*([^;{}]*)/g)) {
    if (d[2].trim().replace(/\s*!important\s*$/i, '') === 'none') continue
    backdropFilters.push({
      file: relPath,
      at: `${d[1] || ''}backdrop-filter: ${d[2].replace(/\s+/g, ' ').trim()}`,
    })
  }
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
        mediaFontSize: mediaFontSizeCounts,
        baseSmallFont: baseSmallFontCounts,
        radius: radiusCounts,
        boxShadow: shadowCounts,
        deadClasses: deadByFile,
        note: '硬编码 hex 色值 + 死 CSS 类 + 圆角/阴影档外值基线（棘轮：只降不升）。收敛后请用 --update 下调。',
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `已更新基线：${Object.keys(hexCounts).length} 个文件、硬编码色值 ${Object.values(hexCounts).reduce((a, b) => a + b, 0)} 处；` +
      `死 CSS ${deadClasses.length} 处（${Object.keys(deadByFile).length} 个文件）；` +
      `圆角档外 ${Object.values(radiusCounts).reduce((a, b) => a + b, 0)} 处、阴影档外 ${Object.values(shadowCounts).reduce((a, b) => a + b, 0)} 处`
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

const mediaFontRegressions = []
for (const [file, n] of Object.entries(mediaFontSizeCounts)) {
  const base = baseline.mediaFontSize?.[file] ?? 0
  if (n > base) mediaFontRegressions.push({ file, now: n, base })
}
if (mediaFontRegressions.length) {
  failed = true
  console.log(`
✖ 规则 10：媒体查询档位内的硬编码字号不得超过基线（只降不升）`)
  console.log('  档位里的字号应改为继承共享层的档位值，或在 token 层统一放大；逐页写死会让字号体系被档位打散。')
  for (const v of mediaFontRegressions) console.log(`    ${v.file}: ${v.base} → ${v.now}`)
}

const radiusRegressions = []
for (const [file, n] of Object.entries(radiusCounts)) {
  const base = baseline.radius?.[file] ?? 0
  if (n > base) radiusRegressions.push({ file, now: n, base })
}
if (radiusRegressions.length) {
  failed = true
  console.log(`
✖ 规则 14：页面 scoped 圆角档外值不得超过基线（只降不升）`)
  console.log('  圆角只有六档（xs4 / sm6 / md8 / lg12 / xl16 / 胶囊999）+ 圆形/0，写法见 ADMIN_VISUAL_LAYER_SPEC v4 §0.5；用 var(--mk-radius-*) 引用。')
  for (const v of radiusRegressions) console.log(`    ${v.file}: ${v.base} → ${v.now}`)
}

const shadowRegressions = []
for (const [file, n] of Object.entries(shadowCounts)) {
  const base = baseline.boxShadow?.[file] ?? 0
  if (n > base) shadowRegressions.push({ file, now: n, base })
}
if (shadowRegressions.length) {
  failed = true
  console.log(`
✖ 规则 15：页面 scoped 非法 box-shadow 不得超过基线（只降不升）`)
  console.log('  阴影三档：面=none、悬浮/弹层=var(--mk-shadow-*)、描边=inset；彩色光晕/自写投影禁止（SPEC v2 §0.5）。')
  for (const v of shadowRegressions) console.log(`    ${v.file}: ${v.base} → ${v.now}`)
}

/* 规则 19：档位令牌的**取值**必须落在阶梯上（硬失败，不进基线）。
   与 14/15 的分工：14/15 拦「引用处」，这条拦「定义处」。因为 14/15 现在放行
   `var(--radius-*)` 这类转发，光靠引用处检查会让「往别名链里塞 13px」一路绿灯；
   这一条把整条链的字面量起点钉死。硬失败而非棘轮的理由与 17/18 一致：
   存量已清零，任何新增都是刚写进去的，没有「历史包袱」需要豁免。 */
if (offLadderTokenDefs.length) {
  failed = true
  console.log(`
✖ 规则 19：档位令牌的定义值落在阶梯外（${offLadderTokenDefs.length} 处）`)
  console.log('  令牌是整条引用链的起点：这里写了档位外的值，所有 var() 引用处都会合法地继承它。')
  console.log('  圆角阶梯 4/6/8/12/16/999（+0/50%）；阴影必须全中性（SPEC §0，禁止彩色光晕）。')
  for (const v of offLadderTokenDefs) console.log(`    ${v.file}  ${v.name}: ${v.value.slice(0, 60)}`)
}

const baseSmallFontRegressions = []
for (const [file, n] of Object.entries(baseSmallFontCounts)) {
  const base = baseline.baseSmallFont?.[file] ?? 0
  if (n > base) baseSmallFontRegressions.push({ file, now: n, base })
}
if (baseSmallFontRegressions.length) {
  failed = true
  console.log(`
✖ 规则 16：基础作用域写死的 <12px 字号不得超过基线（只降不升）`)
  console.log('  <12px 请用 var(--mk-fs-micro)（12px 起，档位自动放大）；确需更小的装饰字形请 --update 记账并写明理由。')
  for (const v of baseSmallFontRegressions) console.log(`    ${v.file}: ${v.base} → ${v.now}`)
}

if (tierRegressions.length) {
  failed = true
  console.log(`\n✖ 规则 11：档位字号必须随断点非递减（${tierRegressions.length} 处回退，已按 zoom 折算）`)
  console.log('  「屏幕越大字越小」：高档位的有效字号小于更低档位的同一选择器。')
  const byFile = {}
  for (const v of tierRegressions) (byFile[v.file] ||= []).push(v)
  for (const [f, vs] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${f}  ×${vs.length}`)
    for (const v of vs.slice(0, 6)) {
      console.log(`        ${v.sel}  ${v.prevTier}→${v.prev}px(有效 ${v.effPrev}) 但 ${v.tier}→${v.now}px(有效 ${v.effNow})`)
    }
    if (vs.length > 6) console.log(`        … 另 ${vs.length - 6} 处`)
  }
}

if (offScaleTierFonts.length) {
  failed = true
  console.log(`
✖ 规则 13：档位内出现文本带内的字号字面量（${offScaleTierFonts.length} 个文件×档位）`)
  console.log('  文本只有三个角色 token（micro/body/emphasis，SPEC §1）；档位块只覆写 token，')
  console.log('  字面量只允许展示型（> emphasis × 1.15，如 KPI 数字/实体名）。')
  for (const v of offScaleTierFonts) {
    console.log(`    ${v.file} @${v.tier}（emphasis ${v.emphasis}）`)
    for (const b of v.bad.slice(0, 5)) console.log(`        ${b.sel}  ${b.v}px`)
    if (v.bad.length > 5) console.log(`        … 另 ${v.bad.length - 5} 处`)
  }
}

if (elResidues.length) {
  failed = true
  console.log(`\n✖ 规则 12：Element Plus 选择器残留（${elResidues.length} 个文件）`)
  console.log('  EP 已从依赖移除，这些选择器不命中任何元素（死规则）。删掉，或改写成一方的类名。')
  for (const v of elResidues) console.log(`    ${v.file}  ${v.sels.join(' ')}`)
}

if (gradientButtons.length) {
  failed = true
  console.log(`
✖ 规则 17：主按钮底不得用「交互蓝 → 深蓝」的 135° 渐变（${gradientButtons.length} 处）`)
  console.log('  按钮材质是平面实心：background: var(--blue) + 白字（焦点/悬浮用 var(--mk-blue-hover) 一类色阶）。')
  console.log('  渐变那 1px 深浅差会让同屏同角色的按钮出现两档品牌蓝；这条不设基线，新写一处即断。')
  console.log('  90deg 进度条、100deg 骨架 shimmer、以及停用色标不是蓝的装饰洗色都不在判据内 —— 那些不是按钮材质。')
  const byFile = {}
  for (const v of gradientButtons) (byFile[v.file] ||= []).push(v.at)
  for (const [f, ats] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${f}  ×${ats.length}  ${ats[0]}`)
  }
}

if (backdropFilters.length) {
  failed = true
  console.log(`
✖ 规则 18：backdrop-filter 毛玻璃已整体退役（${backdropFilters.length} 处）`)
  console.log('  tokens.css 三节「材质：平面」：亚克力 / 毛玻璃已退役，1px 发丝线就是全部质感；')
  console.log('  它还会让元素变成独立合成层、滚动时每帧重采样，长列表与聊天流直接掉帧。')
  console.log('  唯一豁免是字面量 none（"这里不挂材质"的显式声明）；需要层次请用 --wf-shadow-raised / 1px 发丝线。')
  const byFile = {}
  for (const v of backdropFilters) (byFile[v.file] ||= []).push(v.at)
  for (const [f, ats] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${f}  ×${ats.length}  ${ats[0]}`)
  }
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
  // 两桶分流：在册的欠账只报告、不阻断；没登记过的一律阻断（见 KNOWN_UNDEFINED 注释）。
  const known = badTokens.filter((v) => KNOWN_UNDEFINED.has(v.token))
  const unknown = badTokens.filter((v) => !KNOWN_UNDEFINED.has(v.token))

  if (known.length) {
    console.log(`
🔧 规则 8 待修复：引用了已定位的未定义 token（${known.length} 处，登记在 KNOWN_UNDEFINED）`)
    console.log('  已知欠账、不阻断 CI，但每一条都要修掉并从 KNOWN_UNDEFINED 摘除；修完这个桶就空。')
    for (const v of known) {
      console.log(`    ${v.token}\n        ${KNOWN_UNDEFINED.get(v.token)}\n        ← ${v.file}`)
    }
  }
  if (unknown.length) {
    failed = true
    console.log(`
✖ 规则 8：var(--*) 引用了未定义的 token（${unknown.length} 处）`)
    console.log('  这类引用会**静默降级**到 var() 的兜底值（通常是没有暗色适配的硬编码色），而 CI 全绿。')
    console.log('  确属"可覆盖钩子"的请登记进 TOKEN_HOOK_WHITELIST；确属 bug 的修 CSS，别登记进 KNOWN_UNDEFINED 蒙混过关。')
    const byFile = {}
    for (const v of unknown) (byFile[v.file] ||= []).push(v.token)
    for (const [f, ts] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${f}  ×${ts.length}  ${ts.join(' ')}`)
    }
  }
}

/* 已修完却还留在册的 token：主动提示摘除。
   不放在上面的 if 里 —— 欠账全部还清时 badTokens 为空，那正是最该提示"可以销账"的时刻。
   没有这条提示，KNOWN_UNDEFINED 只会变成永久豁免名单，也就失去了"不许增长"的约束力。 */
{
  const stillReferenced = new Set(badTokens.map((v) => v.token))
  const stale = [...KNOWN_UNDEFINED.keys()].filter((tk) => !stillReferenced.has(tk))
  if (stale.length) {
    console.log(`
🧹 KNOWN_UNDEFINED 有条目已不再被引用（${stale.length}），请删掉以免变成永久豁免：${stale.join(' ')}`)
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
