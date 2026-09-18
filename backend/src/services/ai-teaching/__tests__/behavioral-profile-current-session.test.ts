/**
 * 行为画像/求助软拦截必须计入**本节课（进行中）**（18 号报告 N9）。
 *
 * 此前 `fetchBehavioralProfile` 只统计 `status='completed'` 的历史会话，
 * 于是"本节课里连续直接要答案"这一最该被软拦截的场景计数恒为 0。
 */
const mockTeachingFindMany = jest.fn()
const mockMemoryFindMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { findMany: mockTeachingFindMany },
    memory_traces: { findMany: mockMemoryFindMany },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { fetchBehavioralProfile } from '../TeachingContextBuilder'

describe('fetchBehavioralProfile：计入本节课的求助行为（18 号报告 N9）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('本节课连续要答案 → helpSeekingCount 非 0（旧实现恒为 0）', async () => {
    mockTeachingFindMany.mockResolvedValue([])
    mockMemoryFindMany.mockResolvedValue([])

    const profile = await fetchBehavioralProfile('u1', {
      messages: [
        { role: 'assistant', analysis: { helpSeekingType: 'answer', understanding: 0.5 } },
        { role: 'user', content: '直接告诉我答案' },
        { role: 'assistant', analysis: { helpSeekingType: 'answer', understanding: 0.5 } },
      ],
    })

    expect(profile?.helpSeekingCount).toBe(2)
    expect(profile?.recentHelpSeeking).toEqual(['answer', 'answer'])
    expect(profile?.sampleSize).toBe(2)
  })

  it('历史 + 本节课合并：本节课的求助排在最近（slice(-5) 取新）', async () => {
    mockTeachingFindMany.mockResolvedValue([
      { messages: [{ role: 'assistant', analysis: { helpSeekingType: 'hint', understanding: 0.7 } }] },
    ])
    mockMemoryFindMany.mockResolvedValue([])

    const profile = await fetchBehavioralProfile('u1', {
      messages: [{ role: 'assistant', analysis: { helpSeekingType: 'answer', understanding: 0.6 } }],
    })

    expect(profile?.helpSeekingCount).toBe(2)
    expect(profile?.recentHelpSeeking).toEqual(['hint', 'answer'])
  })

  it('不传本节课时行为与旧版一致（仅历史）', async () => {
    mockTeachingFindMany.mockResolvedValue([
      { messages: [{ role: 'assistant', analysis: { helpSeekingType: 'hint', understanding: 0.7 } }] },
    ])
    mockMemoryFindMany.mockResolvedValue([])

    const profile = await fetchBehavioralProfile('u1')

    expect(profile?.helpSeekingCount).toBe(1)
    expect(profile?.recentHelpSeeking).toEqual(['hint'])
  })
})
