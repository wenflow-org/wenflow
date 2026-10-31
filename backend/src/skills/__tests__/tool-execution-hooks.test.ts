export {}

const skillFindUnique = jest.fn()
const skillUpdate = jest.fn()
const logCreate = jest.fn()
const userSkillFindUnique = jest.fn()

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    skill_registrations: { findUnique: skillFindUnique, update: skillUpdate }
  }
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: { create: logCreate },
    user_skill_configs: { findUnique: userSkillFindUnique }
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() }
}))

jest.mock('../../services/reliability-settings.service', () => ({
  createRuntimeRetryBudget: jest.fn().mockResolvedValue({
    limits: { maxLogicalRetries: 0, maxTransportAttempts: 1, maxUpstreamAttempts: 1, defaultRequestTimeoutMs: 1000 },
    usedLogicalRetries: 0,
    usedTransportAttempts: 0,
    usedUpstreamAttempts: 0
  }),
  getEffectiveLogicalRetryLimit: jest.fn().mockResolvedValue(0)
}))

import { executeSkillHandler } from '../executor'
import {
  ToolApprovalRequiredError,
  clearToolExecutionHooks,
  isToolApprovalRequired,
  readApprovalRequiredSkills,
  registerToolExecutionHook,
} from '../tool-execution-hooks'

const ok = (output: unknown = { ok: true }) => async () => ({
  success: true,
  output,
  duration: 1
})

describe('工具执行 hooks / 审批 / 结构化降级', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearToolExecutionHooks()
    delete process.env.TOOL_APPROVAL_REQUIRED_SKILLS
    skillFindUnique.mockResolvedValue({ callCount: 2, successRate: 0.5 })
    skillUpdate.mockResolvedValue({})
    logCreate.mockResolvedValue({})
    userSkillFindUnique.mockResolvedValue(null)
  })

  afterEach(() => {
    clearToolExecutionHooks()
    delete process.env.TOOL_APPROVAL_REQUIRED_SKILLS
  })

  it('before hook 返回 veto 时短路执行，错误带 status', async () => {
    const handler = jest.fn(ok())
    registerToolExecutionHook({
      id: 'quota',
      phase: 'before',
      run: () => ({ code: 'TOOL_QUOTA_EXCEEDED', message: '配额已用尽', status: 429 }),
    })

    await expect(executeSkillHandler({ id: 'web-search' }, {}, handler)).rejects.toMatchObject({
      code: 'TOOL_QUOTA_EXCEEDED',
      status: 429,
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('before hook 自身抛错时保守放行', async () => {
    const handler = jest.fn(ok({ passed: true }))
    registerToolExecutionHook({
      id: 'broken',
      phase: 'before',
      run: () => { throw new Error('hook crashed') },
    })

    const result = await executeSkillHandler({ id: 'web-search' }, {}, handler)
    expect(result.success).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('after / error hook 只观察，不影响结果与错误传播', async () => {
    const seen: string[] = []
    registerToolExecutionHook({ id: 'audit-after', phase: 'after', run: (info) => { seen.push(`after:${info.skillId}`) } })
    registerToolExecutionHook({ id: 'audit-error', phase: 'error', run: (info) => { seen.push(`error:${info.skillId}`) } })

    await executeSkillHandler({ id: 'web-fetch' }, {}, ok())
    expect(seen).toEqual(['after:web-fetch'])

    await expect(executeSkillHandler({ id: 'web-fetch' }, {}, async () => { throw new Error('boom') }))
      .rejects.toThrow('boom')
    expect(seen).toEqual(['after:web-fetch', 'error:web-fetch'])
  })

  it('after hook 抛错不把成功调用变成失败', async () => {
    registerToolExecutionHook({
      id: 'noisy',
      phase: 'after',
      run: () => { throw new Error('observer failed') },
    })
    const result = await executeSkillHandler({ id: 'web-search' }, {}, ok())
    expect(result.success).toBe(true)
  })

  it('审批名单命中且未 approved 时抛 TOOL_APPROVAL_REQUIRED(428)，approved 后放行', async () => {
    process.env.TOOL_APPROVAL_REQUIRED_SKILLS = 'mcp-tool, web-search'
    const handler = jest.fn(ok())

    await expect(executeSkillHandler({ id: 'web-search' }, {}, handler)).rejects.toBeInstanceOf(ToolApprovalRequiredError)
    expect(handler).not.toHaveBeenCalled()

    const result = await executeSkillHandler({ id: 'web-search' }, {}, handler, { approved: true })
    expect(result.success).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('未命中审批名单的 skill 不受影响', async () => {
    process.env.TOOL_APPROVAL_REQUIRED_SKILLS = 'mcp-tool'
    const result = await executeSkillHandler({ id: 'web-search' }, {}, ok())
    expect(result.success).toBe(true)
  })

  it('审批名单解析支持空白与通配', () => {
    expect(readApprovalRequiredSkills(' a , b ,, ')).toEqual(['a', 'b'])
    expect(isToolApprovalRequired('anything', ['*'])).toBe(true)
    expect(isToolApprovalRequired('b', ['a', 'b'])).toBe(true)
    expect(isToolApprovalRequired('c', ['a', 'b'])).toBe(false)
  })

  it('allowStructuredFailure：handler 返回 success=false 时返回结构化错误而不是抛异常', async () => {
    const failing = async () => ({
      success: false,
      error: { code: 'MCP_TOOL_EXECUTION_FAILED', message: '下游不可用' },
      duration: 3,
    })

    const result = await executeSkillHandler({ id: 'mcp-tool' }, {}, failing, { allowStructuredFailure: true })
    expect(result.success).toBe(false)
    expect(result.error).toEqual({ code: 'MCP_TOOL_EXECUTION_FAILED', message: '下游不可用' })
  })

  it('默认（未开启结构化失败）仍按既有语义抛错', async () => {
    const failing = async () => ({
      success: false,
      error: { code: 'MCP_TOOL_EXECUTION_FAILED', message: '下游不可用' },
      duration: 3,
    })
    await expect(executeSkillHandler({ id: 'mcp-tool' }, {}, failing)).rejects.toMatchObject({
      code: 'MCP_TOOL_EXECUTION_FAILED',
    })
  })

  it('options.timeout 真正生效：超时抛 SKILL_TIMEOUT(504)', async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve({ success: true, output: {}, duration: 1 }), 200))
    await expect(
      executeSkillHandler({ id: 'web-search' }, {}, slow as unknown as Parameters<typeof executeSkillHandler>[2], { timeout: 20 })
    ).rejects.toMatchObject({ code: 'SKILL_TIMEOUT', status: 504 })
  })
})
