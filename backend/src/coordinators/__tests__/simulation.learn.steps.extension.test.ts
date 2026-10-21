/**
 * 延伸学 assisted 轨（#124）纯函数面单测
 *
 * 钉死的契约：
 * - extension 模式下教学引擎不产生完成信号（完成判据由 teaching-turn-engine 抑制），
 *   收尾必须由 shouldCompleteExtension 判：跑满回合上限，或学员自评「学够了」；
 * - 非延伸段（runtime 缺省 / active=false）恒不放行，避免污染正常课界的收束；
 * - 学员自评仍带卡点（remainingBlockers 非空）或还想学（wantsMoreHelp）时不算学够。
 */
const mockPrisma = {
  virtual_learner_profiles: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
  teaching_sessions: { findUnique: jest.fn().mockResolvedValue(null) },
  virtual_sessions: { findUnique: jest.fn().mockResolvedValue(null) },
}
jest.mock('../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../skills', () => ({
  __esModule: true,
  executeSkill: jest.fn().mockResolvedValue(null),
  virtualLearnerMemoryCuratorDefinition: { name: 'virtual-learner-memory-curator', version: '1.0.0' },
}))
jest.mock('../../services/memory/memory-trace.service', () => ({
  memoryTraceService: { recordSessionOutcome: jest.fn(), getDueTraces: jest.fn().mockResolvedValue([]) },
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import {
  isExtensionActive,
  shouldCompleteExtension,
  LEARN_EXTENSION_MAX_TURNS,
} from '../simulation.learn.steps'

const runtime = (overrides: Partial<{ active: boolean; turns: number; maxTurns: number }> = {}) => ({
  active: true,
  turns: 0,
  maxTurns: LEARN_EXTENSION_MAX_TURNS,
  ...overrides,
})

const learnerStillGoing = {
  selfReportedTaskDone: false,
  wantsMoreHelp: true,
  stopAsking: false,
  remainingBlockers: [] as string[],
}

describe('#124 · isExtensionActive', () => {
  it('只有 active=true 才算延伸段', () => {
    expect(isExtensionActive({ active: true })).toBe(true)
    expect(isExtensionActive({ active: false })).toBe(false)
    expect(isExtensionActive(null)).toBe(false)
    expect(isExtensionActive(undefined)).toBe(false)
  })
})

describe('#124 · shouldCompleteExtension', () => {
  it('回合未跑满且学员还想学 → 继续', () => {
    expect(shouldCompleteExtension({ runtime: runtime({ turns: 0 }), learnerFeedback: learnerStillGoing })).toBe(false)
    expect(shouldCompleteExtension({ runtime: runtime({ turns: 2 }), learnerFeedback: learnerStillGoing })).toBe(false)
  })

  it('跑满上限的那一回合即收尾（turns 为已完成回合数）', () => {
    expect(shouldCompleteExtension({ runtime: runtime({ turns: LEARN_EXTENSION_MAX_TURNS - 1 }), learnerFeedback: learnerStillGoing })).toBe(true)
  })

  it('学员自评学够（完成 + 不必再问 + 无卡点）→ 提前收尾', () => {
    const satisfied = { selfReportedTaskDone: true, stopAsking: true, wantsMoreHelp: false, remainingBlockers: [] }
    expect(shouldCompleteExtension({ runtime: runtime({ turns: 0 }), learnerFeedback: satisfied })).toBe(true)
  })

  it('学员自评完成但仍留卡点 / 还想学 → 不收尾', () => {
    const withBlockers = { selfReportedTaskDone: true, stopAsking: true, wantsMoreHelp: false, remainingBlockers: ['还不懂公式'] }
    const wantsMore = { selfReportedTaskDone: true, stopAsking: false, wantsMoreHelp: true, remainingBlockers: [] }
    expect(shouldCompleteExtension({ runtime: runtime({ turns: 0 }), learnerFeedback: withBlockers })).toBe(false)
    expect(shouldCompleteExtension({ runtime: runtime({ turns: 0 }), learnerFeedback: wantsMore })).toBe(false)
  })

  it('非延伸段恒不放行（防污染正常课界收束）', () => {
    expect(shouldCompleteExtension({ runtime: runtime({ active: false, turns: 99 }), learnerFeedback: null })).toBe(false)
    expect(shouldCompleteExtension({ runtime: null, learnerFeedback: null })).toBe(false)
  })

  it('maxTurns 非法时回落到默认上限', () => {
    expect(shouldCompleteExtension({ runtime: runtime({ turns: LEARN_EXTENSION_MAX_TURNS - 1, maxTurns: 0 }), learnerFeedback: learnerStillGoing })).toBe(true)
  })
})
