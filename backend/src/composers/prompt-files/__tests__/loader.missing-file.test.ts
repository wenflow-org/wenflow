const mockWarn = jest.fn()

jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockWarn(...args),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}))

import { loadPromptFile } from '../loader'

describe('loadPromptFile 编译产物缺失时的告警（审计 §5.1）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('缺失时返回 null 并明确告警（不再静默回退 DB）', () => {
    const id = 'skill:definitely-missing-prompt-file-xyz'

    expect(loadPromptFile(id)).toBeNull()

    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(String(mockWarn.mock.calls[0][0])).toContain('编译产物')
    expect(mockWarn.mock.calls[0][1]).toEqual(expect.objectContaining({ agentId: id }))
  })

  it('同一 agentId 只告警一次（避免 20+ skill 顶层调用刷屏）', () => {
    const id = 'skill:another-missing-prompt-file-abc'

    loadPromptFile(id)
    loadPromptFile(id)
    loadPromptFile(id)

    expect(mockWarn).toHaveBeenCalledTimes(1)
  })
})
