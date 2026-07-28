import { contextEnvelopeFromLegacyInput } from '../context-envelope'

describe('contextEnvelopeFromLegacyInput', () => {
  it('returns undefined without any legacy carrier', () => {
    expect(contextEnvelopeFromLegacyInput({})).toBeUndefined()
    expect(contextEnvelopeFromLegacyInput(null)).toBeUndefined()
    expect(contextEnvelopeFromLegacyInput({ foo: 'bar' })).toBeUndefined()
  })

  it('reads userId from legacy containers', () => {
    const envelope = contextEnvelopeFromLegacyInput({ context: { userId: 'user-context' } })

    expect(envelope?.principal?.userId).toBe('user-context')
  })

  it('covers the ambient top-level input.userId form', () => {
    const envelope = contextEnvelopeFromLegacyInput({ userId: 'user-top-level' })

    expect(envelope?.principal?.userId).toBe('user-top-level')
  })

  it('keeps legacy container precedence over the top-level form', () => {
    const envelope = contextEnvelopeFromLegacyInput({
      userId: 'user-top-level',
      metadata: { userId: 'user-metadata' },
    })

    expect(envelope?.principal?.userId).toBe('user-metadata')
  })

  it('ignores non-string top-level userId values', () => {
    expect(contextEnvelopeFromLegacyInput({ userId: 42 })).toBeUndefined()
  })
})
