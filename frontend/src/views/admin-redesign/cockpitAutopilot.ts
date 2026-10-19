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
    /** 主循环最近一次写状态的时间（后端 writeState 每次都盖）：判「在跑但不动」的唯一证据 */
    heartbeatAt?: string | null
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
    if (isTerminal.value) return '会话已结束，无需启动全自动'
    if (autopilotRunning.value) return '全自动正在进行中'
    return '持续跑到全部任务完成，可随时停止，进度保留'
  })
  /* 状态前缀已撤（2026-10-14 与教学会话/虚拟画像/Prompt 评估同批）：原先每条前缀一个 emoji
     （完成/失败/未完成/已停止/已排队各一个），而句子本身就写着状态、行级 tone
     （--ok/--bad/--muted）也由 autopilotStatus 单独着色——前缀是第三遍同义。
     管理端不用 emoji（判例 AchIcon）。 */
  const autopilotResultText = computed(() => {
    const st = autopilot.value.status
    if (st === 'completed') return '全部完成：所有任务已跑完'
    if (st === 'failed') return `运行失败：${firstText(autopilot.value.lastError) || '未知原因'}`
    if (st === 'incomplete') return `未完成：${firstText(autopilot.value.lastError) || '无进展'}`
    if (st === 'stopped') return '已停止自动驾驶'
    if (st === 'queued') return `已排队（第 ${autopilot.value.queuePosition || 1} 位），有空位自动启动`
    if (st === 'running' && autopilot.value.stopRequested === true) return '已请求停止自动驾驶（等待确认）'
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

/** 后端僵尸阈值同值（autopilot.service.ts `isStaleAutopilotRun`）：心跳超过它，后台对账会把这轮收口。
    前端不另立阈值——两把尺子会让「看着还在跑」与「后台已判死」打架。 */
export const AUTOPILOT_STALE_MS = 10 * 60 * 1000

export interface AutopilotDriverLine {
  text: string
  tone: 'ok' | 'warn' | 'muted'
  title: string
}

/**
 * 「运行状态」卡的驱动器行（2026-10-19 运营走查「从人工运营角度看」）：
 * 排队与运行中都补一句读数。此前运行中只有四行阶段点阵，没有任何「还在动」的证据 ——
 * 运营分不出「在跑」与「在跑但卡住」，也不知道自己在队列第几位（那位信息只在顶栏的
 * 「取消排队（第 N 位）」按钮上，一点就取消了）。
 *
 * 判据全部来自已有字段（status / queuePosition / heartbeatAt），不新增后端契约；
 * `now` 由宿主按轮询节拍传入（纯函数，便于单测）。
 */
export function autopilotDriverLine(
  ap: { status?: string; queuePosition?: number | null; heartbeatAt?: string | null; stopRequested?: boolean },
  now: number
): AutopilotDriverLine | null {
  const st = String(ap.status || '')
  if (st === 'queued') {
    return {
      text: `排队中 · 第 ${ap.queuePosition || 1} 位`,
      tone: 'warn',
      title: '自动驾驶并发名额已满，出现空位后自动启动。排队期间不占用模型调用'
    }
  }
  if (st !== 'running') return null
  if (ap.stopRequested === true) {
    return { text: '已请求停止，等待当前回合收口', tone: 'muted', title: '后台会在当前回合结束后停止推进，学习进度保留' }
  }
  const ageMs = heartbeatAgeMs(ap.heartbeatAt, now)
  if (ageMs == null) {
    return { text: '自动推进中', tone: 'ok', title: '会话正在被自动驾驶推进。这一轮还没有写回心跳时间' }
  }
  const text = `自动推进中 · 最后心跳 ${ageText(ageMs)}前`
  if (ageMs > AUTOPILOT_STALE_MS) {
    return {
      text,
      tone: 'warn',
      title: `心跳已超过 ${Math.round(AUTOPILOT_STALE_MS / 60000)} 分钟（与后端僵尸阈值同值）：可能卡住，或进程重启后内存里的运行记录已丢，后台一致性核查会把这轮收口`
    }
  }
  return {
    text,
    tone: 'ok',
    title: '心跳随每个推进步骤刷新：数字在读秒说明主循环仍在动，停住不动才是异常'
  }
}

function heartbeatAgeMs(hb: string | null | undefined, now: number): number | null {
  if (!hb) return null
  const t = new Date(hb).getTime()
  return Number.isFinite(t) ? Math.max(0, now - t) : null
}

function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟`
  return `${Math.round(m / 60)} 小时`
}
