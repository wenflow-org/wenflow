/**
 * 证据记录（LearnerDetail 证据时间线）语义单源
 *
 * 后端契约（LearnerKnowledgeMemoryService.ts:194 `score: evidence.confidence`）：
 * - score = 证据置信度（0-1，越高越确信），不是风险分
 * - signal = 事件语义：mastery / struggle / fatigue / incomplete
 * 点色由 signal 驱动（mastery→绿、struggle→红、fatigue→琥珀、incomplete→灰），
 * 置信度仅作 tooltip 与「证据不足」提示——杜绝「越确信越红」的语义反转（ADMIN_DEEP_LEARNER_AUDIT P0 A1）。
 */

/** 置信度低于该值提示「证据不足」（后端置信分布 0-1，0.5 为中性分界） */
export const EVIDENCE_LOW_CONFIDENCE = 0.5

const SIGNAL_ZH: Record<string, string> = {
  mastery: '掌握',
  struggle: '挣扎',
  fatigue: '疲劳',
  incomplete: '未完成'
}

/** domain（goal/path）证据的中性信号词：不套用学习成败语义（掌握/未完成），按事件类型给中性描述 */
const DOMAIN_SIGNAL_ZH: Record<string, string> = {
  'goal:understanding:updated': '澄清',
  'path:created': '创建',
  'path:generated': '生成',
  'path:adjusted': '调整',
  'path:completed': '完成'
}

const TYPE_ZH: Record<string, string> = {
  'task-completed': '任务完成',
  'teaching-session': '教学会话',
  summary: '总结',
  evaluation: '评估',
  session: '教学会话',
  task: '任务完成',
  // 目标/路径域证据（learner_evidence 表持久化事件）
  'goal:understanding:updated': '目标澄清',
  'path:created': '路径创建',
  'path:generated': '路径生成',
  'path:adjusted': '路径调整',
  'path:completed': '路径完成'
}

/** 事件类型 → 来源说明（时间线 hover 用；未知类型给通用描述） */
const TYPE_SOURCE_ZH: Record<string, string> = {
  'task-completed': '学习任务完成事件',
  'teaching-session': '教学会话事件',
  summary: '会话总结产出的事件',
  evaluation: '会话评估产出的事件',
  session: '教学会话事件',
  task: '学习任务完成事件',
  'goal:understanding:updated': '目标澄清对话事件',
  'path:created': '学习路径创建事件',
  'path:generated': '学习路径生成事件',
  'path:adjusted': '学习路径调整事件',
  'path:completed': '学习路径完成事件'
}

export function evidenceSignalZh(signal: unknown, type?: unknown): string {
  const t = String(type || '').toLowerCase()
  if (DOMAIN_SIGNAL_ZH[t]) return DOMAIN_SIGNAL_ZH[t]
  return SIGNAL_ZH[String(signal || '').toLowerCase()] || ''
}

/** 证据类型 → 中文（task-completed=任务完成/teaching-session=教学会话/summary=总结/evaluation=评估） */
export function evidenceTypeZh(type: unknown): string {
  return TYPE_ZH[String(type || '').toLowerCase()] || String(type || '学习事件')
}

/** 证据类型 → 来源说明文案 */
export function evidenceSourceZh(type: unknown): string {
  return TYPE_SOURCE_ZH[String(type || '').toLowerCase()] || '学习事件'
}

export function evidenceLowConfidence(score: number): boolean {
  return score < EVIDENCE_LOW_CONFIDENCE
}

/** 点色：mastery→绿 / struggle→红 / fatigue→琥珀 / incomplete→灰；未知信号按置信度兜底（高→绿、低→琥珀）。
 *  domain（goal/path）事件始终中性灰（不套用学习成败语义） */
export function evidenceDotTone(signal: unknown, score: number, type?: unknown): 'ok' | 'warn' | 'bad' | 'muted' {
  const t = String(type || '').toLowerCase()
  if (DOMAIN_SIGNAL_ZH[t]) return 'muted'
  const s = String(signal || '').toLowerCase()
  if (s === 'struggle') return 'bad'
  if (s === 'fatigue') return 'warn'
  if (s === 'incomplete') return 'muted'
  if (s === 'mastery') return 'ok'
  return score >= 0.8 ? 'ok' : evidenceLowConfidence(score) ? 'warn' : 'muted'
}

export function evidenceConfidenceText(score: number): string {
  return `置信 ${Math.round(score * 100)}%`
}

/** 证据行 tooltip：信号中文 + 置信度 + 证据不足标记 */
export function evidenceTooltip(signal: unknown, score: number): string {
  const parts: string[] = []
  const zh = evidenceSignalZh(signal)
  if (zh) parts.push(`信号：${zh}`)
  parts.push(evidenceConfidenceText(score))
  if (evidenceLowConfidence(score)) parts.push('证据不足')
  return parts.join(' · ')
}

/** 完整证据 tooltip（含来源类型/会话/任务/时间）：时间线行与概念密度条共用 */
export function evidenceFullTooltip(
  type: unknown,
  signal: unknown,
  score: number,
  opts?: { sessionId?: string; taskId?: string; happenedAt?: string }
): string {
  const parts: string[] = []
  const typeZh = evidenceTypeZh(type)
  if (typeZh) parts.push(typeZh)
  const src = evidenceSourceZh(type)
  if (src && src !== typeZh) parts.push(src)
  if (opts?.sessionId) parts.push(`会话 ${opts.sessionId}`)
  if (opts?.taskId) parts.push(`任务 ${opts.taskId}`)
  const sig = evidenceSignalZh(signal, type)
  if (sig) parts.push(`信号：${sig}`)
  parts.push(evidenceConfidenceText(score))
  // domain（goal/path）证据的置信度 = 过程完成度，低值不提示「证据不足」
  const t = String(type || '').toLowerCase()
  if (!DOMAIN_SIGNAL_ZH[t] && evidenceLowConfidence(score)) parts.push('证据不足')
  if (opts?.happenedAt) parts.push(opts.happenedAt)
  return parts.join(' · ')
}

/** 置信度 → 迷你条色阶：<50% 琥珀（证据不足）、50-79% 蓝、≥80% 绿 */
export function evidenceConfidenceTone(score: number): 'ok' | 'warn' | 'info' {
  if (evidenceLowConfidence(score)) return 'warn'
  if (score >= 0.8) return 'ok'
  return 'info'
}

/** 概念证据密度 hover 文案：说明数字来源（确定性事件计数 + AI 蒸馏，去重后取最大） */
export function evidenceDensityTooltip(label: string, count: number): string {
  if (count <= 0) return `${label}：暂无关联学习事件`
  return `${label}：关联 ${count} 条学习事件（来自教学会话/任务完成/总结/评估，快照重算时聚合）`
}

