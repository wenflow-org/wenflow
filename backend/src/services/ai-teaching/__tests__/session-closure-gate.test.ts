import { appendClosureFollowUp, buildClosureAudit, evaluateSessionClosable } from '../teaching-closure'

/**
 * #51 P-25：endSession 前机械门禁。放弃/异常终态豁免；检查点到顶后允许带错收束。
 */
describe('evaluateSessionClosable', () => {
  const base = {
    messages: [{ role: 'assistant', content: '我们开始吧。' }, { role: 'user', content: '好' }],
    teachingState: {} as Record<string, unknown>,
  }

  it('问答闭合 → 可收束', () => {
    expect(evaluateSessionClosable(base)).toEqual({ closable: true })
  })

  it('未作答检查点 → 拒绝并给 409 语义 code', () => {
    const decision = evaluateSessionClosable({
      ...base,
      teachingState: { pendingCheckpoint: { id: 'cp-1', question: '先算什么？' } },
    })
    expect(decision.closable).toBe(false)
    expect(decision.code).toBe('FINALIZATION_PENDING_CHECKPOINT')
  })

  it('末条 assistant 抛了问题且其后没有 user 作答 → 拒绝', () => {
    const decision = evaluateSessionClosable({
      messages: [
        { role: 'user', content: '我做完了' },
        { role: 'assistant', content: '那这一步为什么要先乘？' },
      ],
      teachingState: {},
    })
    expect(decision.closable).toBe(false)
    expect(decision.code).toBe('FINALIZATION_OPEN_QUESTION')
  })

  it('allowOpenQuestion（复习课有界收束）→ 末问未答也放行', () => {
    const decision = evaluateSessionClosable({
      messages: [
        { role: 'user', content: '我做完了' },
        { role: 'assistant', content: '那这一步为什么要先乘？' },
      ],
      teachingState: {},
      allowOpenQuestion: true,
    })
    expect(decision.closable).toBe(true)
  })

  it('allowOpenQuestion（复习课有界收束）→ 未答检查点也放行（未答点按无观测跳过）', () => {
    const decision = evaluateSessionClosable({
      messages: [{ role: 'assistant', content: '选一个吧' }],
      teachingState: { pendingCheckpoint: { id: 'cp-1' } },
      allowOpenQuestion: true,
    })
    expect(decision.closable).toBe(true)
  })

  it('问题之后已有学生回答 → 放行', () => {
    const decision = evaluateSessionClosable({
      messages: [
        { role: 'assistant', content: '那这一步为什么要先乘？' },
        { role: 'user', content: '因为有括号要先算括号里的' },
      ],
      teachingState: {},
    })
    expect(decision.closable).toBe(true)
  })

  it('末次检查点答错且还有重答次数 → 拒绝；到顶（2 次）→ 放行（记复习清单后收课是合法形态）', () => {
    expect(evaluateSessionClosable({
      ...base,
      teachingState: { checkpointHistory: [{ passed: false, attempts: 1 }] },
    }).code).toBe('FINALIZATION_LAST_CHECKPOINT_FAILED')

    expect(evaluateSessionClosable({
      ...base,
      teachingState: { checkpointHistory: [{ passed: false, attempts: 2 }] },
    }).closable).toBe(true)
  })

  it('放弃/异常终态一律放行（未答完不等于缺陷）', () => {
    for (const endReason of ['learner-abandoned', 'timeout', 'error']) {
      expect(evaluateSessionClosable({
        ...base,
        endReason,
        teachingState: { pendingCheckpoint: { id: 'cp-1' } },
      }).closable).toBe(true)
    }
  })
})

// 2026-10-24 离线评审基线（85% 课堂未答收口）：end_only 可以放开收束，但必须留下
// 「待验证」事实，不能把会话结束读成任务完成。
describe('buildClosureAudit / appendClosureFollowUp', () => {
  const openMessages = [
    { role: 'user', content: '我做完了' },
    { role: 'assistant', content: '算得不错。那这一步为什么要先乘？' },
  ]

  it('末问未答 → openQuestion=true，记录原因码与原问题', () => {
    const audit = buildClosureAudit({ messages: openMessages, teachingState: { completionDeferrals: 2 } })
    expect(audit.openQuestion).toBe(true)
    expect(audit.code).toBe('FINALIZATION_OPEN_QUESTION')
    expect(audit.question).toContain('为什么要先乘')
    expect(audit.deferredTimes).toBe(2)
  })

  it('学生已答 → openQuestion=false', () => {
    const audit = buildClosureAudit({
      messages: [
        { role: 'assistant', content: '那这一步为什么要先乘？' },
        { role: 'user', content: '因为有括号' },
      ],
      teachingState: {},
    })
    expect(audit.openQuestion).toBe(false)
    expect(audit.question).toBeNull()
  })

  it('未答检查点 → 原因码为 FINALIZATION_PENDING_CHECKPOINT', () => {
    const audit = buildClosureAudit({
      messages: [{ role: 'assistant', content: '开始吧' }],
      teachingState: { pendingCheckpoint: { id: 'cp-1' } },
    })
    expect(audit.openQuestion).toBe(true)
    expect(audit.code).toBe('FINALIZATION_PENDING_CHECKPOINT')
  })

  it('异常终态不算未答收口缺陷', () => {
    const audit = buildClosureAudit({
      messages: openMessages,
      teachingState: {},
      endReason: 'learner-abandoned',
    })
    expect(audit.openQuestion).toBe(false)
  })

  it('appendClosureFollowUp 把待验证置顶且可重复调用不重复', () => {
    const audit = buildClosureAudit({ messages: openMessages, teachingState: {} })
    const summary = { actionPlan: ['继续练习', '待验证：旧项'], topicSummary: 'x' }
    const once = appendClosureFollowUp(summary, audit)
    const twice = appendClosureFollowUp(once, audit)
    expect(once.actionPlan[0]).toContain('待验证：')
    expect(once.actionPlan[0]).toContain('为什么要先乘')
    expect(once.actionPlan.filter((item) => String(item).startsWith('待验证：'))).toHaveLength(1)
    expect(twice.actionPlan).toEqual(once.actionPlan)
  })
})
