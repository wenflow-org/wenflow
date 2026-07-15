import { v4 as uuidv4 } from 'uuid'
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
  VirtualLearnerRefereeInput
} from './contracts'
import { PlatformUserAdapter } from './platform-user-adapter'
import {
  executeSkill,
  virtualLearnerGoalDialogueSimulatorDefinition,
  virtualLearnerLearnTurnSimulatorDefinition,
  virtualLearnerPathEvaluatorDefinition,
  virtualLearnerRefereeDefinition
} from '../skills'
import { getRequestContext, runWithContext } from '../gateway/api-gateway/context'

function parseJson(value: string | null | undefined, fallback: any = {}) {
  try {
    return JSON.parse(value || '') || fallback
  } catch {
    return fallback
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

  async initialize(sessionId: string, operatorId: string) {
    const session = await this.getSession(sessionId)
    const stageResults = parseJson(session.stageResults)
    const experimentId = stageResults.experiment?.experimentId || `exp_${uuidv4()}`
    const runId = stageResults.experiment?.runId || `run_${uuidv4()}`
    const next = {
      ...stageResults,
      experiment: {
        experimentId,
        runId,
        mode: 'blackbox-api',
        operatorId,
        createdAt: stageResults.experiment?.createdAt || new Date().toISOString()
      },
      blackbox: stageResults.blackbox || {
        publicTrace: [],
        control: {},
        refereeTrace: []
      }
    }

    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(next), updatedAt: new Date() }
    })
    return { experimentId, runId, mode: 'blackbox-api' as const }
  }

  async observe(sessionId: string, operatorId: string): Promise<PlatformInteractionResult> {
    const { session, state, adapter } = await this.context(sessionId, operatorId)
    const pathId = state.blackbox?.control?.learningPathId || session.learningPathId
    if (!pathId) {
      const latest = state.blackbox?.publicTrace?.slice(-1)[0]
      if (latest?.observation) return latest
      throw new Error('当前还没有可观察的 Path，请先执行 Goal 动作')
    }
    return this.persist(session, state, await adapter.getPath(pathId))
  }

  async getSnapshot(sessionId: string) {
    const session = await this.getSession(sessionId)
    const state = parseJson(session.stageResults)
    return {
      experiment: state.experiment || null,
      observation: state.blackbox?.publicTrace?.slice(-1)[0]?.observation || null,
      control: state.blackbox?.control || {},
      publicTrace: state.blackbox?.publicTrace || [],
      refereeTraceCount: state.blackbox?.refereeTrace?.length || 0,
      latestRefereeReport: this.latestRefereeReport(state),
      refereeReportCount: state.blackbox?.refereeReports?.length || 0
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
    const inputFingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
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

  async act(sessionId: string, operatorId: string, action: LearnerAction): Promise<PlatformInteractionResult> {
    const { session, state, adapter } = await this.context(sessionId, operatorId)
    const control = state.blackbox?.control || {}
    let result: PlatformInteractionResult

    if (!control.conversationId) {
      if (action.type !== 'chat') throw new Error('Blackbox Goal 首轮必须使用 chat 动作')
      result = await adapter.startGoal(action.text)
    } else if (!control.learningPathId && (action.type === 'chat' || action.type === 'confirm_proposal')) {
      result = await adapter.replyGoal(control.conversationId, action)
    } else if (action.type === 'request_path_revision') {
      if (!control.learningPathId) throw new Error('当前没有可调整的 Path')
      result = await adapter.requestPathRevision(control.learningPathId, action.text)
    } else if (action.type === 'start_learning') {
      const taskId = action.taskId || control.taskId
      if (!taskId) throw new Error('当前没有可启动的学习任务')
      result = await adapter.startTeaching(taskId)
    } else if (action.type === 'abandon') {
      if (!control.teachingSessionId) throw new Error('当前没有可结束的教学会话')
      result = await adapter.endTeaching(control.teachingSessionId, 'abandoned', action.reason)
    } else if (action.type === 'confirm_complete') {
      if (!control.taskId || !control.learningPathId) throw new Error('当前没有可完成的任务')
      if (control.teachingSessionId) await adapter.endTeaching(control.teachingSessionId, 'completed')
      const taskResult = await adapter.completeTask(control.taskId)
      const pathResult = await adapter.getPath(control.learningPathId)
      result = {
        ...pathResult,
        diagnostic: {
          ...(pathResult.diagnostic || {}),
          completedTask: taskResult.diagnostic || null
        }
      }
    } else if (action.type === 'skip') {
      throw new Error('平台当前没有公开的跳过任务动作')
    } else {
      if (!control.teachingSessionId) throw new Error('当前没有可交互的教学会话')
      result = await adapter.sendTeachingMessage(control.teachingSessionId, action)
    }

    return this.persist(session, state, result)
  }

  async autoStep(sessionId: string, operatorId: string): Promise<{ action?: LearnerAction; result: PlatformInteractionResult; waitingForObservation?: boolean }> {
    const { session, state } = await this.context(sessionId, operatorId)
    const latest = state.blackbox?.publicTrace?.slice(-1)[0]?.observation
    const profileRecord = await prisma.virtual_learner_profiles.findUnique({ where: { id: session.virtualProfileId } })
    if (!profileRecord) throw new Error('虚拟学习者画像不存在')
    const profile = parseJson(profileRecord.profile)
    const story = state.story || null
    const learner = {
      profile,
      learningGoal: profileRecord.learningGoal,
      knownConcepts: parseJson(profileRecord.knownConcepts, []),
      struggleConcepts: parseJson(profileRecord.struggleConcepts, []),
      personalityTraits: parseJson(profileRecord.personalityTraits, {})
    }
    let action: LearnerAction

    if (!latest) {
      const opening = story?.visibleOpening || profileRecord.learningGoal
      if (!opening) throw new Error('虚拟学习者缺少 Goal 开场信息')
      action = { type: 'chat', text: opening }
    } else if (latest.stage === 'goal') {
      const history = this.visibleHistory(state).map((item: any) => ({
        role: item.role === 'platform' ? 'goal_agent' : 'learner',
        content: item.content
      }))
      const output = await executeSkill(virtualLearnerGoalDialogueSimulatorDefinition, {
        learner,
        story,
        visibleContext: {
          history,
          lastGoalAgentMessage: [...history].reverse().find((item: any) => item.role === 'goal_agent')?.content || ''
        },
        currentPhase: latest.availableActions.includes('confirm_proposal') ? 'proposal_evaluation' : 'understanding',
        previousLearnerState: state.blackbox?.learnerPrivateState?.goal || null,
        frictionBudget: state.simulationConfig?.frictionBudget || 'normal'
      })
      if (!output?.reply) throw new Error('虚拟学习者 Goal 动作生成失败')
      const shouldConfirm = latest.availableActions.includes('confirm_proposal') && output?.learnerState?.readyToAdvance === true
      action = { type: shouldConfirm ? 'confirm_proposal' : 'chat', text: output.reply }
      await this.persistPrivateState(session, state, 'goal', output.learnerState)
    } else if (latest.stage === 'path') {
      if (!latest.visiblePath || (!latest.availableActions.includes('start_learning') && latest.visiblePath.status !== 'failed')) {
        return { result: await this.observe(sessionId, operatorId), waitingForObservation: true }
      }
      const output = await executeSkill(virtualLearnerPathEvaluatorDefinition, {
        learner,
        story,
        pathProposal: latest.visiblePath,
        previousReaction: state.blackbox?.learnerPrivateState?.path || null,
        learnerState: state.blackbox?.learnerPrivateState?.goal || null,
        frictionBudget: state.simulationConfig?.frictionBudget || 'normal'
      })
      const decision = output?.debug?.internalDecision || 'accept'
      action = decision === 'accept'
        ? { type: 'start_learning', taskId: latest.visibleTask?.id }
        : { type: 'request_path_revision', text: output?.reaction || output?.visibleRequestedChanges?.join('；') || '这条路径不太适合我，请调整。' }
      await this.persistPrivateState(session, state, 'path', output)
    } else if (latest.stage === 'learning') {
      const history = this.visibleHistory(state).map((item: any) => ({
        role: item.role === 'platform' ? 'teacher' : 'learner',
        content: item.content
      }))
      const output = await executeSkill(virtualLearnerLearnTurnSimulatorDefinition, {
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
        frictionBudget: state.simulationConfig?.frictionBudget || 'normal'
      })
      if (!output?.reply) throw new Error('虚拟学习者 Learn 动作生成失败')
      action = output.learnerFeedback?.selfReportedTaskDone === true && output.learnerFeedback?.stopAsking === true
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
      throw new Error('当前黑盒实验已经结束')
    }

    return { action, result: await this.act(sessionId, operatorId, action) }
  }

  private async context(sessionId: string, operatorId: string) {
    let session = await this.getSession(sessionId)
    let state = parseJson(session.stageResults)
    if (state.experiment?.mode !== 'blackbox-api') {
      await this.initialize(sessionId, operatorId)
      session = await this.getSession(sessionId)
      state = parseJson(session.stageResults)
    }
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
    await prisma.virtual_sessions.update({
      where: { id: session.id },
      data: {
        goalConversationId: control.conversationId || fresh.goalConversationId,
        learningPathId: control.learningPathId || fresh.learningPathId,
        currentTaskId: control.taskId === null ? null : control.taskId || fresh.currentTaskId,
        currentStage: abandoned || completed ? 'completed' : result.observation.stage,
        status: abandoned ? 'abandoned' : completed ? 'completed' : 'running',
        completedAt: abandoned || completed ? new Date() : null,
        stageResults: JSON.stringify(nextState),
        updatedAt: new Date()
      }
    })
    return result
  }

  private visibleHistory(state: any) {
    return (state.blackbox?.publicTrace || []).flatMap((entry: any) => entry?.observation?.visibleMessages || [])
  }

  private latestRefereeReport(state: any) {
    const reports = Array.isArray(state.blackbox?.refereeReports) ? state.blackbox.refereeReports : []
    const latestId = state.blackbox?.latestRefereeReportId
    return reports.find((item: any) => item.id === latestId) || reports[reports.length - 1] || null
  }

  private buildRefereeInput(session: any, state: any): VirtualLearnerRefereeInput {
    const rawPublic = Array.isArray(state.blackbox?.publicTrace) ? state.blackbox.publicTrace : []
    const rawReferee = Array.isArray(state.blackbox?.refereeTrace) ? state.blackbox.refereeTrace : []
    const publicTrace = this.compactTrace(rawPublic, 120).map((entry: any) => ({
      timestamp: String(entry?.timestamp || ''),
      observation: this.sanitizeObservation(entry?.observation),
      control: entry?.control && typeof entry.control === 'object' ? entry.control : {}
    })) as BlackboxPublicTraceEntry[]
    const refereeTrace = this.compactTrace(rawReferee, 120).map((entry: any) => ({
      timestamp: String(entry?.timestamp || ''),
      traceId: typeof entry?.traceId === 'string' ? entry.traceId : null,
      diagnostic: this.sanitizeDiagnostic(entry?.diagnostic)
    })) as BlackboxRefereeTraceEntry[]
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
      terminalReason: control.terminalReason || (session.status === 'abandoned' ? 'abandoned' : session.status === 'completed' ? 'completed' : null),
      startedAt,
      completedAt,
      durationMs: startedAt && completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null,
      goalCompleted: control.goalCompleted === true,
      taskCompleted: control.taskCompleted === true,
      runCompleted: control.runCompleted === true,
      publicTraceCount: rawPublic.length,
      refereeTraceCount: rawReferee.length,
      stageCoverage,
      inputCoverage: {
        originalPublicTraceCount: rawPublic.length,
        includedPublicTraceCount: publicTrace.length,
        originalRefereeTraceCount: rawReferee.length,
        includedRefereeTraceCount: refereeTrace.length,
        truncated: rawPublic.length !== publicTrace.length || rawReferee.length !== refereeTrace.length
      }
    }
    return { publicTrace, refereeTrace, control, experimentSummary: summary }
  }

  private compactTrace<T>(items: T[], limit: number): T[] {
    if (items.length <= limit) return items
    const edge = Math.floor(limit / 2)
    return [...items.slice(0, edge), ...items.slice(-edge)]
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

  private async persistPrivateState(session: any, state: any, stage: string, privateState: any) {
    const fresh = await this.getSession(session.id)
    const latestState = parseJson(fresh.stageResults, state)
    latestState.blackbox = {
      ...(latestState.blackbox || {}),
      learnerPrivateState: {
        ...(latestState.blackbox?.learnerPrivateState || {}),
        [stage]: privateState
      }
    }
    await prisma.virtual_sessions.update({
      where: { id: session.id },
      data: { stageResults: JSON.stringify(latestState), updatedAt: new Date() }
    })
  }

  private async getSession(sessionId: string) {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) throw new Error('模拟会话不存在')
    return session
  }
}

export default new BlackboxVirtualLearnerRunner()
