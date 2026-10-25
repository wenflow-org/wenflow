/**
 * 会话日志查看器域（SessionCockpit.vue 拆分）：
 * 按消息 id 去重追加 + 滚动跟随 + 阶段筛选；数据拉取 loadLogs 留在 SFC（双模式分支依赖会话状态）
 */
import { computed, nextTick, ref } from 'vue'
import type { LogEntryView } from './sessionLog'

export interface CockpitLogEntry {
  id: string
  time: string
  text: string
  view: LogEntryView
  /** 折叠行：对话全文在左侧页签，点按跳到对应页签（2026-10-22 去重复读） */
  jumpTab?: 'goal' | 'learning'
}

/** 日志窗口上限（条） */
export const LOG_WINDOW = 60

export function useCockpitLogs() {
  const logs = ref<CockpitLogEntry[]>([])
  const logsFailed = ref(false)
  const logBox = ref<HTMLElement | null>(null)
  /* 日志滚动：接近底部才跟随，用户上翻时不打扰 */
  const logFollowsBottom = ref(true)
  /* 所有出现过的日志阶段，用于筛选 chips */
  const logPhaseFilter = ref('')
  /* chips 固定按阶段推进顺序排（2026-10-19 用户走查「顺序调一下」）：原实现取首次出现顺序，
     于是「证据」会插在「路径」和「课堂」之间（日志窗口里证据事件先于课堂行出现时），
     与同屏阶段条的 目标 → 路径 → 课堂 读不成一条线。证据是过程记录不是阶段，排最后。
     词表外阶段（虚拟会话的 学习者回复 / 路径重排 / 错误…）仍按首次出现顺序接在后面。 */
  const PHASE_ORDER = ['目标对话', '路径', '课堂', '证据']
  const logPhases = computed(() => {
    const seen = new Set<string>()
    for (const l of logs.value) {
      if (l.view.phase) seen.add(l.view.phase)
    }
    const known = PHASE_ORDER.filter((p) => seen.has(p))
    const rest = [...seen].filter((p) => !PHASE_ORDER.includes(p))
    return [...known, ...rest]
  })
  const filteredLogs = computed(() => {
    if (!logPhaseFilter.value) return logs.value
    return logs.value.filter(l => l.view.phase === logPhaseFilter.value)
  })
  function onLogScroll() {
    const box = logBox.value
    if (!box) return
    logFollowsBottom.value = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  }
  function scrollLogsIfFollowing() {
    void nextTick(() => {
      const box = logBox.value
      if (!box || !logFollowsBottom.value) return
      box.scrollTop = box.scrollHeight
    })
  }
  function scrollToBottom() {
    const box = logBox.value
    if (!box) return
    box.scrollTop = box.scrollHeight
    logFollowsBottom.value = true
  }
  /* 按消息 id 去重追加，保留窗口上限 */
  function appendLogs(entries: CockpitLogEntry[]) {
    if (!entries.length) return
    const seen = new Set(logs.value.map((l) => l.id || `${l.time}|${l.view.phase}|${l.text}`))
    const added: CockpitLogEntry[] = []
    for (const entry of entries) {
      const key = entry.id || `${entry.time}|${entry.view.phase}|${entry.text}`
      if (seen.has(key)) continue
      seen.add(key)
      added.push(entry)
    }
    if (!added.length) return
    logs.value = [...logs.value, ...added].slice(-LOG_WINDOW)
    scrollLogsIfFollowing()
  }
  function resetLogs() {
    logs.value = []
    logsFailed.value = false
    logFollowsBottom.value = true
  }
  return {
    logs, logsFailed, logBox, logFollowsBottom, logPhaseFilter,
    logPhases, filteredLogs, onLogScroll, scrollToBottom, appendLogs, resetLogs
  }
}
