/**
 * 全自动/自动驾驶域（SessionCockpit.vue 拆分）：
 * stageResults.autopilot 状态族 + 启动可用性 + 结果文案 + 「运行状态」卡健康档
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import { asRecord, firstText } from './cockpitFormat'
import { runHealthTone } from './statusText'

export function useCockpitAutopilot(
  stageResults: ComputedRef<Record<string, unknown>>,
  session: Ref<Record<string, unknown> | null>,
  busy: Ref<boolean>,
  isTerminal: ComputedRef<boolean>,
  isPaused: ComputedRef<boolean>,
  runLifecycleState: ComputedRef<string>
) {
  /* ===== 全自动模式：以最终目标（Path 全部完成）为终点的无人值守运行 ===== */
  const autopilot = computed(() => asRecord(stageResults.value.autopilot) as {
    status?: string
    mode?: string
    steps?: number
    lastStage?: string | null
    lastError?: string | null
    startedAt?: string
    completedAt?: string
    stopRequested?: boolean
    queuePosition?: number | null
  })
  // stopRequested=true 表示已请求停止（可能主循环已死未消费）：视为未运行，
  // 否则会出现「已停止却仍显示停止自动驾驶按钮」的悬挂态（按钮点了没反应）
  const autopilotRunning = computed(() => autopilot.value.status === 'running' && autopilot.value.stopRequested !== true)
  const autopilotStopping = computed(() => autopilot.value.status === 'running' && autopilot.value.stopRequested === true)
  const autopilotQueued = computed(() => autopilot.value.status === 'queued')
  const autopilotStartDisabled = computed(() => {
    if (!session.value) return true
    if (busy.value) return true
    if (isTerminal.value) return true
    return autopilotRunning.value || autopilotQueued.value
  })
  const autopilotStartTitle = computed(() => {
    if (!session.value) return '会话仍在加载'
    if (isTerminal.value) return '会话已终态，无需启动全自动'
    if (autopilotRunning.value) return '全自动正在进行中'
    return '自动驾驶：后台持续推进，直达 Path 全部任务完成（每课回合数受「每课回合上限」约束；可随时「停止自动驾驶」暂停，进度保留）'
  })
  const autopilotResultText = computed(() => {
    const st = autopilot.value.status
    if (st === 'completed') return '✅ 全部完成：Path 所有任务已跑完'
    if (st === 'failed') return `❌ 运行失败：${firstText(autopilot.value.lastError) || '未知原因'}`
    if (st === 'incomplete') return `⚠️ 未完成（疑似教学卡死）：${firstText(autopilot.value.lastError) || '无进展'}`
    if (st === 'stopped') return '⏸ 已停止自动驾驶'
    if (st === 'queued') return `⏳ 已排队等待并发槽位（第 ${autopilot.value.queuePosition || 1} 位），有空位自动启动`
    if (st === 'running' && autopilot.value.stopRequested === true) return '⏸ 已请求停止自动驾驶（等待确认）'
    return ''
  })

  /**
   * 「运行状态」卡状态点：自动驾驶终态优先，无自动驾驶状态时回到会话生命周期。
   * 失败 / 未完成（疑似卡死）/ 收尾失败 必须落到 bad —— 与同一张卡里
   * .cp-run__autopilot-result--bad 的判定保持一致，不再显示灰点。
   */
  const autopilotHealthState = computed<string | null>(() => {
    if (autopilotRunning.value) return 'running'
    if (isPaused.value) return 'paused'
    const st = String(autopilot.value.status || '').toLowerCase()
    if (st === 'stopped') return 'paused'
    if (st === 'incomplete' || st === 'failed' || st === 'finalization_failed') return 'failed'
    if (st) return st
    return session.value ? runLifecycleState.value : null
  })
  const autopilotHealth = computed(() => runHealthTone(autopilotHealthState.value))

  return {
    autopilot, autopilotRunning, autopilotStopping, autopilotQueued,
    autopilotStartDisabled, autopilotStartTitle, autopilotResultText,
    autopilotHealthState, autopilotHealth
  }
}
