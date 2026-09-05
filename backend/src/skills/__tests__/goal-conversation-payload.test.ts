const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))
jest.mock('../../services/prompt-composer', () => ({
  composePromptFromAgentRouting: jest.fn(async (_id: string, prompt: string) => ({
    finalPrompt: prompt,
    supplementApplied: false,
    fieldsCovered: [],
  })),
  isPromptSupplementEnabled: () => false,
}))

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { goalConversationAgentHandler } from '../goal-conversation'

type DeclaredFieldRole = { direction: string; visibility: string; owner?: string; export?: string }

/**
 * 读取平台层契约的 promptContract.fields，与 runtime 键对账。
 * v4：契约声明上收平台层（prompt-lab manifest），prompt 文件 frontmatter 不再携带 promptContract。
 */
function loadDeclaredFields(fileName: string): Record<string, DeclaredFieldRole> {
  const raw = fs.readFileSync(path.join(process.cwd(), '../prompts/manifests', fileName), 'utf-8')
  const meta = yaml.load(raw) as any
  return (meta?.promptContract?.fields || {}) as Record<string, DeclaredFieldRole>
}

const SUCCESS_RESULT = {
  success: true,
  output: {
    userVisible: '好的，明白了。',
    internal: {
      core: { stage: 'understanding', confidence: 0.3, isCompleted: false },
      ext: { goalConversation: { quickReplies: [] } },
    },
  },
  runtimeEnvelope: { stub: true },
  debug: {
    attempts: [{ attempt: 1, status: 'success' }],
    systemPromptVersion: 1,
    systemPrompt: 'sys',
    userPayload: 'up',
  },
}

describe('goal-conversation payload snapshot parity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT)
  })

  it('payload contains exactly the keys the prompt input spec declares', async () => {
    await goalConversationAgentHandler(
      {
        goal: '想学 Python 数据分析，转行用',
        metadata: { previousStage: 'understanding' },
      } as any,
      {
        userId: 'user-1',
        conversationHistory: [
          { role: 'system', content: '平台消息，不应进入上下文' },
          { role: 'user', content: '你好' },
          { role: 'assistant', content: '你好，想学什么？' },
        ],
      } as any
    )

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    const [spec, promptInput] = mockCallPrompt.mock.calls[0]
    const payload = JSON.parse(spec.buildUserPayload(promptInput, {}))

    expect(Object.keys(payload).sort()).toEqual([
      'conversationContext',
      'state',
      'task',
      'userInput',
    ])
    // prompt 文档不再声明 goal/history/profile —— runtime 从不发送
    expect(payload).not.toHaveProperty('goal')
    expect(payload).not.toHaveProperty('history')
    expect(payload).not.toHaveProperty('profile')
    expect(payload).toMatchSnapshot()
  })

  it('state defaults to an empty understanding snapshot on the first turn', async () => {
    await goalConversationAgentHandler(
      { goal: '想学吉他', metadata: {} } as any,
      { userId: 'user-1', conversationHistory: [] } as any
    )

    const [spec, promptInput] = mockCallPrompt.mock.calls[0]
    const payload = JSON.parse(spec.buildUserPayload(promptInput, {}))

    expect(payload.state).toEqual({ stage: 'understanding', confidence: 0, understanding: {} })
    expect(payload.conversationContext).toEqual([])
    expect(payload.task.mode).toBe('goal-conversation-turn-update')
  })

  it('previousState passes through as the primary memory object', async () => {
    await goalConversationAgentHandler(
      {
        goal: '就是想转行做数据分析',
        metadata: {
          previousState: {
            stage: 'proposing',
            confidence: 0.72,
            understanding: { surface_goal: '学 Python' },
          },
        },
      } as any,
      {
        userId: 'user-1',
        conversationHistory: [{ role: 'user', content: '补充：我在做财务' }],
      } as any
    )

    const [spec, promptInput] = mockCallPrompt.mock.calls[0]
    const payload = JSON.parse(spec.buildUserPayload(promptInput, {}))

    expect(payload.state).toEqual({
      stage: 'proposing',
      confidence: 0.72,
      understanding: { surface_goal: '学 Python' },
    })
    expect(payload.conversationContext).toEqual([{ role: 'user', text: '补充：我在做财务' }])
    expect(payload.userInput).toBe('就是想转行做数据分析')
  })

  it('fields declaration reconciles with real payload and output keys (File-as-Truth)', async () => {
    await goalConversationAgentHandler(
      { goal: '想学 Python 数据分析', metadata: {} } as any,
      { userId: 'user-1', conversationHistory: [] } as any
    )

    const [spec, promptInput] = mockCallPrompt.mock.calls[0]
    const payload = JSON.parse(spec.buildUserPayload(promptInput, {}))
    const fields = loadDeclaredFields('goal-conversation.yaml')

    // 声明的 input 字段全部进入 payload；payload 顶层键都声明为 input 或 state
    const declaredInputs = Object.keys(fields).filter((key) => fields[key].direction === 'input')
    expect(declaredInputs.sort()).toEqual(['conversationContext', 'task', 'userInput'])
    for (const key of declaredInputs) expect(payload).toHaveProperty(key)
    for (const key of Object.keys(payload)) expect(['input', 'state']).toContain(fields[key]?.direction)

    // 模型输出顶层键都声明为 output 或 state（state 字段双向）
    const modelOutputKeys = ['reply', 'state', 'understanding', 'nextQuestions', 'quickReplies', 'confirmedProposal', 'confidenceScores', 'structuredData']
    for (const key of modelOutputKeys) expect(['output', 'state']).toContain(fields[key]?.direction)

    // 可见性与导出走位
    expect(fields.reply).toMatchObject({ direction: 'output', visibility: 'user-visible' })
    expect(fields.quickReplies).toMatchObject({ direction: 'output', visibility: 'user-visible', export: 'renderHints' })
    expect(fields.confidenceScores).toMatchObject({ direction: 'output', visibility: 'debug' })
    expect(fields.state).toMatchObject({ direction: 'state', visibility: 'handoff', owner: 'runtime' })
  })
})
