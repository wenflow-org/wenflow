import { randomUUID as uuidv4 } from 'crypto'
import { createHash } from 'crypto'
import prisma from '../config/database'
import { signProjectionToken, SYNTHETIC_CAPABILITIES } from '../utils/projection-token'
import type {
  BlackboxExperimentSummary,
  BlackboxPublicTraceEntry,
  BlackboxRefereeTraceEntry,
  LearnerAction,
  LearnerObservation,
  PlatformInteractionResult,
  VirtualLearnerActorAuditInput,
  VirtualLearnerRefereeInput
} from './contracts'
import { PlatformUserAdapter } from './platform-user-adapter'
import { assertBlackboxSessionMode, VirtualSessionModeError } from './session-mode'
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
  virtualLearnerRefereeDefinition
} from '../skills'
import { getRequestContext, runWithContext } from '../gateway/api-gateway/context'
import { getAPIGateway } from '../gateway/api-gateway'
import { agentConfigService } from '../services/agentConfig.service'

function parseJson(value: string | null | undefined, fallback: any = {}) {
  try {
    return JSON.parse(value || '') || fallback
  } catch {
    return fallback
  }
}

const TERMINAL_SESSION_STATUSES = new Set(['completed', 'failed', 'abandoned'])
const COMMAND_LEASE_MS = 10 * 60 * 1000

export class BlackboxRunStateError extends Error {
  readonly retryable = false

  constructor(message: string, readonly code: string, readonly statusCode = 409) {
    super(message)
    this.name = 'BlackboxRunStateError'
  }
}

export class BlackboxVirtualLearnerRunner {
  private readonly sessionLocks = new Map<string, Promise<void>>()

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
      const state = parseJson(session.stageResults)
      assertBlackboxSessionMode(state)
      const runId = state.experiment.runId
      const experimentId = state.experiment.experimentId
      const existing = await prisma.virtual_experiment_commands.findUnique({
        where: { runId_commandId: { runId, commandId } }
      })
      if (existing) return this.reuseCommand<T>(existing, options.kind, options.request)

