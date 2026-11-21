import { callPrompt } from '../../composers/prompt-composer'
import { mapSkillOutputEnvelope } from '../../services/prompt-lab/envelope-adapter'
import { loadPromptFile } from '../../composers/prompt-files/loader'
import type { SkillDefinition, SkillExecutionResult } from '../protocol'
import type { VirtualLearnerRefereeInput, VirtualLearnerRefereeOutput } from '../../virtual-lab/contracts'
import { hasAuditEvidenceValue } from '../virtual-learner-shared/audit-evidence'

export const VIRTUAL_LEARNER_REFEREE_MAX_TOKENS = 2400
export const VIRTUAL_LEARNER_REFEREE_TEMPERATURE = 0.2
export const VIRTUAL_LEARNER_REFEREE_PROMPT = loadPromptFile('skill:simulation-referee')?.systemPrompt || ''

const SCORE_KEYS = [
  'goalExperience',
  'goalUnderstanding',
  'pathExperience',
  'teachingExperience',
  'controlConsistency',
  'boundaryIntegrity',
  'evidenceSufficiency'
] as const

/**
 * 严格读分：缺字段、非数字、越界都算**无效**（不能用默认 50 分悄悄造出结论）。
 * 无效分会在 integrity.missingScores 留痕，并强制 verdict=inconclusive。
 */
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

