/**
 * 虚拟学习者会话预算解析（单一事实来源）
 *
 * 背景：此前「AI 调用上限」「每课回合上限」「单步重试」三个概念混在一起，
 * 且解析分散在 coordinator / autopilot / 前端 SessionCockpit 三处，导致：
 *  - 后端实际不限、前端却兜底显示 600（显示撒谎）；
 *  - 回合上限被当成失败终止，而不是可续的分片边界。
 *
 * 本模块把两类限制彻底分开：
 *  - 工作预算 turnChunkPerLesson：一次自动推进跑多少「回合分片」；跑完不收敛=分片边界，可续。
 *  - 成本护栏 costCeiling：一次会话累计 AI 调用（含重试）上限；到顶=基础设施事故，终态。
 * 解析顺序固定：故事级 budget > 画像级 simulationBudget > 默认。只有这里解析，其他地方消费。
 */

export const DEFAULT_TURN_CHUNK_PER_LESSON = 40
export const DEFAULT_MAX_RETRIES_PER_STEP = 8
/** 无进展看门狗：连续多少个分片「知识看板 + 任务进度」零净变化即判定卡死 */
export const DEFAULT_NO_PROGRESS_CHUNK_LIMIT = 3
/** 成本护栏钳制上界（防止手误写入近无限值） */
export const MAX_COST_CEILING = 100_000

export interface ResolvedSessionBudget {
  /** 会话累计 AI 调用成本上限；null = 不限 */
  costCeiling: number | null
  /** 是否不限成本（costCeiling === null） */
  unlimited: boolean
  /** 单步上游调用失败后的重试次数 */
  maxRetriesPerStep: number
  /** 每课自动推进的「分片」回合数（不是终止阈值） */
  turnChunkPerLesson: number
  /** 连续无进展分片数达到该值即判定卡死并停止 */
  noProgressChunkLimit: number
  /** 预算来源，供前端/日志说明 */
  source: 'story' | 'profile' | 'default'
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析会话生效预算。stageResults 与 profileData 均可选（缺失时用默认）。
 * 故事级 `stageResults.story.budget` 覆盖画像级 `profileData.simulationBudget`。
 */
export function resolveSessionBudget(params: {
  stageResults?: Record<string, any> | null
  profileData?: Record<string, any> | null
}): ResolvedSessionBudget {
  const stageResults = isRecord(params.stageResults) ? params.stageResults : {}
  const profileData = isRecord(params.profileData) ? params.profileData : {}

  const storyBudget = isRecord(stageResults.story) && isRecord((stageResults.story as Record<string, any>).budget)
    ? ((stageResults.story as Record<string, any>).budget as Record<string, any>)
    : null
  const profileBudget = isRecord(profileData.simulationBudget) ? (profileData.simulationBudget as Record<string, any>) : null
  const runtimePrefs = isRecord(profileData.runtimePrefs) ? (profileData.runtimePrefs as Record<string, any>) : {}
  const simulationConfig = isRecord(stageResults.simulationConfig) ? (stageResults.simulationConfig as Record<string, any>) : {}

  const source: ResolvedSessionBudget['source'] = storyBudget ? 'story' : profileBudget ? 'profile' : 'default'
  const budget = storyBudget || profileBudget || {}

  const maxRetriesPerStep = clampInt(budget.maxRetriesPerStep, DEFAULT_MAX_RETRIES_PER_STEP, 1, 20)

  // costCeiling：兼容旧键 maxRetriesTotal；null/<=0 视为不限
  const rawCeiling = budget.costCeiling ?? budget.maxRetriesTotal
  const costCeiling = rawCeiling === undefined || rawCeiling === null || Number(rawCeiling) <= 0
    ? null
    : clampInt(rawCeiling, 600, 1, MAX_COST_CEILING)

  // 分片回合数：故事/画像显式 > 画像运行偏好 > 会话 simulationConfig > 默认
  const turnChunkPerLesson = clampInt(
    budget.turnChunkPerLesson ?? runtimePrefs.turnCapPerLesson ?? simulationConfig.turnCapPerLesson,
    DEFAULT_TURN_CHUNK_PER_LESSON,
    1,
    100
  )

  const noProgressChunkLimit = clampInt(budget.noProgressChunkLimit, DEFAULT_NO_PROGRESS_CHUNK_LIMIT, 1, 20)

  return {
    costCeiling,
    unlimited: costCeiling === null,
    maxRetriesPerStep,
    turnChunkPerLesson,
    noProgressChunkLimit,
    source,
  }
}

/**
 * 学习进度指纹：用于无进展看门狗判断「一个分片是否产生净进展」。
 * 组成：已完成任务数 + 当前任务 + 知识看板各状态计数。
 * 指纹跨分片不变 = 这 40 回合没有推进任何东西 = 疑似教学死循环。
 */
export function computeLearnProgressSignature(
  stageResults: Record<string, any> | null | undefined,
  counters: { completedTasks?: number | null; currentTaskId?: string | null } = {}
): string {
  const teaching = isRecord(stageResults) && isRecord((stageResults as Record<string, any>).teaching)
    ? ((stageResults as Record<string, any>).teaching as Record<string, any>)
    : {}
  const kp = Array.isArray(teaching.knowledgeState) ? teaching.knowledgeState : []
  let mastered = 0
  let touched = 0
  for (const point of kp) {
    if (!isRecord(point)) continue
    const status = String(point.status || '')
    if (status === 'mastered') mastered += 1
    if (status === 'mastered' || status === 'review' || status === 'learning') touched += 1
  }
  const completedTasks = Number(counters.completedTasks) || 0
  const currentTaskId = counters.currentTaskId ? String(counters.currentTaskId) : ''
  return `${completedTasks}|${currentTaskId}|${mastered}|${touched}|${kp.length}`
}
