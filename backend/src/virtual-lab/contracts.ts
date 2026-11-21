export type LearnerAction =
  | { type: 'chat'; text: string }
  | { type: 'request_hint'; text: string }
  | { type: 'request_example'; text: string }
  | {
      /**
       * 延伸意愿（#124）：任务已达标（completion candidate）后，学习者表示还想就本课内容继续深入。
       * 平台不结算任务，继续陪学；autoStep 侧有次数上限，防止把收束点拖成无限轮。
       */
      type: 'request_extension'
      text: string
    }
  | { type: 'submit_answer'; answer: string; checkpointId?: string; selectedOptionIds?: string[]; skip?: boolean }
  | { type: 'submit_code'; code: string }
  | {
      type: 'confirm_proposal'
      text: string
      /** 前置自测作答（随确认一次性提交；见 virtual-lab/probe-answers.ts） */
      probeAnswers?: Array<{ probeId: string; userAnswer: string; targetConcept?: string }>
    }
  | { type: 'start_learning'; taskId?: string }
  | { type: 'confirm_complete' }
  | { type: 'skip'; reason: string }
  | { type: 'abandon'; reason: string }

export type LearnerObservation = {
  stage: 'goal' | 'path' | 'teaching' | 'completed' | 'error'
  visibleMessages: Array<{
    role: 'platform' | 'learner'
    content: string
  }>
  visibleChoices?: string[]
  visiblePath?: {
    id: string
    title: string
    description?: string | null
    status?: string | null
    milestones: Array<{ title: string; description?: string | null }>
  }
  visibleTask?: {
    id: string
    title: string
    description?: string | null
    /** 任务锚定概念（平台侧真实字段，供模拟器知识看板使用） */
    linkedConcept?: string
  }
  /**
   * 待作答的理解检查点（**不含答案键**；答案键只在服务端保留）。
   * 有值时可用 `submit_answer`（带 `checkpointId`）走检查点提交接口，而不是普通聊天接口。
   */
  visibleCheckpoint?: {
    id: string
    type: 'single_choice' | 'multi_choice' | 'short_answer'
    question: string
    options?: Array<{ id: string; text: string }>
    allowSkip?: boolean
  }
  availableActions: LearnerAction['type'][]
  lastActionResult?: {
    status: 'success' | 'error'
    visibleMessage: string
  }
}

export type TaskCompletionCheckpoint = {
  taskId: string
  teachingSessionId: string
  teachingRevision: number | null
  status: 'teaching_finalized' | 'task_completed'
  updatedAt: string
  lastError?: string
}

export type PlatformControlReceipt = {
  conversationId?: string
  learningPathId?: string
  teachingSessionId?: string | null
  teachingRevision?: number | null
  taskId?: string | null
  taskCompletionCheckpoint?: TaskCompletionCheckpoint | null
  /**
   * 延伸课（#124）：`pending`=学习者已表达延伸意愿、等本课结算后开课；
   * `active`=延伸课进行中（`extensionMode`）；`completed`=已 end_only 收束、回到路径。
   */
  extensionPhase?: 'pending' | 'active' | 'completed' | 'cancelled'
  extensionMode?: boolean
  extensionTaskId?: string | null
  extensionSourceSessionId?: string | null
  extensionTurns?: number
  /** 学习者表达延伸意愿的原话（开延伸课时作为开场白） */
  extensionText?: string | null
  platformStage?: string
  goalCompleted?: boolean
  /**
   * 平台实际返回的 Goal 硬阻断。案例的预期由实验配置单独声明。
   */
  hardBlocked?: boolean
  goalTerminalKind?: 'answer_only' | 'no_path' | 'hard_blocked' | 'path_bound'
  taskCompleted?: boolean
  completedTasks?: number
  totalTasks?: number
  runCompleted?: boolean
  terminalReason?: 'completed' | 'abandoned' | 'failed'
  terminalCode?: string
  terminalDetail?: string
  rawTraceId?: string
}

export type PlatformInteractionResult = {
  observation: LearnerObservation
  control: PlatformControlReceipt
  diagnostic?: Record<string, unknown>
}

export type ExperimentIdentity = {
  experimentId: string
  runId: string
  virtualSessionId: string
  profileId: string
}

export type BlackboxPublicTraceEntry = {
  timestamp: string
  observation: LearnerObservation
  control: PlatformControlReceipt
}

export type BlackboxRefereeTraceEntry = {
  timestamp: string
  traceId: string | null
  diagnostic: Record<string, unknown> | null
}

export type BlackboxExperimentSummary = {
  experimentId: string
  runId: string
  virtualSessionId: string
  mode: 'blackbox-api'
  status: string
  currentStage: string
  terminalReason: 'completed' | 'abandoned' | 'failed' | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  goalCompleted: boolean
  taskCompleted: boolean
  runCompleted: boolean
  publicTraceCount: number
  refereeTraceCount: number
  stageCoverage: Record<LearnerObservation['stage'], boolean>
  /**
   * 优先使用写入时累计的完整统计；旧记录只能用保留窗口作为下界。
   */
  stageCoverageSource?: 'full-trace' | 'retained-window'
  /** 完整轨迹里每种 stage 的出现次数（截断前；用于发现「覆盖了但只出现一次」的薄证据） */
  observedStageCounts?: Record<LearnerObservation['stage'], number>
  /**
   * 案例声明的阶段范围（显式）；未覆盖阶段由 report 留空，不按失败排除。
   * 只从实验预先声明的范围读取。
   */
  declaredStageScope?: LearnerObservation['stage'][]
  inputCoverage: {
    originalPublicTraceCount: number
    includedPublicTraceCount: number
    originalRefereeTraceCount: number
    includedRefereeTraceCount: number
    truncated: boolean
    /** true = stageCoverage 在压缩前由完整轨迹算出 */
    coverageComputedBeforeTruncation?: boolean
  }
}

