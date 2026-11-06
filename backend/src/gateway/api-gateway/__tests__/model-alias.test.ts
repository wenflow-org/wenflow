import { selectModelForAlias } from '../model-alias'

describe('selectModelForAlias（逻辑名 → 部署）', () => {
  it('非别名（具体模型 id / 未知值）返回 null，由调用方原样使用', () => {
    expect(selectModelForAlias('deepseek-v4.1-flash')).toBeNull()
    expect(selectModelForAlias('unknown-model')).toBeNull()
    expect(selectModelForAlias('')).toBeNull()
  })

  it('chat 别名按声明顺序取第一位', () => {
    // 夹具改用注册表内 enabled 的模型：agnes-3.0-flash 只存在于停用的示例 provider，展开时会被过滤。
    const selection = selectModelForAlias('chat', {
      overrides: { chat: ['agnes-2.5-flash', 'deepseek-v4.1-flash'] }
    })
    expect(selection).toEqual({
      alias: 'chat',
      model: 'agnes-2.5-flash',
      members: ['agnes-2.5-flash', 'deepseek-v4.1-flash'],
      degraded: false
    })
  })

  it('大小写与空白不敏感', () => {
    expect(selectModelForAlias('  CHAT ')?.model).toBe('deepseek-v4.1-flash')
  })

  it('requireThinking 按能力过滤：chat 别名会跳过不支持思考的成员', () => {
    // chat 声明里第一位 agnes-2.5-flash 不支持思考 → 跳过它选 v4.1-flash
    const selection = selectModelForAlias('chat', {
      overrides: { chat: ['agnes-2.5-flash', 'deepseek-v4.1-flash'] },
      requireThinking: true
    })
    expect(selection?.model).toBe('deepseek-v4.1-flash')
    expect(selection?.degraded).toBe(false)
  })

  it('无成员满足 requireThinking 时降级为第一位并标记 degraded', () => {
    // 覆盖只含 agnes-2.5-flash（不支持思考）→ 降级
    const selection = selectModelForAlias('light', {
      overrides: { light: ['agnes-2.5-flash'] },
      requireThinking: true
    })
    expect(selection?.model).toBe('agnes-2.5-flash')
    expect(selection?.degraded).toBe(true)
  })

  it('reasoning 别名在能力过滤下选支持思考的 v4.1-flash（2026-10-18 起唯一成员）', () => {
    expect(selectModelForAlias('reasoning', { requireThinking: true })?.model).toBe('deepseek-v4.1-flash')
    expect(selectModelForAlias('reasoning')?.model).toBe('deepseek-v4.1-flash')
  })

  it('DB 覆盖优先于代码注册表', () => {
    const overrides = { chat: ['agnes-2.5-flash'] }
    expect(selectModelForAlias('chat', { overrides })?.model).toBe('agnes-2.5-flash')
    // 覆盖为空数组时回退代码注册表
    expect(selectModelForAlias('chat', { overrides: { chat: [] } })?.model).toBe('deepseek-v4.1-flash')
  })

  it('覆盖里含未注册模型时被过滤；过滤后为空则视为无法解析', () => {
    const filtered = selectModelForAlias('chat', { overrides: { chat: ['not-registered', 'agnes-2.5-flash'] } })
    expect(filtered?.model).toBe('agnes-2.5-flash')
    expect(selectModelForAlias('chat', { overrides: { chat: ['not-registered'] } })).toBeNull()
  })
})
