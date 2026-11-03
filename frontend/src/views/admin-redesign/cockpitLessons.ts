/**
 * Learn 课程列表域（SessionCockpit.vue 拆分）：
 * Path 任务树 × 教学历史 → 课节状态 / 树形分组（纯函数）；课程打开与跳课交互留在 SFC
 */
import type { PathMilestoneView } from './cockpitPathViews'

export type LessonState = 'done' | 'active' | 'failed' | 'pending'

/** 结课但没走完的终态（timeout / finalization_failed / discarded / superseded 同属 #135 终态集，
 *  只是不是 error）。taskRuntime 还会带路径管线自己的 error / next_task_start_failed 别名，一并收进来。
 *  不用 statusText.isRunTerminal：那个判据面向虚拟运行，缺后三个，正是「超时课标进行中」的来源。 */
const ABORTED_LESSON_STATUSES = [
  'failed', 'error', 'abandoned', 'cancelled', 'canceled',
  'timeout', 'finalization_failed', 'discarded', 'superseded', 'next_task_start_failed'
]

export interface LearnLesson {
  taskId: string
  title: string
  milestone: string
  state: LessonState
  teachingSessionId: string
  /** 这节课是否已有总结（由所选课堂会话终态推断，判据见 sessionHasSummary） */
  hasSummary: boolean
}

export interface TeachHistoryItem {
  id: string
  taskId: string
  taskTitle: string
  /** 会话终态（completed/discarded/...）：同课多会话时用于挑选有总结的那条 */
  status?: string
}

/** 课堂会话终态 → 是否已有总结：completed 是全量总结，timeout / finalization_failed
 *  是课堂发生过、常带 summary-only 降级总结；其余（discarded=中断重试）没有总结 */
export function sessionHasSummary(status?: string) {
  return status === 'completed' || status === 'timeout' || status === 'finalization_failed'
}

export function buildLearnLessons(
  milestones: PathMilestoneView[],
  history: TeachHistoryItem[],
  current: { currentTaskId: string; currentTeachingId: string; runtimeStatus: string }
): LearnLesson[] {
  /* 同课多会话（2026-10-12 真机：一节课 10 条历史，9 条 discarded + 1 条 timeout）：
     last-write-wins 会把课映射到无总结的废弃会话。分级取优——completed（全量总结）>
     timeout / finalization_failed（课堂发生过，常有 summary-only 降级总结）> 其余
     （discarded=中断重试，无总结）；同分保持先到（后端历史新→旧，先到=最新）。 */
  const rankOf = (status: string) =>
    status === 'completed' ? 0 : status === 'timeout' || status === 'finalization_failed' ? 1 : 2
  const historyByTask = new Map<string, TeachHistoryItem>()
  const rankByTask = new Map<string, number>()
  for (const item of history) {
    if (!item.taskId || !item.id) continue
    const rank = rankOf(item.status || '')
    const prevRank = rankByTask.get(item.taskId)
    if (prevRank === undefined || rank < prevRank) {
      historyByTask.set(item.taskId, item)
      rankByTask.set(item.taskId, rank)
    }
  }
  const lessons: LearnLesson[] = []
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (!t.id) continue
      let state: LessonState = 'pending'
      let teachingSessionId = ''
      let hasSummary = false
      if (t.completed) {
        state = 'done'
        const picked = historyByTask.get(t.id)
        teachingSessionId = picked?.id || ''
        hasSummary = sessionHasSummary(picked?.status)
      }
      if (t.id === current.currentTaskId) {
        /* 已完成课不得被 currentTaskId 回写成「进行中/失败」（F2-1 单源）：真实教学会话
           收尾后 currentTaskId 仍指向最后已授完的课，回写会让课数读数结构性少 1
           （同屏 stepper「课程 0/19」与「1/19 课已完成」并列）；仍挂当前课堂 id 供查看对话。 */
        if (t.completed) {
          teachingSessionId = current.currentTeachingId || teachingSessionId
        } else {
          /* 2026-11-02 P1-4：原先只把 error / next_task_start_failed 判成 failed，timeout、
             finalization_failed、discarded、superseded 这些**结课终态**全落进 else 写成 active——
             已超时终局的课在 Learn 树里仍标「进行中」，与课头、总结页的「超时」互相打架。
             终态名单与 SessionCockpit 的 #135 同口径；completed 不在此列（任务没标完成时
             仍按在课处理，那是任务回写问题，不归本行判定）。 */
          const st = String(current.runtimeStatus || '').toLowerCase()
          state = ABORTED_LESSON_STATUSES.includes(st) ? 'failed' : 'active'
          teachingSessionId = current.currentTeachingId
        }
      }
      lessons.push({ taskId: t.id, title: t.title, milestone: m.title, state, teachingSessionId, hasSummary })
    }
  }
  return lessons
}

/** Path → Milestones → Lessons 的层级分组，用于 Learn 树形视图 */
export function buildLessonTree(milestones: PathMilestoneView[], lessons: LearnLesson[]) {
  const tree: { milestone: string; lessons: LearnLesson[]; doneCount: number }[] = []
  const map = new Map<string, LearnLesson[]>()
  for (const l of lessons) {
    const key = l.milestone
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(l)
  }
  for (const m of milestones) {
    const group = map.get(m.title) || []
    if (group.length) {
      tree.push({ milestone: m.title, lessons: group, doneCount: group.filter(l => l.state === 'done').length })
    }
  }
  return tree
}

export function lessonMark(state: LessonState) {
  return { done: '✓', active: '▸', failed: '✕', pending: '·' }[state]
}

export function lessonStateLabel(state: LessonState) {
  return { done: '已完成', active: '进行中', failed: '失败，可重启恢复', pending: '未开始' }[state]
}

/** 已完成课数（课数读数单源）：stepper「课程 x/y」/ Learn 卡头 / 学习总结卡头
    与卡内课时行共用同一判据，任一处不得另起口径（F2-1） */
export function countDoneLessons(lessons: LearnLesson[]) {
  return lessons.filter((l) => l.state === 'done').length
}

/** 全局课程编号（跨里程碑递增） */
export function lessonNumberOf(lessons: LearnLesson[], taskId: string) {
  const idx = lessons.findIndex(l => l.taskId === taskId)
  return idx >= 0 ? idx + 1 : 0
}
