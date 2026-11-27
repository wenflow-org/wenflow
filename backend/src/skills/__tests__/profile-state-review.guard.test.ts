const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { auxSkillHandlers } from '../v4-aux-skills'

/**
 * 回归：profile-state-review 的 insight 必须以输入证据为据。
 * 无 evidenceRefs 的条目丢弃；已知证据集非空时，引用不存在的条目过滤后为空也丢弃。
 * 注：composer 会把 buildUserPayload(捕获 input) 作为 normalize 的第二参，故证据集由 input 控制。
 */
function baseInput(recentEvidence: Array<{ id: string }>) {
  return { learnerDigest: {}, knowledgeDigest: {}, recentEvidence, priorInsights: [] }
}

describe('profile-state-review evidenceRefs 护栏', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({ success: true, output: {}, runtimeEnvelope: { stub: true }, debug: {} })
  })

  async function capturedSpec(input: any) {
    await auxSkillHandlers['profile-state-review'](input)
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

  it('掌握度只接收有效枚举和可回指的证据，保留同批负证据', async () => {
    const spec = await capturedSpec(baseInput([{ id: 'ev1' }]))
    const out = spec.normalizeOutput({
      conceptAssessments: [
        { conceptKey: 'malformed', observed: '未掌握', evidenceRefs: ['ev1'] },
        { conceptKey: 'missing', evidenceRefs: ['ev1'] },
        { conceptKey: 'invented', observed: 'mastered', evidenceRefs: ['missing'] },
        { conceptKey: 'negative', observed: 'not', evidenceRefs: ['ev1', 'missing', 'ev1'] },
        { conceptKey: 'positive', observed: 'mastered', evidenceRefs: ['ev1'] },
      ],
    })
    expect(out.conceptAssessments).toEqual([
      expect.objectContaining({ conceptKey: 'negative', observed: 'not', evidenceRefs: ['ev1'] }),
      expect.objectContaining({ conceptKey: 'positive', observed: 'mastered', evidenceRefs: ['ev1'] }),
    ])
  })

  it('无已知证据集时，伪造的 evidenceRefs 一律拦掉', async () => {
    const spec = await capturedSpec(baseInput([]))
    const out = spec.normalizeOutput({
      insights: [
        { type: 'a', claim: 'has-ref', evidenceRefs: ['anything'], action: '' },
        { type: 'b', claim: 'no-ref', evidenceRefs: [], action: '' },
      ],
    })
    expect(out.insights).toEqual([])
  })
})
