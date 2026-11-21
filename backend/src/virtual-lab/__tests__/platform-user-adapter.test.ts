import { PlatformAdapterError, PlatformHttpTransport, PlatformUserAdapter } from '../platform-user-adapter'

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

  it('Goal 硬阻断作为实际终态记录，不推断案例预期', async () => {
    const request = jest.fn().mockResolvedValue({
      data: {
        success: true,
        data: {
          userVisible: '这类目标当前不会生成学习路径。',
          internal: {
            core: {
              conversationId: 'goal-1', stage: 'completed', confidence: 0.9,
              isCompleted: true, hardBlocked: true,
            },
            ext: { goalConversation: {} },
          },
        },
      },
      headers: {},
    })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request } as PlatformHttpTransport,
    })

    const result = await adapter.startGoal('想学吉他手型')
    expect(result.control.hardBlocked).toBe(true)
    expect(result.observation.stage).toBe('goal')
    expect(result.control).toMatchObject({ goalTerminalKind: 'hard_blocked', runCompleted: true, terminalCode: 'GOAL_ENDED_WITHOUT_PATH' })
    expect(result.control).not.toHaveProperty('expectedNoPath')
  })

  it.each(['answer_only', 'no_path', 'path_bound'])('按实际路径绑定投影目标终态 %s', async (terminalKind) => {
    const hasPath = terminalKind === 'path_bound';
    const request = jest.fn().mockResolvedValue({ data: { success: true, data: { control: {
      conversationId: 'goal-1', isCompleted: true, terminalKind,
      learningPath: hasPath ? { id: 'path-1' } : null,
    } } }, headers: {} });
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'projection', token: 'synthetic-token' }),
      transport: { request } as PlatformHttpTransport,
    });
    const result = await adapter.startGoal('学习一个目标');
    expect(result.observation.stage).toBe(hasPath ? 'path' : 'goal');
    expect(result.control.goalTerminalKind).toBe(terminalKind);
    expect(result.control.learningPathId).toBe(hasPath ? 'path-1' : undefined);
    expect(result.control.runCompleted).toBe(hasPath ? undefined : true);
  });

  it('confirm_proposal 透传 probeAnswers，并把前置题（含判分键）放进旁路 diagnostic', async () => {
    const request = jest.fn().mockResolvedValue({
      data: {
        success: true,
        data: {
          userVisible: '好的，按这版开始。',
          internal: {
            core: { conversationId: 'goal-1', stage: 'proposing', confidence: 0.9, isCompleted: true },
            ext: {
              goalConversation: {
                confirmedProposal: {
                  prerequisiteDiagnostics: [{
                    probeId: 'p1',
                    targetConcept: '函数参数',
                    question: '哪个是参数？',
                    options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
                    correctOption: 'B',
                  }],
                },
              },
            },
          },
        },
      },
      headers: { 'x-trace-id': 'trace-2' },
    })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request } as PlatformHttpTransport,
    })
    const probeAnswers = [{ probeId: 'p1', userAnswer: 'A', targetConcept: '函数参数' }]

    const result = await adapter.replyGoal('goal-1', { type: 'confirm_proposal', text: '确认', probeAnswers })

    expect((request as jest.Mock).mock.calls[0][0].data).toEqual(expect.objectContaining({
      confirmProposal: true,
      probeAnswers,
    }))
    expect(result.diagnostic?.probePrompts).toEqual([
      expect.objectContaining({ probeId: 'p1', correctOption: 'B' }),
    ])
    expect(JSON.stringify(result.observation)).not.toContain('correctOption')
    expect(JSON.stringify(result.observation)).not.toContain('判分键')
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
    // 生成中仍属 path 阶段，不得透传 active/generating 导致 control 阶段跳变
    expect(result.control.platformStage).toBe('path')
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
    expect(result.control.platformStage).toBe('path')
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

  it('带 teachingSessionId/teachingRevision 完成任务时，透传给接口用于补记台账（P1-3）', async () => {
    const request = jest.fn().mockResolvedValue({
      data: { success: true, data: { task: { id: 'task-1', status: 'completed' } } }
    })
    const adapter = new PlatformUserAdapter({
      credentialProvider: async () => ({ kind: 'bearer', token: 'user-token' }),
      transport: { request } as PlatformHttpTransport
    })

    await adapter.completeTask('task-1', 'teaching-1', 12)

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: '/learning/tasks/task-1/complete',
      data: { teachingSessionId: 'teaching-1', teachingRevision: 12 },
    }))
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
    // goal 阶段非终态 → 'goal'；path 生成中 → 'path'
    expect(goal.control.platformStage).toBe('goal')
    expect(path.control.platformStage).toBe('path')
  })
})

describe('PlatformAdapterError retryable（修复批 5a）', () => {
  it('平台 5xx 且 message 被掩码时，error.code=ATTEMPT_TIMEOUT 仍判可恢复', () => {
    // u04 实证链：路由对 status>=500 把 message 换成「处理消息失败」，瞬态信号只剩 code
    const err = new PlatformAdapterError('处理消息失败', 500, {
      error: { message: '处理消息失败', code: 'ATTEMPT_TIMEOUT', status: 500 }
    })
    expect(err.retryable).toBe(true)
  })

  it('无瞬态 code 的 4xx → 不可恢复（如 NOT_FOUND）', () => {
    const err = new PlatformAdapterError('教学会话不存在', 404, {
      error: { message: '教学会话不存在', code: 'NOT_FOUND', status: 404 }
    })
    expect(err.retryable).toBe(false)
  })

  it('缺 code 但 status>=500 → 按平台内部失败判可恢复', () => {
    const err = new PlatformAdapterError('平台请求失败', 502, { error: { message: '平台请求失败' } })
    expect(err.retryable).toBe(true)
  })

  it('RETRY_BUDGET_EXHAUSTED 等 4xx 之外的瞬态 code 也判可恢复', () => {
    const err = new PlatformAdapterError('处理消息失败', 500, {
      error: { message: '处理消息失败', code: 'RETRY_BUDGET_EXHAUSTED', status: 500 }
    })
    expect(err.retryable).toBe(true)
  })
})
