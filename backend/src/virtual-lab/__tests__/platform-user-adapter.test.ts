import { PlatformHttpTransport, PlatformUserAdapter } from '../platform-user-adapter'

describe('PlatformUserAdapter', () => {
  it('使用 projection token 调用普通 Goal API 并只暴露可见 Observation', async () => {
    const request = jest.fn().mockResolvedValue({
      data: {
        success: true,
        data: {
          userVisible: '你最想解决的具体问题是什么？',
          internal: {
            core: { conversationId: 'goal-1', stage: 'understanding', confidence: 0.91, isCompleted: false },
            ext: { goalConversation: { understanding: { secret: true } } }
          }
        }
      },
      headers: { 'x-trace-id': 'trace-1' }
    })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'projection', token: 'synthetic-token' }),
      transport: { request } as PlatformHttpTransport
    })

    const result = await adapter.startGoal('我想学 JavaScript')

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: '/goal-conversation/start',
      data: { input: { text: '我想学 JavaScript' }, contextMode: 'recent' },
      headers: expect.objectContaining({ 'X-Projection-Token': 'synthetic-token' })
    }))
    expect(result.observation.visibleMessages[1].content).toBe('你最想解决的具体问题是什么？')
    expect(result.control).toEqual(expect.objectContaining({ conversationId: 'goal-1', rawTraceId: 'trace-1' }))
    expect(JSON.stringify(result.observation)).not.toContain('confidence')
    expect(JSON.stringify(result.observation)).not.toContain('secret')
  })

  it('将 Teaching 内部分析放入旁路 diagnostic，不回流到 Observation', async () => {
    const transport: PlatformHttpTransport = {
      request: jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            aiResponse: '先运行一下这个例子。',
            analysis: { understanding: 0.2, emotionalState: 'frustrated' },
            state: { lss: 4 },
            strategies: ['counterexample'],
            isCompletion: false
          }
        }
      })
    }
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport
    })

    const result = await adapter.sendTeachingMessage('teach-1', { type: 'request_example', text: '给我一个例子' })

    expect(result.observation.visibleMessages.map(item => item.content)).toEqual(['给我一个例子', '先运行一下这个例子。'])
    expect(JSON.stringify(result.observation)).not.toContain('counterexample')
    expect(JSON.stringify(result.observation)).not.toContain('understanding')
    expect(result.diagnostic).toEqual(expect.objectContaining({
      strategies: ['counterexample'],
      analysis: expect.objectContaining({ understanding: 0.2 })
    }))
  })

  it('Path active 但 canStartLearning=false 时保持等待', async () => {
    const transport: PlatformHttpTransport = {
      request: jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: 'path-1',
            title: '测试路径',
            status: 'active',
            canStartLearning: false,
            learningBlockedReason: '阶段任务仍在生成',
            milestones: [{ title: '阶段一', subtasks: [{ id: 'task-1', title: '任务一', status: 'todo' }] }]
          }
        }
      })
    }
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport
    })

    const result = await adapter.getPath('path-1')

    expect(result.observation.availableActions).toEqual([])
    expect(result.observation.lastActionResult?.visibleMessage).toBe('阶段任务仍在生成')
  })

  it('Teaching 仅公开可确认结束动作，不公开内部完成判断', async () => {
    const transport: PlatformHttpTransport = {
      request: jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            aiResponse: '如果你确认完成，我们可以结束这个任务。',
            shouldConfirmEnd: true,
            isCompletion: true,
            analysis: { hiddenScore: 0.97 }
          }
        }
      })
    }
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport
    })

    const result = await adapter.sendTeachingMessage('teach-1', { type: 'chat', text: '我做完了' })

    expect(result.observation.availableActions).toContain('confirm_complete')
    expect(JSON.stringify(result.observation)).not.toContain('hiddenScore')
    expect(JSON.stringify(result.observation)).not.toContain('isCompletion')
  })
})
