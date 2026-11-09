/**
 * 一条会话「在不在跑」的唯一判定（2026-10-21 口径统一）。
 *
 * 背景：列表曾用 virtual_sessions.status 回答「跑不跑」，但 status 只在新会话生成完路径后
 * 才写成 running——新会话在 goal/path 阶段是 created，即使自动驾驶正在推进也会被判成「已停止」；
 * 同一批 created 会话放久了又会被 stale 查询算成「无响应」。同一件事三种读数。
 *
 * 现在：autopilot 状态是唯一真值，updatedAt 只用来分「在跑」与「卡住」：
 *   queued / running + 心跳新     → running
 *   queued / running + 超阈值无写入 → stalled（无响应）
 *   stopped                      → paused（用户暂停，进度保留）
 *   teaching.paused              → paused（管理员在课堂里暂停，不是无响应）
 *   其余（idle / completed / failed / incomplete，或已是终态） → idle（没在跑）
 */
import { safeJsonParse } from '../../utils/safe-json'

export type SessionRunPhase = 'running' | 'paused' | 'stalled' | 'idle'

export interface SessionRunInput {
  status?: string | null
  stageResults?: string | null
  updatedAt?: Date | string | null
}

const TERMINAL_SESSION_STATUS = new Set(['completed', 'failed', 'abandoned'])
const LIVE_AUTOPILOT = new Set(['queued', 'running'])

export function classifySessionRunPhase(session: SessionRunInput, staleBefore: Date): SessionRunPhase {
  if (TERMINAL_SESSION_STATUS.has(String(session.status || ''))) return 'idle'
  const parsed = safeJsonParse<{ autopilot?: { status?: string }; teaching?: { paused?: boolean } }>(
    String(session.stageResults || ''),
    {}
  )
  const autopilot = String(parsed?.autopilot?.status || '')
  if (autopilot === 'stopped') return 'paused'
  if (parsed?.teaching?.paused === true) return 'paused'
  if (!LIVE_AUTOPILOT.has(autopilot)) return 'idle'
  const updated = new Date(String(session.updatedAt || 0)).getTime()
  if (!Number.isFinite(updated)) return 'running'
  return updated < staleBefore.getTime() ? 'stalled' : 'running'
}

/* 自动驾驶的 lastError 里哪些不算「异常」：
   进程重启/对账收敛是系统自愈动作，stopRequested/已暂停/手动停止/排队中被取消是运营主动停的
   （那属于 paused，不是故障）。剩下的（渠道 503、goal 未收敛、no_progress_watchdog…）才是要报的。 */
const EXPECTED_AUTOPILOT_ERROR = /进程重启|对账收敛|stopRequested|已暂停|手动停止|排队中被取消/

/** 非终态会话上「最近一次真正的自动驾驶故障」；预期态返回 null。
    调用方需自己限定会话范围（非终态），本函数只做错误串判读。 */
export function readAutopilotError(stageResults: string | null | undefined): string | null {
  const parsed = safeJsonParse<{ autopilot?: { lastError?: string | null } }>(
    String(stageResults || ''),
    {}
  )
  const err = parsed?.autopilot?.lastError
  if (typeof err !== 'string' || !err.trim()) return null
  return EXPECTED_AUTOPILOT_ERROR.test(err) ? null : err
}

/**
 * 逐画像汇总「最近一次自动驾驶故障」（列表「异常」列用）。
 *
 * 输入必须是**非终态**会话全集（findLiveSessionsByProfiles / findLiveSessionsAll），
 * 不能只用 status='running' 的会话：新会话在 goal/path 阶段是 created，自动驾驶在那里
 * 失败（如渠道 503）时 status 永远不会变成 running，错误就丢了（2026-11-09 运营流程核查）。
 * 同一画像多条会话都有错误时按传入顺序取第一条，保证列表读数稳定。
 */
export function collectAutopilotErrors(
  sessions: Array<{ virtualProfileId?: string | null; stageResults?: string | null }>
): Map<string, string> {
  const byProfile = new Map<string, string>()
  for (const session of sessions) {
    const profileId = session.virtualProfileId
    if (!profileId || byProfile.has(profileId)) continue
    const err = readAutopilotError(session.stageResults)
    if (err) byProfile.set(profileId, err)
  }
  return byProfile
}
