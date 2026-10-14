/**
 * 运营组共享（工作台 / 内容管理 / 公告之间复用的纯映射与计数逻辑）：
 * - announcementCounts：公告三态计数（工作台待办/状态条、侧栏徽章共用同一份 live 数据口径）
 * - segmentPct：状态面板比例条（路径四态 / 公告三态同一套 ≥2% 保底算法）
 * - PATH_STATUS_*：学习路径状态 文案/徽章 唯一映射（内容管理页使用）
 */
import { computed } from 'vue'
import { liveAnnouncements, timeAgo } from './live'
import { statusText as globalStatusText } from './statusText'

export interface AnnouncementCounts {
  rows: number
  published: number
  draft: number
  archived: number
}

/** 公告三态计数：只读 liveAnnouncements（live 层加载 + TTL 缓存，页面不重复拉取） */
export const announcementCounts = computed<AnnouncementCounts>(() => {
  const list = liveAnnouncements.value
  const by = (s: string) => list.filter((a) => a.status === s).length
  return { rows: list.length, published: by('published'), draft: by('draft'), archived: by('archived') }
})

/** 状态面板比例条：零值不占宽，非零保底 2% 可见 */
export function segmentPct<T extends { count: number }>(defs: T[]): Array<T & { pct: string }> {
  const total = defs.reduce((n, d) => n + d.count, 0)
  return defs.map((d) => ({
    ...d,
    pct: total > 0 && d.count > 0 ? `${Math.max(2, Math.round((d.count / total) * 100))}%` : '0%'
  }))
}

/* 学习路径状态：文案 + 徽章（唯一映射，勿在页面内重复定义） */
export const PATH_STATUS_TEXT: Record<string, string> = {
  active: '学习中',
  completed: '已完成',
  failed: '生成失败',
  archived: '已下线'
}
export const PATH_STATUS_BADGE: Record<string, string> = {
  active: 'mk-badge--ok',
  completed: 'mk-badge--info',
  failed: 'mk-badge--bad',
  archived: 'mk-badge--muted',
  abandoned: 'mk-badge--muted'
}
/* 路径域文案优先（active 在路径域是「学习中」，与全局字典的「进行中」不同），
   表里没有的落回全局字典 —— 全局还有 abandoned/stopped 等取值，直接回退原始英文
   会把未本地化的枚举漏进中文界面（走查发现状态列出现裸 abandoned）。 */
export const statusText = (s: string) => PATH_STATUS_TEXT[s] || globalStatusText(s)
export const statusBadge = (s: string) => PATH_STATUS_BADGE[s] || 'mk-badge--muted'

/* 生成停滞判定（内容管理页/详情页共用）：active 且 updatedAt 超过阈值 → 需关注（可「重试生成」补齐）。
   24h 口径：跑批 cohort 每日推进理应日更；真实用户数日不学属正常，只提示不强判死。 */
export const PATH_STALL_HOURS = 24

export function isPathStalled(status: string, updatedAt: string | Date | number, now: number = Date.now()): boolean {
  if (status !== 'active') return false
  const t = typeof updatedAt === 'string' || typeof updatedAt === 'number' ? new Date(updatedAt).getTime() : updatedAt.getTime()
  if (!Number.isFinite(t)) return false
  return now - t > PATH_STALL_HOURS * 3600_000
}

/* ---------- 四读数出处（LSS/KTL/LF/LSB 在两个详情页各有一套来源） ----------
   读数的 label/参考带/色调在 @/utils/learnerMetrics；来源标注只在管理端有意义，故放这里。 */

/** 读数来源两分：学习者级聚合快照 vs 单次会话的运行时快照。 */
export type LoadCaliber = 'aggregate' | 'session-snapshot'

export interface LoadCaliberNote {
  /** 可见短标（进卡头 mk-card__meta） */
  label: string
  /** 悬停长释：说清来源与「为什么另一页的数字不一样」 */
  title: string
}

