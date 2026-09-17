const mockPrisma = {
  teaching_sessions: { findMany: jest.fn() },
  learning_metrics: { findMany: jest.fn() }
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { LearningStateService, type LSSInputs, type LearningStateMetrics } from '../learning-state.service'

/**
 * 回合内运行时临时态的语义契约（审计 §3.2）：
 * KTL/LF 退化为对同一 LSS 输入的快/慢 EWMA，只作展示；权威状态走结课路径。
 * 本测试**钉住**该语义，使「改成独立输入」成为显式决策而非静默漂移。
 */
describe('calculateRuntimeState 语义边界（审计 §3.2）', () => {
  const service = new LearningStateService()
  const inputs: LSSInputs = {
    difficulty: 5,
    cognitiveLoad: 5,
    efficiency: 0.7,
    timeSpent: 30,
    expectedTime: 30,
    completionRate: 1,
    taskType: 'practice'
  }
  const previous = (ktl: number, lf: number): LearningStateMetrics => ({
    lss: 5 as LearningStateMetrics['lss'],
    ktl: ktl as LearningStateMetrics['ktl'],
    lf: lf as LearningStateMetrics['lf'],
    lsb: 0 as LearningStateMetrics['lsb'],
    timestamp: new Date()
  })

  it('KTL 与 LF 都由同一 LSS 输入递推（λ=0.95 / λ=0.70），不引入独立输入', () => {
    const lss = service.calculateLSS(inputs)

    const runtime = service.calculateRuntimeState(previous(5, 5), inputs)

    expect(runtime.lss).toBeCloseTo(lss, 5)
    expect(runtime.ktl).toBeCloseTo(0.95 * 5 + 0.05 * lss, 5)
    expect(runtime.lf).toBeCloseTo(0.70 * 5 + 0.30 * lss, 5)
  })

  it('稳态下 KTL/LF 都收敛到同一 LSS（故它不是独立的负荷/疲劳观测量）', () => {
    const lss = service.calculateLSS(inputs)
    let state = previous(lss, lss)

    for (let i = 0; i < 200; i += 1) {
      state = service.calculateRuntimeState(state, inputs)
    }

    expect(state.ktl).toBeCloseTo(lss, 3)
    expect(state.lf).toBeCloseTo(lss, 3)
  })
})
