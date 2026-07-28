const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { teachingTurnAgentHandler } from '../teaching-turn'

type DeclaredFieldRole = { direction: string; visibility: string; owner?: string; export?: string }

/**
 * 读取平台层契约的 promptContract.fields，与 runtime 键对账。
 * v4：契约声明上收平台层（prompt-lab manifest），prompt 文件 frontmatter 不再携带 promptContract。
 */
function loadDeclaredFields(fileName: string): Record<string, DeclaredFieldRole> {
  const raw = fs.readFileSync(path.join(process.cwd(), '../prompt-lab/manifests', fileName), 'utf-8')
  const meta = yaml.load(raw) as any
  return (meta?.promptContract?.fields || {}) as Record<string, DeclaredFieldRole>
}

const MINIMAL_INPUT = {
  messages: [
    { role: 'user' as const, content: '闭包到底是什么？' },
    { role: 'assistant' as const, content: '先看词法作用域。' },
    { role: 'user' as const, content: '那变量为什么不会被回收？' },
  ],
  learner: { stableProfile: {}, learningControlState: {} },
  scenario: {
    subject: 'JavaScript',
    topic: '闭包',
    taskTitle: '理解闭包',
    taskDescription: '解释闭包与变量生命周期',
    taskType: 'concept-explanation',
    taskProfile: { knowledgeType: 'conceptual', cognitiveLevel: 'understand', coreConcept: '闭包' },
  },
  knowledge: {
    points: [{ name: '闭包', status: 'learning' as const, progress: 40 }],
  },
  controls: { mode: 'tutor' as const },
}

const SUCCESS_RESULT = {
  success: true,
  output: {
    reply: '因为闭包引用了它。',
    analysis: {
      cognitiveLevel: 'understand',
      levelScore: 0.6,
      understanding: 0.6,
      confusionPoints: [],
      engagement: 0.8,
      emotionalState: 'neutral',
    },
    knowledge: { currentPoint: '闭包', points: [{ name: '闭包', status: 'learning', progress: 50 }] },
    pedagogy: { strategies: ['analogy'] },
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
  },
  runtimeEnvelope: { stub: true },
  debug: { attempts: [{ attempt: 1, status: 'success' }], systemPromptVersion: 1 },
}

describe('teaching-turn payload snapshot parity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT)
  })

  it('payload contains exactly the keys the prompt input spec declares', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})

    expect(Object.keys(payload).sort()).toEqual([
      'classroomContext',
      'classroomEventContext',
      'controls',
      'knowledge',
      'latestLearnerMessage',
      'learner',
      'promptDirectives',
      'recentDialogueContext',
      'scenario',
      'visibleDialogueContext',
    ])
    // prompt 文档不再声明 messages —— runtime 键是 recentDialogueContext
    expect(payload).not.toHaveProperty('messages')
    expect(payload).toMatchSnapshot({
      latestLearnerMessage: expect.any(String),
      promptDirectives: expect.any(Object),
    })
  })

  it('latestLearnerMessage picks the most recent user message', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})

    expect(payload.latestLearnerMessage).toBe('那变量为什么不会被回收？')
    expect(payload.recentDialogueContext).toHaveLength(3)
    expect(payload.visibleDialogueContext).toHaveLength(3)
  })

  it('visibleDialogueContext overrides messages when provided explicitly', async () => {
    await teachingTurnAgentHandler({
      ...MINIMAL_INPUT,
      visibleDialogueContext: [{ role: 'user', content: '只看这一句' }],
    } as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})

    expect(payload.visibleDialogueContext).toEqual([{ role: 'user', content: '只看这一句' }])
    expect(payload.recentDialogueContext).toHaveLength(3)
  })

  it('fields declaration reconciles with real payload and output keys (File-as-Truth)', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})
    const fields = loadDeclaredFields('teaching-turn.yaml')

    // 声明的 input 字段全部进入 payload；payload 顶层键都声明为 input 或 state
    const declaredInputs = Object.keys(fields).filter((key) => fields[key].direction === 'input')
    expect(declaredInputs.sort()).toEqual([
      'controls',
      'latestLearnerMessage',
      'promptDirectives',
      'recentDialogueContext',
      'scenario',
      'visibleDialogueContext',
    ])
    for (const key of declaredInputs) expect(payload).toHaveProperty(key)
    for (const key of Object.keys(payload)) expect(['input', 'state']).toContain(fields[key]?.direction)

    // normalizeOutput 产出的顶层键都声明为 output 或 state
    const normalized = spec.normalizeOutput({
      reply: '继续。',
      analysis: { cognitiveLevel: 'understand' },
      knowledge: { currentPoint: '闭包', points: [{ name: '闭包', status: 'learning', progress: 50 }] },
      pedagogy: { strategies: ['analogy'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }, input)
    for (const key of Object.keys(normalized)) expect(['output', 'state']).toContain(fields[key]?.direction)

    // 阶段流程控制字段交给编排层；reply 面向用户
    expect(fields.control).toMatchObject({ direction: 'output', visibility: 'handoff' })
    expect(fields.reply).toMatchObject({ direction: 'output', visibility: 'user-visible' })
    expect(fields.knowledge).toMatchObject({ direction: 'state', visibility: 'handoff', owner: 'orchestrator' })
  })
})
