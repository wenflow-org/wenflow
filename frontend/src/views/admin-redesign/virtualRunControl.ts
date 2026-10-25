import { adminVirtualLearnersApi } from '@/api/adminApi'
import { errMsg } from './live'

/**
 * 一个人的运行控制单点（2026-10-21 逻辑重整）：
 * 「暂停 / 继续」是自动驾驶的开关（进度与对话保留），「终止」才是结束会话。
 * 行内按钮、批量条、画像页都应从这一处取语义，避免同一个"停"在页面上有三种解释。
 */

/** 一个人每条故事的最新会话（自动驾驶只作用于最新会话） */
export interface LatestRunRef {
  storyId: string
  title: string
  sessionId: string
  status: string
}

const TERMINAL = new Set(['completed', 'abandoned', 'failed'])

export async function latestRunsOf(profileId: string): Promise<LatestRunRef[]> {
  const res = await adminVirtualLearnersApi.getVirtualLearnerStories(profileId)
  const body = res.data?.data ?? res.data ?? {}
  const list = Array.isArray(body.stories) ? (body.stories as Array<Record<string, unknown>>) : []
  return list
    .map((st) => {
      const lr = (st.latestRun || {}) as Record<string, unknown>
      return {
        storyId: String(st.id || ''),
        title: String(st.title || ''),
        sessionId: String(lr.sessionId || ''),
        status: String(lr.status || ''),
      }
    })
    .filter((r) => !!r.sessionId)
}

export interface RunControlResult {
  done: number
  skipped: number
  failed: number
}

/** 暂停：停止这个人所有故事最新会话的自动驾驶（学习进度与对话保留，可再继续） */
export async function pauseAutopilotOf(profileId: string): Promise<RunControlResult> {
  const out: RunControlResult = { done: 0, skipped: 0, failed: 0 }
  for (const run of await latestRunsOf(profileId)) {
    if (TERMINAL.has(run.status)) {
      out.skipped++
      continue
    }
    try {
      await adminVirtualLearnersApi.autopilotStop(run.sessionId)
      out.done++
    } catch (e) {
      out.failed++
      console.error(`会话 ${run.sessionId.slice(0, 8)} 停止自动驾驶失败:`, errMsg(e))
    }
  }
  return out
}

/** 继续：给这个人所有故事的最新会话重新开启自动驾驶（已在跑的不重复启动） */
export async function resumeAutopilotOf(profileId: string): Promise<RunControlResult> {
  const out: RunControlResult = { done: 0, skipped: 0, failed: 0 }
  for (const run of await latestRunsOf(profileId)) {
    if (TERMINAL.has(run.status)) {
      out.skipped++
      continue
    }
    try {
      await adminVirtualLearnersApi.autopilotStart(run.sessionId, { target: 'final' })
      out.done++
    } catch (e) {
      /* 已有全自动运行不是失败：这条已经在跑 */
      if (String(errMsg(e)).includes('已有全自动运行')) {
        out.skipped++
        continue
      }
      out.failed++
      console.error(`会话 ${run.sessionId.slice(0, 8)} 启动自动驾驶失败:`, errMsg(e))
    }
  }
  return out
}

/** 终止：把这个人的未结束会话标记为已放弃（数据保留，不可撤销） */
export async function terminateRunsOf(profileId: string): Promise<RunControlResult> {
  try {
    await adminVirtualLearnersApi.terminateVirtualSessions({ profileIds: [profileId] })
    return { done: 1, skipped: 0, failed: 0 }
  } catch (e) {
    console.error('终止会话失败:', errMsg(e))
    return { done: 0, skipped: 0, failed: 1 }
  }
}
