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
      return Promise.resolve({
        success: false,
        error: { code: 'SESSION_WRAPUP_FAILED', message: 'force failure path' },
        debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
      })
    })
  })

  it('payload carries the tagged sections the prompt input spec declares', async () => {
    await sessionWrapupAgent.generate(MINIMAL_INPUT as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
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

describe('session-wrapup 纯重试+明确失败：evaluation 缺失形态', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('主调用失败（重试耗尽）→ summary 降级 + evaluation=null + evaluationSource=unavailable，不再调补全 skill', async () => {
    mockCallPrompt.mockImplementation(() => Promise.resolve({
      success: false,
      error: { code: 'SESSION_WRAPUP_FAILED', message: 'force failure path' },
      debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
    }))

    const result = await sessionWrapupAgent.generate(MINIMAL_INPUT as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    expect(result.summarySource).toBe('fallback')
    expect(result.evaluation).toBeNull()
    expect(result.evaluationSource).toBe('unavailable')
  })

  it('主调用成功但缺 evaluation → summary 保留 + evaluation=null + evaluationSource=unavailable', async () => {
    const validSummary = {
      topicSummary: '本节课围绕"闭包"进行了学习。',
      knowledgeSummary: '本节共涉及2个知识点。',
      practiceAdvice: '复盘本节课核心概念。',
      learningEvaluation: '建议根据当前掌握情况继续推进。',
      knowledgeItems: [
        { name: '闭包', status: 'learning', progress: 50, evidence: '继续练习' },
        { name: '词法作用域', status: 'mastered', progress: 90, evidence: '表达和应用较稳' },
      ],
      keyTakeaways: ['完成本节学习回顾'],
      actionPlan: ['继续完成下一步练习'],
      evaluationHighlights: { strengths: ['有知识点推进证据'], improvements: ['继续巩固'] },
      metricInterpretation: { session: '本节课总结已生成。', longTerm: '长期指标需后续观察。' },
      summaryVersion: 'v2',
    }
    mockCallPrompt.mockImplementation(() => Promise.resolve({
      success: true,
      output: { summary: validSummary },
      debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
    }))

    const result = await sessionWrapupAgent.generate(MINIMAL_INPUT as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    expect(result.summarySource).toBe('model')
    expect(result.summary.topicSummary).toContain('闭包')
    expect(result.evaluation).toBeNull()
    expect(result.evaluationSource).toBe('unavailable')
  })
})
