/**
 * 运营组共享（工作台 / 内容管理 / 公告之间复用的纯映射与计数逻辑）：
 * - announcementCounts：公告三态计数（工作台待办/状态条、侧栏徽章共用同一份 live 数据口径）
 * - segmentPct：状态面板比例条（路径四态 / 公告三态同一套 ≥2% 保底算法）
 * - PATH_STATUS_*：学习路径状态 文案/徽章 唯一映射（内容管理页使用）
 */
import { computed } from 'vue'
import { liveAnnouncements } from './live'
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
