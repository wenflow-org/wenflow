/**
 * inputs 对账三前缀分叉测试（§2.5）：
 * skill: → 路由表 handoff 校验；sandbox: → 沙盘路径注册表；user: → 绿灯。
 */

import { checkInputRefHandoff, checkInputHandoffs, checkRuleInputDeclarations } from '../input-handoff-check'
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

describe('checkRuleInputDeclarations（#197 规则引用键 ↔ inputs 声明）', () => {
  const wrapupRules = [
    '证据优先级从高到低：1) sessionEvidence / knowledgeContext.delta / sessionStructure.finalClassroomContext；2) knowledgePoints',
    '记忆保持率引用（knowledgeContext.reviewHints）：仅当输入提供了非空的【记忆保持率提示】分区时，才可引用',
  ]

  const makeWrapupCore = (withExtraInputs: boolean): CoreFile => ({
    ...makeCore('session-wrapup'),
    rules: wrapupRules,
    inputs: [
      { ref: 'sandbox:teaching.session.evidence', kind: 'sandbox', skill: '', fieldPath: '', sandboxPath: 'teaching.session.evidence', userPath: '', name: 'sessionEvidence' },
      ...(withExtraInputs
        ? [
            { ref: 'sandbox:teaching.session.knowledgeContext', kind: 'sandbox' as const, skill: '', fieldPath: '', sandboxPath: 'teaching.session.knowledgeContext', userPath: '', name: 'knowledgeContext' },
            { ref: 'sandbox:teaching.session.structure', kind: 'sandbox' as const, skill: '', fieldPath: '', sandboxPath: 'teaching.session.structure', userPath: '', name: 'sessionStructure' },
          ]
        : []),
    ],
  })

  it('声明 coverage 完整时通过（#197 修复态）', () => {
    expect(checkRuleInputDeclarations(makeWrapupCore(true))).toHaveLength(0)
  })

  it('撤回 knowledgeContext / sessionStructure 声明后拦下（#197 同类漂移）', () => {
    const issues = checkRuleInputDeclarations(makeWrapupCore(false))
    const keys = issues.map((issue) => issue.message)
    expect(issues.every((issue) => issue.code === 'rule-input-key-undeclared')).toBe(true)
    expect(keys.some((m) => m.includes('knowledgeContext.delta'))).toBe(true)
    expect(keys.some((m) => m.includes('sessionStructure.finalClassroomContext'))).toBe(true)
  })

  it('声明根下的点路径引用通过（scenario.taskKcs）', () => {
    const core = makeWrapupCore(true)
    core.rules = ['若输入提供 scenario.taskKcs（当前任务的 KC 列表）：对齐 KC 粒度']
    core.inputs = [{ ref: 'sandbox:teaching.scenario', kind: 'sandbox', skill: '', fieldPath: '', sandboxPath: 'teaching.scenario', userPath: '', name: 'scenario' }]
    expect(checkRuleInputDeclarations(core)).toHaveLength(0)
  })

  it('未登记来源的简写根被拦下', () => {
    const core = makeWrapupCore(true)
    core.rules = ['若 fantasizedKey.subjective 存在时按它推进']
    core.inputs = [{ ref: 'sandbox:teaching.scenario', kind: 'sandbox', skill: '', fieldPath: '', sandboxPath: 'teaching.scenario', userPath: '', name: 'scenario' }]
    const issues = checkRuleInputDeclarations(core)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('fantasizedKey.subjective')
  })

  it('未声明任何 inputs 的文件不参与对账', () => {
    const core = makeWrapupCore(true)
    core.inputs = []
    expect(checkRuleInputDeclarations(core)).toHaveLength(0)
  })

  it('已登记来源的编排注入键通过（teaching-turn.visualOpportunity）', () => {
    const core = makeWrapupCore(true)
    core.skillId = 'teaching-turn'
    core.rules = ['若输入提供 `visualOpportunity.suggested === true`：这是编排层判定的出图时机']
    core.inputs = [{ ref: 'sandbox:teaching.scenario', kind: 'sandbox', skill: '', fieldPath: '', sandboxPath: 'teaching.scenario', userPath: '', name: 'scenario' }]
    expect(checkRuleInputDeclarations(core)).toHaveLength(0)
  })
})
