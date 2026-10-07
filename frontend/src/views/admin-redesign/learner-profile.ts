/**
 * 学习者域前端共享派生逻辑（LearnerCenter / LearnerDetail / Users 复用）
 *
 * - isTestAccountUser：测试/虚拟账号识别（与后端 utils/test-account.ts 同源命名约定）
 * - isVirtualLearnerAccount / isRealAccountUser：账号域口径单点（payload 标记 ∪ 命名约定）
 * - useListQueryState：列表筛选 / 页码 ↔ URL query 双向同步（Users / LearnerCenter 复用）
 * - levelFromXp：等级单点公式（与后端 level.util.ts floor(sqrt(xp/100))+1 一致）
 * - 概念掌握条（conceptLedger）可视化：tone / 宽度 / 中文标签
 * - LearnerDetail tab 归一化：6 tab → 3 tab 后旧 tab 名深链重定向（cognitive→profile 等）
 */
import { getCurrentInstance, watch, type Ref } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'

/**
 * 测试/审计账号命名前缀（**唯一出处**，勿内联到别处）。
 * 与后端 utils/test-account.ts 的 TEST_ACCOUNT_PREFIXES 逐项同步——改一端必改另一端；
 * 2026-10-07 运营走查 F3-4 补齐 uitest/uxtest/ui_audit_/audit_/eval/simb_/vqa_/
 * vizcheck/logocheck/pe-finalverify 及宽集（menutest/goalprobe/ev_p/…），
 * 这些账号在「仅真实」列表里仍混入且行内无徽章。
 */
const TEST_ACCOUNT_PREFIXES = [
  'e2e_', 'audit_probe_', 'uxaudit_', 'ui_check', 'motion_review', 'qa_audit_',
  'shotsnap', 'verify_real_user', 'vcheck', 'vqa_audit', 'align_', 'qa_delete_test_',
  'uitest', 'uxtest', 'ui_audit_', 'audit_', 'eval', 'simb_', 'vqa_', 'vizcheck',
  'logocheck', 'pe-finalverify', 'menutest', 'goalprobe', 'ev_p', 'gw-upload-probe'
] as const
const TEST_ACCOUNT_PREFIX_PATTERN = new RegExp(`^(${TEST_ACCOUNT_PREFIXES.join('|')})`, 'i')

/** 测试/虚拟账号命名约定（后端 utils/test-account.ts 同源；前缀清单同步更新，勿只改一端） */
export function isTestAccountUser(u: { id?: string; name?: string; email?: string }): boolean {
  const id = String(u.id || '')
  const name = String(u.name || '')
  const email = String(u.email || '')
  if (/^virtual_/.test(id)) return true
  if (/@test\.local$/i.test(email)) return true
  if (/^virtual_/i.test(email)) return true
  if (TEST_ACCOUNT_PREFIX_PATTERN.test(email)) return true
  if (TEST_ACCOUNT_PREFIX_PATTERN.test(name)) return true
  return false
}

/**
 * 账号性质判据单点（2026-10-07 运营走查 F1-1「账号域口径单源」）。
 *
 * 后端 users 列表每行都回传两个标记：isVirtualLearner（users 表真列）与 isTestAccount
 * （后端 isTestAccountUser 派生）——People 的 KPI「真实用户」与账号构成带一直用它们。
 * 命名约定正则覆盖不到卡库 / 预置库造出的虚拟学习者（email 形如 vl-*@cards.local、
 * builtin_*@preset.local：payload 标了 isVirtualLearner=true，正则却认不出）——实测含测试档
 * 823 行里正好差 10 行，「普通用户」pill 因此比同屏 KPI 多 10（326 vs 316），且这些行还能
 * 勾选进批量删除 / 导出。
 *
 * 口径：真实账号 = 非虚拟学习者 且 非测试 / 审计账号；payload 标记优先、命名约定正则兜底
 * （标记缺失 = mock 数据 / 旧响应 / 已删除窗口行）。真实域判定一律走 isRealAccountUser，
 * 勿在各页另拼条件（否则 KPI / 构成带 / 筛选计数三处口径又会漂移）。
 */
