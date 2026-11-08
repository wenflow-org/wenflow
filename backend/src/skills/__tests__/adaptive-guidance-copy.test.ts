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

/**
 * #187 视图口径：同一个 skill 服务两个视图，**各按传入的 view 生成**。
 *
 * 修前的形状是「唯一模型调用硬编码 view='dashboard'」——learning-state 页拿到 dashboard 口径的
 * 文案（问候式 headline + 指回本页的「查看学习状态」自指深链）。这里钉住两件事：
 * ① 调用方的 view 真的进入模型载荷；② learning-state 视图的输出里不出现自指深链。
 */
describe('adaptiveGuidanceCopy · 视图口径（#187）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const LS_INPUT = { ...INPUT, view: 'learning-state' as const }
  const SELF_LINK_ACTIONS = [
    { title: '查看学习状态', desc: '看看当前节奏和负荷。', action: '查看状态', to: 'learning-state' },
    { title: '继续学习', desc: '状态稳定就继续完成当前最小任务。', action: '继续', to: 'continue-learning' },
  ]

  it('把调用方的 view 透传给模型载荷（learning-state 不再被写成 dashboard）', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => {
      const payload = JSON.parse(spec.buildUserPayload(LS_INPUT, {}))
      expect(payload.view).toBe('learning-state')
      return {
        success: true,
        output: spec.normalizeOutput(PROMPT_ALIGNED_LLM_OUTPUT, LS_INPUT),
        debug: {},
      }
    })

    const result = await adaptiveGuidanceCopy(LS_INPUT)

    expect(result.success).toBe(true)
    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
  })

  it('learning-state：裁掉指向本页自身的 todayActions（自指深链）', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({ ...PROMPT_ALIGNED_LLM_OUTPUT, todayActions: SELF_LINK_ACTIONS }, LS_INPUT),
      debug: {},
    }))

    const result = await adaptiveGuidanceCopy(LS_INPUT)

    expect(result.output.todayActions.map((item) => item.to)).toEqual(['continue-learning'])
  })

  it('learning-state：模型只给自指动作时，回落本视图兜底动作（不把列表裁成空）', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({
        ...PROMPT_ALIGNED_LLM_OUTPUT,
        todayActions: [SELF_LINK_ACTIONS[0]],
      }, LS_INPUT),
      debug: {},
    }))

    const result = await adaptiveGuidanceCopy(LS_INPUT)

    expect(result.output.todayActions.length).toBeGreaterThan(0)
    expect(result.output.todayActions.every((item) => item.to !== 'learning-state')).toBe(true)
  })

  it('dashboard：to=learning-state 的「查看学习状态」是合法动作，不受 learning-state 过滤影响', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({ ...PROMPT_ALIGNED_LLM_OUTPUT, todayActions: SELF_LINK_ACTIONS }, INPUT),
      debug: {},
    }))

    const result = await adaptiveGuidanceCopy(INPUT)

    expect(result.output.todayActions.map((item) => item.to)).toEqual(['learning-state', 'continue-learning'])
  })
})
