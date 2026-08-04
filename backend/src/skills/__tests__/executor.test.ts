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
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}))

import { getRequestContext, runWithContext } from '../../gateway/api-gateway/context'
import { consumeUpstreamAttempt } from '../../gateway/api-gateway/retry-budget'
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

  it('quality 与 cached 双向桥接：legacy cached 派生 quality', async () => {
    const result = await executeSkillHandler(
      { name: 'text-structure-analyzer' },
      {},
      async () => ({ success: true, output: 'ok', duration: 1, cached: true })
    )

    expect(result.quality).toBe('fallback')
    expect(result.cached).toBe(true)
  })

  it('quality 与 cached 双向桥接：canonical quality 派生 cached', async () => {
    const fallbackResult = await executeSkillHandler(
      { name: 'text-structure-analyzer' },
      {},
      async () => ({ success: true, output: 'ok', duration: 1, quality: 'fallback' as const })
    )
    const modelResult = await executeSkillHandler(
      { name: 'text-structure-analyzer' },
      {},
      async () => ({ success: true, output: 'ok', duration: 1, quality: 'model' as const })
    )

    expect(fallbackResult.cached).toBe(true)
    expect(fallbackResult.quality).toBe('fallback')
    expect(modelResult.cached).toBeUndefined()
    expect(modelResult.quality).toBe('model')
  })

  it('在 Skill 边界创建并共享一份 Provider 请求预算', async () => {
    let firstBudget: ReturnType<typeof getRequestContext>['retryBudget']

    await executeSkillHandler({ name: 'text-structure-analyzer' }, {}, async () => {
      firstBudget = getRequestContext().retryBudget
      expect(firstBudget).toBeDefined()
      expect(consumeUpstreamAttempt(firstBudget!, false)).toBe(true)

      const nestedBudget = getRequestContext().retryBudget
      expect(nestedBudget).toBe(firstBudget)
      expect(consumeUpstreamAttempt(nestedBudget!, false)).toBe(true)
      return { success: true, output: 'ok' }
    })

    expect(firstBudget!.used.upstreamAttempts).toBe(2)
  })

  it('构建 Context Envelope sidecar 且不改写业务 input', async () => {
    const input = { goal: 'test', metadata: { sessionId: 'legacy-session' } }

    await runWithContext({
      userId: 'trusted-user',
      traceId: 'trace-ctx',
      sourceEntry: 'user'
    }, () => executeSkillHandler(
      { name: 'text-structure-analyzer' },
      input,
      async (received) => {
        expect(received).toBe(input)
        expect(getRequestContext().contextEnvelope).toEqual(expect.objectContaining({
          schemaVersion: 'context-envelope/v1',
          principal: { userId: 'trusted-user' },
          session: expect.objectContaining({ sessionId: 'explicit-session' }),
          trace: expect.objectContaining({ traceId: 'trace-ctx' }),
          execution: expect.objectContaining({
            skillId: 'text-structure-analyzer',
            retry: expect.objectContaining({ budgetId: expect.stringMatching(/^rb_/) })
          })
        }))
        return { success: true, output: 'ok' }
      },
      {
        contextEnvelope: {
          schemaVersion: 'context-envelope/v1',
          principal: { userId: 'untrusted-override' },
          session: { sessionId: 'explicit-session' },
          locale: { language: 'zh-CN', timeZone: 'Asia/Shanghai' }
        }
      }
    ))
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
