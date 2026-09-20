/**
 * Learn 课程列表域（SessionCockpit.vue 拆分）：
 * Path 任务树 × 教学历史 → 课节状态 / 树形分组（纯函数）；课程打开与跳课交互留在 SFC
 */
import type { PathMilestoneView } from './cockpitPathViews'

export type LessonState = 'done' | 'active' | 'failed' | 'pending'

export interface LearnLesson {
  taskId: string
  title: string
  milestone: string
  state: LessonState
  teachingSessionId: string
}

export interface TeachHistoryItem {
  id: string
  taskId: string
  taskTitle: string
}

export function buildLearnLessons(
  milestones: PathMilestoneView[],
  history: TeachHistoryItem[],
  current: { currentTaskId: string; currentTeachingId: string; runtimeStatus: string }
): LearnLesson[] {
  const historyByTask = new Map<string, string>()
  for (const item of history) {
    if (item.taskId) historyByTask.set(item.taskId, item.id)
  }
  const lessons: LearnLesson[] = []
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (!t.id) continue
      let state: LessonState = 'pending'
      let teachingSessionId = ''
      if (t.completed) {
        state = 'done'
        teachingSessionId = historyByTask.get(t.id) || ''
      }
      if (t.id === current.currentTaskId) {
        state = ['error', 'next_task_start_failed'].includes(current.runtimeStatus) ? 'failed' : 'active'
        teachingSessionId = current.currentTeachingId
      }
      lessons.push({ taskId: t.id, title: t.title, milestone: m.title, state, teachingSessionId })
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

/** 全局课程编号（跨里程碑递增） */
export function lessonNumberOf(lessons: LearnLesson[], taskId: string) {
  const idx = lessons.findIndex(l => l.taskId === taskId)
  return idx >= 0 ? idx + 1 : 0
}
