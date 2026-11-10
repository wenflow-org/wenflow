const findUnique = jest.fn()
const update = jest.fn()
const findMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { users: { findUnique, update, findMany } },
}))
jest.mock('../../../skills', () => ({ executeSkillWithResult: jest.fn() }))
jest.mock('../../../skills/adaptive-guidance-copy', () => ({
  adaptiveGuidanceCopyDefinition: { name: 'adaptive-guidance-copy' },
}))
jest.mock('../assemble-learning-state', () => ({ assembleLearningState: jest.fn() }))
jest.mock('../LearnerStateReviewService', () => ({
  learnerStateReviewService: { getLatest: jest.fn(async () => null) },
}))
jest.mock('../LearnerStateSummaryService', () => ({
  learnerStateSummaryService: { build: jest.fn(() => ({ state: 'ok' })) },
}))
jest.mock('../LearnerSnapshotRefreshService', () => ({ learnerSnapshotRefreshService: {} }))
jest.mock('../../learning/learning-state.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../background-task-tracker.service', () => ({ runBackgroundTask: jest.fn() }))
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { executeSkillWithResult } from '../../../skills'
import { assembleLearningState } from '../assemble-learning-state'
import { learnerStateReviewService } from '../LearnerStateReviewService'
import dashboardGuidanceSnapshotService from '../DashboardGuidanceSnapshotService'

const COPY = {
  headline: '评审标题',
  subtitle: 's',
  todayActions: [],
  pathHint: 'p',
  nextStep: 'n',
  paceHint: 'c',
  emptyStateCopy: 'e',
  warningCopy: 'w',
}

