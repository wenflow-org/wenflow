/**
 * 黑盒评估 / 裁判痕迹 / 三流统一时间线域（SessionCockpit.vue 拆分）：
 * 类型与纯展示助手 + 痕迹状态 composable（parseBlackbox / 轨迹视图 / 统一时间线）
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { parseLogEntry } from './sessionLog'
import { traceSummaryRows, traceRawJson, type TraceKeyValue } from './traceSummary'

export interface EvaluationReport {
  id?: string
  evaluatedAt?: string
  report?: {
    verdict?: string
    scores?: Record<string, number | null>
    findings?: Array<{
      code: string
      severity: string
      title: string
      detail: string
      evidenceIds?: Array<string | number>
    }>
    recommendations?: Array<{
      priority?: string
      action?: string
      rationale?: string
      findingCodes?: Array<string | number>
    }>
    evidence?: Array<{
      id?: string | number
      source?: string
      index?: number | null
      path?: string
      excerpt?: string
      interpretation?: string
    }>
  }
}

export interface RefereeTraceItem {
  timestamp: string
  traceId: string | null
  diagnostic: Record<string, unknown> | null
}

export interface PrivateStateTraceItem {
  sequence?: number
  stage: 'goal' | 'learning'
  taskId?: string | null
  transition?: string | null
  emotion?: string | null
  phaseFocus?: string | null
  degraded?: boolean
  visibleSignal?: string | null
  stateChangeReason?: string | null
  metrics?: Record<string, number>
  flags?: Record<string, boolean>
  blockers?: string[]
  generatedAt?: string | null
}

export interface TimelineEntry {
  time: string
  kind: string
  kindLabel: string
  stage: string
  title: string
  detail: string
}

export function timelineKindLabel(kind: string): string {
  const map: Record<string, string> = {
    referee: '裁判',
    private: '私有状态',
    log: '日志',
    goal: '目标对话',
    path: '路径',
    teaching: '课堂',
    evidence: '证据'
  }
  return map[kind] || kind
}

/* 评估报告展示助手 */
export function verdictLabel(verdict?: string) {
  if (!verdict) return '未生成'
  const map: Record<string, string> = {
    pass: '通过', pass_with_concerns: '有条件通过',
    fail: '失败', inconclusive: '证据不足',
    credible: '可信', credible_with_concerns: '基本可信',
    invalid: '无效'
  }
  return map[verdict] || verdict
}

export function scoreItems(scores: Record<string, number | null>, kind: 'referee' | 'actor') {
  const labels = kind === 'referee'
    ? [['goalExperience', 'Goal 体验'], ['pathExperience', 'Path 体验'], ['teachingExperience', 'Teaching 体验'], ['controlConsistency', '控制一致'], ['boundaryIntegrity', '边界完整'], ['evidenceSufficiency', '证据充分']]
    : [['personaConsistency', '画像一致'], ['storyConsistency', '故事一致'], ['disclosureDiscipline', '披露节奏'], ['frictionCalibration', '摩擦校准'], ['stateContinuity', '状态连续'], ['behaviorPlausibility', '行为可信'], ['evidenceSufficiency', '证据充分']]
  return labels.map(([key, label]) => ({ label, value: scores[key] ?? null }))
}

export function findingEvidence(report: EvaluationReport, finding: { evidenceIds?: Array<string | number> }) {
  const ids = new Set(Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [])
  return (Array.isArray(report.report?.evidence) ? report.report.evidence : []).filter((e) => ids.has(e.id as never))
}

export interface RefereeTraceView {
  item: RefereeTraceItem
  rows: TraceKeyValue[]
  rawJson: string
}

