/**
 * Admin 统一状态/阶段/类别本地化字典
 * 后端枚举（snake_case / camelCase / 英文）→ 中文展示
 */

const STATUS_TEXT: Record<string, string> = {
  completed: '已完成',
  succeeded: '成功',
  success: '成功',
  ok: '成功',
  active: '进行中',
  in_progress: '进行中',
  inprogress: '进行中',
  started: '已开始',
  running: '进行中',
  processing: '处理中',
  timeout: '超时',
  error: '错误',
  err: '失败',
  failed: '失败',
  fail: '失败',
  warn: '降级',
  paused: '已暂停',
  superseded: '已被替代',
  discarded: '已废弃',
  cancelled: '已取消',
  canceled: '已取消',
  pending: '等待中',
  draft: '草稿',
  published: '已发布',
  archived: '已下线',
  offline: '已下线',
  closed: '已关闭',
  created: '已创建',
  abandoned: '已放弃',
  finalizing: '收尾中',
  finalization_failed: '收尾失败'
}

/** 状态英文值 → 中文；未知值原样返回（不返回 —，避免丢失信息） */
export function statusText(s: string | null | undefined): string {
  const key = String(s || '').toLowerCase()
  return STATUS_TEXT[key] || String(s || '')
}

/** Goal 会话阶段枚举 → 中文 */
const STAGE_TEXT: Record<string, string> = {
  understanding: '澄清中',
  proposal: '方案收敛中',
  planning: '规划中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

export function stageText(s: string | null | undefined): string {
  const key = String(s || '').toLowerCase()
  return STAGE_TEXT[key] || String(s || '')
}

/** Goal 会话阶段 → mk-badge 档位（G1：阶段列由纯灰字升级徽章；会话域三页统一单源，ADMIN_DEEP_SESSION_AUDIT 4.3） */
export function stageBadgeCls(s: string | null | undefined): string {
  const key = String(s || '').toLowerCase()
  if (key === 'completed') return 'mk-badge--ok'
  if (key === 'failed') return 'mk-badge--bad'
  if (key === 'cancelled' || key === 'proposal') return 'mk-badge--warn'
  if (key === 'understanding' || key === 'planning' || key === 'initial' || key === 'in_progress') return 'mk-badge--info'
  return 'mk-badge--muted'
}

/* ---------- 会话域进度单源（ADMIN_DEEP_SESSION_AUDIT 4.3：进度 = 数字 + 迷你条，三页统一） ---------- */

/** Goal 阶段 → 进度序号（0=创建 1=澄清 2=方案 3=完成；失败给中断位 2、取消给中断位 1） */
const STAGE_PROGRESS_INDEX: Record<string, number> = {
  initial: 0,
  created: 0,
  understanding: 1,
  proposing: 2,
  ready: 2,
  proposal: 2,
  planning: 2,
  completed: 3,
  failed: 2,
  cancelled: 1
}

/** Goal 会话四步过程：创建 → 澄清 → 方案 → 完成 */
export const GOAL_STAGE_TOTAL = 4
export const GOAL_STAGE_STEP_LABELS = ['创建', '澄清', '方案', '完成'] as const

/** Goal 阶段 → 过程步序号（0 起，未知阶段回退 0） */
export function stageProgressIndex(s: string | null | undefined): number {
  const key = String(s || '').toLowerCase()
  return STAGE_PROGRESS_INDEX[key] ?? 0
}

/** Goal 阶段 → 进度（当前步/总步数，供阶段点条/进度条使用） */
export function stageProgress(s: string | null | undefined): { index: number; total: number } {
  return { index: stageProgressIndex(s), total: GOAL_STAGE_TOTAL }
}

/** 当前步的中文标签（0 起，与 GOAL_STAGE_STEP_LABELS 对齐） */
const STAGE_STEP_TEXT = ['创建', '澄清中', '方案收敛中', '已完成'] as const

export interface StageTimelineInput {
  stage?: string | null
  status?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  completedAt?: string | null
}

export interface StageTimelineItem {
  label: string
  date: string
}

/** 终态标签：已完成走 completedAt；取消/失败/废弃走最近更新时间 */
const STAGE_TERMINAL_TEXT: Record<string, string> = {
  cancelled: '已取消',
  failed: '失败',
  discarded: '已废弃'
}

/** ISO → MM-DD（本地时区）；非法/空值返回空串 */
function fmtShortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}

/**
 * Goal 会话轻量阶段时间线（用 goal_conversations 现表字段推导，不新增后端字段）：
 * 创建(createdAt) → 当前阶段(updatedAt) → 终态(completedAt/updatedAt)。
 * 同日相邻条目收敛为最晚一条（如「创建 08-12 → 澄清中 08-12」只留「澄清中 08-12」）。
 */
