/**
 * 虚拟学习者列表「进行中」列的多会话进度（2026-10-18 用户走查）。
 *
 * 背景：一个虚拟学习者可以同时跑多条路径（多故事各自一条会话），列表此前只取
 * 「运行中 [0]」画一条阶段条，第二条起在界面上不存在。这里把会话行映射成
 * 逐条活跃会话（运行在前、暂停在后），前端按行渲染；任务数另成一列。
 *
 * 纯函数、无 IO：阈值判定（无响应）由调用方传入 id 集合，避免把回收口径复制两份。
 */

export interface VirtualRunSession {
  id: string
  status?: string | null
  currentStage?: string | null
  stageResults?: unknown
  goalConversationId?: string | null
  learningPathId?: string | null
  currentTaskId?: string | null
  completedTasks?: number | null
  totalTasks?: number | null
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
}

/** Goal / Path / Learn 三态 + 任务完成数（与列表原有 stageProgress 同口径） */
export interface VirtualRunProgress {
  goalReady: boolean
  pathReady: boolean
  learnStarted: boolean
  taskDone: number
  taskTotal: number
}

export interface VirtualActiveRun extends VirtualRunProgress {
  sessionId: string
  /** 这条运行在做哪条学习路径（null = 还没产出路径的早期阶段运行） */
  pathId: string | null
  /** running = 真在跑；paused = 自动驾驶已暂停（会话仍是 running，但无写入是预期） */
  state: 'running' | 'paused'
  currentStage: string | null
  /** 超过回收阈值无写入（与「无响应」列同源；暂停会话恒 false） */
  stalled: boolean
}

/** 「进行中」列逐条展示上限：再多会给行高带来噪声，余量用「另有 N 条」披露 */
export const ACTIVE_RUNS_LIMIT = 3

/** stageResults 是驱动器/模型写入的自由 JSON：只声明读侧用到的分支，其余键保持 unknown */
export interface StageResultsShape {
  goal?: { converged?: unknown; finalStage?: unknown; stage?: unknown }
  path?: { success?: unknown }
  teaching?: { teachingSessionId?: unknown }
  autopilot?: { status?: unknown }
  [key: string]: unknown
}

export function parseStageResults(raw: unknown): StageResultsShape {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as StageResultsShape
  try {
    return JSON.parse(String(raw))
  } catch {
    return {}
  }
}

/** 管理员暂停了自动驾驶（autopilot.status=stopped）：会话仍属 running，但不算「在跑」 */
export function isAutopilotPaused(session: VirtualRunSession): boolean {
  return parseStageResults(session.stageResults)?.autopilot?.status === 'stopped'
}

/** 单条会话的 Goal/Path/Learn 累计进度（历史行与活跃行共用，避免两套判据） */
export function deriveRunProgress(session: VirtualRunSession): VirtualRunProgress {
  const sr = parseStageResults(session.stageResults)
  return {
    goalReady: !!(sr?.goal?.converged || sr?.goal?.finalStage || sr?.goal?.stage === 'completed' || session.goalConversationId),
    pathReady: !!(sr?.path?.success || session.learningPathId),
    learnStarted: !!(
      sr?.teaching?.teachingSessionId
      || session.currentTaskId
      || session.currentStage === 'teaching'
      || session.currentStage === 'learn'
    ),
    taskDone: Number(session.completedTasks) || 0,
    taskTotal: Number(session.totalTasks) || 0,
  }
}

function updatedMs(session: VirtualRunSession): number {
  const raw = session.updatedAt || session.createdAt
  if (!raw) return 0
  const t = new Date(raw instanceof Date ? raw : String(raw)).getTime()
  return Number.isFinite(t) ? t : 0
}

function toRun(session: VirtualRunSession, state: 'running' | 'paused', stalledIds: ReadonlySet<string>): VirtualActiveRun {
  return {
    sessionId: session.id,
    pathId: session.learningPathId ? String(session.learningPathId) : null,
    state,
    currentStage: session.currentStage ? String(session.currentStage) : null,
    ...deriveRunProgress(session),
    stalled: state === 'running' && stalledIds.has(session.id),
  }
}

/** 一条历史运行（按学习路径归并后的最近一次） */
export interface VirtualRecentRun extends VirtualRunProgress {
  sessionId: string
  /** null = 还没产出路径的阶段（目标阶段）运行 */
  pathId: string | null
  status: string | null
  currentStage: string | null
  updatedAt: string | null
}

/**
 * 没有活跃运行时的历史摘要：**按学习路径归并**，每条路径只取最近一次运行。
 *
 * 为什么按路径而不是按会话：一个虚拟学习者可以有多条目标/路径（故事是复杂情景，一次运行
 * 产出一条路径，同一路径可反复跑），列表若只取「最近一条会话」，多路径学习者看起来只有
 * 一条线，另一条路径上跑到哪一步完全不可见。同一路径的多次运行（多节课/重跑）只显示最近那次，
 * 完整历史留给画像页。
 *
 * 按 learningPathId 分组，null（尚未产出路径的目标阶段运行）单独一组；
 * 组内取 updatedAt 最近的一条；组间按最近时间倒序。返回前 limit 条与组总数（前端用总数出「+N」）。
 */
export function deriveRecentRuns(
  sessions: ReadonlyArray<VirtualRunSession>,
  limit = 3
): { runs: VirtualRecentRun[]; total: number } {
  const byKey = new Map<string, VirtualRunSession>()
  for (const s of sessions) {
    const key = s.learningPathId ? `path:${s.learningPathId}` : 'goal'
    const prev = byKey.get(key)
    if (!prev || updatedMs(s) > updatedMs(prev)) byKey.set(key, s)
  }
  const ordered = [...byKey.values()].sort((a, b) => updatedMs(b) - updatedMs(a))
  const cap = Math.max(1, limit)
  return {
    total: ordered.length,
    runs: ordered.slice(0, cap).map((s) => ({
      sessionId: s.id,
      pathId: s.learningPathId ? String(s.learningPathId) : null,
      status: s.status ? String(s.status) : null,
      currentStage: s.currentStage ? String(s.currentStage) : null,
      updatedAt: s.updatedAt ? new Date(s.updatedAt as string | Date).toISOString() : null,
      ...deriveRunProgress(s)
    }))
  }
}

/**
 * 活跃会话（running + 自动驾驶已暂停）：运行在前、暂停在后；同状态按最近写入倒序。
 * 只返回传入样本里能看到的会话；窗口外的总量由调用方用 activeRunTotal 与长度差披露。
 */
export function deriveActiveRuns(
  sessions: ReadonlyArray<VirtualRunSession>,
  stalledIds: ReadonlySet<string> = new Set(),
  limit = ACTIVE_RUNS_LIMIT
): VirtualActiveRun[] {
  const live = sessions.filter((s) => String(s.status || '') === 'running')
  const running = live
    .filter((s) => !isAutopilotPaused(s))
    .sort((a, b) => updatedMs(b) - updatedMs(a))
    .map((s) => toRun(s, 'running', stalledIds))
  const paused = live
    .filter((s) => isAutopilotPaused(s))
    .sort((a, b) => updatedMs(b) - updatedMs(a))
    .map((s) => toRun(s, 'paused', stalledIds))
  const cap = Math.max(1, limit)
  return [...running, ...paused].slice(0, cap)
}
