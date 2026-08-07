export type LearnerAction =
  | { type: 'chat'; text: string }
  | { type: 'request_hint'; text: string }
  | { type: 'request_example'; text: string }
  | { type: 'submit_answer'; answer: string }
  | { type: 'submit_code'; code: string }
  | { type: 'confirm_proposal'; text: string }
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
  platformStage?: string
  goalCompleted?: boolean
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
  inputCoverage: {
    originalPublicTraceCount: number
    includedPublicTraceCount: number
    originalRefereeTraceCount: number
    includedRefereeTraceCount: number
    truncated: boolean
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

export type VirtualLearnerRefereeOutput = {
  verdict: 'pass' | 'pass_with_concerns' | 'fail' | 'inconclusive'
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
    category: 'goal' | 'path' | 'teaching' | 'control' | 'boundary' | 'completion' | 'trace'
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
