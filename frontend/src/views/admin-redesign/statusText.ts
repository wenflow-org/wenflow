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
  abandoned: '已放弃'
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
