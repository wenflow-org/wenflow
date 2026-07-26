import {
  extractRuntimeContractFromPromptMetadata,
  resolveEffectiveRuntimeContract,
  resolveRuntimeContract,
} from '../resolve-runtime-contract'

const distinctiveContract = {
  version: 'prompt-runtime-contract/v1' as const,
  contextMode: 'snapshot-context' as const,
  businessState: {
    domain: 'active-goal-domain',
    phases: ['understanding', 'proposing', 'ready', 'completed'],
    defaultPhase: 'understanding',
    terminalPhases: ['ready', 'completed'],
    statusValues: ['succeeded', 'partial', 'blocked', 'failed'] as Array<
      'succeeded' | 'partial' | 'blocked' | 'failed'
    >,
  },
  contextUpdate: {
    mode: 'thread-state' as const,
    stateOwner: 'model' as const,
    description: 'test active metadata contract',
  },
  outputEnvelope: 'adapter' as const,
}

describe('resolveEffectiveRuntimeContract', () => {
  it('prefers ACTIVE metadata object over manifest/default', async () => {
    const resolved = await resolveEffectiveRuntimeContract(
      'skill:goal-conversation',
      { metadata: { promptLab: { runtimeContract: distinctiveContract } } },
      { archetype: 'conversational' }
    )

    expect(resolved.source).toBe('active-metadata')
    expect(resolved.skillId).toBe('goal-conversation')
    expect(resolved.contract.businessState.domain).toBe('active-goal-domain')
    expect(resolved.contract.contextMode).toBe('snapshot-context')
    expect(resolved.contract.contextUpdate.mode).toBe('thread-state')
    expect(resolved.contract.contextUpdate.stateOwner).toBe('model')
  })

  it('prefers ACTIVE metadata JSON string over manifest/default', async () => {
    const resolved = await resolveEffectiveRuntimeContract(
      'skill:goal-conversation',
      {
        metadata: JSON.stringify({
          promptLab: { runtimeContract: distinctiveContract },
        }),
      },
      { archetype: 'conversational' }
    )

    expect(resolved.source).toBe('active-metadata')
    expect(resolved.contract.businessState.domain).toBe('active-goal-domain')
    expect(resolved.contract.contextUpdate.stateOwner).toBe('model')
  })

  it('falls back to manifest when metadata is absent', async () => {
    const resolved = await resolveEffectiveRuntimeContract(
      'skill:goal-conversation',
      { metadata: null },
      { archetype: 'conversational' }
    )
    const manifest = await resolveRuntimeContract('skill:goal-conversation', {
      archetype: 'conversational',
    })

    expect(resolved.source).toBe(manifest.source)
    expect(resolved.contract).toEqual(manifest.contract)
  })

  it('falls back cleanly when metadata JSON is malformed', async () => {
    const resolved = await resolveEffectiveRuntimeContract(
      'skill:goal-conversation',
      { metadata: '{not-json' },
      { archetype: 'conversational' }
    )
    const manifest = await resolveRuntimeContract('skill:goal-conversation', {
      archetype: 'conversational',
    })

    expect(resolved.source).toBe(manifest.source)
    expect(resolved.contract).toEqual(manifest.contract)
  })

  it('extracts null for missing nested contract without throwing', () => {
    expect(
      extractRuntimeContractFromPromptMetadata(
        { promptLab: { source: 'prompt-file' } },
        'skill:goal-conversation'
      )
    ).toBeNull()
    expect(extractRuntimeContractFromPromptMetadata(null, 'skill:goal-conversation')).toBeNull()
  })
})
