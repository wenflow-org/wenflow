/**
 * 阶段状态机域（SessionCockpit.vue 拆分）：
 * 四阶段推进判定（done/active）+ 进度副标 + 迷你状态；阶段流与 StageKey 在此单源导出。
 * goalConverged 等就绪判定与 currentStage 归一留在 SFC（与 Path 状态机互相纠缠）
 */
import { computed, type ComputedRef } from 'vue'
import { asRecord, numberValue } from './cockpitFormat'
import type { PathMilestoneView } from './cockpitPathViews'
import { countDoneLessons, type LearnLesson } from './cockpitLessons'

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
  /** 中断类终态（failed/abandoned/timeout/finalization_failed/discarded/superseded，#135） */
  isInterruptedTerminal: ComputedRef<boolean>
  hasWrapup: ComputedRef<boolean>
  goalConversationMessages: ComputedRef<Array<{ role: string; content: string }>>
  pathStatusPath: ComputedRef<Record<string, unknown>>
  pathMilestonesView: ComputedRef<PathMilestoneView[]>
  learnLessons: ComputedRef<LearnLesson[]>
}) {
  const {
    currentStage, bindings, stageStatus, stageResults,
    isTerminal, isFailedTerminal, isInterruptedTerminal, hasWrapup,
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
    // 中断终态只确认中断点以前的阶段；当前中断阶段不能伪装成完成（#135：timeout/
    // finalization_failed/discarded/superseded 同 failed/abandoned 口径）。
    if ((isFailedTerminal.value || isInterruptedTerminal.value) && idx === cur) return false
    if (isTerminal.value && idx <= cur) return true
    if (idx < cur) return true
    // 同阶段但已有下游证据时，也标完成（如 learning 时 Goal/Path 已完成）
    if (st === 'goal' && (bindings.value.learningPathId || bindings.value.teachingSessionId || cur >= 1)) return true
    if (st === 'path' && (bindings.value.teachingSessionId || cur >= 2)) return true
    // 终止 ≠ 学完：abandoned / failed 可以在任意阶段终止，不能因为「会话已结束」就把
    // Learn 标成完成——已放弃的会话停在 Path 时，Learn 会既打勾又写 0/6 课已完成，
    // 阶段条出现「后一阶段已完成、前一阶段仍进行中」（2026-10-08 走查 d-session-vl）。
    // 正常完成的情形已由上面的 isTerminal && idx<=cur 与 idx<cur 覆盖，
    // 这里只保留「确实写出了总结」这一明确证据。
    // 2026-10-19：判据改用注入的 hasWrapup（与总结卡同一份：读 stageStatus.learning.wrapup
    // 与 stageResults.teaching.wrapup 两处字段）——原先这里只读前一个字段，于是「总结卡有内容、
    // 学习瓦片没打勾」可以同屏出现（两个证据字段一真一假时）。
    if (st === 'learning' && hasWrapup.value) return true
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

  /* 阶段条进度副标（遗留项 2 C2）：当前阶段显示 x/y 或百分比；数据源不足给空串。
     口径（2026-10-06 审核 §主题 4）：`goalConversationMessages` 含平台回复，数全量会把
     「2 学习者发言 + 2 平台回复」说成「对话 4 轮」，与同卡 statstrip 的「已用回合」
     （只数 user）打架。改为只数学习者发言并显式命名，两处读数同源可比。 */
  const goalRoundText = computed(() => {
    const n = goalConversationMessages.value.filter((m) => m.role === 'user').length
    if (n) return `学习者发言 ${n}`
    const confidence = numberValue(stageStatus.value.goal?.confidence)
    if (confidence !== null) return `置信度 ${Math.round(confidence * 100)}%`
    return ''
  })
  const pathProgressText = computed(() => {
    /* 2026-10-12 用户走查：整阶段收齐才 +1 的「0/4 里程碑」读作死的（走查原话「为什么不动态」
       ——明明已完成 2/13 个任务）。步点副标优先走子任务动态读数「任务 d/t」（与 Learn 课树
       同源）；载荷只给概要时退后端计数，里程碑视图/计数是最后兜底（终态会话保持旧读数）。 */
    const tasks = pathMilestonesView.value.flatMap((m) => m.tasks)
    if (tasks.length) return `任务 ${tasks.filter((t) => t.completed).length}/${tasks.length}`
    const srPath = asRecord(stageResults.value.path)
    const doneTasks = numberValue(pathStatusPath.value.completedTasks) ?? numberValue(srPath.completedTasks)
      ?? numberValue(stageStatus.value.path?.completedTasks)
    const totalTasks = numberValue(pathStatusPath.value.totalTasks) ?? numberValue(srPath.totalTasks)
      ?? numberValue(stageStatus.value.path?.totalTasks)
    if (doneTasks !== null && totalTasks) return `任务 ${doneTasks}/${totalTasks}`
    const completedMilestones = numberValue(pathStatusPath.value.completedMilestones)
      ?? numberValue(srPath.completedMilestones)
      ?? numberValue(stageStatus.value.path?.completedMilestones)
    const totalMilestones = numberValue(pathStatusPath.value.totalMilestones)
      ?? numberValue(srPath.totalMilestones)
      ?? numberValue(stageStatus.value.path?.totalMilestones)
    if (completedMilestones !== null && totalMilestones) return `${completedMilestones}/${totalMilestones} 里程碑`
    const milestones = pathMilestonesView.value
    if (milestones.length) {
      const doneMilestones = milestones.filter((m) => m.tasks.length && m.tasks.every((t) => t.completed)).length
      return `${doneMilestones}/${milestones.length} 里程碑`
    }
    return ''
  })
  const learnProgressText = computed(() => {
    const done = countDoneLessons(learnLessons.value)
    const total = learnLessons.value.length
    return `课程进度 ${done}/${total}`
  })
  /** 阶段步点副标：stepper 是「阶段推进」轴，读数是阶段汇总，须显式命名口径。
      2026-10-12：Path 步点已改读子任务完成数（内容轴，同源同数），本格若仍读
      「课已完成」就与 Path 步点同数同义（同屏两个 2/13）——改读**课堂覆盖**：
      实际开始过的课（有课堂会话或已完成），对应 Learn 页签「课堂对话」的身份。 */
  const learnStageRollupText = computed(() => {
    const list = learnLessons.value
    if (!list.length) return ''
    const started = list.filter((l) => l.teachingSessionId || l.state === 'done').length
    return `已开始 ${started}/${list.length} 课`
  })
  /* 总结按课走（2026-10-19 用户走查「总结是按课走的，已生成应该也是按课程走吧」）：
     一节课一份总结，阶段读数不能只说「已生成」这一个有/无的事实。判据与课程映射同源——
     buildLearnLessons 为每节课挑出「有总结的那条会话」（completed / timeout /
     finalization_failed）；当前课堂的总结已落库、但历史条目尚未带终态时，按
     teachingSessionId 补记这一节，避免出现「总结卡有内容、步点却数不到它」。 */
  const wrapupLessonStat = computed(() => {
    const list = learnLessons.value
    const currentId = String(bindings.value.teachingSessionId || '')
    const done = list.filter(
      (l) => l.hasSummary || (hasWrapup.value && !!currentId && l.teachingSessionId === currentId)
    ).length
    return { done, total: list.length }
  })
  function stageProgress(st: string) {
    const key = st as StageKey
    switch (key) {
      case 'goal':
        return goalRoundText.value
      case 'path':
        return pathProgressText.value
      case 'learning':
        return learnStageRollupText.value
      case 'wrapup': {
        const { done, total } = wrapupLessonStat.value
        if (total && done) return `已生成 ${done}/${total} 课`
        return hasWrapup.value ? '总结已生成' : ''
      }
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
      /* 2026-10-31 三轮评审 P1：原 `${全量消息数} 轮` 把「5 学习者发言 + 5 平台回复」
         说成「目标 10 轮」，与步点副标「学习者发言 N」同屏打架。统一读 goalRoundText。 */
      return goalRoundText.value || (stageDone(st) ? '已完成' : '')
    }
    if (st === 'path') {
      return pathMilestonesView.value.length ? `${pathMilestonesView.value.length} 个里程碑` : ''
    }
    if (st === 'learning') {
      const done = countDoneLessons(learnLessons.value)
      const total = learnLessons.value.length
      return total ? `${done}/${total}` : ''
    }
    if (st === 'wrapup') {
      const { done, total } = wrapupLessonStat.value
      if (total && done) return `${done}/${total}`
      return hasWrapup.value ? '已生成' : ''
    }
    return ''
  }

  return {
    effectiveStageIndex, stageDone, stageActive, stageCls, stageMark,
    stageProgress, stageMiniStatus, goalRoundText, pathProgressText, learnProgressText
  }
}
