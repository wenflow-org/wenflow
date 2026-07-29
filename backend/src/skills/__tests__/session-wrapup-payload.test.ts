const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))
jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({}),
}))

import { sessionWrapupAgent } from '../session-wrapup'

const MINIMAL_INPUT = {
  messages: [
    { role: 'user', content: '闭包是什么？' },
    { role: 'assistant', content: '先看词法作用域。' },
    { role: 'user', content: '懂了，是能记住外层变量。' },
  ],
  knowledgePoints: [
    { name: '闭包', status: 'learning', progress: 50 },
    { name: '词法作用域', status: 'mastered', progress: 90 },
  ],
  sessionInfo: {
    subject: 'JavaScript',
    topic: '闭包',
    durationMinutes: 25,
    userMessageCount: 2,
    assistantMessageCount: 1,
    taskType: 'concept-explanation',
    taskTitle: '理解闭包',
    pathTitle: 'JS 进阶',
  },
  sessionStructure: {
    endReason: 'task-completed',
    stageHistory: [{ stage: 'teaching', at: 't0' }],
    classroomEventHistory: [{ type: 'checkpoint' }],
  },
  knowledgeContext: { delta: { newlyMastered: ['词法作用域'], stillLearning: ['闭包'] } },
  sessionEvidence: { turnCount: 3, avgUnderstanding: 0.7, avgEngagement: 0.8, topConfusionPoints: ['变量生命周期'] },
  learningState: { lss: 5, ktl: 6, lf: 4, lsb: 5 },
}

describe('session-wrapup payload snapshot parity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockImplementation((spec: any) => {
      if (spec?.agentId === 'skill:session-evaluation-fallback') {
        return Promise.resolve({
          success: true,
          output: { sessionLss: 5, sessionKtl: 6, sessionLf: 4, confidence: 0.7, reasoning: 'ok' },
          debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
        })
      }
      return Promise.resolve({
        success: false,
        error: { code: 'SESSION_WRAPUP_FAILED', message: 'force fallback path' },
        debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
      })
    })
  })

  it('payload carries the tagged sections the prompt input spec declares', async () => {
    await sessionWrapupAgent.generate(MINIMAL_INPUT as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(2)
    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(MINIMAL_INPUT, {})

    expect(payload).toContain('【学科】JavaScript')
    expect(payload).toContain('【主题】闭包')
    expect(payload).toContain('【时长】25 分钟')
    expect(payload).toContain('【任务类型】concept-explanation')
    expect(payload).toContain('【路径标题】JS 进阶')
    expect(payload).toContain('【结束原因】task-completed')
    expect(payload).toContain('【知识点状态】')
    expect(payload).toContain('【知识点变化】')
    expect(payload).toContain('【学习状态】')
    expect(payload).toContain('【课堂证据】')
    expect(payload).toContain('【最近对话片段】')
    expect(payload).toContain('请同时输出 summary 与 evaluation')
    expect(payload).toMatchSnapshot()
  })

  it('transcript numbers messages and maps roles to 学生/教师', async () => {
    await sessionWrapupAgent.generate(MINIMAL_INPUT as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(MINIMAL_INPUT, {})

    expect(payload).toContain('1. 学生: 闭包是什么？')
    expect(payload).toContain('2. 教师: 先看词法作用域。')
    expect(payload).toContain('3. 学生: 懂了，是能记住外层变量。')
  })

  it('missing learningState renders as 无', async () => {
    const input = { ...MINIMAL_INPUT }
    delete (input as any).learningState
    await sessionWrapupAgent.generate(input as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})

    expect(payload).toContain('【学习状态】无')
  })
})
