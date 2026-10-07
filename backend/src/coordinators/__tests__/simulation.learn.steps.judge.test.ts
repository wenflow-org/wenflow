/**
 * 判决器接线包（审计 P1-4/P1-5/P1-6）单元测试 —— learn.steps 纯函数面
 *
 * 钉死的契约：
 * - P1-5：computeClosureDecision 把认知判决接进完成链——sampledCorrectness=false 或
 *   masteryProb 低于阈值时 learnerReady=false（判 0.3 掌握不得结课）；判决缺失保持现状。
 * - P1-4：auditGroundingCompliance 在 virtualReplyResult 组装处对 blockedConcept 与 reply
 *   做一致性检查：reply 未暴露卡点 / 自评掌握度越界 → 记 drift（不改写文本）。
 * - P1-6：reconcileKnowledgeBoardWithJudgment 落库前对账——判错轮被 blockedConcept 命中的
 *   mastered 看板项降级为 learning（progress ≤40）。回归语料 = 2026-10-07 只读抽查
 *   prompt_call_logs 最近 12 条成功行（6 条矛盾口径，见文件内注释与 DB 复现命令）。
 */
const mockGetDueTraces = jest.fn().mockResolvedValue([])
const mockPrisma = {
  virtual_learner_profiles: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
  teaching_sessions: { findUnique: jest.fn().mockResolvedValue(null) },
  virtual_sessions: { findUnique: jest.fn().mockResolvedValue(null) },
}
jest.mock('../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../skills', () => ({
  __esModule: true,
  executeSkill: jest.fn().mockResolvedValue(null),
  virtualLearnerMemoryCuratorDefinition: { name: 'virtual-learner-memory-curator', version: '1.0.0' },
}))
jest.mock('../../services/memory/memory-trace.service', () => ({
  memoryTraceService: { recordSessionOutcome: jest.fn(), getDueTraces: (...args: unknown[]) => mockGetDueTraces(...args) },
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import {
  computeClosureDecision,
  auditGroundingCompliance,
  clampLearnerStateToJudgment,
  demoteProfileKnownConcepts,
  reconcileKnowledgeBoardWithJudgment,
  evaluateJudgeCompletionGate,
  LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD,
} from '../simulation.learn.steps'
import { buildLearnerMemorySnapshot } from '../../virtual-lab/learner-memory'

const teacherDone = {
  isCompletion: true,
  autoEnded: false,
  promptDebug: { learnDebug: { output: { stageDecision: { stage: 'closing' } } } },
}
const learnerDone = {
  selfReportedTaskDone: true,
  wantsMoreHelp: false,
  stopAsking: true,
  remainingBlockers: [] as string[],
}

describe('P1-5 · computeClosureDecision 判决完成门', () => {
  it('判决缺失 → 原路径放行（教师收束 + 学生自评完成即可结课）', () => {
    const decision = computeClosureDecision(teacherDone, learnerDone, null)
    expect(decision.canCompleteTask).toBe(true)
    expect(decision.learnerReady).toBe(true)
  })

  it('sampledCorrectness=false → learnerReady=false，判 0.3 掌握不得结课', () => {
    const decision = computeClosureDecision(teacherDone, learnerDone, {
      sampledCorrectness: false,
      blockedConcept: '执行停—绕—留钩子降级',
      errorPattern: null,
      masteryProb: 0.3,
    })
    expect(decision.learnerReady).toBe(false)
    expect(decision.canCompleteTask).toBe(false)
    expect(decision.reason).toContain('judge-sampled-correctness-false')
  })

  it('判对但 masteryProb 低于阈值 → 同样拦截', () => {
    const decision = computeClosureDecision(teacherDone, learnerDone, {
      sampledCorrectness: true,
      blockedConcept: null,
      errorPattern: null,
      masteryProb: 0.4,
    })
    expect(decision.canCompleteTask).toBe(false)
    expect(decision.reason).toContain('judge-mastery-below-threshold')
  })

  it('判对且掌握达标 → 放行', () => {
    const decision = computeClosureDecision(teacherDone, learnerDone, {
      sampledCorrectness: true,
      blockedConcept: null,
      errorPattern: null,
      masteryProb: 0.8,
    })
    expect(decision.canCompleteTask).toBe(true)
  })

  it('evaluateJudgeCompletionGate 与阈值常量：等于阈值放行', () => {
    expect(
      evaluateJudgeCompletionGate({
        sampledCorrectness: true,
        blockedConcept: null,
        errorPattern: null,
        masteryProb: LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD,
      }).allowsCompletion
    ).toBe(true)
  })
})

describe('P1-4 · auditGroundingCompliance（blockedConcept × reply 一致性核验）', () => {
  const judgeFalse = {
    sampledCorrectness: false,
    blockedConcept: '执行停—绕—留钩子降级',
    errorPattern: '把降级当成删除',
    masteryProb: 0.3,
  }

  it('reply 命中 blockedConcept 片段 + 自评掌握度未越界 → compliant', () => {
    const audit = auditGroundingCompliance({
      grounding: judgeFalse,
      reply: '我卡在这——执行停—绕—留钩子降级这一步我没想明白，就停住了。',
      learnerState: { conceptualMastery: 0.3, proceduralMastery: 0.25 },
    })
    expect(audit.judged).toBe(true)
    expect(audit.conceptSurfacedInReply).toBe(true)
    expect(audit.masteryWithinBound).toBe(true)
    expect(audit.compliant).toBe(true)
    expect(audit.drift).toEqual([])
  })

  it('判错但 reply 流畅答对（未暴露卡点）→ drift=blocked-concept-not-surfaced', () => {
    const audit = auditGroundingCompliance({
      grounding: judgeFalse,
      reply: '嗯，我把三行合并好了，这样应该就是对的。',
      learnerState: { conceptualMastery: 0.9, proceduralMastery: 0.9 },
    })
    expect(audit.compliant).toBe(false)
    expect(audit.drift).toContain('blocked-concept-not-surfaced')
    expect(audit.drift).toContain('mastery-exceeds-judgment-bound')
  })

  it('判对轮不做卡点核对（compliant 恒 true，无 drift）', () => {
    const audit = auditGroundingCompliance({
      grounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.8 },
      reply: '我会了。',
      learnerState: { conceptualMastery: 0.85 },
    })
    expect(audit.compliant).toBe(true)
    expect(audit.drift).toEqual([])
  })

  it('判决缺失 → judged=false，不产生漂移', () => {
    const audit = auditGroundingCompliance({ grounding: null, reply: '随便', learnerState: null })
    expect(audit.judged).toBe(false)
    expect(audit.compliant).toBe(true)
  })

  it('判错却宣称"我会了/明白了"（即便提到 blockedConcept）→ drift=judge-false-but-reply-claims-success', () => {
    const audit = auditGroundingCompliance({
      grounding: { sampledCorrectness: false, blockedConcept: '识别父母抵触信号', errorPattern: null, masteryProb: 0.3 },
      reply: '我明白了，识别父母抵触信号就是先看父母有没有说不行，这一步我会了',
      learnerState: { conceptualMastery: 0.3, proceduralMastery: 0.3 },
    })
    expect(audit.conceptSurfacedInReply).toBe(true)
    expect(audit.replyClaimsSuccess).toBe(true)
    expect(audit.compliant).toBe(false)
    expect(audit.drift).toContain('judge-false-but-reply-claims-success')
  })

  it('判错且如实暴露卡点、无成功声明 → 仍 compliant', () => {
    const audit = auditGroundingCompliance({
      grounding: { sampledCorrectness: false, blockedConcept: '识别父母抵触信号', errorPattern: null, masteryProb: 0.3 },
      reply: '我卡在这——识别父母抵触信号我还是没想清楚，不太确定。',
      learnerState: { conceptualMastery: 0.25, proceduralMastery: 0.2 },
    })
    expect(audit.replyClaimsSuccess).toBe(false)
    expect(audit.compliant).toBe(true)
  })
})

describe('P1-4 · clampLearnerStateToJudgment（掌握度上界钳制）', () => {
  it('判错 + masteryProb=0.3 时把 0.9 的自评掌握度钳到 0.3，并回报被钳字段', () => {
    const { learnerState, clampedFields } = clampLearnerStateToJudgment(
      { conceptualMastery: 0.9, proceduralMastery: 0.85, taskUnderstanding: 0.9 },
      { sampledCorrectness: false, blockedConcept: '执行停—绕—留钩子降级', errorPattern: null, masteryProb: 0.3 }
    )
    expect(learnerState.conceptualMastery).toBe(0.3)
    expect(learnerState.proceduralMastery).toBe(0.3)
    expect(learnerState.taskUnderstanding).toBe(0.9)
    expect(clampedFields).toEqual(['conceptualMastery', 'proceduralMastery'])
  })

  it('判对 / 判决缺失 → 原样不改（宁松勿误伤）', () => {
    const state = { conceptualMastery: 0.9, proceduralMastery: 0.9 }
    expect(clampLearnerStateToJudgment(state, { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.2 }).learnerState).toEqual(state)
    expect(clampLearnerStateToJudgment(state, null).clampedFields).toEqual([])
  })

  it('不改写入参', () => {
    const state = { conceptualMastery: 0.9 }
    clampLearnerStateToJudgment(state, { sampledCorrectness: false, blockedConcept: 'X', errorPattern: null, masteryProb: 0.3 })
    expect(state.conceptualMastery).toBe(0.9)
  })
})

describe('P1-6 · reconcileKnowledgeBoardWithJudgment（看板 × 判决对账）', () => {
  /**
   * 回归语料（忠实转录）：2026-10-07 只读抽查（node:sqlite readOnly + 参数绑定）
   * prompt_call_logs agentId='skill:virtual-learner-learn-turn-simulator'，以
   * pcl_9f1a2be3-27a4-4f76-b2c8-8733dd5e2519 的 createdAt 为锚的最近 12 条成功行。
   * judge/masteryProb/blockedConcept 与看板命中行（status/progress）逐字段照抄 DB：
   *   6 条 judge=false 且 blockedConcept 在看板为 mastered/100；6 条 judge=true 无 blockedConcept。
   * （judge=true 行的 knowledgePoints 仅代表其本轮看板项，blockedConcept=null 故对账恒为 no-op。）
   */
  const corpus: Array<{
    id: string
    grounding: { sampledCorrectness: boolean; blockedConcept: string | null; errorPattern: string | null; masteryProb: number } | null
    knowledgePoints: Array<{ name: string; status: string; progress: number }>
  }> = [
    { id: 'pcl_9f1a2be3-2', grounding: { sampledCorrectness: false, blockedConcept: '执行停—绕—留钩子降级', errorPattern: null, masteryProb: 0.3 }, knowledgePoints: [{ name: '执行停—绕—留钩子降级', status: 'mastered', progress: 100 }] },
    { id: 'pcl_e848b0aa-d', grounding: { sampledCorrectness: false, blockedConcept: '识别父母抵触信号', errorPattern: null, masteryProb: 0.3 }, knowledgePoints: [{ name: '识别父母抵触信号', status: 'mastered', progress: 100 }] },
    { id: 'pcl_e2c23046-a', grounding: { sampledCorrectness: false, blockedConcept: '标注寄存器位到引脚现象', errorPattern: null, masteryProb: 0.25 }, knowledgePoints: [{ name: '标注寄存器位到引脚现象', status: 'mastered', progress: 100 }] },
    { id: 'pcl_c023c9bc-3', grounding: { sampledCorrectness: false, blockedConcept: '标注寄存器位到引脚现象', errorPattern: null, masteryProb: 0.28 }, knowledgePoints: [{ name: '标注寄存器位到引脚现象', status: 'mastered', progress: 100 }] },
    { id: 'pcl_61943802-0', grounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.72 }, knowledgePoints: [{ name: '执行停—绕—留钩子降级', status: 'mastered', progress: 100 }] },
    { id: 'pcl_87cc4a14-c', grounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.72 }, knowledgePoints: [{ name: '标注寄存器位到引脚现象', status: 'mastered', progress: 100 }] },
    { id: 'pcl_5595e8ef-b', grounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.72 }, knowledgePoints: [{ name: '执行停—绕—留钩子降级', status: 'mastered', progress: 100 }] },
    { id: 'pcl_789abdba-2', grounding: { sampledCorrectness: false, blockedConcept: '执行停—绕—留钩子降级', errorPattern: null, masteryProb: 0.45 }, knowledgePoints: [{ name: '执行停—绕—留钩子降级', status: 'mastered', progress: 100 }] },
    { id: 'pcl_0ad898e5-8', grounding: { sampledCorrectness: false, blockedConcept: '执行停—绕—留钩子降级', errorPattern: null, masteryProb: 0.35 }, knowledgePoints: [{ name: '执行停—绕—留钩子降级', status: 'mastered', progress: 100 }] },
    { id: 'pcl_b1847dc0-e', grounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.72 }, knowledgePoints: [{ name: '识别父母抵触信号', status: 'mastered', progress: 100 }] },
    { id: 'pcl_398f56eb-1', grounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.72 }, knowledgePoints: [{ name: '标注寄存器位到引脚现象', status: 'mastered', progress: 100 }] },
    { id: 'pcl_5c4b286a-a', grounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.75 }, knowledgePoints: [{ name: 'GPIO_Init 结构体到 CRL/CRH 位域的翻译', status: 'mastered', progress: 100 }] },
  ]

  it('n=12 语料：6 条矛盾行全部降级，6 条无矛盾行原样（对照审计口径 6/12）', () => {
    let downgradedRows = 0
    let untouchedRows = 0
    for (const row of corpus) {
      const { points, downgraded } = reconcileKnowledgeBoardWithJudgment(row.knowledgePoints, row.grounding)
      if (downgraded.length > 0) {
        downgradedRows++
        expect(downgraded).toEqual([
          { name: row.grounding!.blockedConcept, from: 'mastered', to: 'learning' },
        ])
        expect(points[0].status).toBe('learning')
        expect(Number(points[0].progress)).toBeLessThanOrEqual(40)
      } else {
        untouchedRows++
        expect(points).toEqual(row.knowledgePoints)
      }
    }
    expect(downgradedRows).toBe(6)
    expect(untouchedRows).toBe(6)
  })

  it('判决缺失 → 原样返回（宁松勿误伤）', () => {
    const points = [{ name: '识别父母抵触信号', status: 'mastered', progress: 100 }]
    const { points: next, downgraded } = reconcileKnowledgeBoardWithJudgment(points, null)
    expect(next).toEqual(points)
    expect(downgraded).toEqual([])
  })

  it('判错但看板项非 mastered（learning/review）→ 不降级、不改写', () => {
    const points = [{ name: '识别父母抵触信号', status: 'review', progress: 70 }]
    const { points: next, downgraded } = reconcileKnowledgeBoardWithJudgment(points, {
      sampledCorrectness: false,
      blockedConcept: '识别父母抵触信号',
      errorPattern: null,
      masteryProb: 0.3,
    })
    expect(downgraded).toEqual([])
    expect(next).toEqual(points)
  })

  it('不改写入参数组（返回新数组）', () => {
    const points = [{ name: '执行停—绕—留钩子降级', status: 'mastered', progress: 100 }]
    const snapshot = JSON.parse(JSON.stringify(points))
    reconcileKnowledgeBoardWithJudgment(points, {
      sampledCorrectness: false,
      blockedConcept: '执行停—绕—留钩子降级',
      errorPattern: null,
      masteryProb: 0.3,
    })
    expect(points).toEqual(snapshot)
  })
})

