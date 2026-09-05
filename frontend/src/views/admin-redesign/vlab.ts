/**
 * 仿真域纯逻辑：画像会话推进 / 卡顿判定 / 质量徽章 / 运行历史去重。
 * 与 live.ts 解耦（页面数据映射之外的可测纯函数集中于此）。
 */

/* ---------- 会话阶段推进（V2：Goal → Path → Learn → Wrapup） ---------- */

export const VLAB_STAGES = ['goal', 'path', 'learn', 'wrapup'] as const
export type VlabStage = (typeof VLAB_STAGES)[number]

export const VLAB_STAGE_LABELS: Record<VlabStage, string> = {
  goal: 'Goal',
  path: 'Path',
  learn: 'Learn',
  wrapup: 'Wrapup'
}

/**
 * 后端 currentStage 原文 → 阶段下标（-1 = 无法识别）。
 * goal/path/learn/teaching/wrap 均按前缀归一；识别失败返回 -1（不点亮任何段）。
 */
export function sessionStageIndex(stage: string | null | undefined): number {
  const s = String(stage || '').toLowerCase()
  if (s.includes('wrap')) return 3
  if (s.includes('learn') || s.includes('teach')) return 2
  if (s.includes('path')) return 1
  if (s.includes('goal')) return 0
  return -1
}

/* ---------- 卡顿判定（V2：运行中但长时间无事件 → amber 高亮） ---------- */

/** 运行中会话超过该时长无更新即视为疑似卡顿 */
export const VLAB_STALL_MINUTES = 5

/** 会话推进条的最后一次可见事件时间（latestRun.updatedAt 优先） */
export function latestRunTs(run: { updatedAt?: string | null; createdAt?: string | null } | null | undefined): number {
  if (!run) return 0
  const raw = run.updatedAt || run.createdAt || ''
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * 卡顿状态：仅对运行中会话有意义。
 * - stalled：距最后一次事件超过 VLAB_STALL_MINUTES；
 * - idleMins：距最后一次事件的分钟数（供标题提示）。
 */
export function stallState(
  run: { status?: string; updatedAt?: string | null; createdAt?: string | null } | null | undefined,
  now = Date.now()
): { stalled: boolean; idleMins: number } {
  const running = run && String(run.status || '').toLowerCase() === 'running'
  if (!running) return { stalled: false, idleMins: 0 }
  const ts = latestRunTs(run)
  if (!ts) return { stalled: false, idleMins: 0 }
  const idleMins = Math.floor(Math.max(0, now - ts) / 60000)
  return { stalled: idleMins >= VLAB_STALL_MINUTES, idleMins }
}

/* ---------- 质量徽章（V3：最近一次裁判 / 保真分，数据在会话 stageResults.blackbox） ---------- */

export interface QualityScore {
  label: string
  score: number
  evaluatedAt: string
}

/** 从会话数组提取最近一次的裁判分与保真分（黑盒终局评估，stageResults.blackbox.*Reports） */
export function extractQuality(sessions: Array<Record<string, unknown>>): {
  referee: QualityScore | null
  fidelity: QualityScore | null
} {
  let referee: QualityScore | null = null
  let fidelity: QualityScore | null = null
  for (const s of sessions) {
    const raw = s.stageResults
    const sr = typeof raw === 'string' ? tryParse(raw) : (raw && typeof raw === 'object' ? raw as Record<string, unknown> : null)
    if (!sr) continue
    const bb = (sr.blackbox && typeof sr.blackbox === 'object' ? sr.blackbox as Record<string, unknown> : null)
    if (!bb) continue
    const read = (list: unknown, target: QualityScore | null): QualityScore | null => {
      if (!Array.isArray(list)) return target
      for (const item of list) {
        const r = item as Record<string, unknown>
        if (!r || typeof r !== 'object') continue
        const overall = (r.report as Record<string, unknown> | undefined)?.scores as Record<string, unknown> | undefined
        const score = typeof overall?.overall === 'number' ? overall.overall : null
        if (score === null) continue
        const evaluatedAt = String(r.evaluatedAt || '')
        if (!target || evaluatedAt > target.evaluatedAt) {
          target = { label: '', score, evaluatedAt }
        }
      }
      return target
    }
    referee = read(bb.refereeReports, referee)
    fidelity = read(bb.actorAuditReports, fidelity)
  }
  return { referee, fidelity }
}

function tryParse(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v as Record<string, unknown> : null
  } catch {
    return null
  }
}

/* ---------- 运行历史去重（D1：故事卡=最近摘要，运行 tab=全量） ---------- */

/** 故事卡「运行历史」只展示最近 N 条摘要；其余进「运行」tab 全量视图 */
export const STORY_RUN_RECENT_N = 3

/** 运行 tab 全量列表窗口（详情接口返回最多 200 条会话，取前 50 足够运营扫描） */
export const RUNS_TAB_WINDOW = 50
