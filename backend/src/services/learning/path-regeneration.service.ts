/**
 * 路径主结构重生成（学员端「重新生成」与后台「重试生成」共用）。
 *
 * 质量口径（2026-09-26 实锤）：重建必须回灌目标对话的结构化画像——只带 description
 * 时规划器只看得到被污染的单行，产出全是认知脚手架、没有学科内容。所以优先用
 * path.aiPromptTemplate.goalFinalPayload，其次回查来源目标对话的 collectedData；
 * 两者都取不到才退回裸 description（旧行为，仅兜底）。
 */
import pathOrchestrator from '../../coordinators/path.coordinator'
import { logger } from '../../utils/logger'
import { findGoalConversationForPathSummary } from './learning-routes.repo'
import { buildGoalPathVisibleSummary } from './goal-path-visible-summary'
import { resolveLearnerLoadProfileFromCollectedData } from './learner-load-profile'
import { assertExistingPathGoalTriageAllowed } from './goal-triage-evidence'
import learningService from './learning.service'

export interface RegenerablePath {
  id: string
  userId: string
  title?: string | null
  name?: string | null
  description?: string | null
  subject?: string | null
  aiPromptTemplate?: string | null
  /** 服务端生成管线建的路径标记（#227：存量失败占位救援档需要，用户建的空壳为 false） */
  aiGenerated?: boolean | null
  activeGenerationRunId?: string | null
  deadline?: Date | null
  deadlineText?: string | null
}