describe('DashboardGuidanceSnapshotService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(assembleLearningState as jest.Mock).mockResolvedValue({
      primaryPath: { id: 'lp1', title: 'T', aiPromptTemplate: 'X'.repeat(5000) },
      learnerSnapshot: {
        freshness: { basedOn: {} },
        dynamicState: { metrics: { lss: 4, ktl: 5, lf: 3, lsb: 1 }, recentTrend: 'stable' },
        knowledgeMemory: {
          globalSignals: { masteredConcepts: ['m1'], fragileConcepts: [], strugglingConcepts: [] },
          globalBackground: { reusableFoundations: [], blockedFoundations: [], conceptLedger: [], recurringConfusions: [], transferSignals: [] },
          currentPath: { learningPathId: 'lp1', pathTitle: 'T', progress: {}, currentPosition: {}, prerequisiteGaps: [], taskMastery: [{ taskId: 't1' }], conceptStates: [], recentEvidence: [] },
        },
      },
      learningState: {},
      sessionWrapup: null,
      advisory: null,
      warnings: [],
    })
    ;(executeSkillWithResult as jest.Mock).mockResolvedValue({
      success: true,
      output: COPY,
      quality: 'model',
      debug: { durationMs: 12, model: 'm' },
      duration: 12,
    })
    update.mockResolvedValue({})
  })

  it('把 skill 输出写入快照 copy（回归：executeSkill 拆包曾导致 copy 丢失）', async () => {
    const payload = await dashboardGuidanceSnapshotService.refresh('u1', 'task-completed')

    expect(executeSkillWithResult).toHaveBeenCalledTimes(1)
    expect(payload?.copy).toEqual(COPY)

    const saved = JSON.parse(update.mock.calls.at(-1)![0].data.dashboardGuidanceSnapshot)
    expect(saved.copy).toEqual(COPY)
    expect(saved.source).toBe('model')
    expect(saved.trigger).toBe('task-completed')
    expect(saved.debug.durationMs).toBe(12)

    // 传给 skill 的必须是「投影」：不含 path.aiPromptTemplate，knowledgeMemory 明细已裁剪
    const skillInput = (executeSkillWithResult as jest.Mock).mock.calls.at(-1)![1]
    expect(skillInput.path).not.toHaveProperty('aiPromptTemplate')
    expect(skillInput.learnerSnapshot.knowledgeMemory.currentPath.taskMastery).toEqual([])
  })

  it('附带最近一次状态评审 review（诊断层闭环）', async () => {
    (learnerStateReviewService.getLatest as jest.Mock).mockResolvedValue({
      schemaVersion: 'learner-state-review-v1',
      source: 'model',
      diagnosis: { narrative: 'n', insights: [] },
    })
    await dashboardGuidanceSnapshotService.refresh('u1', 'task-completed')
    const saved = JSON.parse(update.mock.calls.at(-1)![0].data.dashboardGuidanceSnapshot)
    expect(saved.review.source).toBe('model')
    expect(saved.review.diagnosis.narrative).toBe('n')
  })

  // issue #196 复核：guidance 投影曾把 transferSignals 硬置空、无读取方。现 guidance 侧
  // （adaptive-guidance-copy）提示词规则读取 learner.knowledgeMemory.globalBackground.transferSignals，
  // 故该字段必须真的随投影送到 skill 输入——否则规则读到的永远是空数组（读取方名义存在、实际空转）。
  it('guidance 侧消费：transferSignals 随投影送入 adaptive-guidance-copy 输入', async () => {
    (assembleLearningState as jest.Mock).mockResolvedValue({
      primaryPath: { id: 'lp1', title: 'T' },
      learnerSnapshot: {
        freshness: { basedOn: {} },
        dynamicState: { metrics: { lss: 4, ktl: 5, lf: 3, lsb: 1 }, recentTrend: 'stable' },
        knowledgeMemory: {
          globalSignals: { masteredConcepts: ['m1'], fragileConcepts: [], strugglingConcepts: [] },
          globalBackground: {
            reusableFoundations: [], blockedFoundations: [], conceptLedger: [], recurringConfusions: [],
            transferSignals: [{ conceptKey: 't1', label: 'T1', readiness: 'high', confidence: 0.8 }],
          },
          currentPath: { learningPathId: 'lp1', pathTitle: 'T', progress: {}, currentPosition: {}, prerequisiteGaps: [], taskMastery: [], conceptStates: [], recentEvidence: [] },
        },
      },
      learningState: {},
      sessionWrapup: null,
      advisory: null,
      warnings: [],
    })

    await dashboardGuidanceSnapshotService.refresh('u1', 'task-completed')
    const skillInput = (executeSkillWithResult as jest.Mock).mock.calls.at(-1)![1]
    expect(skillInput.learnerSnapshot.knowledgeMemory.globalBackground.transferSignals).toEqual([
      { conceptKey: 't1', label: 'T1', readiness: 'high', confidence: 0.8 },
    ])
  })

  /**
   * #186：回填任务此前只按 deletedAt/snapshot 缺失/有 active 路径筛人，**没有 VL 过滤**——
   * 实测 228 个虚拟学习者被纳入回填，每个都会跑一次 refresh 并触发真实 LLM 调用（凭空烧钱）。
   * 本用例让 findMany 按 where 里的 isVirtualLearner 谓词过滤（模拟 Prisma 下推），
   * 修复前 where 无该谓词 ⇒ VL 也会被 refresh。
   */
  describe('backfillMissingForActiveUsers · 虚拟学习者不进回填（#186）', () => {
    beforeEach(() => {
      findMany.mockImplementation(async (args: any) =>
        [
          { id: 'virtual_1', isVirtualLearner: true },
          { id: 'u-real', isVirtualLearner: false },
        ]
          .filter((row) => (args?.where?.isVirtualLearner === false ? !row.isVirtualLearner : true))
          .map((row) => ({ id: row.id }))
      )
    })

    it('回填查询带上非虚拟口径（VL 不再触发 LLM 调用）', async () => {
      const result = await dashboardGuidanceSnapshotService.backfillMissingForActiveUsers(50)

      const where = findMany.mock.calls[0][0].where
      expect(where.isVirtualLearner).toBe(false)
      expect(where.deletedAt).toBeNull()
      expect(where.dashboardGuidanceSnapshot).toBeNull()
      expect(where.learning_paths).toEqual({ some: { status: 'active' } })
      expect(findMany.mock.calls[0][0].take).toBe(50)

      // 行为面：只有真实用户被 refresh；VL 不产生 skill 调用
      expect(result).toEqual({ total: 1, refreshed: 1 })
      expect(executeSkillWithResult).toHaveBeenCalledTimes(1)
      expect((executeSkillWithResult as jest.Mock).mock.calls[0][1].userId).toBe('u-real')
    })
  })
})
