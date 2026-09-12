const findUnique = jest.fn()
const update = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { users: { findUnique, update } },
}))
jest.mock('../../../skills', () => ({ executeSkillWithResult: jest.fn() }))
jest.mock('../../../skills/adaptive-guidance-copy', () => ({
  adaptiveGuidanceCopyDefinition: { name: 'adaptive-guidance-copy' },
}))
jest.mock('../assemble-learning-state', () => ({ assembleLearningState: jest.fn() }))
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
})
