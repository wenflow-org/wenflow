const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { learningPatternDistiller } from '../learning-pattern-distiller'

const INPUT = {
  learnerSnapshot: {
    profile: {
      preferences: { theoryVsPractice: 'practice-first' },
      emotional: { confidenceLevel: 'steady' },
    },
    dynamicState: { recommendedPacing: 'moderate' },
  },
}

/** 与 prompts/skill.learning-pattern-distiller.md 输出规格一致的 6 个 canonical 字段。 */
const PROMPT_ALIGNED_LLM_OUTPUT = {
  contentReceptionPattern: '从具体例子归纳规律更轻松。',
  practicePreferenceNote: '先做小任务再回头讲原理。',
  frictionPatternNote: '单次新概念超过两个时理解质量下降。',
  effectiveTeachingPattern: '任务切入 -> 小步讲解 -> 立刻验证。',
  supportStyleNote: '正常强度引导，每次聚焦一个关键问题。',
  taskGranularityNote: '任务保持中等粒度，每次一个核心认知目标。',
}

describe('learningPatternDistiller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('consumes exactly the 6 canonical fields declared in the prompt output spec', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput(PROMPT_ALIGNED_LLM_OUTPUT, INPUT),
      debug: {},
    }))

    const result = await learningPatternDistiller(INPUT)

    expect(result.success).toBe(true)
    expect(result.output).toEqual(PROMPT_ALIGNED_LLM_OUTPUT)
    expect(result.cached).not.toBe(true)
    expect(result.quality).toBe('model')
  })

  it('falls back per-field when the model drifts to the retired narrative keys', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({
        learningPreferenceNarrative: '旧字段不应穿透',
        teachingModeNarrative: '旧字段不应穿透',
      }, INPUT),
      debug: {},
    }))

    const result = await learningPatternDistiller(INPUT)

    expect(result.success).toBe(true)
    expect(JSON.stringify(result.output)).not.toContain('旧字段不应穿透')
    expect(result.output.contentReceptionPattern).toBeTruthy()
    expect(result.output.taskGranularityNote).toBeTruthy()
  })

  it('returns the deterministic fallback with cached marker when the LLM chain fails', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'LEARNING_PATTERN_DISTILLER_FAILED', message: 'boom' },
      debug: {},
    })

    const result = await learningPatternDistiller(INPUT)

    expect(result.success).toBe(true)
    expect(result.cached).toBe(true)
    expect(result.quality).toBe('fallback')
    expect(result.output.contentReceptionPattern).toContain('边学边做')
  })
})
