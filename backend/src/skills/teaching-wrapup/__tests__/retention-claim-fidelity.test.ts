/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1-11 输出保真：输入未提供 reviewHints 时，summary 不得出现
 * 「保持率 / 记忆保持 / 记得几成 + 数值」话术（编造量化记忆状态渲染给学生）。
 *
 * 违规样本取自 DB 实证 pcl_b863d7d9（2026-09-23，success=1）：
 *   metricInterpretation.longTerm = 「学生长期记忆保持率良好（lsb 4.6）…」
 * 合规样本取自 DB 实证 pcl_ca05e333（明确声明"未提供数值、不引用具体百分比"）。
 */
const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))
jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({}),
}))

import {
  sessionWrapupAgent,
  validateSessionWrapupParsedOutput,
  findUnsupportedRetentionClaims,
  stripUnsupportedRetentionClaims,
  hasReviewHints,
  type SessionWrapupInput,
  type SessionWrapupSummary,
} from '../index'

const INPUT_NO_HINTS = {
  messages: [
    { role: 'user', content: '闭包是什么？' },
    { role: 'assistant', content: '先看词法作用域。' },
    { role: 'user', content: '懂了。' },
  ],
  knowledgePoints: [{ name: '闭包', status: 'learning', progress: 50 }],
  sessionInfo: { subject: 'JavaScript', topic: '闭包', durationMinutes: 25, userMessageCount: 2, assistantMessageCount: 1, taskType: 'practice' },
  sessionEvidence: { turnCount: 2, avgUnderstanding: 0.7 },
} as unknown as SessionWrapupInput

const INPUT_WITH_HINTS = {
  ...INPUT_NO_HINTS,
  knowledgeContext: { reviewHints: [{ concept: '闭包', retrievability: 0.42 }] },
} as unknown as SessionWrapupInput

const EVALUATION = {
  sessionKtl: { tier: 'mid', evidence: '引导下能推进' },
  sessionLss: { tier: 'low', evidence: '整体顺畅' },
  sessionLf: { tier: 'mid', evidence: '后段一次停顿' },
  confidence: 0.6,
  reasoning: '证据有限',
}

function summaryWith(overrides: Partial<SessionWrapupSummary>): SessionWrapupSummary {
  return {
    topicSummary: '本节课围绕"闭包"进行了学习。',
    knowledgeSummary: '本节共涉及1个知识点。',
    practiceAdvice: '复盘本节课核心概念。',
    learningEvaluation: '建议根据当前掌握情况继续推进。',
    knowledgeItems: [{ name: '闭包', status: 'learning', progress: 50, evidence: '继续练习' }],
    keyTakeaways: ['完成本节学习回顾'],
    actionPlan: ['继续完成下一步练习'],
    evaluationHighlights: { strengths: ['有推进'], improvements: ['继续巩固'] },
    metricInterpretation: { session: '本节课总结已生成。', longTerm: '长期指标需后续观察。' },
    summaryVersion: 'v2',
    ...overrides,
  }
}

describe('validateSessionWrapupParsedOutput：无 reviewHints 时的保持率话术校验', () => {
  it('违规样本（pcl_b863d7d9）：metricInterpretation.longTerm 带「保持率 + 数值」→ 校验失败', () => {
    const summary = summaryWith({
      metricInterpretation: {
        session: '本节课学习压力大，学生处于高认知负荷状态（ktl 7.8）。',
        longTerm: '学生长期记忆保持率良好（lsb 4.6），建议在下一阶段增加复盘。',
      },
    })
    const result = validateSessionWrapupParsedOutput({ summary, evaluation: EVALUATION }, INPUT_NO_HINTS)
    expect(result.valid).toBe(false)
    expect((result as any).failureReason).toContain('SESSION_WRAPUP_UNSUPPORTED_RETENTION_CLAIM')
  })

  it('违规样本：actionPlan 里「记得七成」类表述同样命中', () => {
    const summary = summaryWith({ actionPlan: ['上次学的闭包现在大概记得七成，本周内复习一次更稳。'] })
    const result = validateSessionWrapupParsedOutput({ summary, evaluation: EVALUATION }, INPUT_NO_HINTS)
    expect(result.valid).toBe(false)
  })

  it('合规样本（pcl_ca05e333）：声明"未提供数值、不引用百分比"→ 通过（不误伤）', () => {
    const summary = summaryWith({
      metricInterpretation: {
        session: '本节困惑多但手没停。',
        longTerm: '本次输入未提供长期记忆保持率的数值，因此不引用具体百分比。复习清单里的两点建议下一课开场优先回收。',
      },
    })
    expect(validateSessionWrapupParsedOutput({ summary, evaluation: EVALUATION }, INPUT_NO_HINTS)).toEqual({ valid: true })
  })

  it('合规样本：普通总结（无保持率话术）→ 通过', () => {
    expect(validateSessionWrapupParsedOutput({ summary: summaryWith({}), evaluation: EVALUATION }, INPUT_NO_HINTS))
      .toEqual({ valid: true })
  })

  it('reviewHints 在场 → 带数值的保持率引用合法（P1-10 修好后不再误伤）', () => {
    const summary = summaryWith({
      metricInterpretation: { session: '本节总结。', longTerm: '闭包目前记得约四成（42%），本周内复习一次更稳。' },
    })
    expect(validateSessionWrapupParsedOutput({ summary, evaluation: EVALUATION }, INPUT_WITH_HINTS)).toEqual({ valid: true })
  })

  it('不传 input（既有单参调用点）→ 跳过该检查，行为不变', () => {
    const summary = summaryWith({ actionPlan: ['保持率大概七成。'] })
    expect(validateSessionWrapupParsedOutput({ summary, evaluation: EVALUATION })).toEqual({ valid: true })
  })
})