export interface AccountScopeLike {
  id?: string
  name?: string
  email?: string
  isVirtualLearner?: boolean
  isTestAccount?: boolean
}

/** 虚拟学习者：payload 标记优先（覆盖卡库 vl-* / 预置库 builtin_* 形态），无标记时按创建约定兜底 */
export function isVirtualLearnerAccount(u: AccountScopeLike): boolean {
  if (u.isVirtualLearner != null) return u.isVirtualLearner === true
  return /^virtual_/i.test(String(u.email || '')) || /^virtual_/.test(String(u.id || ''))
}

/** 真实账号（与 KPI「真实用户」/ 账号构成带同一口径）：非虚拟学习者 且 非测试 / 审计账号 */
export function isRealAccountUser(u: AccountScopeLike): boolean {
  if (isVirtualLearnerAccount(u)) return false
  return !(u.isTestAccount === true || isTestAccountUser(u))
}

/** 等级单点公式：level = floor(sqrt(xp / 100)) + 1（后端 level.util.ts 权威公式） */
export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1
}

/** 等级文案：L1-L5 徽章 */
export function levelLabel(xp: number): string {
  return `L${levelFromXp(xp)}`
}

/**
 * 等级词汇单点（2026-10-02 人类可读性评审：等级词汇四页三貌「初学/入门/L2·进阶」收敛）。
 * 定稿以 LearnerDetail 现用词为准：入门 / 进阶 / 高级。
 * 注意：OpsContent 的「入门/进阶/高阶」是路径难度枚举、VirtualProfile 的四级枚举是
 * 虚拟学习者知识水平（零基础/入门/中级/进阶）——均为别的域，不归本词表管。
 */
const LEVEL_WORDS: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高级' }

/** currentLevel 英文枚举 → 中文等级词汇（唯一出处）；空值出空串、未知值原样透传（存量库里有 'L1' 等历史值） */
export function levelWordZh(level?: string | null): string {
  if (!level) return ''
  return LEVEL_WORDS[String(level).trim().toLowerCase()] || String(level)
}

/** XP 等级「L2」与词汇并存的统一格式单点：「L2 · 进阶」；词汇缺失或与 Ln 同名（历史脏值 'L2'）时只出 L2 */
export function levelBadgeZh(xp: number, level?: string | null): string {
  const l = `L${levelFromXp(xp)}`
  const word = levelWordZh(level)
  return !word || word === l ? l : `${l} · ${word}`
}

export type ConceptBarTone = 'ok' | 'warn' | 'bad' | 'muted'

/** conceptLedger 单条：transferReadiness low/medium/high + misconceptionRisk low/medium/high */
export interface ConceptLedgerItem {
  conceptKey?: string
  label?: string
  transferReadiness?: string
  misconceptionRisk?: string
  evidenceCount?: number
  [k: string]: unknown
}

/** 概念条色调：误解风险高 → 红；转移就绪低 → 红；中 → 琥珀；就绪高 → 绿；其余灰 */
export function conceptBarTone(item: ConceptLedgerItem): ConceptBarTone {
  const risk = String(item.misconceptionRisk || '').toLowerCase()
  const readiness = String(item.transferReadiness || '').toLowerCase()
  if (risk === 'high' || readiness === 'low') return 'bad'
  if (risk === 'medium' || readiness === 'medium') return 'warn'
  if (readiness === 'high') return 'ok'
  return 'muted'
}

/** 概念条宽度（%）：高=90 / 中=55 / 低=25 / 未知=8 */
export function conceptBarWidth(readiness?: string): number {
  const r = String(readiness || '').toLowerCase()
  if (r === 'high') return 90
  if (r === 'medium') return 55
  if (r === 'low') return 25
  return 8
}

/** 转移就绪中文 */
export function transferReadinessZh(v?: string): string {
  return { high: '可迁移', medium: '待巩固', low: '不宜迁移' }[String(v || '').toLowerCase()] || '—'
}

