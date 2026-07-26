import { callPrompt } from '../../composers/prompt-composer'
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter'
import { loadPromptFile } from '../../composers/prompt-files/loader'
import type { SkillDefinition, SkillExecutionResult } from '../protocol'
import type {
  ActorAuditEvidenceSource,
  VirtualLearnerActorAuditInput,
  VirtualLearnerActorAuditOutput
} from '../../virtual-lab/contracts'

export const VIRTUAL_LEARNER_ACTOR_AUDITOR_MAX_TOKENS = 5000
export const VIRTUAL_LEARNER_ACTOR_AUDITOR_TEMPERATURE = 0.2
export const VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT = loadPromptFile('skill:virtual-learner-actor-auditor')?.systemPrompt || ''

const EVIDENCE_SOURCES: ActorAuditEvidenceSource[] = [
  'actorProfile',
  'story',
  'learnerPrivateState',
  'publicTrace',
  'experimentSummary'
]

function clampScore(value: unknown, fallback = 0) {
  const score = Number(value)
  if (!Number.isFinite(score)) return fallback
  return Math.round(Math.max(0, Math.min(100, score)))
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
    const index = item?.index === null || item?.index === undefined ? null : Number(item.index)
    if (source === 'publicTrace' && (!Number.isInteger(index) || index! < 0 || index! >= input.publicTrace.length)) return []
    const id = text(item?.id, 40) || `AE${position + 1}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      source,
      index,
      path: text(item?.path, 180) || source,
      timestamp: text(item?.timestamp, 64) || null,
      excerpt: text(item?.excerpt, 500),
      interpretation: text(item?.interpretation, 600)
    }]
  }).slice(0, 40)
}

export function normalizeActorAuditOutput(parsed: any, input: VirtualLearnerActorAuditInput): VirtualLearnerActorAuditOutput {
  const evidence = normalizeEvidence(parsed?.evidence, input)
  const evidenceIds = new Set(evidence.map(item => item.id))
  const findings = (Array.isArray(parsed?.findings) ? parsed.findings : []).flatMap((item: any, index: number) => {
    const refs = stringList(item?.evidenceIds).filter(id => evidenceIds.has(id))
    if (!refs.length) return []
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
  const recommendations = (Array.isArray(parsed?.recommendations) ? parsed.recommendations : []).flatMap((item: any) => {
    const action = text(item?.action, 500)
    if (!action) return []
    return [{
      priority: ['P0', 'P1', 'P2', 'P3'].includes(item?.priority) ? item.priority : 'P2',
      action,
      rationale: text(item?.rationale, 700),
      findingCodes: stringList(item?.findingCodes).filter(code => findingCodes.has(code))
    }]
  }).slice(0, 16) as VirtualLearnerActorAuditOutput['recommendations']

  const hasStory = !!input.story && Object.keys(input.story).length > 0
  const rawScores = parsed?.scores || {}
  const scores: VirtualLearnerActorAuditOutput['scores'] = {
    overall: 0,
    personaConsistency: clampScore(rawScores.personaConsistency, 50),
    storyConsistency: hasStory ? clampScore(rawScores.storyConsistency, 50) : null,
    disclosureDiscipline: hasStory ? clampScore(rawScores.disclosureDiscipline, 50) : null,
    frictionCalibration: clampScore(rawScores.frictionCalibration, 50),
    stateContinuity: clampScore(rawScores.stateContinuity, 50),
    behaviorPlausibility: clampScore(rawScores.behaviorPlausibility, 50),
    evidenceSufficiency: clampScore(rawScores.evidenceSufficiency, evidence.length ? 60 : 20)
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
  const verdict: VirtualLearnerActorAuditOutput['verdict'] = scores.evidenceSufficiency < 50
    ? 'inconclusive'
    : hasCritical || scores.overall < 60
      ? 'invalid'
      : hasMajor || scores.overall < 80
        ? 'credible_with_concerns'
        : 'credible'

  return { verdict, scores, findings, recommendations, evidence }
}

export const virtualLearnerActorAuditorDefinition: SkillDefinition = {
  name: 'virtual-learner-actor-auditor',
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
    agentId: 'skill:virtual-learner-actor-auditor',
    defaultSystemPrompt: VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'virtual-learner-actor-auditor' },
    modelDefaults: { maxTokens: VIRTUAL_LEARNER_ACTOR_AUDITOR_MAX_TOKENS, temperature: VIRTUAL_LEARNER_ACTOR_AUDITOR_TEMPERATURE },
    buildUserPayload: value => value,
    validateParsedOutput: parsed => ({
      valid: !!parsed?.scores && Array.isArray(parsed?.findings) && Array.isArray(parsed?.evidence),
      failureReason: 'missing scores/findings/evidence'
    }),
    normalizeOutput: normalizeActorAuditOutput,
    mapEnvelope: (output, _input, runtimeContract) => mapSkillOutputEnvelope(runtimeContract, output, {
      phase: 'completed',
      isTerminal: true,
    }),
    retryStrategy: {
      maxAttempts: 2,
      onValidationFail: () => '请只输出合法 JSON，并完整包含 scores、findings、recommendations、evidence。'
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
