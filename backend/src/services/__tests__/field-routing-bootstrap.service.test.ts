import {
  bootstrapFieldRoutings,
  FIELD_ROUTING_SEED_MANIFEST
} from '../field-routing-bootstrap.service'

describe('field routing bootstrap', () => {
  it('固定按 goal、path、execution、learner 顺序执行', async () => {
    const calls: string[] = []
    const ensure = (name: string) => jest.fn(async () => {
      calls.push(name)
      return { name }
    })
    const result = await bootstrapFieldRoutings({
      database: {} as any,
      ensureGoal: ensure('goal') as any,
      ensurePath: ensure('path') as any,
      ensureExecution: ensure('execution') as any,
      ensureLearner: ensure('learner') as any
    })

    expect(calls).toEqual(['goal', 'path', 'execution', 'learner'])
    expect(Object.keys(result)).toEqual(['goal', 'path', 'execution', 'learner'])
  })

  it('阶段失败时停止后续 seed 并传播错误', async () => {
    const ensureGoal = jest.fn().mockResolvedValue({})
    const ensurePath = jest.fn().mockRejectedValue(new Error('path seed failed'))
    const ensureExecution = jest.fn()
    const ensureLearner = jest.fn()

    await expect(bootstrapFieldRoutings({
      database: {} as any,
      ensureGoal,
      ensurePath,
      ensureExecution,
      ensureLearner
    } as any)).rejects.toThrow('path seed failed')
    expect(ensureExecution).not.toHaveBeenCalled()
    expect(ensureLearner).not.toHaveBeenCalled()
  })

  it('seed manifest 的全局键唯一且数量稳定', () => {
    expect(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds).toHaveLength(17)
    expect(FIELD_ROUTING_SEED_MANIFEST.fieldIds).toHaveLength(110)
    expect(FIELD_ROUTING_SEED_MANIFEST.routings).toHaveLength(135)
  })
})
