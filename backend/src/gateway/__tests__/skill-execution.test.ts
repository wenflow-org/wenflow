export {}

const executeSkillHandler = jest.fn()

jest.mock('../../skills/executor', () => ({ executeSkillHandler }))
jest.mock('../../config/system-database', () => ({ __esModule: true, default: {} }))
jest.mock('../../utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() } }))

import { EduClawGateway } from '../index'

describe('EduClawGateway Skill 执行', () => {
  it('委托统一 Skill Executor，并只更新内存运行时视图', async () => {
    const gateway = new EduClawGateway({} as any)
    const definition: any = {
      name: 'test-skill',
      version: '1.0.0',
      category: 'analysis',
      description: 'test',
      capabilities: [],
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      stats: { callCount: 0, successRate: 1, avgLatency: 0 }
    }
    const handler = jest.fn()
    const registry = (gateway as any).skillRegistry
    registry.get = jest.fn(() => ({ definition, handler }))
    registry.recordExecution = jest.fn()
    executeSkillHandler.mockResolvedValue({ success: true, output: { ok: true }, duration: 12 })

    const result = await gateway.executeSkill('test-skill', { input: true })

    expect(executeSkillHandler).toHaveBeenCalledWith(definition, { input: true }, handler)
    expect(registry.recordExecution).toHaveBeenCalledWith('test-skill', true, 12)
    expect(result).toEqual({ success: true, output: { ok: true }, duration: 12 })
  })

  it('统一执行失败时同步更新内存失败统计', async () => {
    const gateway = new EduClawGateway({} as any)
    const definition: any = {
      name: 'test-skill',
      version: '1.0.0',
      category: 'analysis',
      description: 'test',
      capabilities: [],
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      stats: { callCount: 0, successRate: 1, avgLatency: 0 }
    }
    const handler = jest.fn()
    const registry = (gateway as any).skillRegistry
    registry.get = jest.fn(() => ({ definition, handler }))
    registry.recordExecution = jest.fn()
    executeSkillHandler.mockRejectedValue(Object.assign(new Error('failed'), { skillDurationMs: 9 }))

    await expect(gateway.executeSkill('test-skill', {})).rejects.toThrow('failed')

    expect(registry.recordExecution).toHaveBeenCalledWith('test-skill', false, 9)
  })
})