export type VirtualLearnerRefereeInput = {
  publicTrace: BlackboxPublicTraceEntry[]
  refereeTrace: BlackboxRefereeTraceEntry[]
  control: PlatformControlReceipt
  experimentSummary: BlackboxExperimentSummary
  /**
   * 平行通道：故事元数据与当次诉求（不进入 Goal/Path 主链）。
   * 供裁判评估「正式 Goal 是否抓住了故事的真实问题」。
   */
  storyMeta?: RefereeStoryMeta | null
  /** 数据完整性：平台侧教学指标 / wrapup 产出情况（用于 evidenceSufficiency 判断） */
  metricCompleteness?: RefereeMetricCompleteness | null
}

export type RefereeStoryMeta = {
  personaSummary: string | null
  storyId: string | null
  storyTitle: string | null
  surfaceGoal: string | null
  realProblem: string | null
  triggerEvent: string | null
  /** 正式 Goal 开场实际写入 description 的诉求文本 */
  demandText: string | null
  /** 诉求来源（见 story-demand.ts StoryDemandSource） */
  demandSource: string | null
}

export type RefereeMetricCompleteness = {
  available: boolean
  teachingSessions: number
  wrapupPresent: number
  metricsPresent: number
  lssPresent: number
  degraded: boolean
  error: string | null
}

/**
 * 评审/审计输出完整性。
 * 模型缺分、给非法分或引用不存在的证据 → verdict 必须 inconclusive，不能按默认分兜底成结论。
 */
export type EvaluationIntegrity = {
  valid: boolean
  missingScores: string[]
  danglingEvidenceRefs: string[]
  danglingFindingCodes: string[]
  missingEvidence?: boolean
}

export type VirtualLearnerRefereeOutput = {
  verdict: 'pass' | 'pass_with_concerns' | 'fail' | 'inconclusive'
  /** 完整性诊断（供报告/管理台显式展示「证据不足」的原因） */
  integrity?: EvaluationIntegrity
  scores: {
    overall: number
    goalExperience: number | null
    goalUnderstanding: number | null
    pathExperience: number | null
    teachingExperience: number | null
    controlConsistency: number
    boundaryIntegrity: number
    evidenceSufficiency: number
  }
  findings: Array<{
    code: string
    severity: 'critical' | 'major' | 'minor' | 'info'
    category: 'goal' | 'path' | 'teaching' | 'control' | 'boundary' | 'completion' | 'trace' | 'data'
    title: string
    detail: string
    evidenceIds: string[]
  }>
  recommendations: Array<{
    priority: 'P0' | 'P1' | 'P2' | 'P3'
    action: string
    rationale: string
    findingCodes: string[]
  }>
  evidence: Array<{
    id: string
    source: 'publicTrace' | 'refereeTrace' | 'control' | 'experimentSummary' | 'storyMeta' | 'metricCompleteness'
    index: number | null
    path: string
    timestamp: string | null
    traceId: string | null
    excerpt: string
    interpretation: string
  }>
}

export type ActorAuditEvidenceSource =
  | 'actorProfile'
  | 'story'
  | 'learnerPrivateState'
  | 'publicTrace'
  | 'experimentSummary'

export type VirtualLearnerActorAuditInput = {
  actorProfile: {
    profile: Record<string, unknown>
    learningGoal: string
    knownConcepts: unknown[]
    struggleConcepts: unknown[]
    personalityTraits: Record<string, unknown>
  }
  story: Record<string, unknown> | null
  frictionBudget: 'none' | 'low' | 'normal' | 'high' | 'stress_test'
  learnerPrivateState: Record<string, unknown>
  publicTrace: Array<{
    timestamp: string
    observation: LearnerObservation
  }>
  experimentSummary: BlackboxExperimentSummary
}

export type VirtualLearnerActorAuditOutput = {
  verdict: 'credible' | 'credible_with_concerns' | 'invalid' | 'inconclusive'
  /** 完整性诊断（缺分/非法分/悬空引用） */
  integrity?: EvaluationIntegrity
  scores: {
    overall: number
    personaConsistency: number
    storyConsistency: number | null
    disclosureDiscipline: number | null
    frictionCalibration: number
    stateContinuity: number
    behaviorPlausibility: number
    evidenceSufficiency: number
  }
  findings: Array<{
    code: string
    severity: 'critical' | 'major' | 'minor' | 'info'
    category: 'persona' | 'story' | 'disclosure' | 'friction' | 'state' | 'behavior' | 'trace'
    title: string
    detail: string
    evidenceIds: string[]
  }>
  recommendations: Array<{
    priority: 'P0' | 'P1' | 'P2' | 'P3'
    action: string
    rationale: string
    findingCodes: string[]
  }>
  evidence: Array<{
    id: string
    source: ActorAuditEvidenceSource
    index: number | null
    path: string
    timestamp: string | null
    excerpt: string
    interpretation: string
  }>
}

/**
 * 延伸触发结算守卫（修复批 24-①，CTRL_EXT_CONFLICT u17 reeval23 critical）：源课已结算才允许开延伸课堂。
 * 源课未结算的形态：teachingSessionId 仍指向源课（课中意图）且阶段仍在 teaching；
 * 任一「已让位/已离开」信号成立即视为结算。extensionSourceSessionId 缺失（旧回执）保持放行不收紧。
 */
export function isExtensionSourceSettled(control: {
  teachingSessionId?: string | null
  extensionSourceSessionId?: string | null
  platformStage?: string | null
}): boolean {
  if (!control.extensionSourceSessionId) return true
  if (control.teachingSessionId !== control.extensionSourceSessionId) return true
  return control.platformStage !== 'teaching'
}

