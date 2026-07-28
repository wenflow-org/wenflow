const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { dialogueConceptExtractor } from '../dialogue-concept-extractor'

const INPUT = {
  visibleDialogueContext: [
    { role: 'learner', content: '闭包这里我还是不懂，为什么变量没被回收？' },
    { role: 'teacher', content: '我们再看一次词法作用域。' },
    { role: 'learner', content: '又是闭包，我还是卡住。' },
  ],
  currentKnowledgeState: [
    { name: 'closure', status: 'review', progress: 40 },
    { name: 'scope', status: 'mastered', progress: 85 },
  ],
}

/** 与 prompts/skill.dialogue-concept-extractor.md 输出规格一致的元素 schema。 */
const PROMPT_ALIGNED_LLM_OUTPUT = {
  recurringConfusions: [
    { conceptKey: 'closure', label: '闭包', pattern: '两轮对话中均对变量生命周期表现困惑', confidence: 0.8, count: 2 },
  ],
  transferSignals: [
    { conceptKey: 'scope', label: '词法作用域', readiness: 'high', confidence: 0.75 },
  ],
}

describe('dialogueConceptExtractor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes through elements carrying the canonical conceptKey schema', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput(PROMPT_ALIGNED_LLM_OUTPUT, INPUT),
      debug: {},
    }))

    const result = await dialogueConceptExtractor(INPUT)

    expect(result.success).toBe(true)
    expect(result.output).toEqual(PROMPT_ALIGNED_LLM_OUTPUT)
    expect(result.cached).not.toBe(true)
    expect(result.quality).toBe('model')
  })

  it('falls back to knowledge-state-derived output when the model returns empty arrays', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({ recurringConfusions: [], transferSignals: [] }, INPUT),
      debug: {},
    }))

    const result = await dialogueConceptExtractor(INPUT)

    expect(result.success).toBe(true)
    expect(result.output.recurringConfusions).toEqual([
      expect.objectContaining({ conceptKey: 'closure', count: 1 }),
    ])
    expect(result.output.transferSignals).toEqual([
      expect.objectContaining({ conceptKey: 'scope', readiness: 'high' }),
    ])
  })

  it('rescues conceptKey from label and evidence into pattern at the skill boundary', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({
        recurringConfusions: [
          { label: '闭包', evidence: '两轮对话均表现困惑', confidence: 1.7, count: 2.6 },
        ],
        transferSignals: [
          { label: '词法作用域', readiness: 'very-high', confidence: 'bad' },
        ],
      }, INPUT),
      debug: {},
    }))

    const result = await dialogueConceptExtractor(INPUT)

    expect(result.success).toBe(true)
    expect(result.output.recurringConfusions).toEqual([
      { conceptKey: '闭包', label: '闭包', pattern: '两轮对话均表现困惑', confidence: 1, count: 3 },
    ])
    expect(result.output.transferSignals).toEqual([
      { conceptKey: '词法作用域', label: '词法作用域', readiness: 'low', confidence: 0.5 },
    ])
  })

  it('drops keyless elements instead of letting them die silently downstream', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => ({
      success: true,
      output: spec.normalizeOutput({
        recurringConfusions: [{ concept: '闭包', evidence: '旧 schema 无键' }],
        transferSignals: [{ concept: '作用域', evidence: '旧 schema 无键' }],
      }, INPUT),
      debug: {},
    }))

    const result = await dialogueConceptExtractor(INPUT)

    expect(result.success).toBe(true)
    // 全部元素无 conceptKey/label → 丢弃后走空数组 fallback，而不是把脏元素推给下游
    expect(result.output.recurringConfusions).toEqual([
      expect.objectContaining({ conceptKey: 'closure' }),
    ])
    expect(result.output.transferSignals).toEqual([
      expect.objectContaining({ conceptKey: 'scope' }),
    ])
    expect(JSON.stringify(result.output)).not.toContain('旧 schema 无键')
  })

  it('returns the deterministic fallback with cached marker when the LLM chain fails', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'DIALOGUE_CONCEPT_EXTRACTOR_FAILED', message: 'boom' },
      debug: {},
    })

    const result = await dialogueConceptExtractor(INPUT)

    expect(result.success).toBe(true)
    expect(result.cached).toBe(true)
    expect(result.quality).toBe('fallback')
    expect(result.output.recurringConfusions[0].conceptKey).toBe('closure')
  })
})