export function loadCaliber(kind: LoadCaliber, at?: string | null): LoadCaliberNote {
  const hasStamp = !!at && !Number.isNaN(new Date(at).getTime())
  const stamp = hasStamp ? timeAgo(at) : ''
  const stampLine = hasStamp ? `\n取样时刻：${stamp}。` : ''
  if (kind === 'aggregate') {
    return {
      label: hasStamp ? `学习者级聚合 · 快照 ${stamp}` : '学习者级聚合',
      title:
        `LSS/KTL/LF/LSB 取自**学习者级聚合快照**（learning-state.service 按路径保守聚合 + 当日课量疲劳加成），` +
        `不是某一次会话的读数。${stampLine}\n同一学习者在「虚拟学习者档案」页看到的同名读数取自单次会话的运行时快照，数值天然不同——那是两套来源，不是其中一处算错。`,
    }
  }
  return {
    label: hasStamp ? `单次会话快照 · ${stamp}` : '单次会话快照',
    title:
      `LSS/KTL/LF/LSB 取自**最近一次带读数的教学会话**的运行时快照（该会话 teachingState 的 currentState），` +
      `不是学习者级聚合。${stampLine}\n同一学习者在「学习者详情」页看到的同名读数是学习者级聚合态，数值天然不同——那是两套来源，不是其中一处算错。`,
  }
}

/* ---------- 面板作用域标注（详情页一屏混三种作用域，各块必须自述） ----------
   背景：一个学习者可有多条路径（实测同账号并存 3 条 active），详情页里「当前进度/概念掌握/证据」
   只取**当前路径**，「教学会话/记忆与复习」取**全部路径**，「LSS/KTL/LF/LSB」是**跨路径聚合**，
   而此前只有图谱一处有作用域开关、其余静默；「全局信号与背景」卡头还自称「跨全部学习路径汇总」
   （实测其数据源是当前路径的会话与证据 + 该学习者全部记忆痕迹，不是跨全部路径）。
   文案单点在此，各卡头取用，避免各写一套说法。 */

export type PanelScope = 'current-path' | 'all-paths' | 'all-stories' | 'single-conversation'

export interface PanelScopeNote {
  /** 可见短标（进卡头 mk-card__meta / 页头 pill） */
  label: string
  /** 悬停长释：说清这个块算的是哪些路径 */
  title: string
}

export function panelScopeNote(scope: PanelScope, opts: { pathTitle?: string | null } = {}): PanelScopeNote {
  const named = (opts.pathTitle || '').trim()
  if (scope === 'current-path') {
    return {
      label: '当前路径',
      title:
        `本块取自**当前路径**${named ? `（${named}）` : ''}的会话与学习证据，并并入该学习者的全部记忆痕迹；其它路径不在这里。` +
        `\n当前路径 = 该学习者 status=active 且 updatedAt 最新的一条（快照 currentPath 口径）；已归档/失败的路径不参与。`,
    }
  }
  if (scope === 'all-paths') {
    return {
      label: '跨全部路径',
      title: '本块按学习者聚合，统计其名下**全部**路径的数据（含已归档 / 失败的路径），不按当前路径收窄。',
    }
  }
  if (scope === 'all-stories') {
    return {
      label: '跨全部故事',
      title: '本块按该虚拟学习者聚合，统计其名下**全部故事**（story，即这个角色的多条独立学习线）的数据，不按单条故事收窄。',
    }
  }
  return {
    label: '单次会话',
    title: '本块取自单次会话的读数，不是学习者级聚合。',
  }
}

/* retryPathGeneration 的 retryType 文案（守卫自动判定，页面透传不二次解释） */
export const PATH_RETRY_TYPE_TEXT: Record<string, string> = {
  core: '重建主结构',
  stageDesign: '补齐阶段任务'
}
export const pathRetryTypeText = (t?: string | null) => (t && PATH_RETRY_TYPE_TEXT[t]) || '已提交重试'
