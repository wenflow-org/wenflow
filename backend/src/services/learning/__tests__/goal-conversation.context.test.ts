import { selectGoalHistory, RECENT_CONTEXT_LIMIT } from '../goal-conversation.context'

describe('selectGoalHistory（契约 contextMode 不再被静默忽略，审计 §1.3）', () => {
  const history = Array.from({ length: 25 }, (_, i) => i + 1)

  it('full：原样全量回传', () => {
    expect(selectGoalHistory(history, 'full')).toBe(history)
  })

  it('未指定：等价 full，不改变既有行为', () => {
    expect(selectGoalHistory(history, undefined)).toBe(history)
  })

  it('recent：只回传最近 RECENT_CONTEXT_LIMIT 条（保留最新、丢弃最早）', () => {
    const selected = selectGoalHistory(history, 'recent')
    expect(selected).toHaveLength(RECENT_CONTEXT_LIMIT)
    expect(selected[selected.length - 1]).toBe(25)
    expect(selected[0]).toBe(25 - RECENT_CONTEXT_LIMIT + 1)
  })

  it('recent 且历史未超上限：原样返回（不复制、不截断）', () => {
    const short = [1, 2, 3]
    expect(selectGoalHistory(short, 'recent')).toBe(short)
  })

  it('limit 为 0 / 负数时不产生「全量」误返（slice(-0) 陷阱）', () => {
    expect(selectGoalHistory(history, 'recent', 0)).toEqual([])
    expect(selectGoalHistory(history, 'recent', -5)).toEqual([])
  })

  it('custom limit 生效', () => {
    expect(selectGoalHistory(history, 'recent', 3)).toEqual([23, 24, 25])
  })
})