describe('P1-6 闭环 · demoteProfileKnownConcepts（画像 knownConcepts 定向移除）', () => {
  it('把 stale knownConcepts 移除、同名保留到 struggleConcepts', () => {
    const next = demoteProfileKnownConcepts(
      { knownConcepts: ['执行停—绕—留钩子降级', '别的概念'], struggleConcepts: ['另一处卡点'] },
      [{ name: '执行停—绕—留钩子降级', from: 'mastered', to: 'learning' }]
    )
    expect(next.knownConcepts).toEqual(['别的概念'])
    expect(next.struggleConcepts).toEqual(['另一处卡点', '执行停—绕—留钩子降级'])
  })

  it('无降级项 → 原样（宁松勿误伤）', () => {
    const profileData = { knownConcepts: ['A'], struggleConcepts: [] }
    expect(demoteProfileKnownConcepts(profileData, [])).toEqual(profileData)
  })

  it('真实读侧闭环：demotion 后 buildLearnerMemorySnapshot 的 mastered 不再含被判错概念', async () => {
    const blocked = '执行停—绕—留钩子降级'
    const baseProfileData = { knownConcepts: [blocked, '另一个已掌握'], struggleConcepts: [] }
    mockGetDueTraces.mockResolvedValue([])

    // 对照：未 demotion → 该概念仍以 mastered 进入看板
    mockPrisma.virtual_learner_profiles.findUnique.mockResolvedValue({ profile: JSON.stringify(baseProfileData) })
    const before = await buildLearnerMemorySnapshot('u1')
    expect(before.mastered.map((m) => m.name)).toContain(blocked)

    // demotion 后 → 读回不再含该概念，且进入 struggling
    const demoted = demoteProfileKnownConcepts(baseProfileData, [{ name: blocked, from: 'mastered', to: 'learning' }])
    mockPrisma.virtual_learner_profiles.findUnique.mockResolvedValue({ profile: JSON.stringify(demoted) })
    const after = await buildLearnerMemorySnapshot('u1')
    expect(after.mastered.map((m) => m.name)).not.toContain(blocked)
    expect(after.struggling.map((m) => m.name)).toContain(blocked)
  })

  it('buildLearnerMemorySnapshot 无画像 → 空快照（demotion 失败不致命）', async () => {
    mockPrisma.virtual_learner_profiles.findUnique.mockResolvedValue(null)
    const snapshot = await buildLearnerMemorySnapshot('u1')
    expect(snapshot.mastered).toEqual([])
  })
})