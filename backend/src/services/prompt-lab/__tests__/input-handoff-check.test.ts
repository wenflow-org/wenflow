/**
 * inputs 对账三前缀分叉测试（§2.5）：
 * skill: → 路由表 handoff 校验；sandbox: → 沙盘路径注册表；user: → 绿灯。
 */

import { checkInputRefHandoff, checkInputHandoffs } from '../input-handoff-check'
import type { CoreFile } from '../core-file-loader'

jest.mock('../../field-dispatcher', () => ({
  getAgentRoutings: jest.fn(),
}))

jest.mock('../../agent-manifest.service', () => ({
  getAgentOfSkill: jest.fn(() => ({ id: 'path-agent' })),
}))

jest.mock('../../agent-contract-view', () => ({
  validateSandboxPath: jest.fn(),
}))

import { getAgentRoutings } from '../../field-dispatcher'
import { validateSandboxPath } from '../../agent-contract-view'

const mockGetAgentRoutings = getAgentRoutings as jest.MockedFunction<typeof getAgentRoutings>
const mockValidateSandboxPath = validateSandboxPath as jest.MockedFunction<typeof validateSandboxPath>

function makeCore(skillId: string): CoreFile {
  return {
    skillId,
    baseVersion: 1,
    identity: 'x',
    channels: ['dialogue'],
    stateAdvance: false,
    rules: ['r'],
    fields: [{ name: 'f', type: 'string', optional: false, desc: 'd', turn: false }],
    constraints: [],
    params: { temperature: 0.5, maxTokens: 100, failurePolicy: 'retry' },
    deltaOutput: false,
    outputMedia: 'json',
    filePath: 'virtual',
  }
}

describe('checkInputRefHandoff（三前缀分叉）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('user: 前缀绿灯（不查路由，直接通过）', async () => {
    const result = await checkInputRefHandoff(makeCore('demo'), {
      ref: 'user:latestMessage',
      kind: 'user',
      skill: '',
      fieldPath: '',
      sandboxPath: '',
      userPath: 'latestMessage',
    })
    expect(result).toBeNull()
    expect(mockGetAgentRoutings).not.toHaveBeenCalled()
  })

  it('sandbox: 已注册路径通过，未注册报 sandbox-path-unregistered', async () => {
    mockValidateSandboxPath.mockResolvedValueOnce(null)
    const ok = await checkInputRefHandoff(makeCore('demo'), {
      ref: 'sandbox:path.normalizedInput',
      kind: 'sandbox',
      skill: '',
      fieldPath: '',
      sandboxPath: 'path.normalizedInput',
      userPath: '',
    })
    expect(ok).toBeNull()
    expect(mockValidateSandboxPath).toHaveBeenCalledWith('path.normalizedInput')

    mockValidateSandboxPath.mockResolvedValueOnce('sandbox 路径 ghost.key 未注册')
    const bad = await checkInputRefHandoff(makeCore('demo'), {
      ref: 'sandbox:ghost.key',
      kind: 'sandbox',
      skill: '',
      fieldPath: '',
      sandboxPath: 'ghost.key',
      userPath: '',
    })
    expect(bad).toEqual(expect.objectContaining({ code: 'sandbox-path-unregistered' }))
  })

  it('skill: 路由表匹配且 handoff 包含本 skill 时通过', async () => {
    mockGetAgentRoutings.mockResolvedValue([
      { agentId: 'skill:path-planning', fieldId: 'milestones.title', render: 'visible', handoff: ['skill:stage-designer'], internal: false, accumulate: false, pathInRawOutput: null },
    ])
    const result = await checkInputRefHandoff(makeCore('stage-designer'), {
      ref: 'skill:path-planning.milestones',
      kind: 'skill',
      skill: 'path-planning',
      fieldPath: 'milestones',
      sandboxPath: '',
      userPath: '',
    })
    expect(result).toBeNull()
  })

  it('skill: 路由表无匹配字段时报 input-field-unrouted', async () => {
    mockGetAgentRoutings.mockResolvedValue([
      { agentId: 'skill:path-planning', fieldId: 'cognitiveCore.cognitiveDomain', render: 'visible', handoff: ['path-agent'], internal: false, accumulate: false, pathInRawOutput: null },
    ])
    const result = await checkInputRefHandoff(makeCore('stage-designer'), {
      ref: 'skill:path-planning.ghostField',
      kind: 'skill',
      skill: 'path-planning',
      fieldPath: 'ghostField',
      sandboxPath: '',
      userPath: '',
    })
    expect(result).toEqual(expect.objectContaining({ code: 'input-field-unrouted' }))
  })

  it('checkInputHandoffs 遍历全部 inputs 并过滤通过项', async () => {
    mockGetAgentRoutings.mockResolvedValue([])
    const core = makeCore('demo')
    core.inputs = [
      { ref: 'user:latestMessage', kind: 'user', skill: '', fieldPath: '', sandboxPath: '', userPath: 'latestMessage' },
      { ref: 'skill:path-planning.milestones', kind: 'skill', skill: 'path-planning', fieldPath: 'milestones', sandboxPath: '', userPath: '' },
    ]
    const issues = await checkInputHandoffs(core)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('input-upstream-unrouted')
  })
})
