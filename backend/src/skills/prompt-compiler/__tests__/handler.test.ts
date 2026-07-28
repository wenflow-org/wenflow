const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { promptCompilerHandler } from '../handler'

const VALID_CONFIG = `
meta:
  id: simple-qa
  name: 简单问答助手
  archetype: conversational
`

function successfulResult(prompt: string) {
  return {
    success: true,
    output: prompt,
    debug: {},
  }
}

describe('promptCompilerHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects invalid YAML before touching the LLM chain', async () => {
    await expect(promptCompilerHandler({ config: '{not: [valid' })).rejects.toThrow('YAML 格式错误')
    expect(mockCallPrompt).not.toHaveBeenCalled()
  })

  it('compiles through the unified callPrompt chain with contract-driven spec', async () => {
    mockCallPrompt.mockResolvedValue(successfulResult('## 身份定义\n\n你是编译产物。'))

    const output = await promptCompilerHandler({
      config: VALID_CONFIG,
      compilerPrompt: '# 编译约定（测试注入）',
    })

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    const [spec, input] = mockCallPrompt.mock.calls[0]
    expect(input).toEqual({ config: VALID_CONFIG })
    expect(spec.agentId).toBe('skill:prompt-compiler')
    expect(spec.requireActivePrompt).toBe(true)
    expect(spec.modelDefaults).toEqual({ maxTokens: 8000, temperature: 0.2 })
    expect(spec.retryStrategy.maxAttempts).toBe(2)

    const payload = spec.buildUserPayload(input, {})
    expect(payload).toContain('# 编译约定（测试注入）')
    expect(payload).toContain('```yaml')
    expect(payload).toContain('simple-qa')

    expect(output.prompt).toBe('## 身份定义\n\n你是编译产物。')
    expect(output.config.meta.id).toBe('simple-qa')
    expect(output.stats.chars).toBe(output.prompt.length)
  })

  it('strips a markdown fence in normalizeOutput', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => {
      const normalized = spec.normalizeOutput('```markdown\n## 身份定义\n\n干净产物\n```')
      return successfulResult(normalized)
    })

    const output = await promptCompilerHandler({
      config: VALID_CONFIG,
      compilerPrompt: 'spec',
    })

    expect(output.prompt).toBe('## 身份定义\n\n干净产物')
  })

  it('rejects empty model output via validateParsedOutput', async () => {
    mockCallPrompt.mockImplementation(async (spec: any) => {
      expect(spec.validateParsedOutput('   ').valid).toBe(false)
      expect(spec.validateParsedOutput('## 身份定义').valid).toBe(true)
      return { success: false, error: { code: 'X_FAILED', message: 'LLM 返回空结果' }, debug: {} }
    })

    await expect(promptCompilerHandler({
      config: VALID_CONFIG,
      compilerPrompt: 'spec',
    })).rejects.toThrow('LLM 返回空结果')
  })

  it('propagates callPrompt failure as an error', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'PROMPT_COMPILER_FAILED', message: 'Prompt logical retry budget exhausted' },
      debug: {},
    })

    await expect(promptCompilerHandler({
      config: VALID_CONFIG,
      compilerPrompt: 'spec',
    })).rejects.toThrow('Prompt logical retry budget exhausted')
  })
})
