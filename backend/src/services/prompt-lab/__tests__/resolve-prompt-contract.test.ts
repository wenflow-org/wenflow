import {
  extractPromptContractFromPromptMetadata,
  resolveEffectivePromptContract,
  resolvePromptContract,
} from '../resolve-prompt-contract'
import type { RuntimeContract } from '../runtime-contract'

const distinctivePromptContract = {
  version: 'skill-prompt-contract/v2' as const,
  executionMode: 'llm' as const,
  artifactKind: 'conversation' as const,
  interactionMode: 'turn' as const,
  input: { transport: 'json' as const, schemaSource: 'skill-definition' as const },
  output: { media: 'json' as const, schemaSource: 'runtime-validator' as const, envelope: 'adapter' as const },
  context: {
    envelope: 'context-envelope/v1' as const,
    delivery: 'sidecar' as const,
    modelExposure: 'projected' as const,
  },
  failurePolicy: 'retry' as const,
}

const modelEnvelopeRuntimeContract: RuntimeContract = {
  version: 'prompt-runtime-contract/v1',
  contextMode: 'state-refresh',
  businessState: {
    domain: 'goal-conversation',
    phases: ['understanding', 'ready'],
    defaultPhase: 'understanding',
    terminalPhases: ['ready'],
    statusValues: ['succeeded', 'partial', 'blocked', 'failed'],
  },
  contextUpdate: { mode: 'state-refresh', stateOwner: 'runtime' },
  outputEnvelope: 'model',
}

describe('resolveEffectivePromptContract', () => {
  it('prefers ACTIVE metadata object over manifest/default', async () => {
    const resolved = await resolveEffectivePromptContract(
      'skill:goal-conversation',
      { metadata: { promptLab: { promptContract: distinctivePromptContract } } },
      { archetype: 'conversational' }
    )

    expect(resolved.source).toBe('active-metadata')
    expect(resolved.skillId).toBe('goal-conversation')
    expect(resolved.contract).toEqual(distinctivePromptContract)
  })

  it('prefers ACTIVE metadata JSON string over manifest/default', async () => {
    const resolved = await resolveEffectivePromptContract(
      'skill:goal-conversation',
      {
        metadata: JSON.stringify({
          promptLab: { promptContract: distinctivePromptContract },
        }),
      },
      { archetype: 'conversational' }
    )

    expect(resolved.source).toBe('active-metadata')
    expect(resolved.contract).toEqual(distinctivePromptContract)
  })

  it('falls back to manifest when metadata is absent', async () => {
    const resolved = await resolveEffectivePromptContract(
      'skill:goal-conversation',
      { metadata: null },
      { archetype: 'conversational' }
    )
    const manifest = await resolvePromptContract('skill:goal-conversation', {
      archetype: 'conversational',
    })

    expect(resolved.source).toBe('manifest')
    expect(resolved.source).toBe(manifest.source)
    expect(resolved.contract).toEqual(manifest.contract)
  })

  it('falls back cleanly when metadata JSON is malformed', async () => {
    const resolved = await resolveEffectivePromptContract(
      'skill:goal-conversation',
      { metadata: '{not-json' },
      { archetype: 'conversational' }
    )
    const manifest = await resolvePromptContract('skill:goal-conversation', {
      archetype: 'conversational',
    })

    expect(resolved.source).toBe(manifest.source)
    expect(resolved.contract).toEqual(manifest.contract)
  })

  it('falls back to inferred default for skills without a manifest', async () => {
    const resolved = await resolvePromptContract('skill:no-such-manifest-skill', {
      archetype: 'distiller',
    })

    expect(resolved.source).toBe('default')
    expect(resolved.contract.version).toBe('skill-prompt-contract/v2')
    expect(resolved.contract.executionMode).toBe('llm')
    expect(resolved.contract.artifactKind).toBe('distillation')
  })

  it('extracts null for missing nested contract without throwing', () => {
    expect(
      extractPromptContractFromPromptMetadata(
        { promptLab: { source: 'prompt-file' } },
        'skill:goal-conversation'
      )
    ).toBeNull()
    expect(extractPromptContractFromPromptMetadata(null, 'skill:goal-conversation')).toBeNull()
  })

  it('infers a missing output envelope from the resolved runtimeContract', () => {
    const partial = {
      ...distinctivePromptContract,
      output: { media: 'json', schemaSource: 'runtime-validator' },
    }
    const extracted = extractPromptContractFromPromptMetadata(
      { promptLab: { promptContract: partial } },
      'skill:goal-conversation',
      { archetype: 'conversational', runtimeContract: modelEnvelopeRuntimeContract }
    )

    expect(extracted).not.toBeNull()
    expect(extracted!.output.envelope).toBe('model')
  })
})
