const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { auxSkillHandlers } from '../v4-aux-skills'

/**
 * 回归：模型有时把 teaching-opening-generator 的 quickReplies 写成 string[]
 * （core 声明为 object[]），此前会在 core fields 契约校验处整轮失败
 * （fields contract violation: quickReplies(type-mismatch:object[])）。
 * 现由 coerceParsedForContract 在校验前把等价变体收敛为 [{ text }]。
 */
describe('teaching-opening-generator quickReplies 契约容错', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: { message: '开场', question: '', quickReplies: [], mode: 'example-first' },
      runtimeEnvelope: { stub: true },
      debug: { attempts: [{ attempt: 1, status: 'success' }] },
    })
  })

  async function capturedSpec() {
    await auxSkillHandlers['teaching-opening-generator']({ subject: 's', topic: 't', openingMode: 'example-first' })
    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    return mockCallPrompt.mock.calls[0][0] as any
  }

  it('coerceParsedForContract 把 string[] 收敛为 [{ text }]', async () => {
    const spec = await capturedSpec()
    expect(typeof spec.coerceParsedForContract).toBe('function')
    const coerced = spec.coerceParsedForContract({
      message: 'm',
      quickReplies: ['带我看一个例子', '我先试一小步'],
    })
    expect(coerced.quickReplies).toEqual([{ text: '带我看一个例子' }, { text: '我先试一小步' }])
  })

  it('coerceParsedForContract 同时兼容 { text } 形态并丢弃空项、截断到 3 个', async () => {
    const spec = await capturedSpec()
    const coerced = spec.coerceParsedForContract({
      quickReplies: [{ text: '  A  ' }, { text: '' }, 'B', 'C', 'D'],
    })
    expect(coerced.quickReplies).toEqual([{ text: 'A' }, { text: 'B' }, { text: 'C' }])
  })

  it('normalizeOutput 对 string[] 与 [{ text }] 都产出 [{ text }]', async () => {
    const spec = await capturedSpec()
    const fromStrings = spec.normalizeOutput({ message: 'm', quickReplies: ['甲', '乙'] }, { subject: 's', topic: 't', openingMode: 'example-first' })
    expect(fromStrings.quickReplies).toEqual([{ text: '甲' }, { text: '乙' }])
    const fromObjects = spec.normalizeOutput({ message: 'm', quickReplies: [{ text: '丙' }] }, { subject: 's', topic: 't', openingMode: 'example-first' })
    expect(fromObjects.quickReplies).toEqual([{ text: '丙' }])
  })
})
