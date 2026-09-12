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
jest.mock('../LearningDecisionFeedService', () => ({
  learningDecisionFeedService: { build: jest.fn(() => []) },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { executeSkillWithResult } from '../../../skills'
import { assembleLearningState } from '../assemble-learning-state'
import learningStateGuidanceService from '../LearningStateGuidanceService'

describe('LearningStateGuidanceService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(assembleLearningState as jest.Mock).mockResolvedValue({
      paths: [],
      sessions: [],
      primaryPath: { id: 'lp1' },
      learnerSnapshot: {},
      learningState: {},
      warnings: [],
      sessionWrapup: null,
    })
    ;(executeSkillWithResult as jest.Mock).mockResolvedValue({
      success: true,
      output: { headline: 'H', subtitle: 's' },
      quality: 'fallback',
      debug: { durationMs: 3 },
      duration: 3,
    })
  })

  it('把 skill 输出写入 copy，并按 quality 映射 source（回归防护）', async () => {
    const payload = await learningStateGuidanceService.refresh('u1')

    expect(executeSkillWithResult).toHaveBeenCalledTimes(1)
    expect(payload?.copy).toEqual({ headline: 'H', subtitle: 's' })
    expect(payload?.source).toBe('fallback')
    expect(payload?.review).toBeNull()
  })
})
