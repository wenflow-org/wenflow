/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #154：advance-day 的当天学习（runDayLearning）在课堂被解绑（LEARN_CLASSROOM_UNBOUND）时
 * 应像 batch 驱动一样重开本课再试，而不是见 !success 直接 break（→ started:false → 时钟回滚、逐日空转）。
 */
const mockResolvePathReview = jest.fn()
const mockExecuteAutoLearning = jest.fn()
const mockRestartLearningPhase = jest.fn()
const mockFindSessionStageFields = jest.fn()
const mockFindSessionStatus = jest.fn()
const mockFindLiveSessionsByProfiles = jest.fn()
const mockDeleteSessionLeases = jest.fn()
const mockAutopilotStop = jest.fn()

jest.mock('../../../coordinators/simulation.coordinator', () => ({
  __esModule: true,
  default: {
    resolvePathReview: (...a: unknown[]) => mockResolvePathReview(...a),
    executeAutoLearning: (...a: unknown[]) => mockExecuteAutoLearning(...a),
    restartLearningPhase: (...a: unknown[]) => mockRestartLearningPhase(...a)
  }
}))
jest.mock('../../../services/virtual-lab/virtual-session.repo', () => ({
  __esModule: true,
  findSessionById: jest.fn(),
  findSessionStageFields: (...a: unknown[]) => mockFindSessionStageFields(...a),
  findSessionStatus: (...a: unknown[]) => mockFindSessionStatus(...a),
  findLiveSessionsByProfiles: (...a: unknown[]) => mockFindLiveSessionsByProfiles(...a),
  deleteSessionLeases: (...a: unknown[]) => mockDeleteSessionLeases(...a),
  markSessionAbandoned: jest.fn(),
  createAdminAuditLog: jest.fn()
}))
jest.mock('../../../virtual-lab/autopilot.service', () => ({
  __esModule: true,
  autopilotService: { stop: (...a: unknown[]) => mockAutopilotStop(...a) }
}))
jest.mock('../../../services/virtual-lab/simulated-day.service', () => ({
  __esModule: true,
  resolveSimulationClock: jest.fn(),
  resolutionEnteredLearn: () => true,
  summarizeDayLearning: (attempts: any[]) => {
    const chunks = attempts.filter((a) => a?.success === true).length
    if (chunks > 0) return { started: true, chunks }
    return { started: false, chunks: 0, error: attempts.find((a) => a?.error)?.error || 'none' }
  }
}))
jest.mock('../../../virtual-lab/session-budget', () => ({
  __esModule: true,
  resolveSessionBudget: () => ({ turnChunkPerLesson: 8 })
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { runDayLearning, stopLiveRunsForProfile } from '../virtual-learners.assisted-shared'

describe('#154 advance-day 当天学习：解绑课堂自动续课', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindSessionStageFields.mockResolvedValue({ currentStage: 'teaching' })
    mockFindSessionStatus.mockResolvedValue({ status: 'running' })
  })

  it('LEARN_CLASSROOM_UNBOUND → restart-learning 后重试，当天计入成功（不再空转回滚）', async () => {
    mockExecuteAutoLearning
      .mockResolvedValueOnce({ success: false, error: 'LEARN_CLASSROOM_UNBOUND: 当前 Learn 没有绑定教学会话' })
      .mockResolvedValueOnce({ success: true, totalSteps: 4, completedMilestones: 1 })
    mockRestartLearningPhase.mockResolvedValue({ success: true, teachingSessionId: 'ts-2' })

    const result = await runDayLearning('s1', { lessonsPerDay: 1, stageResults: {}, profileData: {} })

    expect(mockRestartLearningPhase).toHaveBeenCalledWith('s1')
    expect(mockExecuteAutoLearning).toHaveBeenCalledTimes(2)
    expect(result.started).toBe(true)
    expect(result.chunks).toBe(1)
  })

  it('对照：不可恢复错误仍直接结束当天（不重启、回滚时钟）', async () => {
    mockExecuteAutoLearning.mockResolvedValue({ success: false, error: 'fatal：结构错误' })

    const result = await runDayLearning('s1', { lessonsPerDay: 1, stageResults: {}, profileData: {} })

    expect(mockRestartLearningPhase).not.toHaveBeenCalled()
    expect(result.started).toBe(false)
  })
})

/**
 * 2026-11-09 运营流程核查：单行删除原来直接删行，内存里的自动驾驶循环/排队项没人通知。
 * 这里钉住「先撤租约、再停自动驾驶」的收口顺序与容错。
 */
describe('stopLiveRunsForProfile：删除前叫停活跃运行', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindLiveSessionsByProfiles.mockResolvedValue([])
    mockDeleteSessionLeases.mockResolvedValue({ count: 1 })
    mockAutopilotStop.mockResolvedValue({ accepted: true })
  })

  it('逐条撤租约 + 停自动驾驶，返回条数', async () => {
    mockFindLiveSessionsByProfiles.mockResolvedValue([{ id: 's1' }, { id: 's2' }])

    const stopped = await stopLiveRunsForProfile('p1')

    expect(stopped).toBe(2)
    expect(mockFindLiveSessionsByProfiles).toHaveBeenCalledWith(['p1'])
    expect(mockDeleteSessionLeases.mock.calls.map((c) => c[0])).toEqual(['s1', 's2'])
    expect(mockAutopilotStop.mock.calls.map((c) => c[0])).toEqual(['s1', 's2'])
  })

  it('撤租约/停自动驾驶单步失败都不阻断删除（容错后继续）', async () => {
    mockFindLiveSessionsByProfiles.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    mockDeleteSessionLeases.mockRejectedValueOnce(new Error('lease table missing'))
    mockAutopilotStop.mockRejectedValueOnce(new Error('provider down'))

    await expect(stopLiveRunsForProfile('p1')).resolves.toBe(2)

    // 第一条的两步都失败，第二条仍被处理
    expect(mockAutopilotStop).toHaveBeenCalledTimes(2)
    expect(mockDeleteSessionLeases).toHaveBeenCalledTimes(2)
    expect(mockAutopilotStop).toHaveBeenLastCalledWith('s2')
  })

  it('没有活跃会话时不产生任何停止动作', async () => {
    mockFindLiveSessionsByProfiles.mockResolvedValue([])

    await expect(stopLiveRunsForProfile('p1')).resolves.toBe(0)

    expect(mockDeleteSessionLeases).not.toHaveBeenCalled()
    expect(mockAutopilotStop).not.toHaveBeenCalled()
  })
})
