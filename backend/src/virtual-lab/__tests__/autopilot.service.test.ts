/** Autopilot 全自动模式单测：终点=Path 全部完成，可重试/可恢复/可停止 */
const mockSessionFindUnique = jest.fn()
const mockSessionUpdate = jest.fn()
const mockRunLeasedExclusive = jest.fn(async (_sessionId: string, work: () => Promise<unknown>) => work())
const mockExecuteSingleStep = jest.fn()
const mockWaitForPathReady = jest.fn()
const mockResolvePathReview = jest.fn()
const mockExecuteAutoLearning = jest.fn()
const mockRestartLearningPhase = jest.fn()
const mockRunCommand = jest.fn()
const mockAutoStep = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate
    }
  }
}))
jest.mock('../../coordinators/simulation.coordinator', () => ({
  __esModule: true,
  default: {
    runLeasedExclusive: mockRunLeasedExclusive,
    executeSingleStep: mockExecuteSingleStep,
    waitForPathReady: mockWaitForPathReady,
    resolvePathReview: mockResolvePathReview,
    executeAutoLearning: mockExecuteAutoLearning,
    restartLearningPhase: mockRestartLearningPhase
  }
}))
jest.mock('../blackbox-runner', () => ({
  __esModule: true,
  default: {
    runCommand: mockRunCommand,
    autoStep: mockAutoStep
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { AutopilotService, AutopilotConflictError, AutopilotTerminalError } from '../autopilot.service'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('AutopilotService 全自动模式', () => {
  let service: AutopilotService
  let sessionRecord: any

  const buildSession = (stage: string, status = 'running', extraStageResults: Record<string, unknown> = {}) => ({
    id: 's1',
    userId: 'u1',
    status,
    currentStage: stage,
    learningPathId: stage === 'teaching' ? 'p1' : null,
    stageResults: JSON.stringify(extraStageResults),
    logs: '[]',
    virtual_learner_profiles: {
      id: 'vp1',
      userId: 'u1',
      profile: '{}',
      learningGoal: '测试目标',
      knowledgeLevel: 'beginner',
      knownConcepts: '[]',
      struggleConcepts: '[]',
      personalityTraits: '{}'
    }
  })

  const autopilotOf = () => JSON.parse(sessionRecord.stageResults).autopilot || null

  async function waitTerminal(timeoutMs = 3000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const st = autopilotOf()
      if (st && !['running', 'idle'].includes(st.status)) return st
      await wait(20)
    }
    throw new Error('autopilot 未在预期时间内到达终态: ' + JSON.stringify(autopilotOf()))
  }

  beforeEach(() => {
    jest.clearAllMocks()
    service = new AutopilotService()
    sessionRecord = buildSession('goal')
    mockSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockSessionUpdate.mockImplementation(async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
      return sessionRecord
    })
    // 默认 pause 立即放行（避免 1.5s 真实等待拖慢测试）
    jest.spyOn(service as any, 'pause').mockResolvedValue(undefined)
  })

  it('终态会话拒绝启动', async () => {
    sessionRecord = buildSession('teaching', 'completed')
    await expect(service.start('s1')).rejects.toBeInstanceOf(AutopilotTerminalError)
    expect(mockSessionUpdate).not.toHaveBeenCalled()
  })

  it('同一会话已有运行中的全自动时拒绝启动', async () => {
    sessionRecord = buildSession('goal', 'running', { autopilot: { status: 'running' } })
    await expect(service.start('s1')).rejects.toBeInstanceOf(AutopilotConflictError)
  })

  it('stop 非运行中返回未接受', async () => {
    sessionRecord = buildSession('goal', 'running')
    const result = await service.stop('s1')
    expect(result.accepted).toBe(false)
  })

  it('assisted 全链路：goal → path → 逐课 → 达到最终目标（completed）', async () => {
    mockExecuteSingleStep.mockImplementation(async () => {
      sessionRecord.currentStage = 'path'
      return { success: true, goalReady: true }
    })
    mockWaitForPathReady.mockResolvedValue({ ready: true })
    mockResolvePathReview.mockImplementation(async () => {
      sessionRecord.currentStage = 'teaching'
      return { success: true }
    })
    mockExecuteAutoLearning.mockImplementation(async () => {
      sessionRecord.status = 'completed'
      sessionRecord.currentStage = 'teaching'
      return { success: true, totalSteps: 6 }
    })

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    expect(mockExecuteSingleStep).toHaveBeenCalledTimes(1)
    expect(mockWaitForPathReady).toHaveBeenCalled()
    expect(mockResolvePathReview).toHaveBeenCalledWith('s1', expect.objectContaining({ startLearning: true }))
    expect(mockExecuteAutoLearning).toHaveBeenCalledTimes(1)
    expect(final.steps).toBeGreaterThanOrEqual(3)
  })

  it('assisted：Goal 三次尝试仍不收敛 → failed', async () => {
    mockExecuteSingleStep.mockResolvedValue({ success: true, goalReady: false, error: '未收敛' })

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('failed')
    expect(mockExecuteSingleStep).toHaveBeenCalledTimes(60)
    expect(String(final.lastError)).toContain('未收敛')
  })

  it('assisted：单课可恢复失败自动 restart-learning 续跑，恢复上限后失败', async () => {
    mockExecuteSingleStep.mockImplementation(async () => {
      sessionRecord.currentStage = 'path'
      return { success: true, goalReady: true }
    })
    mockWaitForPathReady.mockResolvedValue({ ready: true })
    mockResolvePathReview.mockImplementation(async () => {
      sessionRecord.currentStage = 'teaching'
      return { success: true }
    })
    // 每次 executeAutoLearning 都报可恢复 provider 失败（会话保持 running）
    mockExecuteAutoLearning.mockResolvedValue({ success: false, error: 'provider timeout: upstream 503' })
    mockRestartLearningPhase.mockResolvedValue({ success: true })

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('failed')
    expect(mockRestartLearningPhase).toHaveBeenCalledTimes(3)
    expect(String(final.lastError)).toContain('恢复上限')
  })

  it('assisted：单课不可恢复错误直接失败，不重启', async () => {
    mockExecuteSingleStep.mockImplementation(async () => {
      sessionRecord.currentStage = 'path'
      return { success: true, goalReady: true }
    })
    mockWaitForPathReady.mockResolvedValue({ ready: true })
    mockResolvePathReview.mockImplementation(async () => {
      sessionRecord.currentStage = 'teaching'
      return { success: true }
    })
    mockExecuteAutoLearning.mockResolvedValue({ success: false, error: 'auto_turn_cap_exhausted：已自动推进 24 回合' })

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('failed')
    expect(mockRestartLearningPhase).not.toHaveBeenCalled()
    expect(String(final.lastError)).toContain('auto_turn_cap_exhausted')
  })

  it('stop：运行中请求停止 → stopped 并保留会话可继续', async () => {
    mockExecuteSingleStep.mockImplementation(async () => {
      sessionRecord.currentStage = 'path'
      return { success: true, goalReady: true }
    })
    mockWaitForPathReady.mockResolvedValue({ ready: true, reason: '等待中' })
    mockResolvePathReview.mockImplementation(async () => {
      sessionRecord.currentStage = 'teaching'
      return { success: true }
    })
    mockExecuteAutoLearning.mockImplementation(async () => ({ success: true, totalSteps: 5 }))

    await service.start('s1')
    // 等待循环真正跑起来（至少写过 running 状态）
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && autopilotOf()?.status !== 'running') await wait(10)
    const stopped = await service.stop('s1')
    expect(stopped.accepted).toBe(true)

    const final = await waitTerminal()
    expect(final.status).toBe('stopped')
  })

  it('blackbox：自动步进到实验完成的终态；可恢复失败用同一 commandId 续跑', async () => {
    sessionRecord = buildSession('goal', 'running', {
      experiment: { mode: 'blackbox-api' },
      blackbox: {
        control: {},
        publicTrace: [{ observation: { stage: 'goal', availableActions: ['chat'] } }]
      }
    })
    // 第一次 step：可恢复超时失败（out 端），第二次同 key 成功 → 之后标记整场完成
    let call = 0
    mockRunCommand.mockImplementation(async () => {
      call += 1
      if (call === 1) throw new Error('timeout of 300000ms exceeded')
      if (call === 2) {
        sessionRecord.status = 'completed'
        return { result: { stage: 'completed' }, reused: false }
      }
      return { result: { stage: 'goal' }, reused: false }
    })
    mockAutoStep.mockResolvedValue({})

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    // 同 key 续跑：两次调用使用同一 commandId
    const firstCommandId = mockRunCommand.mock.calls[0][0].commandId
    const secondCommandId = mockRunCommand.mock.calls[1][0].commandId
    expect(firstCommandId).toBe(secondCommandId)
  })

  it('blackbox：不可恢复错误直接失败退出', async () => {
    sessionRecord = buildSession('goal', 'running', {
      experiment: { mode: 'blackbox-api' },
      blackbox: {
        control: {},
        publicTrace: [{ observation: { stage: 'goal', availableActions: ['chat'] } }]
      }
    })
    mockRunCommand.mockRejectedValue(new Error('当前 Observation 不允许 abandon 动作'))

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('failed')
    expect(String(final.lastError)).toContain('不允许')
  })

  // ===== 阶段级（target=stage）：推进完当前阶段即停 =====

  it('assisted 阶段级：Goal 收敛即停（completedStage=goal，不再进入 Path）', async () => {
    mockExecuteSingleStep.mockResolvedValue({ success: true, goalReady: true })
    // 阶段级不调用后续阶段的方法
    mockWaitForPathReady.mockResolvedValue({ ready: true })
    mockResolvePathReview.mockResolvedValue({ success: true })

    await service.start('s1', { target: 'stage' })
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    expect(final.target).toBe('stage')
    expect(final.completedStage).toBe('goal')
    expect(mockExecuteSingleStep).toHaveBeenCalledTimes(1)
    expect(mockResolvePathReview).not.toHaveBeenCalled()
  })

  it('assisted 阶段级：Teaching 完成本课即停（completedStage=teaching）', async () => {
    sessionRecord = buildSession('teaching', 'running')
    mockExecuteAutoLearning.mockResolvedValue({ success: true, totalSteps: 6 })

    await service.start('s1', { target: 'stage' })
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    expect(final.completedStage).toBe('teaching')
    expect(mockExecuteAutoLearning).toHaveBeenCalledTimes(1)
  })

  it('assisted 阶段级：Goal 三次不收敛 → failed', async () => {
    mockExecuteSingleStep.mockResolvedValue({ success: true, goalReady: false, error: '未收敛' })

    await service.start('s1', { target: 'stage' })
    const final = await waitTerminal()

    expect(final.status).toBe('failed')
    expect(mockExecuteSingleStep).toHaveBeenCalledTimes(60)
  })

  it('blackbox 阶段级：Goal 阶段推进到 Path 即停（completedStage=goal）', async () => {
    sessionRecord = buildSession('goal', 'running', {
      experiment: { mode: 'blackbox-api' },
      blackbox: {
        control: {},
        publicTrace: [{ observation: { stage: 'goal', availableActions: ['chat'] } }]
      }
    })
    mockAutoStep.mockResolvedValue({})
    // 一次 step 后观察推进到 path（阶段边界变化 → 阶段级达成）
    mockRunCommand.mockImplementation(async () => {
      const sr = JSON.parse(sessionRecord.stageResults)
      sr.blackbox.publicTrace.push({ observation: { stage: 'path', availableActions: ['abandon'] } })
      sessionRecord.stageResults = JSON.stringify(sr)
      return { result: { stage: 'path' }, reused: false }
    })

    await service.start('s1', { target: 'stage' })
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    expect(final.completedStage).toBe('goal')
    expect(mockRunCommand).toHaveBeenCalledTimes(1)
  })

  it('blackbox 阶段级：Path 等待期间不空转，就绪即停（completedStage=path，不调用 step）', async () => {
    sessionRecord = buildSession('path', 'running', {
      experiment: { mode: 'blackbox-api' },
      blackbox: {
        control: { learningPathId: 'p1' },
        publicTrace: [{ observation: { stage: 'path', availableActions: ['abandon'] } }]
      }
    })
    mockAutoStep.mockResolvedValue({})
    mockRunCommand.mockResolvedValue({ result: { stage: 'path' }, reused: false })
    // 等待分支暂停时注入「已就绪」（出现 start_learning）→ 下轮循环直接达成，不推 step
    jest.spyOn(service as any, 'pause').mockImplementation(async () => {
      const sr = JSON.parse(sessionRecord.stageResults)
      const trace = sr.blackbox.publicTrace
      const latest = trace[trace.length - 1]?.observation
      if (!latest?.availableActions?.includes('start_learning')) {
        trace.push({ observation: { stage: 'path', availableActions: ['start_learning'] } })
        sessionRecord.stageResults = JSON.stringify(sr)
      }
    })

    await service.start('s1', { target: 'stage' })
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    expect(final.completedStage).toBe('path')
    expect(mockRunCommand).not.toHaveBeenCalled()
  })
})