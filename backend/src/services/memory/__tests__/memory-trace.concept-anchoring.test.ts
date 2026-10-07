/**
 * 写入侧键控契约（kcid 域，2026-10-07）——解析成功 → conceptId 必填；解析失败 → 「未挂靠」。
 *
 * 契约（见 memory-trace.service resolveConceptIdSafe 的语义注释）：
 * 1. 解析成功（命中或按设计新建身份）：create 直接落 conceptId；update 写入最新解析
 *    ——既是「未挂靠 → 锚定」的增量补全通道，也是 alias 归并后重锚的唯一通道。
 * 2. 解析失败（唯一失败模式 = 注册表故障抛错）：create 落 conceptId=null（该列 null 即
 *    「未挂靠」的现有列表达，不新增迁移）；update **不触碰**既有值（绝不把已锚定的行写回 null）；
 *    痕迹照常落库（注册表故障不阻断记忆写入）。
 * 3. recordSessionOutcome / applyKtEstimate 与 recordExtraction 同一条漏斗/同一条契约。
 */
const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()
const mockUpdateMany = jest.fn()
const mockCreate = jest.fn()
const mockResolveConcept = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    memory_traces: { findUnique: mockFindUnique, upsert: mockUpsert, updateMany: mockUpdateMany, create: mockCreate },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../virtual-lab/simulation-clock-context', () => ({
  simulatedNowOr: () => new Date('2026-10-07T10:00:00.000Z'),
}))
jest.mock('../../../services/learner/concept-registry.service', () => ({
  conceptRegistryService: { resolveConcept: mockResolveConcept },
}))

import { memoryTraceService } from '../memory-trace.service'

const RESOLVED = { conceptId: 'cpt_canonical_1', created: false }

describe('recordExtraction 写入侧键控契约（解析成功 → conceptId 必填）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsert.mockResolvedValue({})
  })

  it('解析成功 + 无历史 → create 落 conceptId', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockResolveConcept.mockResolvedValue(RESOLVED)

    await memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '概念甲', masteryScore: 0.5 })

    expect(mockResolveConcept).toHaveBeenCalledWith('u1', '概念甲', expect.objectContaining({ source: 'write_time' }))
    const args = mockUpsert.mock.calls[0][0]
    expect(args.create.conceptId).toBe('cpt_canonical_1')
  })

  it('解析成功 + 已有行无锚（历史未挂靠）→ update 补齐 conceptId（增量回填通道）', async () => {
    mockFindUnique.mockResolvedValue({ conceptKey: '概念甲', conceptId: null, extractionCount: 2, masteryScore: 0.4, lastSeenAt: new Date(), fsrsStability: null })
    mockResolveConcept.mockResolvedValue(RESOLVED)

    await memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '概念甲', masteryScore: 0.5 })

    const args = mockUpsert.mock.calls[0][0]
    expect(args.update.conceptId).toBe('cpt_canonical_1')
  })

  it('解析成功 + 已有行已锚（alias 归并后指向新 canonical）→ update 重锚到最新解析', async () => {
    mockFindUnique.mockResolvedValue({ conceptKey: '概念甲', conceptId: 'cpt_old', extractionCount: 2, masteryScore: 0.4, lastSeenAt: new Date(), fsrsStability: null })
    mockResolveConcept.mockResolvedValue({ conceptId: 'cpt_merged_new', created: false })

    await memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '概念甲', masteryScore: 0.5 })

    const args = mockUpsert.mock.calls[0][0]
    expect(args.update.conceptId).toBe('cpt_merged_new')
  })
})

describe('recordExtraction 写入侧键控契约（解析失败 → 「未挂靠」）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsert.mockResolvedValue({})
  })

  it('注册表故障 + 无历史 → create 落 conceptId=null（未挂靠），痕迹照常落库、不抛错', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockResolveConcept.mockRejectedValue(new Error('registry down'))

    await expect(memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '概念甲', masteryScore: 0.5 })).resolves.toBeUndefined()

    const args = mockUpsert.mock.calls[0][0]
    expect(args.create.conceptId).toBeNull()
    expect(args.create.conceptKey).toBe('概念甲')
  })

  it('注册表故障 + 已有行已锚 → update 不触碰既有 conceptId（绝不写回 null）', async () => {
    mockFindUnique.mockResolvedValue({ conceptKey: '概念甲', conceptId: 'cpt_keep', extractionCount: 2, masteryScore: 0.4, lastSeenAt: new Date(), fsrsStability: null })
    mockResolveConcept.mockRejectedValue(new Error('registry down'))

    await expect(memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '概念甲', masteryScore: 0.5 })).resolves.toBeUndefined()

    const args = mockUpsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('conceptId')
  })
})

describe('recordSessionOutcome 走同一条键控契约', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsert.mockResolvedValue({})
  })

  it('看板项经 recordExtraction 落库：解析成功 → upsert 带 conceptId；解析失败 → create 未挂靠', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockResolveConcept.mockResolvedValueOnce(RESOLVED).mockRejectedValueOnce(new Error('registry down'))

    const count = await memoryTraceService.recordSessionOutcome('u1', [
      { name: '概念甲', status: 'mastered', progress: 100 },
      { name: '概念乙', status: 'learning', progress: 40 },
    ])

    expect(count).toBe(2)
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    expect(mockUpsert.mock.calls[0][0].create.conceptId).toBe('cpt_canonical_1')
    expect(mockUpsert.mock.calls[1][0].create.conceptId).toBeNull()
  })
})

describe('applyKtEstimate 走同一条键控契约', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockCreate.mockResolvedValue({})
  })

  it('已有行：解析成功 → update 补齐 conceptId；解析失败 → 只更新 EMA、不触碰 conceptId', async () => {
    mockFindUnique.mockResolvedValue({ conceptKey: '概念甲', conceptId: null, masteryScore: 0.4, ktMasteryEma: null, extractionCount: 1 })
    mockResolveConcept.mockResolvedValueOnce(RESOLVED).mockRejectedValueOnce(new Error('registry down'))

    await memoryTraceService.applyKtEstimate('u1', [{ conceptKey: '概念甲', mastery: 0.8 }, { conceptKey: '概念甲', mastery: 0.8 }])

    expect(mockUpdateMany).toHaveBeenCalledTimes(2)
    expect(mockUpdateMany.mock.calls[0][0].data).toEqual(expect.objectContaining({ conceptId: 'cpt_canonical_1' }))
    expect(mockUpdateMany.mock.calls[1][0].data).not.toHaveProperty('conceptId')
  })

  it('无历史：解析成功 → create 带 conceptId；解析失败 → create 落 null（未挂靠）', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockResolveConcept.mockResolvedValueOnce(RESOLVED).mockRejectedValueOnce(new Error('registry down'))

    await memoryTraceService.applyKtEstimate('u1', [{ conceptKey: '概念甲', mastery: 0.8 }, { conceptKey: '概念乙', mastery: 0.8 }])

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockCreate.mock.calls[0][0].data.conceptId).toBe('cpt_canonical_1')
    expect(mockCreate.mock.calls[1][0].data.conceptId).toBeNull()
    expect(mockCreate.mock.calls[1][0].data.source).toBe('kt-estimate')
  })
})
