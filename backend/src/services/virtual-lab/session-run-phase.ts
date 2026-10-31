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
