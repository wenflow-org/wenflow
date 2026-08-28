/**
 * Virtual Learner Memory Curator Skill
 *
 * 课后记忆提炼器：以虚拟学习者本人视角，从课堂回合序列中提炼
 * "他自己觉得学会了什么 / 卡在哪 / 为什么"，产出可沉淀到画像的记忆增量。
 *
 * - LLM 主路径：理解对话回合 + persona 自评校准，输出带 evidence 的记忆
 * - 确定性 fallback：复用 learner-memory 的 selfExtractLearnerMemory 规则，
 *   LLM 失败时记忆不丢，只少一层"理由"
 *
 * 设计边界：只做虚拟学习者侧记忆，不评价平台、不产生实时课堂动作。
 */
import { callPrompt } from '../../composers/prompt-composer'
import { loadPromptFile } from '../../composers/prompt-files/loader'
import type { SkillDefinition, SkillExecutionResult } from '../protocol'
import { selfExtractLearnerMemory, type SelfReportedLearnerState } from '../../virtual-lab/learner-memory'

export const VIRTUAL_LEARNER_MEMORY_CURATOR_MAX_TOKENS = 2400
export const VIRTUAL_LEARNER_MEMORY_CURATOR_TEMPERATURE = 0.3
export const VIRTUAL_LEARNER_MEMORY_CURATOR_PROMPT =
  loadPromptFile('skill:virtual-learner-memory-curator')?.systemPrompt || ''

/** 本课回合的压缩视图（供 LLM 提炼证据） */
export interface MemoryCuratorTurn {
  turn: number
  reply: string
  emotion?: string | null
  learnerState?: {
    phaseFocus?: string
    conceptualMastery?: number
    taskUnderstanding?: number
    wantsHint?: boolean
  } | null
  learnerFeedback?: {
    selfReportedTaskDone?: boolean
    confidence?: number
    wantsMoreHelp?: boolean
    remainingBlockers?: string[]
  } | null
}

export interface MemoryCuratorInput {
  persona?: Record<string, any> | null
  turnSequence?: MemoryCuratorTurn[] | null
  currentTask?: {
    title?: string | null
    linkedConcept?: string | null
    acceptanceCriteria?: string | null
  } | null
  existingKnown?: string[] | null
  existingStruggle?: string[] | null
}

export interface MemoryCuratorOutput {
  masteredConcepts: Array<{ name: string; evidence: string; confidence: number }>
  struggleConcepts: Array<{ name: string; blocker: string; severity: 'low' | 'medium' | 'high' }>
  selfCalibration: string
  memoryDelta: string
}

function text(value: unknown, limit = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function clamp01(value: unknown, fallback = 0.5): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.min(1, num))
}

function clampSeverity(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'high' ? value : 'medium'
}

function normalizeMastered(value: unknown): MemoryCuratorOutput['masteredConcepts'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item: any) => {
    const name = text(item?.name, 80)
    if (!name || seen.has(name)) return []
    seen.add(name)
    return [{
      name,
      evidence: text(item?.evidence, 300),
      confidence: clamp01(item?.confidence, 0.6),
    }]
  }).slice(0, 10)
}

function normalizeStruggle(value: unknown): MemoryCuratorOutput['struggleConcepts'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item: any) => {
    const name = text(item?.name, 80)
    if (!name || seen.has(name)) return []
    seen.add(name)
    return [{
      name,
      blocker: text(item?.blocker, 300),
      severity: clampSeverity(item?.severity),
    }]
  }).slice(0, 10)
}

/** 从回合序列聚合出收束轮的自我状态（供确定性 fallback） */
function aggregateSelfState(input: MemoryCuratorInput): SelfReportedLearnerState | null {
  const turns = Array.isArray(input.turnSequence) ? input.turnSequence : []
  if (turns.length === 0) return null
  const latest = turns[turns.length - 1]
  return {
    conceptName: input.currentTask?.linkedConcept || input.currentTask?.title || null,
    conceptualMastery: latest.learnerState?.conceptualMastery ?? null,
    taskUnderstanding: latest.learnerState?.taskUnderstanding ?? null,
    selfReportedTaskDone: latest.learnerFeedback?.selfReportedTaskDone ?? null,
    confidence: latest.learnerFeedback?.confidence ?? null,
    wantsMoreHelp: latest.learnerFeedback?.wantsMoreHelp ?? null,
    remainingBlockers: latest.learnerFeedback?.remainingBlockers ?? null,
    wantsHint: latest.learnerState?.wantsHint ?? null,
  }
}

