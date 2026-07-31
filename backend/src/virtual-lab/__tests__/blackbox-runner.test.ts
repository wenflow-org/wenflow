import prisma from '../../config/database'
import {
  BlackboxDatabaseBusyError,
  BlackboxSessionBusyError,
  BlackboxVirtualLearnerRunner
} from '../blackbox-runner'
import { executeSkill } from '../../skills'
import { getAPIGateway } from '../../gateway/api-gateway'
import { agentConfigService } from '../../services/agentConfig.service'
import { getRequestContext } from '../../gateway/api-gateway/context'
import { learningStateService } from '../../services/learning/learning-state.service'

jest.mock('../../utils/projection-token', () => ({
  signProjectionToken: jest.fn(() => 'token'),
  SYNTHETIC_CAPABILITIES: []
}))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: { name: 'virtual-learner-goal-dialogue-simulator', version: '1.0.0' },
  virtualLearnerLearnTurnSimulatorDefinition: { name: 'virtual-learner-learn-turn-simulator', version: '1.0.0' },
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT: 'goal prompt',
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS: 1200,
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE: 0.8,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT: 'learn prompt',
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS: 800,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE: 0.7,
  virtualLearnerRefereeDefinition: { name: 'virtual-learner-referee', version: '1.0.0' },
  virtualLearnerActorAuditorDefinition: { name: 'virtual-learner-actor-auditor', version: '1.0.0' }
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    virtual_learner_profiles: {
      findUnique: jest.fn()
    },
    virtual_experiment_commands: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    virtual_experiment_leases: {
      updateMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn()
    }
  }
}))
jest.mock('../../services/agentConfig.service', () => ({
  agentConfigService: {
    getActivePrompt: jest.fn().mockResolvedValue(null)
  }
}))
jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: jest.fn(() => ({
    resolveRoute: jest.fn()
  }))
}))
jest.mock('../../services/learning/learning-state.service', () => ({
  learningStateService: {
    getSessionStateTimeline: jest.fn()
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

function sessionWith(control: Record<string, unknown>, privateState: Record<string, unknown> = {}) {
  const state = {
    experiment: { mode: 'blackbox-api', experimentId: 'exp1', runId: 'run1' },
    blackbox: {
      control,
      learnerPrivateState: privateState,
      learnerPrivateStateTrace: [],
      publicTrace: [],
      refereeTrace: []
    }
  }
  return {
    id: 'vs1',
    userId: 'u1',
    virtualProfileId: 'vp1',
    goalConversationId: 'g1',
    learningPathId: 'p1',
    currentTaskId: control.taskId || null,
    status: 'running',
    currentStage: 'learning',
    stageResults: JSON.stringify(state)
  }
}

function addObservation(session: any, observation: Record<string, unknown>) {
  const state = JSON.parse(session.stageResults)
  state.blackbox.publicTrace.push({
    timestamp: '2026-07-14T10:00:00.000Z',
    observation,
    control: state.blackbox.control
  })
  session.stageResults = JSON.stringify(state)
  return session
}

function installMutableActionSession(runner: any, session: any, adapter: any) {
  let currentSession = session
  runner.getSession = jest.fn(async () => currentSession)
  runner.context = jest.fn(async () => ({
    session: currentSession,
    state: JSON.parse(currentSession.stageResults),
    adapter
  }))
  ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
    currentSession = { ...currentSession, ...data }
    return currentSession
  })
  return () => currentSession
}

describe('BlackboxVirtualLearnerRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.virtual_sessions.update as jest.Mock).mockReset().mockResolvedValue({})
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 1 : 0
    }))
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(agentConfigService.getActivePrompt as jest.Mock).mockImplementation(async (agentId: string) => agentId.includes('goal-dialogue')
      ? { version: 1, systemPrompt: 'goal prompt', temperature: 0.8, maxTokens: 1200 }
      : { version: 1, systemPrompt: 'learn prompt', temperature: 0.7, maxTokens: 800 })
    ;(getAPIGateway as jest.Mock).mockReturnValue({
      resolveRoute: jest.fn(async ({ skillId }: any, userId: string) => ({
        providerType: 'openai-compatible',
        providerId: `skill:${skillId}`,
        source: 'platform',
        endpoint: 'https://example.test/v1',
        apiKey: `secret-${userId}`,
        model: `${skillId}-model`,
        thinkingMode: 'disabled',
        reasoningEffort: 'default',
        temperature: 0.2,
        maxTokens: 999,
        timeoutMs: 60000
      }))
    })
    ;(learningStateService.getSessionStateTimeline as jest.Mock).mockResolvedValue([])
    ;(prisma.virtual_learner_profiles.findUnique as jest.Mock).mockResolvedValue({ userId: 'u1' })
  })

  it('快照按当前 Run 的 Teaching Session 返回脱敏双源状态时间线', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({ teachingSessionId: 'teach-1', taskId: 'task-1' })
    const state = JSON.parse(session.stageResults)
    state.blackbox.publicTrace = [{
      timestamp: '2026-07-14T10:01:00.000Z',
      observation: { stage: 'learning', visibleMessages: [], availableActions: ['chat'] },
      control: { teachingSessionId: 'teach-1', taskId: 'task-1' }
    }]
    state.blackbox.learnerPrivateStateTrace = [{
      sequence: 1,
      stage: 'learning',
      taskId: 'task-1',
      emotion: 'confused',
      degraded: true,
      visibleSignal: 'fallback',
      stateChangeReason: '模型输出不可用时的保守兜底',
      generatedAt: '2026-07-14T10:01:30.000Z',
      state: {
        phaseFocus: 'blocked',
        cognitiveLoad: 0.72,
        taskUnderstanding: 0.41,
        wantsHint: true,
        remainingBlockers: ['当前步骤还没对上'],
        learnerFeedback: {
          confidence: 0.35,
          satisfaction: 0.4,
          wantsMoreHelp: true
        },
        _debug: { rawModelOutput: '不能暴露' }
      }
    }]
    session.stageResults = JSON.stringify(state)
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(learningStateService.getSessionStateTimeline as jest.Mock).mockResolvedValue([{
      teachingSessionId: 'teach-1',
      taskId: 'task-1',
      pathId: 'p1',
      status: 'completed',
      metrics: { lss: 4.2, ktl: 5.1, lf: 3.8, lsb: 1.3, timestamp: new Date('2026-07-14T10:05:00.000Z') },
      calculatedAt: new Date('2026-07-14T10:05:00.000Z'),
      source: 'committed-metric',
      summarySource: 'fallback',
      evaluationSource: 'ai-fallback',
      degraded: true
    }])

    const snapshot = await runner.getSnapshot('vs1')

    expect(learningStateService.getSessionStateTimeline).toHaveBeenCalledWith('u1', ['teach-1'])
    expect(snapshot.stateTimeline.actor.entries[0]).toEqual(expect.objectContaining({
      sequence: 1,
      stage: 'learning',
      emotion: 'confused',
      degraded: true,
      metrics: expect.objectContaining({ cognitiveLoad: 72, confidence: 35, satisfaction: 40 }),
      flags: expect.objectContaining({ wantsHint: true, wantsMoreHelp: true }),
      blockers: ['当前步骤还没对上']
    }))
    expect(snapshot.stateTimeline.platform.entries[0]).toEqual(expect.objectContaining({
      teachingSessionId: 'teach-1',
      metrics: { lss: 42, ktl: 51, lf: 38, lsb: 13 },
      evaluationSource: 'ai-fallback',
      degraded: true
    }))
    expect(JSON.stringify(snapshot.stateTimeline)).not.toContain('rawModelOutput')
    expect(JSON.stringify(snapshot.stateTimeline)).not.toContain('不能暴露')
  })

  it('快照拒绝读取与虚拟画像绑定不一致的用户状态', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(sessionWith({ teachingSessionId: 'teach-1' }))
    ;(prisma.virtual_learner_profiles.findUnique as jest.Mock).mockResolvedValue({ userId: 'other-user' })

    await expect(runner.getSnapshot('vs1')).rejects.toMatchObject({
      code: 'BLACKBOX_SYNTHETIC_USER_MISMATCH',
      statusCode: 409
    })
    expect(learningStateService.getSessionStateTimeline).not.toHaveBeenCalled()
  })

  it('平台状态查询失败时保留 Actor 快照并标记该数据轨不可用', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({ teachingSessionId: 'teach-1' })
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(learningStateService.getSessionStateTimeline as jest.Mock).mockRejectedValue(new Error('metrics database unavailable'))

    const snapshot = await runner.getSnapshot('vs1')

    expect(snapshot.stateTimeline.platform).toEqual(expect.objectContaining({
      status: 'unavailable',
      errorCode: 'PLATFORM_STATE_TIMELINE_UNAVAILABLE',
      entries: []
    }))
    expect(snapshot.stateTimeline.actor.entries).toEqual([])
  })

  it('创建实验时固化有效 Prompt、模型路由和配置且不持久化密钥', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    ;(agentConfigService.getActivePrompt as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ version: 7, systemPrompt: 'frozen goal', temperature: 0.25, maxTokens: 1400 })
      .mockResolvedValueOnce({ version: 8, systemPrompt: 'frozen learn', temperature: 0.35, maxTokens: 500 })

    const state = await runner.createExperimentState({
      operatorId: 'admin1',
      actorProfile: { learningGoal: '测试目标' },
      story: { title: '测试故事' },
      frictionBudget: 'high',
      experimentId: 'exp-fixed',
      parentRunId: 'run-parent'
    })

    expect(state.experiment).toEqual(expect.objectContaining({
      experimentId: 'exp-fixed',
      parentRunId: 'run-parent'
    }))
    expect(state.experiment.runId).toMatch(/^run_/)
    expect(state.experimentSnapshot).toEqual(expect.objectContaining({
      routingUserId: 'admin1',
      simulatorPrompts: { goal: 'frozen goal', learning: 'frozen learn' }
    }))
    expect(state.experimentSnapshot.simulators.goal).toEqual(expect.objectContaining({
      promptVersion: 7,
      temperature: 0.25,
      maxTokens: 1400,
      route: expect.objectContaining({
        providerId: 'skill:virtual-learner-goal-dialogue-simulator',
        model: 'virtual-learner-goal-dialogue-simulator-model'
      })
    }))
    expect(state.experimentSnapshot.simulators.learning).toEqual(expect.objectContaining({
      promptVersion: 8,
      temperature: 0.35,
      maxTokens: 800
    }))
    expect(JSON.stringify(state.experimentSnapshot)).not.toContain('secret-admin1')
  })

  it('拒绝将 Endpoint 中的凭据写入实验快照', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    ;(getAPIGateway as jest.Mock).mockReturnValue({
      resolveRoute: jest.fn().mockResolvedValue({
        providerType: 'openai-compatible',
        providerId: 'provider-unsafe',
        source: 'platform',
        endpoint: 'https://example.test/v1?api_key=secret',
        apiKey: 'secret',
        model: 'model',
        temperature: 0.7,
        maxTokens: 800
      })
    })

    await expect(runner.createExperimentState({
      operatorId: 'admin1',
      actorProfile: { learningGoal: '测试目标' },
      story: null,
      frictionBudget: 'normal'
    })).rejects.toMatchObject({ code: 'BLACKBOX_RUNTIME_ENDPOINT_UNSAFE', statusCode: 500 })
  })

  it('Simulator 缺少 ACTIVE Prompt 时拒绝创建不可复现实验', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    ;(agentConfigService.getActivePrompt as jest.Mock).mockReset().mockResolvedValue(null)

    await expect(runner.createExperimentState({
      operatorId: 'admin1',
      actorProfile: { learningGoal: '测试目标' },
      story: null,
      frictionBudget: 'normal'
    })).rejects.toMatchObject({ code: 'BLACKBOX_SIMULATOR_PROMPT_MISSING', statusCode: 503 })
    expect(getAPIGateway).not.toHaveBeenCalled()
  })

  it('按快照创建新 Run 时复用完整运行配置并保留 lineage', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const frozenSnapshot = {
      capturedAt: '2026-07-14T10:00:00.000Z',
      routingUserId: 'admin-original',
      actorProfile: { learningGoal: '旧目标' },
      story: null,
      frictionBudget: 'stress_test',
      simulatorPrompts: { goal: 'old goal', learning: 'old learn' },
      simulators: {
        goal: {
          temperature: 0.1, maxTokens: 111,
          route: { providerId: 'provider-old', credentialFingerprint: 'hash-old', endpoint: 'https://old.example/v1', model: 'model-old' }
        },
        learning: {
          temperature: 0.2, maxTokens: 222,
          route: { providerId: 'provider-old', credentialFingerprint: 'hash-old', endpoint: 'https://old.example/v1', model: 'model-old' }
        }
      }
    }

    const state = await runner.createExperimentState({
      operatorId: 'admin-new',
      actorProfile: frozenSnapshot.actorProfile,
      story: null,
      frictionBudget: 'stress_test',
      experimentId: 'exp-1',
      parentRunId: 'run-1',
      experimentSnapshotOverride: frozenSnapshot
    })

    expect(state.experiment.experimentId).toBe('exp-1')
    expect(state.experiment.runId).not.toBe('run-1')
    expect(state.experiment.parentRunId).toBe('run-1')
    expect(state.experimentSnapshot).toEqual(expect.objectContaining({
      routingUserId: 'admin-original',
      story: null,
      frictionBudget: 'stress_test',
      simulatorPrompts: frozenSnapshot.simulatorPrompts,
      simulators: frozenSnapshot.simulators
    }))
    expect(getAPIGateway).not.toHaveBeenCalled()
    expect(agentConfigService.getActivePrompt).not.toHaveBeenCalled()
  })

  it('自动模拟使用快照中的 Prompt 和模型运行配置', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith({ conversationId: 'g1' })
    const state = JSON.parse(session.stageResults)
    state.experimentSnapshot = {
      actorProfile: { learningGoal: '测试目标' },
      story: { visibleOpening: '开场' },
      frictionBudget: 'high',
      routingUserId: 'admin-original',
      simulatorPrompts: { goal: 'frozen goal prompt' },
      simulators: {
        goal: {
          temperature: 0.12,
          maxTokens: 345,
          route: {
            providerId: 'provider-frozen',
            credentialFingerprint: 'credential-hash',
            endpoint: 'https://frozen.example/v1',
            model: 'frozen-model',
            thinkingMode: 'disabled',
            reasoningEffort: 'default',
            timeoutMs: 12345
          }
        }
      }
    }
    state.blackbox.publicTrace = [{
      observation: {
        stage: 'goal', visibleMessages: [{ role: 'platform', content: '请说明目标' }], availableActions: ['chat']
      }
    }]
    session.stageResults = JSON.stringify(state)
    runner.context = jest.fn().mockResolvedValue({ session, state })
    runner.persistPrivateState = jest.fn()
    runner.act = jest.fn().mockResolvedValue({ observation: { stage: 'goal' }, control: {} })
    let runtimeOverride: any = null
    ;(executeSkill as jest.Mock).mockImplementation(async () => {
      runtimeOverride = getRequestContext().promptRuntimeOverride
      return {
        reply: '我的目标',
        emotion: 'confused',
        degraded: true,
        learnerState: { readyToAdvance: false },
        debug: { visibleSignal: 'fallback', stateChangeReason: '保守兜底' }
      }
    })

    await runner.autoStep('vs1', 'admin-current')

    expect(executeSkill).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ runtime: expect.anything() }))
    expect(runtimeOverride).toEqual({
      systemPromptOverride: 'frozen goal prompt',
      routingUserIdOverride: 'admin-original',
      modelOverride: 'frozen-model',
      temperatureOverride: 0.12,
      maxTokensOverride: 345,
      routeOverride: {
        expectedProviderId: 'provider-frozen',
        expectedCredentialFingerprint: 'credential-hash',
        endpoint: 'https://frozen.example/v1',
        model: 'frozen-model',
        thinkingMode: 'disabled',
        reasoningEffort: 'default',
        timeoutMs: 12345
      }
    })
    expect(runner.persistPrivateState).toHaveBeenCalledWith(
      session,
      state,
      'goal',
      { readyToAdvance: false },
      {
        emotion: 'confused',
        degraded: true,
        visibleSignal: 'fallback',
        stateChangeReason: '保守兜底'
      }
    )
  })

  it('相同 commandId 重试直接复用结果，不重复执行平台副作用', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    const work = jest.fn().mockResolvedValue({ observation: { stage: 'goal' } })
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'command-1', runId: 'run1', commandId: 'same-command', status: 'completed',
        kind: 'step', requestJson: '{}',
        resultJson: JSON.stringify({ observation: { stage: 'goal' } })
      })
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockResolvedValue({ id: 'command-1' })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 1 : 0
    }))
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })

    const first = await runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'same-command', kind: 'step', request: {}, expectedTraceCount: 0
    }, work)
    const second = await runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'same-command', kind: 'step', request: {}, expectedTraceCount: 0
    }, work)

    expect(first.reused).toBe(false)
    expect(second).toEqual({ result: { observation: { stage: 'goal' } }, reused: true })
    expect(work).toHaveBeenCalledTimes(1)
    expect(prisma.virtual_experiment_commands.create).toHaveBeenCalledTimes(1)
  })

  it('Goal 平台副作用只执行一次，回执可重复对账且阻塞更新命令', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith({})
    const platformResult = {
      observation: {
        stage: 'goal', visibleMessages: [{ role: 'platform', content: '请说明目标' }],
        availableActions: ['chat', 'abandon']
      },
      control: { conversationId: 'goal-1', platformStage: 'goal' }
    }
    const adapter = { startGoal: jest.fn().mockResolvedValue(platformResult) }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    runner.getExperimentSnapshot = jest.fn().mockResolvedValue({
      actorProfile: { learningGoal: '开始' },
      story: { visibleOpening: '开始' },
      frictionBudget: 'normal'
    })
    let projectionAttempts = 0
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      projectionAttempts += 1
      if (projectionAttempts <= 2) throw new Error('final projection unavailable')
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    let command: any = null
    const work = jest.fn(() => runner.autoStep('vs1', 'admin1'))
    const newerWork = jest.fn()
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async ({ where }: any) =>
      where.id ? command?.id === where.id ? command : null
        : command?.commandId === where.runId_commandId.commandId ? command : null
    )
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockImplementation(async () =>
      ['processing', 'failed'].includes(command?.status) ? [command] : []
    )
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'command-reconcile', status: 'processing', ...data }
      return command
    })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { ...command, ...data }
      return command
    })
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 1 : 0
    }))
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })

    const options = {
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'reconcile-command',
      kind: 'step' as const, request: {}, expectedTraceCount: 0
    }
    await expect(runner.runCommand(options, work)).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING', retryable: true
    })
    const firstReceipt = command.resultJson
    expect(JSON.parse(firstReceipt)).toEqual({
      projectionPending: true,
      projectionKey: 'command-reconcile:1',
      finalProjection: true,
      receiptKind: 'result',
      platformResult,
      commandResult: { action: { type: 'chat', text: '开始' }, result: platformResult }
    })

    await expect(runner.runCommand({
      ...options,
      kind: 'observe',
      request: { refresh: true }
    }, newerWork)).rejects.toMatchObject({ code: 'BLACKBOX_COMMAND_ID_REUSED' })

    await expect(runner.runCommand({
      ...options,
      commandId: 'newer-command'
    }, newerWork)).rejects.toMatchObject({ code: 'BLACKBOX_RECONCILIATION_PENDING' })
    expect(newerWork).not.toHaveBeenCalled()

    await expect(runner.runCommand(options, work)).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING', retryable: true
    })
    expect(command.resultJson).toBe(firstReceipt)
    expect(command).toEqual(expect.objectContaining({ status: 'failed' }))
    expect(JSON.parse(command.errorJson)).toEqual(expect.objectContaining({
      code: 'BLACKBOX_RECONCILIATION_PENDING'
    }))
    const reconciled = await runner.runCommand(options, work)

    expect(reconciled).toEqual({
      result: { action: { type: 'chat', text: '开始' }, result: platformResult },
      reused: false
    })
    expect(work).toHaveBeenCalledTimes(1)
    expect(adapter.startGoal).toHaveBeenCalledTimes(1)
    expect(prisma.virtual_experiment_commands.create).toHaveBeenCalledTimes(1)
    expect(command).toEqual(expect.objectContaining({
      id: 'command-reconcile', sequence: 1, status: 'completed', errorJson: null
    }))
    expect(JSON.parse(command.resultJson)).toEqual({
      action: { type: 'chat', text: '开始' },
      result: platformResult
    })
  })

  it('普通失败命令仍拒绝使用相同 commandId 重试', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockResolvedValue({
      id: 'command-failed', status: 'failed', kind: 'action', requestJson: '{"type":"chat","text":"开始"}',
      errorJson: JSON.stringify({ message: 'Goal 服务不可用', code: 'BLACKBOX_ACTION_FAILED' })
    })

    await expect(runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'failed-command', kind: 'action',
      request: { type: 'chat', text: '开始' }, expectedTraceCount: 0
    }, jest.fn())).rejects.toMatchObject({ code: 'BLACKBOX_COMMAND_PREVIOUSLY_FAILED' })
    expect(prisma.virtual_experiment_leases.create).not.toHaveBeenCalled()
  })

  it('进程在回执写入后退出时可在新 lease 下仅恢复投影', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith({})
    const platformResult = {
      observation: { stage: 'goal', visibleMessages: [], availableActions: ['chat'] },
      control: { conversationId: 'goal-crash' }
    }
    let command: any = {
      id: 'command-crash', runId: 'run1', commandId: 'crash-command', sequence: 1,
      status: 'processing', kind: 'action', requestJson: '{"type":"chat","text":"开始"}',
      resultJson: JSON.stringify({
        projectionPending: true,
        projectionKey: 'command-crash:1',
        finalProjection: true,
        receiptKind: 'result',
        platformResult,
        commandResult: platformResult
      })
    }
    runner.getSession = jest.fn(async () => currentSession)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async () => command)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockResolvedValue([command])
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { ...command, ...data }
      return command
    })
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
    const work = jest.fn()

    const result = await runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'crash-command', kind: 'action',
      request: { type: 'chat', text: '开始' }, expectedTraceCount: 0
    }, work)

    expect(result).toEqual({ result: platformResult, reused: false })
    expect(work).not.toHaveBeenCalled()
    expect(command).toEqual(expect.objectContaining({ status: 'completed', errorJson: null }))
    expect(JSON.parse(currentSession.stageResults).blackbox.publicTrace).toHaveLength(1)
  })

  it('投影成功但命令完成写失败时重试不会重复追加轨迹', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith({})
    const platformResult = {
      observation: { stage: 'goal', visibleMessages: [], availableActions: ['chat'] },
      control: { conversationId: 'goal-projected' }
    }
    const adapter = { startGoal: jest.fn().mockResolvedValue(platformResult) }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    let command: any = null
    let completionFailed = false
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async () => command)
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockImplementation(async () =>
      command?.status === 'failed' ? [command] : []
    )
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'command-projected', status: 'processing', ...data }
      return command
    })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      if (data.status === 'completed' && !completionFailed) {
        completionFailed = true
        throw new Error('command completion unavailable')
      }
      command = { ...command, ...data }
      return command
    })
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 1 : 0
    }))
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
    const options = {
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'projected-command', kind: 'action' as const,
      request: { type: 'chat', text: '开始' }, expectedTraceCount: 0
    }
    const work = jest.fn(() => runner.act('vs1', 'admin1', options.request as any))

    await expect(runner.runCommand(options, work)).rejects.toThrow('command completion unavailable')
    expect(JSON.parse(currentSession.stageResults).blackbox.publicTrace).toHaveLength(1)
    const reconciled = await runner.runCommand(options, work)

    expect(reconciled.result).toEqual(platformResult)
    expect(work).toHaveBeenCalledTimes(1)
    expect(adapter.startGoal).toHaveBeenCalledTimes(1)
    expect(JSON.parse(currentSession.stageResults).blackbox.publicTrace).toHaveLength(1)
  })

  it('数据库 lease 被其他实例持有时拒绝执行命令', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 1 : 0
    }))
    ;(prisma.virtual_experiment_leases.create as jest.Mock)
      .mockRejectedValue(Object.assign(new Error('unique constraint'), { code: 'P2002' }))

    await expect(runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'command-2', kind: 'observe', request: {}, expectedTraceCount: 0
    }, jest.fn())).rejects.toMatchObject({
      code: 'BLACKBOX_SESSION_BUSY', statusCode: 409, retryable: true
    })
  })

  it('续租只更新未过期 owner，count=0 明确判定 lease lost', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 })
    const context = {
      sessionId: 'vs-expired',
      ownerId: 'old-owner',
      expiresAt: Date.now() + 60_000,
      renewal: Promise.resolve(),
      failureError: null
    }

    await expect(runner.renewLease(context)).rejects.toMatchObject({ code: 'BLACKBOX_LEASE_LOST' })
    expect(prisma.virtual_experiment_leases.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: 'vs-expired',
        ownerId: 'old-owner',
        expiresAt: { gt: expect.any(Date) }
      },
      data: { expiresAt: expect.any(Date) }
    })
  })

  it('P1008 续租先有界重试，确认 owner 后继续执行', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error('timed out'), { code: 'P1008' }))
      .mockResolvedValueOnce({ count: 1 })
    const context = {
      sessionId: 'vs-retry',
      ownerId: 'owner-retry',
      expiresAt: Date.now() + 60_000,
      renewal: Promise.resolve(),
      failureError: null
    }

    await expect(runner.renewLease(context)).resolves.toBeUndefined()
    expect(prisma.virtual_experiment_leases.updateMany).toHaveBeenCalledTimes(2)
  })

  it('无法在截止前确认续租时返回稳定 DB_BUSY，而不是伪装 owner lost', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock)
      .mockRejectedValue(Object.assign(new Error('database is locked'), { code: 'P1008' }))
    const context = {
      sessionId: 'vs-db-busy',
      ownerId: 'owner-db-busy',
      expiresAt: Date.now() + 60_000,
      renewal: Promise.resolve(),
      failureError: null
    }

    await expect(runner.renewLease(context)).rejects.toBeInstanceOf(BlackboxDatabaseBusyError)
    await expect(context.renewal).rejects.toMatchObject({ code: 'DB_BUSY', statusCode: 503, retryable: true })
  })

  it('非 P2002 acquire 错误原样传播', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const unrelated = Object.assign(new Error('foreign key failed'), { code: 'P2003' })
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 })
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockRejectedValueOnce(unrelated)

    await expect(runner.acquireCommandLease('vs-p2003', 'owner')).rejects.toBe(unrelated)
  })

  it('release DB 错误不覆盖业务失败，但成功工作会返回稳定 DB_BUSY', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const workError = new Error('business failed')
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock)
      .mockRejectedValue(Object.assign(new Error('database is locked'), { code: 'P1008' }))

    await expect(runner.runLeasedExclusive('vs-work-error', async () => {
      throw workError
    })).rejects.toBe(workError)

    await expect(runner.runLeasedExclusive('vs-release-error', async () => 'ok'))
      .rejects.toBeInstanceOf(BlackboxDatabaseBusyError)
  })

  it('exposes a typed retryable blackbox busy error', () => {
    expect(new BlackboxSessionBusyError()).toEqual(expect.objectContaining({
      code: 'BLACKBOX_SESSION_BUSY', statusCode: 409, retryable: true
    }))
  })

  it('客户端基于过期轨迹执行时拒绝推进下一轮', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    addObservation(session, { stage: 'goal', visibleMessages: [], availableActions: ['chat', 'abandon'] })
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 1 : 0
    }))
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })

    await expect(runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'stale-command', kind: 'step', request: {}, expectedTraceCount: 0
    }, jest.fn())).rejects.toMatchObject({ code: 'BLACKBOX_TRACE_SEQUENCE_MISMATCH', statusCode: 409 })
    expect(prisma.virtual_experiment_commands.create).not.toHaveBeenCalled()
  })

  it('长任务每两分钟按 owner 续租且工作完成前不释放 lease', async () => {
    jest.useFakeTimers()
    try {
      const runner = new BlackboxVirtualLearnerRunner()
      let releaseWork!: () => void
      const blocked = new Promise<void>(resolve => { releaseWork = resolve })
      ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
        count: where.ownerId ? 1 : 0
      }))

      const running = runner.runLeasedExclusive('vs1', async () => {
        await blocked
        return 'ok'
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(prisma.virtual_experiment_leases.deleteMany).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(2 * 60 * 1000)

      expect(prisma.virtual_experiment_leases.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ sessionId: 'vs1', ownerId: expect.stringMatching(/^lease_/) }),
        data: { expiresAt: expect.any(Date) }
      }))
      expect(prisma.virtual_experiment_leases.deleteMany).not.toHaveBeenCalled()

      releaseWork()
      await expect(running).resolves.toBe('ok')
      expect(prisma.virtual_experiment_leases.deleteMany).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('lease 丢失后即使受保护工作完成也不返回成功', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 0 : 0
    }))

    await expect(runner.runLeasedExclusive('vs1', async () => 'platform-finished')).rejects.toMatchObject({
      code: 'BLACKBOX_LEASE_LOST', retryable: true, statusCode: 503
    })
    expect(prisma.virtual_experiment_leases.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('runCommand 最终断言发现 lease 丢失时不提交成功结果', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    let command: any = null
    let renewalCount = 0
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async ({ where }: any) =>
      where.id ? command?.id === where.id ? command : null : command
    )
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'command-lease-lost', status: 'processing', resultJson: null, ...data }
      return command
    })
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      if (!where.ownerId) return { count: 0 }
      renewalCount += 1
      return { count: renewalCount === 1 ? 1 : 0 }
    })

    await expect(runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'lease-lost-command',
      kind: 'step', request: {}, expectedTraceCount: 0
    }, async () => ({ ok: true }))).rejects.toMatchObject({
      code: 'BLACKBOX_LEASE_LOST', retryable: true
    })

    expect(command).toEqual(expect.objectContaining({ status: 'processing', resultJson: null }))
    expect(prisma.virtual_experiment_leases.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('autoStep 的 observe 与 act 使用不同投影键且最终动作不会被跳过', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith({ conversationId: 'g1', learningPathId: 'p1', taskId: 't1' })
    addObservation(currentSession, {
      stage: 'path', visibleMessages: [], visiblePath: null, availableActions: []
    })
    const observedResult = {
      observation: {
        stage: 'path', visibleMessages: [], visiblePath: { id: 'p1', title: '路径', milestones: [] },
        visibleTask: { id: 't1', title: '第一个任务' }, availableActions: ['start_learning']
      },
      control: { learningPathId: 'p1', taskId: 't1', platformStage: 'active' }
    }
    const teachingResult = {
      observation: {
        stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '第一个任务' },
        availableActions: ['chat', 'abandon']
      },
      control: {
        learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1',
        teachingRevision: 1, platformStage: 'learning'
      }
    }
    const adapter = {
      getPath: jest.fn().mockResolvedValue(observedResult),
      startTeaching: jest.fn().mockResolvedValue(teachingResult)
    }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    runner.getExperimentSnapshot = jest.fn().mockResolvedValue({
      actorProfile: { learningGoal: '测试' }, story: null, frictionBudget: 'normal'
    })
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    let command: any = null
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async ({ where }: any) =>
      where.id ? command?.id === where.id ? command : null : command
    )
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockImplementation(async () =>
      command?.status === 'processing' ? [command] : []
    )
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'command-auto-projection', status: 'processing', ...data }
      return command
    })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { ...command, ...data }
      return command
    })

    const response = await runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'auto-projection',
      kind: 'step', request: {}, expectedTraceCount: 1
    }, () => runner.autoStep('vs1', 'admin1'))

    expect(adapter.getPath).toHaveBeenCalledTimes(1)
    expect(adapter.startTeaching).toHaveBeenCalledTimes(1)
    expect(response.result).toEqual({
      action: { type: 'start_learning', taskId: 't1' }, result: expect.objectContaining({
        observation: expect.objectContaining({ stage: 'learning' })
      })
    })
    const projectedCommandIds = JSON.parse(currentSession.stageResults).blackbox.projectedCommandIds
    expect(projectedCommandIds).toEqual(['command-auto-projection:1', 'command-auto-projection:2'])
  })

  it('平台结果后的回执写失败保留 processing barrier 且同 key 不重跑', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const currentSession = sessionWith({})
    const platformResult = {
      observation: { stage: 'goal', visibleMessages: [], availableActions: ['chat'] },
      control: { conversationId: 'goal-receipt-missing' }
    }
    const adapter = { startGoal: jest.fn().mockResolvedValue(platformResult) }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    let command: any = null
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async ({ where }: any) => {
      if (where.id) return command?.id === where.id ? command : null
      return command?.commandId === where.runId_commandId.commandId ? command : null
    })
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockImplementation(async () =>
      command?.status === 'processing' ? [command] : []
    )
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'command-receipt-missing', status: 'processing', resultJson: null, ...data }
      return command
    })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      if (data.resultJson && JSON.parse(data.resultJson).projectionPending) {
        throw new Error('command journal unavailable')
      }
      command = { ...command, ...data }
      return command
    })
    const options = {
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'receipt-missing', kind: 'action' as const,
      request: { type: 'chat', text: '开始' }, expectedTraceCount: 0
    }
    const work = jest.fn(() => runner.act('vs1', 'admin1', options.request))

    await expect(runner.runCommand(options, work)).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING', retryable: true
    })
    expect(command).toEqual(expect.objectContaining({ status: 'processing', resultJson: null }))

    await expect(runner.runCommand(options, work)).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_RECEIPT_MISSING'
    })
    await expect(runner.runCommand({ ...options, commandId: 'newer-after-missing' }, jest.fn()))
      .rejects.toMatchObject({ code: 'BLACKBOX_RECONCILIATION_PENDING' })
    expect(work).toHaveBeenCalledTimes(1)
    expect(adapter.startGoal).toHaveBeenCalledTimes(1)
  })

  it('命令完成写已提交但客户端报错时重读并返回成功且不标记 failed', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    let command: any = null
    const result = { observation: { stage: 'goal' } }
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async ({ where }: any) =>
      where.id ? command?.id === where.id ? command : null : command
    )
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'command-committed', status: 'processing', ...data }
      return command
    })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { ...command, ...data }
      if (data.status === 'completed') throw new Error('connection dropped after commit')
      return command
    })

    await expect(runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'committed-completion',
      kind: 'step', request: {}, expectedTraceCount: 0
    }, async () => result)).resolves.toEqual({ result, reused: false })

    expect(command).toEqual(expect.objectContaining({ status: 'completed', resultJson: JSON.stringify(result) }))
    expect((prisma.virtual_experiment_commands.update as jest.Mock).mock.calls
      .some(([input]: any[]) => input.data.status === 'failed')).toBe(false)
  })

  it('完成当前任务后刷新 Path，归档并清除任务局部私有状态', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 7 },
      { learning: { phaseFocus: 'trying' } }
    )
    const initialState = JSON.parse(session.stageResults)
    initialState.blackbox.learnerPrivateStateTrace = [{
      sequence: 1,
      stage: 'learning',
      taskId: 't1',
      state: { phaseFocus: 'trying' },
      emotion: 'confused',
      degraded: true,
      visibleSignal: 'fallback',
      stateChangeReason: '保守兜底'
    }]
    session.stageResults = JSON.stringify(initialState)
    addObservation(session, {
      stage: 'learning',
      visibleMessages: [],
      visibleTask: { id: 't1', title: '第一个任务' },
      availableActions: ['chat', 'confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: {
          teachingSessionId: 'teach1', teachingRevision: 8,
          platformStage: 'completed', terminalReason: 'completed'
        },
        diagnostic: { endResult: { status: 'completed' } }
      }),
      completeTask: jest.fn().mockResolvedValue({ diagnostic: { task: { id: 't1' } } }),
      getPath: jest.fn().mockResolvedValue({
        observation: {
          stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '第二个任务' },
          availableActions: ['start_learning']
        },
        control: {
          learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
          platformStage: 'active', runCompleted: false
        }
      })
    }
    const currentSession = installMutableActionSession(runner, session, adapter)

    const result = await runner.act('vs1', 'admin1', { type: 'confirm_complete' })

    expect(result.observation.visibleTask.id).toBe('t2')
    expect(adapter.endTeaching).toHaveBeenCalledWith('teach1', 7, 'completed')
    expect(adapter.completeTask).toHaveBeenCalledTimes(1)
    expect(adapter.getPath).toHaveBeenCalledWith('p1')
    const updates = (prisma.virtual_sessions.update as jest.Mock).mock.calls
    const teachingFinalized = JSON.parse(updates[0][0].data.stageResults)
    const taskCompleted = JSON.parse(updates[1][0].data.stageResults)
    expect(teachingFinalized.blackbox.control.taskCompletionCheckpoint).toEqual(expect.objectContaining({
      taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 8, status: 'teaching_finalized'
    }))
    expect(teachingFinalized.blackbox.control.terminalReason).toBeUndefined()
    expect(taskCompleted.blackbox.control.taskCompletionCheckpoint).toEqual(expect.objectContaining({
      taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 8, status: 'task_completed'
    }))
    const update = updates.at(-1)![0]
    const persisted = JSON.parse(update.data.stageResults)
    expect(update.data).toEqual(expect.objectContaining({ currentTaskId: 't2', status: 'running' }))
    expect(persisted.blackbox.learnerPrivateState.learning).toBeUndefined()
    expect(persisted.blackbox.learnerPrivateStateTrace.at(-1)).toEqual(expect.objectContaining({
      taskId: 't1',
      transition: 'task_completed',
      state: { phaseFocus: 'trying' },
      emotion: 'confused',
      degraded: true,
      visibleSignal: 'fallback',
      stateChangeReason: '保守兜底'
    }))
    expect(persisted.blackbox.learnerPrivateStateTrace.filter((entry: any) =>
      entry.taskId === 't1' && entry.transition === 'task_completed'
    )).toHaveLength(1)
    expect(persisted.blackbox.control.teachingSessionId).toBeNull()
    expect(persisted.blackbox.control.taskCompleted).toBe(true)
    expect(persisted.blackbox.control.terminalReason).toBeUndefined()
    expect(persisted.blackbox.control.taskCompletionCheckpoint).toEqual(expect.objectContaining({
      taskId: 't1', status: 'task_completed'
    }))
    expect(currentSession().status).toBe('running')
  })

  it('Teaching 自动结束后复用同一完成流程且不再调用 endTeaching', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 7 },
      { learning: { phaseFocus: 'trying' } }
    )
    addObservation(session, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['chat', 'abandon']
    })
    const adapter = {
      sendTeachingMessage: jest.fn().mockResolvedValue({
        observation: {
          stage: 'completed',
          visibleMessages: [
            { role: 'learner', content: '我完成了' },
            { role: 'platform', content: '课堂已自动结束' }
          ],
          availableActions: []
        },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, platformStage: 'completed' },
        diagnostic: { endResult: { status: 'auto-ended' } }
      }),
      endTeaching: jest.fn(),
      completeTask: jest.fn().mockResolvedValue({ diagnostic: { task: { id: 't1' } } }),
      getPath: jest.fn().mockResolvedValue({
        observation: {
          stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
          availableActions: ['start_learning']
        },
        control: {
          learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
          platformStage: 'active', runCompleted: false
        }
      })
    }
    installMutableActionSession(runner, session, adapter)

    const result = await runner.act('vs1', 'admin1', { type: 'chat', text: '我完成了' })

    expect(result.observation.visibleTask.id).toBe('t2')
    expect(adapter.sendTeachingMessage).toHaveBeenCalledWith('teach1', 7, { type: 'chat', text: '我完成了' })
    expect(adapter.endTeaching).not.toHaveBeenCalled()
    expect(adapter.completeTask).toHaveBeenCalledWith('t1')
    const firstCheckpoint = JSON.parse(
      (prisma.virtual_sessions.update as jest.Mock).mock.calls[0][0].data.stageResults
    ).blackbox.control.taskCompletionCheckpoint
    expect(firstCheckpoint).toEqual(expect.objectContaining({
      taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 8, status: 'teaching_finalized'
    }))
  })

  it('completeTask 瞬时失败时保持 running 并持久化可重试检查点', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 7 },
      { learning: { phaseFocus: 'trying' } }
    )
    addObservation(session, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: {
          teachingSessionId: 'teach1', teachingRevision: 8,
          platformStage: 'completed', terminalReason: 'completed'
        }
      }),
      completeTask: jest.fn().mockRejectedValue(new Error('任务服务暂时不可用')),
      getPath: jest.fn()
    }
    const currentSession = installMutableActionSession(runner, session, adapter)

    const result = await runner.act('vs1', 'admin1', { type: 'confirm_complete' })

    expect(result.observation.stage).toBe('learning')
    expect(result.observation.availableActions).toContain('confirm_complete')
    expect(result.observation.lastActionResult).toEqual(expect.objectContaining({ status: 'error' }))
    expect(result.observation.lastActionResult?.visibleMessage).toContain('请重试完成任务')
    expect(result.control.terminalReason).toBeUndefined()
    expect(adapter.getPath).not.toHaveBeenCalled()
    const persisted = JSON.parse(currentSession().stageResults)
    expect(currentSession()).toEqual(expect.objectContaining({
      status: 'running', currentStage: 'learning', completedAt: null
    }))
    expect(persisted.blackbox.control.terminalReason).toBeUndefined()
    expect(persisted.blackbox.control.taskCompletionCheckpoint).toEqual(expect.objectContaining({
      taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 8,
      status: 'teaching_finalized', lastError: '任务服务暂时不可用'
    }))
    expect(persisted.blackbox.learnerPrivateState.learning).toEqual({ phaseFocus: 'trying' })
  })

  it('endTeaching 后检查点写失败时停止且不调用 completeTask', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 7 },
      { learning: { phaseFocus: 'trying' } }
    )
    addObservation(currentSession, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, terminalReason: 'completed' }
      }),
      completeTask: jest.fn().mockRejectedValue(new Error('任务服务暂时不可用')),
      getPath: jest.fn()
    }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    let updateCount = 0
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      updateCount += 1
      if (updateCount === 1) throw new Error('checkpoint database unavailable')
      currentSession = { ...currentSession, ...data }
      return currentSession
    })

    await expect(runner.act('vs1', 'admin1', { type: 'confirm_complete' })).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING', retryable: true
    })

    expect(adapter.endTeaching).toHaveBeenCalledTimes(1)
    expect(adapter.completeTask).not.toHaveBeenCalled()
    expect(adapter.getPath).not.toHaveBeenCalled()
    expect(currentSession.status).toBe('running')
  })

  it('completeTask 后检查点写失败时停止且不调用 getPath', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 7 },
      { learning: { phaseFocus: 'trying' } }
    )
    addObservation(currentSession, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, terminalReason: 'completed' }
      }),
      completeTask: jest.fn().mockResolvedValue({ diagnostic: { task: { id: 't1' } } }),
      getPath: jest.fn().mockResolvedValue({
        observation: {
          stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
          availableActions: ['start_learning']
        },
        control: {
          learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
          platformStage: 'active', runCompleted: false
        }
      })
    }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    let updateCount = 0
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      updateCount += 1
      if (updateCount === 2) throw new Error('checkpoint database unavailable')
      currentSession = { ...currentSession, ...data }
      return currentSession
    })

    await expect(runner.act('vs1', 'admin1', { type: 'confirm_complete' })).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING', retryable: true
    })

    expect(adapter.completeTask).toHaveBeenCalledTimes(1)
    expect(adapter.getPath).not.toHaveBeenCalled()
    expect(JSON.parse(currentSession.stageResults).blackbox.control.taskCompletionCheckpoint)
      .toEqual(expect.objectContaining({ taskId: 't1', status: 'teaching_finalized' }))
  })

  it('检查点写失败时命令回执可恢复且不会重做已完成的平台调用', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith({
      conversationId: 'g1', learningPathId: 'p1', taskId: 't1',
      teachingSessionId: 'teach1', teachingRevision: 7
    })
    addObservation(currentSession, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, terminalReason: 'completed' }
      }),
      completeTask: jest.fn().mockResolvedValue({ diagnostic: { task: { id: 't1' } } }),
      getPath: jest.fn().mockResolvedValue({
        observation: {
          stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
          availableActions: ['start_learning']
        },
        control: {
          learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
          platformStage: 'active', runCompleted: false
        }
      })
    }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    let sessionUpdateCount = 0
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      sessionUpdateCount += 1
      if (sessionUpdateCount === 1) throw new Error('checkpoint database unavailable')
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    let command: any = null
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async ({ where }: any) =>
      where.id ? command?.id === where.id ? command : null
        : command?.commandId === where.runId_commandId.commandId ? command : null
    )
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockImplementation(async () =>
      ['processing', 'failed'].includes(command?.status) ? [command] : []
    )
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'command-checkpoint-recovery', status: 'processing', resultJson: null, ...data }
      return command
    })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { ...command, ...data }
      return command
    })
    const action = { type: 'confirm_complete' as const }
    const options = {
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'checkpoint-recovery',
      kind: 'action' as const, request: action, expectedTraceCount: 1
    }
    const work = jest.fn(() => runner.act('vs1', 'admin1', action))

    await expect(runner.runCommand(options, work)).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING'
    })
    expect(JSON.parse(command.resultJson)).toEqual(expect.objectContaining({
      projectionPending: true,
      projectionKey: 'command-checkpoint-recovery:1',
      receiptKind: 'checkpoint',
      checkpoint: expect.objectContaining({ status: 'teaching_finalized' })
    }))
    expect(adapter.endTeaching).toHaveBeenCalledTimes(1)
    expect(adapter.completeTask).not.toHaveBeenCalled()

    const reconciled = await runner.runCommand(options, work)

    expect(reconciled.result.observation.visibleTask?.id).toBe('t2')
    expect(adapter.endTeaching).toHaveBeenCalledTimes(1)
    expect(adapter.completeTask).toHaveBeenCalledTimes(1)
    expect(adapter.getPath).toHaveBeenCalledTimes(1)
  })

  it('后续完成动作从 teaching_finalized 恢复且不重复 endTeaching', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 7 },
      { learning: { phaseFocus: 'trying' } }
    )
    addObservation(session, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, terminalReason: 'completed' }
      }),
      completeTask: jest.fn()
        .mockRejectedValueOnce(new Error('任务服务暂时不可用'))
        .mockResolvedValueOnce({ diagnostic: { task: { id: 't1' } } }),
      getPath: jest.fn().mockResolvedValue({
        observation: {
          stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
          availableActions: ['start_learning']
        },
        control: {
          learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
          platformStage: 'active', runCompleted: false
        }
      })
    }
    const currentSession = installMutableActionSession(runner, session, adapter)

    await runner.act('vs1', 'admin1', { type: 'confirm_complete' })
    const resumed = await runner.act('vs1', 'admin1', { type: 'confirm_complete' })

    expect(resumed.observation.visibleTask.id).toBe('t2')
    expect(adapter.endTeaching).toHaveBeenCalledTimes(1)
    expect(adapter.completeTask).toHaveBeenCalledTimes(2)
    expect(adapter.getPath).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(currentSession().stageResults)
    expect(persisted.blackbox.control.taskCompletionCheckpoint).toEqual(expect.objectContaining({
      taskId: 't1', status: 'task_completed'
    }))
    expect(persisted.blackbox.control.taskCompletionCheckpoint.lastError).toBeUndefined()
    expect(persisted.blackbox.learnerPrivateStateTrace.filter((entry: any) =>
      entry.taskId === 't1' && entry.transition === 'task_completed'
    )).toHaveLength(1)
  })

  it('任务已完成但 Path 刷新失败时保留 task_completed 检查点并只重试读取', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 7 },
      { learning: { phaseFocus: 'trying' } }
    )
    addObservation(session, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, terminalReason: 'completed' }
      }),
      completeTask: jest.fn().mockResolvedValue({ diagnostic: { task: { id: 't1' } } }),
      getPath: jest.fn()
        .mockRejectedValueOnce(new Error('Path 暂时不可用'))
        .mockResolvedValueOnce({
          observation: {
            stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
            availableActions: ['start_learning']
          },
          control: {
            learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
            platformStage: 'active', runCompleted: false
          }
        })
    }
    const currentSession = installMutableActionSession(runner, session, adapter)

    const pending = await runner.act('vs1', 'admin1', { type: 'confirm_complete' })
    const resumed = await runner.act('vs1', 'admin1', { type: 'confirm_complete' })

    expect(pending.observation.stage).toBe('learning')
    expect(pending.control).toEqual(expect.objectContaining({
      taskCompleted: true,
      platformStage: 'path-refresh-pending',
      taskCompletionCheckpoint: expect.objectContaining({ status: 'task_completed' })
    }))
    expect(currentSession().status).toBe('running')
    expect(resumed.observation.visibleTask.id).toBe('t2')
    expect(adapter.endTeaching).toHaveBeenCalledTimes(1)
    expect(adapter.completeTask).toHaveBeenCalledTimes(1)
    expect(adapter.getPath).toHaveBeenCalledTimes(2)
  })

  it('pending teaching_finalized 的 autoStep 直接重试完成且不调用 Simulator Skill', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const checkpoint = {
      taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 8,
      status: 'teaching_finalized', updatedAt: '2026-07-19T10:00:00.000Z', lastError: '暂时失败'
    }
    const session = sessionWith({
      conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1',
      teachingRevision: 8, taskCompletionCheckpoint: checkpoint
    })
    addObservation(session, {
      stage: 'learning', visibleMessages: [{ role: 'platform', content: '请重试完成任务' }],
      visibleTask: { id: 't1', title: '任务' }, availableActions: ['confirm_complete', 'abandon']
    })
    const state = JSON.parse(session.stageResults)
    const actionResult = {
      observation: { stage: 'path', visibleMessages: [], availableActions: ['start_learning'] },
      control: {}
    }
    runner.context = jest.fn().mockResolvedValue({ session, state })
    runner.act = jest.fn().mockResolvedValue(actionResult)
    runner.getExperimentSnapshot = jest.fn()

    const result = await runner.autoStep('vs1', 'admin1')

    expect(result).toEqual({ action: { type: 'confirm_complete' }, result: actionResult })
    expect(runner.act).toHaveBeenCalledWith('vs1', 'admin1', { type: 'confirm_complete' })
    expect(runner.getExperimentSnapshot).not.toHaveBeenCalled()
    expect(executeSkill).not.toHaveBeenCalled()
  })

  it('开始下一教学任务时清除上一任务的完成检查点', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith({
      conversationId: 'g1', learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
      taskCompletionCheckpoint: {
        taskId: 't1', teachingSessionId: 'teach1', teachingRevision: 8,
        status: 'task_completed', updatedAt: '2026-07-19T10:00:00.000Z'
      }
    })
    addObservation(session, {
      stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
      availableActions: ['start_learning', 'abandon']
    })
    const adapter = {
      startTeaching: jest.fn().mockResolvedValue({
        observation: {
          stage: 'learning', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
          availableActions: ['chat', 'abandon']
        },
        control: {
          learningPathId: 'p1', taskId: 't2', teachingSessionId: 'teach2',
          teachingRevision: 1, platformStage: 'learning'
        }
      })
    }
    const currentSession = installMutableActionSession(runner, session, adapter)

    const result = await runner.act('vs1', 'admin1', { type: 'start_learning', taskId: 't2' })

    expect(result.control.taskCompletionCheckpoint).toBeNull()
    expect(result.control.taskCompleted).toBe(false)
    expect(JSON.parse(currentSession().stageResults).blackbox.control.taskCompletionCheckpoint).toBeNull()
  })

  it('放弃会话写入 abandoned 终态并保留原因轨迹', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith({
      conversationId: 'g1',
      learningPathId: 'p1',
      taskId: 't1',
      teachingSessionId: 'teach1',
      teachingRevision: 9
    })
    addObservation(session, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' }, availableActions: ['chat', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: {
          stage: 'completed',
          visibleMessages: [{ role: 'learner', content: '今天无法继续' }],
          availableActions: [],
          lastActionResult: { status: 'success', visibleMessage: '学习者已结束本次学习' }
        },
        control: { teachingSessionId: 'teach1', terminalReason: 'abandoned' }
      })
    }
    runner.context = jest.fn().mockResolvedValue({ session, state: JSON.parse(session.stageResults), adapter })
    runner.getSession = jest.fn().mockResolvedValue(session)

    await runner.act('vs1', 'admin1', { type: 'abandon', reason: '今天无法继续' })

    expect(adapter.endTeaching).toHaveBeenCalledWith('teach1', 9, 'abandoned', '今天无法继续')
    const update = (prisma.virtual_sessions.update as jest.Mock).mock.calls[0][0]
    expect(update.data.status).toBe('abandoned')
    expect(update.data.completedAt).toBeInstanceOf(Date)
    const persisted = JSON.parse(update.data.stageResults)
    expect(persisted.blackbox.publicTrace.at(-1).observation.visibleMessages[0].content).toBe('今天无法继续')
  })

  it('教师未公开完成确认时拒绝提前完成且不调用平台', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith({ conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1' })
    addObservation(session, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' }, availableActions: ['chat', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn(),
      completeTask: jest.fn(),
      getPath: jest.fn()
    }
    runner.context = jest.fn().mockResolvedValue({ session, state: JSON.parse(session.stageResults), adapter })

    await expect(runner.act('vs1', 'admin1', { type: 'confirm_complete' }))
      .rejects.toMatchObject({ code: 'BLACKBOX_COMPLETION_NOT_READY', statusCode: 409 })
    expect(adapter.endTeaching).not.toHaveBeenCalled()
    expect(adapter.completeTask).not.toHaveBeenCalled()
    expect(prisma.virtual_sessions.update).not.toHaveBeenCalled()
  })

  it('终态实验拒绝 action 和 observe，且不改写 completedAt', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const completedAt = new Date('2026-07-14T10:10:00.000Z')
    const session = {
      ...sessionWith({ conversationId: 'g1', learningPathId: 'p1', runCompleted: true, terminalReason: 'completed' }),
      status: 'completed',
      currentStage: 'completed',
      completedAt
    }
    addObservation(session, { stage: 'completed', visibleMessages: [], availableActions: [] })
    runner.context = jest.fn().mockResolvedValue({
      session,
      state: JSON.parse(session.stageResults),
      adapter: { getPath: jest.fn() }
    })

    await expect(runner.act('vs1', 'admin1', { type: 'chat', text: '继续' }))
      .rejects.toMatchObject({ code: 'BLACKBOX_RUN_TERMINAL' })
    await expect(runner.observe('vs1', 'admin1')).rejects.toMatchObject({ code: 'BLACKBOX_RUN_TERMINAL' })
    expect(prisma.virtual_sessions.update).not.toHaveBeenCalled()
    expect(session.completedAt).toBe(completedAt)
  })

  it('平台执行异常写入 failed 终态与错误轨迹', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession: any = sessionWith({})
    currentSession.status = 'created'
    currentSession.currentStage = 'goal'
    runner.context = jest.fn().mockResolvedValue({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter: { startGoal: jest.fn().mockRejectedValue(new Error('Goal 服务不可用')) }
    })
    runner.getSession = jest.fn(async () => currentSession)
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })

    await expect(runner.act('vs1', 'admin1', { type: 'chat', text: '开始' })).rejects.toThrow('Goal 服务不可用')

    expect(currentSession.status).toBe('failed')
    expect(currentSession.currentStage).toBe('error')
    expect(currentSession.completedAt).toBeInstanceOf(Date)
    const persisted = JSON.parse(currentSession.stageResults)
    expect(persisted.blackbox.control).toEqual(expect.objectContaining({
      terminalReason: 'failed',
      terminalCode: 'BLACKBOX_ACTION_FAILED',
      terminalDetail: 'Goal 服务不可用'
    }))
    expect(persisted.blackbox.publicTrace.at(-1).observation.stage).toBe('error')
  })

  it('外部副作用成功但最终会话持久化失败时保持非终态并返回待对账错误', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const currentSession = sessionWith({
      conversationId: 'g1', learningPathId: 'p1', taskId: 't1',
      teachingSessionId: 'teach1', teachingRevision: 7
    })
    addObservation(currentSession, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['chat', 'abandon']
    })
    const adapter = {
      sendTeachingMessage: jest.fn().mockResolvedValue({
        observation: {
          stage: 'learning', visibleMessages: [{ role: 'platform', content: '继续' }],
          availableActions: ['chat', 'abandon']
        },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, platformStage: 'learning' }
      })
    }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    ;(prisma.virtual_sessions.update as jest.Mock).mockRejectedValue(new Error('database unavailable'))

    await expect(runner.act('vs1', 'admin1', { type: 'chat', text: '继续' })).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING', statusCode: 503, retryable: true
    })

    expect(adapter.sendTeachingMessage).toHaveBeenCalledTimes(1)
    expect(prisma.virtual_sessions.update).toHaveBeenCalledTimes(1)
    expect(currentSession).toEqual(expect.objectContaining({ status: 'running', currentStage: 'learning' }))
    expect(JSON.parse(currentSession.stageResults).blackbox.control.terminalReason).toBeUndefined()
  })

  it('完成命令最终持久化失败后使用相同 commandId 仅重试会话投影', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith({
      conversationId: 'g1', learningPathId: 'p1', taskId: 't1',
      teachingSessionId: 'teach1', teachingRevision: 7
    })
    addObservation(currentSession, {
      stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '任务' },
      availableActions: ['confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({
        observation: { stage: 'completed', visibleMessages: [], availableActions: [] },
        control: { teachingSessionId: 'teach1', teachingRevision: 8, terminalReason: 'completed' }
      }),
      completeTask: jest.fn().mockResolvedValue({ diagnostic: { task: { id: 't1' } } }),
      getPath: jest.fn().mockResolvedValue({
        observation: {
          stage: 'path', visibleMessages: [], visibleTask: { id: 't2', title: '下一任务' },
          availableActions: ['start_learning']
        },
        control: {
          learningPathId: 'p1', taskId: 't2', teachingSessionId: null,
          platformStage: 'active', runCompleted: false
        }
      })
    }
    runner.getSession = jest.fn(async () => currentSession)
    runner.context = jest.fn(async () => ({
      session: currentSession,
      state: JSON.parse(currentSession.stageResults),
      adapter
    }))
    let sessionUpdateCount = 0
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      sessionUpdateCount += 1
      if (sessionUpdateCount === 3) throw new Error('final persist unavailable')
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    let command: any = null
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockImplementation(async () => currentSession)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockImplementation(async () => command)
    ;(prisma.virtual_experiment_commands.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_commands.findMany as jest.Mock).mockImplementation(async () =>
      command?.status === 'failed' ? [command] : []
    )
    ;(prisma.virtual_experiment_commands.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { id: 'completion-command', status: 'processing', ...data }
      return command
    })
    ;(prisma.virtual_experiment_commands.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      command = { ...command, ...data }
      return command
    })
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockImplementation(async ({ where }: any) => ({
      count: where.ownerId ? 1 : 0
    }))
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
    const action = { type: 'confirm_complete' as const }
    const options = {
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'completion-reconcile',
      kind: 'action' as const, request: action, expectedTraceCount: 1
    }
    const work = jest.fn(() => runner.act('vs1', 'admin1', action))

    await expect(runner.runCommand(options, work)).rejects.toMatchObject({
      code: 'BLACKBOX_RECONCILIATION_PENDING'
    })
    expect(JSON.parse(command.resultJson)).toEqual(expect.objectContaining({
      projectionPending: true,
      platformResult: expect.objectContaining({
        observation: expect.objectContaining({ visibleTask: expect.objectContaining({ id: 't2' }) })
      })
    }))
    const reconciled = await runner.runCommand(options, work)

    expect(reconciled.result.observation.visibleTask?.id).toBe('t2')
    expect(work).toHaveBeenCalledTimes(1)
    expect(adapter.endTeaching).toHaveBeenCalledTimes(1)
    expect(adapter.completeTask).toHaveBeenCalledTimes(1)
    expect(adapter.getPath).toHaveBeenCalledTimes(1)
    expect(command).toEqual(expect.objectContaining({ sequence: 1, status: 'completed', errorJson: null }))
    expect(JSON.parse(currentSession.stageResults).blackbox.control.taskCompletionCheckpoint)
      .toEqual(expect.objectContaining({ status: 'task_completed' }))
  })

  it('拒绝将 assisted 会话隐式升级为 Blackbox', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const assisted = sessionWith({})
    assisted.stageResults = JSON.stringify({ blackbox: { publicTrace: [], control: {}, refereeTrace: [] } })
    runner.getSession = jest.fn().mockResolvedValue(assisted)

    await expect(runner.act('vs1', 'admin1', { type: 'chat', text: '开始' }))
      .rejects.toMatchObject({ code: 'VIRTUAL_SESSION_MODE_MISMATCH', statusCode: 409 })
    expect(prisma.virtual_sessions.update).not.toHaveBeenCalled()
  })

  it('Goal 和 Path 阶段都可正式放弃', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession = sessionWith({ conversationId: 'g1', learningPathId: 'p1' })
    currentSession.currentStage = 'path'
    addObservation(currentSession, {
      stage: 'path', visibleMessages: [], visiblePath: { id: 'p1', title: '路径', milestones: [] }, availableActions: ['abandon']
    })
    const adapter = {
      abandonExperiment: jest.fn().mockReturnValue({
        observation: {
          stage: 'completed', visibleMessages: [{ role: 'learner', content: '不继续了' }], availableActions: []
        },
        control: { terminalReason: 'abandoned', platformStage: 'path' }
      })
    }
    runner.context = jest.fn().mockResolvedValue({ session: currentSession, state: JSON.parse(currentSession.stageResults), adapter })
    runner.getSession = jest.fn(async () => currentSession)
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })

    await runner.act('vs1', 'admin1', { type: 'abandon', reason: '不继续了' })

    expect(adapter.abandonExperiment).toHaveBeenCalledWith('path', '不继续了')
    expect(currentSession.status).toBe('abandoned')
  })

  it('同一 session 的工作严格串行', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const order: string[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>(resolve => { releaseFirst = resolve })

    const first = runner.runExclusive('vs1', async () => {
      order.push('first-start')
      await firstBlocked
      order.push('first-end')
    })
    const second = runner.runExclusive('vs1', async () => { order.push('second') })
    await Promise.resolve()

    expect(order).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('Path 作为生成结果就绪后直接进入 Learn，不调用 Path 评审 Skill', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith({ conversationId: 'g1', learningPathId: 'p1', taskId: 't1' })
    const state = JSON.parse(session.stageResults)
    state.blackbox.publicTrace = [{
      observation: {
        stage: 'path', visibleMessages: [], visiblePath: { id: 'p1', title: '路径', milestones: [] },
        availableActions: [], lastActionResult: { status: 'success', visibleMessage: '路径正在生成' }
      }
    }]
    session.stageResults = JSON.stringify(state)
    runner.context = jest.fn().mockResolvedValue({ session, state })
    runner.observe = jest.fn().mockResolvedValue({
      observation: {
        stage: 'path', visibleMessages: [], visiblePath: { id: 'p1', title: '路径', milestones: [] },
        visibleTask: { id: 't1', title: '第一个任务' }, availableActions: ['start_learning']
      },
      control: { learningPathId: 'p1', taskId: 't1' }
    })
    runner.act = jest.fn().mockResolvedValue({
      observation: { stage: 'learning', visibleMessages: [], visibleTask: { id: 't1', title: '第一个任务' }, availableActions: ['chat'] },
      control: { learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1' }
    })
    ;(prisma.virtual_learner_profiles.findUnique as jest.Mock).mockResolvedValue({
      id: 'vp1', learningGoal: '测试目标', profile: '{}', knownConcepts: '[]', struggleConcepts: '[]', personalityTraits: '{}'
    })

    const result = await runner.autoStep('vs1', 'admin1')

    expect(runner.observe).toHaveBeenCalledWith('vs1', 'admin1')
    expect(runner.act).toHaveBeenCalledWith('vs1', 'admin1', { type: 'start_learning', taskId: 't1' })
    expect(result.result.observation.stage).toBe('learning')
    expect(executeSkill).not.toHaveBeenCalled()
  })

  it('裁判只接收旁路输入与平行通道且不污染学习者轨迹', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession: any = {
      ...sessionWith(
        { conversationId: 'g1', learningPathId: 'p1', taskId: null, runCompleted: true, terminalReason: 'completed' },
        { learning: { phaseFocus: 'reflecting' } }
      ),
      status: 'completed',
      currentStage: 'completed',
      createdAt: new Date('2026-07-14T10:00:00.000Z'),
      completedAt: new Date('2026-07-14T10:10:00.000Z')
    }
    const state = JSON.parse(currentSession.stageResults)
    state.story = {
      hiddenDetails: ['不能进入裁判输入'],
      title: '被消息打断的复盘',
      triggerEvent: '周五复盘被中断',
      visibleOpening: '我最近总被消息打断，想学时间管理',
      goalSeed: {
        surfaceGoal: '学会时间管理',
        realProblem: '任务被碎片化消息打断无法进入深度工作'
      }
    }
    state.blackbox.publicTrace = [{
      timestamp: '2026-07-14T10:01:00.000Z',
      observation: { stage: 'goal', visibleMessages: [{ role: 'platform', content: '公开问题' }], availableActions: ['chat'] },
      control: { conversationId: 'g1' }
    }]
    state.blackbox.refereeTrace = [{ timestamp: '2026-07-14T10:01:00.000Z', traceId: 'trace1', diagnostic: { analysis: { score: 0.8 } } }]
    currentSession.stageResults = JSON.stringify(state)
    runner.getSession = jest.fn(async () => currentSession)
    ;(prisma.virtual_learner_profiles.findUnique as jest.Mock).mockResolvedValue({
      id: 'vp1', userId: 'u1', learningGoal: '长期目标', profile: '{}',
      knownConcepts: '[]', struggleConcepts: '[]', personalityTraits: '{}'
    })
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    ;(executeSkill as jest.Mock).mockResolvedValue({
      verdict: 'pass',
      scores: { overall: 90, goalExperience: 90, goalUnderstanding: 80, pathExperience: null, teachingExperience: null, controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      findings: [], recommendations: [], evidence: []
    })

    const report = await runner.referee('vs1', 'admin1')

    const input = (executeSkill as jest.Mock).mock.calls[0][1]
    expect(Object.keys(input).sort()).toEqual([
      'control', 'experimentSummary', 'metricCompleteness', 'publicTrace', 'refereeTrace', 'storyMeta'
    ])
    expect(input.storyMeta).toEqual(expect.objectContaining({
      storyTitle: '被消息打断的复盘',
      surfaceGoal: '学会时间管理',
      realProblem: '任务被碎片化消息打断无法进入深度工作',
      demandText: '我最近总被消息打断，想学时间管理',
      demandSource: 'story.visibleOpening'
    }))
    expect(input.metricCompleteness).toEqual(expect.objectContaining({
      available: true,
      teachingSessions: 0
    }))
    expect(JSON.stringify(input)).not.toContain('hiddenDetails')
    expect(JSON.stringify(input)).not.toContain('learnerPrivateState')
    const persisted = JSON.parse(currentSession.stageResults)
    expect(persisted.blackbox.publicTrace).toEqual(state.blackbox.publicTrace)
    expect(persisted.blackbox.refereeTrace).toEqual(state.blackbox.refereeTrace)
    expect(persisted.blackbox.control).toEqual(state.blackbox.control)
    expect(persisted.blackbox.learnerPrivateState).toEqual(state.blackbox.learnerPrivateState)
    expect(persisted.blackbox.refereeReports).toHaveLength(1)
    expect(report.reused).toBe(false)

    ;(executeSkill as jest.Mock).mockClear()
    const reused = await runner.referee('vs1', 'admin1')
    expect(reused.reused).toBe(true)
    expect(executeSkill).not.toHaveBeenCalled()
  })

  it('角色审计接收角色私有输入但不接收平台旁路诊断，并可幂等复用', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession: any = {
      ...sessionWith(
        { conversationId: 'g1', runCompleted: true, terminalReason: 'completed' },
        { goal: { trust: 0.5 }, learning: { phaseFocus: 'reflecting' } }
      ),
      status: 'completed',
      currentStage: 'completed',
      createdAt: new Date('2026-07-14T10:00:00.000Z'),
      completedAt: new Date('2026-07-14T10:10:00.000Z')
    }
    const state = JSON.parse(currentSession.stageResults)
    state.story = { hiddenDetails: ['角色审计需要看到'], disclosurePlan: { timing: 'late' } }
    state.simulationConfig = { frictionBudget: 'high' }
    state.blackbox.publicTrace = [{
      timestamp: '2026-07-14T10:01:00.000Z',
      observation: { stage: 'goal', visibleMessages: [{ role: 'learner', content: '公开行为' }], availableActions: ['chat'] },
      control: { conversationId: 'g1' }
    }]
    state.blackbox.refereeTrace = [{ timestamp: '2026-07-14T10:01:00.000Z', traceId: 'secret-trace', diagnostic: { analysis: { platformSecret: true } } }]
    currentSession.stageResults = JSON.stringify(state)
    runner.getSession = jest.fn(async () => currentSession)
    ;(prisma.virtual_learner_profiles.findUnique as jest.Mock).mockResolvedValue({
      id: 'vp1', learningGoal: '测试目标', profile: JSON.stringify({ role: '店长' }),
      knownConcepts: '[]', struggleConcepts: '["趋势判断"]', personalityTraits: JSON.stringify({ cautious: true })
    })
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    ;(executeSkill as jest.Mock).mockResolvedValue({
      verdict: 'credible',
      scores: {
        overall: 90, personaConsistency: 90, storyConsistency: 90, disclosureDiscipline: 90,
        frictionCalibration: 90, stateContinuity: 90, behaviorPlausibility: 90, evidenceSufficiency: 90
      },
      findings: [], recommendations: [], evidence: []
    })

    const report = await runner.actorAudit('vs1', 'admin1')
    const input = (executeSkill as jest.Mock).mock.calls[0][1]

    expect(Object.keys(input).sort()).toEqual([
      'actorProfile', 'experimentSummary', 'frictionBudget', 'learnerPrivateState', 'publicTrace', 'story'
    ])
    expect(JSON.stringify(input)).toContain('角色审计需要看到')
    expect(JSON.stringify(input)).toContain('phaseFocus')
    expect(JSON.stringify(input)).not.toContain('secret-trace')
    expect(JSON.stringify(input)).not.toContain('platformSecret')
    expect(JSON.stringify(input.publicTrace)).not.toContain('conversationId')
    expect(report.reused).toBe(false)

    ;(executeSkill as jest.Mock).mockClear()
    const reused = await runner.actorAudit('vs1', 'admin1')
    expect(reused.reused).toBe(true)
    expect(executeSkill).not.toHaveBeenCalled()
  })

  it('角色审计优先使用实验创建快照，不受画像后续修改影响', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    let currentSession: any = {
      ...sessionWith({ runCompleted: true, terminalReason: 'completed' }),
      status: 'completed',
      currentStage: 'completed',
      createdAt: new Date('2026-07-14T10:00:00.000Z'),
      completedAt: new Date('2026-07-14T10:10:00.000Z')
    }
    const state = JSON.parse(currentSession.stageResults)
    state.experimentSnapshot = {
      capturedAt: '2026-07-14T10:00:00.000Z',
      actorProfile: {
        profile: { role: '快照中的店长' }, learningGoal: '快照目标', knownConcepts: [], struggleConcepts: [], personalityTraits: {}
      },
      story: { title: '快照故事' },
      frictionBudget: 'high'
    }
    currentSession.stageResults = JSON.stringify(state)
    runner.getSession = jest.fn(async () => currentSession)
    ;(prisma.virtual_learner_profiles.findUnique as jest.Mock).mockResolvedValue({
      id: 'vp1', learningGoal: '后来修改的目标', profile: JSON.stringify({ role: '后来修改的画像' }),
      knownConcepts: '[]', struggleConcepts: '[]', personalityTraits: '{}'
    })
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    ;(executeSkill as jest.Mock).mockResolvedValue({
      verdict: 'credible',
      scores: {
        overall: 90, personaConsistency: 90, storyConsistency: 90, disclosureDiscipline: 90,
        frictionCalibration: 90, stateContinuity: 90, behaviorPlausibility: 90, evidenceSufficiency: 90
      },
      findings: [], recommendations: [], evidence: []
    })

    await runner.actorAudit('vs1', 'admin1')
    const input = (executeSkill as jest.Mock).mock.calls[0][1]

    expect(input.actorProfile.profile.role).toBe('快照中的店长')
    expect(input.actorProfile.learningGoal).toBe('快照目标')
    expect(input.story.title).toBe('快照故事')
    expect(input.frictionBudget).toBe('high')
    expect(JSON.stringify(input)).not.toContain('后来修改')
  })
})
