/**
 * #94 写入侧稳定键（2026-10-19）：kcId 锚定 / 未命中回落文本名。
 *
 * 背景（doc/local/ISSUE-RECON-20261019.md #94）：记忆痕迹此前一律按模型自由文本名做键，
 * 措辞漂移就多一条身份。修法是把 teaching-turn 契约里回填的 kcId（`scenario.taskKcs[].kcId`）
 * 一路带到写入侧：resolveConceptIdSafe 先按 `kc:<pathId>:<kcId>` 锚定，未命中/缺失回落
 * 文本名（现行为，逐字保留）。
 *
 * 两径覆盖（本文件的核心验收）：
 * A. **有 kcId** → 命中稳定键即用其身份（名字怎么漂移都不分叉，且不再做第二次解析）；
 *    稳定键首次出现（未命中）→ 回落文本名解析，并把稳定键登记为同一身份的别名。
 * B. **无 kcId** → 完全走原文本名解析，**不产生任何额外表访问**（旧行为零开销）。
 * 另覆盖：锚定/登记失败都只降级不阻断（宁缺勿错，不写错身份）。
 */
const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()
const mockUpdateMany = jest.fn()
const mockCreate = jest.fn()
const mockEvidenceFindMany = jest.fn()
const mockEvidenceCreateMany = jest.fn()
const mockResolveConcept = jest.fn()
const mockRegisterAlias = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    memory_traces: { findUnique: mockFindUnique, upsert: mockUpsert, updateMany: mockUpdateMany, create: mockCreate },
    learner_evidence: { findMany: mockEvidenceFindMany, createMany: mockEvidenceCreateMany },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../virtual-lab/simulation-clock-context', () => ({
  simulatedNowOr: () => new Date('2026-10-19T10:00:00.000Z'),
}))
jest.mock('../../../services/learner/concept-registry.service', () => ({
  conceptRegistryService: {
    resolveConcept: (...args: unknown[]) => mockResolveConcept(...args),
    registerAlias: (...args: unknown[]) => mockRegisterAlias(...args),
  },
}))

import { memoryTraceService, kcAnchorKey } from '../memory-trace.service'

const ANCHOR_KEY = 'kc:lp_1:kc-1a'

/** 注册表假实现：锚键命中 → cpt_kc；否则（文本名）→ cpt_name；显式 null 模拟未命中 */
function registryWith(hitAnchor: boolean, nameId: string | null = 'cpt_name') {
  mockResolveConcept.mockImplementation(async (_userId: string, raw: string) => {
    if (raw === ANCHOR_KEY) return hitAnchor ? { conceptId: 'cpt_kc', created: false } : null
    return nameId ? { conceptId: nameId, created: true } : null
  })
}

describe('kcAnchorKey（稳定键命名空间）', () => {
  it('有路径 → kc:<pathId>:<kcId>；无路径 → kc:<kcId>（kcId 是路径内局部序号，路径前缀不可省）', () => {
    expect(kcAnchorKey('kc-1a', 'lp_1')).toBe('kc:lp_1:kc-1a')
    expect(kcAnchorKey('kc-1a', null)).toBe('kc:kc-1a')
    expect(kcAnchorKey('  kc-1a  ', ' lp_1 ')).toBe('kc:lp_1:kc-1a')
  })

  it('缺 kcId（空/非字符串）→ 空串：调用方零开销走原文本名路径', () => {
    expect(kcAnchorKey(undefined, 'lp_1')).toBe('')
    expect(kcAnchorKey('', 'lp_1')).toBe('')
    expect(kcAnchorKey('   ', 'lp_1')).toBe('')
    expect(kcAnchorKey(123 as unknown, 'lp_1')).toBe('')
  })
})