describe('findUnsupportedRetentionClaims / stripUnsupportedRetentionClaims', () => {
  it('hasReviewHints：缺失/空数组 = 无数据；非空 = 有数据', () => {
    expect(hasReviewHints(INPUT_NO_HINTS)).toBe(false)
    expect(hasReviewHints({ ...INPUT_NO_HINTS, knowledgeContext: { reviewHints: [] } } as any)).toBe(false)
    expect(hasReviewHints(INPUT_WITH_HINTS)).toBe(true)
    expect(hasReviewHints(undefined)).toBe(false)
  })

  it('命中面覆盖 knowledgeItems.evidence 与 evaluationHighlights', () => {
    const hits = findUnsupportedRetentionClaims(
      summaryWith({
        knowledgeItems: [{ name: '闭包', status: 'mastered', progress: 90, evidence: '长期记忆保持率约 90%，很稳。' }],
        evaluationHighlights: { strengths: ['记忆保持率 85%'], improvements: ['继续巩固'] },
      }),
      false,
    )
    expect(hits.length).toBe(2)
  })

  it('剥离只删违规小句，保留同字段其余内容', () => {
    const summary = summaryWith({
      metricInterpretation: {
        session: '本节总结已生成。',
        longTerm: '学生长期记忆保持率良好（lsb 4.6），建议增加复盘。',
      },
      actionPlan: ['不看笔记说出三个要点。', '保持率大概七成。'],
    })
    const { summary: clean, removed } = stripUnsupportedRetentionClaims(summary, false)
    expect(removed.length).toBe(2)
    expect(clean.metricInterpretation.longTerm).not.toContain('保持率')
    expect(clean.metricInterpretation.longTerm).toContain('建议增加复盘')
    expect(clean.actionPlan).toEqual(['不看笔记说出三个要点。'])
    expect(findUnsupportedRetentionClaims(clean, false)).toEqual([])
    // 入参不被修改
    expect(summary.metricInterpretation.longTerm).toContain('保持率')
  })

  it('整字段被剥离清空时补中性文案（仍不含保持率话术）', () => {
    const summary = summaryWith({
      metricInterpretation: { session: '本节总结。', longTerm: '记忆保持率 92%。' },
    })
    const { summary: clean } = stripUnsupportedRetentionClaims(summary, false)
    expect(clean.metricInterpretation.longTerm).not.toContain('保持率')
    expect(clean.metricInterpretation.longTerm.trim().length).toBeGreaterThan(0)
  })

  it('有 reviewHints 时零改动（合法引用不被剥离）', () => {
    const summary = summaryWith({ actionPlan: ['闭包记得四成，本周复习一次。'] })
    const { summary: clean, removed } = stripUnsupportedRetentionClaims(summary, true)
    expect(removed).toEqual([])
    expect(clean).toBe(summary)
  })
})

describe('SessionWrapupAgent：违规输出经剥离后不渲染给学生（确定性兜底）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: {
        summary: summaryWith({
          metricInterpretation: {
            session: '本节课学习压力大。',
            longTerm: '学生长期记忆保持率良好（lsb 4.6），建议增加复盘。',
          },
        }),
        evaluation: EVALUATION,
      },
      debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
    })
  })

  it('主 prompt 直接返回违规 summary（重试未生效）→ 剥离后输出不含带数值的保持率断言', async () => {
    const result = await sessionWrapupAgent.generate(INPUT_NO_HINTS as any)
    expect(result.summary.metricInterpretation.longTerm).not.toContain('保持率')
    expect(findUnsupportedRetentionClaims(result.summary, false)).toEqual([])
    // 其余内容保留（非 fallback 降级）
    expect(result.summarySource).toBe('model')
    expect(result.summary.topicSummary).toContain('闭包')
  })

  it('输入带 reviewHints 时不剥离（合法引用保留）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: {
        summary: summaryWith({
          metricInterpretation: { session: '本节总结。', longTerm: '闭包目前记得四成（42%），本周复习一次更稳。' },
        }),
        evaluation: EVALUATION,
      },
      debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
    })
    const result = await sessionWrapupAgent.generate(INPUT_WITH_HINTS as any)
    expect(result.summary.metricInterpretation.longTerm).toContain('42%')
  })
})