function normalizeEvidence(value: unknown, input: VirtualLearnerRefereeInput): VirtualLearnerRefereeOutput['evidence'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item: any, position: number) => {
    const source = ['publicTrace', 'refereeTrace', 'control', 'experimentSummary', 'storyMeta', 'metricCompleteness'].includes(item?.source)
      ? item.source as VirtualLearnerRefereeOutput['evidence'][number]['source']
      : null
    if (!source) return []
    if (item?.index != null && typeof item.index !== 'number') return []
    const index = item?.index ?? null
    if (source === 'publicTrace' && (!Number.isInteger(index) || index! < 0 || index! >= input.publicTrace.length)) return []
    if (source === 'refereeTrace' && (!Number.isInteger(index) || index! < 0 || index! >= input.refereeTrace.length)) return []
    const indexed = source === 'publicTrace' || source === 'refereeTrace'
    if (!indexed && index !== null) return []
    const path = text(item?.path, 180)
    const root = source === 'publicTrace' ? input.publicTrace[index!]
      : source === 'refereeTrace' ? input.refereeTrace[index!] : input[source]
    if (!path || !hasAuditEvidenceValue(source, root, path)) return []
    const id = text(item?.id, 40) || `E${position + 1}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      source,
      index,
      path,
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
    const severity = ['critical', 'major', 'minor', 'info'].includes(item?.severity) ? item.severity : 'minor'
    const category = ['goal', 'path', 'teaching', 'control', 'boundary', 'completion', 'trace', 'data'].includes(item?.category)
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
  }).slice(0, 16) as VirtualLearnerRefereeOutput['recommendations']

  const coverage = input.experimentSummary.stageCoverage
  const rawScores = parsed?.scores || {}
  const requiredKeys = [
    'controlConsistency',
    'boundaryIntegrity',
    'evidenceSufficiency',
    ...(coverage.goal ? ['goalExperience'] : []),
    // 目标理解：只在有故事基准（真实问题）且 Goal 阶段被覆盖时评估
    ...(coverage.goal && input.storyMeta?.realProblem ? ['goalUnderstanding'] : []),
    ...(coverage.path ? ['pathExperience'] : []),
    ...(coverage.teaching ? ['teachingExperience'] : []),
  ]
  const required = new Set(requiredKeys)
  const missingScores: string[] = []
  const readRequired = (key: string, fallback: number): number => {
    const parsedScore = readScore(rawScores[key])
    if (!parsedScore.valid) {
      // 仍用 fallback 参与内部加权，但 integrity 已判定无效，最终 verdict 会被强制 inconclusive。
      if (required.has(key)) missingScores.push(key)
      return fallback
    }
    return parsedScore.value as number
  }
  const scores: VirtualLearnerRefereeOutput['scores'] = {
    overall: 0,
    goalExperience: coverage.goal ? readRequired('goalExperience', 50) : null,
    goalUnderstanding: coverage.goal && input.storyMeta?.realProblem
      ? readRequired('goalUnderstanding', 50)
      : null,
    pathExperience: coverage.path ? readRequired('pathExperience', 50) : null,
    teachingExperience: coverage.teaching ? readRequired('teachingExperience', 50) : null,
    controlConsistency: readRequired('controlConsistency', 50),
    boundaryIntegrity: readRequired('boundaryIntegrity', 50),
    evidenceSufficiency: readRequired('evidenceSufficiency', evidence.length ? 60 : 20)
  }
  // 数据契约门禁：跑过教学阶段却没有任何指标/wrapup 产出 → 证据不足，不得给出结论性裁判
  const metricCompleteness = input.metricCompleteness
  const allMetricsMissing = metricCompleteness?.available === true
    && metricCompleteness.teachingSessions > 0
    && metricCompleteness.metricsPresent === 0
    && metricCompleteness.wrapupPresent === 0
  if (allMetricsMissing) {
    scores.evidenceSufficiency = Math.min(scores.evidenceSufficiency, 45)
  }

  // 完整性门：缺分/非法分/悬空**证据引用**一律判 inconclusive。
  // findingCodes 悬空只做诊断（推荐项允许引用被过滤的 finding，不改变裁判结论）。
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
    [scores.goalExperience, 15],
    [scores.goalUnderstanding, 10],
    [scores.pathExperience, 20],
    [scores.teachingExperience, 25],
    [scores.controlConsistency, 12],
    [scores.boundaryIntegrity, 8],
    [scores.evidenceSufficiency, 10]
  ].filter(([score]) => score !== null) as Array<[number, number]>
  const weightTotal = weighted.reduce((sum, [, weight]) => sum + weight, 0)
  scores.overall = weightTotal
    ? Math.round(weighted.reduce((sum, [score, weight]) => sum + score * weight, 0) / weightTotal)
    : 0

  const hasCritical = findings.some(item => item.severity === 'critical')
  const hasMajor = findings.some(item => item.severity === 'major')
  const verdict: VirtualLearnerRefereeOutput['verdict'] = !integrity.valid || scores.evidenceSufficiency < 50
    ? 'inconclusive'
    : hasCritical || scores.overall < 60
      ? 'fail'
      : hasMajor || scores.overall < 80
        ? 'pass_with_concerns'
        : 'pass'

  return { verdict, scores, findings, recommendations, evidence, integrity }
}

export const virtualLearnerRefereeDefinition: SkillDefinition = {
  name: 'simulation-referee',
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
      experimentSummary: { type: 'object', description: '服务端生成的实验摘要', required: true },
      storyMeta: { type: 'object', description: '平行通道：故事元数据与当次诉求（surfaceGoal/realProblem/demandText），不进入主链' },
      metricCompleteness: { type: 'object', description: '数据完整性：教学指标与 wrapup 产出情况（判 evidenceSufficiency 用）' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'pass|pass_with_concerns|fail|inconclusive' },
      scores: { type: 'object', description: '各维度 0-100 分（含 goalUnderstanding 目标理解维度）' },
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
    agentId: 'skill:simulation-referee',
    defaultSystemPrompt: VIRTUAL_LEARNER_REFEREE_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'simulation-referee' },
        buildUserPayload: value => ({
      publicTrace: value.publicTrace,
      refereeTrace: value.refereeTrace,
      control: value.control,
      experimentSummary: value.experimentSummary,
      // 断链修复（§3.19 P1⑨）：yaml 声明了这两个输入、代码打分也在用（goalUnderstanding 依赖
      // storyMeta.realProblem；evidenceSufficiency 依赖 metricCompleteness），但此前没发给模型。
      storyMeta: value.storyMeta ?? null,
      metricCompleteness: value.metricCompleteness ?? null,
    }),
    validateParsedOutput: parsed => ({
      valid: !!parsed?.scores && Array.isArray(parsed?.findings) && Array.isArray(parsed?.evidence),
      failureReason: 'missing scores/findings/evidence'
    }),
    softValidateParsedOutput: (parsed) => normalizeRefereeOutput(parsed, input).integrity?.valid
      ? { valid: true }
      : { valid: false, failureReason: '裁判分数或证据无效。至少引用一项输入中的实际字段，且每条发现都须引用有效证据。' },
    normalizeOutput: normalizeRefereeOutput,
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