describe('A 径：有 kcId → 稳定键锚定', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsert.mockResolvedValue({})
    mockFindUnique.mockResolvedValue(null)
    mockEvidenceFindMany.mockResolvedValue([])
    mockEvidenceCreateMany.mockResolvedValue({ count: 0 })
    mockRegisterAlias.mockResolvedValue({ conceptId: 'cpt_kc', registered: true })
  })

  it('锚键命中：直接用其身份落库，且**不再**做文本名解析（名字漂移不分叉）', async () => {
    registryWith(true)

    await memoryTraceService.recordExtraction({
      userId: 'u1', conceptKey: '识别对齐关系', kcId: 'kc-1a', pathId: 'lp_1', masteryScore: 0.5,
    })

    expect(mockResolveConcept).toHaveBeenCalledTimes(1)
    expect(mockResolveConcept).toHaveBeenCalledWith('u1', ANCHOR_KEY, expect.objectContaining({ createIfMissing: false }))
    const args = mockUpsert.mock.calls[0][0]
    expect(args.create.conceptId).toBe('cpt_kc')
    // 键控仍按自由文本名（展示/兼容语义不变），身份由 conceptId 承载
    expect(args.create.conceptKey).toBe('识别对齐关系')
    // 命中即无需登记
    expect(mockRegisterAlias).not.toHaveBeenCalled()
  })

  it('锚键未命中（该 kcId 首次出现）：回落文本名解析，并把稳定键登记为该身份的别名', async () => {
    registryWith(false)

    await memoryTraceService.recordExtraction({
      userId: 'u1', conceptKey: '识别对齐关系', kcId: 'kc-1a', pathId: 'lp_1', masteryScore: 0.5,
    })

    expect(mockResolveConcept).toHaveBeenNthCalledWith(1, 'u1', ANCHOR_KEY, expect.objectContaining({ createIfMissing: false }))
    expect(mockResolveConcept).toHaveBeenNthCalledWith(2, 'u1', '识别对齐关系', expect.objectContaining({ source: 'write_time', originPathId: 'lp_1' }))
    const args = mockUpsert.mock.calls[0][0]
    expect(args.create.conceptId).toBe('cpt_name')
    // 首次相遇即登记锚键：此后同 kcId 换措辞也命中同一身份
    expect(mockRegisterAlias).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', conceptId: 'cpt_name', aliasRaw: ANCHOR_KEY, source: 'write_time',
    }))
  })

  it('锚定解析抛错：回落文本名（不阻断写入），登记照常尝试', async () => {
    mockResolveConcept
      .mockRejectedValueOnce(new Error('registry down'))
      .mockResolvedValueOnce({ conceptId: 'cpt_name', created: false })

    await expect(memoryTraceService.recordExtraction({
      userId: 'u1', conceptKey: '识别对齐关系', kcId: 'kc-1a', pathId: 'lp_1', masteryScore: 0.5,
    })).resolves.toBeUndefined()

    expect(mockUpsert.mock.calls[0][0].create.conceptId).toBe('cpt_name')
    expect(mockRegisterAlias).toHaveBeenCalledTimes(1)
  })

  it('锚键登记失败：不阻断本次写入（身份已解析成功，照常落 conceptId）', async () => {
    registryWith(false)
    mockRegisterAlias.mockRejectedValueOnce(new Error('unique conflict'))

    await expect(memoryTraceService.recordExtraction({
      userId: 'u1', conceptKey: '识别对齐关系', kcId: 'kc-1a', pathId: 'lp_1', masteryScore: 0.5,
    })).resolves.toBeUndefined()

    expect(mockUpsert.mock.calls[0][0].create.conceptId).toBe('cpt_name')
  })

  it('无 pathId 的 kcId：锚键退化为 kc:<kcId>（与写入主链同键），仍优先锚定', async () => {
    mockResolveConcept.mockResolvedValue({ conceptId: 'cpt_kc', created: false })

    await memoryTraceService.recordExtraction({
      userId: 'u1', conceptKey: '识别对齐关系', kcId: 'kc-1a', masteryScore: 0.5,
    })

    expect(mockResolveConcept).toHaveBeenCalledWith('u1', 'kc:kc-1a', expect.objectContaining({ createIfMissing: false }))
    expect(mockUpsert.mock.calls[0][0].create.conceptId).toBe('cpt_kc')
  })
})

