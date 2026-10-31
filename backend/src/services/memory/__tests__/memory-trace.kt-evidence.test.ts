/**
 * #133（2026-10-22）：ktEstimate 的模型自报证据窗（evidence，skill 侧已截 200 字）
 * 随 EMA 落 memory_traces.ktEvidence——此前在 engine 组装 ktItems 时被丢弃，事后检查器
 * 只能拿二手转述核对。本套件锁三个契约：
 *   1. 有历史 → updateMany.ktEvidence = 最新证据（与 ktMasteryEma 同口径，只留最新不累积）
 *   2. 无历史 → create.ktEvidence 落库
 *   3. 缺失/空白 → null；超 200 字 → service 侧再截 200（防御）
 */
const mockFindUnique = jest.fn()
const mockUpdateMany = jest.fn()
const mockCreate = jest.fn()
const mockResolveConcept = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    memory_traces: { findUnique: mockFindUnique, updateMany: mockUpdateMany, create: mockCreate },
    learner_evidence: { createMany: jest.fn(async () => ({ count: 0 })) },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../virtual-lab/simulation-clock-context', () => ({
  simulatedNowOr: () => new Date('2026-10-22T09:00:00.000Z'),
}))
jest.mock('../../learner/concept-registry.service', () => ({
  conceptRegistryService: { resolveConcept: mockResolveConcept },
}))

import { memoryTraceService } from '../memory-trace.service'

const EXISTING = { id: 'mt_1', userId: 'u1', conceptKey: '概念甲', masteryScore: 0.5, ktMasteryEma: 0.5 }

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveConcept.mockResolvedValue({ conceptId: 'cpt_1', created: false })
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockCreate.mockResolvedValue({})
})

describe('applyKtEstimate 证据窗落库（ktEvidence）', () => {
  it('有历史 → updateMany 落最新证据', async () => {
    mockFindUnique.mockResolvedValue(EXISTING)
    await memoryTraceService.applyKtEstimate('u1', [{ conceptKey: '概念甲', mastery: 0.8, evidence: ' 学员独立推出了 ∠B=∠C ' }])
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ktMasteryEma: 0.56, ktEvidence: '学员独立推出了 ∠B=∠C' }),
    }))
  })

  it('无历史 → create 落证据', async () => {
    mockFindUnique.mockResolvedValue(null)
    await memoryTraceService.applyKtEstimate('u1', [{ conceptKey: '概念乙', mastery: 0.3, evidence: '学员答错并混淆了两个电流' }])
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ktMasteryEma: 0.3, ktEvidence: '学员答错并混淆了两个电流', source: 'kt-estimate' }),
    }))
  })

  it('缺失/空白 → ktEvidence=null（列语义：旧数据或模型未报）', async () => {
    mockFindUnique.mockResolvedValue(EXISTING)
    await memoryTraceService.applyKtEstimate('u1', [{ conceptKey: '概念甲', mastery: 0.6 }])
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ktEvidence: null }) }))
    mockFindUnique.mockResolvedValue(null)
    await memoryTraceService.applyKtEstimate('u1', [{ conceptKey: '概念乙', mastery: 0.6, evidence: '   ' }])
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ktEvidence: null }) }))
  })

  it('超 200 字 → service 侧防御性截断', async () => {
    mockFindUnique.mockResolvedValue(EXISTING)
    const long = '长'.repeat(260)
    await memoryTraceService.applyKtEstimate('u1', [{ conceptKey: '概念甲', mastery: 0.7, evidence: long }])
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ktEvidence: '长'.repeat(200) }),
    }))
  })
})