/** 确定性 fallback：复用 learner-memory 的自述提炼规则（LLM 不可用时记忆不丢） */
export function buildMemoryCuratorFallback(input: MemoryCuratorInput): MemoryCuratorOutput {
  const selfState = aggregateSelfState(input)
  const extracted = selfExtractLearnerMemory(selfState)
  const taskName = input.currentTask?.linkedConcept || input.currentTask?.title || null
  const masteredConcepts = extracted.mastered.map((name) => ({
    name,
    evidence: '自评掌握度高且自认完成（确定性规则）',
    confidence: 0.7,
  }))
  const struggleConcepts = extracted.struggling.map((name) => ({
    name,
    blocker: selfState?.remainingBlockers?.[0] || '自评掌握度低或仍有卡点',
    severity: 'medium' as const,
  }))
  const calibration = input.persona?.selfAssessmentAccuracy
    ? `画像显示该学习者自评${typeof input.persona.selfAssessmentAccuracy === 'string' ? input.persona.selfAssessmentAccuracy : '存在偏差'}，记忆按此校准。`
    : '未提供画像自评校准信息。'
  const memoryDelta = taskName
    ? masteredConcepts.length > 0
      ? `这课我掌握了 ${masteredConcepts.map((m) => m.name).join('、')}。`
      : struggleConcepts.length > 0
        ? `这课我在 ${struggleConcepts.map((s) => s.name).join('、')} 上还卡着。`
        : `这课没有明显的新增记忆。`
    : '本课记忆增量待补充。'
  return { masteredConcepts, struggleConcepts, selfCalibration: calibration, memoryDelta }
}

export function normalizeMemoryCuratorOutput(
  parsed: any,
  input: MemoryCuratorInput,
): MemoryCuratorOutput {
  const fallback = buildMemoryCuratorFallback(input)
  const mastered = normalizeMastered(parsed?.masteredConcepts)
  const struggle = normalizeStruggle(parsed?.struggleConcepts)
  return {
    masteredConcepts: mastered.length > 0 ? mastered : fallback.masteredConcepts,
    struggleConcepts: struggle.length > 0 ? struggle : fallback.struggleConcepts,
    selfCalibration: text(parsed?.selfCalibration, 300) || fallback.selfCalibration,
    memoryDelta: text(parsed?.memoryDelta, 300) || fallback.memoryDelta,
  }
}

export const virtualLearnerMemoryCuratorDefinition: SkillDefinition = {
  name: 'virtual-learner-memory-curator',
  displayName: '虚拟学习者课后记忆提炼 Skill',
  version: '1.0.0',
  category: 'analysis',
  description: '以虚拟学习者本人视角，从课堂回合中提炼"自己觉得学会了什么、卡在哪"，产出可沉淀的记忆增量。',
  inputSchema: {
    type: 'object',
    properties: {
      persona: { type: 'object', description: '稳定画像（selfAssessmentAccuracy 等）' },
      turnSequence: { type: 'array', description: '本课回合序列（reply/emotion/learnerState/learnerFeedback 压缩视图）' },
      currentTask: { type: 'object', description: '当前任务（title/linkedConcept/acceptanceCriteria）' },
      existingKnown: { type: 'array', description: '画像已沉淀 knownConcepts' },
      existingStruggle: { type: 'array', description: '画像已沉淀 struggleConcepts' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      masteredConcepts: { type: 'array', description: '自己觉得学会的概念（name/evidence/confidence）' },
      struggleConcepts: { type: 'array', description: '自己觉得没学会的概念（name/blocker/severity）' },
      selfCalibration: { type: 'string', description: '自评可靠度说明' },
      memoryDelta: { type: 'string', description: '本课记忆增量一句话' },
    },
  },
  capabilities: ['virtual-learner-memory-curation', 'self-reported-mastery-extraction', 'persona-calibrated-self-assessment'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 },
}

export async function virtualLearnerMemoryCurator(
  input: MemoryCuratorInput,
): Promise<SkillExecutionResult<MemoryCuratorOutput>> {
  const startedAt = Date.now()

  const result = await callPrompt<MemoryCuratorInput, MemoryCuratorOutput>({
    agentId: 'skill:virtual-learner-memory-curator',
    defaultSystemPrompt: VIRTUAL_LEARNER_MEMORY_CURATOR_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'virtual-learner-memory-curator' },
    buildUserPayload: (value) => ({
      persona: value.persona || null,
      turnSequence: Array.isArray(value.turnSequence) ? value.turnSequence.slice(-24) : [],
      currentTask: value.currentTask || null,
      existingKnown: Array.isArray(value.existingKnown) ? value.existingKnown.slice(0, 30) : [],
      existingStruggle: Array.isArray(value.existingStruggle) ? value.existingStruggle.slice(0, 30) : [],
    }),
    validateParsedOutput: (parsed) => ({
      valid: !!parsed && typeof parsed === 'object' && Array.isArray(parsed?.masteredConcepts)
        && Array.isArray(parsed?.struggleConcepts),
      failureReason: 'missing masteredConcepts/struggleConcepts',
    }),
    normalizeOutput: normalizeMemoryCuratorOutput,
    retryStrategy: {
      maxAttempts: 2,
      onValidationFail: () => '请只输出合法 JSON，并完整包含 masteredConcepts、struggleConcepts、selfCalibration、memoryDelta。',
    },
  }, input)

  if (!result.success || !result.output) {
    // failurePolicy=fallback：LLM 失败 → 确定性提炼兜底（记忆不丢）
    return {
      success: true,
      output: {
        ...buildMemoryCuratorFallback(input),
        _debug: { degraded: true, reason: result.error?.message || 'memory-curator-llm-failed' },
      } as unknown as MemoryCuratorOutput,
      duration: Date.now() - startedAt,
      quality: 'fallback',
    }
  }

  return {
    success: true,
    output: { ...result.output, _debug: result.debug } as unknown as MemoryCuratorOutput,
    duration: result.debug.durationMs,
  }
}

export default virtualLearnerMemoryCurator
