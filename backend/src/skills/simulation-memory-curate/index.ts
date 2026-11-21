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
import { projectSimulatorPayload } from '../virtual-learner-shared'

export const VIRTUAL_LEARNER_MEMORY_CURATOR_MAX_TOKENS = 2400
export const VIRTUAL_LEARNER_MEMORY_CURATOR_TEMPERATURE = 0.3
export const VIRTUAL_LEARNER_MEMORY_CURATOR_PROMPT =
  loadPromptFile('skill:simulation-memory-curate')?.systemPrompt || ''

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

export type SelfCalibrationBias = 'accurate' | 'overestimate' | 'underestimate' | 'unknown'
export type TransferKind = 'own_words' | 'new_context' | 'reverse_explain' | 'none'

export interface TransferEvidence {
  concept: string
  kind: TransferKind
  evidence: string
}

export interface MemoryCuratorOutput {
  masteredConcepts: Array<{ name: string; evidence: string; confidence: number }>
  struggleConcepts: Array<{ name: string; blocker: string; severity: 'low' | 'medium' | 'high' }>
  /** 远迁移证据（2026-11-21）：none 时掌握 confidence 被代码压到 0.6，不能过掌握门 */
  transferEvidence: TransferEvidence[]
  /** 人读的校准说明（保留审计语义） */
  selfCalibration: string
  /** 机器读的确定性校准判决（2026-11-21）：代码优先读它，散文只做说明 */
  selfCalibrationBias: SelfCalibrationBias
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

function normalizeCalibrationBias(value: unknown, fallback: SelfCalibrationBias = 'unknown'): SelfCalibrationBias {
  return value === 'accurate' || value === 'overestimate' || value === 'underestimate' || value === 'unknown'
    ? value
    : fallback
}

function normalizeTransferKind(value: unknown): TransferKind {
  return value === 'own_words' || value === 'new_context' || value === 'reverse_explain' || value === 'none'
    ? value
    : 'none'
}

function normalizeTransferEvidence(value: unknown): TransferEvidence[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item: any) => {
    const concept = text(item?.concept, 80)
    if (!concept || seen.has(concept)) return []
    seen.add(concept)
    return [{
      concept,
      kind: normalizeTransferKind(item?.kind),
      evidence: text(item?.evidence, 300),
    }]
  }).slice(0, 10)
}

function conceptKey(value: string): string {
  return value.toLowerCase().replace(/[\s\u3000]+/g, '')
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
  // P2-33：fallback 文案必须自带**明确方向**，不能只写「按此校准」——下游是确定性解析器，
  // 无方向的 meta 句（旧文案一律含「校准」二字）会被判成『自评准确』并覆盖画像，
  // 等于把「LLM 失败」变成「把画像改写成 accurate」。
  const accuracy = typeof input.persona?.selfAssessmentAccuracy === 'string'
    ? input.persona.selfAssessmentAccuracy
    : ''
  const calibrationBias: SelfCalibrationBias = /overconfident|高估|偏高/.test(accuracy)
    ? 'overestimate'
    : /underconfident|低估|偏低/.test(accuracy)
      ? 'underestimate'
      : /accurate|准确|较准/.test(accuracy)
        ? 'accurate'
        : 'unknown'
  const calibration = calibrationBias === 'overestimate'
    ? '画像显示该学习者自评倾向高估，记忆按打折处理。'
    : calibrationBias === 'underestimate'
      ? '画像显示该学习者自评倾向低估，记忆可适度上修。'
      : calibrationBias === 'accurate'
        ? '画像显示该学习者自评基本准确。'
        : '本课未获得可用的自评校准信息，不作校准结论。'
  const memoryDelta = taskName
    ? masteredConcepts.length > 0
      ? `这课我掌握了 ${masteredConcepts.map((m) => m.name).join('、')}。`
      : struggleConcepts.length > 0
        ? `这课我在 ${struggleConcepts.map((s) => s.name).join('、')} 上还卡着。`
        : `这课没有明显的新增记忆。`
    : '本课记忆增量待补充。'
  return {
    masteredConcepts,
    struggleConcepts,
    // 确定性 fallback 没有可靠的远迁移证据：不写 transferEvidence（避免把「自评完成」硬说成迁移）。
    transferEvidence: [],
    selfCalibration: calibration,
    selfCalibrationBias: calibrationBias,
    memoryDelta,
  }
}

export function normalizeMemoryCuratorOutput(
  parsed: any,
  input: MemoryCuratorInput,
): MemoryCuratorOutput {
  const fallback = buildMemoryCuratorFallback(input)
  const transferEvidence = normalizeTransferEvidence(parsed?.transferEvidence)
  const transferByConcept = new Map(transferEvidence.map((item) => [conceptKey(item.concept), item]))
  const mastered = normalizeMastered(parsed?.masteredConcepts).map((item) => {
    // 远迁移门（2026-11-21）：明确登记 none（只会复述/支架内做对）时，掌握 confidence 压到
    // 0.6（低于代码侧 0.65 的 mastered 阈值）→ 本课不会被写成已掌握。
    // 未提供 transferEvidence 的旧输出保持原样（灰度兼容，不把存量全打回）。
    const transfer = transferByConcept.get(conceptKey(item.name))
    return transfer?.kind === 'none' && item.confidence > 0.6
      ? { ...item, confidence: 0.6 }
      : item
  })
  const struggle = normalizeStruggle(parsed?.struggleConcepts)
  return {
    masteredConcepts: mastered.length > 0 ? mastered : fallback.masteredConcepts,
    struggleConcepts: struggle.length > 0 ? struggle : fallback.struggleConcepts,
    transferEvidence,
    selfCalibration: text(parsed?.selfCalibration, 300) || fallback.selfCalibration,
    // 结构化判决优先；模型漏给/给错时回落到 fallback（画像先验或 unknown），不再靠散文猜。
    selfCalibrationBias: normalizeCalibrationBias(parsed?.selfCalibrationBias, fallback.selfCalibrationBias),
    memoryDelta: text(parsed?.memoryDelta, 300) || fallback.memoryDelta,
  }
}

export const virtualLearnerMemoryCuratorDefinition: SkillDefinition = {
  name: 'simulation-memory-curate',
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
      transferEvidence: { type: 'array', description: '远迁移证据（concept/kind/evidence）' },
      selfCalibration: { type: 'string', description: '自评可靠度说明' },
      selfCalibrationBias: { type: 'string', description: 'accurate|overestimate|underestimate|unknown（机器判决）' },
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
    agentId: 'skill:simulation-memory-curate',
    defaultSystemPrompt: VIRTUAL_LEARNER_MEMORY_CURATOR_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'simulation-memory-curate' },
    buildUserPayload: (value) => projectSimulatorPayload({
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
      onValidationFail: () => '请只输出合法 JSON，并完整包含 masteredConcepts、struggleConcepts、transferEvidence、selfCalibration、selfCalibrationBias、memoryDelta。',
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
