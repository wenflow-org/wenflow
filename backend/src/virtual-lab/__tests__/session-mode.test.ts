import {
  assertAssistedSessionMode,
  assertBlackboxSessionMode,
  getVirtualSessionMode
} from '../session-mode'

describe('virtual session mode', () => {
  it('严格区分正式 Blackbox 与辅助调试会话', () => {
    const blackbox = { experiment: { mode: 'blackbox-api' } }
    const assisted = { simulationConfig: { frictionBudget: 'normal' } }

    expect(getVirtualSessionMode(blackbox)).toBe('blackbox-api')
    expect(getVirtualSessionMode(assisted)).toBe('assisted')
    expect(() => assertBlackboxSessionMode(blackbox)).not.toThrow()
    expect(() => assertAssistedSessionMode(assisted)).not.toThrow()
    expect(() => assertBlackboxSessionMode(assisted)).toThrow('当前会话不是 blackbox-api 实验')
    expect(() => assertAssistedSessionMode(blackbox)).toThrow('blackbox-api 实验不能使用辅助模式接口')
  })
})
