import { callPrompt } from '../../composers/prompt-composer'
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter'
import { loadPromptFile } from '../../composers/prompt-files/loader'
import type { SkillDefinition, SkillExecutionResult } from '../protocol'
import { hasAuditEvidenceValue } from '../virtual-learner-shared/audit-evidence'
import type {
  ActorAuditEvidenceSource,
  VirtualLearnerActorAuditInput,
  VirtualLearnerActorAuditOutput
} from '../../virtual-lab/contracts'

export const VIRTUAL_LEARNER_ACTOR_AUDITOR_MAX_TOKENS = 5000
export const VIRTUAL_LEARNER_ACTOR_AUDITOR_TEMPERATURE = 0.2
export const VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT = loadPromptFile('skill:simulation-actor-audit')?.systemPrompt || ''

const EVIDENCE_SOURCES: ActorAuditEvidenceSource[] = [
  'actorProfile',
  'story',
  'learnerPrivateState',
  'publicTrace',
  'experimentSummary'
]

/** 严格读分：缺字段/非数字/越界 => 无效，integrity 留痕并强制 inconclusive。 */
function readScore(value: unknown): { value: number | null; valid: boolean } {
  const score = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(score) || score < 0 || score > 100) return { value: null, valid: false }
  return { value: Math.round(score), valid: true }
}

