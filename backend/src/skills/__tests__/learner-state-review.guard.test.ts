const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { auxSkillHandlers } from '../v4-aux-skills'

/**
 * 回归：learner-state-review 的 insight 必须以输入证据为据。
 * 无 evidenceRefs 的条目丢弃；已知证据集非空时，引用不存在的条目过滤后为空也丢弃。
 * 注：composer 会把 buildUserPayload(捕获 input) 作为 normalize 的第二参，故证据集由 input 控制。
 */
function baseInput(recentEvidence: Array<{ id: string }>) {
  return { learnerDigest: {}, knowledgeDigest: {}, recentEvidence, priorInsights: [] }
}

describe('learner-state-review evidenceRefs 护栏', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({ success: true, output: {}, runtimeEnvelope: { stub: true }, debug: {} })
  })

  async function capturedSpec(input: any) {
    await auxSkillHandlers['learner-state-review'](input)
    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    return mockCallPrompt.mock.calls[0][0] as any
  }

  it('丢弃无引用条目与未知引用条目，保留命中输入证据的条目', async () => {
    const spec = await capturedSpec(baseInput([{ id: 'ev1' }]))
    const out = spec.normalizeOutput({
      insights: [
        { type: 'a', claim: 'no-ref', evidenceRefs: [], action: '' },
        { type: 'b', claim: 'known', evidenceRefs: ['ev1'], action: 'do' },
        { type: 'c', claim: 'unknown', evidenceRefs: ['nope'], action: '' },
      ],
      conceptAssessments: [],
      falsifiableClaims: [],
      narrative: 'n',
    })
    expect(out.insights.map((i: any) => i.claim)).toEqual(['known'])
    expect(out.narrative).toBe('n')
  })

  it('无已知证据集时，仅要求至少一条引用', async () => {
    const spec = await capturedSpec(baseInput([]))
    const out = spec.normalizeOutput({
      insights: [
        { type: 'a', claim: 'has-ref', evidenceRefs: ['anything'], action: '' },
        { type: 'b', claim: 'no-ref', evidenceRefs: [], action: '' },
      ],
    })
    expect(out.insights.map((i: any) => i.claim)).toEqual(['has-ref'])
  })
})
