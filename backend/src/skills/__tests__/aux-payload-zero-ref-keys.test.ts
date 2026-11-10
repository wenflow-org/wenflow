const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { auxSkillHandlers } from '../v4-aux-skills'

/**
 * 回归（2026-11-08 全 skill 缓存调查）：两个 aux skill 载荷里带着提示词**零引用**的键。
 * - learner-state-review：priorInsights（提示词「身份」段枚举的输入只有状态摘要/知识线索/最近证据）
 * - teaching-opening-generator：pathSummary（提示词对 pathSummary/「路径概要」引用均为 0）
 * 它们每轮都发给模型，纯 token 浪费。
 */
describe('aux 载荷零引用键剔除', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: {},
      runtimeEnvelope: { stub: true },
      debug: {},
    })
  })

  it('learner-state-review 必须把 priorInsights 发给模型（设计文档 §4.4 第 5 条）', async () => {
    // 2026-11-08 复核：此前误判 priorInsights 为「零引用废内容」而删除，已撤回。
    // 它虽在提示词正文里零字面引用，但有活写入方（LearnerStateReviewService 每轮 refresh
    // 调 getActiveInsights）与具名契约（doc/LEARNER_STATE_REVIEW_DESIGN.md §4.4 第 5 条：
    // 「输入里的 priorInsights：能延续/推翻就显式说明，不要重复造新条目」）。
    const priorInsights = [{ id: 'i1', claim: '上一轮结论', status: 'active', evidenceRefs: ['ev1'] }];
    await auxSkillHandlers['learner-state-review']({
      learnerDigest: {},
      knowledgeDigest: {},
      recentEvidence: [{ id: 'ev1' }],
      priorInsights,
    })

    const [spec] = mockCallPrompt.mock.calls[0] as any[]
    const payload = spec.buildUserPayload({}, {}) as Record<string, unknown>
    expect(payload.priorInsights).toEqual(priorInsights)
    // 被真正消费的输入也仍在
    expect(payload.recentEvidence).toEqual([{ id: 'ev1' }])
  })

  it('teaching-opening-generator 不把 pathSummary 发给模型（稳定前缀与 legacy 两个分支都查）', async () => {
    const previous = process.env.PAYLOAD_STABLE_PREFIX
    try {
      for (const flag of ['1', '0']) {
        jest.clearAllMocks()
        mockCallPrompt.mockResolvedValue({
          success: true,
          output: {},
          runtimeEnvelope: { stub: true },
          debug: {},
        })
        process.env.PAYLOAD_STABLE_PREFIX = flag

        await auxSkillHandlers['teaching-opening-generator']({
          subject: '数学',
          topic: '行程问题',
          taskTitle: '追及题',
          taskType: 'practice',
          pathSummary: '从零到可交付的前端能力',
          currentMilestoneTitle: '函数进阶',
          openingMode: 'first',
          learner: {},
        })

        const [spec] = mockCallPrompt.mock.calls[0] as any[]
        const payload = spec.buildUserPayload({}, {}) as Record<string, unknown>
        expect(payload).not.toHaveProperty('pathSummary')
        // 被真正消费的现场锚点仍在
        expect(payload.currentMilestoneTitle).toBe('函数进阶')
      }
    } finally {
      if (previous === undefined) delete process.env.PAYLOAD_STABLE_PREFIX
      else process.env.PAYLOAD_STABLE_PREFIX = previous
    }
  })
})
