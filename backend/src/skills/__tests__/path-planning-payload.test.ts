const mockCallPrompt = jest.fn()
const mockGatewayExecute = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))
jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: mockGatewayExecute }),
}))

import { pathAgentHandler } from '../path-planning'

const FAKE_PATH = {
  id: 'path_1',
  name: 'Python 数据分析入门路径',
  milestones: [],
  totalMilestones: 0,
}

const SUCCESS_RESULT = {
  success: true,
  output: FAKE_PATH,
  runtimeEnvelope: { stub: true },
  debug: { attempts: [{ attempt: 1, status: 'success' }], rawModelOutput: '', extractedJson: null },
}

const BASE_INPUT = {
  goal: '零基础想学 Python 数据分析，用于财务工作',
  structuredData: {
    learner: { skill_level: 'beginner' },
    end_user: { pain_points: ['没做过项目'] },
    learning_context: {},
  },
  confirmedProposal: {
    learningDirection: '面向财务的数据分析入门',
    firstDeliverable: '一份财报数据分析',
    keyStages: ['表格基础', 'Python 数据处理', '财报实战'],
    outOfScope: ['机器学习'],
    learning_style: 'practice-first',
  },
  conversationHistory: [{ role: 'user', content: '我是做财务的' }],
  metadata: { availableTime: '每周 5 小时', totalWeeks: 8 },
}

describe('path-planning payload snapshot parity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT)
  })

  it('payload carries the tagged sections the prompt input spec declares', async () => {
    await pathAgentHandler(BASE_INPUT as any, { userId: 'user-1' } as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload({}, {})

    expect(payload).toContain('原始学习目标：零基础想学 Python 数据分析，用于财务工作')
    expect(payload).toContain('学习主题：')
    expect(payload).toContain('目标水平：beginner')
    expect(payload).toContain('可用时间：每周 5 小时')
    expect(payload).toContain('总学习周期（周）：8')
    expect(payload).toContain('用户确认的方案轮廓')
    expect(payload).toContain('学习方向：面向财务的数据分析入门')
    expect(payload).toContain('首个产出：一份财报数据分析')
    expect(payload).toContain('暂不纳入范围：机器学习')
    expect(payload).toContain('完整对话历史')
    expect(payload).toContain('【强制要求】')
    // 无重调、无清洗输入时不出现对应分区
    expect(payload).not.toContain('【路径重调模式】')
    expect(payload).not.toContain('路径前置清洗结果')
    expect(payload).toMatchSnapshot()
  })

  it('replan mode appends the replan projection section', async () => {
    await pathAgentHandler({
      ...BASE_INPUT,
      metadata: {
        ...BASE_INPUT.metadata,
        replan: {
          mode: 'new_version',
          triggerSource: 'fatigue',
          sourcePathId: 'path_old',
          freezeCompletedTaskIds: ['task-1'],
          learnerReplanProjection: { mastered: ['表格基础'] },
        },
      },
    } as any, { userId: 'user-1' } as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload({}, {})

    expect(payload).toContain('【路径重调模式】')
    expect(payload).toContain('触发来源：fatigue')
    expect(payload).toContain('冻结已完成任务：task-1')
    expect(payload).toContain('【学习者重调投影】')
    expect(payload).toContain('表格基础')
  })

  it('normalized input surfaces as the high-priority normalized JSON section', async () => {
    await pathAgentHandler({
      ...BASE_INPUT,
      metadata: {
        ...BASE_INPUT.metadata,
        normalizedInput: {
          problemSpace: { realProblem: '财报指标看不懂', scenario: '财务分析' },
          successCriteria: { observableResult: '独立分析一份财报', acceptanceCheck: '能解释关键指标' },
          confirmedProposal: { learningDirection: '财务数据分析', firstDeliverable: '财报解读' },
        },
      },
    } as any, { userId: 'user-1' } as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload({}, {})

    expect(payload).toContain('路径前置清洗结果')
    expect(payload).toContain('财报指标看不懂')
    expect(payload).toContain('独立分析一份财报')
    expect(payload).toContain('具体应用场景：财务分析')
  })
})
