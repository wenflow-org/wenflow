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
            isCompletion: false,
            revision: 3
          }
        }
      })
    }
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport
    })

    const result = await adapter.sendTeachingMessage('teach-1', 2, { type: 'request_example', text: '给我一个例子' })

    expect(result.observation.visibleMessages.map(item => item.content)).toEqual(['给我一个例子', '先运行一下这个例子。'])
    expect(JSON.stringify(result.observation)).not.toContain('counterexample')
    expect(JSON.stringify(result.observation)).not.toContain('understanding')
    expect(result.diagnostic).toEqual(expect.objectContaining({
      strategies: ['counterexample'],
      analysis: expect.objectContaining({ understanding: 0.2 })
    }))
    expect((transport.request as jest.Mock).mock.calls[0][0].data).toEqual({
      message: '给我一个例子',
      revision: 2
    })
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

    expect(result.observation.availableActions).toEqual(['abandon'])
    expect(result.observation.lastActionResult?.visibleMessage).toBe('阶段任务仍在生成')
  })

  it('Path 就绪后只公开进入 Learn，并优先选择当前阶段的 todo task', async () => {
    const request = jest.fn().mockResolvedValue({
      data: { success: true, data: {
        id: 'path-1', title: '测试路径', status: 'active', canStartLearning: true,
        milestones: [
          { title: '旧阶段', status: 'completed', subtasks: [{ id: 'old', title: '未正确结算的旧任务', status: 'in_progress' }] },
          { title: '当前阶段', status: 'active', subtasks: [
            { id: 'doing', title: '进行中任务', status: 'in_progress' },
            { id: 'todo', title: '待开始任务', status: 'todo' }
          ] }
        ]
      } }
    })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request } as PlatformHttpTransport
    })

    const result = await adapter.getPath('path-1')

    expect(result.observation.availableActions).toEqual(['start_learning', 'abandon'])
    expect(result.observation.visibleTask?.id).toBe('todo')
  })

  it('开始 Learn 与普通用户页面一致，不强制创建新教学会话', async () => {
    const request = jest.fn().mockResolvedValue({
      data: { success: true, data: { sessionId: 'teach-1', welcomeMessage: '开始学习', topic: '当前任务', revision: 7 } }
    })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request } as PlatformHttpTransport
    })

    await adapter.startTeaching('task-1')

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST', url: '/ai-teaching/tasks/task-1/session', headers: expect.any(Object)
    }))
    expect(request.mock.calls[0][0]).not.toHaveProperty('data')
    expect((await adapter.startTeaching('task-1')).control.teachingRevision).toBe(7)
  })

  it('Path 生成失败时返回可裁判的 error 终态', async () => {
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request: jest.fn().mockResolvedValue({
        data: { success: true, data: {
          id: 'path-1', title: '失败路径', status: 'failed', canStartLearning: false,
          learningBlockedReason: '阶段任务生成失败', milestones: []
        } }
      }) } as PlatformHttpTransport
    })

    const result = await adapter.getPath('path-1')

    expect(result.observation.stage).toBe('error')
    expect(result.observation.availableActions).toEqual([])
    expect(result.observation.lastActionResult).toEqual({ status: 'error', visibleMessage: '阶段任务生成失败' })
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
            revision: 6,
            analysis: { hiddenScore: 0.97 }
          }
        }
      })
    }
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport
    })

    const result = await adapter.sendTeachingMessage('teach-1', 5, { type: 'chat', text: '我做完了' })

    expect(result.observation.availableActions).toContain('confirm_complete')
    expect(JSON.stringify(result.observation)).not.toContain('hiddenScore')
    expect(JSON.stringify(result.observation)).not.toContain('isCompletion')
  })

  it('Teaching 写响应缺少 revision 时拒绝猜测下一版本', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        data: { success: true, data: { aiResponse: '继续', isCompletion: false } }
      })
      .mockResolvedValueOnce({
        data: { success: true, data: { status: 'completed' } }
      })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request } as PlatformHttpTransport
    })

    await expect(adapter.sendTeachingMessage('teach-1', 2, { type: 'chat', text: '继续' }))
      .rejects.toThrow('平台 Teaching 消息 响应缺少有效的课堂 revision')
    await expect(adapter.endTeaching('teach-1', 2, 'completed'))
      .rejects.toThrow('平台 Teaching 结束 响应缺少有效的课堂 revision')
  })

  it('完成任务接口返回 alreadyCompleted 时仍视为幂等成功', async () => {
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: {
        request: jest.fn().mockResolvedValue({
          data: {
            success: true,
            data: { task: { id: 'task-1', status: 'completed' }, alreadyCompleted: true }
          }
        })
      } as PlatformHttpTransport
    })

    const result = await adapter.completeTask('task-1')

    expect(result.control).toEqual(expect.objectContaining({
      taskId: 'task-1',
      taskCompleted: true
    }))
    expect(result.diagnostic?.task).toEqual(expect.objectContaining({ alreadyCompleted: true }))
  })

  it('Goal 和 Path 的非终态 Observation 都公开放弃动作', async () => {
    const requests = jest.fn()
      .mockResolvedValueOnce({
        data: { success: true, data: { userVisible: '请继续说明', control: { conversationId: 'goal-1', stage: 'understanding', isCompleted: false } } }
      })
      .mockResolvedValueOnce({
        data: { success: true, data: { id: 'path-1', title: '路径', status: 'generating', canStartLearning: false, milestones: [] } }
      })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request: requests } as PlatformHttpTransport
    })

    const goal = await adapter.startGoal('开始')
    const path = await adapter.getPath('path-1')

    expect(goal.observation.availableActions).toContain('abandon')
    expect(path.observation.availableActions).toContain('abandon')
  })
})
