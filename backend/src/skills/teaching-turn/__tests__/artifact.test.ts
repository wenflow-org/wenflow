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
})
