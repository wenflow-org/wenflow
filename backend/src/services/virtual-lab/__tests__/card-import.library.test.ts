/**
 * 卡库=纯档案（2026-10-29 用户拍板）的落库路径测试。
 *
 * 纯函数映射已在 card-import.service.test.ts 覆盖；本文件用 mock 的仓储/资料库验证：
 * - 导入只建档案（userId=null，不建 users 行），随卡资料写 card-<profileId>；
 * - 更新纯档案卡也写卡归属键；
 * - 派生仍建账号，且资料从卡归属键搬进实例账号目录；
 * - 导出从卡归属键读回随卡资料。
 */

jest.mock('../virtual-learner-profile.repo', () => ({
  createVirtualLearnerUser: jest.fn(),
  createVirtualLearnerProfile: jest.fn(),
  updateProfileFields: jest.fn(),
  findAllProfilesForCardIndex: jest.fn(),
  findProfilesForCardWall: jest.fn(),
  findCustomCardsForExport: jest.fn(),
  findProfileUserIdById: jest.fn(),
  findProfileJsonById: jest.fn(),
}))

jest.mock('../../materials/material-store', () => ({
  writeMaterial: jest.fn(),
  listMaterials: jest.fn(() => []),
  readMaterial: jest.fn(() => null),
}))

import * as repo from '../virtual-learner-profile.repo'
import * as store from '../../materials/material-store'
import { importCards, cloneCardsToLearners, exportCards, cardOwnerKey } from '../card-import.service'

const repoMock = repo as unknown as Record<string, jest.Mock>
const storeMock = store as unknown as Record<string, jest.Mock>

function cardDoc(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    cards: [
      {
        cardKey: 't-lib-01',
        persona: { nameHint: '高一学生', background: '县城重点高中高一在读，函数基础薄弱' },
        story: {
          visibleOpening: '我这次月考函数只考了 58 分，家长会后天就要开了，我真的不知道从哪补起。',
          followUps: ['作业完成情况如何？', '是想不到方法还是算错？', '每天能拿出多少时间补？'],
          goalSeed: { domain: '高中数学·函数', budget: { dailyMinutes: 60, horizonDays: 30, expectedHours: 30 } },
        },
        source: { kind: 'synthetic' },
        materials: [{ kind: 'book', title: '函数讲义', outline: ['第1章 函数概念'] }],
        ...over,
      },
    ],
  })
}

function materialRecord(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'card-p-src',
    name: '函数讲义.md',
    ext: '.md',
    format: 'markdown',
    size: 10,
    charCount: 10,
    structure: {
      pageCount: null,
      slideCount: 0,
      sheetCount: 0,
      headingCount: 1,
      tableCount: 0,
      listCount: 0,
      paragraphCount: 1,
      chunkCount: 0,
    },
    anchors: [{ heading: '第1章 函数概念', location: 'md', preview: '' }],
    warnings: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    origin: 'upload',
    sourceUrl: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  repoMock.findAllProfilesForCardIndex.mockResolvedValue([])
  repoMock.findProfileUserIdById.mockResolvedValue(null)
  repoMock.updateProfileFields.mockResolvedValue({})
  repoMock.createVirtualLearnerProfile.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...args.data }))
  storeMock.listMaterials.mockReturnValue([])
  storeMock.readMaterial.mockReturnValue(null)
})

describe('卡库=纯档案：导入', () => {
  it('新建卡只建档案（userId=null、无 users 行），资料写 card-<profileId>', async () => {
    const result = await importCards(cardDoc(), 'json', { enrich: false })

    expect(result.summary).toMatchObject({ created: 1, failed: 0 })
    expect(repoMock.createVirtualLearnerUser).not.toHaveBeenCalled()

    const created = repoMock.createVirtualLearnerProfile.mock.calls[0][0].data as Record<string, unknown>
    expect(created.userId).toBeNull()
    expect(created.id).toEqual(expect.any(String))
    expect(storeMock.writeMaterial).toHaveBeenCalledTimes(1)
    const record = storeMock.writeMaterial.mock.calls[0][0] as Record<string, unknown>
    expect(record.userId).toBe(cardOwnerKey(String(created.id)))
  })

  it('更新纯档案卡：不建账号，资料重写到卡归属键目录', async () => {
    repoMock.findAllProfilesForCardIndex.mockResolvedValue([
      { id: 'p-existing', profile: JSON.stringify({ cardKey: 't-lib-01' }), tags: JSON.stringify(['t-lib-01']), userId: null },
    ])

    const result = await importCards(cardDoc(), 'json', { enrich: false, update: true })

    expect(result.summary).toMatchObject({ updated: 1, created: 0, failed: 0 })
    expect(repoMock.updateProfileFields).toHaveBeenCalledTimes(1)
    expect(repoMock.createVirtualLearnerProfile).not.toHaveBeenCalled()
    expect(repoMock.createVirtualLearnerUser).not.toHaveBeenCalled()
    const record = storeMock.writeMaterial.mock.calls[0][0] as Record<string, unknown>
    expect(record.userId).toBe(cardOwnerKey('p-existing'))
  })

  it('更新仍有账号的老卡：资料仍写原账号目录（兼容路径）', async () => {
    repoMock.findAllProfilesForCardIndex.mockResolvedValue([
      { id: 'p-old', profile: JSON.stringify({ cardKey: 't-lib-01' }), tags: null, userId: 'user-old' },
    ])
    repoMock.findProfileUserIdById.mockResolvedValue('user-old')

    await importCards(cardDoc(), 'json', { enrich: false, update: true })

    const record = storeMock.writeMaterial.mock.calls[0][0] as Record<string, unknown>
    expect(record.userId).toBe('user-old')
  })
})

