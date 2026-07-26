import {
  hoistLlmParamsFromContext,
  resolveLlmGenerationParams,
} from '../resolve-llm-call-params'

describe('resolveLlmGenerationParams (source-level single read path)', () => {
  it('prefers ACTIVE prompt over route and code defaults', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: null, temperature: 0.7, maxTokens: 8000 },
      codeDefaults: { temperature: 0.2, maxTokens: 2000 },
      routeFallback: { model: 'route-model', temperature: 0.1, maxTokens: 1800 },
    })

    expect(resolved).toEqual(
      expect.objectContaining({
        model: 'route-model',
        temperature: 0.7,
        maxTokens: 8000,
        sources: expect.objectContaining({
          model: 'route-fallback',
          temperature: 'active-prompt',
          maxTokens: 'active-prompt',
        }),
        request: {
          model: 'route-model',
          temperature: 0.7,
          max_tokens: 8000,
        },
      })
    )
  })

  it('applies runtime override above prompt', () => {
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

  it('applies minMaxTokens floor without inventing lower prompt values', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { maxTokens: 500 },
      codeDefaults: { minMaxTokens: 2000 },
    })
    expect(resolved.maxTokens).toBe(2000)
    expect(resolved.sources.maxTokens).toBe('active-prompt')
  })

  it('falls back to code defaults when prompt absent', () => {
    const resolved = resolveLlmGenerationParams({
      codeDefaults: { temperature: 0.3, maxTokens: 32000 },
      routeFallback: { temperature: 0.7, maxTokens: 2000 },
    })
    expect(resolved.temperature).toBe(0.3)
    expect(resolved.maxTokens).toBe(32000)
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
