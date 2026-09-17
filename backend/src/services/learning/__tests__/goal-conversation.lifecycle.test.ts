import { applyConversationLifecycle } from '../goal-conversation.lifecycle'

function createDb(initial: { collectedData?: string; revision?: number } = {}) {
  const row: any = {
    id: 'c1',
    stage: 'proposing',
    status: 'active',
    revision: initial.revision ?? 3,
    collectedData: initial.collectedData ?? JSON.stringify({ stage: 'proposing', messages: [{ role: 'user', content: 'hi' }] })
  }
  const updates: any[] = []
  const updateManyCalls: any[] = []
  const tx = {
    goal_conversations: {
      findUnique: jest.fn(async () => ({ ...row })),
      update: jest.fn(async (args: any) => {
        updates.push(args)
        return {}
      }),
      updateMany: jest.fn(async (args: any) => {
        updateManyCalls.push(args)
        if (args.where.revision !== undefined && args.where.revision !== row.revision) {
          return { count: 0 }
        }
        row.revision += 1
        row.collectedData = args.data.collectedData
        row.stage = args.data.stage
        return { count: 1 }
      })
    }
  }
  const db: any = {
    goal_conversations: tx.goal_conversations,
    $transaction: async (fn: (t: any) => Promise<unknown>) => fn(tx)
  }
  return { db, row, updates, updateManyCalls, tx }
}

describe('applyConversationLifecycle（乐观锁 / 确认幂等，审计 §1.4）', () => {
  it('CAS 命中：以 revision 条件写入并推进版本', async () => {
    const { db, updateManyCalls, updates } = createDb({ revision: 3 })

    const ok = await applyConversationLifecycle(db, 'c1', {
      stage: 'completed',
      status: 'completed',
      learningPathId: 'lp_1',
      expectedRevision: 3
    })

    expect(ok).toBe(true)
    expect(updates).toHaveLength(0) // CAS 模式走 updateMany，不走无条件 update
    expect(updateManyCalls[0].where).toEqual({ id: 'c1', revision: 3 })
    expect(updateManyCalls[0].data.revision).toEqual({ increment: 1 })
    expect(updateManyCalls[0].data.learningPathId).toBe('lp_1')
    expect(updateManyCalls[0].data.status).toBe('completed')
  })

  it('CAS 失配：返回 false 且**整轮不写库**（并发确认落败方不得推进对话）', async () => {
    const { db, updates, updateManyCalls, row } = createDb({ revision: 5 })

    const ok = await applyConversationLifecycle(db, 'c1', {
      stage: 'completed',
      status: 'completed',
      learningPathId: 'lp_loser',
      expectedRevision: 4 // 过期版本
    })

    expect(ok).toBe(false)
    expect(updates).toHaveLength(0)
    expect(updateManyCalls).toHaveLength(1)
    expect(row.collectedData).not.toContain('lp_loser')
    expect(row.stage).toBe('proposing')
  })

  it('非 CAS（未传 expectedRevision）：走无条件 update，保持既有调用方语义', async () => {
    const { db, updates, updateManyCalls } = createDb({ revision: 1 })

    const ok = await applyConversationLifecycle(db, 'c1', { stage: 'proposing', status: 'active', completedAt: null })

    expect(ok).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updateManyCalls).toHaveLength(0)
    expect(updates[0].data.revision).toEqual({ increment: 1 })
  })

  it('appendMessage：追加消息、双写 messages 列，并应用 sanitizeContent', async () => {
    const { db, updates } = createDb({ revision: 2 })

    await applyConversationLifecycle(db, 'c1', {
      stage: 'completed',
      appendMessage: { role: 'user', content: 'raw' },
      sanitizeContent: (text) => `clean:${text}`
    })

    const data = updates[0].data
    const collected = JSON.parse(data.collectedData)
    expect(collected.messages).toHaveLength(2)
    expect(collected.messages[1]).toEqual(expect.objectContaining({ role: 'user', content: 'clean:raw' }))
    expect(JSON.parse(data.messages)).toHaveLength(2)
  })

  it('learningPath / mutateCollectedData 透传', async () => {
    const { db, updates } = createDb({ revision: 2 })

    await applyConversationLifecycle(db, 'c1', {
      stage: 'completed',
      learningPath: { id: 'lp_9', status: 'generating' },
      mutateCollectedData: (d) => { d.understanding = { subject: 'math' } }
    })

    const collected = JSON.parse(updates[0].data.collectedData)
    expect(collected.learningPath).toEqual({ id: 'lp_9', status: 'generating' })
    expect(collected.understanding).toEqual({ subject: 'math' })
  })
})
