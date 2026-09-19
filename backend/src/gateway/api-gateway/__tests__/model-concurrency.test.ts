import {
  getInFlight,
  getModelMaxParallelRequests,
  releaseSlot,
  resetModelConcurrency,
  tryAcquireSlot
} from '../model-concurrency'

describe('model-concurrency（本地 per-模型 并发闸门）', () => {
  beforeEach(() => resetModelConcurrency())

  it('未配置上限时恒可获取且不计数（零行为变化）', () => {
    expect(tryAcquireSlot('k', null)).toBe(true)
    expect(tryAcquireSlot('k', undefined)).toBe(true)
    expect(tryAcquireSlot('k', 0)).toBe(true)
    expect(getInFlight('k')).toBe(0)
  })

  it('达到上限后拒绝获取，释放后恢复', () => {
    expect(tryAcquireSlot('k', 2)).toBe(true)
    expect(tryAcquireSlot('k', 2)).toBe(true)
    expect(getInFlight('k')).toBe(2)
    expect(tryAcquireSlot('k', 2)).toBe(false)
    expect(getInFlight('k')).toBe(2)

    releaseSlot('k')
    expect(getInFlight('k')).toBe(1)
    expect(tryAcquireSlot('k', 2)).toBe(true)
  })

  it('键之间互不影响', () => {
    expect(tryAcquireSlot('a', 1)).toBe(true)
    expect(tryAcquireSlot('b', 1)).toBe(true)
    expect(tryAcquireSlot('a', 1)).toBe(false)
    expect(tryAcquireSlot('b', 1)).toBe(false)
  })

  it('释放到 0 后计数清除，不会出现负数', () => {
    tryAcquireSlot('k', 1)
    releaseSlot('k')
    releaseSlot('k')
    expect(getInFlight('k')).toBe(0)
  })

  it('未配置 maxParallelRequests 的模型解析为 null（不限）', () => {
    expect(getModelMaxParallelRequests('deepseek-v4-flash')).toBeNull()
    expect(getModelMaxParallelRequests('unknown-model')).toBeNull()
  })
})
