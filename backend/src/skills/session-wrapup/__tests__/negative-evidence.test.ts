import { downgradeMasteredOnNegativeEvidence, capMasteredOnInsufficientEvidence } from '../index'
import type { SessionWrapupSummary } from '../index'

/**
 * 修复批 6（WRAPUP_MASTERY_OVERCLAIM 课堂聚类 major×8）：收束标 mastered 的点必须核对
 * 课内客观反面记录——检查点未通过/跳过（其后无更晚通过）或误解记录命中 → 降档封顶 79。
 * 证据回链闸（#52 ④）拦不住「学员说过但被纠过错」；本闸按 checkpointHistory/误解名单收口。
 */
function summaryWith(items: Array<{ name: string; status: 'mastered' | 'learning'; progress: number; evidence: string }>): SessionWrapupSummary {
  return {
    topicSummary: '本节围绕合同条款核对。',
    knowledgeSummary: '讲了两个口径。',
    learningEvaluation: '完成度良好。',
    knowledgeItems: items,
    keyTakeaways: [],
    practiceAdvice: '继续复习。',
    actionPlan: [],
    evaluationHighlights: { strengths: [], improvements: [] },
    metricInterpretation: { session: '', longTerm: '' },
  } as unknown as SessionWrapupSummary
}

describe('downgradeMasteredOnNegativeEvidence', () => {
  const HISTORY = [
    { conceptName: '核对基本条款一致性', passed: false, submittedAt: '2026-11-13T10:00:00Z' },
    { conceptName: '试用期上限口径', passed: true, submittedAt: '2026-11-13T10:05:00Z' },
  ]

  it('概念有未通过行且其后无通过 → mastered 降 learning、封顶 79、打标记', () => {
    const result = downgradeMasteredOnNegativeEvidence(
      summaryWith([{ name: '核对基本条款一致性', status: 'mastered', progress: 100, evidence: '学员复述过口径' }]),
      { checkpointHistory: HISTORY },
    )
    expect(result.downgraded).toEqual(['核对基本条款一致性'])
    const item = result.summary.knowledgeItems[0] as any
    expect(item.status).toBe('learning')
    expect(item.progress).toBeLessThanOrEqual(79)
    expect(item.negativeEvidenceDowngraded).toBe(true)
  })

  it('先失败后通过（更晚 passed=true）→ 掌握成立，不降档', () => {
    const result = downgradeMasteredOnNegativeEvidence(
      summaryWith([{ name: '试用期上限口径', status: 'mastered', progress: 90, evidence: '学员说对了' }]),
      {
        checkpointHistory: [
          { conceptName: '试用期上限口径', passed: false, submittedAt: '2026-11-13T10:00:00Z' },
          { conceptName: '试用期上限口径', passed: true, submittedAt: '2026-11-13T10:05:00Z' },
        ],
      },
    )
    expect(result.downgraded).toEqual([])
    expect(result.summary.knowledgeItems[0].status).toBe('mastered')
  })

  it('失败在通过之后（通过后又答错）→ 反面成立，降档', () => {
    const result = downgradeMasteredOnNegativeEvidence(
      summaryWith([{ name: '试用期上限口径', status: 'mastered', progress: 95, evidence: '早先答对过' }]),
      {
        checkpointHistory: [
          { conceptName: '试用期上限口径', passed: true, submittedAt: '2026-11-13T10:00:00Z' },
          { conceptName: '试用期上限口径', passed: false, submittedAt: '2026-11-13T10:08:00Z' },
        ],
      },
    )
    expect(result.downgraded).toEqual(['试用期上限口径'])
    expect(result.summary.knowledgeItems[0].status).toBe('learning')
  })

  it('voided 行不算反面；概念无任何匹配行 → 判不了，不动（证据不足不惩罚）', () => {
    const result = downgradeMasteredOnNegativeEvidence(
      summaryWith([
        { name: '竞业限制口径', status: 'mastered', progress: 100, evidence: '学员说清了' },
        { name: '成果归属口径', status: 'mastered', progress: 88, evidence: '学员说清了' },
      ]),
      {
        checkpointHistory: [
          { conceptName: '竞业限制口径', passed: false, voided: true, submittedAt: '2026-11-13T10:00:00Z' },
        ],
      },
    )
    expect(result.downgraded).toEqual([])
    expect(result.summary.knowledgeItems.every((item) => item.status === 'mastered')).toBe(true)
  })

  it('误解概念名单命中 → 降档（不依赖 checkpointHistory）', () => {
    const result = downgradeMasteredOnNegativeEvidence(
      summaryWith([{ name: '工时混档判断', status: 'mastered', progress: 100, evidence: '学员复述过' }]),
      { misconceptionConceptNames: ['工时混档判断'] },
    )
    expect(result.downgraded).toEqual(['工时混档判断'])
    expect(result.summary.knowledgeItems[0].status).toBe('learning')
  })

  it('learning 点不参与核对；无 checkpointHistory 输入 → 全部原样', () => {
    const result = downgradeMasteredOnNegativeEvidence(
      summaryWith([
        { name: '核对基本条款一致性', status: 'learning', progress: 40, evidence: '还在学' },
        { name: '试用期上限口径', status: 'mastered', progress: 90, evidence: '说对了' },
      ]),
      {},
    )
    expect(result.downgraded).toEqual([])
    expect(result.summary.knowledgeItems[1].status).toBe('mastered')
  })
})

