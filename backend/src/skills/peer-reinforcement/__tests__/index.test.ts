const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }))

import {
  normalizePeerParsedOutput,
  PeerAgent,
  peerAgentHandler,
  toPeerSkillOutcome,
  type PeerDiscussionInput,
  type PeerModelArtifact,
  validatePeerParsedOutput,
} from '../index'
import { buildDefaultRuntimeContract, type RuntimeContract } from '../../../services/prompt-lab/runtime-contract'

const input: PeerDiscussionInput = {
  topic: '牛顿第一定律',
  strategy: 'feynman',
  tutorContext: [],
}

interface PeerPromptSpec {
  validateParsedOutput: (parsed: unknown, input: PeerDiscussionInput) => {
    valid: boolean
    failureReason?: string
  }
  normalizeOutput: (parsed: unknown, input: PeerDiscussionInput) => PeerModelArtifact
  mapEnvelope: (output: PeerModelArtifact, input: PeerDiscussionInput, runtimeContract: RuntimeContract) => unknown
}

describe('peer-reinforcement model artifact', () => {
  beforeEach(() => {
    mockCallPrompt.mockReset()
  })

  it('允许省略可选 followUpQuestions，并归一化为空数组', () => {
    const parsed = { message: '  你会怎么向同学解释它？  ' }

    expect(validatePeerParsedOutput(parsed)).toEqual({ valid: true })
    expect(normalizePeerParsedOutput(parsed)).toEqual({
      message: '你会怎么向同学解释它？',
      followUpQuestions: [],
    })
  })

  it('拒绝非数组或包含空字符串的 followUpQuestions', () => {
    expect(validatePeerParsedOutput({ message: '我们换个角度想想。', followUpQuestions: '为什么？' }))
      .toEqual({ valid: false, failureReason: 'PEER_FOLLOW_UP_QUESTIONS_NOT_ARRAY' })
    expect(validatePeerParsedOutput({ message: '我们换个角度想想。', followUpQuestions: ['  '] }))
      .toEqual({ valid: false, failureReason: 'PEER_FOLLOW_UP_QUESTION_INVALID' })
  })

  it('清理并限制后续问题的数量和长度', () => {
    const normalized = normalizePeerParsedOutput({
      message: '  我们换个角度想想。  ',
      followUpQuestions: [
        '  第一个问题？  ',
        `  ${'x'.repeat(101)}  `,
        '第三个问题？',
        '第四个问题？',
      ],
    })

    expect(normalized.message).toBe('我们换个角度想想。')
    expect(normalized.followUpQuestions).toEqual([
      '第一个问题？',
      'x'.repeat(100),
      '第三个问题？',
    ])
  })

  it('保留模型提供的后续问题并写入 runtime envelope', async () => {
    const parsed = {
      message: '先说说你觉得惯性在这里起了什么作用？',
      followUpQuestions: ['如果没有外力，速度会怎样变化？'],
    }
    mockCallPrompt.mockImplementation(async (spec: PeerPromptSpec, callInput: PeerDiscussionInput) => {
      expect(spec.validateParsedOutput(parsed, callInput)).toEqual({ valid: true })
      const output = spec.normalizeOutput(parsed, callInput)
      return {
        success: true,
        output,
        runtimeEnvelope: spec.mapEnvelope(output, callInput, buildDefaultRuntimeContract('peer-reinforcement')),
        debug: {},
      }
    })

    const result = await new PeerAgent().execute(input)

    expect(result.followUpQuestions).toEqual(parsed.followUpQuestions)
    expect(result.source).toBe('model')
    expect(result.runtimeEnvelope?.artifact).toEqual({
      message: parsed.message,
      strategy: input.strategy,
      followUpQuestions: parsed.followUpQuestions,
    })

    const outcome = toPeerSkillOutcome(result)
    expect(outcome.schemaVersion).toBe('skill-outcome/v1')
    expect(outcome.meta.skillId).toBe('skill:peer-reinforcement')
    expect(outcome.transition?.kind).toBe('none')
    expect(outcome.transition?.durable).toBe(false)
    expect(outcome.artifact).toEqual({
      message: parsed.message,
      strategy: input.strategy,
      followUpQuestions: parsed.followUpQuestions,
    })
  })

  it('从结果来源推导 fallback outcome，避免调用方遗漏 quality 参数', () => {
    const outcome = toPeerSkillOutcome({
      message: '你能换一个例子解释吗？',
      strategy: 'feynman',
      followUpQuestions: [],
      source: 'fallback',
    })

    expect(outcome.meta.quality).toBe('fallback')
    expect(outcome.transition).toEqual(expect.objectContaining({
      kind: 'none',
      durable: false,
    }))
  })

  it('仅在 legacy internal sidecar 附加 canonical outcome，不改变 agent-output-v1 展示字段', async () => {
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: {
        message: '先说说你对惯性的理解。',
        followUpQuestions: ['没有外力时会怎样？'],
      },
      runtimeEnvelope: null,
      debug: {},
    })

    const output = await peerAgentHandler(input, {})

    expect(output).toMatchObject({
      success: true,
      userVisible: '先说说你对惯性的理解。',
      schemaVersion: 'agent-output-v1',
      renderHints: { followUpQuestions: ['没有外力时会怎样？'] },
    })
    expect(output.internal.ext.peer.skillOutcome).toMatchObject({
      schemaVersion: 'skill-outcome/v1',
      artifact: {
        message: '先说说你对惯性的理解。',
        strategy: 'feynman',
        followUpQuestions: ['没有外力时会怎样？'],
      },
      transition: { kind: 'none', durable: false },
    })
    expect(output.internal.ext.peer).not.toHaveProperty('artifact')
  })
})