/** 误解风险中文 */
export function misconceptionRiskZh(v?: string): string {
  return { high: '高', medium: '中', low: '低' }[String(v || '').toLowerCase()] || '—'
}

/** LearnerDetail tab 归一化：6 tab → 3 tab 后旧 tab 名深链重定向（内容去向见 ADMIN_DEEP_LEARNER_AUDIT §4.2） */
export type LearnerTab = 'overview' | 'profile' | 'evidence' | 'graph'

const TAB_REDIRECT: Record<string, LearnerTab> = {
  overview: 'overview',
  profile: 'profile',
  cognitive: 'profile', // 认知画像 → 画像
  dynamic: 'evidence', // 动态状态 → 证据（指标卡常驻）
  memory: 'profile', // 知识记忆 → 画像
  teaching: 'profile', // 教学建议 → 画像
  evidence: 'evidence',
  graph: 'graph' // 知识图谱（概念图画布）
}

export function normalizeLearnerTab(tab: unknown): LearnerTab {
  const t = String(tab || '').toLowerCase()
  return TAB_REDIRECT[t] || 'overview'
}

/**
 * 学习者详情 → 「记忆与复习」的跨页深链。
 *
 * 契约：参数名必须是 `userId`（`MemoryReview.vue` 的 onMounted 读的就是 `route.query.userId`）。
 * 抽成纯函数是为了把这条**跨组件契约**钉进测试——两侧各自改参数名是这类跳转最常见的静默失效。
 */
export function memoryReviewUrl(userId: string): string {
  return `/admin/memory-review?userId=${encodeURIComponent(String(userId || ''))}`
}

/* ================= 列表筛选 / 页码 ↔ URL query 双向同步 ================= */

/**
 * 列表筛选状态（URL 承载的部分）：pill 词表值 / 搜索词 / 页码/ 每页条数 / 分段下钻序号。
 * 缺省值不写进 URL（`pill=all` / `page=1` / 空搜索词），URL 短且人可读。
 */
export interface ListQueryState {
  pill: Ref<string>
  keyword: Ref<string>
  page: Ref<number>
  pageSize?: Ref<number>
  /** 附加下钻筛选（LearnerCenter 置信分段），null = 未下钻 */
  bin?: Ref<number | null>
  /** pill 词表白名单：URL 里的值不在此列（脏深链 / 旧参数名）时回落 'all'，不把列表筛空 */
  allowedPills?: readonly string[]
  /** 页码默认 1；页大小默认值（与调用方 Pagination 初值一致才不误写 URL） */
  defaultPageSize?: number
}

/** URL 参数名（同页多列表可覆盖；默认见下） */
export interface ListQueryKeys {
  pill?: string
  keyword?: string
  page?: string
  pageSize?: string
  bin?: string
}

/**
 * 列表筛选 / 页码 ↔ URL query 双向同步（2026-10-07 运营走查 F1-2）。
 *
 * 为什么不能只放组件内 ref：进二级详情时 AdminConsole 以 `<component :is="detailComponent
 * || currentComponent">` 整页替换列表组件——列表**被卸载**，组件内 keyword/pill/page 随之
 * 清零；面包屑返回与浏览器后退都会重建组件，于是「找一个出问题的学习者 → 看详情 → 返回
 * 继续处理下一人」这条运营高频动线每次都要重筛（实测 people 页搜索 uitest 8 行 → 返回后
 * 15 行、learner-state 低置信 259 条 → 返回后 311 条/全部）。
 * URL 是唯一能跨卸载存活的载体（判例：ExecLogs「筛选 ↔ URL query」、MemoryReview ?userId=），
 * 顺带修好深链与刷新还原。
 *
 * 契约：
 * - URL 为权威：挂载先按 query 落位（返回/深链/刷新），随后双向同步；
 * - 只 replace 不 push：筛选变化不压历史栈（返回键仍是「回详情/回上一页」）；
 * - 只增删自己管的键，其余 query（如 people 的 ?tab=、二级页的 ?view=&id=）原样保留；
 * - 非法值（不在词表里的 pill、非正整数页码）回落默认值，不让脏深链把列表筛空；
 * - 组件在没有 Router 的上下文挂载（单测直接 mount）时整体降级为纯内存状态，不报错。
 */
