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
    let resumed = false
    try {
      /* 先清课堂内暂停标志，再启自动驾驶（2026-11-09 运营流程核查）：
         teaching.paused 是自动循环的停止信号——只调 autopilotStart 时，循环第一轮就
         markStopped，界面报「已继续」但一行不动。非教学阶段（goal/path 的 created 会话）
         没有这个标志，resume 会 409「仅运行中可恢复」，按「无需清理」吞掉。 */
      await adminVirtualLearnersApi.resumeVirtualSession(run.sessionId)
        .then(() => { resumed = true })
        .catch((e) => {
          if (!String(errMsg(e)).includes('仅运行中可恢复')) throw e
        })
      await adminVirtualLearnersApi.autopilotStart(run.sessionId, { target: 'final' })
      out.done++
    } catch (e) {
      /* 已有全自动运行不算白做：paused 已清时循环会自行接着跑（算「已继续」），
         否则这条本来就在跑，无需动作（算「跳过」）。 */
      if (String(errMsg(e)).includes('已有全自动运行')) {
        if (resumed) out.done++
        else out.skipped++
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
    /* 必须显式 dryRun:false（2026-11-09 运营流程核查）：后端默认 `body.dryRun !== false`
       → 不带该字段时只做「干跑」并返回候选清单，会话仍在跑，而前端照样提示成功。
       批量条（VirtualLearnerBatchBar）一直传的是 dryRun:false，单行这里漏了。 */
    await adminVirtualLearnersApi.terminateVirtualSessions({ profileIds: [profileId], dryRun: false })
    return { done: 1, skipped: 0, failed: 0 }
  } catch (e) {
    console.error('终止会话失败:', errMsg(e))
    return { done: 0, skipped: 0, failed: 1 }
  }
}
