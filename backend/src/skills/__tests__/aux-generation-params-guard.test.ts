const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { auxSkillHandlers, auxRetiredSkillHandlers } from '../v4-aux-skills'

/**
 * 回归：aux skill 的**生成参数**（model/temperature/maxTokens）是传输层旋钮，不是业务字段。
 *
 * 2026-11-08 全 skill 缓存调查：aux skill 多为 `buildUserPayload: (d) => d` 恒等透传，
 * 此前 runAux 只是把这几个键「复制」进调用点级覆盖，却让它们**留在 domain** 里，
 * 于是以业务键的身份原样发给模型（零引用废内容，且与注释声明的「提升为覆盖」相矛盾）。
 */
describe('aux 生成参数不混入载荷', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: {},
      runtimeEnvelope: { stub: true },
      debug: {},
    })
  })

  // 2026-11-22 元技能清理：skill-author/skill-compiler 已退役，夹具换 triage-judge
  // （退役可执行面 auxRetiredSkillHandlers——eval/replay 直调同通道；白名单透传：
  //   buildUserPayload 只挑 request/context/background 三个业务字段）
  it('model/temperature/maxTokens 提升为调用点覆盖，并从载荷里剥掉', async () => {
    await auxRetiredSkillHandlers['triage-judge']({
      request: 'R',
      context: 'C',
      background: 'B',
      model: 'frozen-model',
      temperature: 0.15,
      maxTokens: 321,
    })

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    const [spec, , context] = mockCallPrompt.mock.calls[0] as any[]

    // 覆盖通道照旧生效（重构不能把覆盖弄丢）
    expect(context.generationOverride).toEqual({
      model: 'frozen-model',
      temperature: 0.15,
      maxTokens: 321,
    })

    // 载荷里不得再出现这三个键（生成参数从 domain 剥掉后才进 buildUserPayload）
    const payload = spec.buildUserPayload({}, {}) as Record<string, unknown>
    expect(payload).not.toHaveProperty('model')
    expect(payload).not.toHaveProperty('temperature')
    expect(payload).not.toHaveProperty('maxTokens')
    // 真正的业务输入仍在
    expect(payload).toMatchObject({ request: 'R', context: 'C', background: 'B' })
  })

  it('未传生成参数时不产生 generationOverride（行为同改造前）', async () => {
    await auxRetiredSkillHandlers['triage-judge']({
      request: 'R',
      context: 'C',
      background: 'B',
    })

    const [, , context] = mockCallPrompt.mock.calls[0] as any[]
    expect(context).not.toHaveProperty('generationOverride')
  })

  it('只剥这三个生成参数，额外键不混入载荷、业务字段原样保留', async () => {
    await auxRetiredSkillHandlers['triage-judge']({
      request: 'R',
      context: 'C',
      background: 'B',
      maxTokens: 100,
      authorNote: '额外键，白名单外不得泄漏',
    })
    const [spec] = mockCallPrompt.mock.calls[0] as any[]
    const payload = spec.buildUserPayload({}, {}) as Record<string, unknown>
    expect(payload).not.toHaveProperty('maxTokens')
    expect(payload).not.toHaveProperty('authorNote')
    expect(payload).toMatchObject({ request: 'R', context: 'C', background: 'B' })
  })
})
