/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 认知判决器 payload 注入（审计 P1-7 / EG-1）单元测试
 *
 * 钉死的契约：判决器 identity 要求判决"本轮能否做对当前这一步"，此前 payload 只有
 * learner/currentTask/knownConcepts/struggleConcepts/knowledgeSnapshot/previousLearnerState/
 * forcedCorrectness——无对话历史、无教师最新消息，判决对象是模型从未见过的"这一步"。
 * 修复：把执行器已经拿到的 visibleContext（history + lastTeacherMessage）注入 payload 尾部。
 */
const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }))

import {
  virtualLearnerEpistemicGrounding,
  type EpistemicGroundingInput,
} from '../index'

const baseInput: EpistemicGroundingInput = {
  learner: { profile: { age: 15 }, knownConcepts: ['A'], struggleConcepts: ['B'] },
  currentTask: { title: '把三行挤成一行' },
  knowledgeSnapshot: [{ name: '执行停—绕—留钩子降级', status: 'mastered', progress: 100 }],
  previousLearnerState: null,
}

async function capturedPayload(input: EpistemicGroundingInput): Promise<Record<string, any>> {
  mockCallPrompt.mockResolvedValue({
    success: true,
    output: { epistemicGrounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.7 } },
    debug: { durationMs: 1, rawModelOutput: '', extractedJson: null, userPayload: null, systemPromptVersion: 1 },
  })
  await virtualLearnerEpistemicGrounding(input)
  const spec = mockCallPrompt.mock.calls[0][0]
  return spec.buildUserPayload(input)
}

describe('virtual-learner-epistemic-grounding · payload 注入可见上下文（P1-7）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('visibleContext 真进 payload（history 尾部切片 + lastTeacherMessage）', async () => {
    const payload = await capturedPayload({
      ...baseInput,
      visibleContext: {
        history: [
          { role: 'teacher', content: '我们先看停—绕—留钩子这一步。' },
          { role: 'learner', content: '好。' },
          { role: 'teacher', content: '请你把这三行合并成一行。' },
        ],
        lastTeacherMessage: '请你把这三行合并成一行。',
      },
    })
    expect(payload.visibleContext).toBeDefined()
    expect(payload.visibleContext.lastTeacherMessage).toBe('请你把这三行合并成一行。')
    expect(payload.visibleContext.history).toEqual([
      { role: 'teacher', content: '我们先看停—绕—留钩子这一步。' },
      { role: 'learner', content: '好。' },
      { role: 'teacher', content: '请你把这三行合并成一行。' },
    ])
  })

  it('lastTeacherMessage 缺省时从 history 的 teacher 角色兜底', async () => {
    const payload = await capturedPayload({
      ...baseInput,
      visibleContext: {
        history: [
          { role: 'learner', content: '我试试。' },
          { role: 'teacher', content: '先判断直角。' },
        ],
      },
    })
    expect(payload.visibleContext.lastTeacherMessage).toBe('先判断直角。')
  })

  it('visibleContext 缺省时不注入该键（现网 payload 不变）', async () => {
    const payload = await capturedPayload(baseInput)
    expect(payload).not.toHaveProperty('visibleContext')
  })

  it('稳定前缀不受影响：learner 仍前置，visibleContext 在尾部缓存区', async () => {
    const payload = await capturedPayload({
      ...baseInput,
      visibleContext: { history: [], lastTeacherMessage: '下一步做什么？' },
    })
    const keys = Object.keys(payload)
    expect(keys[0]).toBe('learner')
    expect(keys.indexOf('visibleContext')).toBeGreaterThan(keys.indexOf('previousLearnerState'))
  })
})