export function parsePromptTemplate(aiPromptTemplate?: string | null): Record<string, any> | null {
  if (!aiPromptTemplate) return null
  try {
    const parsed = JSON.parse(aiPromptTemplate)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function extractStoredSourceConversationId(aiPromptTemplate?: string | null): string | undefined {
  if (!aiPromptTemplate) return undefined

  try {
    const parsed = JSON.parse(aiPromptTemplate)
    const handoffInputId = typeof parsed?.goalFinalPayload?.sourceConversationId === 'string'
      ? parsed.goalFinalPayload.sourceConversationId
      : null
    if (handoffInputId) return handoffInputId

    const normalizedInputId = typeof parsed?.normalizedInput?.sourceConversationId === 'string'
      ? parsed.normalizedInput.sourceConversationId
      : null
    if (normalizedInputId) return normalizedInputId

    const generationStatusId = typeof parsed?.generationStatus?.sourceConversationId === 'string'
      ? parsed.generationStatus.sourceConversationId
      : null
    if (generationStatusId) return generationStatusId

    const directId = typeof parsed?.sourceConversationId === 'string'
      ? parsed.sourceConversationId
      : null
    if (directId) return directId
  } catch {
    // Ignore malformed historical prompt templates.
  }

  return undefined
}

/**
 * 重生成锁快照（资料跟路径生成走）：从原路径模板的资料 pack 快照提取 materialId 集合，
 * 作为显式挂载列表回传给 path.coordinator——重试/重生成/重建不再重新扫库，
 * 同一条路径的资料集在其生命周期内保持稳定（重扫会因资料库变化悄悄换掉路径资料）。
 * 模板没有资料 pack（或全无 materialId）时返回 undefined：不携带字段 = 沿用存量自动语义。
 */
export function extractPathMaterialIds(parsed: Record<string, any> | null | undefined): string[] | undefined {
  if (!parsed) return undefined
  const candidates = [
    parsed?.sceneFraming?.normalizedInput?.resources?.materials,
    parsed?.normalizedInput?.resources?.materials,
    parsed?.normalizedInputSnapshot?.resources?.materials,
  ]
  for (const list of candidates) {
    if (!Array.isArray(list)) continue
    const ids: string[] = []
    for (const entry of list) {
      const materialId = typeof entry?.pack?.materialId === 'string'
        ? entry.pack.materialId
        : (typeof entry?.materialId === 'string' ? entry.materialId : null)
      if (materialId && !ids.includes(materialId)) ids.push(materialId)
    }
    if (ids.length > 0) return ids
  }
  return undefined
}

export function buildStoredGoalPathRequest(path: RegenerablePath, adjustments?: string | null) {
  const parsed = parsePromptTemplate(path.aiPromptTemplate)
  const goalFinalPayload = parsed?.goalFinalPayload && typeof parsed.goalFinalPayload === 'object'
    ? parsed.goalFinalPayload
    : null

  if (!goalFinalPayload) {
    return null
  }

  return {
    userId: path.userId,
    source: 'goal' as const,
    mode: 'generate' as const,
    sourceConversationId: typeof goalFinalPayload.sourceConversationId === 'string' ? goalFinalPayload.sourceConversationId : undefined,
    existingPathId: path.id,
    rawGoal: typeof goalFinalPayload.rawGoal === 'string' && goalFinalPayload.rawGoal.trim()
      ? goalFinalPayload.rawGoal
      : (path.description || ''),
    adjustments: typeof adjustments === 'string' && adjustments.trim() ? adjustments.trim() : null,
    visibleSummary: goalFinalPayload.visibleSummary || null,
    conversationHistory: Array.isArray(goalFinalPayload.conversationHistory) ? goalFinalPayload.conversationHistory : [],
    finalUserVisible: typeof goalFinalPayload.finalUserVisible === 'string' ? goalFinalPayload.finalUserVisible : undefined,
    prerequisiteCheckResults: Array.isArray(goalFinalPayload.prerequisiteCheckResults)
      ? goalFinalPayload.prerequisiteCheckResults
      : null,
    goalHandoffFields: goalFinalPayload.goalHandoffFields && typeof goalFinalPayload.goalHandoffFields === 'object'
      ? goalFinalPayload.goalHandoffFields
      : undefined,
    // 重生成锁快照（资料跟路径生成走）：优先读 goalFinalPayload.materialIds（显式挂载随
    // GoalPathRequest 持久化，失败占位路径重试时 packs 尚未写入），回落到资料 pack 快照。
    // 显式空数组必须原样保留（[] = 显式不挂载，重生成零注入，不得回退扫库）；
    // 两者皆无（老模板且零资料注入）=不携带字段，保持存量自动语义。
    ...(() => {
      const storedIds = Array.isArray(goalFinalPayload.materialIds)
        ? goalFinalPayload.materialIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : extractPathMaterialIds(parsed);
      return storedIds !== undefined ? { materialIds: storedIds } : {};
    })(),
  }
}

export async function buildGoalPathRequestFromConversation(path: RegenerablePath) {
  const sourceConversationId = extractStoredSourceConversationId(path.aiPromptTemplate)
  const conversation = await findGoalConversationForPathSummary(sourceConversationId, path.id, path.userId)

  if (!conversation) {
    return null
  }

  let collectedData: Record<string, any> = {}
  try {
    collectedData = JSON.parse(conversation.collectedData || '{}')
  } catch {
    collectedData = {}
  }

  const messages = Array.isArray(collectedData.messages) ? collectedData.messages : []

  return {
    userId: conversation.userId,
    source: 'goal' as const,
    mode: 'generate' as const,
    sourceConversationId: conversation.id,
    existingPathId: path.id,
    rawGoal: conversation.description || path.description || '',
    visibleSummary: buildGoalPathVisibleSummary({
      understanding: collectedData.understanding || {},
      confirmedProposal: collectedData.confirmedProposal || null,
      collected: collectedData.collected || {},
    }),
    conversationHistory: messages
      .map((message: any) => ({
        role: message?.role === 'user' ? 'user' : 'assistant',
        content: typeof message?.content === 'string' ? message.content : ''
      }))
      .filter((message: { role: string; content: string }) => message.content),
    finalUserVisible: typeof collectedData.finalUserVisible === 'string' ? collectedData.finalUserVisible : undefined,
    structuredData: (collectedData as any)?.structuredData || null,
    learnerLoadProfile: resolveLearnerLoadProfileFromCollectedData(collectedData),
    prerequisiteCheckResults: Array.isArray(collectedData.understanding?.prerequisiteCheckResults)
      ? collectedData.understanding.prerequisiteCheckResults
      : null,
    // 重生成锁快照：沿用原路径注入的资料集（显式口径），不再重新扫库
    ...(extractPathMaterialIds(parsePromptTemplate(path.aiPromptTemplate))
      ? { materialIds: extractPathMaterialIds(parsePromptTemplate(path.aiPromptTemplate)) }
      : {}),
  }
}

/**
 * 认领一次 core 生成并按「目标画像优先」的链路重跑主结构。
 * 调用方负责前置状态校验（失败态/无进度）与审计；这里只做认领 + 触发。
 *
 * #227：认领前先过既有路径的 goal 闸门（豁免前提是「这条路径自身携带服务端产出
 * 的 goal 判定」，或它自己存的来源会话凭证）——与 `pathOrchestrator.generate`
 * 里那道唯一闸门同口径，前置只是为了让调用方拿到明确错误，而不是
 * 「返回成功、路径却在后台被闸门拦下并记成失败」。
 */
export async function regeneratePathCoreFromStoredGoal(
  path: RegenerablePath,
  options: { adjustments?: string | null } = {}
): Promise<{ runId: string; mode: 'goal' | 'fallback' }> {
  const adjustments = options.adjustments ?? null
  await assertExistingPathGoalTriageAllowed(
    path,
    extractStoredSourceConversationId(path.aiPromptTemplate) ?? null,
  )

  const runId = await learningService.claimPathCoreGeneration(path.id, path.activeGenerationRunId ?? null)

  const onError = async (error: unknown) => {
    logger.error(`重新生成学习路径失败：${path.id}`, error)
    await learningService.markActiveGenerationFailed(path.id, error, runId)
  }

  const storedGoalRequest = buildStoredGoalPathRequest(path, adjustments)
    || await buildGoalPathRequestFromConversation(path)

  if (storedGoalRequest) {
    pathOrchestrator.runGoalAsync({ ...storedGoalRequest, generationRunId: runId }, { onError })
    return { runId, mode: 'goal' }
  }

  const sourceConversationId = extractStoredSourceConversationId(path.aiPromptTemplate)
  pathOrchestrator.runAsync({
    userId: path.userId,
    description: path.description || path.title || path.name || '个性化学习路径',
    subject: path.subject || undefined,
    deadline: path.deadline || undefined,
    deadlineText: path.deadlineText || undefined,
    sourceConversationId,
    existingPathId: path.id,
    generationRunId: runId,
    userProfile: adjustments ? { replan: { mode: 'regenerate-user', reason: adjustments, sourcePathId: path.id } } : {}
  }, { onError })

  return { runId, mode: 'fallback' }
}
