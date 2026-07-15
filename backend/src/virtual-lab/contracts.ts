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
  stage: 'goal' | 'path' | 'learning' | 'completed' | 'error'
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

export type PlatformControlReceipt = {
  conversationId?: string
  learningPathId?: string
  teachingSessionId?: string | null
  taskId?: string | null
  platformStage?: string
  goalCompleted?: boolean
  taskCompleted?: boolean
  runCompleted?: boolean
  terminalReason?: 'completed' | 'abandoned'
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
  terminalReason: 'completed' | 'abandoned' | null
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
}

export type VirtualLearnerRefereeOutput = {
  verdict: 'pass' | 'pass_with_concerns' | 'fail' | 'inconclusive'
  scores: {
    overall: number
    goalExperience: number | null
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
    source: 'publicTrace' | 'refereeTrace' | 'control' | 'experimentSummary'
    index: number | null
    path: string
    timestamp: string | null
    traceId: string | null
    excerpt: string
    interpretation: string
  }>
}
