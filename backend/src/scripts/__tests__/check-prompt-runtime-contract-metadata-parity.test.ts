import type { PromptFile, PromptFileScanResult } from '../../composers/prompt-files/loader'
import {
  analyzePromptRuntimeContractMetadataParity,
  checkPromptRuntimeContractMetadataParity,
  type ActivePromptRuntimeContractMetadataRow,
} from '../check-prompt-runtime-contract-metadata-parity'
import { buildV4CorePromptMetadata } from '../../services/prompt-lab/core-prompt-metadata'
import { computeCoreHash, loadCoreFile } from '../../services/prompt-lab/core-file-loader'

function validRuntimeContract() {
  return {
    version: 'prompt-runtime-contract/v1',
    contextMode: 'thread-context',
    businessState: {
      domain: 'teaching',
      phases: ['turn-generated', 'completed'],
      defaultPhase: 'turn-generated',
      terminalPhases: ['completed'],
      statusValues: ['succeeded', 'partial', 'blocked', 'failed'],
    },
    contextUpdate: {
      mode: 'thread-state',
      stateOwner: 'orchestrator',
    },
    outputEnvelope: 'adapter',
  }
}

function validPromptContract() {
  return {
    version: 'skill-prompt-contract/v2',
    executionMode: 'llm',
    artifactKind: 'conversation',
    interactionMode: 'turn',
    input: { transport: 'json', schemaSource: 'skill-definition' },
    output: { media: 'json', schemaSource: 'runtime-validator', envelope: 'adapter' },
    context: { envelope: 'context-envelope/v1', delivery: 'sidecar', modelExposure: 'projected' },
    failurePolicy: 'retry',
  }
}

function makeFile(overrides: Partial<PromptFile> = {}): PromptFile {
  return {
    agentId: 'skill:learning-turn',
    name: 'default-skill-learning-turn',
    systemPrompt: 'System prompt',
    filePath: 'D:/prompts/skill.learning-turn.md',
    archetype: 'conversational',
    runtimeContract: validRuntimeContract(),
    ...overrides,
  }
}

function makeRow(overrides: Partial<ActivePromptRuntimeContractMetadataRow> = {}): ActivePromptRuntimeContractMetadataRow {
  return {
    id: 'prompt-1',
    agentId: 'skill:learning-turn',
    version: 3,
    metadata: JSON.stringify({
      promptLab: {
        runtimeContract: validRuntimeContract(),
      },
    }),
    ...overrides,
  }
}

function analyze(files: PromptFile[], activeRows: ActivePromptRuntimeContractMetadataRow[] = []) {
  return analyzePromptRuntimeContractMetadataParity({ files, activeRows })
}

