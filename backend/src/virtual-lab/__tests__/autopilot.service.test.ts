/** Autopilot 全自动模式单测：终点=Path 全部完成，可重试/可恢复/可停止 */
const mockSessionFindUnique = jest.fn()
const mockSessionFindMany = jest.fn()
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
      findMany: mockSessionFindMany,
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
    autoStep: mockAutoStep,
    observe: jest.fn()
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

  it('并发已满：启动改为排队（不拒绝），可查位次并取消排队', async () => {
    // 占满并发槽（limit=10）
    for (let i = 0; i < 10; i += 1) (service as any).runningSessions.add(`fill-${i}`)
    sessionRecord = buildSession('goal')
    mockSessionFindUnique.mockImplementation(async () => sessionRecord)

    const res = await service.start('s1')
    expect(res.queued).toBe(true)
    expect(res.position).toBe(1)
    expect(autopilotOf().status).toBe('queued')
    expect(service.getConcurrencyStats().queued).toBe(1)

    // 排队中再次启动同会话 → 冲突
    await expect(service.start('s1')).rejects.toBeInstanceOf(AutopilotConflictError)

    // cancel queued
    const stopped = await service.stop('s1')
    expect(stopped.accepted).toBe(true)
    expect(autopilotOf().status).toBe('stopped')
    expect(service.getConcurrencyStats().queued).toBe(0)
  })

  it('启动对账：复位进程重启后残留的 running/queued 僵尸自动驾驶状态', async () => {
    mockSessionFindMany.mockResolvedValue([
      { id: 'z1', stageResults: JSON.stringify({ autopilot: { status: 'running', stopRequested: false } }) },
      { id: 'z2', stageResults: JSON.stringify({ autopilot: { status: 'queued', queuePosition: 2 } }) },
      { id: 'z3', stageResults: JSON.stringify({ autopilot: { status: 'completed' } }) },
      { id: 'z4', stageResults: JSON.stringify({}) }
    ])
    const reconciled = await service.reconcileStaleRuns()
    expect(reconciled).toBe(2)
    // 复位为 idle 且带中断说明
    expect(mockSessionUpdate).toHaveBeenCalledTimes(2)
    const firstPatch = JSON.parse((mockSessionUpdate.mock.calls[0][0] as any).data.stageResults)
    expect(firstPatch.autopilot.status).toBe('idle')
    expect(String(firstPatch.autopilot.lastError)).toContain('进程重启')
  })

  it('对账：终态会话残留的 autopilot=running/queued 收敛为匹配终态（旧实现排除了终态会话，永久残留）', async () => {
    mockSessionFindMany.mockResolvedValue([
      { id: 'z1', status: 'failed', stageResults: JSON.stringify({ autopilot: { status: 'running' } }) },
      { id: 'z2', status: 'completed', stageResults: JSON.stringify({ autopilot: { status: 'queued', queuePosition: 1 } }) },
      { id: 'z3', status: 'abandoned', stageResults: JSON.stringify({ autopilot: { status: 'running' } }) }
    ])

    const reconciled = await service.reconcileStaleRuns()

    expect(reconciled).toBe(3)
    const statusOf = (i: number) => JSON.parse((mockSessionUpdate.mock.calls[i][0] as any).data.stageResults).autopilot
    expect(statusOf(0).status).toBe('failed')
    expect(statusOf(1).status).toBe('completed')
    expect(statusOf(2).status).toBe('incomplete')
    // 终态收敛也要清掉排队位次与停止请求，避免前端显示矛盾
    expect(statusOf(1).queuePosition).toBeNull()
    expect(statusOf(0).stopRequested).toBe(false)
  })

  it('对账：进程内正在跑的会话被跳过（因此可安全周期执行）', async () => {
    mockSessionFindMany.mockResolvedValue([
      { id: 'live', status: 'running', stageResults: JSON.stringify({ autopilot: { status: 'running' } }) }
    ])
    ;(service as any).runningSessions.add('live')

    const reconciled = await service.reconcileStaleRuns()

    expect(reconciled).toBe(0)
    expect(mockSessionUpdate).not.toHaveBeenCalled()
    ;(service as any).runningSessions.delete('live')
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

  it('assisted：回合上限=分片边界，连续无进展触发看门狗（不重启）', async () => {
    mockExecuteSingleStep.mockImplementation(async () => {
      sessionRecord.currentStage = 'path'
      return { success: true, goalReady: true }
    })
    mockWaitForPathReady.mockResolvedValue({ ready: true })
    mockResolvePathReview.mockImplementation(async () => {
      sessionRecord.currentStage = 'teaching'
      return { success: true }
    })
    // 每片都跑满回合上限且无净进展 → 看门狗判定卡死
    mockExecuteAutoLearning.mockResolvedValue({ success: false, error: 'auto_turn_cap_exhausted：已自动推进 40 回合' })

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('incomplete')
    expect(mockRestartLearningPhase).not.toHaveBeenCalled()
    expect(String(final.lastError)).toContain('no_progress_watchdog')
  })

  it('assisted：分片有净进展则继续下一片，不判失败', async () => {
    mockExecuteSingleStep.mockImplementation(async () => {
      sessionRecord.currentStage = 'path'
      return { success: true, goalReady: true }
    })
    mockWaitForPathReady.mockResolvedValue({ ready: true })
    mockResolvePathReview.mockImplementation(async () => {
      sessionRecord.currentStage = 'teaching'
      return { success: true }
    })
    // 第一片跑满但任务推进（completedTasks 递增）→ 有进展，继续；第二片直接完成
    let chunk = 0
    mockExecuteAutoLearning.mockImplementation(async () => {
      chunk += 1
      if (chunk === 1) {
        sessionRecord.completedTasks = 1
        return { success: false, error: 'auto_turn_cap_exhausted：已自动推进 40 回合' }
      }
      sessionRecord.status = 'completed'
      return { success: true, totalSteps: 3 }
    })

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    expect(mockRestartLearningPhase).not.toHaveBeenCalled()
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
    mockExecuteAutoLearning.mockResolvedValue({ success: false, error: 'fatal：教学设计不可恢复的结构错误' })

    await service.start('s1')
    const final = await waitTerminal()

    expect(final.status).toBe('failed')
    expect(mockRestartLearningPhase).not.toHaveBeenCalled()
    expect(String(final.lastError)).toContain('不可恢复')
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

  it('blackbox 阶段级：Path 等待期间**主动刷新观察**，就绪即停（completedStage=path，不推 step）', async () => {
    sessionRecord = buildSession('path', 'running', {
      experiment: { mode: 'blackbox-api' },
      blackbox: {
        control: { learningPathId: 'p1' },
        publicTrace: [{ observation: { stage: 'path', availableActions: ['abandon'] } }]
      }
    })
    mockAutoStep.mockResolvedValue({})
    // 真实的 observe 会向 publicTrace 追加一条最新快照。这里模拟"路径生成完成后再刷新即就绪"：
    // 关键是由**服务自己**发起 observe（kind='observe'），而不是测试在 pause() 里替它造假。
    mockRunCommand.mockImplementation(async (options: any) => {
      if (options?.kind === 'observe') {
        const sr = JSON.parse(sessionRecord.stageResults)
        sr.blackbox.publicTrace.push({ observation: { stage: 'path', availableActions: ['start_learning'] } })
        sessionRecord.stageResults = JSON.stringify(sr)
      }
      return { result: { stage: 'path' }, reused: false }
    })

    await service.start('s1', { target: 'stage' })
    const final = await waitTerminal()

    expect(final.status).toBe('completed')
    expect(final.completedStage).toBe('path')
    // 等待超时前至少发生一次观察刷新（此前快照永不更新 → 死等 10 分钟）
    const observeCalls = mockRunCommand.mock.calls.filter((call) => call[0]?.kind === 'observe')
    expect(observeCalls.length).toBeGreaterThanOrEqual(1)
    // 等待期不得推进教学步
    expect(mockAutoStep).not.toHaveBeenCalled()
  })
})