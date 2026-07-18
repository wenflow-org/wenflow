import prisma from '../../config/database'
import { BlackboxVirtualLearnerRunner } from '../blackbox-runner'
import { executeSkill } from '../../skills'
import { getAPIGateway } from '../../gateway/api-gateway'
import { agentConfigService } from '../../services/agentConfig.service'
import { getRequestContext } from '../../gateway/api-gateway/context'

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

describe('BlackboxVirtualLearnerRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
      return { reply: '我的目标', learnerState: { readyToAdvance: false } }
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
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
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

  it('数据库 lease 被其他实例持有时拒绝执行命令', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockRejectedValue(new Error('unique constraint'))

    await expect(runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'command-2', kind: 'observe', request: {}, expectedTraceCount: 0
    }, jest.fn())).rejects.toMatchObject({ code: 'BLACKBOX_SESSION_BUSY', statusCode: 409 })
  })

  it('客户端基于过期轨迹执行时拒绝推进下一轮', async () => {
    const runner = new BlackboxVirtualLearnerRunner()
    const session = sessionWith({})
    addObservation(session, { stage: 'goal', visibleMessages: [], availableActions: ['chat', 'abandon'] })
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue(session)
    ;(prisma.virtual_experiment_commands.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.virtual_experiment_leases.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.virtual_experiment_leases.create as jest.Mock).mockResolvedValue({})
    ;(prisma.virtual_experiment_leases.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })

    await expect(runner.runCommand({
      sessionId: 'vs1', operatorId: 'admin1', commandId: 'stale-command', kind: 'step', request: {}, expectedTraceCount: 0
    }, jest.fn())).rejects.toMatchObject({ code: 'BLACKBOX_TRACE_SEQUENCE_MISMATCH', statusCode: 409 })
    expect(prisma.virtual_experiment_commands.create).not.toHaveBeenCalled()
  })

  it('完成当前任务后刷新 Path，归档并清除任务局部私有状态', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1' },
      { learning: { phaseFocus: 'trying' } }
    )
    addObservation(session, {
      stage: 'learning',
      visibleMessages: [],
      visibleTask: { id: 't1', title: '第一个任务' },
      availableActions: ['chat', 'confirm_complete', 'abandon']
    })
    const adapter = {
      endTeaching: jest.fn().mockResolvedValue({}),
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
    runner.context = jest.fn().mockResolvedValue({
      session,
      state: JSON.parse(session.stageResults),
      adapter
    })
    runner.getSession = jest.fn().mockResolvedValue(session)

    const result = await runner.act('vs1', 'admin1', { type: 'confirm_complete' })

    expect(result.observation.visibleTask.id).toBe('t2')
    expect(adapter.endTeaching).toHaveBeenCalledWith('teach1', 'completed')
    const update = (prisma.virtual_sessions.update as jest.Mock).mock.calls[0][0]
    const persisted = JSON.parse(update.data.stageResults)
    expect(update.data).toEqual(expect.objectContaining({ currentTaskId: 't2', status: 'running' }))
    expect(persisted.blackbox.learnerPrivateState.learning).toBeUndefined()
    expect(persisted.blackbox.learnerPrivateStateTrace.at(-1)).toEqual(expect.objectContaining({
      taskId: 't1',
      transition: 'task_completed',
      state: { phaseFocus: 'trying' }
    }))
    expect(persisted.blackbox.control.teachingSessionId).toBeNull()
    expect(persisted.blackbox.control.taskCompleted).toBe(true)
  })

  it('放弃会话写入 abandoned 终态并保留原因轨迹', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith({ conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1' })
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

    expect(adapter.endTeaching).toHaveBeenCalledWith('teach1', 'abandoned', '今天无法继续')
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

  it('裁判只接收四类旁路输入且不污染学习者轨迹', async () => {
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
    state.story = { hiddenDetails: ['不能进入裁判输入'] }
    state.blackbox.publicTrace = [{
      timestamp: '2026-07-14T10:01:00.000Z',
      observation: { stage: 'goal', visibleMessages: [{ role: 'platform', content: '公开问题' }], availableActions: ['chat'] },
      control: { conversationId: 'g1' }
    }]
    state.blackbox.refereeTrace = [{ timestamp: '2026-07-14T10:01:00.000Z', traceId: 'trace1', diagnostic: { analysis: { score: 0.8 } } }]
    currentSession.stageResults = JSON.stringify(state)
    runner.getSession = jest.fn(async () => currentSession)
    ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      currentSession = { ...currentSession, ...data }
      return currentSession
    })
    ;(executeSkill as jest.Mock).mockResolvedValue({
      verdict: 'pass',
      scores: { overall: 90, goalExperience: 90, pathExperience: null, teachingExperience: null, controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      findings: [], recommendations: [], evidence: []
    })

    const report = await runner.referee('vs1', 'admin1')

    const input = (executeSkill as jest.Mock).mock.calls[0][1]
    expect(Object.keys(input).sort()).toEqual(['control', 'experimentSummary', 'publicTrace', 'refereeTrace'])
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
