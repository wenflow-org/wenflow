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

  /**
   * 2026-11-03 真人走查：这位老师每轮都以提问收尾，学员连答 4 轮才等到一次不问的回应——
   * 「末问未答」在这类授课形态下**无法被学员的动作满足**，而模块自己的活力兜底
   * （"防止老师每回合都带问号把课拖到永不收敛"）只加在模型侧。学员明确确认后放行末问。
   */
  it('waiveOpenQuestion（学员明确确认）→ 末问未答放行', () => {
    const decision = evaluateSessionClosable({
      messages: [
        { role: 'user', content: '我做完了' },
        { role: 'assistant', content: '那这一步为什么要先乘？' },
      ],
      teachingState: {},
      waiveOpenQuestion: true,
    })
    expect(decision.closable).toBe(true)
  })

  it('waiveOpenQuestion 只放行末问：未答检查点仍硬拦（那是学员自己能解决的状态）', () => {
    const decision = evaluateSessionClosable({
      ...base,
      teachingState: { pendingCheckpoint: { id: 'cp-1', question: '先算什么？' } },
      waiveOpenQuestion: true,
    })
    expect(decision.closable).toBe(false)
    expect(decision.code).toBe('FINALIZATION_PENDING_CHECKPOINT')
  })

  it('waiveOpenQuestion 不放行末次检查答错（还有重答机会时仍拦）', () => {
    const decision = evaluateSessionClosable({
      ...base,
      teachingState: {
        checkpointHistory: [{ passed: false, attempts: 1 }],
      },
      waiveOpenQuestion: true,
    })
    expect(decision.closable).toBe(false)
    expect(decision.code).toBe('FINALIZATION_LAST_CHECKPOINT_FAILED')
  })

  it('放行不影响留痕：审计与门禁同源且不看放行参数，未答末问一定写进待验证', () => {
    // 诚实记录是放行的前提：buildClosureAudit 故意不传 waiveOpenQuestion，
    // 所以「学员确认放行」的课照样被审计判为 openQuestion，由 appendClosureFollowUp
    // 把「待验证：<末问>」确定性置顶进总结的 actionPlan（不依赖 LLM 是否诚实）。
    const messages = [
      { role: 'user', content: '我做完了' },
      { role: 'assistant', content: '那这一步为什么要先乘？' },
    ]
    const audit = buildClosureAudit({ messages, teachingState: {}, endReason: 'manual-end' })
    expect(audit.openQuestion).toBe(true)
    expect(audit.question).toContain('为什么要先乘')
    const summary = appendClosureFollowUp({ actionPlan: ['继续练下一组'] }, audit)
    expect((summary as { actionPlan: string[] }).actionPlan[0]).toContain('待验证')
    expect((summary as { actionPlan: string[] }).actionPlan[0]).toContain('为什么要先乘')
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

  it('allowOpenQuestion（end_only 主动退出）→ 最后一道题答错也不拦（退出通道不被答题挡住）', () => {
    expect(evaluateSessionClosable({
      ...base,
      teachingState: { checkpointHistory: [{ passed: false, attempts: 1 }] },
      allowOpenQuestion: true,
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

  it('无问号但要求提交/回答 → 仍判未闭合（离线评审实测漏网）', () => {
    const submit = buildClosureAudit({
      messages: [
        { role: 'user', content: '标签都填好了' },
        { role: 'assistant', content: '核对完成。请更新后的 8 行标签发给我做最后确认。' },
      ],
      teachingState: {},
    })
    expect(submit.openQuestion).toBe(true)
    expect(submit.code).toBe('FINALIZATION_OPEN_QUESTION')
    expect(submit.question).toContain('发给我')

    const answer = buildClosureAudit({
      messages: [
        { role: 'user', content: '上午4周，下午2周，晚上3周' },
        { role: 'assistant', content: '数据很清晰。现在请回答下面的快速题，确认我们对忙闲倾向的判断：' },
      ],
      teachingState: {},
    })
    expect(answer.openQuestion).toBe(true)
    expect(answer.question).toContain('请回答')
  })

  it('课后建议/下一节预告不算未闭合请求', () => {
    const audit = buildClosureAudit({
      messages: [
        { role: 'user', content: '好，我记下了' },
        { role: 'assistant', content: '课内诊断闭环已完成，可以收尾了。课后建议：把这套排查逻辑整理成简短记录，下次遇到类似情况直接对照检查。' },
      ],
      teachingState: {},
    })
    expect(audit.openQuestion).toBe(false)
    expect(audit.question).toBeNull()
  })
})

/**
 * #164：回合门禁（引擎：本回合要不要宣布完成）与收束入口（complete_task 能不能结算）
 * 必须同源。旧实现的僵局：末句「今天就到这里，有问题随时告诉我」不含问号 → 引擎判完成、
 * 前端展示完成入口 → 用户点「完成任务」→ 收束入口的 detectOpenRequest 命中「告诉我」→ 409，
 * 而产品内没有第二个出口，任务结算被卡死。
 */
describe('#164 收束入口与回合门禁同源', () => {
  const courtesy = '今天就到这里，有问题随时告诉我。'

  it('客套收尾（有问题随时告诉我）→ 可结算（修复前 409 FINALIZATION_OPEN_QUESTION）', () => {
    const decision = evaluateSessionClosable({
      messages: [{ role: 'assistant', content: courtesy }],
      teachingState: {},
    })
    expect(decision).toEqual({ closable: true })
  })

  it('真·开放请求（请把结果发给我）→ 仍 409（同源不等于放宽）', () => {
    const decision = evaluateSessionClosable({
      messages: [{ role: 'assistant', content: '今天就到这里，请把整理好的三条线索发给我。' }],
      teachingState: {},
    })
    expect(decision.closable).toBe(false)
    expect(decision.code).toBe('FINALIZATION_OPEN_QUESTION')
  })

  it('客套与真请求同段相邻 → 仍判未闭合（逐句判定，客套句不吞掉请求句）', () => {
    const decision = evaluateSessionClosable({
      messages: [{
        role: 'assistant',
        content: '今天先收在这儿。有问题随时告诉我。请把整理好的三条线索发给我。',
      }],
      teachingState: {},
    })
    expect(decision.code).toBe('FINALIZATION_OPEN_QUESTION')
  })

  it('引擎延迟预算耗尽后（deferrals=cap 且宽限已用）→ 收束入口同样放行', () => {
    const decision = evaluateSessionClosable({
      messages: [{ role: 'assistant', content: '最后核对一处：先乘哪一个？' }],
      teachingState: { completionDeferrals: 6, completionCapGraceUsed: true },
    })
    expect(decision).toEqual({ closable: true })
  })

  it('预算耗尽不放行客观待答：未答检查点仍 409', () => {
    const decision = evaluateSessionClosable({
      messages: [{ role: 'assistant', content: '最后核对一处：先乘哪一个？' }],
      teachingState: {
        completionDeferrals: 6,
        completionCapGraceUsed: true,
        pendingCheckpoint: { id: 'cp-1', question: '先乘哪一个？' },
      },
    })
    expect(decision.closable).toBe(false)
    expect(decision.code).toBe('FINALIZATION_PENDING_CHECKPOINT')
  })

  it('预算未耗尽（宽限未用）→ 末问照旧拦，不提前放行', () => {
    const decision = evaluateSessionClosable({
      messages: [{ role: 'assistant', content: '最后核对一处：先乘哪一个？' }],
      teachingState: { completionDeferrals: 5, completionCapGraceUsed: false },
    })
    expect(decision.code).toBe('FINALIZATION_OPEN_QUESTION')
  })
})
