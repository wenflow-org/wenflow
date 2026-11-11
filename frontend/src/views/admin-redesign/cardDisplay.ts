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

/**
 * 合成卡的「昵称」其实是学习诉求句（2026-11-08 用户「虚拟学习者的名称也太逗了」）：
 * 400 张合成卡的 nickname / account.displayName / persona.nameHint 三处写的是同一句
 * `想解决2024新《公司法》认缴制`，于是虚拟学习者列表整列读作「想解决…」。
 * 预置卡（presets.yaml）用的是真人名（陈默 / 周敏 / 赵鹏），只有合成卡是这样。
 * 判定：以「想解决 / 想搞懂…」开头即视为诉求句，不是人名。
 */
export function isWantSentence(name: string): boolean {
  return WANT_PREFIX_RE.test(String(name || '').trim())
}

/**
 * 合成卡的人名池（2026-11-08）：合成卡没有真人名，展示时按人设短语稳定派生一个。
 *
 * 为什么是池子而不是从开场白抽职业：实测 400 张卡里只有 35% 的开场白带「我是 X」式身份
 * （「以前习惯配 tailwind.config.js」「公司要把数据同步到海外」这类根本没有身份），
 * 抽不出来的 65% 仍会退回诉求句，列表还是参差不齐。
 */
const SURNAMES = [
  '陈', '林', '周', '赵', '苏', '李', '孙', '吴', '沈', '韩', '徐', '王', '刘', '黄', '何',
  '郭', '罗', '高', '梁', '宋', '唐', '许', '邓', '冯', '曾', '彭', '蒋', '蔡', '潘', '田',
]
const GIVEN_NAMES = [
  '默', '敏', '鹏', '芮', '昊', '浩', '倩', '舟', '磊', '慧', '婷', '晨', '宇', '宁', '然',
  '嘉', '铭', '瑶', '岚', '澈', '衡', '睿', '澜', '瑾', '越', '望', '珩', '澄', '钧', '棠',
  '书', '言', '洲', '乔', '知', '远', '砚', '青', '朔', '昀', '弈', '安然', '之遥', '思源',
]

/** 32 位字符串哈希（FNV-1a）：同一 cardKey 恒定同值，不依赖运行环境 */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * 合成卡展示名：按「人设短语」文本派生稳定人名。
 *
 * 种子为什么是文本而不是卡号（2026-11-08 二次修正）：同一张身份模板在「学习者卡库」
 * 与「虚拟学习者实例」里是**两行不同数据**——实测卡库 200 张卡（cardKey 形如
 * `frontier-F99`）与学习者实例（cardKey 形如 `vl-3f2a19c4`）的 profileId 零重叠。
 * 按卡号派生会让同一个人在两处拿到两个名字（同一个「想解决纯行政审批…」在卡库是人名 A、
 * 在实例列表是人名 B），而按诉求句派生与运营直觉一致：一个人一个名，诉求句即其身份。
 *
 * 稳定性：对归一后的文本取哈希取模，任意页面、任意次渲染、列表与详情都得同一个名字
 * （同一张卡在 VirtualLearners 列表、VirtualProfile 详情两处必须同字符串）。
 */
export function syntheticPersonaName(seedText: string): string {
  const k = String(seedText || '').replace(/\s+/g, '')
  if (!k) return ''
  const h = hash32(k)
  const surname = SURNAMES[h % SURNAMES.length]
  const given = GIVEN_NAMES[Math.floor(h / SURNAMES.length) % GIVEN_NAMES.length]
  return surname + given
}

/**
 * 虚拟学习者 / 卡面的展示名（2026-11-08）：
 * - 名字是「想…」诉求句（合成卡）→ 按诉求句派生稳定人名；
 * - 其余（预置卡真人名、自建卡自定义名、人名）原样返回。
 *
 * 调用点必须成对：`VirtualLearners 列表`（live.ts）与 `VirtualProfile 详情`（同名者点进去）
 * 传的是同一句 `personaSeed.nickname`，因此必然得到同一个名字；卡库（VirtualLearnerCards /
 * CardDetailPage）面向卡池、标题读内容句，走 `cardDisplayTitle`，不参与这条链。
 */
export function personaDisplayName(name: string): string {
  const raw = String(name || '').trim()
  if (!isWantSentence(raw)) return raw
  return syntheticPersonaName(raw) || raw
}

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

/** 档位码 → 人可读名（口径见 virtual-learners/cards/README.md「文件」与「构成」两节）：
 *  A–E 是 golden 基准批的五组，F1–F5B 是 frontier 前沿批的六组。 */
export const TIER_LABELS: Record<string, string> = {
  A: '学科体系',
  B: '工程实操',
  C: '应试',
  D: '业务诊断',
  E: '边界负样本',
  F1: '新规时效',
  F2: '技术版本',
  F3: '私有材料',
  F4: '专业深水区',
  F5A: '诊断纠偏',
  F5B: '分诊负样本',
}

/** 档位的一行说明：`F5B · 分诊负样本`；未知码原样返回（不编造语义） */
export function tierLabel(tier: string): string {
  const t = String(tier || '').trim()
  const name = TIER_LABELS[t]
  return name ? `${t} · ${name}` : t
}

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
