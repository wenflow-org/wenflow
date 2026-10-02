/**
 * 学习者域前端共享派生逻辑（LearnerCenter / LearnerDetail / Users 复用）
 *
 * - isTestAccountUser：测试/虚拟账号识别（与后端 utils/test-account.ts 同源命名约定）
 * - levelFromXp：等级单点公式（与后端 level.util.ts floor(sqrt(xp/100))+1 一致）
 * - 概念掌握条（conceptLedger）可视化：tone / 宽度 / 中文标签
 * - LearnerDetail tab 归一化：6 tab → 3 tab 后旧 tab 名深链重定向（cognitive→profile 等）
 */

/** 测试/虚拟账号命名约定（后端 utils/test-account.ts 同源；前缀清单同步更新，勿只改一端） */
export function isTestAccountUser(u: { id?: string; name?: string; email?: string }): boolean {
  const id = String(u.id || '')
  const name = String(u.name || '')
  const email = String(u.email || '')
  if (/^virtual_/.test(id)) return true
  if (/@test\.local$/i.test(email)) return true
  if (/^virtual_/i.test(email)) return true
  if (/^(e2e_|audit_probe_|uxaudit_|ui_check|motion_review|qa_audit_|shotsnap|verify_real_user|vcheck|vqa_audit|align_|qa_delete_test_)/i.test(email)) return true
  if (/^(e2e_|audit_probe_|uxaudit_|ui_check|motion_review|qa_audit_|shotsnap|verify_real_user|vcheck|vqa_audit|align_|qa_delete_test_)/i.test(name)) return true
  return false
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