export function useCockpitTraces(
  stageResults: ComputedRef<Record<string, unknown>>,
  isRealMode: ComputedRef<boolean>,
  rawLogs: Ref<Record<string, unknown>[]>
) {
  const refereeReports = ref<EvaluationReport[]>([])
  const actorAuditReports = ref<EvaluationReport[]>([])
  const refereeTrace = ref<RefereeTraceItem[]>([])
  const refereeTraceCount = ref(0)
  const privateStateTrace = ref<PrivateStateTraceItem[]>([])
  const privateStateTraceCount = ref(0)

  function parseBlackbox() {
    const bb = (stageResults.value.blackbox || {}) as Record<string, unknown>
    // 平台质量裁判与角色保真审计（结构化报告）
    refereeReports.value = Array.isArray(bb.refereeReports) ? bb.refereeReports as EvaluationReport[] : []
    actorAuditReports.value = Array.isArray(bb.actorAuditReports) ? bb.actorAuditReports as EvaluationReport[] : []
    // 裁判旁路诊断轨迹
    const rawRefereeTrace = Array.isArray(bb.refereeTrace) ? bb.refereeTrace : []
    refereeTrace.value = rawRefereeTrace as RefereeTraceItem[]
    refereeTraceCount.value = rawRefereeTrace.length
    // 角色私有状态轨迹
    const rawPrivateTrace = Array.isArray(bb.learnerPrivateStateTrace) ? bb.learnerPrivateStateTrace : []
    privateStateTrace.value = rawPrivateTrace as PrivateStateTraceItem[]
    privateStateTraceCount.value = rawPrivateTrace.length
  }

  /* 裁判轨迹视图：键值摘要行 + 原文 JSON（C3，展开不丢原始数据） */
  const refereeTraceViews = computed<RefereeTraceView[]>(() =>
    refereeTrace.value.map((item) => ({
      item,
      rows: traceSummaryRows(item.diagnostic),
      rawJson: traceRawJson(item.diagnostic)
    }))
  )

  /* 裁判/私有轨迹流任一存在才展示统一时间线（仅日志时与会话日志卡重复） */
  const hasTraceFlows = computed(() => refereeTrace.value.length > 0 || privateStateTrace.value.length > 0)

  /* 统一时间线（遗留项 2）：三流合并（裁判诊断 / 私有状态 / 会话日志），按时间升序单轴 */
  const unifiedTimeline = computed<TimelineEntry[]>(() => {
    // 真实模式：后端合成时间线已由日志卡承载（同屏对照简化版），此面板仅服务虚拟三流合并
    if (isRealMode.value) return []
    const entries: TimelineEntry[] = []
    for (const item of refereeTrace.value) {
      entries.push({
        time: item.timestamp || '',
        kind: 'referee',
        kindLabel: timelineKindLabel('referee'),
        stage: 'learning',
        title: `裁判诊断${item.traceId ? ` · ${item.traceId.slice(0, 8)}` : ''}`,
        detail: traceSummaryRows(item.diagnostic).map((r) => `${r.label}: ${r.value}`).join(' · ')
      })
    }
    for (const item of privateStateTrace.value) {
      entries.push({
        time: item.generatedAt || '',
        kind: 'private',
        kindLabel: timelineKindLabel('private'),
        stage: item.stage || '',
        title: `${item.transition || '状态'}${item.emotion ? ` · ${item.emotion}` : ''}`,
        detail: [item.phaseFocus, item.visibleSignal, item.stateChangeReason]
          .filter((v): v is string => !!v && typeof v === 'string')
          .join(' · ')
      })
    }
    for (const raw of rawLogs.value) {
      const ts = String(raw.timestamp || raw.createdAt || '')
      const view = parseLogEntry(raw)
      entries.push({
        time: ts,
        kind: 'log',
        kindLabel: timelineKindLabel('log'),
        stage: view.phase,
        title: view.text || view.phase || '会话日志',
        detail: ''
      })
    }
    return entries
      .filter((e) => !!e.time)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .slice(-200)
  })

  function resetTraces() {
    refereeReports.value = []
    actorAuditReports.value = []
    refereeTrace.value = []
    refereeTraceCount.value = 0
    privateStateTrace.value = []
    privateStateTraceCount.value = 0
  }

  return {
    refereeReports, actorAuditReports, refereeTrace, refereeTraceCount,
    privateStateTrace, privateStateTraceCount, parseBlackbox, refereeTraceViews,
    hasTraceFlows, unifiedTimeline, resetTraces
  }
}
