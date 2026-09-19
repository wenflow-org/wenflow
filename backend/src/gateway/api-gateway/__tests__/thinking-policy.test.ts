import { buildThinkingPolicy } from '../thinking-policy'

describe('buildThinkingPolicy（能力驱动 + 预算分离）', () => {
  it('模型不支持思考时一律不发 thinking / reasoning_effort', () => {
    expect(
      buildThinkingPolicy({ modelId: 'agnes-3.0-flash', thinkingMode: 'enabled', reasoningEffort: 'high', maxTokens: 4000 })
    ).toEqual({})
  })

  it('未知模型同样不发字段', () => {
    expect(buildThinkingPolicy({ modelId: 'unknown-model', thinkingMode: 'enabled' })).toEqual({})
  })

  it('支持思考的模型按 thinkingMode 发 thinking:{type}', () => {
    expect(buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'disabled' }))
      .toEqual({ thinking: { type: 'disabled' } })
    expect(buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'enabled' }))
      .toEqual({ thinking: { type: 'enabled' } })
  })

  it('thinkingMode 非 enabled/disabled（如 default）时不显式发 thinking', () => {
    const policy = buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'default' as any })
    expect(policy.thinking).toBeUndefined()
  })

  it('只有支持 reasoning_effort 的模型、且未关闭思考时才发 effort', () => {
    expect(
      buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'enabled', reasoningEffort: 'high' }).reasoningEffort
    ).toBe('high')
    // 显式关闭思考时不发 effort
    expect(
      buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'disabled', reasoningEffort: 'high' }).reasoningEffort
    ).toBeUndefined()
    // 非法 effort 值不发
    expect(
      buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'enabled', reasoningEffort: 'maxx' as any }).reasoningEffort
    ).toBeUndefined()
  })

  it('预算分离：开启思考时 max_tokens = 声明输出 + 推理预留', () => {
    // flash reasoningReserveTokens = 8192
    const policy = buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'enabled', maxTokens: 8000 })
    expect(policy.maxTokens).toBe(8000 + 8192)
  })

  it('预算分离后不超过模型硬上限', () => {
    const policy = buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'enabled', maxTokens: 131072 })
    expect(policy.maxTokens).toBe(131072)
  })

  it('关闭思考 / 未传预算时不改 max_tokens', () => {
    expect(
      buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'disabled', maxTokens: 8000 }).maxTokens
    ).toBeUndefined()
    expect(
      buildThinkingPolicy({ modelId: 'deepseek-v4-flash', thinkingMode: 'enabled' }).maxTokens
    ).toBeUndefined()
  })
})
