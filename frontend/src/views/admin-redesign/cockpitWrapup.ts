/**
 * Wrapup / 课时总结域（SessionCockpit.vue 拆分）：
 * 课时 wrapup 结构化（纯函数，真实教学记录降级判定见内注释）+ 会话级 wrapup 分节卡视图 composable
 */
import { computed, type ComputedRef } from 'vue'
import { asRecord, firstText, formatTime, numberValue } from './cockpitFormat'

/** 当前查看课时的 wrapup 总结数据 */
export function buildLessonWrapup(detail: Record<string, unknown> | null) {
  const wrapup = detail?.wrapup
  if (!wrapup || typeof wrapup !== 'object') return null
  const w = wrapup as Record<string, unknown>
  const summary = (w.summary || {}) as Record<string, unknown>
  const evaluation = (w.evaluation || {}) as Record<string, unknown>
  const evidence = (w.evidence || {}) as Record<string, unknown>
  const progress = (w.progress || {}) as Record<string, unknown>
  const learner = (w.learner || {}) as Record<string, unknown>
  const knowledgeItems = Array.isArray(summary.knowledgeItems) ? summary.knowledgeItems as Array<{ name: string; status: string; progress: number; evidence: string }> : []
  const confusionPoints = Array.isArray(evidence.topConfusionPoints) ? evidence.topConfusionPoints as string[] : []
  const highlights = (summary.evaluationHighlights || {}) as Record<string, unknown>
  const emotions = (evidence.emotionalSignals || {}) as Record<string, unknown>
  const sources = (w.sources || {}) as Record<string, unknown>
  const status = String(w.status || '')
  const rawPracticeAdvice = String(summary.practiceAdvice || '')
  // 降级总结：超时/收束失败兜底（summary-only）的 practiceAdvice 是面向学习者的
  // 「重新开始本节…」占位，后台原样展示像在要求管理员重新学习 → 标记降级并隐藏该占位。
  const degraded = status === 'summary-only'
    || String(sources.summary || '').includes('fallback')
    || /重新开始本节|重新完成一次完整的学习/.test(rawPracticeAdvice)
  return {
    status,
    degraded,
    duration: numberValue(w.duration),
    topicSummary: String(summary.topicSummary || ''),
    knowledgeSummary: String(summary.knowledgeSummary || ''),
    practiceAdvice: degraded ? '' : rawPracticeAdvice,
    learningEvaluation: String(summary.learningEvaluation || ''),
    keyTakeaways: Array.isArray(summary.keyTakeaways) ? summary.keyTakeaways as string[] : [],
    actionPlan: Array.isArray(summary.actionPlan) ? summary.actionPlan as string[] : [],
    knowledgeItems,
    confusionPoints,
    strengths: Array.isArray(highlights.strengths) ? highlights.strengths as string[] : [],
    improvements: Array.isArray(highlights.improvements) ? highlights.improvements as string[] : [],
    lss: numberValue(evaluation.sessionLss),
    ktl: numberValue(evaluation.sessionKtl),
    lf: numberValue(evaluation.sessionLf),
    turnCount: numberValue(evidence.turnCount),
    avgUnderstanding: numberValue(evidence.avgUnderstanding),
    avgEngagement: numberValue(evidence.avgEngagement),
    dominantCognitiveLevel: String(evidence.dominantCognitiveLevel || ''),
    lastCognitiveLevel: String(evidence.lastCognitiveLevel || ''),
    positiveEmotions: numberValue(emotions.positive) || 0,
    neutralEmotions: numberValue(emotions.neutral) || 0,
    frustratedEmotions: numberValue(emotions.frustrated) || 0,
    confusedEmotions: numberValue(emotions.confused) || 0,
    fatigueRisk: String(learner.fatigueRisk || ''),
    recommendedPacing: String(learner.recommendedPacing || ''),
    newlyMastered: Array.isArray(progress.newlyMastered) ? progress.newlyMastered as string[] : [],
  }
}

export function useCockpitWrapup(
  stageResults: ComputedRef<Record<string, unknown>>,
  stageStatus: ComputedRef<Record<string, Record<string, unknown>>>,
  isRealMode: ComputedRef<boolean>
) {
  const hasWrapup = computed(() => {
    const teaching = (stageResults.value.teaching || {}) as Record<string, unknown>
    return !!(stageStatus.value.learning?.wrapup || teaching.wrapup)
  })

  /* Wrapup 分页内容：summary/evaluation 结构化对象 → 字段卡（C4/遗留项 2），字符串保持原样 */
  const wrapupObject = computed(() => {
    const learning = asRecord(stageResults.value.teaching)
    return asRecord(learning.wrapup || stageStatus.value.learning?.wrapup)
  })
  const wrapupSections = computed(() => {
    const wrapup = wrapupObject.value
    if (!Object.keys(wrapup).length) return [] as Array<{ label: string; text: string; isJson: boolean }>
    const render = (value: unknown) => typeof value === 'string'
      ? { text: value, isJson: false }
      : { text: JSON.stringify(value, null, 2), isJson: true }
    const sections: Array<{ label: string; text: string; isJson: boolean }> = []
    // 结构化对象由字段卡承载，字符串走分节卡
    if (typeof wrapup.summary === 'string') sections.push({ label: '学习总结', ...render(wrapup.summary) })
    if (typeof wrapup.evaluation === 'string') sections.push({ label: '评估', ...render(wrapup.evaluation) })
    const generatedAt = firstText(wrapup.generatedAt)
    if (generatedAt) sections.push({ label: '生成时间', text: formatTime(generatedAt), isJson: false })
    return sections
  })

  /* 终局评估区 wrapup 评价字段卡：评价/评估摘要/来源徽章 */
  const wrapupFieldCards = computed(() => {
    const wrapup = wrapupObject.value
    const cards: Array<{ label: string; value: string }> = []
    const summary = wrapup.summary
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      const s = summary as Record<string, unknown>
      const labels: Record<string, string> = {
        topicSummary: '主题摘要',
        knowledgeSummary: '知识总结',
        practiceAdvice: '练习建议',
        learningEvaluation: '学习评估'
      }
      for (const [key, label] of Object.entries(labels)) {
        const v = s[key]
        if (typeof v === 'string' && v.trim()) cards.push({ label, value: v.trim() })
      }
    }
    const evaluation = wrapup.evaluation
    if (evaluation && typeof evaluation === 'object' && !Array.isArray(evaluation)) {
      const e = evaluation as Record<string, unknown>
      for (const [key, value] of Object.entries(e)) {
        if (key === 'summary') continue
        if (typeof value === 'string' && value.trim()) cards.push({ label: `评估 · ${key}`, value: value.trim() })
      }
      const evaluationSummary = firstText(e.summary, e.verdict, e.conclusion)
      if (evaluationSummary) cards.push({ label: '评估摘要', value: evaluationSummary })
    }
    return cards
  })
  const wrapupSourceBadge = computed(() => {
    const sources = asRecord(wrapupObject.value.sources)
    return sources.summary === 'model' ? '模型生成' : sources.summary === 'rule' || sources.summary ? '规则回退' : ''
  })
  const wrapupStatusBadge = computed(() => String(wrapupObject.value.status || ''))
  const wrapupEmptyHint = computed(() =>
    isRealMode.value
      ? '该真实会话未生成总结（无 wrapup 记录）。'
      : '尚无学习总结。Learn 产生进度后点击「生成总结」。'
  )
  return {
    hasWrapup, wrapupObject, wrapupSections, wrapupFieldCards,
    wrapupSourceBadge, wrapupStatusBadge, wrapupEmptyHint
  }
}