export function useListQueryState(state: ListQueryState, keys: ListQueryKeys = {}): void {
  // 无 Router 上下文（单测直接 mount、或页面被嵌进无 router 的宿主）时整体降级为纯内存状态：
  // 先看 router 插件是否已装（它会给 app 挂 $router），没有就别调 useRoute/useRouter，
  // 免得它们往控制台打 "injection not found" 警告。
  const inst = getCurrentInstance()
  const hasRouter = !!inst?.appContext.config.globalProperties.$router
  if (!hasRouter) return
  const route = useRoute()
  const router = useRouter()
  if (!route || !router) return
  const r = route
  const nav = router
  const K = {
    pill: keys.pill ?? 'pill',
    keyword: keys.keyword ?? 'q',
    page: keys.page ?? 'page',
    pageSize: keys.pageSize ?? 'size',
    bin: keys.bin ?? 'bin'
  }
  const allowedPills = state.allowedPills
  const defaultSize = state.defaultPageSize ?? 15
  const managed = (): string[] =>
    [K.pill, K.keyword, K.page, ...(state.pageSize ? [K.pageSize] : []), ...(state.bin ? [K.bin] : [])]
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const posInt = (v: unknown, fallback: number): number => {
    const n = Number(str(v))
    return Number.isInteger(n) && n > 0 ? n : fallback
  }

  /** 状态 → 期望 query 片段（缺省值不写） */
  function desired(): Record<string, string> {
    const d: Record<string, string> = {}
    if (state.pill.value !== 'all') d[K.pill] = state.pill.value
    if (state.keyword.value.trim()) d[K.keyword] = state.keyword.value.trim()
    if (state.page.value > 1) d[K.page] = String(state.page.value)
    if (state.pageSize && state.pageSize.value !== defaultSize) d[K.pageSize] = String(state.pageSize.value)
    if (state.bin && state.bin.value != null) d[K.bin] = String(state.bin.value)
    return d
  }

  const sig = (get: (k: string) => string): string => managed().map((k) => get(k) || '').join('\u0001')
  /** 本组件最后一次同步的 query 签名：路由回调只在外部改动（返回/前进/深链）时才回写状态，不与自己打架 */
  let lastSig = ''

  /** URL → 状态（挂载落位 / 前进后退 / 手改地址） */
  function applyFromRoute(): void {
    const q = r.query
    const rawPill = str(q[K.pill])
    state.pill.value = rawPill && (!allowedPills || allowedPills.includes(rawPill)) ? rawPill : 'all'
    state.keyword.value = str(q[K.keyword])
    state.page.value = posInt(q[K.page], 1)
    if (state.pageSize) state.pageSize.value = posInt(q[K.pageSize], defaultSize)
    if (state.bin) {
      const rawBin = str(q[K.bin])
      const n = Number(rawBin)
      state.bin.value = rawBin !== '' && Number.isInteger(n) && n >= 0 ? n : null
    }
    lastSig = sig((k) => str(q[k]))
  }

  applyFromRoute()
  watch(
    () => managed().map((k) => r.query[k]),
    () => {
      if (sig((k) => str(r.query[k])) === lastSig) return
      applyFromRoute()
    }
  )
  watch(
    () => [state.pill.value, state.keyword.value, state.page.value, state.pageSize?.value, state.bin?.value],
    () => {
      const d = desired()
      const nextSig = sig((k) => d[k] || '')
      if (nextSig === lastSig) return
      lastSig = nextSig
      const next: LocationQuery = { ...r.query }
      for (const k of managed()) delete next[k]
      Object.assign(next, d)
      void nav.replace({ query: next })
    },
    { immediate: true }
  )
}
