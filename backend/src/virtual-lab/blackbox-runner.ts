import { randomUUID as uuidv4 } from 'crypto'
import { createHash } from 'crypto'
import prisma from '../config/database'
import { signProjectionToken, SYNTHETIC_CAPABILITIES } from '../utils/projection-token'
import type { ResolvedRoute } from '../gateway/api-gateway'
import type {
  BlackboxExperimentSummary,
  BlackboxPublicTraceEntry,
  BlackboxRefereeTraceEntry,
  LearnerAction,
  LearnerObservation,
  PlatformControlReceipt,
  PlatformInteractionResult,
  RefereeMetricCompleteness,
  RefereeStoryMeta,
  TaskCompletionCheckpoint,
  VirtualLearnerActorAuditInput,
  VirtualLearnerActorAuditOutput,
  VirtualLearnerRefereeInput,
  VirtualLearnerRefereeOutput
} from './contracts'
import { PlatformUserAdapter } from './platform-user-adapter'
import { assertBlackboxSessionMode, VirtualSessionModeError } from './session-mode'
import { resolveStorySessionDemand } from './story-demand'
import {
  executeSkill,
  VIRTUAL_LEARNER_ACTOR_AUDITOR_MAX_TOKENS,
  VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT,
  VIRTUAL_LEARNER_ACTOR_AUDITOR_TEMPERATURE,
  VIRTUAL_LEARNER_REFEREE_MAX_TOKENS,
  VIRTUAL_LEARNER_REFEREE_PROMPT,
  VIRTUAL_LEARNER_REFEREE_TEMPERATURE,
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS,
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE,
  virtualLearnerGoalDialogueSimulatorDefinition,
  virtualLearnerLearnTurnSimulatorDefinition,
  virtualLearnerActorAuditorDefinition,
  virtualLearnerRefereeDefinition,
  virtualLearnerMemoryCuratorDefinition,
} from '../skills'
import { getRequestContext, runWithContext } from '../gateway/api-gateway/context'
import { getAPIGateway } from '../gateway/api-gateway'
import { agentConfigService } from '../services/agentConfig.service'
import { learningStateService } from '../services/learning/learning-state.service'
import { logger } from '../utils/logger'
import {
  buildLearnerMemorySnapshot,
  extractSelfStateFromTrace,
  recordCompletedArtifact,
  writeProfileConceptsAfterLesson,
  type LessonKnowledgePoint,
  type SelfReportedLearnerState,
} from './learner-memory'

import { safeJsonParse } from '../utils/safe-json'
import type { SkillDefinition } from '../skills/protocol'
import { asErrorLike } from './vlab-types'
import type {
  ActorProfileSnapshot,
  BlackboxRunState,
  ErrorLike,
  LearnerPrivateStateTraceEntry,
  ExperimentSnapshot,
  SimulatorConfig,
  SimulatorRoute,
  SimulatorSkillOutput,
  Simulators,
  StageResults,
  VirtualExperimentCommandRow,
  VirtualLearnerProfileRow,
  VirtualSessionRow,
  VirtualSessionWithProfile
} from './vlab-types'

/** stageResults JSON 解析（带类型参数的 safeJsonParse，fallback 缺省空对象） */
function parseStageResults(value: string | null | undefined, fallback: StageResults = {}): StageResults {
  return safeJsonParse<StageResults>(value, fallback)
}

/** 安全读取深层字段（unknown 中间层不报错，返回 undefined 表示路径缺失） */
function deepValue(value: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = value
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

const TERMINAL_SESSION_STATUSES = new Set(['completed', 'failed', 'abandoned'])
const COMMAND_LEASE_MS = 10 * 60 * 1000
const COMMAND_LEASE_RENEW_MS = 2 * 60 * 1000
const LEASE_RETRY_DELAYS_MS = [25, 50, 100]
/** 模拟器 LLM 调用重试次数（对齐 quick-learn 3-strike 语义：瞬态失败/空回复可重试） */
const BLACKBOX_SIMULATOR_RETRY_ATTEMPTS = 3
const BLACKBOX_SIMULATOR_RETRY_DELAY_MS = 750

function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && asErrorLike(error).code === code
}

/**
 * LLM/Provider 瞬时失败识别（黑盒可恢复失败判定）：
 * 超时、网络、上游 5xx、限流、空回复、JSON 结构非法等——这类失败发生时
 * 平台副作用尚未发生，命令可用相同 Idempotency-Key 安全重试。
 */
function isTransientLlMFailure(error: unknown): boolean {
  const message = String(asErrorLike(error).message || error || '').toLowerCase()
  if (!message.trim()) return true
  return /structured_output_invalid|invalid chat completion|finish_reason|empty content|api request canceled|fetch failed|timeout|timed out|econnreset|socket|network|rate.?limit|\b429\b|\b5\d\d\b|does not contain valid json|invalid json response|response does not contain|response is empty|missing reply|missing learnerstate/i.test(message)
}

function isLeaseDatabaseBusyError(error: unknown) {
  if (isPrismaErrorCode(error, 'P1008')) return true
  const code = typeof error === 'object' && error !== null ? String(asErrorLike(error).code || '') : ''
  const message = error instanceof Error ? error.message : String(error || '')
  return code === 'SQLITE_BUSY'
    || /SQLITE_BUSY|database (?:is|table is) locked|timed out|timeout/i.test(message)
}

type PendingProjectionReceipt = {
  projectionPending: true
  projectionKey: string
  finalProjection: boolean
} & ({
  receiptKind: 'result'
  platformResult: PlatformInteractionResult
  commandResult: unknown
} | {
  receiptKind: 'checkpoint'
  checkpoint: TaskCompletionCheckpoint
})

type CommandContext = {
  commandRowId: string
  kind: 'action' | 'step' | 'observe'
  projectionSequence: number
}

type LeaseContext = {
  sessionId: string
  ownerId: string
  expiresAt: number
  renewal: Promise<void>
  failureError: unknown | null
  timer?: NodeJS.Timeout
}

export class BlackboxRunStateError extends Error {
  readonly retryable = false

  constructor(message: string, readonly code: string, readonly statusCode = 409) {
    super(message)
    this.name = 'BlackboxRunStateError'
  }
}

export class BlackboxReconciliationPendingError extends Error {
  readonly code = 'BLACKBOX_RECONCILIATION_PENDING'
  readonly statusCode = 503
  readonly retryable = true

  constructor(message: string, readonly originalError?: unknown) {
    super(message)
    this.name = 'BlackboxReconciliationPendingError'
  }
}

export class BlackboxLeaseLostError extends Error {
  readonly code = 'BLACKBOX_LEASE_LOST'
  readonly statusCode = 503
  readonly retryable = true

  constructor(message = '黑盒实验执行租约已丢失，请使用相同 Idempotency-Key 重试') {
    super(message)
    this.name = 'BlackboxLeaseLostError'
  }
}

export class BlackboxSessionBusyError extends Error {
  readonly code = 'BLACKBOX_SESSION_BUSY'
  readonly statusCode = 409
  readonly retryable = true

  constructor() {
    super('当前实验正在由另一实例执行，请稍后重试')
    this.name = 'BlackboxSessionBusyError'
  }
}

export class BlackboxDatabaseBusyError extends Error {
  readonly code = 'DB_BUSY'
  readonly statusCode = 503
  readonly retryable = true

  constructor(readonly originalError?: unknown) {
    super('租约数据库暂时繁忙，请稍后重试')
    this.name = 'BlackboxDatabaseBusyError'
  }
}

export class BlackboxVirtualLearnerRunner {
  private readonly sessionLocks = new Map<string, Promise<void>>()
  private readonly commandContexts = new Map<string, CommandContext>()
  private readonly leaseContexts = new Map<string, LeaseContext>()

