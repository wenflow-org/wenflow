import { getCanonicalAgentId, getAgentManifest } from '../agent-manifest.service'

describe('goal-conversation alias (Phase 3)', () => {
  it('resolves bare goal-conversation to skill, not goal-agent', () => {
    expect(getCanonicalAgentId('goal-conversation')).toBe('skill:goal-conversation')
    expect(getCanonicalAgentId('skill:goal-conversation')).toBe('skill:goal-conversation')
    expect(getCanonicalAgentId('goal-conversation-agent')).toBe('skill:goal-conversation')
  })

  it('keeps requirement-agent as goal-agent orchestrator alias', () => {
    expect(getCanonicalAgentId('requirement-agent')).toBe('goal-agent')
    expect(getCanonicalAgentId('goal-agent')).toBe('goal-agent')
  })

  it('aligns skill defaultModelConfig maxTokens with File-as-Truth prompt', () => {
    const skill = getAgentManifest('skill:goal-conversation')
    expect(skill?.kind).toBe('skill')
    expect(skill?.defaultModelConfig?.maxTokens).toBe(32000)
    expect(skill?.defaultModelConfig?.temperature).toBe(0.7)
  })
})
