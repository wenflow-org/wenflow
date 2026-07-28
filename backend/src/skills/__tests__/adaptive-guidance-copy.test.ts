const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { adaptiveGuidanceCopy } from '../adaptive-guidance-copy'

const INPUT = {
  view: 'dashboard' as const,
  learnerSnapshot: { profile: { name: '小明' }, dynamicState: { recentTrend: 'stable', recommendedPacing: 'moderate' } },
  learningState: { weeklyMinutes: 80 },
  path: { title: 'Python 入门' },
  sessionWrapup: { summary: '完成了日期格式章节' },
  advisory: { focus: '继续推进' },
}

/** 与 prompts/skill.adaptive-guidance-copy.md 输出规格一致的元素 schema。 */
const PROMPT_ALIGNED_LLM_OUTPUT = {
  headline: '欢迎回来，小明',
  subtitle: '从上次停下的位置接上学习。',
  todayActions: [
    { title: '继续上次学习', desc: '从日期格式变体继续推进。', action: '继续', to: 'continue-learning' },
    { title: '查看当前节奏', desc: '本周已学 80 分钟，节奏稳定。', action: '查看状态', to: 'learning-state' },
    { title: '回顾最近成就', desc: '已解锁 2 个里程碑徽章。', action: '去看看', to: 'achievements' },
  ],
  pathHint: '当前围绕「Python 入门」推进。',
  nextStep: '继续沿着当前焦点往前走。',
  paceHint: '当前节奏正常，可以继续推进。',
  emptyStateCopy: '先从一个具体目标开始。',
  warningCopy: '当前没有明显风险。',
}

describe('adaptiveGuidanceCopy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends the canonical payload keys the prompt input spec declares', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => {
      const payload = JSON.parse(spec.buildUserPayload(INPUT, {}))
      expect(Object.keys(payload).sort()).toEqual(['advisory', 'learner', 'learningState', 'path', 'view', 'wrapup'])
      expect(payload.view).toBe('dashboard')
      return { success: true, output: spec.normalizeOutput(PROMPT_ALIGNED_LLM_OUTPUT, INPUT), debug: {} }
    })

    const result = await adaptiveGuidanceCopy(INPUT)
    expect(result.success).toBe(true)
  })

  it('consumes exactly the todayActions element schema declared in the prompt', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput(PROMPT_ALIGNED_LLM_OUTPUT, INPUT),
      debug: {},
    }))

    const result = await adaptiveGuidanceCopy(INPUT)

    expect(result.success).toBe(true)
    expect(result.output).toEqual(PROMPT_ALIGNED_LLM_OUTPUT)
    expect(result.cached).not.toBe(true)
    expect(result.quality).toBe('model')
  })

  it('applies per-item defaults when the model drifts to the retired label-only schema', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({
        ...PROMPT_ALIGNED_LLM_OUTPUT,
        todayActions: [{ label: '旧字段行动', to: 'learning-state' }],
      }, INPUT),
      debug: {},
    }))

    const result = await adaptiveGuidanceCopy(INPUT)

    expect(result.success).toBe(true)
    expect(result.output.todayActions).toEqual([
      { title: '继续学习', desc: '', action: '继续', to: 'learning-state' },
    ])
  })

  it('returns the deterministic fallback with cached marker when the LLM chain fails', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'ADAPTIVE_GUIDANCE_COPY_FAILED', message: 'boom' },
      debug: {},
    })

    const result = await adaptiveGuidanceCopy(INPUT)

    expect(result.success).toBe(true)
    expect(result.cached).toBe(true)
    expect(result.quality).toBe('fallback')
    expect(result.output?.headline).toBe('欢迎回来，小明')
  })
})
