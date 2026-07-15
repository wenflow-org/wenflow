import prisma from '../../config/database'
import { BlackboxVirtualLearnerRunner } from '../blackbox-runner'
import { executeSkill } from '../../skills'

jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }))
jest.mock('../../utils/projection-token', () => ({
  signProjectionToken: jest.fn(() => 'token'),
  SYNTHETIC_CAPABILITIES: []
}))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerRefereeDefinition: { name: 'virtual-learner-referee', version: '1.0.0' }
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}))

function sessionWith(control: Record<string, unknown>, privateState: Record<string, unknown> = {}) {
  const state = {
    experiment: { mode: 'blackbox-api', experimentId: 'exp1', runId: 'run1' },
    blackbox: {
      control,
      learnerPrivateState: privateState,
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
    stageResults: JSON.stringify(state)
  }
}

describe('BlackboxVirtualLearnerRunner', () => {
  beforeEach(() => jest.clearAllMocks())

  it('完成当前任务后刷新 Path 并保留私有学习者状态', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith(
      { conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1' },
      { learning: { phaseFocus: 'trying' } }
    )
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
    expect(persisted.blackbox.learnerPrivateState.learning.phaseFocus).toBe('trying')
    expect(persisted.blackbox.control.teachingSessionId).toBeNull()
  })

  it('放弃会话写入 abandoned 终态并保留原因轨迹', async () => {
    const runner = new BlackboxVirtualLearnerRunner() as any
    const session = sessionWith({ conversationId: 'g1', learningPathId: 'p1', taskId: 't1', teachingSessionId: 'teach1' })
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
    expect(persisted.blackbox.publicTrace[0].observation.visibleMessages[0].content).toBe('今天无法继续')
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
})
