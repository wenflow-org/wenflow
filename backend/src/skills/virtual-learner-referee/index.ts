import { callPrompt } from '../../composers/prompt-composer'
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter'
import { loadPromptFile } from '../../composers/prompt-files/loader'
import type { SkillDefinition, SkillExecutionResult } from '../protocol'
import type { VirtualLearnerRefereeInput, VirtualLearnerRefereeOutput } from '../../virtual-lab/contracts'

export const VIRTUAL_LEARNER_REFEREE_MAX_TOKENS = 2400
export const VIRTUAL_LEARNER_REFEREE_TEMPERATURE = 0.2
export const VIRTUAL_LEARNER_REFEREE_PROMPT = loadPromptFile('skill:virtual-learner-referee')?.systemPrompt || ''

const SCORE_KEYS = [
  'goalExperience',
  'pathExperience',
  'teachingExperience',
  'controlConsistency',
  'boundaryIntegrity',
  'evidenceSufficiency'
] as const

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

function normalizeEvidence(value: unknown, input: VirtualLearnerRefereeInput): VirtualLearnerRefereeOutput['evidence'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item: any, position: number) => {
    const source = ['publicTrace', 'refereeTrace', 'control', 'experimentSummary'].includes(item?.source)
      ? item.source as VirtualLearnerRefereeOutput['evidence'][number]['source']
      : null
    if (!source) return []
    const index = item?.index === null || item?.index === undefined ? null : Number(item.index)
    if (source === 'publicTrace' && (!Number.isInteger(index) || index! < 0 || index! >= input.publicTrace.length)) return []
    if (source === 'refereeTrace' && (!Number.isInteger(index) || index! < 0 || index! >= input.refereeTrace.length)) return []
    const id = text(item?.id, 40) || `E${position + 1}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      source,
      index,
      path: text(item?.path, 180) || source,
      timestamp: text(item?.timestamp, 64) || null,
      traceId: text(item?.traceId, 120) || null,
      excerpt: text(item?.excerpt, 500),
      interpretation: text(item?.interpretation, 600)
    }]
  }).slice(0, 40)
}

export function normalizeRefereeOutput(parsed: any, input: VirtualLearnerRefereeInput): VirtualLearnerRefereeOutput {
  const evidence = normalizeEvidence(parsed?.evidence, input)
  const evidenceIds = new Set(evidence.map(item => item.id))
  const findings = (Array.isArray(parsed?.findings) ? parsed.findings : []).flatMap((item: any, index: number) => {
    const refs = stringList(item?.evidenceIds).filter(id => evidenceIds.has(id))
    if (!refs.length) return []
    const severity = ['critical', 'major', 'minor', 'info'].includes(item?.severity) ? item.severity : 'minor'
    const category = ['goal', 'path', 'teaching', 'control', 'boundary', 'completion', 'trace'].includes(item?.category)
      ? item.category : 'trace'
    return [{
      code: text(item?.code, 80) || `FINDING_${index + 1}`,
      severity,
      category,
      title: text(item?.title, 180) || '未命名发现',
      detail: text(item?.detail, 1000),
      evidenceIds: refs
    }]
  }).slice(0, 24) as VirtualLearnerRefereeOutput['findings']
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
  }).slice(0, 16) as VirtualLearnerRefereeOutput['recommendations']

  const coverage = input.experimentSummary.stageCoverage
  const rawScores = parsed?.scores || {}
  const scores: VirtualLearnerRefereeOutput['scores'] = {
    overall: 0,
    goalExperience: coverage.goal ? clampScore(rawScores.goalExperience, 50) : null,
    pathExperience: coverage.path ? clampScore(rawScores.pathExperience, 50) : null,
    teachingExperience: coverage.learning ? clampScore(rawScores.teachingExperience, 50) : null,
    controlConsistency: clampScore(rawScores.controlConsistency, 50),
    boundaryIntegrity: clampScore(rawScores.boundaryIntegrity, 50),
    evidenceSufficiency: clampScore(rawScores.evidenceSufficiency, evidence.length ? 60 : 20)
  }
  const weighted = [
    [scores.goalExperience, 20],
    [scores.pathExperience, 20],
    [scores.teachingExperience, 25],
    [scores.controlConsistency, 15],
    [scores.boundaryIntegrity, 10],
    [scores.evidenceSufficiency, 10]
  ].filter(([score]) => score !== null) as Array<[number, number]>
  const weightTotal = weighted.reduce((sum, [, weight]) => sum + weight, 0)
  scores.overall = weightTotal
    ? Math.round(weighted.reduce((sum, [score, weight]) => sum + score * weight, 0) / weightTotal)
    : 0

  const hasCritical = findings.some(item => item.severity === 'critical')
  const hasMajor = findings.some(item => item.severity === 'major')
  const verdict: VirtualLearnerRefereeOutput['verdict'] = scores.evidenceSufficiency < 50
    ? 'inconclusive'
    : hasCritical || scores.overall < 60
      ? 'fail'
      : hasMajor || scores.overall < 80
        ? 'pass_with_concerns'
        : 'pass'

  return { verdict, scores, findings, recommendations, evidence }
}

export const virtualLearnerRefereeDefinition: SkillDefinition = {
  name: 'virtual-learner-referee',
  displayName: '虚拟学习者实验裁判',
  version: '1.0.0',
  category: 'analysis',
  description: '基于 Blackbox 公开轨迹、旁路诊断和控制回执生成独立实验裁判报告。',
  inputSchema: {
    type: 'object',
    properties: {
      publicTrace: { type: 'array', description: '学习者实际可见的公开轨迹', required: true },
      refereeTrace: { type: 'array', description: '不回流学习者的旁路诊断轨迹', required: true },
      control: { type: 'object', description: '实验最终控制回执', required: true },
      experimentSummary: { type: 'object', description: '服务端生成的实验摘要', required: true }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'pass|pass_with_concerns|fail|inconclusive' },
      scores: { type: 'object', description: '各维度 0-100 分' },
      findings: { type: 'array', description: '带证据引用的问题发现' },
      recommendations: { type: 'array', description: '面向实验维护者的改进建议' },
      evidence: { type: 'array', description: '可定位到输入轨迹的证据' }
    }
  },
  capabilities: ['virtual-learner-experiment-referee', 'blackbox-trace-evaluation', 'side-channel-evidence-analysis'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
}

export async function virtualLearnerReferee(input: VirtualLearnerRefereeInput): Promise<SkillExecutionResult<VirtualLearnerRefereeOutput>> {
  const startedAt = Date.now()
  if (!input || !Array.isArray(input.publicTrace) || !Array.isArray(input.refereeTrace) || !input.control || !input.experimentSummary) {
    return {
      success: false,
      error: { code: 'INVALID_REFEREE_INPUT', message: 'Referee 输入必须只包含完整的四类实验数据' },
      duration: Date.now() - startedAt
    }
  }

  const result = await callPrompt<VirtualLearnerRefereeInput, VirtualLearnerRefereeOutput>({
    agentId: 'skill:virtual-learner-referee',
    defaultSystemPrompt: VIRTUAL_LEARNER_REFEREE_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'virtual-learner-referee' },
    modelDefaults: { maxTokens: VIRTUAL_LEARNER_REFEREE_MAX_TOKENS, temperature: VIRTUAL_LEARNER_REFEREE_TEMPERATURE },
    buildUserPayload: value => ({
      publicTrace: value.publicTrace,
      refereeTrace: value.refereeTrace,
      control: value.control,
      experimentSummary: value.experimentSummary
    }),
    validateParsedOutput: parsed => ({
      valid: !!parsed?.scores && Array.isArray(parsed?.findings) && Array.isArray(parsed?.evidence),
      failureReason: 'missing scores/findings/evidence'
    }),
    normalizeOutput: normalizeRefereeOutput,
    mapEnvelope: (output) => mapSkillOutputEnvelope('virtual-learner-referee', output, {
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
      error: result.error || { code: 'REFEREE_FAILED', message: '裁判报告生成失败' },
      duration: Date.now() - startedAt
    }
  }

  return {
    success: true,
    output: { ...result.output, runtimeEnvelope: result.runtimeEnvelope } as VirtualLearnerRefereeOutput,
    duration: result.debug.durationMs,
  }
}

export default virtualLearnerReferee
