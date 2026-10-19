/**
 * 虚拟学习者会话生命周期模型（vlab-controls）
 *
 * 这是「虚拟学习者控制台」三层（列表 / 画像 / 会话座舱）共用的唯一操作模型：
 * 状态呈现、可用操作、确认文案全部在此定义，页面只负责渲染与绑定 handler，
 * 杜绝各层自画按钮导致语义漂移（此前「重试=清零」「停止=覆盖进度」的根因）。
 *
 * ── 生命周期状态机（与后端 virtual_sessions 对齐）────────────────────────────
 *   idle        无会话（或全部终态之外无活动会话）
 *   created     会话刚创建（currentStage=goal，尚未推进）
 *   running     进行中（goal/path/teaching 任一阶段；autopilot 可在跑）
 *   paused      running + teaching.paused（管理员冻结；无写入属预期，不算卡死）
 *   failed      已失败（可重试：从第一个未完成课程续传，保留已完成进度）
 *   abandoned   已终止/已回收（运维清理，可重试续传或删除）
 *   completed   已完成
 *
 * ── 操作语义（每操作一个确定后果，不覆盖已有进度）────────────────────────────
 *   start   启动新会话（一级列表「运行」= 新建一次实验会话，绝不影响旧会话）
 *   pause   暂停 = 冻结自动推进（仅 teaching 阶段 running 可用；暂停期间不被回收）
 *   resume  继续 = 解除冻结（仅清标志，不驱动执行；需再触发「自动」继续推进）
 *   step    推进 = 手动单步（当前阶段推进一步）
 *   auto    自动 = 自动推进当前会话（阶段级/全程档由页面细分）
 *   stop    停止 = 终态化 abandoned（不可恢复；确认后才会执行）
 *   retry   重试 = 从第一个未完成课程续传（保留 completedTasks/Path；确认后才会执行）
 *   delete  删除 = 级联删除（仅终态；不可恢复；确认后才会执行）
 *   cockpit 进入座舱（导航，非状态变更）
 *
 * 说明：后端已配套护栏——终止撤销会话租约（防复活）、执行入口认 abandoned（防推进）、
 * restart 保留任务进度（防清零）；本文件只负责把同一套语义呈现到界面。
 */

export type VsLifecycleState = 'idle' | 'created' | 'running' | 'paused' | 'failed' | 'abandoned' | 'completed'

export type VsControlKey = 'start' | 'pause' | 'resume' | 'step' | 'auto' | 'stop' | 'retry' | 'delete' | 'cockpit'

export interface VsStateMeta {
  /** 状态徽章主标签 */
  label: string
  /** 状态副文案（tooltip / 旁注） */
  hint: string
  /** 徽章色：ok 绿 / warn 琥珀 / bad 红 / muted 灰 */
  tone: 'ok' | 'warn' | 'bad' | 'muted'
}

export interface VsControlDef {
  key: VsControlKey
  /** 按钮主文案 */
  label: string
  /** 按钮副文案（title） */
  hint: string
  /** primary 主操作 / danger 危险操作 / 其余普通 */
  tone?: 'primary' | 'danger'
  /** 执行前的二次确认（统一文案，页面不得自行改词） */
  confirm?: { title: string; message: string; confirmText: string }
}

/** 状态呈现元数据（唯一来源） */
export const VS_STATE_META: Record<VsLifecycleState, VsStateMeta> = {
  idle:      { label: '无活动会话', hint: '尚无会话或全部会话已结束。可用「运行」启动新会话', tone: 'muted' },
  created:   { label: '创建中', hint: '会话已创建，尚未开始推进（目标阶段起点）', tone: 'warn' },
  running:   { label: '进行中', hint: '学习推进中（目标 / 路径 / 教学）。可暂停或进入座舱', tone: 'ok' },
  paused:    { label: '已暂停', hint: '管理员冻结：自动推进已停止，暂停期间没有新记录属正常，可继续或终止', tone: 'warn' },
  failed:    { label: '已失败', hint: '可重试：从第一个未完成课程续传，已完成进度保留', tone: 'bad' },
  abandoned: { label: '已终止', hint: '已被终止或回收。可重试续传或删除', tone: 'bad' },
  completed: { label: '已完成', hint: '学习路径全部完成。可进入座舱查看', tone: 'ok' }
}

