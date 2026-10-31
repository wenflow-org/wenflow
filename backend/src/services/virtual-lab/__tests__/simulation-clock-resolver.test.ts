/**
 * 实例级模拟钟时刻解析（夜间审计 M-15）单测。
 *
 * 覆盖：会话级 clock > 画像级 clock > 全局 settings 的解析链与「未启用 → null」
 * 行为零变化承诺（默认 enabled=false 时调用方保持真实墙钟）。
 */
const mockProfileFindUnique = jest.fn()
const mockFindLatestSessionForProfile = jest.fn()
const mockGetVirtualLabSettings = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: { findUnique: mockProfileFindUnique },
  },
}))
jest.mock('../virtual-session.repo', () => ({
  __esModule: true,
  findLatestSessionForProfile: (...args: unknown[]) => mockFindLatestSessionForProfile(...args),
}))
jest.mock('../../virtual-lab-settings.service', () => ({
  __esModule: true,
  getVirtualLabSettings: (...args: unknown[]) => mockGetVirtualLabSettings(...args),
  DEFAULT_VIRTUAL_LAB_SETTINGS: {
    dateSimulation: { enabled: false, timezone: 'Asia/Shanghai', baseDate: null, maxSimulatedDays: 60, courseWeekdays: [1, 2, 3, 4, 5], lessonsPerDay: 1, autoAdvance: false },
  },
}))

import { resolveSessionSimulatedNow, resolveUserSimulatedNow } from '../simulation-clock-resolver'

const enabledSettings = {
  dateSimulation: {
    enabled: true,
    timezone: 'Asia/Shanghai',
    maxSimulatedDays: 60,
    courseWeekdays: [1, 2, 3, 4, 5],
    lessonsPerDay: 1,
    autoAdvance: false,
  },
}

describe('resolveSessionSimulatedNow（会话执行入口绑钟）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetVirtualLabSettings.mockResolvedValue(enabledSettings)
  })

  it('会话级 simulationClock.enabled + simulatedNow → 返回该模拟时刻', async () => {
    const asOf = await resolveSessionSimulatedNow({
      stageResults: JSON.stringify({
        simulationClock: { enabled: true, baseDate: '2026-10-01', dayIndex: 2, simulatedNow: '2026-10-03T15:59:59.999Z' },
      }),
      createdAt: new Date('2026-10-01T00:00:00Z'),
    }, { profile: '{}' });

    expect(asOf?.toISOString()).toBe('2026-10-03T15:59:59.999Z')
  })

  it('全局 settings 未启用（默认态）且无会话/画像钟 → null（真实墙钟行为零变化）', async () => {
    mockGetVirtualLabSettings.mockResolvedValue({
      dateSimulation: { ...enabledSettings.dateSimulation, enabled: false },
    });
    const asOf = await resolveSessionSimulatedNow({
      stageResults: JSON.stringify({}),
      createdAt: new Date('2026-10-01T00:00:00Z'),
    }, { profile: '{}' });

    expect(asOf).toBeNull()
  })

  it('画像级钟兜底（会话无钟、画像配了 enabled+startDate）→ 返回按日窗口推导的时刻', async () => {
    const asOf = await resolveSessionSimulatedNow({
      stageResults: JSON.stringify({}),
      createdAt: new Date('2026-10-01T00:00:00Z'),
    }, { profile: JSON.stringify({ simulationClock: { enabled: true, startDate: '2026-10-01' } }) });

    expect(asOf).not.toBeNull()
  })
})

describe('resolveUserSimulatedNow（后台消费者按实例绑钟）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetVirtualLabSettings.mockResolvedValue(enabledSettings)
  })

  it('非 VL 用户（无画像）→ null', async () => {
    mockProfileFindUnique.mockResolvedValue(null)
    expect(await resolveUserSimulatedNow('human-user')).toBeNull()
    expect(mockFindLatestSessionForProfile).not.toHaveBeenCalled()
  })

  it('VL 实例：会话级钟（最近会话）优先 → 返回其模拟时刻', async () => {
    mockProfileFindUnique.mockResolvedValue({ id: 'vp1', profile: '{}', createdAt: new Date('2026-10-01T00:00:00Z') })
    mockFindLatestSessionForProfile.mockResolvedValue({
      id: 's1',
      stageResults: JSON.stringify({
        simulationClock: { enabled: true, baseDate: '2026-10-01', dayIndex: 3, simulatedNow: '2026-10-04T15:59:59.999Z' },
      }),
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });

    expect((await resolveUserSimulatedNow('vl-user'))?.toISOString()).toBe('2026-10-04T15:59:59.999Z')
  })

  it('VL 实例但未启用日期模拟 → null（真实墙钟行为零变化）', async () => {
    mockGetVirtualLabSettings.mockResolvedValue({
      dateSimulation: { ...enabledSettings.dateSimulation, enabled: false },
    });
    mockProfileFindUnique.mockResolvedValue({ id: 'vp1', profile: '{}', createdAt: new Date('2026-10-01T00:00:00Z') })
    mockFindLatestSessionForProfile.mockResolvedValue({ id: 's1', stageResults: '{}', createdAt: new Date('2026-10-01T00:00:00Z') });

    expect(await resolveUserSimulatedNow('vl-user')).toBeNull()
  })

  it('解析链异常 → null（不向上抛，调用方回退真实墙钟）', async () => {
    mockProfileFindUnique.mockRejectedValue(new Error('db down'))
    expect(await resolveUserSimulatedNow('vl-user')).toBeNull()
  })
})
