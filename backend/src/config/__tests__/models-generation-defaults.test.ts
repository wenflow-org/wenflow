/**
 * 模型级生成参数（2026-10-24）：llm-providers.json 的 defaultThinkingMode /
 * defaultReasoningEffort / defaultResponseFormat 解析与校验。
 */
import { parseLlmProvidersConfig } from '../models.config'

function configWith(model: Record<string, unknown>): string {
  return JSON.stringify({
    providers: {
      platform: {
        name: '平台',
        enabled: true,
        recommended: true,
        models: { 'm-gen': { tier: 'chat', ...model } }
      }
    },
    aliases: { chat: ['m-gen'] },
    defaults: { chat: 'm-gen', reasoning: 'm-gen' }
  })
}

describe('模型级生成参数解析', () => {
  it('三个字段按小写归一写入快照', () => {
    const snap = parseLlmProvidersConfig(configWith({
      supportsThinking: true,
      reasoningEfforts: ['low', 'high'],
      defaultThinkingMode: 'ENABLED',
      defaultReasoningEffort: 'HIGH',
      defaultResponseFormat: 'JSON_OBJECT'
    }))
    const model = snap.models.find((m) => m.id === 'm-gen')!
    expect(model.defaultThinkingMode).toBe('enabled')
    expect(model.defaultReasoningEffort).toBe('high')
    expect(model.defaultResponseFormat).toBe('json_object')
  })

  it('未声明时保持 undefined（运行时回落平台默认）', () => {
    const model = parseLlmProvidersConfig(configWith({})).models.find((m) => m.id === 'm-gen')!
    expect(model.defaultThinkingMode).toBeUndefined()
    expect(model.defaultReasoningEffort).toBeUndefined()
    expect(model.defaultResponseFormat).toBeUndefined()
  })

  it('非法枚举 fail-loud，报错带字段名', () => {
    expect(() => parseLlmProvidersConfig(configWith({ defaultThinkingMode: 'on' })))
      .toThrow(/defaultThinkingMode 只能是 default \/ enabled \/ disabled/)
    /* 挡位词不按平台词表卡（2026-11-05 用户「应该放开允许填写挡位，和具体请求参数」）：
       只拦形态必然发不出去的值（带空格） */
    expect(() => parseLlmProvidersConfig(configWith({ defaultReasoningEffort: 'very high' })))
      .toThrow(/只能是不带空格的短词/)
    expect(() => parseLlmProvidersConfig(configWith({ defaultResponseFormat: 'json' })))
      .toThrow(/defaultResponseFormat 只能是/)
  })

  it('默认挡位必须落在本模型声明的挡位里（否则运行时那一档会被裁掉）', () => {
    // 声明了 low/high，默认却写 medium：文件本身自相矛盾，编辑期就报，不等到运行时静默丢字段
    expect(() => parseLlmProvidersConfig(configWith({
      supportsThinking: true,
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'medium'
    }))).toThrow(/不在 reasoningEfforts/)
    // 落在声明里则通过
    const ok = parseLlmProvidersConfig(configWith({
      supportsThinking: true,
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high'
    }))
    expect(ok.models.find((m) => m.id === 'm-gen')?.defaultReasoningEffort).toBe('high')

    // 上游自有词同样放行：声明什么就发什么，平台不翻译
    const custom = parseLlmProvidersConfig(configWith({
      supportsThinking: true,
      reasoningEfforts: ['xhigh'],
      defaultReasoningEffort: 'xhigh'
    }))
    expect(custom.models.find((m) => m.id === 'm-gen')?.reasoningEfforts).toEqual(['xhigh'])
  })
})