describe('卡库=纯档案：派生仍建账号', () => {
  it('从纯档案卡派生：新建账号与档案，资料从 card-<源 id> 搬进实例账号目录', async () => {
    repoMock.findProfilesForCardWall.mockResolvedValue([
      {
        id: 'p-src',
        userId: null,
        profile: JSON.stringify({
          cardKey: 'src-01',
          personaSeed: {
            nickname: '想啃西瓜书的研究生',
            scenarioCard: { cardKey: 'src-01', opening: '最大似然我卡住了。', materials: [{ kind: 'book', title: '函数讲义' }] },
          },
          storyPool: [{ id: 'story-1', title: '逻辑回归推导', visibleOpening: '最大似然我卡住了。' }],
        }),
        tags: null,
        learningGoal: '机器学习基础',
        knowledgeLevel: 'beginner',
        knownConcepts: null,
        struggleConcepts: null,
        presetKey: null,
        notes: null,
        createdAt: new Date(),
        users: null,
      },
    ])
    repoMock.createVirtualLearnerUser.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...args.data }))
    storeMock.listMaterials.mockImplementation((ownerKey: string) =>
      ownerKey === cardOwnerKey('p-src') ? [materialRecord({ userId: cardOwnerKey('p-src') })] : [],
    )
    storeMock.readMaterial.mockImplementation((ownerKey: string) =>
      ownerKey === cardOwnerKey('p-src') ? { record: materialRecord({ userId: ownerKey }), markdown: '# 函数讲义' } : null,
    )

    const out = await cloneCardsToLearners([{ profileId: 'p-src' }])

    expect(out.failed).toEqual([])
    expect(out.created).toHaveLength(1)
    expect(repoMock.createVirtualLearnerUser).toHaveBeenCalledTimes(1)
    expect(repoMock.createVirtualLearnerProfile).toHaveBeenCalledTimes(1)
    const createdProfile = repoMock.createVirtualLearnerProfile.mock.calls[0][0].data as Record<string, unknown>
    expect(createdProfile.userId).toBe(out.created[0].userId)
    expect(storeMock.listMaterials).toHaveBeenCalledWith(cardOwnerKey('p-src'))
    const copied = storeMock.writeMaterial.mock.calls[0][0] as Record<string, unknown>
    expect(copied.userId).toBe(out.created[0].userId)
    expect(copied.name).toBe('函数讲义.md')
  })
})

describe('卡库=纯档案：导出回程', () => {
  it('userId=null 的卡从 card-<profileId> 读回随卡资料', async () => {
    repoMock.findCustomCardsForExport.mockResolvedValue([
      {
        id: 'p-lib',
        userId: null,
        profile: JSON.stringify({
          cardKey: 'lib-01',
          personaSeed: { nickname: '想啃西瓜书的研究生', scenarioCard: { opening: '开场', materials: [{ kind: 'book', title: '函数讲义' }] } },
          storyPool: [{ title: '函数', goalSeed: {} }],
        }),
        learningGoal: '高中数学',
        knowledgeLevel: 'beginner',
        tags: JSON.stringify(['lib-01']),
        notes: null,
      },
    ])
    storeMock.readMaterial.mockImplementation((ownerKey: string) =>
      ownerKey === cardOwnerKey('p-lib')
        ? { record: materialRecord({ userId: ownerKey, sourceUrl: 'https://example.com/x' }), markdown: '# 函数讲义' }
        : null,
    )

    const out = await exportCards()

    expect(out.count).toBe(1)
    expect(storeMock.readMaterial).toHaveBeenCalledWith(cardOwnerKey('p-lib'), expect.any(String))
    expect(out.content).toContain('函数讲义')
    expect(out.content).toContain('https://example.com/x')
  })
})
