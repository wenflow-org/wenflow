export {}

const skillFindUnique = jest.fn()
const skillUpdate = jest.fn()
const logCreate = jest.fn()
const userSkillFindUnique = jest.fn()

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    skill_registrations: {
      findUnique: skillFindUnique,
      update: skillUpdate
    }
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
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}))

import { getRequestContext, runWithContext } from '../../gateway/api-gateway/context'
import { executeSkillHandler } from '../executor'

describe('统一 Skill Executor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    skillFindUnique.mockResolvedValue({ callCount: 2, successRate: 0.5 })
    skillUpdate.mockResolvedValue({})
    logCreate.mockResolvedValue({})
    userSkillFindUnique.mockResolvedValue(null)
  })

  it('为业务与 Gateway handler 提供相同的 Agent/Skill 上下文和结果包装', async () => {
    const handler = jest.fn(async (_input: any) => ({ success: true, output: 0, duration: 999 }))

    const result = await runWithContext({
      userId: 'user-1',
      traceId: 'trace-1',
      sourceEntry: 'user'
    }, () => executeSkillHandler({ id: 'skill:path-planning' }, { goal: 'test' }, async (input) => {
      expect(getRequestContext()).toEqual(expect.objectContaining({
        userId: 'user-1',
        agentId: 'path-agent',
        callerAgent: 'path-agent',
        skillId: 'path-planning',
        traceId: 'trace-1'
      }))
      return handler(input)
    }))

    expect(result.success).toBe(true)
    expect(result.output).toBe(0)
    expect(handler).toHaveBeenCalledWith({ goal: 'test' })
    expect(skillUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { name: 'path-planning' },
      data: expect.objectContaining({ callCount: 3, successRate: expect.closeTo(2 / 3) })
    }))
  })

  it('把 SkillExecutionResult 失败统一转换为异常并记录失败统计', async () => {
    await expect(executeSkillHandler(
      { name: 'text-structure-analyzer' },
      {},
      async () => ({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'bad input' },
        duration: 1
      })
    )).rejects.toMatchObject({ message: 'bad input', code: 'INVALID_INPUT' })

    expect(skillUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { name: 'text-structure-analyzer' },
      data: expect.objectContaining({ callCount: 3, successRate: expect.closeTo(1 / 3) })
    }))
  })

  it('用户显式禁用 Skill 后在统一执行边界拒绝调用', async () => {
    userSkillFindUnique.mockResolvedValue({ enabled: false })
    const handler = jest.fn()

    await expect(runWithContext({ userId: 'user-1' }, () => executeSkillHandler(
      { name: 'text-structure-analyzer' },
      {},
      handler
    ))).rejects.toMatchObject({ code: 'SKILL_DISABLED' })

    expect(userSkillFindUnique).toHaveBeenCalledWith({
      where: {
        userId_skillName: {
          userId: 'user-1',
          skillName: 'text-structure-analyzer'
        }
      },
      select: { enabled: true }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('MCP Skill 日志不持久化调用参数和远程结果正文', async () => {
    await runWithContext({ userId: 'user-1' }, () => executeSkillHandler(
      { name: 'mcp-tool' },
      { toolId: 'echo', params: { credential: 'secret', content: 'private input' } },
      async () => ({
        success: true,
        output: {
          toolId: 'echo',
          source: 'user',
          result: { credential: 'secret', content: 'private output' }
        }
      })
    ))
    await new Promise(resolve => setImmediate(resolve))

    const data = logCreate.mock.calls.at(-1)[0].data
    expect(JSON.parse(data.input)).toEqual({ toolId: 'echo', params: '[REDACTED]' })
    expect(JSON.parse(data.output)).toEqual({
      toolId: 'echo',
      source: 'user',
      resultType: 'object'
    })
    expect(data.input).not.toContain('private input')
    expect(data.output).not.toContain('private output')
  })
})