function text(value: unknown, limit = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function stringList(value: unknown, limit = 12) {
  return Array.isArray(value) ? value.map(item => text(item, 160)).filter(Boolean).slice(0, limit) : []
}

function normalizeEvidence(value: unknown, input: VirtualLearnerActorAuditInput): VirtualLearnerActorAuditOutput['evidence'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item: any, position: number) => {
    const source = EVIDENCE_SOURCES.includes(item?.source) ? item.source as ActorAuditEvidenceSource : null
    if (!source) return []
    if (item?.index != null && typeof item.index !== 'number') return []
    const index = item?.index ?? null
    if (source === 'publicTrace' && (!Number.isInteger(index) || index! < 0 || index! >= input.publicTrace.length)) return []
    if (source !== 'publicTrace' && index !== null) return []
    const path = text(item?.path, 180)
    const root = source === 'publicTrace' ? input.publicTrace[index!] : input[source]
    if (!path || !hasAuditEvidenceValue(source, root, path)) return []
    const id = text(item?.id, 40) || `AE${position + 1}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      source,
      index,
      path,
      timestamp: text(item?.timestamp, 64) || null,
      excerpt: text(item?.excerpt, 500),
      interpretation: text(item?.interpretation, 600)
    }]
  }).slice(0, 40)
}

export function normalizeActorAuditOutput(parsed: any, input: VirtualLearnerActorAuditInput): VirtualLearnerActorAuditOutput {
  const evidence = normalizeEvidence(parsed?.evidence, input)
  const evidenceIds = new Set(evidence.map(item => item.id))
  const danglingEvidenceRefs: string[] = []
  const findings = (Array.isArray(parsed?.findings) ? parsed.findings : []).flatMap((item: any, index: number) => {
    const rawRefs = stringList(item?.evidenceIds)
    const refs = rawRefs.filter(id => evidenceIds.has(id))
    for (const id of rawRefs) {
      if (!evidenceIds.has(id)) danglingEvidenceRefs.push(id)
    }
    if (!refs.length) {
      if (!rawRefs.length) danglingEvidenceRefs.push(`finding:${index + 1}:missing-reference`)
      return []
    }
    return [{
      code: text(item?.code, 80) || `ACTOR_FINDING_${index + 1}`,
      severity: ['critical', 'major', 'minor', 'info'].includes(item?.severity) ? item.severity : 'minor',
      category: ['persona', 'story', 'disclosure', 'friction', 'state', 'behavior', 'trace'].includes(item?.category)
        ? item.category : 'trace',
      title: text(item?.title, 180) || '未命名发现',
      detail: text(item?.detail, 1000),
      evidenceIds: refs
    }]
  }).slice(0, 24) as VirtualLearnerActorAuditOutput['findings']
  const findingCodes = new Set(findings.map(item => item.code))
  const danglingFindingCodes: string[] = []
  const recommendations = (Array.isArray(parsed?.recommendations) ? parsed.recommendations : []).flatMap((item: any) => {
    const action = text(item?.action, 500)
    if (!action) return []
    const rawCodes = stringList(item?.findingCodes)
    const validCodes = rawCodes.filter(code => findingCodes.has(code))
    for (const code of rawCodes) {
      if (!findingCodes.has(code)) danglingFindingCodes.push(code)
    }
    return [{
      priority: ['P0', 'P1', 'P2', 'P3'].includes(item?.priority) ? item.priority : 'P2',
      action,
      rationale: text(item?.rationale, 700),
      findingCodes: validCodes
    }]
  }).slice(0, 16) as VirtualLearnerActorAuditOutput['recommendations']

  const hasStory = !!input.story && Object.keys(input.story).length > 0
  const rawScores = parsed?.scores || {}
  const required = new Set([
    'personaConsistency',
    'frictionCalibration',
    'stateContinuity',
    'behaviorPlausibility',
    'evidenceSufficiency',
    ...(hasStory ? ['storyConsistency', 'disclosureDiscipline'] : []),
  ])
  const missingScores: string[] = []
  const readRequired = (key: string, fallback: number): number => {
    const parsedScore = readScore(rawScores[key])
    if (!parsedScore.valid) {
      if (required.has(key)) missingScores.push(key)
      return fallback
    }
    return parsedScore.value as number
  }
  const scores: VirtualLearnerActorAuditOutput['scores'] = {
    overall: 0,
    personaConsistency: readRequired('personaConsistency', 50),
    storyConsistency: hasStory ? readRequired('storyConsistency', 50) : null,
    disclosureDiscipline: hasStory ? readRequired('disclosureDiscipline', 50) : null,
    frictionCalibration: readRequired('frictionCalibration', 50),
    stateContinuity: readRequired('stateContinuity', 50),
    behaviorPlausibility: readRequired('behaviorPlausibility', 50),
    evidenceSufficiency: readRequired('evidenceSufficiency', evidence.length ? 60 : 20)
  }
  const integrity = {
    valid: evidence.length > 0 && missingScores.length === 0 && danglingEvidenceRefs.length === 0,
    missingEvidence: evidence.length === 0,
    missingScores,
    danglingEvidenceRefs: [...new Set(danglingEvidenceRefs)],
    danglingFindingCodes: [...new Set(danglingFindingCodes)],
  }
  if (!integrity.valid) {
    scores.evidenceSufficiency = Math.min(scores.evidenceSufficiency, 45)
  }
  const weighted = [
    [scores.personaConsistency, 20],
    [scores.storyConsistency, 15],
    [scores.disclosureDiscipline, 15],
    [scores.frictionCalibration, 15],
    [scores.stateContinuity, 15],
    [scores.behaviorPlausibility, 10],
    [scores.evidenceSufficiency, 10]
  ].filter(([score]) => score !== null) as Array<[number, number]>
  const weightTotal = weighted.reduce((sum, [, weight]) => sum + weight, 0)
  scores.overall = weightTotal
    ? Math.round(weighted.reduce((sum, [score, weight]) => sum + score * weight, 0) / weightTotal)
    : 0

  const hasCritical = findings.some(item => item.severity === 'critical')
  const hasMajor = findings.some(item => item.severity === 'major')
  const verdict: VirtualLearnerActorAuditOutput['verdict'] = !integrity.valid || scores.evidenceSufficiency < 50
    ? 'inconclusive'
    : hasCritical || scores.overall < 60
      ? 'invalid'
      : hasMajor || scores.overall < 80
        ? 'credible_with_concerns'
        : 'credible'

  return { verdict, scores, findings, recommendations, evidence, integrity }
}

export const virtualLearnerActorAuditorDefinition: SkillDefinition = {
  name: 'simulation-actor-audit',
  displayName: '虚拟学习者角色保真审计',
  version: '1.0.0',
  category: 'analysis',
  description: '基于画像、故事、摩擦预算、私有状态和公开行为评估合成学习者的角色保真度。',
  inputSchema: {
    type: 'object',
    properties: {
      actorProfile: { type: 'object', description: '合成学习者画像', required: true },
      story: { type: 'object', description: '本次运行的故事设定', required: false },
      frictionBudget: { type: 'string', description: '行为摩擦预算', required: true },
      learnerPrivateState: { type: 'object', description: '模拟器私有状态轨迹', required: true },
      publicTrace: { type: 'array', description: '学习者实际公开行为轨迹', required: true },
      experimentSummary: { type: 'object', description: '实验覆盖与终态摘要', required: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'credible|credible_with_concerns|invalid|inconclusive' },
      scores: { type: 'object', description: '角色保真度各维度 0-100 分' },
      findings: { type: 'array', description: '带证据引用的保真度问题' },
      recommendations: { type: 'array', description: '面向模拟器维护者的改进建议' },
      evidence: { type: 'array', description: '可定位到角色设定和行为轨迹的证据' }
    }
  },
  capabilities: ['virtual-learner-actor-audit', 'persona-fidelity-evaluation', 'synthetic-user-validity-check'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
}

export async function virtualLearnerActorAuditor(input: VirtualLearnerActorAuditInput): Promise<SkillExecutionResult<VirtualLearnerActorAuditOutput>> {
  const startedAt = Date.now()
  if (!input?.actorProfile || !Array.isArray(input.publicTrace) || !input.experimentSummary || !input.learnerPrivateState) {
    return {
      success: false,
      error: { code: 'INVALID_ACTOR_AUDIT_INPUT', message: 'Actor Auditor 输入不完整' },
      duration: Date.now() - startedAt
    }
  }

  const result = await callPrompt<VirtualLearnerActorAuditInput, VirtualLearnerActorAuditOutput>({
    agentId: 'skill:simulation-actor-audit',
    defaultSystemPrompt: VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'simulation-actor-audit' },
        buildUserPayload: value => value,
    validateParsedOutput: parsed => ({
      valid: !!parsed?.scores && Array.isArray(parsed?.findings) && Array.isArray(parsed?.evidence),
      failureReason: 'missing scores/findings/evidence'
    }),
    softValidateParsedOutput: (parsed) => normalizeActorAuditOutput(parsed, input).integrity?.valid
      ? { valid: true }
      : { valid: false, failureReason: '角色审计分数或证据无效。至少引用一项输入中的实际字段，且每条发现都须引用有效证据。' },
    normalizeOutput: normalizeActorAuditOutput,
    mapEnvelope: (output, _input, runtimeContract) => mapSkillOutputEnvelope(runtimeContract, output, {
      phase: 'completed',
      isTerminal: true,
    }),
    retryStrategy: {
      maxAttempts: 2,
      onValidationFail: ({ failureReason }) => `请只输出合法 JSON，并完整包含 scores、findings、recommendations、evidence。上一轮问题：${failureReason}`
    }
  }, input)

  if (!result.success || !result.output) {
    return {
      success: false,
      error: result.error || { code: 'ACTOR_AUDIT_FAILED', message: '角色保真审计失败' },
      duration: Date.now() - startedAt
    }
  }
  return {
    success: true,
    output: { ...result.output, runtimeEnvelope: result.runtimeEnvelope } as VirtualLearnerActorAuditOutput,
    duration: result.debug.durationMs,
  }
}

export default virtualLearnerActorAuditor
