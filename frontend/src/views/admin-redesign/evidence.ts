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

export function evidenceSignalZh(signal: unknown): string {
  return SIGNAL_ZH[String(signal || '').toLowerCase()] || ''
}

export function evidenceLowConfidence(score: number): boolean {
  return score < EVIDENCE_LOW_CONFIDENCE
}

/** 点色：mastery→绿 / struggle→红 / fatigue→琥珀 / incomplete→灰；未知信号按置信度兜底（高→绿、低→琥珀） */
export function evidenceDotTone(signal: unknown, score: number): 'ok' | 'warn' | 'bad' | 'muted' {
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
