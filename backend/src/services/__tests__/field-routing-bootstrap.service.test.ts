import {
  bootstrapFieldRoutings,
  FIELD_ROUTING_SEED_MANIFEST
} from '../field-routing-bootstrap.service'

describe('field routing bootstrap', () => {
  it('固定按 goal、path、learning、profile 顺序执行', async () => {
    const calls: string[] = []
    const ensure = (name: string) => jest.fn(async () => {
      calls.push(name)
      return { name }
    })
    const result = await bootstrapFieldRoutings({
      database: {} as any,
      ensureGoal: ensure('goal') as any,
      ensurePath: ensure('path') as any,
      ensureTeaching: ensure('teaching') as any,
      ensureProfile: ensure('profile') as any
    })

    expect(calls).toEqual(['goal', 'path', 'teaching', 'profile'])
    expect(Object.keys(result)).toEqual(['goal', 'path', 'teaching', 'profile'])
  })

  it('阶段失败时停止后续 seed 并传播错误', async () => {
    const ensureGoal = jest.fn().mockResolvedValue({})
    const ensurePath = jest.fn().mockRejectedValue(new Error('path seed failed'))
    const ensureTeaching = jest.fn()
    const ensureProfile = jest.fn()

    await expect(bootstrapFieldRoutings({
      database: {} as any,
      ensureGoal,
      ensurePath,
      ensureTeaching,
      ensureProfile
    } as any)).rejects.toThrow('path seed failed')
    expect(ensureTeaching).not.toHaveBeenCalled()
    expect(ensureProfile).not.toHaveBeenCalled()
  })

  it('seed manifest 的全局键唯一且数量稳定', () => {
    expect(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds).toHaveLength(15)
    expect(FIELD_ROUTING_SEED_MANIFEST.fieldIds).toHaveLength(131)
    expect(FIELD_ROUTING_SEED_MANIFEST.routings).toHaveLength(189)
  })
})
