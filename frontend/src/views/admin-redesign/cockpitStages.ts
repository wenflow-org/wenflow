/**
 * 阶段状态机域（SessionCockpit.vue 拆分）：
 * 四阶段推进判定（done/active）+ 进度副标 + 迷你状态；阶段流与 StageKey 在此单源导出。
 * goalConverged 等就绪判定与 currentStage 归一留在 SFC（与 Path 状态机互相纠缠）
 */
import { computed, type ComputedRef } from 'vue'
import { asRecord, numberValue } from './cockpitFormat'
import type { PathMilestoneView } from './cockpitPathViews'
import type { LearnLesson } from './cockpitLessons'

/* 阶段流：后端 currentStage 枚举是 goal/path/teaching，前端归一为 learning */
export const stageFlow = ['goal', 'path', 'learning', 'wrapup'] as const
export type StageKey = (typeof stageFlow)[number]

export function useCockpitStages(deps: {
  currentStage: ComputedRef<string>
  bindings: ComputedRef<Record<string, unknown>>
  stageStatus: ComputedRef<Record<string, Record<string, unknown>>>
  stageResults: ComputedRef<Record<string, unknown>>
  isTerminal: ComputedRef<boolean>
  isFailedTerminal: ComputedRef<boolean>
  hasWrapup: ComputedRef<boolean>
  goalConversationMessages: ComputedRef<Array<{ role: string; content: string }>>
  pathStatusPath: ComputedRef<Record<string, unknown>>
  pathMilestonesView: ComputedRef<PathMilestoneView[]>
  learnLessons: ComputedRef<LearnLesson[]>
}) {
  const {
    currentStage, bindings, stageStatus, stageResults,
    isTerminal, isFailedTerminal, hasWrapup,
    goalConversationMessages, pathStatusPath, pathMilestonesView, learnLessons
  } = deps

  /** 进度条索引：优先 currentStage，并用 bindings 兜底（避免 key 不一致时全「未开始」） */
  const effectiveStageIndex = computed(() => {
    const raw = currentStage.value
    const idx = stageFlow.indexOf(raw as StageKey)
    if (idx >= 0) return idx

    // 后端偶发非标准 stage 时，用绑定证据推断
    if (bindings.value.teachingSessionId || bindings.value.currentTaskId) return 2
    if (bindings.value.learningPathId || stageStatus.value.path?.generated) return 1
    if (bindings.value.goalConversationId) return 0
    return 0
  })

  function stageDone(st: StageKey) {
    const idx = stageFlow.indexOf(st)
    const cur = effectiveStageIndex.value

    // Wrapup 不是会话终态的同义词：只有确实写出总结时才算完成。
    if (st === 'wrapup') return hasWrapup.value
    // 失败终态只确认失败点以前的阶段；当前失败阶段不能伪装成完成。
    if (isFailedTerminal.value && idx === cur) return false
    if (isTerminal.value && idx <= cur) return true
    if (idx < cur) return true
    // 同阶段但已有下游证据时，也标完成（如 learning 时 Goal/Path 已完成）
    if (st === 'goal' && (bindings.value.learningPathId || bindings.value.teachingSessionId || cur >= 1)) return true
    if (st === 'path' && (bindings.value.teachingSessionId || cur >= 2)) return true
    if (st === 'learning' && (isTerminal.value || stageStatus.value.learning?.wrapup)) return true
    return false
  }

  function stageActive(st: StageKey) {
    if (isTerminal.value) {
      return st === 'wrapup'
        ? hasWrapup.value
        : stageFlow.indexOf(st) === effectiveStageIndex.value
    }
    if (stageDone(st) && stageFlow.indexOf(st) !== effectiveStageIndex.value) return false
    return stageFlow.indexOf(st) === effectiveStageIndex.value
  }

  function stageCls(st: string) {
    const key = st as StageKey
    return {
      'cp-stage--done': stageDone(key),
      'cp-stage--active': stageActive(key) && !isTerminal.value
    }
  }

  /* 阶段条进度副标（遗留项 2 C2）：当前阶段显示 x/y 或百分比；数据源不足给空串 */
  const goalRoundText = computed(() => {
    const n = goalConversationMessages.value.length
    if (n) return `对话 ${n} 轮`
    const confidence = numberValue(stageStatus.value.goal?.confidence)
    if (confidence !== null) return `置信度 ${Math.round(confidence * 100)}%`
    return ''
  })
  const pathProgressText = computed(() => {
    const srPath = asRecord(stageResults.value.path)
    const completed = numberValue(srPath.completedMilestones)
      ?? numberValue(pathStatusPath.value.completedMilestones)
      ?? numberValue(stageStatus.value.path?.completedMilestones)
    const total = numberValue(srPath.totalMilestones)
      ?? numberValue(pathStatusPath.value.totalMilestones)
      ?? numberValue(stageStatus.value.path?.totalMilestones)
    if (completed !== null && total) return `${completed}/${total} 里程碑`
    const milestones = pathMilestonesView.value
    if (milestones.length) {
      const done = milestones.filter((m) => m.tasks.length && m.tasks.every((t) => t.completed)).length
      return `${done}/${milestones.length} 里程碑`
    }
    return ''
  })
  const learnProgressText = computed(() => {
    const done = learnLessons.value.filter((l) => l.state === 'done').length
    const total = learnLessons.value.length
    return `课程进度 ${done}/${total}`
  })
  function stageProgress(st: string) {
    const key = st as StageKey
    switch (key) {
      case 'goal':
        return goalRoundText.value
      case 'path':
        return pathProgressText.value
      case 'learning':
        return learnLessons.value.length ? `课程 ${learnLessons.value.filter((l) => l.state === 'done').length}/${learnLessons.value.length}` : ''
      case 'wrapup':
        return hasWrapup.value ? '总结已生成' : ''
      default:
        return ''
    }
  }

  /* 阶段胶囊状态标记：已完成 ✓ / 当前 · / 其他空 */
  function stageMark(st: string) {
    const key = st as StageKey
    if (stageDone(key)) return '✓'
    if (stageActive(key)) return '·'
    return ''
  }

  /** 阶段迷你状态文本 */
  function stageMiniStatus(st: StageKey) {
    if (st === 'goal') {
      const n = goalConversationMessages.value.length
      return n ? `${n} 轮` : (stageDone(st) ? '已收敛' : '')
    }
    if (st === 'path') {
      return pathMilestonesView.value.length ? `${pathMilestonesView.value.length} 个里程碑` : ''
    }
    if (st === 'learning') {
      const done = learnLessons.value.filter(l => l.state === 'done').length
      const total = learnLessons.value.length
      return total ? `${done}/${total}` : ''
    }
    if (st === 'wrapup') {
      return hasWrapup.value ? '已生成' : ''
    }
    return ''
  }

  return {
    effectiveStageIndex, stageDone, stageActive, stageCls, stageMark,
    stageProgress, stageMiniStatus, goalRoundText, pathProgressText, learnProgressText
  }
}
