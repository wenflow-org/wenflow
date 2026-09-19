import { selectModelForAlias } from '../model-alias'

describe('selectModelForAlias（逻辑名 → 部署）', () => {
  it('非别名（具体模型 id / 未知值）返回 null，由调用方原样使用', () => {
    expect(selectModelForAlias('deepseek-v4-flash')).toBeNull()
    expect(selectModelForAlias('unknown-model')).toBeNull()
    expect(selectModelForAlias('')).toBeNull()
  })

  it('chat 别名按声明顺序取第一位', () => {
    const selection = selectModelForAlias('chat')
    expect(selection).toEqual({
      alias: 'chat',
      model: 'deepseek-v4-flash',
      members: ['deepseek-v4-flash', 'agnes-3.0-flash'],
      degraded: false
    })
  })

  it('大小写与空白不敏感', () => {
    expect(selectModelForAlias('  CHAT ')?.model).toBe('deepseek-v4-flash')
  })

  it('requireThinking 按能力过滤：chat 别名会跳过不支持思考的成员', () => {
    // chat = [flash(支持思考), agnes(不支持)] → 仍选 flash
    const selection = selectModelForAlias('chat', { requireThinking: true })
    expect(selection?.model).toBe('deepseek-v4-flash')
    expect(selection?.degraded).toBe(false)
  })

  it('无成员满足 requireThinking 时降级为第一位并标记 degraded', () => {
    // light = [agnes(不支持思考)] → 降级
    const selection = selectModelForAlias('light', { requireThinking: true })
    expect(selection?.model).toBe('agnes-3.0-flash')
    expect(selection?.degraded).toBe(true)
  })

  it('reasoning 别名在能力过滤下选 pro', () => {
    expect(selectModelForAlias('reasoning', { requireThinking: true })?.model).toBe('deepseek-v4-pro')
    expect(selectModelForAlias('reasoning')?.model).toBe('deepseek-v4-pro')
  })

  it('DB 覆盖优先于代码注册表', () => {
    const overrides = { chat: ['agnes-3.0-flash'] }
    expect(selectModelForAlias('chat', { overrides })?.model).toBe('agnes-3.0-flash')
    // 覆盖为空数组时回退代码注册表
    expect(selectModelForAlias('chat', { overrides: { chat: [] } })?.model).toBe('deepseek-v4-flash')
  })

  it('覆盖里含未注册模型时被过滤；过滤后为空则视为无法解析', () => {
    const filtered = selectModelForAlias('chat', { overrides: { chat: ['not-registered', 'agnes-3.0-flash'] } })
    expect(filtered?.model).toBe('agnes-3.0-flash')
    expect(selectModelForAlias('chat', { overrides: { chat: ['not-registered'] } })).toBeNull()
  })
})
