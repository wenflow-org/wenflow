/**
 * D2 回归：健康中心「契约一致性」差异明细必须带一句
 * 「admin 手工编辑的覆盖行，契约同步会跳过」说明；clean 时不得出现该句。
 * 真实库里当前契约干净，无法在浏览器触发差异分支，故在此定点构造报告。
 */
const mockParity = jest.fn()

jest.mock('../prompt-manifest/check-prompt-runtime-contract-metadata-parity', () => ({
  analyzePromptRuntimeContractMetadataParity: (...args: unknown[]) => mockParity(...args),
  collectDeclaredPromptRuntimeContractAgentIdCandidates: () => [],
  queryActivePromptRuntimeContractMetadataRows: async () => [],
}))

import { buildHealthCenterReport, resetHealthCenterCache, type HealthCenterDbAdapter } from '../health-center.service'

const EMPTY_DB: HealthCenterDbAdapter = {
  agent_prompts: { findMany: jest.fn().mockResolvedValue([]) },
  skill_registrations: { findMany: jest.fn().mockResolvedValue([]) },
  agent_contracts: { findMany: jest.fn().mockResolvedValue([]) },
  field_definitions: { findMany: jest.fn().mockResolvedValue([]) },
  agent_field_routings: { findMany: jest.fn().mockResolvedValue([]) },
  node_config_changes: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  prompt_call_logs: { findMany: jest.fn().mockResolvedValue([]) },
}

const NOTE = '若差异行是 admin 手工编辑的覆盖行，契约同步会跳过它，需人工确认后再处理。'

function report(results: unknown[], errorCount: number) {
  return {
    diagnostics: [],
    results,
    summary: {
      scannedFiles: 1,
      declaredRuntimeContractFiles: 1,
      declaredPromptContractFiles: 1,
      skippedFilesWithoutRuntimeContract: 0,
      skippedFilesWithoutAnyContract: 0,
      skippedCodeOnlyFiles: 0,
      diagnosticCount: 0,
      resultCount: results.length,
      inSyncCount: results.length - errorCount,
      errorCount,
      statuses: {},
    },
    hasErrors: errorCount > 0,
  }
}

async function contractParityItem() {
  resetHealthCenterCache()
  const report = await buildHealthCenterReport(EMPTY_DB)
  return report.items.find((item) => item.id === 'contract-parity')!
}

beforeEach(() => {
  mockParity.mockReset()
})

describe('D2 契约差异明细的覆盖行说明', () => {
  it('有差异：明细包含差异行 + 覆盖行说明', async () => {
    mockParity.mockReturnValue(report([
      { agentId: 'goal-conversation', filePath: 'prompts/agent-goal-conversation.md', acceptableAgentIds: [], status: 'missing-active', detail: 'ACTIVE 行缺失' },
    ], 1))

    const item = await contractParityItem()
    expect(item.status).toBe('drifted')
    expect(item.count).toBe(1)
    expect(item.detail[0]).toContain('goal-conversation status=missing-active')
    expect(item.detail).toContain(NOTE)
  })

  it('clean：明细为空且不出现覆盖行说明', async () => {
    mockParity.mockReturnValue(report([], 0))

    const item = await contractParityItem()
    expect(item.status).toBe('clean')
    expect(item.detail).toEqual([])
    expect(item.detail).not.toContain(NOTE)
  })
})
