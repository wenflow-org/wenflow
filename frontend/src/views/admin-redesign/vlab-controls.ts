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
 *   running     运行中（goal/path/teaching 任一阶段；autopilot 可在跑）
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
  idle:      { label: '无活动会话', hint: '尚无会话或全部会话已终态；可用「运行」启动新会话', tone: 'muted' },
  created:   { label: '创建中', hint: '会话已创建，尚未开始推进（Goal 阶段起点）', tone: 'warn' },
  running:   { label: '运行中', hint: '学习推进中（Goal/Path/Learn）；可暂停或进入座舱', tone: 'ok' },
  paused:    { label: '已暂停', hint: '管理员冻结：自动推进已停止，无写入不算卡死，可继续或终止', tone: 'warn' },
  failed:    { label: '已失败', hint: '可重试：从第一个未完成课程续传，已完成进度保留', tone: 'bad' },
  abandoned: { label: '已终止', hint: '已被终止/回收；可重试续传或删除', tone: 'bad' },
  completed: { label: '已完成', hint: '学习路径全部完成；可进入座舱查看', tone: 'ok' }
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
    hint: '冻结 Learn 学习（仅教学阶段可用；暂停期间不会被自动回收）',
  },
  resume: {
    key: 'resume',
    label: '继续',
    hint: '解除冻结；需再次触发「自动」才会继续推进',
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
    hint: '自动推进当前会话（阶段/全程档请到会话座舱选择）',
    tone: 'primary'
  },
  stop: {
    key: 'stop',
    label: '终止',
    hint: '终止当前学习（终态 abandoned；不删除数据但不可恢复；与「停止自动驾驶」不同——那只停后台循环）',
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
    hint: '从第一个未完成课程续传（已完成课程与 Path 进度保留，本课重开）',
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
    hint: '级联删除该会话全部数据（仅终态，不可恢复）',
    tone: 'danger',
    confirm: {
      title: '删除会话',
      message: '将级联删除该会话及相关数据，不可恢复。确认？',
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

/** 从会话字段推导生命周期状态（前端统一口径；paused 由 teaching.paused 派生） */
export function deriveVsLifecycleState(input: {
  status?: string | null
  teachingPaused?: boolean
}): VsLifecycleState {
  const st = String(input.status || '')
  if (st && st !== 'idle') {
    if (st === 'running') return input.teachingPaused ? 'paused' : 'running'
    if (st === 'created') return 'created'
    if (st === 'failed') return 'failed'
    if (st === 'abandoned') return 'abandoned'
    if (st === 'completed') return 'completed'
  }
  return 'idle'
}