  async runExclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const queued = previous.then(() => current)
    this.sessionLocks.set(sessionId, queued)
    await previous
    try {
      return await work()
    } finally {
      release()
      if (this.sessionLocks.get(sessionId) === queued) this.sessionLocks.delete(sessionId)
    }
  }

  async runCommand<T>(options: {
    sessionId: string
    operatorId: string
    commandId: string
    kind: 'action' | 'step' | 'observe'
    request: unknown
    expectedTraceCount: number
  }, work: () => Promise<T>): Promise<{ result: T; reused: boolean }> {
    const commandId = String(options.commandId || '').trim()
    if (!commandId || commandId.length > 128) {
      throw new BlackboxRunStateError('黑盒写操作缺少合法 Idempotency-Key', 'BLACKBOX_COMMAND_ID_INVALID', 400)
    }
    if (!Number.isInteger(options.expectedTraceCount) || options.expectedTraceCount < 0) {
      throw new BlackboxRunStateError('黑盒写操作缺少合法的预期轨迹序号', 'BLACKBOX_EXPECTED_TRACE_INVALID', 400)
    }

    return this.runExclusive(options.sessionId, async () => {
      const session = await this.getSession(options.sessionId)
      const state = parseStageResults(session.stageResults)
      assertBlackboxSessionMode(state)
      const runId = state.experiment.runId
      const experimentId = state.experiment.experimentId
      const existing = await prisma.virtual_experiment_commands.findUnique({
        where: { runId_commandId: { runId, commandId } }
      })
      if (existing && existing.status !== 'processing'
        && !this.isReconciliationPendingCommand(existing)
        && !this.isRetryableFailedCommand(existing)) {
        return this.reuseCommand<T>(existing, options.kind, options.request)
      }
      if (existing) this.assertCommandMatches(existing, options.kind, options.request)
      if (TERMINAL_SESSION_STATUSES.has(session.status)) {
        throw new BlackboxRunStateError('当前黑盒实验已经结束，不能继续执行命令', 'BLACKBOX_RUN_TERMINAL')
      }

      const leaseOwner = `cmd_${uuidv4()}`
      const leaseExpiresAt = await this.acquireCommandLease(options.sessionId, leaseOwner)
      const lease = this.startLeaseRenewal(options.sessionId, leaseOwner, leaseExpiresAt)
      let primaryError: unknown
      try {
        const afterLease = await prisma.virtual_experiment_commands.findUnique({
          where: { runId_commandId: { runId, commandId } }
        })
        if (afterLease && afterLease.status !== 'processing'
          && !this.isReconciliationPendingCommand(afterLease)
          && !this.isRetryableFailedCommand(afterLease)) {
          await this.assertCurrentLease(options.sessionId)
          return this.reuseCommand<T>(afterLease, options.kind, options.request)
        }
        if (afterLease) this.assertCommandMatches(afterLease, options.kind, options.request)

        const pendingCommands = await prisma.virtual_experiment_commands.findMany({
          where: { runId, status: { in: ['processing', 'failed'] } },
          orderBy: { sequence: 'asc' }
        })
        const barriers = pendingCommands.filter(command => this.isCommandOrderingBarrier(command)
          && (!afterLease || command.commandId === commandId || command.sequence < afterLease.sequence))
        if (afterLease && this.isCommandOrderingBarrier(afterLease)
          && !barriers.some(command => command.id === afterLease.id)) barriers.push(afterLease)
        barriers.sort((left, right) => (left.sequence || 0) - (right.sequence || 0))
        const earliestPending = barriers[0] || null
        if (earliestPending && earliestPending.commandId !== commandId) {
          // 死锁修复：barrier 命令已具备完整平台回执（finalProjection=true 的 result 回执）时，
          // 自动落盘其投影并完成该命令再放行当前命令；仅重放已发生的平台副作用，不重新执行平台操作，
          // 幂等语义不变。无完整回执（checkpoint/未终局 step）的 barrier 保持原语义要求同 key 重试。
          if (!(await this.tryResolveOrderingBarrier(options.sessionId, earliestPending))) {
            throw new BlackboxReconciliationPendingError(
              `较早的黑盒命令 ${earliestPending.commandId} 仍待对账，请先使用其 Idempotency-Key 重试`
            )
          }
          const remaining = await prisma.virtual_experiment_commands.findMany({
            where: { runId, status: { in: ['processing', 'failed'] } },
            orderBy: { sequence: 'asc' }
          })
          const stillBlocked = remaining.find(command => this.isCommandOrderingBarrier(command)
            && (!afterLease || command.commandId === commandId || command.sequence < afterLease.sequence))
          if (stillBlocked) {
            throw new BlackboxReconciliationPendingError(
              `较早的黑盒命令 ${stillBlocked.commandId} 仍待对账，请先使用其 Idempotency-Key 重试`
            )
          }
        }

        const freshSession = await this.getSession(options.sessionId)
        const freshState = parseStageResults(freshSession.stageResults)
        let command = afterLease
        let projectionSequence = 0
        let retryRebuilt = false
        if (command) {
          const receipt = this.pendingProjectionReceipt(command)
          if (!receipt) {
            if (this.isRetryableFailedCommand(command)) {
              // 可恢复失败续跑：命令失败时平台副作用尚未发生（LLM/Provider 瞬时失败），
              // 用相同 Idempotency-Key 重置命令后重新执行，幂等语义不变。
              await this.assertCurrentLease(options.sessionId)
              await prisma.virtual_experiment_commands.update({
                where: { id: command.id },
                data: {
                  status: 'processing',
                  errorJson: null,
                  resultJson: null,
                  completedAt: null,
                  triggeredBy: options.operatorId
                }
              })
              command = {
                ...command,
                status: 'processing',
                errorJson: null,
                resultJson: null,
                completedAt: null,
                triggeredBy: options.operatorId
              }
              retryRebuilt = true
            } else {
              throw new BlackboxRunStateError(
                '待对账命令缺少平台投影回执，不能安全重试',
                'BLACKBOX_RECONCILIATION_RECEIPT_MISSING'
              )
            }
          }
          if (!retryRebuilt) {
            await this.assertCurrentLease(options.sessionId)
            await prisma.virtual_experiment_commands.update({
              where: { id: command.id },
              data: {
                status: 'processing',
                errorJson: null,
                completedAt: null,
                triggeredBy: options.operatorId
              }
            })
            command = {
              ...command,
              status: 'processing',
              errorJson: null,
              completedAt: null,
              triggeredBy: options.operatorId
            }
            try {
              if (receipt!.receiptKind === 'checkpoint') {
                await this.persistTaskCompletionCheckpoint(
                  options.sessionId,
                  freshState,
                  receipt!.checkpoint,
                  receipt!.projectionKey
                )
                projectionSequence = this.projectionSequence(receipt!.projectionKey)
              } else {
                await this.persist(freshSession, freshState, receipt!.platformResult, receipt!.projectionKey)
                if (receipt!.finalProjection) {
                  await this.completeCommand(options.sessionId, command.id, receipt!.commandResult)
                  return { result: receipt!.commandResult as T, reused: false }
                }
                projectionSequence = this.projectionSequence(receipt!.projectionKey)
              }
            } catch (error: unknown) {
              if (error instanceof BlackboxLeaseLostError || error instanceof BlackboxDatabaseBusyError) {
                throw error
              }
              const reconciliationError = error instanceof BlackboxReconciliationPendingError
                ? error
                : this.reconciliationPendingError(error)
              await this.recordCommandFailure(options.sessionId, command.id, reconciliationError)
              throw reconciliationError
            }
          }
        } else {
          const currentTraceCount = Array.isArray(freshState.blackbox?.publicTrace)
            ? freshState.blackbox.publicTrace.length : 0
          if (currentTraceCount !== options.expectedTraceCount) {
            throw new BlackboxRunStateError(
              `实验轨迹已更新，当前序号为 ${currentTraceCount}`,
              'BLACKBOX_TRACE_SEQUENCE_MISMATCH'
            )
          }
          const latestCommand = await prisma.virtual_experiment_commands.findFirst({
            where: { runId },
            orderBy: { sequence: 'desc' },
            select: { sequence: true }
          })
          await this.assertCurrentLease(options.sessionId)
          command = await prisma.virtual_experiment_commands.create({
            data: {
              sessionId: options.sessionId,
              experimentId,
              runId,
              commandId,
              sequence: (latestCommand?.sequence || 0) + 1,
              kind: options.kind,
              requestJson: JSON.stringify(options.request ?? null),
              triggeredBy: options.operatorId
            }
          })
        }
        this.commandContexts.set(options.sessionId, {
          commandRowId: command.id,
          kind: options.kind,
          projectionSequence
        })
        try {
          const result = await work()
          await this.completeCommand(options.sessionId, command.id, result)
          return { result, reused: false }
        } catch (error: unknown) {
          await this.recordCommandFailure(options.sessionId, command.id, error)
          throw error
        } finally {
          this.commandContexts.delete(options.sessionId)
        }
      } catch (error) {
        primaryError = error
        throw error
      } finally {
        await this.cleanupLease(lease, primaryError)
      }
    })
  }

  async runLeasedExclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    return this.runExclusive(sessionId, async () => {
      const ownerId = `lease_${uuidv4()}`
      const leaseExpiresAt = await this.acquireCommandLease(sessionId, ownerId)
      const lease = this.startLeaseRenewal(sessionId, ownerId, leaseExpiresAt)
      let primaryError: unknown
      try {
        const result = await work()
        await this.assertCurrentLease(sessionId)
        return result
      } catch (error) {
        primaryError = error
        throw error
      } finally {
        await this.cleanupLease(lease, primaryError)
      }
    })
  }

  async initialize(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const stageResults = parseStageResults(session.stageResults)
    if (stageResults.experiment?.mode && stageResults.experiment.mode !== 'blackbox-api') {
      throw new BlackboxRunStateError('当前会话已绑定其他实验模式', 'BLACKBOX_MODE_CONFLICT')
    }
    const experimentId = stageResults.experiment?.experimentId || `exp_${uuidv4()}`
    const runId = stageResults.experiment?.runId || `run_${uuidv4()}`
    const snapshot = stageResults.experimentSnapshot || await this.captureCurrentExperimentSnapshot(session, stageResults)
    const next = {
      ...stageResults,
      experiment: {
        experimentId,
        runId,
        mode: 'blackbox-api',
        operatorId,
        createdAt: stageResults.experiment?.createdAt || new Date().toISOString()
      },
      experimentSnapshot: snapshot,
      blackbox: stageResults.blackbox || {
        publicTrace: [],
        control: {},
        refereeTrace: [],
        learnerPrivateState: {},
        learnerPrivateStateTrace: []
      }
    }

    await this.assertCurrentLease(sessionId)
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(next), updatedAt: new Date() }
    })
    return { experimentId, runId, mode: 'blackbox-api' as const }
  }

  async createExperimentState(input: {
    operatorId: string
    actorProfile: Record<string, unknown>
    story: Record<string, unknown> | null
    frictionBudget: string
    experimentId?: string | null
    parentRunId?: string | null
    experimentSnapshotOverride?: Record<string, unknown> | null
  }) {
    const experimentId = input.experimentId || `exp_${uuidv4()}`
    const runId = `run_${uuidv4()}`
    const createdAt = new Date().toISOString()
    const experimentSnapshot = input.experimentSnapshotOverride
      ? this.cloneExperimentSnapshot(input.experimentSnapshotOverride, createdAt, input)
      : await this.captureSimulatorExperimentSnapshot(input.operatorId, createdAt, input)
    return {
      experiment: {
        experimentId,
        runId,
        mode: 'blackbox-api',
        operatorId: input.operatorId,
        createdAt,
        parentRunId: input.parentRunId || null
      },
      experimentSnapshot,
      blackbox: {
        publicTrace: [],
        control: {},
        refereeTrace: [],
        learnerPrivateState: {},
        learnerPrivateStateTrace: []
      }
    }
  }

  async observe(sessionId: string, operatorId: string): Promise<PlatformInteractionResult> {
    return this.executeWithFailurePersistence(sessionId, 'BLACKBOX_OBSERVE_FAILED', async () => {
      const { session, state, adapter } = await this.context(sessionId, operatorId)
      this.assertMutableSession(session)
      const pathId = state.blackbox?.control?.learningPathId || session.learningPathId
      if (!pathId) {
        const latest = state.blackbox?.publicTrace?.slice(-1)[0]
        if (latest?.observation) return latest
        throw new BlackboxRunStateError('当前还没有可观察的 Path，请先执行 Goal 动作', 'BLACKBOX_PATH_NOT_AVAILABLE')
      }
      const result = await adapter.getPath(pathId)
      return this.projectPlatformResult(session, state, result)
    })
  }

  async getSnapshot(sessionId: string) {
    const session = await this.getSession(sessionId)
    const state = parseStageResults(session.stageResults)
    assertBlackboxSessionMode(state)
    await this.assertSyntheticUserBinding(session)
    const teachingSessionIds = this.teachingSessionIds(state)
    let platformTimeline: Awaited<ReturnType<typeof learningStateService.getSessionStateTimeline>> = []
    let platformTimelineStatus: 'ok' | 'unavailable' = 'ok'
    try {
      platformTimeline = await learningStateService.getSessionStateTimeline(session.userId, teachingSessionIds)
    } catch (error) {
      platformTimelineStatus = 'unavailable'
      logger.warn('[Blackbox] 获取当前 Run 的平台学习状态失败', {
        sessionId,
        teachingSessionCount: teachingSessionIds.length,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return {
      experiment: state.experiment || null,
      observation: state.blackbox?.publicTrace?.slice(-1)[0]?.observation || null,
      control: state.blackbox?.control || {},
      publicTrace: state.blackbox?.publicTrace || [],
      refereeTrace: this.compactTrace(state.blackbox?.refereeTrace, 120).map((entry: BlackboxRefereeTraceEntry) => ({
        timestamp: String(entry?.timestamp || ''),
        traceId: typeof entry?.traceId === 'string' ? entry.traceId : null,
        diagnostic: this.sanitizeDiagnostic(entry?.diagnostic)
      })),
      refereeTraceCount: state.blackbox?.refereeTrace?.length || 0,
      latestRefereeReport: this.latestRefereeReport(state),
      refereeReportCount: state.blackbox?.refereeReports?.length || 0,
      latestActorAuditReport: this.latestActorAuditReport(state),
      actorAuditReportCount: state.blackbox?.actorAuditReports?.length || 0,
      // 角色私有状态（latest + trace）—— 供前端可视化"虚拟学习者脑子里在想什么"
      learnerPrivateState: state.blackbox?.learnerPrivateState || {},
      learnerPrivateStateTraceCount: Array.isArray(state.blackbox?.learnerPrivateStateTrace)
        ? state.blackbox.learnerPrivateStateTrace.length : 0,
      learnerPrivateStateTrace: this.compactLearnerPrivateStateTrace(state.blackbox?.learnerPrivateStateTrace),
      stateTimeline: {
        scope: 'current-run',
        actor: {
          scale: 'display-100',
          entries: this.actorStateTimeline(state)
        },
        platform: {
          scale: 'display-100',
          status: platformTimelineStatus,
          errorCode: platformTimelineStatus === 'unavailable' ? 'PLATFORM_STATE_TIMELINE_UNAVAILABLE' : null,
          entries: platformTimeline.map((entry) => ({
            teachingSessionId: entry.teachingSessionId,
            taskId: entry.taskId,
            pathId: entry.pathId,
            status: entry.status,
            metrics: entry.metrics ? this.displayPlatformMetrics(entry.metrics) : null,
            calculatedAt: entry.calculatedAt.toISOString(),
            source: entry.source,
            summarySource: entry.summarySource,
            evaluationSource: entry.evaluationSource,
            degraded: entry.degraded
          }))
        }
      }
    }
  }

  async referee(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const state = parseStageResults(session.stageResults)
    if (state.experiment?.mode !== 'blackbox-api') throw new Error('当前会话不是 blackbox-api 实验')
    if (!['completed', 'abandoned', 'failed'].includes(session.status)) {
      throw new Error('黑盒实验尚未结束，不能生成终局裁判报告')
    }

    const input = await this.buildRefereeInput(session, state)
    const inputFingerprint = this.reportFingerprint(input, {
      skillId: virtualLearnerRefereeDefinition.name,
      version: virtualLearnerRefereeDefinition.version,
      prompt: VIRTUAL_LEARNER_REFEREE_PROMPT,
      temperature: VIRTUAL_LEARNER_REFEREE_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_REFEREE_MAX_TOKENS
    })
    const existing = (state.blackbox?.refereeReports || []).find((item) =>
      item.runId === input.experimentSummary.runId && item.inputFingerprint === inputFingerprint && item.status === 'completed'
    )
    if (existing) return { ...existing, reused: true }

    const parentContext = getRequestContext()
    const report = await runWithContext({
      ...parentContext,
      userId: session.userId,
      sourceEntry: 'simulation',
      callerAgent: 'simulation-agent',
      experimentId: input.experimentSummary.experimentId,
      runId: input.experimentSummary.runId
    }, () => executeSkill(virtualLearnerRefereeDefinition, input))

    const fresh = await this.getSession(sessionId)
    const latestState = parseStageResults(fresh.stageResults, state)
    const refereeRecord = {
      id: `vref_${uuidv4()}`,
      runId: input.experimentSummary.runId,
      inputFingerprint,
      skillId: virtualLearnerRefereeDefinition.name,
      reportVersion: virtualLearnerRefereeDefinition.version,
      status: 'completed',
      triggeredBy: operatorId,
      evaluatedAt: new Date().toISOString(),
      traceCounts: {
        publicTrace: input.publicTrace.length,
        refereeTrace: input.refereeTrace.length
      },
      report
    }
    const reports = [...(latestState.blackbox?.refereeReports || []), refereeRecord].slice(-10)
    const nextState = {
      ...latestState,
      blackbox: {
        ...(latestState.blackbox || {}),
        refereeReports: reports,
        latestRefereeReportId: refereeRecord.id
      }
    }
    await this.assertCurrentLease(sessionId)
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(nextState), updatedAt: new Date() }
    })
    return { ...refereeRecord, reused: false }
  }

  async actorAudit(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const state = parseStageResults(session.stageResults)
    if (state.experiment?.mode !== 'blackbox-api') throw new Error('当前会话不是 blackbox-api 实验')
    if (!['completed', 'abandoned', 'failed'].includes(session.status)) {
      throw new Error('黑盒实验尚未结束，不能生成角色保真报告')
    }

    const input = await this.buildActorAuditInput(session, state)
    const inputFingerprint = this.reportFingerprint(input, {
      skillId: virtualLearnerActorAuditorDefinition.name,
      version: virtualLearnerActorAuditorDefinition.version,
      prompt: VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT,
      temperature: VIRTUAL_LEARNER_ACTOR_AUDITOR_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_ACTOR_AUDITOR_MAX_TOKENS
    })
    const existing = (state.blackbox?.actorAuditReports || []).find((item) =>
      item.runId === input.experimentSummary.runId && item.inputFingerprint === inputFingerprint && item.status === 'completed'
    )
    if (existing) return { ...existing, reused: true }

    const parentContext = getRequestContext()
    const report = await runWithContext({
      ...parentContext,
      userId: session.userId,
      sourceEntry: 'simulation',
      callerAgent: 'simulation-agent',
      experimentId: input.experimentSummary.experimentId,
      runId: input.experimentSummary.runId
    }, () => executeSkill(virtualLearnerActorAuditorDefinition, input))

    const fresh = await this.getSession(sessionId)
    const latestState = parseStageResults(fresh.stageResults, state)
    const auditRecord = {
      id: `vaudit_${uuidv4()}`,
      runId: input.experimentSummary.runId,
      inputFingerprint,
      skillId: virtualLearnerActorAuditorDefinition.name,
      reportVersion: virtualLearnerActorAuditorDefinition.version,
      status: 'completed',
      triggeredBy: operatorId,
      evaluatedAt: new Date().toISOString(),
      traceCounts: { publicTrace: input.publicTrace.length },
      report
    }
    const reports = [...(latestState.blackbox?.actorAuditReports || []), auditRecord].slice(-10)
    const nextState = {
      ...latestState,
      blackbox: {
        ...(latestState.blackbox || {}),
        actorAuditReports: reports,
        latestActorAuditReportId: auditRecord.id
      }
    }
    await this.assertCurrentLease(session.id)
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(nextState), updatedAt: new Date() }
    })
    return { ...auditRecord, reused: false }
  }

  async act(sessionId: string, operatorId: string, action: LearnerAction): Promise<PlatformInteractionResult> {
    return this.executeWithFailurePersistence(sessionId, 'BLACKBOX_ACTION_FAILED', async () => {
      const { session, state, adapter } = await this.context(sessionId, operatorId)
      this.assertMutableSession(session)
      const control = (state.blackbox?.control || {}) as PlatformControlReceipt
      const latestObservation = state.blackbox?.publicTrace?.slice(-1)[0]?.observation as LearnerObservation | undefined
      this.assertActionAllowed(action, latestObservation, control)
      let result: PlatformInteractionResult

      if (action.type === 'abandon') {
        result = control.teachingSessionId
          ? await adapter.endTeaching(control.teachingSessionId, control.teachingRevision, 'abandoned', action.reason)
          : adapter.abandonExperiment(latestObservation?.stage || 'goal', action.reason)
      } else if (!control.conversationId) {
        if (action.type !== 'chat') {
          throw new BlackboxRunStateError('Blackbox Goal 首轮必须使用 chat 动作', 'BLACKBOX_FIRST_ACTION_INVALID')
        }
        result = await adapter.startGoal(action.text)
      } else if (!control.learningPathId && (action.type === 'chat' || action.type === 'confirm_proposal')) {
        result = await adapter.replyGoal(control.conversationId, action)
      } else if (action.type === 'start_learning') {
        const taskId = action.taskId || control.taskId
        const teachingResult = await adapter.startTeaching(taskId!)
        result = {
          ...teachingResult,
          control: {
            ...teachingResult.control,
            taskCompleted: false,
            taskCompletionCheckpoint: null
          }
        }
      } else if (action.type === 'confirm_complete') {
        result = await this.completeCurrentTask(session, state, adapter, control, latestObservation)
      } else if (action.type === 'skip') {
        throw new BlackboxRunStateError('平台当前没有公开的跳过任务动作', 'BLACKBOX_SKIP_UNSUPPORTED')
      } else {
        if (!control.teachingSessionId) {
          throw new BlackboxRunStateError('当前没有可交互的教学会话', 'BLACKBOX_TEACHING_NOT_AVAILABLE')
        }
        const teachingResult = await adapter.sendTeachingMessage(control.teachingSessionId, control.teachingRevision, action)
        if (teachingResult.observation.stage === 'completed' && control.taskId && control.learningPathId) {
          result = await this.completeCurrentTask(session, state, adapter, control, latestObservation, teachingResult)
        } else {
          result = teachingResult
        }
      }

      return this.projectPlatformResult(session, state, result, action)
    })
  }

  async autoStep(sessionId: string, operatorId: string): Promise<{ action?: LearnerAction; result: PlatformInteractionResult; waitingForObservation?: boolean }> {
    return this.executeWithFailurePersistence(sessionId, 'BLACKBOX_STEP_FAILED', async () => {
      const { session, state } = await this.context(sessionId, operatorId)
      this.assertMutableSession(session)
      const latest = state.blackbox?.publicTrace?.slice(-1)[0]?.observation
      const control = (state.blackbox?.control || {}) as PlatformControlReceipt
      if (this.currentTaskCompletionCheckpoint(control)) {
        const action: LearnerAction = { type: 'confirm_complete' }
        return { action, result: await this.act(sessionId, operatorId, action) }
      }
      const snapshot = await this.getExperimentSnapshot(session, state)
      const story = snapshot.story
      const learner = snapshot.actorProfile
      let action: LearnerAction

      if (!latest) {
        // 故事当次需求经 Goal 开场传入正式链路；不在此改 Path
        const demand = resolveStorySessionDemand({
          story,
          profileLearningGoal: learner?.learningGoal,
        })
        if (!demand.text) throw new Error('虚拟学习者缺少 Goal 开场信息：请绑定故事诉求或画像长期倾向')
        action = { type: 'chat', text: demand.text }
      } else if (latest.stage === 'goal') {
        const history = this.visibleHistory(state).map((item) => ({
          role: item.role === 'platform' ? 'goal_agent' : 'learner',
          content: item.content
        }))
        const output = await this.executeSimulatorSkillWithRetry(
          sessionId,
          virtualLearnerGoalDialogueSimulatorDefinition,
          {
            learner,
            story,
            visibleContext: {
              history,
              lastGoalAgentMessage: [...history].reverse().find((item) => item.role === 'goal_agent')?.content || ''
            },
            currentPhase: latest.availableActions.includes('confirm_proposal') ? 'proposal_evaluation' : 'understanding',
            previousLearnerState: state.blackbox?.learnerPrivateState?.goal || null,
            frictionBudget: snapshot.frictionBudget
          },
          snapshot,
          'goal'
        )
        const shouldConfirm = latest.availableActions.includes('confirm_proposal') && output?.learnerState?.readyToAdvance === true
        action = { type: shouldConfirm ? 'confirm_proposal' : 'chat', text: output.reply }
        await this.persistPrivateState(session, state, 'goal', output.learnerState, {
          emotion: output.emotion,
          degraded: output.degraded,
          visibleSignal: output.debug?.visibleSignal,
          stateChangeReason: output.debug?.stateChangeReason
        })
      } else if (latest.stage === 'path') {
        if (!latest.visiblePath || !latest.availableActions.includes('start_learning')) {
          const observed = await this.observe(sessionId, operatorId)
          if (observed.observation.stage === 'error') return { result: observed }
          if (!observed.observation.availableActions.includes('start_learning')) {
            return { result: observed, waitingForObservation: true }
          }
          action = { type: 'start_learning', taskId: observed.observation.visibleTask?.id }
          return { action, result: await this.act(sessionId, operatorId, action) }
        }
        action = { type: 'start_learning', taskId: latest.visibleTask?.id }
      } else if (latest.stage === 'teaching') {
        const history = this.visibleHistory(state).map((item) => ({
          role: item.role === 'platform' ? 'teacher' : 'learner',
          content: item.content
        }))
        const output = await this.executeSimulatorSkillWithRetry(
          sessionId,
          virtualLearnerLearnTurnSimulatorDefinition,
          {
            learner,
            story,
            visibleContext: {
              history,
              lastTeacherMessage: [...history].reverse().find((item) => item.role === 'teacher')?.content || ''
            },
            currentPhase: (state.blackbox?.learnerPrivateState?.teaching as Record<string, unknown> | undefined)?.phaseFocus || 'trying',
            previousLearnerState: state.blackbox?.learnerPrivateState?.teaching || null,
            currentTask: latest.visibleTask || null,
            knowledgeSnapshot: await this.buildLearnerKnowledgeSnapshot(session.userId, latest.visibleTask),
            learnerMemory: await this.buildLearnerMemoryForSimulator(session.userId),
            frictionBudget: snapshot.frictionBudget
          },
          snapshot,
          'teaching'
        )
        action = latest.availableActions.includes('confirm_complete')
          && output.learnerFeedback?.selfReportedTaskDone === true
          && output.learnerFeedback?.stopAsking === true
          ? { type: 'confirm_complete' }
          : output.learnerState?.wantsHint
            ? { type: 'request_hint', text: output.reply }
          : output.learnerState?.wantsWorkedExample
            ? { type: 'request_example', text: output.reply }
            : { type: 'chat', text: output.reply }
        await this.persistPrivateState(session, state, 'teaching', {
          ...output.learnerState,
          learnerFeedback: output.learnerFeedback
        }, {
          emotion: output.emotion,
          degraded: output.degraded,
          visibleSignal: output.debug?.visibleSignal,
          stateChangeReason: output.debug?.stateChangeReason
        })
      } else {
        throw new BlackboxRunStateError('当前黑盒实验已经结束', 'BLACKBOX_OBSERVATION_TERMINAL')
      }

      return { action, result: await this.act(sessionId, operatorId, action) }
    })
  }

  private async context(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const state = parseStageResults(session.stageResults)
    assertBlackboxSessionMode(state)
    const token = signProjectionToken({
      targetUserId: session.userId,
      sourceProfileId: session.virtualProfileId,
      issuedByAdminId: operatorId,
      grantSource: 'synthetic',
      virtualSessionId: session.id,
      scope: 'full',
      capabilities: [...SYNTHETIC_CAPABILITIES],
      experimentId: state.experiment.experimentId,
      runId: state.experiment.runId,
      type: 'projection'
    })
    return {
      session,
      state,
      adapter: new PlatformUserAdapter({ credentialProvider: async () => ({ kind: 'projection', token }) })
    }
  }

  private async persist(
    session: VirtualSessionRow,
    state: StageResults,
    result: PlatformInteractionResult,
    projectionCommandId?: string
  ) {
    const fresh = await this.getSession(session.id)
    const latestState = parseStageResults(fresh.stageResults, state)
    const projectedCommandIds = Array.isArray(latestState.blackbox?.projectedCommandIds)
      ? latestState.blackbox.projectedCommandIds : []
    if (projectionCommandId && projectedCommandIds.includes(projectionCommandId)) return result
    this.assertMutableSession(fresh)
    const previousControl = latestState.blackbox?.control || {}
    const control = Object.fromEntries(
      Object.entries({ ...previousControl, ...result.control }).filter(([, value]) => value !== undefined)
    ) as PlatformControlReceipt
    if (control.terminalReason === 'completed' && control.runCompleted !== true) delete control.terminalReason
    const publicTrace = [...(latestState.blackbox?.publicTrace || []), {
      timestamp: new Date().toISOString(),
      observation: result.observation,
      control: result.control
    }]
    const refereeTrace = [...(latestState.blackbox?.refereeTrace || []), {
      timestamp: new Date().toISOString(),
      traceId: result.control.rawTraceId || null,
      diagnostic: result.diagnostic || null
    }]
    const nextState = {
      ...latestState,
      blackbox: {
        ...(latestState.blackbox || {}),
        control,
        publicTrace,
        refereeTrace,
        ...(projectionCommandId
          ? { projectedCommandIds: [...projectedCommandIds, projectionCommandId].slice(-200) }
          : {})
      }
    }
    const abandoned = result.control.terminalReason === 'abandoned'
    const completed = result.control.runCompleted === true
    const failed = result.control.terminalReason === 'failed' || result.observation.stage === 'error'
    if (failed) {
      control.terminalReason = 'failed'
      control.terminalCode = control.terminalCode || 'PLATFORM_OBSERVATION_ERROR'
      control.terminalDetail = control.terminalDetail || result.observation.lastActionResult?.visibleMessage || '平台返回错误观察'
      nextState.blackbox.control = control
    }
    if (result.diagnostic?.resetLearningPrivateState === true && nextState.blackbox?.learnerPrivateState?.teaching) {
      const completedTaskState = nextState.blackbox.learnerPrivateState.teaching as Record<string, unknown>
      const privateStateTrace = Array.isArray(nextState.blackbox.learnerPrivateStateTrace)
        ? nextState.blackbox.learnerPrivateStateTrace : []
      const completedTaskTrace = [...privateStateTrace].reverse().find((entry) =>
        entry?.stage === 'teaching' && (!entry?.taskId || entry.taskId === previousControl.taskId)
      )
      const completedTaskId = previousControl.taskId || fresh.currentTaskId || null
      const alreadyArchived = privateStateTrace.some((entry) =>
        entry?.stage === 'teaching' && entry?.taskId === completedTaskId && entry?.transition === 'task_completed'
      )
      nextState.blackbox.learnerPrivateStateTrace = (alreadyArchived ? privateStateTrace : [...privateStateTrace, {
        sequence: publicTrace.length,
        stage: 'teaching',
        taskId: completedTaskId,
        state: completedTaskState,
        emotion: completedTaskTrace?.emotion || null,
        degraded: completedTaskTrace?.degraded === true,
        visibleSignal: completedTaskTrace?.visibleSignal || null,
        stateChangeReason: completedTaskTrace?.stateChangeReason || null,
        transition: 'task_completed',
        generatedAt: new Date().toISOString()
      }]).slice(-120)
      const { teaching: _completedTaskState, ...remainingPrivateState } = nextState.blackbox.learnerPrivateState
      nextState.blackbox.learnerPrivateState = remainingPrivateState
    }
    const completedTaskIncrement = result.control.taskCompleted === true && previousControl.taskId !== result.control.taskId ? 1 : 0
    const totalTasks = typeof control.totalTasks === 'number' ? control.totalTasks : fresh.totalTasks || 0
    const completedTasks = typeof control.completedTasks === 'number'
      ? control.completedTasks
      : completedTaskIncrement ? (fresh.completedTasks || 0) + completedTaskIncrement : fresh.completedTasks || 0
    await this.assertCurrentLease(session.id)
    await prisma.virtual_sessions.update({
      where: { id: session.id },
      data: {
        goalConversationId: control.conversationId || fresh.goalConversationId,
        learningPathId: control.learningPathId || fresh.learningPathId,
        currentTaskId: control.taskId === null ? null : control.taskId || fresh.currentTaskId,
        completedTasks,
        totalTasks,
        currentStage: abandoned || completed ? 'completed' : failed ? 'error' : result.observation.stage,
        status: abandoned ? 'abandoned' : completed ? 'completed' : failed ? 'failed' : 'running',
        completedAt: abandoned || completed || failed ? new Date() : null,
        stageResults: JSON.stringify(nextState),
        updatedAt: new Date()
      }
    })
    return result
  }

  private async projectPlatformResult(
    session: VirtualSessionRow,
    state: StageResults,
    result: PlatformInteractionResult,
    action?: LearnerAction
  ) {
    try {
      const projection = await this.journalProjectionReceipt(session.id, result, action)
      return await this.persist(session, state, result, projection?.projectionKey)
    } catch (error: unknown) {
      if (error instanceof BlackboxReconciliationPendingError) throw error
      if (error instanceof BlackboxLeaseLostError) throw error
      if (error instanceof BlackboxDatabaseBusyError) throw error
      throw this.reconciliationPendingError(error)
    }
  }

  private async journalProjectionReceipt(
    sessionId: string,
    platformResult: PlatformInteractionResult,
    action?: LearnerAction
  ) {
    const context = this.commandContexts.get(sessionId)
    if (!context || context.kind === 'observe' && action) return undefined
    const projectionKey = `${context.commandRowId}:${++context.projectionSequence}`
    const commandResult = context.kind === 'step'
      ? action ? { action, result: platformResult } : { result: platformResult }
      : platformResult
    const receipt: PendingProjectionReceipt = {
      projectionPending: true,
      projectionKey,
      finalProjection: context.kind !== 'step' || Boolean(action),
      receiptKind: 'result',
      platformResult,
      commandResult
    }
    try {
      await this.assertCurrentLease(sessionId)
      await prisma.virtual_experiment_commands.update({
        where: { id: context.commandRowId },
        data: { resultJson: JSON.stringify(receipt) }
      })
      return {
        projectionKey,
        finalProjection: receipt.finalProjection,
        commandRowId: context.commandRowId
      }
    } catch (error: unknown) {
      if (error instanceof BlackboxLeaseLostError || error instanceof BlackboxDatabaseBusyError) throw error
      throw this.reconciliationPendingError(error)
    }
  }

  private async journalCheckpointReceipt(sessionId: string, checkpoint: TaskCompletionCheckpoint) {
    const context = this.commandContexts.get(sessionId)
    if (!context) return undefined
    const projectionKey = `${context.commandRowId}:${++context.projectionSequence}`
    const receipt: PendingProjectionReceipt = {
      projectionPending: true,
      projectionKey,
      finalProjection: false,
      receiptKind: 'checkpoint',
      checkpoint
    }
    try {
      await this.assertCurrentLease(sessionId)
      await prisma.virtual_experiment_commands.update({
        where: { id: context.commandRowId },
        data: { resultJson: JSON.stringify(receipt) }
      })
      return { commandRowId: context.commandRowId, projectionKey }
    } catch (error: unknown) {
      if (error instanceof BlackboxLeaseLostError || error instanceof BlackboxDatabaseBusyError) throw error
      throw this.reconciliationPendingError(error)
    }
  }

  private projectionSequence(projectionKey: string) {
    const suffix = Number(projectionKey.split(':').at(-1))
    return Number.isInteger(suffix) && suffix > 0 ? suffix : 0
  }

  private reconciliationPendingError(error: unknown) {
    const detail = String(asErrorLike(error).message || '虚拟会话持久化失败').slice(0, 500)
    return new BlackboxReconciliationPendingError(
      `平台操作已完成，但黑盒会话持久化失败，请使用相同 Idempotency-Key 重试对账：${detail}`,
      error
    )
  }

  /**
   * 自动对账阻塞 barrier（不同 key 的新命令请求到达时触发）：
   * barrier 命令已持有完整平台回执（finalProjection=true 的 result 回执）时，先落盘该投影
   * 并完成命令，再放行新命令。仅重放已发生的平台副作用（journal 回执），绝不重新执行平台
   * 操作——与同 key 重试的对账路径完全一致，幂等语义不变。
   * 无完整回执（checkpoint / 未终局 step）返回 false，保持「请使用原 Idempotency-Key 重试」语义。
   */
  private async tryResolveOrderingBarrier(sessionId: string, command: VirtualExperimentCommandRow): Promise<boolean> {
    const receipt = this.pendingProjectionReceipt(command)
    if (!receipt || receipt.receiptKind !== 'result' || receipt.finalProjection !== true) return false
    try {
      const session = await this.getSession(sessionId)
      const state = parseStageResults(session.stageResults)
      await this.persist(session, state, receipt.platformResult, receipt.projectionKey)
      await prisma.virtual_experiment_commands.update({
        where: { id: command.id },
        data: {
          status: 'completed',
          resultJson: JSON.stringify(receipt.commandResult),
          errorJson: null,
          completedAt: new Date()
        }
      })
      logger.warn('[Blackbox] 自动对账较早命令并放行后续命令', {
        sessionId,
        commandId: command.commandId,
        projectionKey: receipt.projectionKey
      })
      return true
    } catch (error: unknown) {
      if (error instanceof BlackboxLeaseLostError || error instanceof BlackboxDatabaseBusyError) throw error
      const reconciliationError = error instanceof BlackboxReconciliationPendingError
        ? error
        : this.reconciliationPendingError(error)
      await this.recordCommandFailure(sessionId, command.id, reconciliationError)
      throw reconciliationError
    }
  }

  private async completeCommand(sessionId: string, commandId: string, result: unknown) {
    const resultJson = JSON.stringify(result)
    try {
      await this.assertCurrentLease(sessionId)
      await prisma.virtual_experiment_commands.update({
        where: { id: commandId },
        data: {
          status: 'completed',
          resultJson,
          errorJson: null,
          completedAt: new Date()
        }
      })
    } catch (error) {
      if (error instanceof BlackboxLeaseLostError) throw error
      const current = await prisma.virtual_experiment_commands.findUnique({ where: { id: commandId } })
      if (current?.status === 'completed' && current.resultJson === resultJson) return
      throw error
    }
  }

  private async recordCommandFailure(sessionId: string, commandId: string, error: unknown) {
    if (error instanceof BlackboxLeaseLostError) return
    let current: VirtualExperimentCommandRow | null = null
    try {
      current = await prisma.virtual_experiment_commands.findUnique({ where: { id: commandId } })
    } catch {
      return
    }
    if (current?.status === 'completed') return
    if (error instanceof BlackboxReconciliationPendingError) {
      if (!this.pendingProjectionReceipt(current)) return
    }
    await this.assertCurrentLease(sessionId)
    try {
      await prisma.virtual_experiment_commands.update({
        where: { id: commandId },
        data: {
          status: 'failed',
          errorJson: JSON.stringify({
            name: asErrorLike(error).name || 'Error',
            message: asErrorLike(error).message || '黑盒命令执行失败',
            code: asErrorLike(error).code || null,
            statusCode: asErrorLike(error).statusCode || null,
            // 可恢复标志：LLM/Provider 瞬时失败（平台副作用未发生）→ 同 key 可续跑
            retryable: typeof asErrorLike(error).retryable === 'boolean'
              ? asErrorLike(error).retryable
              : isTransientLlMFailure(error)
          }),
          completedAt: new Date()
        }
      })
    } catch (markError) {
      if (!(error instanceof BlackboxReconciliationPendingError)) throw markError
    }
  }

  private assertMutableSession(session: VirtualSessionRow) {
    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      throw new BlackboxRunStateError('当前黑盒实验已经结束，不能继续修改', 'BLACKBOX_RUN_TERMINAL')
    }
  }

  private reuseCommand<T>(command: VirtualExperimentCommandRow, kind: string, request: unknown): { result: T; reused: boolean } {
    this.assertCommandMatches(command, kind, request)
    if (command.status === 'completed' && command.resultJson) {
      return { result: safeJsonParse(command.resultJson, null) as T, reused: true }
    }
    if (command.status === 'failed') {
      const error = safeJsonParse<{ message?: string }>(command.errorJson, {})
      throw new BlackboxRunStateError(
        `相同命令此前执行失败：${error.message || '未知错误'}`,
        'BLACKBOX_COMMAND_PREVIOUSLY_FAILED'
      )
    }
    throw new BlackboxRunStateError('相同黑盒命令正在执行或结果待对账', 'BLACKBOX_COMMAND_IN_PROGRESS')
  }

  private assertCommandMatches(command: VirtualExperimentCommandRow, kind: string, request: unknown) {
    if (command.kind !== kind || command.requestJson !== JSON.stringify(request ?? null)) {
      throw new BlackboxRunStateError('Idempotency-Key 已用于其他黑盒命令', 'BLACKBOX_COMMAND_ID_REUSED')
    }
  }

  private isReconciliationPendingCommand(command: VirtualExperimentCommandRow): boolean {
    if (this.pendingProjectionReceipt(command)) return true
    return command?.status === 'failed'
      && safeJsonParse<{ code?: string }>(command.errorJson, {}).code === 'BLACKBOX_RECONCILIATION_PENDING'
  }

  /** 可恢复失败命令：errorJson 带 retryable=true（LLM/Provider 瞬时失败，平台副作用未发生），同 key 可续跑 */
  private isRetryableFailedCommand(command: VirtualExperimentCommandRow): boolean {
    if (command?.status !== 'failed') return false
    return safeJsonParse<{ retryable?: unknown }>(command.errorJson, {}).retryable === true
  }

  private isCommandOrderingBarrier(command: VirtualExperimentCommandRow): boolean {
    return command?.status === 'processing' || this.isReconciliationPendingCommand(command)
  }

  private pendingProjectionReceipt(command: VirtualExperimentCommandRow): PendingProjectionReceipt | null {
    const receipt = safeJsonParse(command?.resultJson, null)
    if (receipt?.projectionPending !== true || typeof receipt.projectionKey !== 'string'
      || !receipt.projectionKey || typeof receipt.finalProjection !== 'boolean') return null
    if (receipt.receiptKind === 'result' && receipt.platformResult && 'commandResult' in receipt) {
      return receipt as PendingProjectionReceipt
    }
    if (receipt.receiptKind === 'checkpoint' && receipt.checkpoint) return receipt as PendingProjectionReceipt
    return null
  }

  private async acquireCommandLease(sessionId: string, ownerId: string): Promise<Date> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + COMMAND_LEASE_MS)
    try {
      const updated = await prisma.virtual_experiment_leases.updateMany({
        where: { sessionId, expiresAt: { lt: now } },
        data: { ownerId, expiresAt }
      })
      if (updated.count === 1) return expiresAt
    } catch (error) {
      if (isLeaseDatabaseBusyError(error)) throw new BlackboxDatabaseBusyError(error)
      throw error
    }
    try {
      await prisma.virtual_experiment_leases.create({ data: { sessionId, ownerId, expiresAt } })
      return expiresAt
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) throw new BlackboxSessionBusyError()
      if (isLeaseDatabaseBusyError(error)) throw new BlackboxDatabaseBusyError(error)
      throw error
    }
  }

  private async releaseCommandLease(sessionId: string, ownerId: string) {
    try {
      await prisma.virtual_experiment_leases.deleteMany({ where: { sessionId, ownerId } })
    } catch (error) {
      if (isLeaseDatabaseBusyError(error)) throw new BlackboxDatabaseBusyError(error)
      throw error
    }
  }

  private startLeaseRenewal(sessionId: string, ownerId: string, expiresAt: Date): LeaseContext {
    const context: LeaseContext = {
      sessionId,
      ownerId,
      expiresAt: expiresAt.getTime(),
      renewal: Promise.resolve(),
      failureError: null
    }
    context.timer = setInterval(() => {
      void this.renewLease(context).catch(() => undefined)
    }, COMMAND_LEASE_RENEW_MS)
    context.timer.unref?.()
    this.leaseContexts.set(sessionId, context)
    return context
  }

  private async stopLeaseRenewal(context: LeaseContext) {
    if (context.timer) clearInterval(context.timer)
    try {
      await context.renewal
    } finally {
      if (this.leaseContexts.get(context.sessionId) === context) this.leaseContexts.delete(context.sessionId)
    }
  }

  private async cleanupLease(context: LeaseContext, primaryError: unknown) {
    let cleanupError: unknown
    try {
      await this.stopLeaseRenewal(context)
    } catch (error) {
      cleanupError = error
    }
    try {
      await this.releaseCommandLease(context.sessionId, context.ownerId)
    } catch (error) {
      if (!cleanupError) cleanupError = error
    }
    if (!cleanupError) return
    logger.error('[Blackbox] 执行租约清理失败', {
      sessionId: context.sessionId,
      ownerId: context.ownerId,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    })
    if (!primaryError) throw cleanupError
  }

  private async renewLease(context: LeaseContext) {
    const renewal = context.renewal.then(async () => {
      if (context.failureError) throw context.failureError
      for (let attempt = 0; ; attempt += 1) {
        const now = new Date()
        if (now.getTime() >= context.expiresAt) {
          context.failureError = new BlackboxLeaseLostError()
          throw context.failureError
        }
        const expiresAt = new Date(now.getTime() + COMMAND_LEASE_MS)
        try {
          const renewed = await prisma.virtual_experiment_leases.updateMany({
            where: { sessionId: context.sessionId, ownerId: context.ownerId, expiresAt: { gt: now } },
            data: { expiresAt }
          })
          if (renewed.count !== 1) {
            context.failureError = new BlackboxLeaseLostError()
            throw context.failureError
          }
          context.expiresAt = expiresAt.getTime()
          return
        } catch (error) {
          if (!isLeaseDatabaseBusyError(error)) throw error
          const delayMs = LEASE_RETRY_DELAYS_MS[attempt]
          const remainingMs = context.expiresAt - Date.now()
          if (delayMs === undefined || remainingMs <= delayMs) {
            context.failureError = new BlackboxDatabaseBusyError(error)
            throw context.failureError
          }
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      }
    })
    context.renewal = renewal.catch(error => {
      if (!context.failureError) context.failureError = error
      throw error
    })
    await context.renewal
  }

  private async assertCurrentLease(sessionId: string) {
    const context = this.leaseContexts.get(sessionId)
    if (context) await this.renewLease(context)
  }

  private assertActionAllowed(
    action: LearnerAction,
    latestObservation: LearnerObservation | undefined,
    control: PlatformControlReceipt
  ) {
    const completionCheckpoint = this.currentTaskCompletionCheckpoint(control)
    if (action.type === 'confirm_complete' && completionCheckpoint) return

    if (!latestObservation) {
      if (action.type !== 'chat' && action.type !== 'abandon') {
        throw new BlackboxRunStateError('Blackbox Goal 首轮必须使用 chat 动作', 'BLACKBOX_FIRST_ACTION_INVALID')
      }
      return
    }

    if (!latestObservation.availableActions.includes(action.type)) {
      throw new BlackboxRunStateError(
        `当前 Observation 不允许 ${action.type} 动作`,
        action.type === 'confirm_complete' ? 'BLACKBOX_COMPLETION_NOT_READY' : 'BLACKBOX_ACTION_NOT_ALLOWED'
      )
    }

    if (action.type === 'start_learning') {
      const taskId = action.taskId || control.taskId
      if (!taskId || taskId !== control.taskId || taskId !== latestObservation.visibleTask?.id) {
        throw new BlackboxRunStateError('启动任务与当前 Observation 不一致', 'BLACKBOX_TASK_MISMATCH')
      }
    }

    if (action.type === 'confirm_complete') {
      if (latestObservation.stage !== 'teaching' || !control.taskId || !control.teachingSessionId) {
        throw new BlackboxRunStateError('当前教学任务尚未满足完成条件', 'BLACKBOX_COMPLETION_NOT_READY')
      }
      if (latestObservation.visibleTask?.id && latestObservation.visibleTask.id !== control.taskId) {
        throw new BlackboxRunStateError('完成任务与当前 Observation 不一致', 'BLACKBOX_TASK_MISMATCH')
      }
    }
  }

  private async completeCurrentTask(
    session: VirtualSessionRow,
    state: StageResults,
    adapter: PlatformUserAdapter,
    control: PlatformControlReceipt,
    latestObservation?: LearnerObservation,
    finalizedTeachingResult?: PlatformInteractionResult
  ): Promise<PlatformInteractionResult> {
    const taskId = control.taskId
    const teachingSessionId = control.teachingSessionId
    const learningPathId = control.learningPathId
    if (!taskId || !teachingSessionId || !learningPathId) {
      throw new BlackboxRunStateError('当前教学任务缺少完成所需的平台标识', 'BLACKBOX_COMPLETION_NOT_READY')
    }

    let checkpoint = this.currentTaskCompletionCheckpoint(control)
    let teachingEndResult = finalizedTeachingResult || null
    if (!checkpoint) {
      teachingEndResult = teachingEndResult
        || await adapter.endTeaching(teachingSessionId, control.teachingRevision, 'completed')
      checkpoint = {
        taskId,
        teachingSessionId,
        teachingRevision: this.checkpointTeachingRevision(teachingEndResult.control?.teachingRevision, control.teachingRevision),
        status: 'teaching_finalized',
        updatedAt: new Date().toISOString()
      }
      await this.persistTaskCompletionCheckpointAfterExternal(session.id, state, checkpoint)
    }

    let taskResult: PlatformInteractionResult | null = null
    if (checkpoint.status !== 'task_completed') {
      try {
        taskResult = await adapter.completeTask(taskId)
        // 任务真正结算后：虚拟学习者记忆回写（画像概念 + 成果物登记），best-effort
        await this.persistLearnerMemoryAfterTask(session, taskId, teachingSessionId, state)
      } catch (error: unknown) {
        const lastError = String(asErrorLike(error).message || '任务完成同步失败').slice(0, 1000)
        checkpoint = {
          ...checkpoint,
          status: 'teaching_finalized',
          updatedAt: new Date().toISOString(),
          lastError
        }
        await this.persistTaskCompletionCheckpointAfterExternal(session.id, state, checkpoint)
        return this.taskCompletionRetryResult(control, checkpoint, latestObservation, teachingEndResult, error)
      }

      checkpoint = {
        ...checkpoint,
        status: 'task_completed',
        updatedAt: new Date().toISOString()
      }
      delete checkpoint.lastError
      await this.persistTaskCompletionCheckpointAfterExternal(session.id, state, checkpoint)
    }

    let pathResult: PlatformInteractionResult
    try {
      pathResult = await adapter.getPath(learningPathId)
    } catch (error: unknown) {
      return this.taskCompletionRetryResult(
        control,
        checkpoint,
        latestObservation,
        teachingEndResult,
        error,
        true
      )
    }
    return this.completedTaskPathResult(pathResult, taskResult, teachingEndResult, checkpoint)
  }

  private currentTaskCompletionCheckpoint(control: PlatformControlReceipt): TaskCompletionCheckpoint | null {
    const checkpoint = control.taskCompletionCheckpoint
    if (!checkpoint || typeof checkpoint !== 'object') return null
    if (checkpoint.taskId !== control.taskId || checkpoint.teachingSessionId !== control.teachingSessionId) return null
    if (!['teaching_finalized', 'task_completed'].includes(checkpoint.status)) return null
    return checkpoint
  }

  private checkpointTeachingRevision(primary: unknown, fallback: unknown): number | null {
    if (Number.isInteger(primary) && Number(primary) >= 0) return Number(primary)
    if (Number.isInteger(fallback) && Number(fallback) >= 0) return Number(fallback)
    return null
  }

  /**
   * 黑盒任务结算后的记忆回写：
   * - 从 teaching session 的 knowledgeState（课堂知识看板）回写画像概念
   * - 登记「做完的事」（成果物，含验收标准 / 课堂掌握概念）
   * best-effort：失败不阻断任务完成主流程。
   */
  private async persistLearnerMemoryAfterTask(
    session: VirtualSessionRow,
    taskId: string,
    teachingSessionId: string,
    state: StageResults
  ): Promise<void> {
    try {
      const [teaching, task] = await Promise.all([
        prisma.teaching_sessions.findUnique({ where: { id: teachingSessionId } }).catch(() => null),
        prisma.subtasks.findUnique({ where: { id: taskId } }).catch(() => null),
      ]);
      const knowledgePoints: LessonKnowledgePoint[] = Array.isArray(teaching?.knowledgeState)
        ? (teaching.knowledgeState as LessonKnowledgePoint[]).filter(
            (kp) => kp && typeof kp.name === 'string' && kp.name.trim()
          )
        : [];
      // 内部提炼：从私有状态轨迹（模拟器自己的收束轮自述）提取，而非抄老师侧看板
      const trace = Array.isArray(state.blackbox?.learnerPrivateStateTrace)
        ? state.blackbox.learnerPrivateStateTrace
        : null;
      const selfState = extractSelfStateFromTrace(trace, taskId);
      // 记忆提炼 skill（LLM 主路径，失败走确定性 fallback）
      const curated = await this.runMemoryCurator(session, state, teachingSessionId, task, trace);
      const curatedMastered = curated?.masteredConcepts?.map((m) => m.name) || [];
      const curatedStruggle = curated?.struggleConcepts?.map((s) => s.name) || [];
      const effectiveSelfState: SelfReportedLearnerState | null = curated
        ? {
            ...(selfState || {}),
            conceptName: curatedMastered[0] || curatedStruggle[0] || selfState?.conceptName || task?.title || null,
            conceptualMastery: curatedMastered.length > 0 ? 0.85 : selfState?.conceptualMastery ?? null,
            selfReportedTaskDone: curatedMastered.length > 0 ? true : selfState?.selfReportedTaskDone ?? null,
            remainingBlockers: curatedStruggle.length > 0
              ? curated.struggleConcepts.map((s) => s.blocker).filter(Boolean)
              : selfState?.remainingBlockers || null,
          }
        : selfState;
      await writeProfileConceptsAfterLesson(session.userId, knowledgePoints, {
        source: 'blackbox',
        selfState: effectiveSelfState,
      });
      await recordCompletedArtifact({
        userId: session.userId,
        taskId,
        taskTitle: task?.title || '当前任务',
        artifactType: task?.taskType || null,
        deliverable: task?.acceptanceCriteria || null,
        knowledgePoints,
        selfState: effectiveSelfState,
        milestoneTitle: (task as any)?.milestones?.title || null,
        memoryDelta: curated?.memoryDelta || null,
        memoryCurated: curated ? {
          mastered: curatedMastered,
          struggling: curatedStruggle,
          selfCalibration: curated.selfCalibration,
        } : undefined,
      });
    } catch (error) {
      logger.warn('[Blackbox] 虚拟学习者记忆回写失败（不影响任务完成）', {
        sessionId: session.id,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 调用记忆提炼 skill（LLM 主路径；失败返回 null，由确定性 fallback 兜底）。
   * 输入：画像 + 本课回合压缩序列 + 当前任务 + 旧记忆。
   */
  private async runMemoryCurator(
    session: VirtualSessionRow,
    state: StageResults,
    teachingSessionId: string,
    task: { title: string; linkedConcept?: string | null; acceptanceCriteria?: string | null } | null,
    trace: Array<Record<string, any>> | null
  ): Promise<{
    masteredConcepts: Array<{ name: string; evidence: string; confidence: number }>;
    struggleConcepts: Array<{ name: string; blocker: string; severity: string }>;
    selfCalibration: string;
    memoryDelta: string;
  } | null> {
    try {
      const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: session.virtualProfileId } });
      if (!profile) return null;
      const persona = {
        ...safeJsonParse<Record<string, unknown>>(profile.profile, {}),
        learningGoal: profile.learningGoal,
      };
      // 从私有轨迹构建回合压缩序列（只取 teaching 阶段）
      const turnSequence = (trace || [])
        .filter((entry) => entry?.stage === 'teaching')
        .slice(-24)
        .map((entry, index) => {
          const s = (entry?.state && typeof entry.state === 'object' ? entry.state : {}) as Record<string, any>;
          const f = (s.learnerFeedback && typeof s.learnerFeedback === 'object' ? s.learnerFeedback : {}) as Record<string, any>;
          return {
            turn: index + 1,
            reply: typeof s.reply === 'string' ? s.reply : '',
            emotion: typeof s.emotion === 'string' ? s.emotion : null,
            learnerState: {
              phaseFocus: typeof s.phaseFocus === 'string' ? s.phaseFocus : undefined,
              conceptualMastery: typeof s.conceptualMastery === 'number' ? s.conceptualMastery : undefined,
              taskUnderstanding: typeof s.taskUnderstanding === 'number' ? s.taskUnderstanding : undefined,
              wantsHint: typeof s.wantsHint === 'boolean' ? s.wantsHint : undefined,
            },
            learnerFeedback: {
              selfReportedTaskDone: typeof f.selfReportedTaskDone === 'boolean' ? f.selfReportedTaskDone : undefined,
              confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
              wantsMoreHelp: typeof f.wantsMoreHelp === 'boolean' ? f.wantsMoreHelp : undefined,
              remainingBlockers: Array.isArray(f.remainingBlockers) ? f.remainingBlockers : undefined,
            },
          };
        });
      // 若轨迹无 teaching 回合（异常），回退 teaching session 消息
      const effectiveTurns = turnSequence.length > 0 ? turnSequence : this.buildFallbackTurnSequence(teachingSessionId);
      const existing = await buildLearnerMemorySnapshot(session.userId, { limit: 30 }).catch(() => null);
      const result = await executeSkill(virtualLearnerMemoryCuratorDefinition, {
        persona,
        turnSequence: effectiveTurns,
        currentTask: {
          title: task?.title || null,
          linkedConcept: task?.linkedConcept || null,
          acceptanceCriteria: task?.acceptanceCriteria || null,
        },
        existingKnown: existing?.mastered.map((m) => m.name) || [],
        existingStruggle: existing?.struggling.map((m) => m.name) || [],
      });
      if (!result.success || !result.output) return null;
      const output = result.output as any;
      return {
        masteredConcepts: Array.isArray(output.masteredConcepts) ? output.masteredConcepts : [],
        struggleConcepts: Array.isArray(output.struggleConcepts) ? output.struggleConcepts : [],
        selfCalibration: typeof output.selfCalibration === 'string' ? output.selfCalibration : '',
        memoryDelta: typeof output.memoryDelta === 'string' ? output.memoryDelta : '',
      };
    } catch (error) {
      logger.warn('[Blackbox] 记忆提炼 skill 调用失败，走确定性 fallback', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** 回退：从 teaching session 消息构建回合序列（轨迹缺失时） */
  private async buildFallbackTurnSequence(teachingSessionId: string): Promise<Array<Record<string, any>>> {
    try {
      const teaching = await prisma.teaching_sessions.findUnique({ where: { id: teachingSessionId } });
      const raw = teaching?.messages ?? null;
      const messages = typeof raw === 'string'
        ? safeJsonParse<any[]>(raw, [])
        : Array.isArray(raw)
          ? raw
          : [];
      return messages.slice(-24).map((m: any, index: number) => ({
        turn: index + 1,
        reply: typeof m.content === 'string' ? m.content : '',
        emotion: null,
        learnerState: undefined,
        learnerFeedback: undefined,
        role: m.role || 'learner',
      }));
    } catch {
      return [];
    }
  }

  /**
   * 组装学习者记忆快照（knowledgeSnapshot 用）：
   * - 画像 knownConcepts（历次课后沉淀的已掌握概念）
   * - memory_traces 到期复习点（旧知唤醒：记得学过、但快忘了）
   * - 画像 struggleConcepts（仍在学/易混淆）
   * - 最近完成事项（成果物标题）
   * 当前任务概念固定附加在首位（保持「当前在看什么」）。
   */
  private async buildLearnerKnowledgeSnapshot(
    userId: string,
    visibleTask: LearnerObservation['visibleTask'] | undefined
  ): Promise<Array<{ name: string; status: string; progress: number }>> {
    const memory = await buildLearnerMemorySnapshot(userId, { limit: 6 }).catch(() => null);
    const currentName = visibleTask?.linkedConcept || visibleTask?.title || null;
    const result: Array<{ name: string; status: string; progress: number }> = [];
    if (currentName) result.push({ name: String(currentName), status: 'learning', progress: 40 });
    for (const item of memory?.mastered || []) {
      result.push({ name: item.name, status: 'mastered', progress: 100 });
    }
    for (const item of memory?.dueReview || []) {
      result.push({ name: item.name, status: 'review', progress: item.progress });
    }
    for (const item of memory?.struggling || []) {
      result.push({ name: item.name, status: 'learning', progress: 30 });
    }
    return result.slice(0, 8);
  }

  /**
   * 组装学习者记忆（learnerMemory 用，供模拟器自然引用）：
   * 已掌握 / 到期复习 / 易混淆 + 最近完成事项（成果物标题）。
   */
  private async buildLearnerMemoryForSimulator(
    userId: string
  ): Promise<{
    mastered: string[];
    dueReview: string[];
    struggling: string[];
    recentCompleted: string[];
  } | null> {
    const memory = await buildLearnerMemorySnapshot(userId, { limit: 8 }).catch(() => null);
    if (!memory) return null;
    return {
      mastered: memory.mastered.map((item) => item.name),
      dueReview: memory.dueReview.map((item) => item.name),
      struggling: memory.struggling.map((item) => item.name),
      recentCompleted: memory.recentTaskTitles,
    };
  }

  private async persistTaskCompletionCheckpoint(
    sessionId: string,
    state: StageResults,
    checkpoint: TaskCompletionCheckpoint,
    projectionKey?: string
  ) {    const fresh = await this.getSession(sessionId)
    this.assertMutableSession(fresh)
    const latestState = parseStageResults(fresh.stageResults, state)
    const projectedCommandIds = Array.isArray(latestState.blackbox?.projectedCommandIds)
      ? latestState.blackbox.projectedCommandIds : []
    if (projectionKey && projectedCommandIds.includes(projectionKey)) return
    const control = {
      ...(latestState.blackbox?.control || {}),
      taskCompletionCheckpoint: checkpoint
    }
    if (control.terminalReason === 'completed' && control.runCompleted !== true) delete control.terminalReason
    const nextState = {
      ...latestState,
      blackbox: {
        ...(latestState.blackbox || {}),
        control,
        ...(projectionKey
          ? { projectedCommandIds: [...projectedCommandIds, projectionKey].slice(-200) }
          : {})
      }
    }
    await this.assertCurrentLease(sessionId)
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(nextState), updatedAt: new Date() }
    })
  }

  private async persistTaskCompletionCheckpointAfterExternal(
    sessionId: string,
    state: StageResults,
    checkpoint: TaskCompletionCheckpoint
  ) {
    try {
      const receipt = await this.journalCheckpointReceipt(sessionId, checkpoint)
      await this.persistTaskCompletionCheckpoint(sessionId, state, checkpoint, receipt?.projectionKey)
    } catch (error: unknown) {
      if (error instanceof BlackboxReconciliationPendingError) throw error
      if (error instanceof BlackboxLeaseLostError || error instanceof BlackboxDatabaseBusyError) throw error
      throw this.reconciliationPendingError(error)
    }
  }

  private taskCompletionRetryResult(
    control: PlatformControlReceipt,
    checkpoint: TaskCompletionCheckpoint,
    latestObservation: LearnerObservation | undefined,
    teachingEndResult: PlatformInteractionResult | null,
    error: unknown,
    taskCompleted = false
  ): PlatformInteractionResult {
    const errorMessage = String(asErrorLike(error).message || '任务完成同步失败').slice(0, 300)
    const visibleMessage = taskCompleted
      ? `任务已完成，但学习路径刷新失败：${errorMessage}。请重试刷新学习路径。`
      : `课堂已结束，但任务完成同步失败：${errorMessage}。请重试完成任务。`
    return {
      observation: {
        stage: 'teaching',
        visibleMessages: [
          ...(teachingEndResult?.observation?.visibleMessages || []),
          { role: 'platform', content: visibleMessage }
        ],
        visibleTask: latestObservation?.visibleTask,
        availableActions: ['confirm_complete', 'abandon'],
        lastActionResult: { status: 'error', visibleMessage }
      },
      control: {
        learningPathId: control.learningPathId,
        teachingSessionId: checkpoint.teachingSessionId,
        teachingRevision: checkpoint.teachingRevision,
        taskId: checkpoint.taskId,
        taskCompleted,
        platformStage: taskCompleted ? 'path-refresh-pending' : 'task-completion-pending',
        taskCompletionCheckpoint: checkpoint
      },
      diagnostic: {
        teachingEnd: teachingEndResult?.diagnostic || null,
        completedTask: {
          status: taskCompleted ? 'completed_path_refresh_pending' : 'pending_retry',
          error: {
            name: String(asErrorLike(error).name || 'Error'),
            message: errorMessage,
            status: typeof asErrorLike(error).status === 'number' ? asErrorLike(error).status : null
          }
        }
      }
    }
  }

  private completedTaskPathResult(
    pathResult: PlatformInteractionResult,
    taskResult: PlatformInteractionResult | null,
    teachingEndResult: PlatformInteractionResult | null,
    checkpoint: TaskCompletionCheckpoint
  ): PlatformInteractionResult {
    return {
      ...pathResult,
      control: { ...pathResult.control, taskCompleted: true, taskCompletionCheckpoint: checkpoint },
      diagnostic: {
        ...(pathResult.diagnostic || {}),
        completedTask: taskResult?.diagnostic || null,
        teachingEnd: teachingEndResult?.diagnostic || null,
        resetLearningPrivateState: pathResult.control.runCompleted !== true
      }
    }
  }

  private async executeWithFailurePersistence<T>(sessionId: string, code: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error: unknown) {
      if (!(error instanceof BlackboxRunStateError)
        && !(error instanceof VirtualSessionModeError)
        && !(error instanceof BlackboxReconciliationPendingError)
        && !(error instanceof BlackboxLeaseLostError)
        && !(error instanceof BlackboxDatabaseBusyError)
        && !(error instanceof BlackboxSessionBusyError)) {
        if (this.isRecoverableExecutionFailure(error)) {
          // 可恢复瞬时失败（LLM 超时/上游 5xx/结构非法等）：不终局化整场实验，
          // 命令已由 runCommand 标记 failed + retryable，前端可用相同 Idempotency-Key 续跑。
          // 平台副作用未发生（这类错误发生在平台调用或模拟器生成阶段），重放是安全的。
          logger.warn('[Blackbox] 可恢复瞬时失败，实验保持 running，可用相同 Idempotency-Key 重试', {
            sessionId,
            code,
            error: error instanceof Error ? error.message : String(error)
          })
        } else {
          await this.persistUnexpectedFailure(sessionId, code, error)
        }
      }
      throw error
    }
  }

  private async persistUnexpectedFailure(sessionId: string, code: string, error: unknown) {
    try {
      const session = await this.getSession(sessionId)
      if (TERMINAL_SESSION_STATUSES.has(session.status)) return
      const state = parseStageResults(session.stageResults)
      assertBlackboxSessionMode(state)
      const message = String(asErrorLike(error).message || '黑盒实验执行失败').slice(0, 1000)
      await this.persist(session, state, {
        observation: {
          stage: 'error',
          visibleMessages: [],
          availableActions: [],
          lastActionResult: { status: 'error', visibleMessage: message }
        },
        control: {
          platformStage: state.blackbox?.control?.platformStage || session.currentStage,
          terminalReason: 'failed',
          terminalCode: code,
          terminalDetail: message
        },
        diagnostic: {
          error: {
            name: String(asErrorLike(error).name || 'Error'),
            message,
            status: typeof asErrorLike(error).status === 'number' ? asErrorLike(error).status : null
          }
        }
      })
    } catch {
      // 保留原始异常，失败记录不能掩盖调用方真正收到的错误。
    }
  }

  private visibleHistory(state: StageResults): Array<{ role: string; content: string }> {
    return (state.blackbox?.publicTrace || []).flatMap((entry) => entry?.observation?.visibleMessages || [])
  }

  private latestRefereeReport(state: StageResults) {
    const reports = Array.isArray(state.blackbox?.refereeReports) ? state.blackbox.refereeReports : []
    const latestId = state.blackbox?.latestRefereeReportId
    return reports.find((item) => item.id === latestId) || reports[reports.length - 1] || null
  }

  private latestActorAuditReport(state: StageResults) {
    const reports = Array.isArray(state.blackbox?.actorAuditReports) ? state.blackbox.actorAuditReports : []
    const latestId = state.blackbox?.latestActorAuditReportId
    return reports.find((item) => item.id === latestId) || reports[reports.length - 1] || null
  }

  private teachingSessionIds(state: StageResults): string[] {
    const ids = new Set<string>()
    const trace = Array.isArray(state.blackbox?.publicTrace) ? state.blackbox.publicTrace : []
    for (const entry of trace) {
      const sessionId = entry?.control?.teachingSessionId
      if (typeof sessionId === 'string' && sessionId.trim()) ids.add(sessionId.trim())
    }
    const currentSessionId = state.blackbox?.control?.teachingSessionId
    if (typeof currentSessionId === 'string' && currentSessionId.trim()) ids.add(currentSessionId.trim())
    return [...ids]
  }

  private async assertSyntheticUserBinding(session: VirtualSessionRow) {
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id: session.virtualProfileId },
      select: { userId: true }
    })
    if (!profile) {
      throw new BlackboxRunStateError('虚拟学习者画像不存在', 'BLACKBOX_PROFILE_NOT_FOUND', 404)
    }
    if (profile.userId !== session.userId) {
      throw new BlackboxRunStateError('虚拟会话与合成用户绑定不一致', 'BLACKBOX_SYNTHETIC_USER_MISMATCH')
    }
  }

  private displayPlatformMetrics(metrics: { lss: number; ktl: number; lf: number; lsb: number }) {
    return {
      lss: Number((metrics.lss * 10).toFixed(2)),
      ktl: Number((metrics.ktl * 10).toFixed(2)),
      lf: Number((metrics.lf * 10).toFixed(2)),
      lsb: Number((metrics.lsb * 10).toFixed(2))
    }
  }

  private actorStateTimeline(state: StageResults) {
    const trace = Array.isArray(state.blackbox?.learnerPrivateStateTrace)
      ? state.blackbox.learnerPrivateStateTrace.slice(-120) : []
    return trace.map((entry: LearnerPrivateStateTraceEntry, index: number) => {
      const stage = entry?.stage === 'teaching' ? 'teaching' : 'goal'
      const actorState = (entry?.state && typeof entry.state === 'object' ? entry.state : {}) as Record<string, unknown>
      const feedback = (actorState.learnerFeedback && typeof actorState.learnerFeedback === 'object'
        ? actorState.learnerFeedback : {}) as Record<string, unknown>
      const metricKeys = stage === 'goal'
        ? ['feltUnderstood', 'problemClarity', 'proposalFit', 'taskRelevance', 'executionConcern', 'goalReadiness']
        : ['taskUnderstanding', 'conceptualMastery', 'proceduralMastery', 'misconceptionRisk', 'helpSeekingReadiness', 'cognitiveLoad']
      const feedbackKeys = stage === 'teaching' ? ['satisfaction', 'confidence'] : []
      const metrics = Object.fromEntries([
        ...metricKeys.map((key) => [key, this.displayActorMetric(actorState[key])]),
        ...feedbackKeys.map((key) => [key, this.displayActorMetric(feedback[key])])
      ].filter(([, value]) => value !== null))
      const flagKeys = stage === 'goal'
        ? ['willingToTry', 'readyToProceed', 'wantsClarification', 'readyToAdvance']
        : ['wantsHint', 'wantsWorkedExample', 'readyForNextTask']
      const feedbackFlagKeys = stage === 'teaching'
        ? ['selfReportedTaskDone', 'wantsMoreHelp', 'stopAsking'] : []
      const flags = Object.fromEntries([
        ...flagKeys.map((key) => [key, actorState[key]]),
        ...feedbackFlagKeys.map((key) => [key, feedback[key]])
      ].filter(([, value]) => typeof value === 'boolean'))
      const blockers = stage === 'goal'
        ? actorState.remainingUnknowns
        : Array.isArray(feedback.remainingBlockers) && feedback.remainingBlockers.length
          ? feedback.remainingBlockers : actorState.remainingBlockers
      const visibleSignal = this.timelineText(entry?.visibleSignal || deepValue(actorState, ['debug', 'visibleSignal']), 240)

      return {
        sequence: Number.isInteger(entry?.sequence) ? entry.sequence : index,
        stage,
        taskId: typeof entry?.taskId === 'string' ? entry.taskId : null,
        phaseFocus: this.timelineText(actorState.phaseFocus, 64),
        emotion: this.timelineText(entry?.emotion || actorState.emotion, 64),
        degraded: entry?.degraded === true || actorState.degraded === true || visibleSignal === 'fallback',
        transition: this.timelineText(entry?.transition, 64),
        stateChangeReason: this.timelineText(entry?.stateChangeReason || deepValue(actorState, ['debug', 'stateChangeReason']), 320),
        visibleSignal,
        metrics,
        flags,
        blockers: Array.isArray(blockers)
          ? blockers.map((item: unknown) => this.timelineText(item, 240)).filter(Boolean).slice(0, 5) : [],
        generatedAt: this.timelineText(entry?.generatedAt, 64)
      }
    })
  }

  private displayActorMetric(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) return null
    return Number((Math.max(0, Math.min(1, numeric)) * 100).toFixed(2))
  }

  private timelineText(value: unknown, limit: number): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized ? normalized.slice(0, limit) : null
  }

  private async buildRefereeInput(session: VirtualSessionRow, state: StageResults): Promise<VirtualLearnerRefereeInput> {
    const { rawPublic, publicTrace, summary } = this.buildSharedAuditTrace(session, state)
    const rawReferee = Array.isArray(state.blackbox?.refereeTrace) ? state.blackbox.refereeTrace : []
    const refereeTrace = this.compactTrace(rawReferee, 120).map((entry: BlackboxRefereeTraceEntry) => ({
      timestamp: String(entry?.timestamp || ''),
      traceId: typeof entry?.traceId === 'string' ? entry.traceId : null,
      diagnostic: this.sanitizeDiagnostic(entry?.diagnostic)
    })) as BlackboxRefereeTraceEntry[]
    const control = state.blackbox?.control && typeof state.blackbox.control === 'object' ? state.blackbox.control : {}
    summary.refereeTraceCount = rawReferee.length
    summary.inputCoverage.originalRefereeTraceCount = rawReferee.length
    summary.inputCoverage.includedRefereeTraceCount = refereeTrace.length
    summary.inputCoverage.truncated = summary.inputCoverage.truncated || rawReferee.length !== refereeTrace.length
    return {
      publicTrace,
      refereeTrace,
      control,
      experimentSummary: summary,
      storyMeta: await this.buildRefereeStoryMeta(session, state),
      metricCompleteness: await this.buildRefereeMetricCompleteness(session, state)
    }
  }

  /** 平行通道：故事元数据 + 当次诉求（不进入 Goal/Path 主链，只给裁判评估「目标理解」） */
  private async buildRefereeStoryMeta(session: VirtualSessionRow, state: StageResults): Promise<RefereeStoryMeta | null> {
    const snapshot = await this.getExperimentSnapshot(session, state)
    const story = snapshot.story && typeof snapshot.story === 'object' ? snapshot.story : null
    const learner = snapshot.actorProfile && typeof snapshot.actorProfile === 'object' ? snapshot.actorProfile : {}
    const demand = resolveStorySessionDemand({
      story,
      profileLearningGoal: learner?.learningGoal,
    })
    if (!story && !demand.text) return null
    const goalSeed = (story?.goalSeed && typeof story.goalSeed === 'object' ? story.goalSeed : {}) as Record<string, unknown>
    return {
      personaSummary: typeof learner?.profile?.occupation === 'string'
        ? `${learner?.learningGoal || ''}｜${learner.profile.occupation}`
        : learner?.learningGoal || null,
      storyId: demand.storyId,
      storyTitle: this.timelineText(story?.title, 200),
      surfaceGoal: this.timelineText(goalSeed.surfaceGoal, 500),
      realProblem: this.timelineText(goalSeed.realProblem, 500),
      triggerEvent: this.timelineText(story?.triggerEvent || story?.storyTriggerEvent, 500),
      demandText: demand.text ? demand.text.slice(0, 800) : null,
      demandSource: demand.source === 'none' ? null : demand.source
    }
  }

  /** 数据完整性：平台侧教学指标 / wrapup 产出情况（供裁判 evidenceSufficiency 判断） */
  private async buildRefereeMetricCompleteness(session: VirtualSessionRow, state: StageResults): Promise<RefereeMetricCompleteness> {
    const base = { available: true, teachingSessions: 0, wrapupPresent: 0, metricsPresent: 0, lssPresent: 0, degraded: false, error: null as string | null }
    try {
      const teachingSessionIds = this.teachingSessionIds(state)
      if (!teachingSessionIds.length) return base
      const timeline = await learningStateService.getSessionStateTimeline(session.userId, teachingSessionIds)
      base.teachingSessions = timeline.length
      for (const entry of timeline) {
        if (entry.summarySource || entry.evaluationSource || entry.source !== 'missing') base.wrapupPresent += 1
        if (entry.metrics) {
          base.metricsPresent += 1
          if (typeof entry.metrics.lss === 'number') base.lssPresent += 1
        }
        if (entry.degraded) base.degraded = true
      }
      return base
    } catch (error) {
      return {
        ...base,
        available: false,
        error: String(error instanceof Error ? error.message : error).slice(0, 300)
      }
    }
  }

  private async buildActorAuditInput(session: VirtualSessionRow, state: StageResults): Promise<VirtualLearnerActorAuditInput> {
    const snapshot = await this.getExperimentSnapshot(session, state)
    const { publicTrace, summary } = this.buildSharedAuditTrace(session, state)
    return {
      actorProfile: this.sanitizeAuditValue(snapshot.actorProfile, 0) as VirtualLearnerActorAuditInput['actorProfile'],
      story: (snapshot.story && typeof snapshot.story === 'object' ? this.sanitizeAuditValue(snapshot.story, 0) : null) as Record<string, unknown> | null,
      frictionBudget: snapshot.frictionBudget as VirtualLearnerActorAuditInput['frictionBudget'],
      learnerPrivateState: this.sanitizeAuditValue({
        latest: state.blackbox?.learnerPrivateState || {},
        trace: state.blackbox?.learnerPrivateStateTrace || []
      }, 0) as Record<string, unknown>,
      publicTrace: publicTrace.map(entry => ({ timestamp: entry.timestamp, observation: entry.observation })),
      experimentSummary: summary
    }
  }

  private buildSharedAuditTrace(session: VirtualSessionRow, state: StageResults) {
    const rawPublic = Array.isArray(state.blackbox?.publicTrace) ? state.blackbox.publicTrace : []
    const publicTrace = this.compactTrace(rawPublic, 120).map((entry: BlackboxPublicTraceEntry) => ({
      timestamp: String(entry?.timestamp || ''),
      observation: this.sanitizeObservation(entry?.observation),
      control: entry?.control && typeof entry.control === 'object' ? entry.control : {}
    })) as BlackboxPublicTraceEntry[]
    const control = state.blackbox?.control && typeof state.blackbox.control === 'object' ? state.blackbox.control : {}
    const stageCoverage = {
      goal: false,
      path: false,
      teaching: false,
      completed: false,
      error: false
    } as Record<LearnerObservation['stage'], boolean>
    for (const entry of publicTrace) stageCoverage[entry.observation.stage] = true
    const startedAt = state.experiment?.createdAt || session.createdAt?.toISOString?.() || null
    const completedAt = session.completedAt?.toISOString?.() || null
    const summary: BlackboxExperimentSummary = {
      experimentId: state.experiment.experimentId,
      runId: state.experiment.runId,
      virtualSessionId: session.id,
      mode: 'blackbox-api',
      status: session.status,
      currentStage: session.currentStage,
      terminalReason: control.terminalReason
        || (session.status === 'abandoned' ? 'abandoned'
          : session.status === 'completed' ? 'completed'
            : session.status === 'failed' ? 'failed' : null),
      startedAt,
      completedAt,
      durationMs: startedAt && completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null,
      goalCompleted: control.goalCompleted === true,
      taskCompleted: control.taskCompleted === true,
      runCompleted: control.runCompleted === true,
      publicTraceCount: rawPublic.length,
      refereeTraceCount: 0,
      stageCoverage,
      inputCoverage: {
        originalPublicTraceCount: rawPublic.length,
        includedPublicTraceCount: publicTrace.length,
        originalRefereeTraceCount: 0,
        includedRefereeTraceCount: 0,
        truncated: rawPublic.length !== publicTrace.length
      }
    }
    return { rawPublic, publicTrace, control, summary }
  }

  private compactTrace<T>(items: T[], limit: number): T[] {
    if (items.length <= limit) return items
    const edge = Math.floor(limit / 2)
    return [...items.slice(0, edge), ...items.slice(-edge)]
  }

  // 私有状态轨迹（learnerPrivateStateTrace）的展示序列化：去掉 state 内部的大对象重影，
  // 只保留前端"私有状态时间线"需要的索引字段与精简 metrics/flags。
  private compactLearnerPrivateStateTrace(raw: unknown): Array<Record<string, unknown>> {
    const trace = Array.isArray(raw) ? (raw as LearnerPrivateStateTraceEntry[]).slice(-120) : []
    return trace.map((entry: LearnerPrivateStateTraceEntry, index: number) => {
      const stage = entry?.stage === 'teaching' ? 'teaching' : 'goal'
      const actorState = (entry?.state && typeof entry.state === 'object' ? entry.state : {}) as Record<string, unknown>
      const feedback = (actorState.learnerFeedback && typeof actorState.learnerFeedback === 'object'
        ? actorState.learnerFeedback : {}) as Record<string, unknown>
      const metricKeys = stage === 'goal'
        ? ['feltUnderstood', 'problemClarity', 'proposalFit', 'taskRelevance', 'executionConcern', 'goalReadiness']
        : ['taskUnderstanding', 'conceptualMastery', 'proceduralMastery', 'misconceptionRisk', 'helpSeekingReadiness', 'cognitiveLoad']
      const feedbackKeys = stage === 'teaching' ? ['satisfaction', 'confidence'] : []
      const metrics = Object.fromEntries([
        ...metricKeys.map((key) => [key, this.displayActorMetric(actorState[key])]),
        ...feedbackKeys.map((key) => [key, this.displayActorMetric(feedback[key])])
      ].filter(([, value]) => value !== null))
      const flagKeys = stage === 'goal'
        ? ['willingToTry', 'readyToProceed', 'wantsClarification', 'readyToAdvance']
        : ['wantsHint', 'wantsWorkedExample', 'readyForNextTask']
      const feedbackFlagKeys = stage === 'teaching' ? ['selfReportedTaskDone', 'wantsMoreHelp', 'stopAsking'] : []
      const flags = Object.fromEntries([
        ...flagKeys.map((key) => [key, actorState[key]]),
        ...feedbackFlagKeys.map((key) => [key, feedback[key]])
      ].filter(([, value]) => typeof value === 'boolean'))
      const blockers = stage === 'goal'
        ? actorState.remainingUnknowns
        : Array.isArray(feedback.remainingBlockers) && feedback.remainingBlockers.length
          ? feedback.remainingBlockers : actorState.remainingBlockers
      return {
        sequence: Number.isInteger(entry?.sequence) ? entry.sequence : index,
        stage,
        taskId: typeof entry?.taskId === 'string' ? entry.taskId : null,
        transition: this.timelineText(entry?.transition, 64),
        emotion: this.timelineText(entry?.emotion || actorState.emotion, 64),
        phaseFocus: this.timelineText(actorState.phaseFocus, 64),
        degraded: entry?.degraded === true || actorState.degraded === true,
        visibleSignal: this.timelineText(entry?.visibleSignal, 240),
        stateChangeReason: this.timelineText(entry?.stateChangeReason, 320),
        metrics,
        flags,
        blockers: Array.isArray(blockers) ? blockers.map((item: unknown) => this.timelineText(item, 240)).filter(Boolean).slice(0, 5) : [],
        generatedAt: this.timelineText(entry?.generatedAt, 64)
      }
    })
  }

  private reportFingerprint(input: unknown, evaluator: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify({ evaluator, input })).digest('hex')
  }

  private valueFingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value) ?? String(value)).digest('hex')
  }

  private sanitizeObservation(value: unknown): LearnerObservation {
    const v = (value ?? {}) as {
      stage?: string
      visibleMessages?: Array<{ role?: string; content?: unknown }>
      visibleChoices?: unknown[]
      visiblePath?: LearnerObservation['visiblePath']
      visibleTask?: LearnerObservation['visibleTask']
      availableActions?: string[]
      lastActionResult?: LearnerObservation['lastActionResult']
    }
    const stage = ['goal', 'path', 'teaching', 'completed', 'error'].includes(v?.stage || '') ? v.stage : 'error'
    return {
      stage: stage as LearnerObservation['stage'],
      visibleMessages: (Array.isArray(v?.visibleMessages) ? v.visibleMessages : []).slice(0, 30).map((item) => ({
        role: item?.role === 'learner' ? 'learner' : 'platform',
        content: String(item?.content || '').slice(0, 1200)
      })),
      visibleChoices: Array.isArray(v?.visibleChoices) ? v.visibleChoices.map((item) => String(item).slice(0, 160)).slice(0, 12) : undefined,
      visiblePath: v?.visiblePath || undefined,
      visibleTask: v?.visibleTask || undefined,
      availableActions: (Array.isArray(v?.availableActions) ? v.availableActions : []) as LearnerAction['type'][],
      lastActionResult: v?.lastActionResult || undefined
    }
  }

  private sanitizeDiagnostic(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null
    const allowedKeys = [
      'schemaVersion', 'renderHints', 'generationStatus', 'canStartLearning', 'replan',
      'analysis', 'state', 'strategies', 'completionCandidate', 'endResult', 'completedTask', 'task'
    ]
    const sanitize = (item: unknown, depth = 0): unknown => {
      if (depth > 3) return '[truncated]'
      if (item === null || typeof item === 'number' || typeof item === 'boolean') return item
      if (typeof item === 'string') return item.slice(0, 1000)
      if (Array.isArray(item)) return item.slice(0, 20).map(child => sanitize(child, depth + 1))
      if (typeof item === 'object') {
        return Object.fromEntries(Object.entries(item).slice(0, 24).map(([key, child]) => [key, sanitize(child, depth + 1)]))
      }
      return String(item)
    }
    const v = (value ?? {}) as Record<string, unknown>
    return Object.fromEntries(allowedKeys.filter(key => key in v).map(key => [key, sanitize(v[key])]))
  }

  private sanitizeAuditValue(value: unknown, depth: number): unknown {
    if (depth > 4) return '[truncated]'
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'string') return value.slice(0, 1200)
    if (Array.isArray(value)) return value.slice(0, 30).map(item => this.sanitizeAuditValue(item, depth + 1))
    if (typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, this.sanitizeAuditValue(item, depth + 1)]))
    }
    return String(value)
  }

  private async persistPrivateState(
    session: VirtualSessionRow,
    state: StageResults,
    stage: string,
    privateState: Record<string, unknown>,
    metadata: {
      emotion?: unknown
      degraded?: unknown
      visibleSignal?: unknown
      stateChangeReason?: unknown
    } = {}
  ) {
    const fresh = await this.getSession(session.id)
    const latestState = parseStageResults(fresh.stageResults, state)
    const trace = Array.isArray(latestState.blackbox?.learnerPrivateStateTrace)
      ? latestState.blackbox.learnerPrivateStateTrace : []
    latestState.blackbox = {
      ...(latestState.blackbox || {}),
      learnerPrivateState: {
        ...(latestState.blackbox?.learnerPrivateState || {}),
        [stage]: privateState
      },
      learnerPrivateStateTrace: [...trace, {
        sequence: (latestState.blackbox?.publicTrace || []).length,
        stage,
        taskId: stage === 'teaching' ? latestState.blackbox?.control?.taskId || fresh.currentTaskId || null : null,
        state: privateState,
        emotion: this.timelineText(metadata.emotion, 64),
        degraded: metadata.degraded === true,
        visibleSignal: this.timelineText(metadata.visibleSignal, 240),
        stateChangeReason: this.timelineText(metadata.stateChangeReason, 320),
        generatedAt: new Date().toISOString()
      }].slice(-120)
    }
    await this.assertCurrentLease(session.id)
    await prisma.virtual_sessions.update({
      where: { id: session.id },
      data: { stageResults: JSON.stringify(latestState), updatedAt: new Date() }
    })
  }

  private async getExperimentSnapshot(session: VirtualSessionRow, state: StageResults): Promise<ExperimentSnapshot> {
    const snapshot = state.experimentSnapshot
    if (snapshot?.actorProfile && snapshot?.frictionBudget) {
      return {
        actorProfile: snapshot.actorProfile,
        story: snapshot.story || null,
        frictionBudget: snapshot.frictionBudget,
        simulatorPrompts: snapshot.simulatorPrompts || null,
        simulators: snapshot.simulators || null,
        routingUserId: snapshot.routingUserId || null
      }
    }

    const current = await this.captureCurrentExperimentSnapshot(session, state)
    return {
      actorProfile: current.actorProfile,
      story: current.story,
      frictionBudget: current.frictionBudget,
      simulatorPrompts: current.simulatorPrompts,
      simulators: current.simulators,
      routingUserId: current.routingUserId
    }
  }

  private async captureCurrentExperimentSnapshot(session: VirtualSessionRow, state: StageResults): Promise<ExperimentSnapshot> {
    const profileRecord = await prisma.virtual_learner_profiles.findUnique({ where: { id: session.virtualProfileId } })
    if (!profileRecord) throw new Error('虚拟学习者画像不存在')
    const capturedAt = new Date().toISOString()
    const actorProfile: ActorProfileSnapshot = {
      profile: safeJsonParse<Record<string, unknown>>(profileRecord.profile, {}),
      learningGoal: profileRecord.learningGoal,
      knownConcepts: safeJsonParse<unknown[]>(profileRecord.knownConcepts, []),
      struggleConcepts: safeJsonParse<unknown[]>(profileRecord.struggleConcepts, []),
      personalityTraits: safeJsonParse<Record<string, unknown>>(profileRecord.personalityTraits, {})
    }
    return this.captureSimulatorExperimentSnapshot(
      state.experiment?.operatorId || getRequestContext().userId,
      capturedAt,
      {
        actorProfile,
        story: state.story || null,
        frictionBudget: ['none', 'low', 'normal', 'high', 'stress_test'].includes(state.simulationConfig?.frictionBudget)
          ? state.simulationConfig.frictionBudget : 'normal'
      }
    )
  }

  private async captureSimulatorExperimentSnapshot(
    routingUserId: string | undefined,
    capturedAt: string,
    input: { actorProfile: Record<string, unknown>; story: Record<string, unknown> | null; frictionBudget: string }
  ): Promise<ExperimentSnapshot> {
    const prompts = await this.resolveSimulatorPrompts()
    const gateway = getAPIGateway()
    const [goalRoute, teachingRoute] = await Promise.all([
      gateway.resolveRoute({ skillId: virtualLearnerGoalDialogueSimulatorDefinition.name }, routingUserId),
      gateway.resolveRoute({ skillId: virtualLearnerLearnTurnSimulatorDefinition.name }, routingUserId)
    ])
    return {
      capturedAt,
      routingUserId: routingUserId || null,
      actorProfile: {
        ...input.actorProfile
      },
      story: input.story,
      frictionBudget: input.frictionBudget,
      simulatorPrompts: prompts.values,
      simulators: {
        goal: {
          skillId: virtualLearnerGoalDialogueSimulatorDefinition.name,
          version: virtualLearnerGoalDialogueSimulatorDefinition.version,
          promptVersion: prompts.goal.version,
          promptFingerprint: this.valueFingerprint(prompts.values.goal),
          temperature: prompts.goal.temperature,
          maxTokens: prompts.goal.maxTokens,
          route: this.sanitizeSimulatorRoute(goalRoute)
        },
        teaching: {
          skillId: virtualLearnerLearnTurnSimulatorDefinition.name,
          version: virtualLearnerLearnTurnSimulatorDefinition.version,
          promptVersion: prompts.teaching.version,
          promptFingerprint: this.valueFingerprint(prompts.values.teaching),
          temperature: prompts.teaching.temperature,
          maxTokens: prompts.teaching.maxTokens,
          route: this.sanitizeSimulatorRoute(teachingRoute)
        }
      }
    }
  }

  private async resolveSimulatorPrompts() {
    const [goal, teaching] = await Promise.all([
      agentConfigService.getActivePrompt('skill:virtual-learner-goal-dialogue-simulator'),
      agentConfigService.getActivePrompt('skill:virtual-learner-learn-turn-simulator')
    ])
    const goalPrompt = goal?.systemPrompt?.trim()
    const teachingPrompt = teaching?.systemPrompt?.trim()
    if (!goalPrompt || !teachingPrompt) {
      throw new BlackboxRunStateError('虚拟学习者 Simulator 缺少 ACTIVE Prompt，不能创建可复现实验', 'BLACKBOX_SIMULATOR_PROMPT_MISSING', 503)
    }
    return {
      goal: {
        version: goal?.version || null,
        temperature: goal?.temperature ?? VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE,
        maxTokens: Number(goal?.maxTokens) > 0
          ? Number(goal.maxTokens) : VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS
      },
      teaching: {
        version: teaching?.version || null,
        temperature: teaching?.temperature ?? VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE,
        maxTokens: Math.max(
          Number(teaching?.maxTokens) > 0 ? Number(teaching.maxTokens) : VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS,
          VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS
        )
      },
      values: { goal: goalPrompt, teaching: teachingPrompt }
    }
  }

  private sanitizeSimulatorRoute(route: ResolvedRoute) {
    return {
      providerType: route.providerType,
      providerId: route.providerId,
      source: route.source,
      endpoint: this.replaySafeEndpoint(route.endpoint),
      model: route.model,
      privateNetworkPolicy: route.privateNetworkPolicy || 'runtime',
      thinkingMode: route.thinkingMode || 'default',
      reasoningEffort: route.reasoningEffort || 'default',
      timeoutMs: route.timeoutMs ?? null,
      credentialFingerprint: this.valueFingerprint(route.apiKey || '')
    }
  }

  private replaySafeEndpoint(rawEndpoint: string) {
    const endpoint = new URL(rawEndpoint)
    const sensitiveQuery = [...endpoint.searchParams.keys()].find(key => /key|token|secret|signature|credential|password|auth/i.test(key))
    if (endpoint.username || endpoint.password || sensitiveQuery) {
      throw new BlackboxRunStateError('模型 Endpoint 包含不能写入实验快照的凭据', 'BLACKBOX_RUNTIME_ENDPOINT_UNSAFE', 500)
    }
    endpoint.hash = ''
    return endpoint.toString()
  }

  private cloneExperimentSnapshot(snapshot: ExperimentSnapshot, capturedAt: string, input: {
    actorProfile: Record<string, unknown>
    story: Record<string, unknown> | null
    frictionBudget: string
  }) {
    this.assertReplayableExperimentSnapshot(snapshot)
    return JSON.parse(JSON.stringify({
      ...snapshot,
      capturedAt,
      actorProfile: input.actorProfile,
      story: input.story,
      frictionBudget: input.frictionBudget
    }))
  }

  private assertReplayableExperimentSnapshot(snapshot: ExperimentSnapshot) {
    const simulators = [snapshot?.simulators?.goal, snapshot?.simulators?.teaching]
    const complete = snapshot?.actorProfile
      && snapshot?.frictionBudget
      && typeof snapshot?.simulatorPrompts?.goal === 'string'
      && typeof snapshot?.simulatorPrompts?.teaching === 'string'
      && simulators.every((item: SimulatorConfig | undefined) => item?.route?.providerId
        && item?.route?.credentialFingerprint
        && item?.route?.endpoint
        && item?.route?.model
        && Number.isFinite(item?.temperature)
        && Number.isFinite(item?.maxTokens))
    if (!complete) {
      throw new BlackboxRunStateError('实验缺少完整运行时快照，不能按同配置创建新 Run', 'BLACKBOX_RERUN_SNAPSHOT_INCOMPLETE')
    }
  }

  private simulatorRuntime(snapshot: ExperimentSnapshot, stage: 'goal' | 'teaching') {
    const simulator = snapshot.simulators?.[stage] || null
    const route = simulator?.route || null
    return {
      systemPromptOverride: snapshot.simulatorPrompts?.[stage] || undefined,
      routingUserIdOverride: snapshot.routingUserId || undefined,
      modelOverride: route?.model || undefined,
      temperatureOverride: Number.isFinite(simulator?.temperature) ? simulator.temperature : undefined,
      maxTokensOverride: Number.isFinite(simulator?.maxTokens) ? simulator.maxTokens : undefined,
      routeOverride: route ? {
        expectedProviderId: route.providerId || undefined,
        expectedCredentialFingerprint: route.credentialFingerprint || undefined,
        endpoint: route.endpoint || undefined,
        model: route.model || undefined,
        thinkingMode: route.thinkingMode || undefined,
        reasoningEffort: route.reasoningEffort || undefined,
        timeoutMs: Number.isFinite(route.timeoutMs) ? route.timeoutMs : undefined,
        ...(route.privateNetworkPolicy ? { privateNetworkPolicy: route.privateNetworkPolicy } : {})
      } : undefined
    }
  }

  private async executeSimulatorSkill(definition: SkillDefinition, input: Record<string, unknown>, snapshot: ExperimentSnapshot, stage: 'goal' | 'teaching'): Promise<SimulatorSkillOutput> {
    const parentContext = getRequestContext()
    // L2 声明化装配（只读对账）：仿真 skill 的输入字段即 simulation 状态池，
    // 校验对应 core yaml 声明的 sandbox refs（实验链，仅运行时可见性，不阻断）
    void (async () => {
      try {
        const { checkAgentSandboxRefsFromContext } = await import('../services/sandbox-resolver.service');
        const skillId = String(definition?.id || '').replace(/^skill:/, '');
        if (!skillId) return;
        await checkAgentSandboxRefsFromContext(skillId, 'simulation', { input });
      } catch {
        // 对账失败不影响主流程
      }
    })();
    return runWithContext({
      ...parentContext,
      promptRuntimeOverride: this.simulatorRuntime(snapshot, stage)
    }, () => executeSkill(definition, input))
  }

  /**
   * 模拟器 LLM 调用重试（S1，对齐 quick-learn 3-strike 语义）：
   * 瞬态 provider 失败（网络/超时/限流/5xx）与「输出缺 reply」的语义失败最多重试
   * BLACKBOX_SIMULATOR_RETRY_ATTEMPTS 次（指数退避）；耗尽后落 degraded 标记并明确失败
   * （不再单次失败即报废整场实验）。
   */
  private async executeSimulatorSkillWithRetry(
    sessionId: string,
    definition: SkillDefinition,
    input: Record<string, unknown>,
    snapshot: ExperimentSnapshot,
    stage: 'goal' | 'teaching'
  ): Promise<SimulatorSkillOutput> {
    let lastError: unknown = new Error(`虚拟学习者${stage === 'goal' ? 'Goal' : 'Learn'}动作生成失败`)
    for (let attempt = 1; attempt <= BLACKBOX_SIMULATOR_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const output = await this.executeSimulatorSkill(definition, input, snapshot, stage)
        if (output?.reply) return output
        lastError = new Error(`虚拟学习者${stage === 'goal' ? 'Goal' : 'Learn'}动作生成失败`)
      } catch (error: unknown) {
        lastError = error
        if (!this.isRetryableSimulatorError(error)) break
      }
      if (attempt < BLACKBOX_SIMULATOR_RETRY_ATTEMPTS) {
        logger.warn('[Blackbox] 模拟器调用失败，准备重试', {
          sessionId,
          stage,
          attempt,
          error: lastError instanceof Error ? lastError.message : String(lastError)
        })
        await new Promise(resolve => setTimeout(resolve, BLACKBOX_SIMULATOR_RETRY_DELAY_MS * attempt))
      }
    }
    await this.markSimulatorDegraded(sessionId, stage, lastError)
    // 标记可恢复：模拟器生成失败时平台副作用尚未发生，黑盒命令可用相同 key 重试续跑（不终局化实验）
    const retryableError = lastError instanceof Error
      ? Object.assign(lastError, { retryable: true } as { retryable: boolean })
      : Object.assign(new Error(String(lastError || '虚拟学习者模拟失败')), { retryable: true })
    throw retryableError
  }

  private isRetryableSimulatorError(error: unknown): boolean {
    // 空消息按瞬态处理（超时/连接重置等在上层已归一化）
    const raw = error instanceof Error ? error.message : error ?? ''
    if (typeof raw === 'string' && !raw.trim()) return true
    return isTransientLlMFailure(error)
  }

  /**
   * 会话级可恢复瞬时失败：LLM/Provider 瞬态错误（超时、网络、5xx、限流、
   * 响应结构非法等）。此类失败发生时平台副作用尚未发生，命令可安全地用
   * 相同 Idempotency-Key 重试；实验保持 running，不终局化整场实验。
   */
  private isRecoverableExecutionFailure(error: unknown): boolean {
    const err = asErrorLike(error)
    if (typeof err.retryable === 'boolean') return err.retryable
    return isTransientLlMFailure(error)
  }

  /** 重试耗尽时的降级标记：写入 stageResults.blackbox.simulatorDegraded（供裁判/审计降权评估），不删除任何数据 */
  private async markSimulatorDegraded(sessionId: string, stage: 'goal' | 'teaching', error: unknown) {
    try {
      const session = await this.getSession(sessionId)
      if (TERMINAL_SESSION_STATUSES.has(session.status)) return
      const state = parseStageResults(session.stageResults)
      const record = {
        stage,
        retryAttempts: BLACKBOX_SIMULATOR_RETRY_ATTEMPTS,
        degradedAt: new Date().toISOString(),
        error: String(error instanceof Error ? error.message : error).slice(0, 500)
      }
      const history = Array.isArray(state.blackbox?.simulatorDegradedHistory)
        ? state.blackbox.simulatorDegradedHistory : []
      state.blackbox = {
        ...(state.blackbox || {}),
        simulatorDegraded: record,
        simulatorDegradedHistory: [...history, record].slice(-20)
      }
      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: { stageResults: JSON.stringify(state), updatedAt: new Date() }
      })
    } catch {
      // 降级标记失败不影响主流程（原始异常继续上抛）
    }
  }

  private async getSession(sessionId: string) {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) throw new Error('模拟会话不存在')
    return session
  }
}

export default new BlackboxVirtualLearnerRunner()
