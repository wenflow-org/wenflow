/**
 * 重生成锁快照（资料跟路径生成走，2026-11-21）：
 * extractPathMaterialIds 从路径模板的资料 pack 快照提取 materialId 集合，
 * buildStoredGoalPathRequest / buildGoalPathRequestFromConversation 把它作为显式挂载
 * 列表回传 path.coordinator——重试/重生成/重建不再重新扫库。
 */
import {
  buildStoredGoalPathRequest,
  buildGoalPathRequestFromConversation,
  extractPathMaterialIds,
  type RegenerablePath,
} from '../path-regeneration.service'

jest.mock('../../../coordinators/path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../learning-routes.repo', () => ({
  findGoalConversationForPathSummary: jest.fn(),
}))
jest.mock('../learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../goal-triage-evidence', () => ({
  assertExistingPathGoalTriageAllowed: jest.fn(async () => undefined),
}))

const UUID_A = '11111111-2222-3333-4444-555555555001'
const UUID_B = '11111111-2222-3333-4444-555555555002'

function packEntry(materialId: string) {
  return { pack: { materialId, name: '资料' }, status: 'ok' }
}

describe('extractPathMaterialIds', () => {
  it('从 sceneFraming.normalizedInput.resources.materials 提取（按出现顺序去重）', () => {
    const parsed = {
      sceneFraming: { normalizedInput: { resources: { materials: [packEntry(UUID_A), packEntry(UUID_B), packEntry(UUID_A)] } } },
    }
    expect(extractPathMaterialIds(parsed)).toEqual([UUID_A, UUID_B])
  })

  it('回落 normalizedInput / normalizedInputSnapshot', () => {
    expect(extractPathMaterialIds({ normalizedInput: { resources: { materials: [packEntry(UUID_A)] } } })).toEqual([UUID_A])
    expect(extractPathMaterialIds({ normalizedInputSnapshot: { resources: { materials: [packEntry(UUID_B)] } } })).toEqual([UUID_B])
  })

  it('无 pack / 空 / 损坏模板 → undefined（不携带字段，保持存量语义）', () => {
    expect(extractPathMaterialIds(null)).toBeUndefined()
    expect(extractPathMaterialIds({})).toBeUndefined()
    expect(extractPathMaterialIds({ sceneFraming: { normalizedInput: { resources: { materials: [] } } } })).toBeUndefined()
    expect(extractPathMaterialIds({ normalizedInput: { resources: { materials: [{ pack: {} }] } } })).toBeUndefined()
  })
})

const BASE_PATH: RegenerablePath = {
  id: 'lp_1',
  userId: 'u1',
  description: '目标',
  activeGenerationRunId: null,
}

describe('buildStoredGoalPathRequest 锁快照', () => {
  it('goalFinalPayload.materialIds（显式挂载随 GoalPathRequest 持久化）优先', () => {
    const path: RegenerablePath = {
      ...BASE_PATH,
      aiPromptTemplate: JSON.stringify({
        goalFinalPayload: { rawGoal: '目标', materialIds: [UUID_A] },
        sceneFraming: { normalizedInput: { resources: { materials: [packEntry(UUID_B)] } } },
      }),
    }
    const request = buildStoredGoalPathRequest(path)
    expect(request?.materialIds).toEqual([UUID_A])
  })

  it('goalFinalPayload 无 materialIds → 回落到 pack 快照（老路径重生成不再重扫库）', () => {
    const path: RegenerablePath = {
      ...BASE_PATH,
      aiPromptTemplate: JSON.stringify({
        goalFinalPayload: { rawGoal: '目标' },
        sceneFraming: { normalizedInput: { resources: { materials: [packEntry(UUID_B)] } } },
      }),
    }
    expect(buildStoredGoalPathRequest(path)?.materialIds).toEqual([UUID_B])
  })

  it('显式空数组必须原样保留（[] = 显式不挂载，重生成零注入，不得回退扫库）', () => {
    const path: RegenerablePath = {
      ...BASE_PATH,
      aiPromptTemplate: JSON.stringify({
        goalFinalPayload: { rawGoal: '目标', materialIds: [] },
      }),
    }
    expect(buildStoredGoalPathRequest(path)?.materialIds).toEqual([])
  })

  it('老模板零资料注入 → 不携带字段（存量自动语义）', () => {
    const path: RegenerablePath = {
      ...BASE_PATH,
      aiPromptTemplate: JSON.stringify({ goalFinalPayload: { rawGoal: '目标' } }),
    }
    expect(buildStoredGoalPathRequest(path)?.materialIds).toBeUndefined()
  })
})

describe('buildGoalPathRequestFromConversation 锁快照', () => {
  it('从路径模板 pack 快照提取资料集', async () => {
    const { findGoalConversationForPathSummary } = await import('../learning-routes.repo')
    ;(findGoalConversationForPathSummary as jest.Mock).mockResolvedValue({
      id: 'gc_1',
      userId: 'u1',
      description: '目标',
      collectedData: JSON.stringify({ messages: [], understanding: {} }),
    })
    const path: RegenerablePath = {
      ...BASE_PATH,
      aiPromptTemplate: JSON.stringify({
        sourceConversationId: 'gc_1',
        sceneFraming: { normalizedInput: { resources: { materials: [packEntry(UUID_A), packEntry(UUID_B)] } } },
      }),
    }
    const request = await buildGoalPathRequestFromConversation(path)
    expect(request?.materialIds).toEqual([UUID_A, UUID_B])
  })
})
