const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }))

import {
  teachingTurnAgentHandler,
  toTeachingTurnSkillOutcome,
  type TeachingTurnInput,
  type TeachingTurnOutput,
} from '../index'

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: '我觉得条件类型会根据条件选择结果。' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: {
    subject: 'TypeScript',
    topic: '条件类型',
    taskTitle: '理解条件类型',
    taskDescription: '解释条件类型的基本行为',
    taskType: 'practice',
  },
  knowledge: { points: [] },
}

const artifact: TeachingTurnOutput = {
  reply: '说得不错。你能再举一个 T extends U 的例子吗？',
  analysis: {
    cognitiveLevel: 'understand',
    levelScore: 2,
    understanding: 0.7,
    confusionPoints: [],
    engagement: 0.8,
    emotionalState: 'neutral',
    loadIndex: 0.5,
    loadBasis: 'absent',
  },
  knowledge: {
    currentPoint: '条件类型',
    points: [{ name: '条件类型', status: 'learning', progress: 60 }],
  },
  pedagogy: { strategies: ['worked-example'] },
  control: {
    isCompletionCandidate: false,
    shouldTriggerPeer: false,
  },
}

describe('teaching-turn canonical artifact', () => {
  beforeEach(() => {
    mockCallPrompt.mockReset()
  })

  it('builds an internal SkillOutcome without proposing a persistence transition', () => {
    const outcome = toTeachingTurnSkillOutcome(artifact)

    expect(outcome).toMatchObject({
      schemaVersion: 'skill-outcome/v1',
      meta: { skillId: 'skill:teaching-turn', quality: 'model' },
      artifact,
      transition: null,
    })
  })

  it('keeps the agent-output-v1 teaching field while attaching the internal sidecar', async () => {
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: artifact,
      runtimeEnvelope: null,
      debug: { promptId: 'prompt-1' },
    })

    const output = await teachingTurnAgentHandler(input)

    expect(output).toMatchObject({
      success: true,
      userVisible: artifact.reply,
      schemaVersion: 'agent-output-v1',
      internal: {
        ext: {
          teaching: artifact,
          teachingTurnOutcome: {
            schemaVersion: 'skill-outcome/v1',
            artifact,
            transition: null,
          },
        },
      },
    })
  })

  it('透传 knowledge.confirmCheck（2 个合法动作）', async () => {
    let capturedNormalize: ((parsed: any, i: any) => any) | null = null;
    mockCallPrompt.mockImplementation(async (spec: any) => {
      capturedNormalize = spec.normalizeOutput;
      const raw = {
        reply: '这个点讲完了，你感觉如何？',
        analysis: {
          cognitiveLevel: 'understand', levelScore: 2, understanding: 0.6,
          confusionPoints: [], engagement: 0.8, emotionalState: 'neutral',
          loadIndex: 0.4, loadBasis: 'semantic',
        },
        knowledge: {
          currentPoint: 'print执行顺序',
          points: [{ name: 'print执行顺序', status: 'learning', progress: 60 }],
          confirmCheck: {
            prompt: '这个点感觉怎么样？',
            actions: [
              { label: '掌握了，继续', message: '这个点我掌握了，继续往下' },
              { label: '再讲一遍', message: '这个点还不太清楚，换个方式讲' },
            ],
          },
        },
        pedagogy: { strategies: ['explain'] },
        control: { isCompletionCandidate: false, shouldTriggerPeer: false },
      };
      const normalized = capturedNormalize!(raw, input);
      return {
        success: true,
        output: normalized,
        runtimeEnvelope: null,
        debug: { promptId: 'prompt-1' },
      };
    })

    const output = await teachingTurnAgentHandler(input)
    const teaching = (output.internal?.ext as any)?.teaching as TeachingTurnOutput;
    expect(teaching.knowledge.confirmCheck).toEqual({
      prompt: '这个点感觉怎么样？',
      actions: [
        { label: '掌握了，继续', message: '这个点我掌握了，继续往下' },
        { label: '再讲一遍', message: '这个点还不太清楚，换个方式讲' },
      ],
    });
  })

  it('knowledge.confirmCheck 动作数非 2 时丢弃（回退无按钮）', async () => {
    let capturedNormalize: ((parsed: any, i: any) => any) | null = null;
    mockCallPrompt.mockImplementation(async (spec: any) => {
      capturedNormalize = spec.normalizeOutput;
      const raw = {
        reply: '我们先看看你的理解。',
        analysis: {
          cognitiveLevel: 'understand', levelScore: 2, understanding: 0.5,
          confusionPoints: [], engagement: 0.7, emotionalState: 'neutral',
          loadIndex: 0.4, loadBasis: 'semantic',
        },
        knowledge: {
          currentPoint: 'print执行顺序',
          points: [{ name: 'print执行顺序', status: 'learning', progress: 50 }],
          confirmCheck: {
            prompt: '这个点感觉怎么样？',
            actions: [{ label: '只有一项', message: '不完整的动作组' }],
          },
        },
        pedagogy: { strategies: ['explain'] },
        control: { isCompletionCandidate: false, shouldTriggerPeer: false },
      };
      const normalized = capturedNormalize!(raw, input);
      return {
        success: true,
        output: normalized,
        runtimeEnvelope: null,
        debug: { promptId: 'prompt-1' },
      };
    })

    const output = await teachingTurnAgentHandler(input)
    const teaching = (output.internal?.ext as any)?.teaching as TeachingTurnOutput;
    expect(teaching.knowledge.confirmCheck).toBeUndefined();
  })

  it('Q9 契约漂移容错：把平铺到顶层的 knowledge 子字段收敛回 knowledge（不丢看板）', async () => {
    let capturedSpec: any = null
    mockCallPrompt.mockImplementation(async (spec: any) => {
      capturedSpec = spec
      return { success: true, output: artifact, runtimeEnvelope: null, debug: {} }
    })
    await teachingTurnAgentHandler(input)

    const flat = {
      reply: '我们接着看这个点。',
      analysis: {
        cognitiveLevel: 'understand', levelScore: 2, understanding: 0.6,
        confusionPoints: [], engagement: 0.7, emotionalState: 'neutral',
        loadIndex: 0.4, loadBasis: 'semantic',
      },
      // 模型抖动：knowledge 子字段平铺在顶层（没有 knowledge 对象）
      currentPoint: '闭包',
      points: [{ name: '闭包', status: 'learning', progress: 40 }],
      confirmCheck: {
        prompt: '这个点感觉怎么样？',
        actions: [
          { label: '掌握了，继续', message: '这个点我掌握了，继续往下' },
          { label: '再讲一遍', message: '这个点还不太清楚，换个方式讲' },
        ],
      },
      pedagogy: { strategies: ['explain'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }

    expect(capturedSpec.validateParsedOutput(flat, input)).toEqual({ valid: true })

    const coerced = capturedSpec.coerceParsedForContract(flat, input)
    expect(coerced.knowledge).toMatchObject({
      currentPoint: '闭包',
      points: [{ name: '闭包', status: 'learning', progress: 40 }],
    })

    const normalized = capturedSpec.normalizeOutput(flat, input)
    expect(normalized.knowledge.currentPoint).toBe('闭包')
    expect(normalized.knowledge.points).toEqual([{ name: '闭包', status: 'learning', progress: 40 }])
    expect(normalized.knowledge.confirmCheck).toEqual({
      prompt: '这个点感觉怎么样？',
      actions: [
        { label: '掌握了，继续', message: '这个点我掌握了，继续往下' },
        { label: '再讲一遍', message: '这个点还不太清楚，换个方式讲' },
      ],
    })
  })

  it('Q9 契约漂移容错：嵌套 knowledge 存在时优先于顶层同名平铺键', async () => {
    let capturedSpec: any = null
    mockCallPrompt.mockImplementation(async (spec: any) => {
      capturedSpec = spec
      return { success: true, output: artifact, runtimeEnvelope: null, debug: {} }
    })
    await teachingTurnAgentHandler(input)

    const both = {
      reply: '继续。',
      analysis: {
        cognitiveLevel: 'understand', levelScore: 2, understanding: 0.6,
        confusionPoints: [], engagement: 0.7, emotionalState: 'neutral',
        loadIndex: 0.4, loadBasis: 'semantic',
      },
      knowledge: { currentPoint: '嵌套点', points: [{ name: '嵌套点', status: 'learning', progress: 80 }] },
      currentPoint: '平铺点',
      points: [{ name: '平铺点', status: 'pending', progress: 0 }],
      pedagogy: { strategies: ['explain'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }

    const normalized = capturedSpec.normalizeOutput(both, input)
    expect(normalized.knowledge.currentPoint).toBe('嵌套点')
    expect(normalized.knowledge.points).toEqual([{ name: '嵌套点', status: 'learning', progress: 80 }])
  })
})