      const leaseOwner = `cmd_${uuidv4()}`
      await this.acquireCommandLease(options.sessionId, leaseOwner)
      try {
        const afterLease = await prisma.virtual_experiment_commands.findUnique({
          where: { runId_commandId: { runId, commandId } }
        })
        if (afterLease) return this.reuseCommand<T>(afterLease, options.kind, options.request)

        const freshSession = await this.getSession(options.sessionId)
        const freshState = parseJson(freshSession.stageResults)
        const currentTraceCount = Array.isArray(freshState.blackbox?.publicTrace) ? freshState.blackbox.publicTrace.length : 0
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
        const command = await prisma.virtual_experiment_commands.create({
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
        try {
          const result = await work()
          await prisma.virtual_experiment_commands.update({
            where: { id: command.id },
            data: {
              status: 'completed',
              resultJson: JSON.stringify(result),
              completedAt: new Date()
            }
          })
          return { result, reused: false }
        } catch (error: any) {
          await prisma.virtual_experiment_commands.update({
            where: { id: command.id },
            data: {
              status: 'failed',
              errorJson: JSON.stringify({
                name: error?.name || 'Error',
                message: error?.message || '黑盒命令执行失败',
                code: error?.code || null,
                statusCode: error?.statusCode || null
              }),
              completedAt: new Date()
            }
          })
          throw error
        }
      } finally {
        await this.releaseCommandLease(options.sessionId, leaseOwner)
      }
    })
  }

  async runLeasedExclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    return this.runExclusive(sessionId, async () => {
      const ownerId = `lease_${uuidv4()}`
      await this.acquireCommandLease(sessionId, ownerId)
      try {
        return await work()
      } finally {
        await this.releaseCommandLease(sessionId, ownerId)
      }
    })
  }

  async initialize(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const stageResults = parseJson(session.stageResults)
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
    experimentSnapshotOverride?: Record<string, any> | null
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
      return this.persist(session, state, await adapter.getPath(pathId))
    })
  }

  async getSnapshot(sessionId: string) {
    const session = await this.getSession(sessionId)
    const state = parseJson(session.stageResults)
    assertBlackboxSessionMode(state)
    return {
      experiment: state.experiment || null,
      observation: state.blackbox?.publicTrace?.slice(-1)[0]?.observation || null,
      control: state.blackbox?.control || {},
      publicTrace: state.blackbox?.publicTrace || [],
      refereeTraceCount: state.blackbox?.refereeTrace?.length || 0,
      latestRefereeReport: this.latestRefereeReport(state),
      refereeReportCount: state.blackbox?.refereeReports?.length || 0,
      latestActorAuditReport: this.latestActorAuditReport(state),
      actorAuditReportCount: state.blackbox?.actorAuditReports?.length || 0
    }
  }

  async referee(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const state = parseJson(session.stageResults)
    if (state.experiment?.mode !== 'blackbox-api') throw new Error('当前会话不是 blackbox-api 实验')
    if (!['completed', 'abandoned', 'failed'].includes(session.status)) {
      throw new Error('黑盒实验尚未结束，不能生成终局裁判报告')
    }

    const input = this.buildRefereeInput(session, state)
    const inputFingerprint = this.reportFingerprint(input, {
      skillId: virtualLearnerRefereeDefinition.name,
      version: virtualLearnerRefereeDefinition.version,
      prompt: VIRTUAL_LEARNER_REFEREE_PROMPT,
      temperature: VIRTUAL_LEARNER_REFEREE_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_REFEREE_MAX_TOKENS
    })
    const existing = (state.blackbox?.refereeReports || []).find((item: any) =>
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
    const latestState = parseJson(fresh.stageResults, state)
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
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(nextState), updatedAt: new Date() }
    })
    return { ...refereeRecord, reused: false }
  }

  async actorAudit(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const state = parseJson(session.stageResults)
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
    const existing = (state.blackbox?.actorAuditReports || []).find((item: any) =>
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
    const latestState = parseJson(fresh.stageResults, state)
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
      const control = state.blackbox?.control || {}
      const latestObservation = state.blackbox?.publicTrace?.slice(-1)[0]?.observation as LearnerObservation | undefined
      this.assertActionAllowed(action, latestObservation, control)
      let result: PlatformInteractionResult

      if (action.type === 'abandon') {
        result = control.teachingSessionId
          ? await adapter.endTeaching(control.teachingSessionId, 'abandoned', action.reason)
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
        result = await adapter.startTeaching(taskId!)
      } else if (action.type === 'confirm_complete') {
        const endResult = await adapter.endTeaching(control.teachingSessionId!, 'completed')
        const taskResult = await adapter.completeTask(control.taskId!)
        const pathResult = await adapter.getPath(control.learningPathId!)
        result = this.completedTaskPathResult(pathResult, taskResult, endResult)
      } else if (action.type === 'skip') {
        throw new BlackboxRunStateError('平台当前没有公开的跳过任务动作', 'BLACKBOX_SKIP_UNSUPPORTED')
      } else {
        if (!control.teachingSessionId) {
          throw new BlackboxRunStateError('当前没有可交互的教学会话', 'BLACKBOX_TEACHING_NOT_AVAILABLE')
        }
        const teachingResult = await adapter.sendTeachingMessage(control.teachingSessionId, action)
        if (teachingResult.observation.stage === 'completed' && control.taskId && control.learningPathId) {
          const taskResult = await adapter.completeTask(control.taskId)
          const pathResult = await adapter.getPath(control.learningPathId)
          result = this.completedTaskPathResult(pathResult, taskResult, teachingResult)
        } else {
          result = teachingResult
        }
      }

      return this.persist(session, state, result)
    })
  }

  async autoStep(sessionId: string, operatorId: string): Promise<{ action?: LearnerAction; result: PlatformInteractionResult; waitingForObservation?: boolean }> {
    return this.executeWithFailurePersistence(sessionId, 'BLACKBOX_STEP_FAILED', async () => {
      const { session, state } = await this.context(sessionId, operatorId)
      this.assertMutableSession(session)
      const latest = state.blackbox?.publicTrace?.slice(-1)[0]?.observation
      const snapshot = await this.getExperimentSnapshot(session, state)
      const story = snapshot.story
      const learner = snapshot.actorProfile
      let action: LearnerAction

      if (!latest) {
        const opening = (story as any)?.visibleOpening || (learner as any).learningGoal
        if (!opening) throw new Error('虚拟学习者缺少 Goal 开场信息')
        action = { type: 'chat', text: opening }
      } else if (latest.stage === 'goal') {
        const history = this.visibleHistory(state).map((item: any) => ({
          role: item.role === 'platform' ? 'goal_agent' : 'learner',
          content: item.content
        }))
        const output = await this.executeSimulatorSkill(
          virtualLearnerGoalDialogueSimulatorDefinition,
          {
            learner,
            story,
            visibleContext: {
              history,
              lastGoalAgentMessage: [...history].reverse().find((item: any) => item.role === 'goal_agent')?.content || ''
            },
            currentPhase: latest.availableActions.includes('confirm_proposal') ? 'proposal_evaluation' : 'understanding',
            previousLearnerState: state.blackbox?.learnerPrivateState?.goal || null,
            frictionBudget: snapshot.frictionBudget
          },
          snapshot,
          'goal'
        )
        if (!output?.reply) throw new Error('虚拟学习者 Goal 动作生成失败')
        const shouldConfirm = latest.availableActions.includes('confirm_proposal') && output?.learnerState?.readyToAdvance === true
        action = { type: shouldConfirm ? 'confirm_proposal' : 'chat', text: output.reply }
        await this.persistPrivateState(session, state, 'goal', output.learnerState)
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
      } else if (latest.stage === 'learning') {
        const history = this.visibleHistory(state).map((item: any) => ({
          role: item.role === 'platform' ? 'teacher' : 'learner',
          content: item.content
        }))
        const output = await this.executeSimulatorSkill(
          virtualLearnerLearnTurnSimulatorDefinition,
          {
            learner,
            story,
            visibleContext: {
              history,
              lastTeacherMessage: [...history].reverse().find((item: any) => item.role === 'teacher')?.content || ''
            },
            currentPhase: state.blackbox?.learnerPrivateState?.learning?.phaseFocus || 'trying',
            previousLearnerState: state.blackbox?.learnerPrivateState?.learning || null,
            currentTask: latest.visibleTask || null,
            knowledgeSnapshot: [],
            frictionBudget: snapshot.frictionBudget
          },
          snapshot,
          'learning'
        )
        if (!output?.reply) throw new Error('虚拟学习者 Learn 动作生成失败')
        action = latest.availableActions.includes('confirm_complete')
          && output.learnerFeedback?.selfReportedTaskDone === true
          && output.learnerFeedback?.stopAsking === true
          ? { type: 'confirm_complete' }
          : output.learnerState?.wantsHint
            ? { type: 'request_hint', text: output.reply }
          : output.learnerState?.wantsWorkedExample
            ? { type: 'request_example', text: output.reply }
            : { type: 'chat', text: output.reply }
        await this.persistPrivateState(session, state, 'learning', {
          ...output.learnerState,
          learnerFeedback: output.learnerFeedback
        })
      } else {
        throw new BlackboxRunStateError('当前黑盒实验已经结束', 'BLACKBOX_OBSERVATION_TERMINAL')
      }

      return { action, result: await this.act(sessionId, operatorId, action) }
    })
  }

  private async context(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const state = parseJson(session.stageResults)
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

  private async persist(session: any, state: any, result: PlatformInteractionResult) {
    const fresh = await this.getSession(session.id)
    this.assertMutableSession(fresh)
    const latestState = parseJson(fresh.stageResults, state)
    const previousControl = latestState.blackbox?.control || {}
    const control = Object.fromEntries(
      Object.entries({ ...previousControl, ...result.control }).filter(([, value]) => value !== undefined)
    )
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
        refereeTrace
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
    if (result.diagnostic?.resetLearningPrivateState === true && nextState.blackbox?.learnerPrivateState?.learning) {
      const completedTaskState = nextState.blackbox.learnerPrivateState.learning
      const privateStateTrace = Array.isArray(nextState.blackbox.learnerPrivateStateTrace)
        ? nextState.blackbox.learnerPrivateStateTrace : []
      nextState.blackbox.learnerPrivateStateTrace = [...privateStateTrace, {
        sequence: publicTrace.length,
        stage: 'learning',
        taskId: previousControl.taskId || fresh.currentTaskId || null,
        state: completedTaskState,
        transition: 'task_completed',
        generatedAt: new Date().toISOString()
      }].slice(-120)
      const { learning: _completedTaskState, ...remainingPrivateState } = nextState.blackbox.learnerPrivateState
      nextState.blackbox.learnerPrivateState = remainingPrivateState
    }
    const completedTaskIncrement = result.control.taskCompleted === true && previousControl.taskId !== result.control.taskId ? 1 : 0
    const totalTasks = typeof control.totalTasks === 'number' ? control.totalTasks : fresh.totalTasks || 0
    const completedTasks = typeof control.completedTasks === 'number'
      ? control.completedTasks
      : completedTaskIncrement ? (fresh.completedTasks || 0) + completedTaskIncrement : fresh.completedTasks || 0
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

  private assertMutableSession(session: any) {
    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      throw new BlackboxRunStateError('当前黑盒实验已经结束，不能继续修改', 'BLACKBOX_RUN_TERMINAL')
    }
  }

  private reuseCommand<T>(command: any, kind: string, request: unknown): { result: T; reused: boolean } {
    if (command.kind !== kind || command.requestJson !== JSON.stringify(request ?? null)) {
      throw new BlackboxRunStateError('Idempotency-Key 已用于其他黑盒命令', 'BLACKBOX_COMMAND_ID_REUSED')
    }
    if (command.status === 'completed' && command.resultJson) {
      return { result: parseJson(command.resultJson, null) as T, reused: true }
    }
    if (command.status === 'failed') {
      const error = parseJson(command.errorJson, {})
      throw new BlackboxRunStateError(
        `相同命令此前执行失败：${error.message || '未知错误'}`,
        'BLACKBOX_COMMAND_PREVIOUSLY_FAILED'
      )
    }
    throw new BlackboxRunStateError('相同黑盒命令正在执行或结果待对账', 'BLACKBOX_COMMAND_IN_PROGRESS')
  }

  private async acquireCommandLease(sessionId: string, ownerId: string) {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + COMMAND_LEASE_MS)
    const updated = await prisma.virtual_experiment_leases.updateMany({
      where: { sessionId, expiresAt: { lt: now } },
      data: { ownerId, expiresAt }
    })
    if (updated.count === 1) return
    try {
      await prisma.virtual_experiment_leases.create({ data: { sessionId, ownerId, expiresAt } })
    } catch {
      throw new BlackboxRunStateError('当前实验正在由另一实例执行，请稍后重试', 'BLACKBOX_SESSION_BUSY')
    }
  }

  private async releaseCommandLease(sessionId: string, ownerId: string) {
    await prisma.virtual_experiment_leases.deleteMany({ where: { sessionId, ownerId } })
  }

  private assertActionAllowed(action: LearnerAction, latestObservation: LearnerObservation | undefined, control: any) {
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
      if (latestObservation.stage !== 'learning' || !control.taskId || !control.teachingSessionId) {
        throw new BlackboxRunStateError('当前教学任务尚未满足完成条件', 'BLACKBOX_COMPLETION_NOT_READY')
      }
      if (latestObservation.visibleTask?.id && latestObservation.visibleTask.id !== control.taskId) {
        throw new BlackboxRunStateError('完成任务与当前 Observation 不一致', 'BLACKBOX_TASK_MISMATCH')
      }
    }
  }

  private completedTaskPathResult(
    pathResult: PlatformInteractionResult,
    taskResult: PlatformInteractionResult,
    teachingEndResult: PlatformInteractionResult
  ): PlatformInteractionResult {
    return {
      ...pathResult,
      control: { ...pathResult.control, taskCompleted: true },
      diagnostic: {
        ...(pathResult.diagnostic || {}),
        completedTask: taskResult.diagnostic || null,
        teachingEnd: teachingEndResult.diagnostic || null,
        resetLearningPrivateState: pathResult.control.runCompleted !== true
      }
    }
  }

  private async executeWithFailurePersistence<T>(sessionId: string, code: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error: any) {
      if (!(error instanceof BlackboxRunStateError) && !(error instanceof VirtualSessionModeError)) {
        await this.persistUnexpectedFailure(sessionId, code, error)
      }
      throw error
    }
  }

  private async persistUnexpectedFailure(sessionId: string, code: string, error: any) {
    try {
      const session = await this.getSession(sessionId)
      if (TERMINAL_SESSION_STATUSES.has(session.status)) return
      const state = parseJson(session.stageResults)
      assertBlackboxSessionMode(state)
      const message = String(error?.message || '黑盒实验执行失败').slice(0, 1000)
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
            name: String(error?.name || 'Error'),
            message,
            status: typeof error?.status === 'number' ? error.status : null
          }
        }
      })
    } catch {
      // 保留原始异常，失败记录不能掩盖调用方真正收到的错误。
    }
  }

  private visibleHistory(state: any) {
    return (state.blackbox?.publicTrace || []).flatMap((entry: any) => entry?.observation?.visibleMessages || [])
  }

  private latestRefereeReport(state: any) {
    const reports = Array.isArray(state.blackbox?.refereeReports) ? state.blackbox.refereeReports : []
    const latestId = state.blackbox?.latestRefereeReportId
    return reports.find((item: any) => item.id === latestId) || reports[reports.length - 1] || null
  }

  private latestActorAuditReport(state: any) {
    const reports = Array.isArray(state.blackbox?.actorAuditReports) ? state.blackbox.actorAuditReports : []
    const latestId = state.blackbox?.latestActorAuditReportId
    return reports.find((item: any) => item.id === latestId) || reports[reports.length - 1] || null
  }

  private buildRefereeInput(session: any, state: any): VirtualLearnerRefereeInput {
    const { rawPublic, publicTrace, summary } = this.buildSharedAuditTrace(session, state)
    const rawReferee = Array.isArray(state.blackbox?.refereeTrace) ? state.blackbox.refereeTrace : []
    const refereeTrace = this.compactTrace(rawReferee, 120).map((entry: any) => ({
      timestamp: String(entry?.timestamp || ''),
      traceId: typeof entry?.traceId === 'string' ? entry.traceId : null,
      diagnostic: this.sanitizeDiagnostic(entry?.diagnostic)
    })) as BlackboxRefereeTraceEntry[]
    const control = state.blackbox?.control && typeof state.blackbox.control === 'object' ? state.blackbox.control : {}
    summary.refereeTraceCount = rawReferee.length
    summary.inputCoverage.originalRefereeTraceCount = rawReferee.length
    summary.inputCoverage.includedRefereeTraceCount = refereeTrace.length
    summary.inputCoverage.truncated = summary.inputCoverage.truncated || rawReferee.length !== refereeTrace.length
    return { publicTrace, refereeTrace, control, experimentSummary: summary }
  }

  private async buildActorAuditInput(session: any, state: any): Promise<VirtualLearnerActorAuditInput> {
    const snapshot = await this.getExperimentSnapshot(session, state)
    const { publicTrace, summary } = this.buildSharedAuditTrace(session, state)
    return {
      actorProfile: this.sanitizeAuditValue(snapshot.actorProfile, 0),
      story: snapshot.story && typeof snapshot.story === 'object' ? this.sanitizeAuditValue(snapshot.story, 0) : null,
      frictionBudget: snapshot.frictionBudget as VirtualLearnerActorAuditInput['frictionBudget'],
      learnerPrivateState: this.sanitizeAuditValue({
        latest: state.blackbox?.learnerPrivateState || {},
        trace: state.blackbox?.learnerPrivateStateTrace || []
      }, 0),
      publicTrace: publicTrace.map(entry => ({ timestamp: entry.timestamp, observation: entry.observation })),
      experimentSummary: summary
    }
  }

  private buildSharedAuditTrace(session: any, state: any) {
    const rawPublic = Array.isArray(state.blackbox?.publicTrace) ? state.blackbox.publicTrace : []
    const publicTrace = this.compactTrace(rawPublic, 120).map((entry: any) => ({
      timestamp: String(entry?.timestamp || ''),
      observation: this.sanitizeObservation(entry?.observation),
      control: entry?.control && typeof entry.control === 'object' ? entry.control : {}
    })) as BlackboxPublicTraceEntry[]
    const control = state.blackbox?.control && typeof state.blackbox.control === 'object' ? state.blackbox.control : {}
    const stageCoverage = {
      goal: false,
      path: false,
      learning: false,
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

  private reportFingerprint(input: unknown, evaluator: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify({ evaluator, input })).digest('hex')
  }

  private valueFingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value) ?? String(value)).digest('hex')
  }

  private sanitizeObservation(value: any): LearnerObservation {
    const stage = ['goal', 'path', 'learning', 'completed', 'error'].includes(value?.stage) ? value.stage : 'error'
    return {
      stage,
      visibleMessages: (Array.isArray(value?.visibleMessages) ? value.visibleMessages : []).slice(0, 30).map((item: any) => ({
        role: item?.role === 'learner' ? 'learner' : 'platform',
        content: String(item?.content || '').slice(0, 1200)
      })),
      visibleChoices: Array.isArray(value?.visibleChoices) ? value.visibleChoices.map((item: any) => String(item).slice(0, 160)).slice(0, 12) : undefined,
      visiblePath: value?.visiblePath || undefined,
      visibleTask: value?.visibleTask || undefined,
      availableActions: Array.isArray(value?.availableActions) ? value.availableActions : [],
      lastActionResult: value?.lastActionResult || undefined
    }
  }

  private sanitizeDiagnostic(value: any): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null
    const allowedKeys = [
      'schemaVersion', 'renderHints', 'generationStatus', 'canStartLearning', 'replan',
      'analysis', 'state', 'strategies', 'completionCandidate', 'endResult', 'completedTask', 'task'
    ]
    const sanitize = (item: any, depth = 0): any => {
      if (depth > 3) return '[truncated]'
      if (item === null || typeof item === 'number' || typeof item === 'boolean') return item
      if (typeof item === 'string') return item.slice(0, 1000)
      if (Array.isArray(item)) return item.slice(0, 20).map(child => sanitize(child, depth + 1))
      if (typeof item === 'object') {
        return Object.fromEntries(Object.entries(item).slice(0, 24).map(([key, child]) => [key, sanitize(child, depth + 1)]))
      }
      return String(item)
    }
    return Object.fromEntries(allowedKeys.filter(key => key in value).map(key => [key, sanitize(value[key])]))
  }

  private sanitizeAuditValue(value: any, depth: number): any {
    if (depth > 4) return '[truncated]'
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'string') return value.slice(0, 1200)
    if (Array.isArray(value)) return value.slice(0, 30).map(item => this.sanitizeAuditValue(item, depth + 1))
    if (typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, this.sanitizeAuditValue(item, depth + 1)]))
    }
    return String(value)
  }

  private async persistPrivateState(session: any, state: any, stage: string, privateState: any) {
    const fresh = await this.getSession(session.id)
    const latestState = parseJson(fresh.stageResults, state)
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
        taskId: stage === 'learning' ? latestState.blackbox?.control?.taskId || fresh.currentTaskId || null : null,
        state: privateState,
        generatedAt: new Date().toISOString()
      }].slice(-120)
    }
    await prisma.virtual_sessions.update({
      where: { id: session.id },
      data: { stageResults: JSON.stringify(latestState), updatedAt: new Date() }
    })
  }

  private async getExperimentSnapshot(session: any, state: any) {
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

  private async captureCurrentExperimentSnapshot(session: any, state: any) {
    const profileRecord = await prisma.virtual_learner_profiles.findUnique({ where: { id: session.virtualProfileId } })
    if (!profileRecord) throw new Error('虚拟学习者画像不存在')
    const capturedAt = new Date().toISOString()
    const actorProfile = {
      profile: parseJson(profileRecord.profile),
      learningGoal: profileRecord.learningGoal,
      knownConcepts: parseJson(profileRecord.knownConcepts, []),
      struggleConcepts: parseJson(profileRecord.struggleConcepts, []),
      personalityTraits: parseJson(profileRecord.personalityTraits, {})
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
  ) {
    const prompts = await this.resolveSimulatorPrompts()
    const gateway = getAPIGateway()
    const [goalRoute, learningRoute] = await Promise.all([
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
        learning: {
          skillId: virtualLearnerLearnTurnSimulatorDefinition.name,
          version: virtualLearnerLearnTurnSimulatorDefinition.version,
          promptVersion: prompts.learning.version,
          promptFingerprint: this.valueFingerprint(prompts.values.learning),
          temperature: prompts.learning.temperature,
          maxTokens: prompts.learning.maxTokens,
          route: this.sanitizeSimulatorRoute(learningRoute)
        }
      }
    }
  }

  private async resolveSimulatorPrompts() {
    const [goal, learning] = await Promise.all([
      agentConfigService.getActivePrompt('skill:virtual-learner-goal-dialogue-simulator'),
      agentConfigService.getActivePrompt('skill:virtual-learner-learn-turn-simulator')
    ])
    const goalPrompt = goal?.systemPrompt?.trim()
    const learningPrompt = learning?.systemPrompt?.trim()
    if (!goalPrompt || !learningPrompt) {
      throw new BlackboxRunStateError('虚拟学习者 Simulator 缺少 ACTIVE Prompt，不能创建可复现实验', 'BLACKBOX_SIMULATOR_PROMPT_MISSING', 503)
    }
    return {
      goal: {
        version: goal?.version || null,
        temperature: goal?.temperature ?? VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE,
        maxTokens: Number(goal?.maxTokens) > 0
          ? Number(goal.maxTokens) : VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS
      },
      learning: {
        version: learning?.version || null,
        temperature: learning?.temperature ?? VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE,
        maxTokens: Math.max(
          Number(learning?.maxTokens) > 0 ? Number(learning.maxTokens) : VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS,
          VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS
        )
      },
      values: { goal: goalPrompt, learning: learningPrompt }
    }
  }

  private sanitizeSimulatorRoute(route: any) {
    return {
      providerType: route.providerType,
      providerId: route.providerId,
      source: route.source,
      endpoint: this.replaySafeEndpoint(route.endpoint),
      model: route.model,
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

  private cloneExperimentSnapshot(snapshot: Record<string, any>, capturedAt: string, input: {
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

  private assertReplayableExperimentSnapshot(snapshot: Record<string, any>) {
    const simulators = [snapshot?.simulators?.goal, snapshot?.simulators?.learning]
    const complete = snapshot?.actorProfile
      && snapshot?.frictionBudget
      && typeof snapshot?.simulatorPrompts?.goal === 'string'
      && typeof snapshot?.simulatorPrompts?.learning === 'string'
      && simulators.every((item: any) => item?.route?.providerId
        && item?.route?.credentialFingerprint
        && item?.route?.endpoint
        && item?.route?.model
        && Number.isFinite(item?.temperature)
        && Number.isFinite(item?.maxTokens))
    if (!complete) {
      throw new BlackboxRunStateError('实验缺少完整运行时快照，不能按同配置创建新 Run', 'BLACKBOX_RERUN_SNAPSHOT_INCOMPLETE')
    }
  }

  private simulatorRuntime(snapshot: any, stage: 'goal' | 'learning') {
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
        timeoutMs: Number.isFinite(route.timeoutMs) ? route.timeoutMs : undefined
      } : undefined
    }
  }

  private async executeSimulatorSkill(definition: any, input: any, snapshot: any, stage: 'goal' | 'learning') {
    const parentContext = getRequestContext()
    return runWithContext({
      ...parentContext,
      promptRuntimeOverride: this.simulatorRuntime(snapshot, stage)
    }, () => executeSkill(definition, input))
  }

  private async getSession(sessionId: string) {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) throw new Error('模拟会话不存在')
    return session
  }
}

export default new BlackboxVirtualLearnerRunner()
