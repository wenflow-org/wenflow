const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { peerAgent } from '../peer-reinforcement'

const MINIMAL_INPUT = {
  topic: '闭包与变量生命周期',
  strategy: 'feynman' as const,
  studentMessage: '我觉得闭包就是函数套函数',
  tutorContext: [
    { role: 'user', content: '闭包是什么？' },
    { role: 'assistant', content: '先看词法作用域。' },
  ],
  cognitiveLevel: 'understand',
  understanding: 0.6,
}

const SUCCESS_RESULT = {
  success: true,
  output: { message: '那你能给我讲讲，为什么这个变量没被回收吗？', followUpQuestions: ['它引用了谁？'] },
  runtimeEnvelope: { stub: true },
  debug: { attempts: [{ attempt: 1, status: 'success' }] },
}

describe('peer-reinforcement payload snapshot parity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT)
  })

  it('payload carries the tagged sections the prompt input spec declares', async () => {
    await peerAgent.discuss(MINIMAL_INPUT as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(MINIMAL_INPUT, {})

    expect(payload).toContain('请生成一段同伴讨论消息：')
    expect(payload).toContain('【主题】闭包与变量生命周期')
    expect(payload).toContain('【策略】feynman')
    expect(payload).toContain('【策略要求】')
    expect(payload).toContain('【学生认知层级】understand')
    expect(payload).toContain('【理解度】0.6')
    expect(payload).toContain('【最近对话】')
    expect(payload).toContain('【学生消息】我觉得闭包就是函数套函数')
    expect(payload).toMatchSnapshot()
  })

  it('optional sections disappear when the inputs are absent', async () => {
    await peerAgent.discuss({
      topic: '闭包',
      strategy: 'debate' as const,
      tutorContext: [],
    } as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload({ topic: '闭包', strategy: 'debate', tutorContext: [] }, {})

    expect(payload).not.toContain('【理解度】')
    expect(payload).not.toContain('【最近对话】')
    expect(payload).not.toContain('【学生消息】')
    expect(payload).toContain('【学生认知层级】understand')
  })

  it('strategy instruction follows the selected strategy', async () => {
    await peerAgent.discuss({ topic: '闭包', strategy: 'counterexample', tutorContext: [] } as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload({ topic: '闭包', strategy: 'counterexample', tutorContext: [] }, {})

    expect(payload).toContain('【策略】counterexample')
    expect(payload).toContain('反例')
  })
})
