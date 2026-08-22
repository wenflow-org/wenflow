/**
 * virtual-lab 共享类型（数据库行 + 黑盒运行时状态）。
 * 数据库行类型直接复用 @prisma/client 生成类型，避免手写结构漂移；
 * stageResults JSON 的已知段在此强类型化，未知键透传（index signature）。
 */
import type {
  virtual_sessions,
  virtual_learner_profiles,
  virtual_experiment_commands
} from '@prisma/client'
import type {
  BlackboxPublicTraceEntry,
  BlackboxRefereeTraceEntry,
  PlatformControlReceipt,
  VirtualLearnerActorAuditOutput,
  VirtualLearnerRefereeOutput
} from './contracts'

/** virtual_sessions 表行（Prisma 默认投影） */
export type VirtualSessionRow = virtual_sessions

/** virtual_learner_profiles 表行 */
export type VirtualLearnerProfileRow = virtual_learner_profiles

/** virtual_experiment_commands 表行 */
export type VirtualExperimentCommandRow = virtual_experiment_commands

/** 带画像关联的会话行（路由层常以 include: { virtual_learner_profiles: true } 拉取） */
export type VirtualSessionWithProfile = VirtualSessionRow & {
  virtual_learner_profiles?: VirtualLearnerProfileRow | null
}

/** 裁判报告持久化记录（VirtualLearnerRefereeOutput + 查重索引字段） */
export type RefereeReportRecord = VirtualLearnerRefereeOutput & {
  id?: string
  runId?: string
  inputFingerprint?: string
  status?: string
}

/** 角色保真报告持久化记录 */
export type ActorAuditReportRecord = VirtualLearnerActorAuditOutput & {
  id?: string
  runId?: string
  inputFingerprint?: string
  status?: string
}

/** 私有状态轨迹条目（learnerPrivateStateTrace 元素，deep-record 透传） */
export interface LearnerPrivateStateTraceEntry {
  sequence?: number
  stage?: string
  taskId?: string | null
  transition?: string
  emotion?: unknown
  degraded?: boolean
  visibleSignal?: unknown
  stateChangeReason?: unknown
  generatedAt?: unknown
  /** 学习者的私有状态快照（字段自由，读取时按需守卫） */
  state?: Record<string, unknown>
  [key: string]: unknown
}

/** 黑盒实验运行时状态（stageResults JSON 的 blackbox 段） */
export interface BlackboxRunState {
  publicTrace?: BlackboxPublicTraceEntry[]
  refereeTrace?: BlackboxRefereeTraceEntry[]
  refereeReports?: RefereeReportRecord[]
  actorAuditReports?: ActorAuditReportRecord[]
  latestRefereeReportId?: string | null
  latestActorAuditReportId?: string | null
  learnerPrivateStateTrace?: LearnerPrivateStateTraceEntry[]
  /** 当前私有状态（goal/teaching 双槽；key 按 stage 区分） */
  learnerPrivateState?: Record<string, unknown>
  projectedCommandIds?: string[]
  control?: PlatformControlReceipt
  [key: string]: unknown
}

/** 模型路由配置（resolveRoute 结果经 sanitize 后写入实验快照） */
export interface SimulatorRoute {
  providerType?: string
  providerId?: string
  source?: string
  endpoint?: string
  model?: string
  privateNetworkPolicy?: 'runtime' | 'public-only'
  thinkingMode?: 'default' | 'enabled' | 'disabled'
  reasoningEffort?: 'default' | 'high' | 'max'
  timeoutMs?: number | null
  apiKey?: string
  credentialFingerprint?: string
  [key: string]: unknown
}

/** 单个模拟器配置（goal / teaching 各一） */
export interface SimulatorConfig {
  skillId?: string
  version?: string | null
  promptVersion?: string | null
  promptFingerprint?: string
  temperature?: number
  maxTokens?: number
  route?: SimulatorRoute
  [key: string]: unknown
}

/** 模拟器集合：goal / teaching 两路 */
export type Simulators = Partial<Record<'goal' | 'teaching', SimulatorConfig>>

/** 虚拟学习者画像快照（profile JSON 解析后的结构化视图） */
export interface ActorProfileSnapshot {
  profile?: Record<string, unknown>
  learningGoal?: string
  knownConcepts?: unknown[]
  struggleConcepts?: unknown[]
  personalityTraits?: Record<string, unknown>
  [key: string]: unknown
}

/** 实验快照（stageResults JSON 的 experimentSnapshot 段，可复现 Run 的完整运行时配置） */
export interface ExperimentSnapshot {
  capturedAt?: string
  routingUserId?: string | null
  actorProfile?: ActorProfileSnapshot | null
  story?: Record<string, unknown> | null
  frictionBudget?: string | null
  simulatorPrompts?: { goal?: string | null; teaching?: string | null } | null
  simulators?: Simulators | null
  [key: string]: unknown
}

/** 学习路径任务（模拟器视角最小结构；其余字段透传） */
export interface SimulationTask {
  id: string
  title?: string
  status?: string
  linkedConcept?: string
  coreConcept?: string
  estimatedMinutes?: number
  [key: string]: unknown
}

/** 学习路径里程碑 */
export interface SimulationMilestone {
  id?: string
  title?: string
  coreConceptId?: string
  subtasks?: SimulationTask[]
  [key: string]: unknown
}

/** 模拟器 Skill 输出（executeSkill 的 any 输出收敛为可索引对象） */
export interface SimulatorSkillOutput {
  reply?: string
  learnerState?: Record<string, unknown>
  learnerFeedback?: Record<string, unknown>
  emotion?: unknown
  degraded?: boolean
  debug?: Record<string, unknown>
  [key: string]: unknown
}

/** teaching 段状态（模拟器视角；index signature 透传未知键） */
export interface TeachingState {
  learnerState?: Record<string, unknown>
  teachingSessionId?: string | null
  teachingRevision?: number | null
  currentTaskId?: string | null
  currentTaskTitle?: string | null
  currentTaskDescription?: string | null
  currentMilestoneTitle?: string | null
  currentMilestone?: number
  currentTaskIdx?: number
  totalMilestones?: number
  taskRuntime?: Record<string, unknown>
  teachingSessionHistory?: Array<Record<string, unknown>>
  conversationHistory?: Array<{ role: string; content: string }>
  closureDecision?: Record<string, unknown>
  manualStop?: boolean
  stoppedReason?: string
  wrapup?: Record<string, unknown>
  [key: string]: unknown
}

/** 会话 stageResults JSON 全量（已知段强类型，其余透传） */
export interface StageResults {
  blackbox?: BlackboxRunState
  experiment?: {
    experimentId: string
    runId: string
    mode?: string
    operatorId?: string
    createdAt?: string | null
    [key: string]: unknown
  }
  experimentSnapshot?: ExperimentSnapshot
  teaching?: TeachingState
  goal?: Record<string, unknown>
  path_review?: Record<string, unknown>
  story?: Record<string, unknown>
  storyContext?: Record<string, unknown>
  simulationConfig?: {
    frictionBudget?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** 租约客户端最小结构（生产为 prisma；测试可传 mock） */
export type LeaseClientLike = {
  virtual_experiment_leases: {
    updateMany: (args: object) => Promise<{ count: number }>;
  };
};

/** 常见异常字段（error?.message / error?.code 等访问的 unknown 替代） */
export interface ErrorLike {
  name?: string
  message?: string
  code?: string | number | null
  statusCode?: number | null
  status?: number
  /** 可恢复标记：LLM/Provider 瞬时失败（平台副作用未发生）→ 黑盒命令同 key 可续跑 */
  retryable?: boolean
}

export function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {}
}
