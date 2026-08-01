export {}

const pluginExecute = jest.fn()

jest.mock('../../plugin-registry', () => ({
  agentPluginRegistry: { execute: pluginExecute }
}))

import { runWithContext } from '../../../gateway/api-gateway/context'
import { adaptPluginToSkill } from '../skill-adapter'

describe('Plugin Skill Adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pluginExecute.mockResolvedValue({ success: true, userVisible: 'ok', internal: { value: 1 } })
  })

  it('将 Plugin 定义和执行上下文转换为统一 Skill 契约', async () => {
    const plugin: any = {
      id: 'external-checker',
      name: 'External Checker',
      version: '1.0.0',
      description: 'test plugin',
      type: 'quality-evaluator',
      capabilities: ['check'],
      execute: jest.fn()
    }
    const adapted = adaptPluginToSkill(plugin)

    const result = await runWithContext({
      userId: 'user-1',
      sourceEntry: 'user',
      skillId: 'external-checker'
    }, () => adapted.handler({
      pluginInput: { value: 1 },
      pluginContext: {
        sessionId: 'session-1',
        taskId: 'task-1',
        metadata: { source: 'test' }
      }
    }))

    expect(adapted.definition).toEqual(expect.objectContaining({
      name: 'external-checker',
      category: 'analysis',
      capabilities: ['check']
    }))
    expect(pluginExecute).toHaveBeenCalledWith('external-checker', { value: 1 }, {
      userId: 'user-1',
      sessionId: 'session-1',
      sourceEntry: 'user',
      metadata: { source: 'test', taskId: 'task-1' }
    })
    expect(result).toEqual({ success: true, userVisible: 'ok', internal: { value: 1 } })
  })
})
