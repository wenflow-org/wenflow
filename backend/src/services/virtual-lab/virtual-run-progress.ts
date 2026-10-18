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
  /** running = 真在跑；paused = 自动驾驶已暂停（会话仍是 running，但无写入是预期） */
  state: 'running' | 'paused'
  currentStage: string | null
  /** 超过回收阈值无写入（与「无响应」列同源；暂停会话恒 false） */
  stalled: boolean
}

/** 「进行中」列逐条展示上限：再多会给行高带来噪声，余量用「另有 N 条」披露 */
export const ACTIVE_RUNS_LIMIT = 3

export function parseStageResults(raw: unknown): Record<string, any> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, any>
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
    state,
    currentStage: session.currentStage ? String(session.currentStage) : null,
    ...deriveRunProgress(session),
    stalled: state === 'running' && stalledIds.has(session.id),
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