describe('prompt runtime-contract metadata parity checker', () => {
  it('reports an in-sync canonical ACTIVE metadata contract', () => {
    const report = analyze([makeFile()], [makeRow()])

    expect(report.hasErrors).toBe(false)
    expect(report.summary).toMatchObject({
      declaredRuntimeContractFiles: 1,
      skippedFilesWithoutRuntimeContract: 0,
      inSyncCount: 1,
      errorCount: 0,
    })
    expect(report.results).toEqual([expect.objectContaining({
      agentId: 'skill:learning-turn',
      status: 'in-sync',
    })])
  })

  it('excludes files without a declared runtime contract from comparison scope', () => {
    const report = analyze([
      makeFile(),
      makeFile({
        agentId: 'skill:no-declaration',
        filePath: 'D:/prompts/skill.no-declaration.md',
        runtimeContract: undefined,
      }),
    ], [makeRow()])

    expect(report.results).toHaveLength(1)
    expect(report.summary).toMatchObject({
      scannedFiles: 2,
      declaredRuntimeContractFiles: 1,
      skippedFilesWithoutRuntimeContract: 1,
    })
  })

  it('uses v4 manifest contracts when the Runtime Prompt frontmatter carries coreHash', () => {
    const coreHash = computeCoreHash(loadCoreFile('learning-turn')!.core!)
    const v4File = makeFile({
      coreHash,
      coreVersion: 1,
      runtimeContract: undefined,
      promptContract: undefined,
    })
    const report = analyze([v4File], [makeRow({
      metadata: buildV4CorePromptMetadata({
        skillId: 'learning-turn', coreHash, coreVersion: 1,
      }),
    })])

    expect(report.hasErrors).toBe(false)
    expect(report.results[0]).toMatchObject({
      status: 'in-sync', runtimeContractStatus: 'in-sync', promptContractStatus: 'in-sync',
    })
  })

  it('reports a normalized structural mismatch', () => {
    const activeContract = validRuntimeContract()
    activeContract.businessState.domain = 'other-domain'
    const report = analyze([makeFile()], [makeRow({
      metadata: JSON.stringify({ promptLab: { runtimeContract: activeContract } }),
    })])

    expect(report.results[0]).toMatchObject({ status: 'mismatch' })
    expect(report.hasErrors).toBe(true)
  })

  it('reports invalid file declarations instead of inferring a default', () => {
    const report = analyze([makeFile({
      runtimeContract: { ...validRuntimeContract(), contextMode: 'not-a-mode' },
    })], [makeRow()])

    expect(report.results[0]).toMatchObject({
      status: 'invalid-file-declaration',
      detail: expect.stringContaining('invalid runtimeContract.contextMode'),
    })
  })

  it('keeps malformed JSON metadata distinct', () => {
    const report = analyze([makeFile()], [makeRow({ metadata: '{not json' })])

    expect(report.results[0]).toMatchObject({ status: 'malformed-metadata-json' })
  })

  it('keeps missing and non-object metadata distinct', () => {
    const missing = analyze([makeFile()], [makeRow({ metadata: null })])
    const nonObject = analyze([makeFile()], [makeRow({ metadata: '[]' })])

    expect(missing.results[0]).toMatchObject({ status: 'missing-metadata' })
    expect(nonObject.results[0]).toMatchObject({ status: 'metadata-non-object' })
  })

  it('reports a missing nested runtime contract without modifying metadata', () => {
    const metadata = JSON.stringify({ promptLab: { source: 'prompt-file' } })
    const report = analyze([makeFile()], [makeRow({ metadata })])

    expect(report.results[0]).toMatchObject({ status: 'missing-nested-contract' })
    expect(metadata).toBe(JSON.stringify({ promptLab: { source: 'prompt-file' } }))
  })

  it('distinguishes a malformed nested runtime contract from a missing one', () => {
    const report = analyze([makeFile()], [makeRow({
      metadata: JSON.stringify({ promptLab: { runtimeContract: { contextMode: 'invalid' } } }),
    })])

    expect(report.results[0]).toMatchObject({ status: 'malformed-nested-contract' })
  })

  it('requires the sole ACTIVE row to use the canonical agent ID', () => {
    const report = analyze([makeFile({ acceptableAgentIds: ['learning-turn'] })], [makeRow({
      agentId: 'learning-turn',
    })])

    expect(report.results[0]).toMatchObject({
      status: 'active-alias-not-canonical',
      activePrompt: { agentId: 'learning-turn' },
    })
  })

  it('reports multiple ACTIVE rows across canonical and aliases as ambiguous', () => {
    const report = analyze([makeFile({ acceptableAgentIds: ['learning-turn'] })], [
      makeRow(),
      makeRow({ id: 'prompt-2', agentId: 'learning-turn', version: 2 }),
    ])

    expect(report.results[0]).toMatchObject({ status: 'ambiguous-active' })
    expect(report.results[0].activePrompts).toHaveLength(2)
  })

  it('does not compare duplicate canonical IDs or colliding source aliases', () => {
    const report = analyze([
      makeFile({ filePath: 'D:/prompts/one.md', acceptableAgentIds: ['skill:shared'] }),
      makeFile({ filePath: 'D:/prompts/two.md', acceptableAgentIds: ['skill:shared'] }),
      makeFile({ agentId: 'skill:other', filePath: 'D:/prompts/three.md', acceptableAgentIds: ['skill:shared'] }),
    ], [makeRow()])

    expect(report.results).toEqual([
      expect.objectContaining({
        filePath: 'D:/prompts/one.md',
        status: 'duplicate-canonical-agent-id',
        sourceIssues: expect.arrayContaining(['duplicate-canonical-agent-id', 'alias-collision']),
      }),
      expect.objectContaining({
        filePath: 'D:/prompts/two.md',
        status: 'duplicate-canonical-agent-id',
        sourceIssues: expect.arrayContaining(['duplicate-canonical-agent-id', 'alias-collision']),
      }),
      expect.objectContaining({
        filePath: 'D:/prompts/three.md',
        status: 'alias-collision',
        sourceIssues: ['alias-collision'],
      }),
    ])
  })

  it('reports an in-sync promptContract for a prompt-only declaration', () => {
    const report = analyze([
      makeFile({ runtimeContract: undefined, promptContract: validPromptContract() }),
    ], [makeRow({
      metadata: JSON.stringify({ promptLab: { promptContract: validPromptContract() } }),
    })])

    expect(report.hasErrors).toBe(false)
    expect(report.results[0]).toMatchObject({
      status: 'in-sync',
      runtimeContractStatus: 'not-declared',
      promptContractStatus: 'in-sync',
    })
    expect(report.summary).toMatchObject({
      declaredRuntimeContractFiles: 0,
      declaredPromptContractFiles: 1,
      skippedFilesWithoutRuntimeContract: 1,
      skippedFilesWithoutAnyContract: 0,
    })
  })

  it('reports both dimensions in-sync when both are declared and matching', () => {
    const report = analyze([
      makeFile({ promptContract: validPromptContract() }),
    ], [makeRow({
      metadata: JSON.stringify({
        promptLab: {
          runtimeContract: validRuntimeContract(),
          promptContract: validPromptContract(),
        },
      }),
    })])

    expect(report.hasErrors).toBe(false)
    expect(report.results[0]).toMatchObject({
      status: 'in-sync',
      runtimeContractStatus: 'in-sync',
      promptContractStatus: 'in-sync',
    })
  })

  it('reports a promptContract mismatch with a per-dimension detail', () => {
    const drifted = { ...validPromptContract(), failurePolicy: 'blocking' }
    const report = analyze([
      makeFile({ runtimeContract: undefined, promptContract: validPromptContract() }),
    ], [makeRow({
      metadata: JSON.stringify({ promptLab: { promptContract: drifted } }),
    })])

    expect(report.results[0]).toMatchObject({
      status: 'mismatch',
      runtimeContractStatus: 'not-declared',
      promptContractStatus: 'mismatch',
      detail: 'promptContract: mismatch',
    })
    expect(report.hasErrors).toBe(true)
  })

  it('reports a missing nested promptContract without touching the runtime dimension', () => {
    const report = analyze([
      makeFile({ promptContract: validPromptContract() }),
    ], [makeRow()])

    expect(report.results[0]).toMatchObject({
      status: 'missing-nested-contract',
      runtimeContractStatus: 'in-sync',
      promptContractStatus: 'missing-nested-contract',
    })
    expect(report.hasErrors).toBe(true)
  })

  it('reports a malformed nested promptContract', () => {
    const report = analyze([
      makeFile({ runtimeContract: undefined, promptContract: validPromptContract() }),
    ], [makeRow({
      metadata: JSON.stringify({ promptLab: { promptContract: { executionMode: 'llm' } } }),
    })])

    expect(report.results[0]).toMatchObject({
      status: 'malformed-nested-contract',
      promptContractStatus: 'malformed-nested-contract',
    })
  })

  it('rejects an invalid declared promptContract instead of normalizing it', () => {
    const invalid = { ...validPromptContract(), failurePolicy: 'not-a-policy' }
    const report = analyze([
      makeFile({ runtimeContract: undefined, promptContract: invalid }),
    ], [makeRow()])

    expect(report.results[0]).toMatchObject({
      status: 'invalid-file-declaration',
      promptContractStatus: 'invalid-file-declaration',
      detail: expect.stringContaining('invalid promptContract'),
    })
  })

  it('excludes code-only files from the DB sync comparison scope', () => {
    const report = analyze([
      makeFile(),
      makeFile({
        agentId: 'skill:code-only-skill',
        filePath: 'D:/prompts/skill.code-only-skill.md',
        archetype: 'code-only',
        runtimeContract: undefined,
        promptContract: {
          ...validPromptContract(),
          executionMode: 'code-only',
          artifactKind: 'code',
          interactionMode: 'none',
          input: { transport: 'none', schemaSource: 'none' },
          output: { media: 'none', schemaSource: 'none', envelope: 'none' },
          context: { envelope: 'none', delivery: 'none', modelExposure: 'none' },
          failurePolicy: 'none',
        },
      }),
    ], [makeRow()])

    expect(report.results).toHaveLength(1)
    expect(report.summary).toMatchObject({
      scannedFiles: 2,
      declaredRuntimeContractFiles: 1,
      declaredPromptContractFiles: 0,
      skippedFilesWithoutRuntimeContract: 0,
      skippedFilesWithoutAnyContract: 0,
      skippedCodeOnlyFiles: 1,
    })
  })

  it('uses one exact ACTIVE-only read query and exposes no write path', async () => {
    const findMany = jest.fn().mockResolvedValue([makeRow()])
    const create = jest.fn()
    const update = jest.fn()
    const deleteRecord = jest.fn()
    const transaction = jest.fn()
    const prisma = {
      agent_prompts: { findMany, create, update, delete: deleteRecord },
      $transaction: transaction,
    }
    const scan: PromptFileScanResult = { files: [makeFile()], diagnostics: [] }

    const report = await checkPromptRuntimeContractMetadataParity(prisma, scan)

    expect(report.results[0]).toMatchObject({ status: 'in-sync' })
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        agentId: { in: ['skill:learning-turn'] },
      },
      select: {
        id: true,
        agentId: true,
        version: true,
        metadata: true,
      },
      orderBy: [
        { agentId: 'asc' },
        { version: 'desc' },
        { id: 'asc' },
      ],
    })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(deleteRecord).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})