export function stageTimeline(input: StageTimelineInput): StageTimelineItem[] {
  const src = input || {}
  const created = fmtShortDate(src.createdAt)
  const updated = fmtShortDate(src.updatedAt)
  const completed = fmtShortDate(src.completedAt)
  const status = String(src.status || '').toLowerCase()
  const stage = String(src.stage || '').toLowerCase()
  const items: StageTimelineItem[] = []

  if (created) items.push({ label: '创建', date: created })

  if (status === 'completed') {
    if (completed) items.push({ label: '已完成', date: completed })
  } else {
    const idx = stageProgressIndex(stage)
    const currentDate = updated || created
    if (idx > 0 && currentDate) items.push({ label: STAGE_STEP_TEXT[idx], date: currentDate })
    const terminal = STAGE_TERMINAL_TEXT[status] || (stage === 'failed' ? '失败' : stage === 'cancelled' ? '已取消' : '')
    if (terminal && (updated || created)) items.push({ label: terminal, date: updated || created })
  }

  // 同日相邻条目收敛为最晚一条
  return items.filter((item, i) => i === items.length - 1 || item.date !== items[i + 1].date)
}

/** 阶段时间线 → 展示文本（如「创建 08-12 → 澄清中 08-13」）；无数据返回 '' */
export function stageTimelineText(input: StageTimelineInput): string {
  return stageTimeline(input)
    .map((i) => `${i.label} ${i.date}`)
    .join(' → ')
}

/** 教学会话进度（后端 teaching-sessions 列表 progress 字段；milestones/subtasks 推导） */
export interface SessionProgress {
  taskIndex: number
  totalTasks: number
  milestoneIndex: number
  totalMilestones: number
}

/** 教学会话任务进度百分比（0-100）；无任务维度数据 → null */
export function sessionProgressPct(p: SessionProgress | null | undefined): number | null {
  if (!p || !Number.isFinite(p.totalTasks) || p.totalTasks <= 0) return null
  const pct = Math.round((p.taskIndex / p.totalTasks) * 100)
  return Math.max(0, Math.min(100, pct))
}

/** 教学会话进度文本：x/y；失败/超时等中断态加「中断于」前缀；无数据 → — */
export function sessionProgressText(p: SessionProgress | null | undefined, status?: string | null): string {
  if (!p || !Number.isFinite(p.totalTasks) || p.totalTasks <= 0) return '—'
  const base = `任务 ${Math.min(Math.max(p.taskIndex, 0), p.totalTasks)}/${p.totalTasks}`
  const st = String(status || '').toLowerCase()
  if (['failed', 'timeout', 'finalization_failed', 'discarded', 'superseded'].includes(st)) return `中断于 ${base}`
  return base
}

/** 教学会话进度条档位：完成 → ok；失败/超时/收尾失败/废弃/已被替代 → bad；其余默认蓝条（null） */
export function sessionProgressTone(status?: string | null): 'ok' | 'bad' | null {
  const st = String(status || '').toLowerCase()
  if (st === 'completed' || st === 'succeeded') return 'ok'
  if (['failed', 'timeout', 'finalization_failed', 'discarded', 'superseded'].includes(st)) return 'bad'
  return null
}

/** 教学会话终态完成判定（P1 语义修复：已完成会话不再展示「任务 x/y」进度，改显「已完成」） */
export function sessionProgressDone(status?: string | null): boolean {
  const st = String(status || '').toLowerCase()
  return st === 'completed' || st === 'succeeded'
}

/** Skill 类别 → 中文 */
const CATEGORY_TEXT: Record<string, string> = {
  analysis: '分析',
  generation: '生成',
  parsing: '解析',
  computation: '计算',
  standard: '标准',
  teaching: '教学',
  simulation: '模拟',
  tool: '工具',
  skill: 'Skill'
}

export function categoryText(s: string | null | undefined): string {
  const key = String(s || '').toLowerCase()
  return CATEGORY_TEXT[key] || String(s || '')
}

/** 操作审计 action → 中文；未知值回退原文 */
const ACTION_TEXT: Record<string, string> = {
  'user-create': '创建用户',
  'user-update': '更新用户',
  'user-role-change': '变更角色',
  'user-delete': '删除用户',
  'user-batch-delete': '批量删除用户',
  'announcement-create': '创建公告',
  'announcement-update': '更新公告',
  'announcement-publish': '发布公告',
  'announcement-archive': '归档公告',
  'announcement-delete': '删除公告',
  'admin-login': '管理员登录',
  'admin-logout': '管理员登出',
  'session-revoke': '强制下线会话',
  // 虚拟学习者域（A5 审计语义化）
  'virtual-create': '创建虚拟学习者',
  'virtual-update': '更新虚拟画像',
  'virtual-delete': '删除虚拟学习者',
  'virtual-story-generate': '生成故事',
  'virtual-story-update': '编辑故事',
  'virtual-story-delete': '删除故事',
  'virtual-session-start': '启动虚拟实验',
  'virtual-session-delete': '删除虚拟会话',
  'virtual-session-stale-reclaim': '回收卡死会话',
  'virtual-session-batch-terminate': '批量终止虚拟会话',
  'virtual-cascade-delete': '级联删除虚拟数据'
}

export function actionText(s: string | null | undefined): string {
  const key = String(s || '').toLowerCase()
  return ACTION_TEXT[key] || String(s || '')
}

/** 审计目标类型 → 中文；未知值回退原文 */
const TARGET_TEXT: Record<string, string> = {
  user: '用户',
  announcement: '公告',
  session: '会话',
  'virtual-learner': '虚拟学习者',
  'virtual-session': '虚拟会话'
}

export function targetTypeText(s: string | null | undefined): string {
  const key = String(s || '').toLowerCase()
  if (!key) return '—'
  return TARGET_TEXT[key] || String(s)
}
