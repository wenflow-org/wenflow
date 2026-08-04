const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { goalProfileInference } from '../goal-profile-inference'

const INPUT = {
  understanding: {
    real_problem: '没有真实项目反馈，学了不知道会不会用',
    surface_goal: '想学 Python',
    background_experience: ['写过 Excel 公式', '跟过网课'],
    motivation: '转岗需要',
    background: { available_time: '每周 5 小时', current_level: '零基础' },
  },
}

/** 与 prompts/skill.goal-profile-inference.md 输出规格一致的 5 个 canonical 字段。 */
const PROMPT_ALIGNED_LLM_OUTPUT = {
  goalNarrative: '缺少真实项目反馈导致学习动力难以持续。',
  backgroundContextNote: '写过 Excel 公式；跟过网课但未完成项目。',
  motivationNarrative: '转岗需要，存在明确的外部时间压力。',
  timeConstraintNote: '可投入时间大致为每周 5 小时。',
  selfAssessmentNote: '当前自述水平为零基础，需要后续真实表现校正。',
}

describe('goalProfileInference', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('consumes exactly the 5 canonical fields declared in the prompt output spec', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput(PROMPT_ALIGNED_LLM_OUTPUT, INPUT),
      debug: {},
    }))

    const result = await goalProfileInference(INPUT)

    expect(result.success).toBe(true)
    expect(result.output).toEqual(PROMPT_ALIGNED_LLM_OUTPUT)
    expect(result.cached).not.toBe(true)
    expect(result.quality).toBe('model')
  })

  it('falls back per-field when the model drifts to the retired narrative keys', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({
        goalNarrative: '保留有效字段',
        backgroundNarrative: '旧字段不应穿透',
        baselineNarrative: '旧字段不应穿透',
        learningContextNarrative: '旧字段不应穿透',
      }, INPUT),
      debug: {},
    }))

    const result = await goalProfileInference(INPUT)

    expect(result.success).toBe(true)
    expect(result.output.goalNarrative).toBe('保留有效字段')
    expect(JSON.stringify(result.output)).not.toContain('旧字段不应穿透')
    expect(result.output.backgroundContextNote).toContain('写过 Excel 公式')
    expect(result.output.timeConstraintNote).toContain('每周 5 小时')
    expect(result.output.selfAssessmentNote).toContain('零基础')
  })

  it('returns the deterministic fallback with cached marker when the LLM chain fails', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'GOAL_PROFILE_INFERENCE_FAILED', message: 'boom' },
      debug: {},
    })

    const result = await goalProfileInference(INPUT)

    expect(result.success).toBe(true)
    expect(result.cached).toBe(true)
    expect(result.quality).toBe('fallback')
    expect(result.output.goalNarrative).toContain('真实项目反馈')
  })
})