/* ────────────── 掌握证据强度门（修复批 10-D2，交流体验评审 §19.2#2 证据通胀） ────────────── */

describe('capMasteredOnInsufficientEvidence', () => {
  it('Gate A 全复述：概念通过行全部带 answerAlreadyGiven → 降档封顶 79', () => {
    const result = capMasteredOnInsufficientEvidence(
      summaryWith([{ name: '期限起算口径', status: 'mastered', progress: 88, evidence: '学员复述过' }]),
      {
        checkpointHistory: [
          { conceptName: '期限起算口径', passed: true, answerAlreadyGiven: true, submittedAt: '2026-11-14T10:00:00Z' },
          { conceptName: '期限起算口径', passed: true, answerAlreadyGiven: true, submittedAt: '2026-11-14T10:06:00Z' },
        ],
      },
    )
    expect(result.recallDowngraded).toEqual(['期限起算口径'])
    const item = result.summary.knowledgeItems[0] as any
    expect(item.status).toBe('learning')
    expect(item.progress).toBeLessThanOrEqual(79)
    expect(item.recallEvidenceDowngraded).toBe(true)
  })

  it('Gate A 不误伤：存在独立通过行（无复述标记）→ 原样', () => {
    const result = capMasteredOnInsufficientEvidence(
      summaryWith([{ name: '期限起算口径', status: 'mastered', progress: 88, evidence: '学员自己判了新条款' }]),
      {
        checkpointHistory: [
          { conceptName: '期限起算口径', passed: true, answerAlreadyGiven: true, submittedAt: '2026-11-14T10:00:00Z' },
          { conceptName: '期限起算口径', passed: true, submittedAt: '2026-11-14T10:06:00Z' },
        ],
      },
    )
    expect(result.recallDowngraded).toEqual([])
    expect(result.summary.knowledgeItems[0].status).toBe('mastered')
  })

  it('Gate B 零行零证据：无检查点行且 evidence 归一 <6 字 → 降档', () => {
    const result = capMasteredOnInsufficientEvidence(
      summaryWith([{ name: '合成净额', status: 'mastered', progress: 90, evidence: '扫一眼' }]),
      { checkpointHistory: [{ conceptName: '应收账款方向', passed: true, submittedAt: '2026-11-14T10:00:00Z' }] },
    )
    expect(result.unverifiedDowngraded).toEqual(['合成净额'])
    expect((result.summary.knowledgeItems[0] as any).status).toBe('learning')
    expect((result.summary.knowledgeItems[0] as any).lessonEvidenceMissing).toBe(true)
  })

  it('Gate B 不误伤：零行但 evidence 有实质产出句 → 原样', () => {
    const result = capMasteredOnInsufficientEvidence(
      summaryWith([{ name: '合成净额', status: 'mastered', progress: 90, evidence: '学员自己报出净额负400并解释了方向' }]),
      {},
    )
    expect(result.unverifiedDowngraded).toEqual([])
    expect(result.summary.knowledgeItems[0].status).toBe('mastered')
  })

  it('Gate C 单例通过：1 行独立通过且 progress > 89 → 封顶 89、状态保留', () => {
    const result = capMasteredOnInsufficientEvidence(
      summaryWith([{ name: '识别多副本', status: 'mastered', progress: 90, evidence: '学员首答判对' }]),
      { checkpointHistory: [{ conceptName: '识别多副本', passed: true, submittedAt: '2026-11-14T10:00:00Z' }] },
    )
    expect(result.singlePassCapped).toEqual(['识别多副本'])
    const item = result.summary.knowledgeItems[0] as any
    expect(item.status).toBe('mastered')
    expect(item.progress).toBe(89)
    expect(item.singlePassEvidenceCapped).toBe(true)
  })

  it('learning 点与空 summary 原样返回', () => {
    const result = capMasteredOnInsufficientEvidence(
      summaryWith([{ name: '还在学', status: 'learning', progress: 40, evidence: '' }]),
      {},
    )
    expect(result.recallDowngraded).toEqual([])
    expect(result.unverifiedDowngraded).toEqual([])
    expect(result.singlePassCapped).toEqual([])
    expect(capMasteredOnInsufficientEvidence(undefined as any, {})).toEqual({
      summary: undefined,
      recallDowngraded: [],
      unverifiedDowngraded: [],
      singlePassCapped: [],
    })
  })
})
