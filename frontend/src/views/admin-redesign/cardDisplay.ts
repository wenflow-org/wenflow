/**
 * 身份卡的展示口径（2026-11-07 卡库走查）。
 *
 * 卡库里 200 张合成卡的 name 恒为「想解决 + goal」，而 goal 本身往往写成
 * 「领域：更具体的场景」。卡面此前把 name 原样当标题、再把 goal 印在下一行，
 * 于是每张卡都是「想解决并发编程」+「并发编程：以为加 volatile…」——
 * 同一句话上下印两遍，还把横向空间让给了一个永远写着「想」的首字头像。
 *
 * 这里集中两件事，卡墙与卡详情页共用同一口径：
 *   1. 标题取信息更全的那一条（去掉「想解决/想搞懂」前缀后如果就是 goal 的前缀，直接用 goal）；
 *   2. 档位 / 卡号这些标识的短写法与识别规则。
 */

/** 卡名里那层「想…」的叙述前缀（只这两类在卡库数据里成规模出现） */
const WANT_PREFIX_RE = /^想(?:解决|搞懂|学会|了解|改变|摆脱|提升)\s*/

const norm = (s: string) => String(s || '').replace(/\s+/g, '')

/**
 * 卡面标题：能合并就合并成一句。
 * - `想解决并发编程` + `并发编程：以为加 volatile 能保线程安全` → 后者（信息更全）；
 * - `想解决亏钱焦虑` + `亏钱` → 前者去掉前缀（后者更短，不拿它当标题）；
 * - 不以「想…」开头的名字原样返回（人名、自定义卡名）。
 */
export function cardDisplayTitle(name: string, goal: string): string {
  const raw = String(name || '').trim()
  const stripped = raw.replace(WANT_PREFIX_RE, '').trim()
  const g = String(goal || '').trim()
  if (!stripped || stripped === raw) return raw
  if (g && norm(g).startsWith(norm(stripped))) return g
  return stripped
}

/**
 * 卡号短写法：`frontier-F100` → `#F100`。
 * 前缀（frontier / preset / 批次名）在整面墙上恒同，印它只占宽；卡号本身才是区分度。
 * 形如 `w6-math-01` 这种非「前缀-短号」的卡号原样返回（运营认得它）。
 */
export function shortCardKey(key: string): string {
  const k = String(key || '').trim()
  if (!k) return ''
  const m = /^[a-z][a-z0-9]*-([A-Za-z]?\d{1,4})$/i.exec(k)
  return m ? `#${m[1].toUpperCase()}` : k
}

/** 档位标签：A–E（难度档）与 F1–F5A/B（frontier 批次档）。卡库按它筛。 */
export const TIER_RE = /^(?:[A-E]|F\d[A-Z]?)$/

/** 卡上的档位（没有就空串）：取第一个命中 TIER_RE 的标签 */
export function cardTier(tags: string[]): string {
  return (tags || []).find((t) => TIER_RE.test(String(t).trim())) || ''
}

/** 档位排序：A–E 在前，F1…F5A/B 在后（同批 A 在 B 前） */
export function compareTier(a: string, b: string): number {
  const rank = (t: string) => {
    const s = String(t).trim()
    if (/^[A-E]$/.test(s)) return s.charCodeAt(0)
    const m = /^F(\d)([A-Z])?$/.exec(s)
    if (!m) return 9999
    return 1000 + Number(m[1]) * 26 + (m[2] ? m[2].charCodeAt(0) - 64 : 0)
  }
  return rank(a) - rank(b)
}

/**
 * 成规模出现的「批次 / 样本设计」标签（不区分任何两张卡的都按内部标记处理）：
 * - `frontier-100` / `golden-100`：整批卡共用，卡号 `frontier-F100` 已带同一信息；
 * - `repair` / `negative` / `mastery`：样本意图，属于故事池的 `intentType`，详情页有专属位置。
 * 卡面只留来源、档位与卡号（2026-11-07 用户「三级台阶占高太大」）。
 */
const WALL_HIDDEN_TAG_RE = /^(?:frontier-\d+|golden-\d+|repair|negative|mastery)$/i

export function isWallHiddenTag(tag: string): boolean {
  return WALL_HIDDEN_TAG_RE.test(String(tag || '').trim())
}
