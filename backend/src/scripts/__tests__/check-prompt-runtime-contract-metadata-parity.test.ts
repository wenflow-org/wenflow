import type { PromptFile, PromptFileScanResult } from '../../composers/prompt-files/loader'
import {
  analyzePromptRuntimeContractMetadataParity,
  checkPromptRuntimeContractMetadataParity,
  type ActivePromptRuntimeContractMetadataRow,
} from '../check-prompt-runtime-contract-metadata-parity'

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

function makeFile(overrides: Partial<PromptFile> = {}): PromptFile {
  return {
    agentId: 'skill:teaching-turn',
    name: 'default-skill-teaching-turn',
    systemPrompt: 'System prompt',
    filePath: 'D:/prompts/skill.teaching-turn.md',
    archetype: 'conversational',
    runtimeContract: validRuntimeContract(),
    ...overrides,
  }
}

function makeRow(overrides: Partial<ActivePromptRuntimeContractMetadataRow> = {}): ActivePromptRuntimeContractMetadataRow {
  return {
    id: 'prompt-1',
    agentId: 'skill:teaching-turn',
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
      agentId: 'skill:teaching-turn',
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
    const report = analyze([makeFile({ acceptableAgentIds: ['teaching-turn'] })], [makeRow({
      agentId: 'teaching-turn',
    })])

    expect(report.results[0]).toMatchObject({
      status: 'active-alias-not-canonical',
      activePrompt: { agentId: 'teaching-turn' },
    })
  })

  it('reports multiple ACTIVE rows across canonical and aliases as ambiguous', () => {
    const report = analyze([makeFile({ acceptableAgentIds: ['teaching-turn'] })], [
      makeRow(),
      makeRow({ id: 'prompt-2', agentId: 'teaching-turn', version: 2 }),
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
        filePath: 'D:/prompts/three.md',
        status: 'alias-collision',
        sourceIssues: ['alias-collision'],
      }),
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
    ])
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
        agentId: { in: ['skill:teaching-turn'] },
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