/** 操作定义（唯一来源；页面按状态过滤后渲染） */
export const VS_CONTROL_DEFS: Record<VsControlKey, VsControlDef> = {
  start: {
    key: 'start',
    label: '运行',
    hint: '启动一次新的实验会话（不影响已有会话）',
    tone: 'primary'
  },
  pause: {
    key: 'pause',
    label: '暂停',
    hint: '暂停学习推进（仅教学阶段可用，不会被自动回收）',
  },
  resume: {
    key: 'resume',
    label: '继续',
    hint: '解除冻结。需再次触发「自动」才会继续推进',
    tone: 'primary'
  },
  step: {
    key: 'step',
    label: '推进一步',
    hint: '手动推进一个步骤（当前会话原地前进）',
  },
  auto: {
    key: 'auto',
    label: '自动',
    hint: '自动推进当前会话（推进一个阶段还是推进到底，请到会话座舱选择）',
    tone: 'primary'
  },
  stop: {
    key: 'stop',
    label: '终止',
    hint: '终止当前学习（不可恢复，数据保留）。与「停止自动驾驶」不同，那只停止自动推进，会话本身还在',
    tone: 'danger',
    confirm: {
      title: '终止学习',
      message: '将终止当前学习会话（标记为已终止，数据保留）。\n终止后不可恢复，可重试续传或删除。确认？',
      confirmText: '终止'
    }
  },
  retry: {
    key: 'retry',
    label: '重试',
    hint: '从第一个未完成课程续传（已完成课程与路径进度保留，本课重开）',
    tone: 'primary',
    confirm: {
      title: '重新开始学习',
      message: '将重开当前课程的教学会话（本课重新开始）。\n已完成课程与 Path 进度会保留，从第一个未完成课程续传。确认？',
      confirmText: '重新开始'
    }
  },
  delete: {
    key: 'delete',
    label: '删除',
    /* F22（2026-10-15）：原文「全部数据」超出实现（会话+课堂/路径才删），按实际范围写，
       并写明保留面——按 userId 键控的记忆/误解记录与 agent_call_logs 调用遥测不随会话删。
       文案门禁：分号拼接拆成两句、内部词「账本」改说「误解记录」 */
    hint: '删除该会话及其课堂/路径数据。该学习者的记忆、误解记录与调用遥测保留（仅限已结束的会话，不可恢复）',
    tone: 'danger',
    confirm: {
      title: '删除会话',
      message: '将删除该会话及其课堂记录、目标对话与学习路径。\n该学习者的记忆、误解记录与调用遥测会保留。此操作不可撤销。确认？',
      confirmText: '删除'
    }
  },
  cockpit: {
    key: 'cockpit',
    label: '座舱 →',
    hint: '进入会话座舱查看细粒度控制与对话'
  }
}

/** 各状态允许出现的操作（守卫：操作只在合法状态出现，杜绝「能点但会出人意料」） */
const CONTROLS_BY_STATE: Record<VsLifecycleState, VsControlKey[]> = {
  idle:      ['start', 'cockpit'],
  created:   ['start', 'stop', 'cockpit'],
  running:   ['pause', 'auto', 'step', 'stop', 'cockpit'],
  paused:    ['resume', 'stop', 'cockpit'],
  failed:    ['retry', 'stop', 'delete', 'cockpit'],
  abandoned: ['retry', 'stop', 'delete', 'cockpit'],
  completed: ['delete', 'cockpit']
}

/** 按状态取可用操作定义（页面渲染唯一入口） */
export function vlabControlsFor(state: VsLifecycleState): VsControlDef[] {
  return (CONTROLS_BY_STATE[state] || []).map((k) => VS_CONTROL_DEFS[k])
}

/** 从会话字段推导生命周期状态（前端统一口径；paused 由 teaching.paused 派生）
 *
 *  2026-10-19 运营走查：这个函数此前**没有任何视图调用** —— 画像页与座舱各写了一份等价派生，
 *  座舱那份（lifeStateCockpit）比状态徽章那份（runLifecycleState）少两个分支，同一个会话的
 *  顶栏按钮簇与「运行状态」卡因此可能给出不同状态词。现在它是唯一实现：派生一律走这里。
 *
 *  分支顺序即优先级（与后端语义对齐）：
 *  ① 会话终态（completed/failed/abandoned）优先——租约已撤，别的标志不再改变结论；
 *  ② 紧急停止 teaching.manualStop（会话可能仍记 failed，但对运营已是「被终止」）；
 *  ③ 管理员暂停 teaching.paused（会话仍是 running，但没有新记录属预期）；
 *  ④ 自动驾驶 stopped（驱动停了、会话还在 → 同属「已暂停」）；
 *  ⑤ created / running；
 *  ⑥ 其余（含未加载）→ idle。 */
export function deriveVsLifecycleState(input: {
  status?: string | null
  teachingPaused?: boolean
  /** 紧急停止（teaching.manualStop）：会话 status 可能仍是 failed，展示为「已终止」 */
  manualStopped?: boolean
  /** 自动驾驶状态：stopped = 驱动器停了（会话未结束），展示为「已暂停」 */
  autopilotStatus?: string | null
}): VsLifecycleState {
  const st = String(input.status || '')
  if (st === 'completed' || st === 'failed' || st === 'abandoned') return st
  if (input.manualStopped) return 'abandoned'
  if (input.teachingPaused) return 'paused'
  if (String(input.autopilotStatus || '') === 'stopped') return 'paused'
  if (st === 'created') return 'created'
  if (st === 'running') return 'running'
  return 'idle'
}

/** 画像级派生：从会话流水聚合出「这个人现在处于哪一态」（多会话取最活跃的一条）。
 *  与单会话版同住本文件，保证状态语义与可用动作矩阵永远同源。
 *  failed/abandoned 在 tone=bad 下合并展示（既有产品取舍）。 */
export function deriveVsLifecycleStateFromRuns(
  runs: ReadonlyArray<{ result?: string | null; tone?: string | null; paused?: boolean | null }>
): VsLifecycleState {
  if (!runs.length) return 'idle'
  const live = (r: { result?: string | null }) => r.result === 'running' || r.result === 'created'
  if (runs.some((r) => r.paused && live(r))) return 'paused'
  if (runs.some(live)) return 'running'
  if (runs.some((r) => r.tone === 'bad')) return 'failed'
  if (runs.some((r) => r.tone === 'ok')) return 'completed'
  return 'idle'
}