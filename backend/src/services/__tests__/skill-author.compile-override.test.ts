const mockExecuteSkillWithResult = jest.fn()

jest.mock('../../skills', () => ({
  executeSkillWithResult: mockExecuteSkillWithResult,
  auxSkillDefinitionMap: { 'skill-compiler': { name: 'skill-compiler' } },
}))

import { compileSkill } from '../skill-author'

/**
 * 回归（2026-11-08 全 skill 缓存调查）：compileSkill 的生成参数此前以 `*Override` 命名
 * `...input` 整体透传给 skill-compiler——而 runAux 只识别 model/temperature/maxTokens，
 * 于是这三个键**既不生效、又被当业务字段灌进载荷**（skill-compiler 的 buildUserPayload 恒等透传）。
 * 现改为显式映射到 runAux 识别的命名。
 */
describe('compileSkill 生成参数映射', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockExecuteSkillWithResult.mockResolvedValue({
      success: true,
      output: { rawOutput: '{}', parsedJson: {}, missingFields: [], pass: true },
      debug: {},
    })
  })

  it('*Override 映射为 model/temperature/maxTokens，且原名不再进载荷', async () => {
    await compileSkill({
      systemPrompt: 'S',
      requiredFieldIds: [],
      testUserPrompt: '{}',
      modelOverride: 'frozen-model',
      temperatureOverride: 0.15,
      maxTokensOverride: 321,
    })

    const skillInput = mockExecuteSkillWithResult.mock.calls[0][1] as Record<string, unknown>
    // runAux 识别的命名（会被提升为调用点级覆盖，并从载荷剥掉）
    expect(skillInput).toMatchObject({ model: 'frozen-model', temperature: 0.15, maxTokens: 321 })
    // 带 Override 后缀的原名不再出现（此前会以业务字段身份发给模型）
    expect(skillInput).not.toHaveProperty('modelOverride')
    expect(skillInput).not.toHaveProperty('temperatureOverride')
    expect(skillInput).not.toHaveProperty('maxTokensOverride')
    // 业务输入照旧
    expect(skillInput).toMatchObject({ systemPrompt: 'S', requiredFieldIds: [], testUserPrompt: '{}' })
  })

  it('未传覆盖时不产生生成参数字段', async () => {
    await compileSkill({ systemPrompt: 'S', requiredFieldIds: [], testUserPrompt: '{}' })

    const skillInput = mockExecuteSkillWithResult.mock.calls[0][1] as Record<string, unknown>
    expect(skillInput).not.toHaveProperty('model')
    expect(skillInput).not.toHaveProperty('temperature')
    expect(skillInput).not.toHaveProperty('maxTokens')
  })
})
