import {
  GLOBAL_DEFAULT_MAX_TOKENS,
  MIN_OUTPUT_TOKENS,
  hoistLlmParamsFromContext,
  resolveLlmGenerationParams,
} from '../resolve-llm-call-params'

describe('resolveLlmGenerationParams (source-level single read path)', () => {
  it('声明值即权威：prompt 的 maxTokens 不再被抬到模型硬上限', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 8000 },
    })

    expect(resolved).toEqual(
      expect.objectContaining({
        model: 'deepseek-v4-flash',
        temperature: 0.7,
        maxTokens: 8000,
        sources: expect.objectContaining({
          model: 'active-prompt',
          temperature: 'active-prompt',
          maxTokens: 'active-prompt',
        }),
        request: {
          model: 'deepseek-v4-flash',
          temperature: 0.7,
          max_tokens: 8000,
        },
      })
    )
  })

  it('小声明值原样保留：per-skill 输出预算（如 grounding=800）首次真正生效', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'deepseek-v4-flash', maxTokens: 800 },
    })
    expect(resolved.maxTokens).toBe(800)
    expect(resolved.request.max_tokens).toBe(800)
  })

  it('跳过 rate/code 回退，且声明值超模型硬上限时压回上限', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'agnes-3.0-flash', temperature: 0.7, maxTokens: 999_999 },
    })
    expect(resolved.model).toBe('agnes-3.0-flash')
    expect(resolved.maxTokens).toBe(65536)
    expect(resolved.request.max_tokens).toBe(65536)
  })

  it('未声明 maxTokens 时取模型 defaultMaxTokens（而非硬上限）', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'deepseek-v4-flash' },
    })
    expect(resolved.maxTokens).toBe(32768)
    expect(resolved.maxTokens).not.toBe(131072)
    expect(resolved.sources.maxTokens).toBe('code-defaults')
  })

  it('未知模型 + 未声明 → 全局兜底；低于下限时抬到 MIN_OUTPUT_TOKENS', () => {
    const fallback = resolveLlmGenerationParams({
      promptConfig: { model: 'unknown-model' },
    })
    expect(fallback.maxTokens).toBe(GLOBAL_DEFAULT_MAX_TOKENS)

    const tiny = resolveLlmGenerationParams({
      promptConfig: { model: 'unknown-model', maxTokens: 10 },
    })
    expect(tiny.maxTokens).toBe(MIN_OUTPUT_TOKENS)
    expect(tiny.sources.maxTokens).toBe('active-prompt')
  })

  it('runtime override 仍豁免（可显式调小，不受 clamp 影响）', () => {
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
    expect(resolved.maxTokens).toBe(8000)
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

  it('minMaxTokens 下限仍生效（只抬下界，不改变来源）', () => {
    const resolved = resolveLlmGenerationParams({
      promptConfig: { model: 'deepseek-v4-flash', maxTokens: 500 },
      codeDefaults: { minMaxTokens: 2000 },
    })
    expect(resolved.maxTokens).toBe(2000)
    expect(resolved.sources.maxTokens).toBe('active-prompt')
  })

  it('falls back to code defaults when prompt absent', () => {
    const resolved = resolveLlmGenerationParams({
      codeDefaults: { temperature: 0.3, maxTokens: 4096 },
      routeFallback: { temperature: 0.7, maxTokens: 2000 },
    })
    expect(resolved.temperature).toBe(0.3)
    expect(resolved.maxTokens).toBe(4096)
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
