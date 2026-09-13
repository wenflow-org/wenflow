import { describe, it, expect, vi, beforeEach } from 'vitest'

const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))

vi.mock('../../utils/api', () => ({
  default: { post, get },
  AI_REQUEST_TIMEOUT: 1000,
}))

import { aiTeachingAPI } from '../aiTeaching'

/**
 * 回归：finalizeSessionReliably 的「新 revision 重试」此前复用同一 Idempotency-Key，
 * 后端按 (sessionId, key) 校验请求体，revision 变化被判为 key 复用，
 * 抛 FINALIZATION_IDEMPOTENCY_KEY_REUSED(409)，用户看到「收束未完成」。
 */
describe('aiTeachingAPI.finalizeSessionReliably 幂等键', () => {
  beforeEach(() => {
    post.mockReset()
    get.mockReset()
  })

  it('complete_task 未完成时以新 revision 重试，且换用新的 Idempotency-Key', async () => {
    post
      .mockResolvedValueOnce({
        data: {
          status: 'ok',
          revision: 5,
          session: { status: 'in_progress' },
          finalization: { taskCompletion: 'not_started' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'ok',
          revision: 6,
          session: { status: 'completed' },
          finalization: { taskCompletion: 'completed' },
        },
      })

    const result = await aiTeachingAPI.finalizeSessionReliably('sess-1', {
      action: 'complete_task',
      revision: 4,
    })

    expect(post).toHaveBeenCalledTimes(2)
    const firstKey = post.mock.calls[0][2].headers['Idempotency-Key']
    const secondKey = post.mock.calls[1][2].headers['Idempotency-Key']
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBeTruthy()
    expect(secondKey).not.toBe(firstKey)

    // 首次用原始 revision；重试用后端返回的新 revision
    expect(post.mock.calls[0][1].revision).toBe(4)
    expect(post.mock.calls[1][1].revision).toBe(5)
    expect(result.finalization?.taskCompletion).toBe('completed')
  })

  it('首次即完成时不重试（仅一次请求）', async () => {
    post.mockResolvedValueOnce({
      data: {
        status: 'ok',
        revision: 5,
        session: { status: 'completed' },
        finalization: { taskCompletion: 'completed' },
      },
    })

    await aiTeachingAPI.finalizeSessionReliably('sess-2', {
      action: 'complete_task',
      revision: 4,
    })

    expect(post).toHaveBeenCalledTimes(1)
  })

  it('首次抛错（409）时仍会用服务端 revision 换新 key 补偿重试（P1：补偿分支此前不可达）', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('Idempotency-Key 已用于不同的课堂结束请求'), {
      response: { status: 409 },
    }))
    get.mockResolvedValueOnce({
      data: {
        status: 'completed',
        revision: 5,
        session: { status: 'completed' },
        finalization: { sessionClosure: 'completed', taskCompletion: 'not_started' },
      },
    })
    post.mockResolvedValueOnce({
      data: {
        status: 'completed',
        revision: 6,
        session: { status: 'completed' },
        finalization: { taskCompletion: 'completed' },
      },
    })

    const result = await aiTeachingAPI.finalizeSessionReliably('sess-3', {
      action: 'complete_task',
      revision: 4,
    })

    expect(get).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(2)
    const firstKey = post.mock.calls[0][2].headers['Idempotency-Key']
    const secondKey = post.mock.calls[1][2].headers['Idempotency-Key']
    expect(secondKey).toBeTruthy()
    expect(secondKey).not.toBe(firstKey)
    // 补偿用服务端返回的 revision，而不是原始 revision
    expect(post.mock.calls[1][1].revision).toBe(5)
    expect(result.finalization?.taskCompletion).toBe('completed')
  })
})