describe('B 径：无 kcId → 回落文本名（现行为逐字保留，零额外表访问）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsert.mockResolvedValue({})
    mockFindUnique.mockResolvedValue(null)
    mockEvidenceFindMany.mockResolvedValue([])
    mockEvidenceCreateMany.mockResolvedValue({ count: 0 })
  })

  it('recordExtraction：一次文本名解析，无锚定、无登记', async () => {
    registryWith(true)

    await memoryTraceService.recordExtraction({
      userId: 'u1', conceptKey: '识别对齐关系', masteryScore: 0.5, pathId: 'lp_1',
    })

    expect(mockResolveConcept).toHaveBeenCalledTimes(1)
    expect(mockResolveConcept).toHaveBeenCalledWith('u1', '识别对齐关系', expect.objectContaining({ source: 'write_time', originPathId: 'lp_1' }))
    expect(mockRegisterAlias).not.toHaveBeenCalled()
    expect(mockUpsert.mock.calls[0][0].create.conceptId).toBe('cpt_name')
  })

  it('recordExtraction：kcId 为空白串等同未提供（不得凭空锚定）', async () => {
    registryWith(true)

    await memoryTraceService.recordExtraction({
      userId: 'u1', conceptKey: '识别对齐关系', kcId: '   ', masteryScore: 0.5,
    })

    expect(mockResolveConcept).toHaveBeenCalledTimes(1)
    expect(mockResolveConcept).toHaveBeenCalledWith('u1', '识别对齐关系', expect.anything())
    expect(mockRegisterAlias).not.toHaveBeenCalled()
  })
})

describe('结算链两径（recordSessionOutcome / applyKtEstimate 透传）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsert.mockResolvedValue({})
    mockFindUnique.mockResolvedValue(null)
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockCreate.mockResolvedValue({})
    mockEvidenceFindMany.mockResolvedValue([])
    mockEvidenceCreateMany.mockResolvedValue({ count: 0 })
    mockRegisterAlias.mockResolvedValue({ conceptId: 'cpt_kc', registered: true })
    registryWith(true)
  })

  it('recordSessionOutcome：看板项带 kcId → 锚定；不带 → 回落文本名（两径同一漏斗）', async () => {
    const count = await memoryTraceService.recordSessionOutcome('u1', [
      { name: '识别对齐关系', kcId: 'kc-1a', status: 'mastered', progress: 100 },
      { name: '判断对齐关系', status: 'learning', progress: 40 },
    ], 'derived', 'accurate', 'lp_1')

    expect(count).toBe(2)
    // 第 1 项：锚键先行
    expect(mockResolveConcept.mock.calls[0][0]).toBe('u1')
    expect(mockResolveConcept.mock.calls[0][1]).toBe(ANCHOR_KEY)
    expect(mockUpsert.mock.calls[0][0].create.conceptId).toBe('cpt_kc')
    // 第 2 项（无 kcId）：只做一次文本名解析（第 2 次调用即文本名，不留锚键调用）
    expect(mockResolveConcept.mock.calls[1][1]).toBe('判断对齐关系')
    expect(mockUpsert.mock.calls[1][0].create.conceptId).toBe('cpt_name')
  })

  it('recordSessionOutcome：kcId 随 session:outcome 证据留痕（可回溯按哪个 KC 锚定）', async () => {
    await memoryTraceService.recordSessionOutcome('u1', [
      { name: '识别对齐关系', kcId: 'kc-1a', status: 'mastered', progress: 100 },
    ], 'derived', 'accurate', 'lp_1', 'sess-1')

    expect(mockEvidenceCreateMany).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(mockEvidenceCreateMany.mock.calls[0][0].data[0].payload)
    expect(payload.kcId).toBe('kc-1a')
  })

  it('applyKtEstimate：item.kcId → 锚定；缺失 → 回落文本名', async () => {
    mockFindUnique.mockResolvedValue(null)

    await memoryTraceService.applyKtEstimate('u1', [
      { conceptKey: '识别对齐关系', kcId: 'kc-1a', mastery: 0.8 },
      { conceptKey: '判断对齐关系', mastery: 0.6 },
    ], 'lp_1')

    expect(mockResolveConcept.mock.calls[0][1]).toBe(ANCHOR_KEY)
    expect(mockResolveConcept.mock.calls[1][1]).toBe('判断对齐关系')
    expect(mockCreate.mock.calls[0][0].data.conceptId).toBe('cpt_kc')
    expect(mockCreate.mock.calls[1][0].data.conceptId).toBe('cpt_name')
  })
})
