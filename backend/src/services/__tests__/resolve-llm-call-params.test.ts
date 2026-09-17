import {
  hoistLlmParamsFromContext,
  resolveLlmGenerationParams,
} from '../resolve-llm-call-params'

describe('resolveLlmGenerationParams (source-level single read path)', () => {
  it('prefers ACTIVE prompt over route and code defaults, floors maxTokens to 128k', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: null, temperature: 0.7, maxTokens: 8000 },
      codeDefaults: { temperature: 0.2, maxTokens: 2000 },
      routeFallback: { model: 'route-model', temperature: 0.1, maxTokens: 1800 },
    })

    expect(resolved).toEqual(
      expect.objectContaining({
        model: 'route-model',
        temperature: 0.7,
        maxTokens: 131072,
        sources: expect.objectContaining({
          model: 'route-fallback',
          temperature: 'active-prompt',
          maxTokens: 'active-prompt',
        }),
        request: {
          model: 'route-model',
          temperature: 0.7,
          max_tokens: 131072,
        },
      })
    )
  })

  it('applies runtime override above prompt (small override not floored)', () => {
    const resolved = resolveLlmGenerationParams({
      runtimeOverride: { temperature: 0.1, maxTokens: 1200, model: 'lab-model' },
      promptConfig: { temperature: 0.7, maxTokens: 8000, model: 'prompt-model' },
      routeFallback: { temperature: 0.5, maxTokens: 2000, model: 'route-model' },
    })

    expect(resolved.request).toEqual({
      model: 'lab-model',
      temperature: 0.1,
      max_tokens: 1200,
    })
    expect(resolved.sources.model).toBe('runtime-override')
  })

  it('prefers route model over prompt when skill explicitly configured a model (routeModelExplicit)', () => {
    // skill_model_configs.model 显式指定时，skill 级模型优先于 prompt 继承的平台默认模型
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 8000 },
      routeFallback: { model: 'agnes-3.0-flash', temperature: 0.7, maxTokens: 8000 },
      routeModelExplicit: true,
    })

    expect(resolved.model).toBe('agnes-3.0-flash')
    expect(resolved.sources.model).toBe('route-fallback')
    // 非 model 参数仍由 prompt 优先（File-as-Truth 不变）
    expect(resolved.temperature).toBe(0.7)
  })

  it('keeps prompt model priority when route model is inherited (routeModelExplicit=false)', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 8000 },
      routeFallback: { model: 'deepseek-v4-flash', temperature: 0.5, maxTokens: 2000 },
      routeModelExplicit: false,
    })

    expect(resolved.model).toBe('deepseek-v4-flash')
    expect(resolved.sources.model).toBe('active-prompt')
  })

  it('caps maxTokens to model output limit (agnes=65536) instead of 128k floor', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'agnes-3.0-flash', temperature: 0.7, maxTokens: 8000 },
      routeFallback: { model: 'agnes-3.0-flash', temperature: 0.7, maxTokens: 8000 },
      routeModelExplicit: true,
    })

    expect(resolved.model).toBe('agnes-3.0-flash')
    expect(resolved.maxTokens).toBe(65536)
    expect(resolved.request.max_tokens).toBe(65536)
  })

  it('keeps 128k floor for deepseek models', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 8000 },
    })

    expect(resolved.model).toBe('deepseek-v4-flash')
    expect(resolved.maxTokens).toBe(131072)
  })

  it('applies minMaxTokens floor below 128k without inventing lower prompt values', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { maxTokens: 500 },
      codeDefaults: { minMaxTokens: 2000 },
    })
    // minMax 抬到 2000 后，仍被全局 128k floor 覆盖
    expect(resolved.maxTokens).toBe(131072)
    expect(resolved.sources.maxTokens).toBe('active-prompt')
  })

  it('falls back to code defaults when prompt absent', () => {
    const resolved = resolveLlmGenerationParams({
      codeDefaults: { temperature: 0.3, maxTokens: 131072 },
      routeFallback: { temperature: 0.7, maxTokens: 2000 },
    })
    expect(resolved.temperature).toBe(0.3)
    expect(resolved.maxTokens).toBe(131072)
    expect(resolved.sources.temperature).toBe('code-defaults')
  })
})

describe('hoistLlmParamsFromContext', () => {
  it('lifts mis-placed context params onto request fields', () => {
    const hoisted = hoistLlmParamsFromContext(
      { messages: [] },
      { temperature: 0.55, maxTokens: 4096, model: 'ctx-model' }
    )
    expect(hoisted).toEqual({
      model: 'ctx-model',
      temperature: 0.55,
      max_tokens: 4096,
    })
  })

  it('prefers request body over context', () => {
    const hoisted = hoistLlmParamsFromContext(
      { temperature: 0.2, max_tokens: 100, model: 'req-model' },
      { temperature: 0.9, maxTokens: 9999, model: 'ctx-model' }
    )
    expect(hoisted).toEqual({
      model: 'req-model',
      temperature: 0.2,
      max_tokens: 100,
    })
  })
})
