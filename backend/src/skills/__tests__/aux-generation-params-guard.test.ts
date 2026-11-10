const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { auxSkillHandlers } from '../v4-aux-skills'

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

  it('model/temperature/maxTokens 提升为调用点覆盖，并从载荷里剥掉', async () => {
    await auxSkillHandlers['skill-compiler']({
      systemPrompt: 'S',
      requiredFieldIds: ['a'],
      testUserPrompt: '{}',
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

    // 载荷里不得再出现这三个键（buildUserPayload 是恒等透传，故从 domain 剥掉即可）
    const payload = spec.buildUserPayload({}, {}) as Record<string, unknown>
    expect(payload).not.toHaveProperty('model')
    expect(payload).not.toHaveProperty('temperature')
    expect(payload).not.toHaveProperty('maxTokens')
    // 真正的业务输入仍在
    expect(payload).toMatchObject({ systemPrompt: 'S', requiredFieldIds: ['a'], testUserPrompt: '{}' })
  })

  it('未传生成参数时不产生 generationOverride（行为同改造前）', async () => {
    await auxSkillHandlers['skill-compiler']({
      systemPrompt: 'S',
      requiredFieldIds: [],
      testUserPrompt: '{}',
    })

    const [, , context] = mockCallPrompt.mock.calls[0] as any[]
    expect(context).not.toHaveProperty('generationOverride')
  })

  it('只剥这三个生成参数，其余业务字段原样保留', async () => {
    await auxSkillHandlers['skill-compiler']({
      systemPrompt: 'S',
      requiredFieldIds: ['a'],
      testUserPrompt: '{}',
      maxTokens: 100,
      authorNote: '业务字段，必须保留',
    })
    const [spec] = mockCallPrompt.mock.calls[0] as any[]
    const payload = spec.buildUserPayload({}, {}) as Record<string, unknown>
    expect(payload).not.toHaveProperty('maxTokens')
    expect(payload.authorNote).toBe('业务字段，必须保留')
  })
})
